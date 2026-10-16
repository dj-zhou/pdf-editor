import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import mupdf from "../vendor/mupdf/1.28.1/mupdf.js";
import { openPdf, readUnits, publicUnit, applyEdits, styledReplacement, parsePageRange, replacementFunction } from "../pdf-tools/edit-text/pdf-text-editor.mjs";
import { BUNDLED_FONTS, fontVariants, fontVariant } from "../pdf-tools/edit-text/font-catalog.mjs";

async function fixture({ crop = false, rotated = false } = {}) {
    const doc = await PDFDocument.create(), regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    for (let i = 0; i < 2; i++) {
        const page = doc.addPage([360, 480]);
        page.drawRectangle({ x: 20, y: 310, width: 300, height: 80, color: rgb(0.95, 0.9, 0.8) });
        page.drawText("Original text", { x: 40, y: 350, size: 16, font: regular, color: rgb(0.8, 0.1, 0.2) });
        page.drawText("Keep this line", { x: 40, y: 310, size: 16, font: bold });
        const image = await doc.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
        page.drawImage(image, { x: 40, y: 100, width: 30, height: 30 });
        if (crop) page.setCropBox(20, 40, 300, 400);
        if (rotated) page.setRotation(degrees(90));
    }
    return doc.save();
}

function inspect(bytes) {
    const doc = openPdf(bytes), pages = [];
    try {
        for (let i = 0; i < doc.countPages(); i++) {
            const page = doc.loadPage(i), extracted = readUnits(page);
            const text = page.toStructuredText();
            try { pages.push({ text: text.asText(), units: extracted.units.map(u => ({ id: u.id, text: u.text, bbox: u.bbox, origin: u.origins[0] })), bounds: page.getBounds() }); }
            finally { text.destroy(); extracted.destroy(); page.destroy(); }
        }
        return pages;
    } finally { doc.destroy(); }
}

function save(result) {
    const buffer = result.doc.saveToBuffer("garbage=2,compress=yes");
    try { return buffer.asUint8Array().slice(); }
    finally { buffer.destroy(); result.doc.destroy(); }
}

test("moving text exports translated glyphs and caret geometry while preserving the original surroundings", async () => {
    for (const crop of [false, true]) for (const cover of [false, true]) {
        const source = await fixture({ crop });
        const original = inspect(source);
        for (const value of ["Original text", "A longer replacement", "First row\nSecond row"]) {
            const edit = { page: 0, id: 0, value };
            const baseline = applyEdits(source, [edit], { cover });
            const offset = [-15, 75];
            const moved = applyEdits(source, [{ ...edit, offset }], { cover });
            const before = baseline.editLayouts[0].layout, after = moved.editLayouts[0].layout;
            for (let i = 0; i < 4; i++) assert.ok(Math.abs(after.bounds[i] - before.bounds[i] - offset[i % 2]) < 0.001);
            for (let i = 0; i < before.stops.length; i++) {
                assert.ok(Math.abs(after.stops[i].x - before.stops[i].x - offset[0]) < 0.001);
                assert.ok(Math.abs(after.stops[i].baseline - before.stops[i].baseline - offset[1]) < 0.001);
            }
            const baselinePages = inspect(save(baseline)), pages = inspect(save(moved));
            const replacement = pages[0].units.find(u => u.text === value.split("\n")[0]);
            const atSource = baselinePages[0].units.find(u => u.text === value.split("\n")[0]);
            assert.ok(Math.abs(replacement.origin[0] - atSource.origin[0] - offset[0]) < 0.01);
            assert.ok(Math.abs(replacement.origin[1] - atSource.origin[1] - offset[1]) < 0.01);
            const neighbor = pages[0].units.find(u => u.text === "Keep this line"), originalNeighbor = original[0].units.find(u => u.text === "Keep this line");
            assert.deepEqual(neighbor.origin, originalNeighbor.origin);
            assert.deepEqual(neighbor.bbox, originalNeighbor.bbox);
            assert.equal(pages[0].units.filter(u => u.text === value.split("\n")[0]).length, 1);
            assert.deepEqual(pages[1], original[1]);
        }
    }
});

test("rejects invalid text movement coordinates", async () => {
    const source = await fixture();
    for (const offset of [[NaN, 0], [0, Infinity], [1], [1, 2, 3], "10,20", null])
        assert.throws(() => applyEdits(source, [{ page: 0, id: 0, value: "Moved", offset }]), /position/);
});

function characters(bytes) {
    const doc = openPdf(bytes), page = doc.loadPage(0), text = page.toStructuredText(), result = [];
    try {
        text.walk({ onChar(c, origin, font, size, quad, color) {
            result.push({ c, origin, size, color, name: font.getName(), bold: font.isBold(), italic: font.isItalic() });
            font.destroy();
        } });
        return result;
    } finally { text.destroy(); page.destroy(); doc.destroy(); }
}

test("whole-string formatting exports size, font variants, and color even with auto-shrink enabled", async () => {
    const source = await fixture();
    for (const [font, expected] of [["sans", /Helvetica|NimbusSans/], ["serif", /Times|NimbusRoman/], ["mono", /Courier|NimbusMono/]]) {
        const output = save(applyEdits(source, [{ page: 0, id: 0, value: "Formatted string", offset: [5, 70],
            format: { font, size: 24, bold: true, italic: true, color: "#336699" } }], { fit: true }));
        const chars = characters(output).filter(char => char.origin[1] > 195 && char.origin[1] < 205);
        assert.equal(chars.map(char => char.c).join(""), "Formatted string");
        for (const char of chars) {
            assert.ok(Math.abs(char.size - 24) < 0.01, "explicit size must override auto-shrink");
            assert.match(char.name, expected);
            assert.equal(char.bold, true); assert.equal(char.italic, true);
            char.color.forEach((v, i) => assert.ok(Math.abs(v - [0.2, 0.4, 0.6][i]) < 0.01));
        }
        assert.ok(Math.abs(chars[0].origin[0] - 45) < 0.01);
        assert.match(inspect(output)[0].text, /Keep this line/);
    }
});

test("bundled font families embed their supported styles with matching caret geometry", async () => {
    const source = await fixture(), bundledFonts = {};
    for (const [family, info] of Object.entries(BUNDLED_FONTS)) for (const variant of fontVariants(family))
        bundledFonts[`${family}:${variant}`] = new Uint8Array(await readFile(new URL(`../vendor/fonts/${info.file}-${variant}.ttf`, import.meta.url)));
    for (const [family, info] of Object.entries(BUNDLED_FONTS)) for (const [bold, italic] of [[false, false], [true, false], [false, true], [true, true]]) {
        const result = applyEdits(source, [{ page: 0, id: 0, value: "Font sample", format: { font: family, size: 18, bold, italic } }], { bundledFonts });
        const layout = result.editLayouts[0].layout;
        const output = save(result), chars = characters(output).filter(char => Math.abs(char.origin[1] - 130) < 0.01);
        assert.equal(chars.map(char => char.c).join(""), "Font sample");
        for (const char of chars) {
            assert.ok(char.name.replace(/\s/g, "").includes(info.name.replace(/\s/g, "")), `${family}: expected ${info.name}, got ${char.name}`);
            assert.equal(char.bold, bold && fontVariants(family).includes("Bold"), `${family}: ${fontVariant(bold, italic)}`);
            assert.equal(char.italic, italic && fontVariants(family).includes("Italic"), `${family}: ${fontVariant(bold, italic)}`);
            assert.ok(Math.abs(char.size - 18) < 0.01);
            if (!/\s/.test(char.c)) assert.ok(layout.stops.some(stop => Math.abs(stop.x - char.origin[0]) < 0.01 && Math.abs(stop.baseline - char.origin[1]) < 0.01),
                `${family}: ${fontVariant(bold, italic)} glyph ${char.c} must match its caret position`);
        }
        assert.match(inspect(output)[0].text, /Keep this line/);
    }
});

test("size and color formatting retains embedded Type 1 fonts and searchable text", async () => {
    const source = await readFile(new URL("fixtures/latex-type1.pdf", import.meta.url));
    const original = characters(source).find(char => char.c === "O");
    const output = save(applyEdits(source, [{ page: 0, id: 0, value: "Original text", format: { size: 20, color: "#008800" } }]));
    const first = characters(output).find(char => char.c === "O");
    assert.equal(first.name, original.name);
    assert.ok(Math.abs(first.size - 20) < 0.01);
    assert.match(inspect(output)[0].text, /Original text/);
});

test("whole-string overrides apply uniformly across mixed source styles", async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([360, 480]);
    const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("Hello ", { x: 40, y: 350, size: 16, font: regular });
    page.drawText("world", { x: 81, y: 350, size: 16, font: bold, color: rgb(1, 0, 0) });
    const source = await doc.save();
    const output = save(applyEdits(source, [{ page: 0, id: 0, value: "Hello world",
        format: { size: 20, bold: false, italic: false, color: "#000000" } }]));
    const chars = characters(output);
    assert.equal(chars.map(char => char.c).join(""), "Hello world");
    for (const char of chars) {
        assert.ok(Math.abs(char.size - 20) < 0.01); assert.equal(char.bold, false); assert.equal(char.italic, false);
        assert.ok(char.color.every(v => Math.abs(v) < 0.01));
    }
});

test("spacing and alignment use the same geometry for exported glyphs and caret stops", async () => {
    const source = await fixture(), value = "AB\nCD";
    const plain = applyEdits(source, [{ page: 0, id: 0, value }]);
    const spaced = applyEdits(source, [{ page: 0, id: 0, value, format: { letterSpacing: 2, lineSpacing: 1.5 } }]);
    const before = plain.editLayouts[0].layout, after = spaced.editLayouts[0].layout;
    const stop = (layout, offset) => layout.stops.find(s => s.offset === offset);
    assert.ok(Math.abs(stop(after, 1).x - stop(before, 1).x - 2) < 0.01);
    assert.ok(Math.abs(stop(after, 3).baseline - stop(after, 0).baseline - before.pitch * 1.5) < 0.01);
    const actual = characters(save(spaced)).filter(char => /[ABCD]/.test(char.c) && char.origin[1] < 165);
    for (const char of actual) assert.ok(after.stops.some(s => Math.abs(s.x - char.origin[0]) < 0.01 && Math.abs(s.baseline - char.origin[1]) < 0.01));
    plain.doc.destroy();
    const width = inspect(source)[0].units[0].bbox[2] - 40;
    const left = applyEdits(source, [{ page: 0, id: 0, value: "AB" }]);
    const rowWidth = left.editLayouts[0].layout.stops.at(-1).x - 40;
    left.doc.destroy();
    for (const [align, fraction] of [["center", 0.5], ["right", 1]]) {
        const result = applyEdits(source, [{ page: 0, id: 0, value: "AB", format: { align } }]);
        const x = result.editLayouts[0].layout.stops[0].x;
        assert.ok(Math.abs(x - (40 + (width - rowWidth) * fraction)) < 0.01);
        const char = characters(save(result)).find(char => char.c === "A");
        assert.ok(Math.abs(char.origin[0] - x) < 0.01);
    }
});

test("underline and strikethrough export visible vectors inside the selection bounds", async () => {
    const source = await fixture();
    for (const format of [{ underline: true }, { strike: true }, { underline: true, strike: true }]) {
        const result = applyEdits(source, [{ page: 0, id: 0, value: "AB", format }]);
        const page = result.doc.loadPage(0), rects = [];
        const device = new mupdf.Device({ fillPath(path, evenOdd, matrix) { rects.push(path.getBounds(null, matrix)); } });
        try { page.runPageContents(device, mupdf.Matrix.identity); }
        finally { device.close(); device.destroy(); page.destroy(); }
        const decorations = rects.filter(rect => rect[0] >= 39 && rect[1] > 120 && rect[3] < 135);
        assert.equal(decorations.length, (Number(Boolean(format.underline)) + Number(Boolean(format.strike))) * 2);
        const bounds = result.editBounds[0].bounds;
        for (const rect of decorations) assert.ok(rect[0] >= bounds[0] - 0.01 && rect[1] >= bounds[1] - 0.01 && rect[2] <= bounds[2] + 0.01 && rect[3] <= bounds[3] + 0.01);
        assert.match(inspect(save(result))[0].text, /AB/);
    }
});

test("invalid formatting is rejected before a PDF can be exported", async () => {
    const source = await fixture();
    for (const format of [null, [], { size: 0 }, { size: 301 }, { size: NaN }, { font: "unknown" },
        { bold: "yes" }, { color: "red" }, { align: "justify" }, { letterSpacing: -6 }, { lineSpacing: 0 }, { unknown: true }])
        assert.throws(() => applyEdits(source, [{ page: 0, id: 0, value: "Invalid", format }]), /formatting/);
});

test("inline caret geometry follows the exported PDF font advances and multiline fitting", async () => {
    const source = await readFile(new URL("fixtures/latex-type1.pdf", import.meta.url));
    for (const fit of [false, true]) {
        const value = "Original text text text\nBold heading";
        const result = applyEdits(source, [{ page: 0, id: 0, value }], { fit });
        try {
            const layout = result.editLayouts[0].layout;
            assert.equal(layout.stops.at(-1).offset, value.length);
            assert.equal(layout.stops.find(stop => stop.row === 1).offset, value.indexOf("\n") + 1);
            const page = result.doc.loadPage(0), text = page.toStructuredText();
            const origins = [];
            try {
                text.walk({ onChar(c, origin, font) { origins.push(origin); font.destroy(); } });
                for (const stop of layout.stops.filter(stop => stop.offset < value.length && !/\s/.test(value[stop.offset]))) {
                    assert.ok(origins.some(origin => Math.abs(origin[0] - stop.x) < 0.02 &&
                        Math.abs(origin[1] - stop.baseline) < 0.02),
                    "caret must use the same glyph position as the PDF writer");
                }
                assert.ok(layout.stops.filter(stop => stop.row === 1).every(stop => stop.top > layout.stops[0].top));
            } finally { text.destroy(); page.destroy(); }
        } finally { result.doc.destroy(); }
    }
});

function pixelsIn(bytes, rect) {
    const doc = openPdf(bytes), page = doc.loadPage(0);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(3, 3), mupdf.ColorSpace.DeviceRGB, false, false);
    try {
        const pixels = pixmap.getPixels(), stride = pixmap.getStride(), n = pixmap.getNumberOfComponents();
        const result = [];
        for (let y = rect[1] * 3; y < rect[3] * 3; y++)
            result.push(...pixels.subarray(y * stride + rect[0] * 3 * n, y * stride + rect[2] * 3 * n));
        return new Uint8Array(result);
    } finally { pixmap.destroy(); page.destroy(); doc.destroy(); }
}

test("editing or temporarily hiding a tightly spaced line preserves neighboring text and pixels", async () => {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([200, 200]);
    const rows = ["10/03/2026", "0 lb 15 oz", "Keep below"];
    rows.forEach((text, i) => page.drawText(text, { x: 20, y: 100 - i * 12, size: 12, font }));
    page.drawLine({ start: { x: 10, y: 70 }, end: { x: 180, y: 70 }, thickness: 1 });
    const source = await doc.save(), units = inspect(source)[0].units;
    assert.ok(units[0].bbox[3] > units[1].bbox[1], "font boxes must overlap to reproduce the bug");
    const pdf = openPdf(source), loaded = pdf.loadPage(0), extracted = readUnits(loaded);
    try {
        const visible = extracted.units.map(publicUnit);
        assert.ok(visible[0].inkBounds[3] < visible[1].inkBounds[1], "selection outlines must leave neighboring ink clear");
    } finally { extracted.destroy(); loaded.destroy(); pdf.destroy(); }
    for (const cover of [false, true]) for (const row of [0, 1]) for (const value of ["", "Edited text"]) {
        const output = save(applyEdits(source, [{ page: 0, id: units[row].id, value }], { cover }));
        const text = inspect(output)[0].text;
        assert.doesNotMatch(text, new RegExp(rows[row]));
        if (value) assert.match(text, /Edited text/);
        for (let other = 0; other < rows.length; other++) if (other !== row) {
            assert.ok(text.includes(rows[other]), `neighboring row must survive: ${rows[other]}`);
            const baseline = 100 + other * 12;
            const rect = [18, baseline - 10, 110, baseline + 1];
            const before = pixelsIn(source, rect), after = pixelsIn(output, rect);
            // Coverage can tint empty background next to a shorter neighboring
            // line, but every pixel of that line's ink must remain identical.
            assert.ok(before.every((v, i) => (cover && v >= 250) || after[i] === v),
                `neighboring visible text must be unchanged (cover=${cover}, edited row=${row}, neighbor=${other}, value=${value})`);
        }
        assert.deepEqual(pixelsIn(output, [10, 129, 180, 132]), pixelsIn(source, [10, 129, 180, 132]), "cell border must remain intact");
    }
});

test("replaces actual PDF text, preserves nearby text, images, vectors, and source bytes", async () => {
    const source = await fixture(), unchanged = source.slice();
    const result = applyEdits(source, [{ page: 0, id: 0, value: "Replacement" }], { fit: true });
    const page = result.doc.loadPage(0);
    let images = 0, paths = 0;
    const device = new mupdf.Device({ fillImage() { images++; }, fillPath() { paths++; } });
    try { page.runPageContents(device, mupdf.Matrix.identity); }
    finally { device.close(); device.destroy(); page.destroy(); }
    assert.equal(images, 1); assert.ok(paths >= 1);
    const pages = inspect(save(result));
    assert.doesNotMatch(pages[0].text, /Original text/);
    assert.match(pages[0].text, /Replacement/); assert.match(pages[0].text, /Keep this line/);
    assert.match(pages[1].text, /Original text/);
    assert.deepEqual(source, unchanged);
    const replacement = pages[0].units.find(u => u.text === "Replacement");
    assert.ok(Math.abs(replacement.bbox[0] - 40) < 0.1);
    assert.ok(Math.abs(replacement.origin[1] - 130) < 0.2);
});

test("removes deleted text permanently on a full save", async () => {
    const result = applyEdits(await fixture(), [{ page: 0, id: 0, value: "" }]);
    const pages = inspect(save(result));
    assert.doesNotMatch(pages[0].text, /Original text/); assert.match(pages[0].text, /Keep this line/);
});

test("replacement selection bounds cover changed widths, multiple lines, fitting, and fallback fonts", async () => {
    for (const crop of [false, true]) {
        const source = await fixture({ crop });
        for (const [value, fit] of [["W", false], ["A much longer replacement", false],
            ["First row\nSecond row", false], ["A much longer replacement", true], ["中文 replacement", false]]) {
            const result = applyEdits(source, [{ page: 0, id: 0, value }], { fit });
            const selection = result.editBounds.find(edit => edit.page === 0 && edit.id === 0)?.bounds;
            assert.ok(selection, "the original unit ID must have replacement bounds");
            const exported = openPdf(save(result)), page = exported.loadPage(0), extracted = readUnits(page);
            try {
                const actual = extracted.units.filter(unit => unit.text !== "Keep this line").map(publicUnit).map(unit => unit.inkBounds);
                assert.ok(actual.length);
                const ink = [Math.min(...actual.map(r => r[0])), Math.min(...actual.map(r => r[1])),
                    Math.max(...actual.map(r => r[2])), Math.max(...actual.map(r => r[3]))];
                assert.ok(selection[0] <= ink[0] + 0.2 && selection[1] <= ink[1] + 0.2 &&
                    selection[2] >= ink[2] - 0.2 && selection[3] >= ink[3] - 0.2,
                    `outline must cover exported glyphs (crop=${crop}, fit=${fit}, text=${value})`);
                // The built-in CJK font reports conservative bounds before PDF
                // embedding. Other fonts should agree with their exported bounds.
                if (!value.includes("中文")) for (let edge = 0; edge < 4; edge++)
                    assert.ok(Math.abs(selection[edge] - ink[edge]) < 0.2,
                        `outline must follow exported glyphs (crop=${crop}, fit=${fit}, text=${value}, edge=${edge})`);
            } finally { extracted.destroy(); page.destroy(); exported.destroy(); }
        }
    }
});

test("exports distinct replacement forms on multiple pages without deduplicating their streams", async () => {
    const result = applyEdits(await fixture(), [
        { page: 0, id: 0, value: "Replaced in browser" },
        { page: 1, id: 0, value: "Changed text" }
    ], { fit: true });
    const pages = inspect(save(result));
    assert.match(pages[0].text, /Replaced in browser/);
    assert.match(pages[1].text, /Changed text/);
    for (const page of pages) { assert.doesNotMatch(page.text, /Original text/); assert.match(page.text, /Keep this line/); }
});

test("LaTeX Type 1 edits retain their original font encoding and appearance after export", async () => {
    const source = await readFile(new URL("fixtures/latex-type1.pdf", import.meta.url));
    const original = inspect(source), title = original[0].units.find(u => u.text === "Original text");
    const heading = original[0].units.find(u => u.text === "Bold heading");
    const second = original[1].units.find(u => u.text === "Second heading");
    // An unchanged replacement must render exactly like the original title.
    const unchanged = save(applyEdits(source, [{ page: 0, id: title.id, value: title.text }]));
    const rect = [170, 110, 420, 140];
    assert.deepEqual(pixelsIn(unchanged, rect), pixelsIn(source, rect));
    const output = save(applyEdits(source, [
        { page: 0, id: title.id, value: "Original text ! Hello world" },
        { page: 0, id: heading.id, value: "Bold heading ! Edited" },
        { page: 1, id: second.id, value: "Second heading ! Edited" }
    ]));
    const pages = inspect(output);
    assert.match(pages[0].text, /Original text ! Hello world/);
    assert.match(pages[0].text, /Bold heading ! Edited/);
    assert.match(pages[0].text, /Keep this line/);
    assert.match(pages[1].text, /Second heading ! Edited/);
    assert.deepEqual(pixelsIn(output, [70, 215, 180, 270]), pixelsIn(source, [70, 215, 180, 270]), "body and math must remain intact");
    const doc = openPdf(output), page = doc.loadPage(0), object = page.getObject();
    const fonts = object.get("Resources", "XObject", "ShipToolkitText", "Resources", "Font");
    let type1 = 0, fallback = 0;
    try {
        fonts.forEach(font => {
            const subtype = font.get("Subtype"), program = font.get("FontDescriptor", "FontFile");
            const cidProgram = font.get("DescendantFonts", 0, "FontDescriptor", "FontFile");
            try {
                assert.equal(cidProgram.isNull(), true, "raw Type 1 programs must never be embedded as Identity-H CID fonts");
                if (subtype.asName() === "Type1" && !program.isNull()) type1++;
                if (subtype.asName() === "Type0") fallback++;
            } finally { subtype.destroy(); program.destroy(); cidProgram.destroy(); font.destroy(); }
        });
        assert.equal(type1, 2, "the regular and bold Computer Modern subsets must be reused");
        assert.ok(fallback, "characters missing from the source subsets use a compatible font");
    } finally { fonts.destroy(); object.destroy(); page.destroy(); doc.destroy(); }
});

test("Type 1 font resources inside forms are reused; missing character maps use a safe fallback", async () => {
    const source = await readFile(new URL("fixtures/latex-type1.pdf", import.meta.url));
    for (const removeMap of [false, true]) {
        const doc = openPdf(source), page = doc.loadPage(0), object = page.getObject();
        const resources = object.get("Resources"), contents = object.get("Contents"), data = contents.readStream();
        const temporaries = [];
        const keep = value => { temporaries.push(value); return value; };
        try {
            if (removeMap) {
                const fonts = keep(resources.get("Font"));
                fonts.forEach(font => { font.delete("ToUnicode"); font.destroy(); });
            }
            const form = keep(doc.addStream(data, { Type: "XObject", Subtype: "Form", BBox: keep(object.get("MediaBox")), Resources: resources }));
            object.put("Resources", { XObject: { NestedText: form } });
            object.put("Contents", keep(doc.addStream("/NestedText Do", {})));
            const buffer = doc.saveToBuffer("garbage=2,compress=yes");
            let bytes;
            try { bytes = buffer.asUint8Array().slice(); } finally { buffer.destroy(); }
            const title = inspect(bytes)[0].units.find(u => u.text === "Original text");
            assert.ok(title);
            const edited = applyEdits(bytes, [{ page: 0, id: title.id, value: "Original text text" }]);
            assert.equal(edited.warnings.some(w => /fallback font/.test(w)), removeMap);
            assert.match(inspect(save(edited))[0].text, /Original text text/);
        } finally {
            for (const temporary of temporaries.reverse()) temporary.destroy();
            data.destroy(); contents.destroy(); resources.destroy(); object.destroy(); page.destroy(); doc.destroy();
        }
    }
});

test("Type 1 character maps with array ranges preserve cropped replacement coordinates", async () => {
    const doc = openPdf(await readFile(new URL("fixtures/latex-type1.pdf", import.meta.url)));
    const page = doc.loadPage(0), object = page.getObject(), fonts = object.get("Resources", "Font");
    let bytes;
    try {
        page.setPageBox("CropBox", [20, 40, 580, 750]);
        fonts.forEach(font => {
            const cmap = font.get("ToUnicode"), data = cmap.readStream();
            try {
                const values = Array.from({ length: 26 }, (_, i) => `<${(97 + i).toString(16).padStart(4, "0")}>`).join(" ");
                cmap.writeStream(data.asString().replace(/<61>\s*<7A>\s*<0061>/g, `<61> <7A> [${values}]`));
            } finally { data.destroy(); cmap.destroy(); font.destroy(); }
        });
        const buffer = doc.saveToBuffer("garbage=2,compress=yes");
        try { bytes = buffer.asUint8Array().slice(); } finally { buffer.destroy(); }
    } finally { fonts.destroy(); object.destroy(); page.destroy(); doc.destroy(); }
    const title = inspect(bytes)[0].units.find(u => u.text === "Original text");
    const output = save(applyEdits(bytes, [{ page: 0, id: title.id, value: "Original text text" }]));
    const actual = inspect(output)[0].units.find(u => u.text === "Original text text");
    assert.ok(actual);
    assert.ok(Math.abs(actual.origin[0] - title.origin[0]) < 0.01);
    assert.ok(Math.abs(actual.origin[1] - title.origin[1]) < 0.01);
});

test("requires passwords and exports an unencrypted editable result", async () => {
    const original = openPdf(await fixture());
    const buffer = original.saveToBuffer("encrypt=aes-256,user-password=reader,owner-password=owner,permissions=-1");
    const bytes = buffer.asUint8Array().slice(); buffer.destroy(); original.destroy();
    assert.throws(() => openPdf(bytes), /password/);
    const result = applyEdits(bytes, [{ page: 0, id: 0, value: "Unlocked" }], { password: "owner" });
    const output = result.doc.saveToBuffer("garbage=2,compress=yes,encrypt=none");
    try { assert.match(inspect(output.asUint8Array())[0].text, /Unlocked/); }
    finally { output.destroy(); result.doc.destroy(); }
});

test("preserves cropped page geometry and replacement coordinates", async () => {
    const source = await fixture({ crop: true }), before = inspect(source);
    const pages = inspect(save(applyEdits(source, [{ page: 0, id: 0, value: "Changed" }])));
    assert.deepEqual(pages[0].bounds, before[0].bounds);
    const replacement = pages[0].units.find(u => u.text === "Changed");
    assert.ok(Math.abs(replacement.bbox[0] - before[0].units[0].bbox[0]) < 0.1);
    assert.ok(Math.abs(replacement.bbox[1] - before[0].units[0].bbox[1]) < 0.2);
});

test("excludes angled/vertical text and rejects invalid edit selections", async () => {
    const bytes = await fixture({ rotated: true });
    assert.equal(inspect(bytes)[0].units.length, 0);
    assert.throws(() => applyEdits(bytes, [{ page: 0, id: 0, value: "Changed" }]), /selection/);
    assert.throws(() => applyEdits(bytes, [{ page: 5, id: 0, value: "Changed" }]), /page/);
});

test("supports CJK replacements with searchable fallback glyphs", async () => {
    const result = applyEdits(await fixture(), [{ page: 0, id: 0, value: "中文測試" }], { fit: true });
    assert.match(result.warnings.join(" "), /fallback font/);
    const pages = inspect(save(result));
    assert.match(pages[0].text, /中文測試/); assert.doesNotMatch(pages[0].text, /Original text/);
});

test("cover background keeps image and vector drawing instructions", async () => {
    const result = applyEdits(await fixture(), [{ page: 0, id: 0, value: "Covered" }], { cover: true });
    assert.match(inspect(save(result))[0].text, /Covered/);
});

test("line, span, and paragraph modes retain mixed styles", async () => {
    const doc = await PDFDocument.create(), page = doc.addPage([360, 480]);
    const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText("Hello ", { x: 40, y: 350, size: 16, font: regular });
    page.drawText("world", { x: 81, y: 350, size: 16, font: bold });
    page.drawText("Second line", { x: 40, y: 330, size: 16, font: regular });
    const bytes = await doc.save(), pdf = openPdf(bytes), loaded = pdf.loadPage(0);
    try {
        const line = readUnits(loaded, "line"), span = readUnits(loaded, "span"), para = readUnits(loaded, "paragraph");
        try {
            assert.equal(line.units[0].text, "Hello world");
            assert.ok(span.units.length > line.units.length);
            assert.match(para.units[0].text, /Hello world Second line/);
        } finally { line.destroy(); span.destroy(); para.destroy(); }
    } finally { loaded.destroy(); pdf.destroy(); }
    const result = applyEdits(bytes, [{ page: 0, id: 0, value: "Hello earth" }]);
    const output = result.doc.loadPage(0), units = readUnits(output, "span");
    try { assert.ok(units.units.some(u => u.text.trim() === "earth" && u.main.font.isBold())); }
    finally { units.destroy(); output.destroy(); result.doc.destroy(); }
});

test("font styles survive insertion and replacement diffs", () => {
    const a = { name: "regular" }, b = { name: "bold" };
    const original = Array.from("ABCDEF", (c, i) => ({ c, style: i < 3 ? a : b }));
    const changed = styledReplacement(original, "ABxCDyEF");
    assert.equal(changed.map(t => t.c).join(""), "ABxCDyEF");
    assert.equal(changed.find(t => t.c === "E").style, b);
});

test("find/replace supports literal dollars, regex, case, and page ranges", () => {
    assert.equal(replacementFunction("a.b", "$&")("A.b a-b"), "$& a-b");
    assert.equal(replacementFunction("ID(\\d+)", "$1", { regex: true })("ID123"), "123");
    assert.equal(replacementFunction("yes", "no", { caseSensitive: true })("YES yes"), "YES no");
    assert.deepEqual(parsePageRange("1-3, 5, 8-", 9), [0, 1, 2, 4, 7, 8]);
    assert.deepEqual(parsePageRange("", 2), [0, 1]);
    assert.throws(() => parsePageRange("0-2", 4));
    assert.throws(() => replacementFunction("[", "x", { regex: true }));
});
