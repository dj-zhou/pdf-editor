// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
// MuPDF performs real text removal; replacement content remains searchable PDF text.
import mupdf from "../../vendor/mupdf/1.28.1/mupdf.js";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MODES = ["line", "span", "paragraph"];
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uac00-\ud7af\u3000-\u303f]/;
const union = (rects) => [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])),
    Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))];
const quadRect = q => [Math.min(q[0], q[2], q[4], q[6]), Math.min(q[1], q[3], q[5], q[7]),
    Math.max(q[0], q[2], q[4], q[6]), Math.max(q[1], q[3], q[5], q[7])];

export function openPdf(bytes, password = "") {
    if (!bytes?.byteLength || bytes.byteLength > MAX_FILE_BYTES) throw new Error("Choose a PDF smaller than 50 MB.");
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    try {
        if (!doc.isPDF()) throw new Error("Choose a PDF file.");
        if (doc.needsPassword() && !doc.authenticatePassword(password)) throw new Error("This PDF needs a valid password.");
        if (!doc.hasPermission("edit")) throw new Error("This PDF does not allow editing. Open it with the owner password.");
        if (!doc.countPages()) throw new Error("This PDF has no pages.");
        return doc;
    } catch (error) { doc.destroy(); throw error; }
}

export function readUnits(page, mode = "line") {
    if (!MODES.includes(mode)) throw new Error("Choose line, span, or paragraph mode.");
    const structured = page.toStructuredText("preserve-whitespace");
    const fonts = new Map(), blocks = [];
    let block, line;
    try {
        structured.walk({
            beginTextBlock() { block = []; blocks.push(block); },
            beginLine(bbox, wmode, direction) {
                line = { chars: [], eligible: wmode === 0 && direction[0] > 0.95 && Math.abs(direction[1]) < 0.05 };
                block.push(line);
            },
            onChar(c, origin, font, size, quad, color, bidi) {
                const pointer = font.pointer;
                if (fonts.has(pointer)) font.destroy();
                else fonts.set(pointer, font);
                const retained = fonts.get(pointer);
                if (bidi & 1) line.eligible = false;
                line.chars.push({ c, origin, rect: quadRect(quad), style: {
                    font: retained, name: retained.getName(), size, color,
                    key: `${pointer}:${size}:${color.join(",")}`
                } });
            }
        });
        const units = [];
        function add(rows) {
            if (!rows.length) return;
            const tokens = [], rects = [], origins = [];
            rows.forEach((chars, i) => {
                if (i && tokens.length && !/\s/.test(tokens.at(-1).c) &&
                    !CJK.test(tokens.at(-1).c) && !CJK.test(chars[0].c)) {
                    tokens.push({ c: " ", style: tokens.at(-1).style });
                }
                tokens.push(...chars);
                rects.push(union(chars.map(c => c.rect)));
                origins.push(chars[0].origin);
            });
            const text = tokens.map(t => t.c).join("");
            if (!text.trim()) return;
            const counts = new Map();
            for (const t of tokens) counts.set(t.style.key, (counts.get(t.style.key) || 0) + 1);
            const main = tokens.reduce((a, b) => counts.get(a.style.key) >= counts.get(b.style.key) ? a : b).style;
            units.push({ id: units.length, text, tokens, rects, bbox: union(rects), origins,
                mode, main, pitch: origins.length > 1 ? (origins.at(-1)[1] - origins[0][1]) / (origins.length - 1) : main.size * 1.2 });
        }
        for (const lines of blocks) {
            if (mode === "paragraph") {
                if (lines.every(l => l.eligible) && lines.some(l => l.chars.length)) add(lines.filter(l => l.chars.length).map(l => l.chars));
                continue;
            }
            for (const row of lines) {
                if (!row.eligible) continue;
                let group = [];
                for (const char of row.chars) {
                    const prev = group.at(-1);
                    if (prev && ((mode === "span" && prev.style.key !== char.style.key) ||
                        char.rect[0] - prev.rect[2] > Math.max(prev.style.size, char.style.size) * 0.7)) {
                        add([group]); group = [];
                    }
                    group.push(char);
                }
                if (group.length) add([group]);
            }
        }
        // Include non-editable text too: its glyph bounds must remain protected.
        return { units, characters: blocks.flatMap(b => b.flatMap(l => l.chars)),
            destroy() { for (const font of fonts.values()) font.destroy(); } };
    } catch (error) { for (const font of fonts.values()) font.destroy(); throw error; }
    finally { structured.destroy(); }
}

export function publicUnit(unit) {
    const text = new mupdf.Text();
    let inkBounds = unit.bbox;
    try {
        for (const token of unit.tokens) {
            if (!token.origin || /\s/.test(token.c)) continue;
            const glyph = token.style.font.encodeCharacter(token.c), size = token.style.size;
            if (!glyph) return unitWithBounds(unit, inkBounds);
            text.showGlyph(token.style.font, [size, 0, 0, -size, ...token.origin], glyph, token.c.codePointAt(0));
        }
        inkBounds = text.getBounds(null, mupdf.Matrix.identity);
        return unitWithBounds(unit, inkBounds);
    } finally { text.destroy(); }
}

function unitWithBounds(unit, inkBounds) {
    return { id: unit.id, text: unit.text, bbox: unit.bbox, inkBounds, rects: unit.rects,
        layout: originalLayout(unit, inkBounds),
        font: unit.main.name, size: unit.main.size, color: unit.main.color,
        origin: unit.origins[0], pitch: unit.pitch, lines: unit.origins.length,
        bold: unit.main.font.isBold(), italic: unit.main.font.isItalic(),
        mono: unit.main.font.isMono(), serif: unit.main.font.isSerif() };
}

function originalLayout(unit, inkBounds) {
    let offset = 0;
    const stops = [];
    for (const token of unit.tokens) {
        if (!token.origin) { offset += token.c.length; continue; }
        const [x, y] = token.origin;
        const row = Math.max(0, unit.origins.findIndex(origin => Math.abs(origin[1] - y) < 0.1));
        const top = unit.origins[row][1] + inkBounds[1] - unit.origins[0][1];
        const bottom = top + inkBounds[3] - inkBounds[1];
        stops.push({ offset, x, baseline: y, top, bottom, row });
        offset += token.c.length;
        stops.push({ offset, x: x + token.style.font.advanceGlyph(token.style.font.encodeCharacter(token.c)) * token.style.size, baseline: y, top, bottom, row });
    }
    return { stops, bounds: inkBounds, pitch: unit.pitch };
}

// Character diff keeps unchanged style runs. Bound the matrix for very large blocks.
export function styledReplacement(oldTokens, newText) {
    const chars = Array.from(newText), result = [];
    let prefix = 0, suffix = 0;
    while (prefix < oldTokens.length && prefix < chars.length && oldTokens[prefix].c === chars[prefix]) prefix++;
    while (suffix < oldTokens.length - prefix && suffix < chars.length - prefix &&
        oldTokens[oldTokens.length - 1 - suffix].c === chars[chars.length - 1 - suffix]) suffix++;
    result.push(...oldTokens.slice(0, prefix));
    const old = oldTokens.slice(prefix, oldTokens.length - suffix), fresh = chars.slice(prefix, chars.length - suffix);
    if (old.length * fresh.length <= 500000) {
        const table = Array.from({ length: old.length + 1 }, () => new Uint32Array(fresh.length + 1));
        for (let i = old.length - 1; i >= 0; i--) for (let j = fresh.length - 1; j >= 0; j--)
            table[i][j] = old[i].c === fresh[j] ? 1 + table[i + 1][j + 1] : Math.max(table[i + 1][j], table[i][j + 1]);
        let i = 0, j = 0;
        while (j < fresh.length) {
            if (i < old.length && old[i].c === fresh[j]) { result.push(old[i++]); j++; }
            else if (i < old.length && table[i + 1][j] > table[i][j + 1]) i++;
            else result.push({ c: fresh[j++], style: old[i]?.style || result.at(-1)?.style || oldTokens[0].style });
        }
    } else for (const c of fresh) result.push({ c, style: old[0]?.style || oldTokens[prefix]?.style || oldTokens[0].style });
    if (suffix) result.push(...oldTokens.slice(-suffix));
    return result;
}

function baseFont(font) {
    if (font.isMono()) return font.isBold() ? (font.isItalic() ? "Courier-BoldOblique" : "Courier-Bold") : (font.isItalic() ? "Courier-Oblique" : "Courier");
    if (font.isSerif()) return font.isBold() ? (font.isItalic() ? "Times-BoldItalic" : "Times-Bold") : (font.isItalic() ? "Times-Italic" : "Times-Roman");
    return font.isBold() ? (font.isItalic() ? "Helvetica-BoldOblique" : "Helvetica-Bold") : (font.isItalic() ? "Helvetica-Oblique" : "Helvetica");
}

// A PDF device writes glyph IDs through Identity-H CID fonts. Raw PostScript
// Type 1 programs (including pdfTeX's Computer Modern subsets) are not CID
// programs: other readers render that conversion as unrelated characters.
// Retain their original one-byte PDF encoding and font resource instead.
function type1CharacterCodes(cmap) {
    const codes = new Map();
    const clean = hex => hex.replace(/\s/g, "");
    const unicode = hex => {
        hex = clean(hex);
        if (!hex.length || hex.length % 4 || hex.length > 8) return "";
        return String.fromCharCode(...hex.match(/.{4}/g).map(value => parseInt(value, 16)));
    };
    function add(code, value) {
        code = clean(code);
        if (code.length !== 2 || !value || codes.has(value)) return;
        codes.set(value, code);
    }
    cmap = cmap.replace(/%[^\r\n]*/g, "");
    for (const block of cmap.matchAll(/beginbfchar\b([\s\S]*?)endbfchar\b/g))
        for (const pair of block[1].matchAll(/<([\da-f\s]+)>\s*<([\da-f\s]+)>/gi)) add(pair[1], unicode(pair[2]));
    for (const block of cmap.matchAll(/beginbfrange\b([\s\S]*?)endbfrange\b/g)) {
        for (const range of block[1].matchAll(/<([\da-f\s]+)>\s*<([\da-f\s]+)>\s*(<([\da-f\s]+)>|\[([^\]]*)\])/gi)) {
            const first = clean(range[1]), last = clean(range[2]);
            if (first.length !== 2 || last.length !== 2) continue;
            const start = parseInt(first, 16), end = parseInt(last, 16);
            const values = range[5] !== undefined ? [...range[5].matchAll(/<([\da-f\s]+)>/gi)].map(v => unicode(v[1])) : null;
            const initial = range[4] ? clean(range[4]) : "";
            if (!values && initial.length !== 4) continue;
            for (let code = start; code <= end; code++)
                add(code.toString(16).padStart(2, "0"), values ? values[code - start] : String.fromCharCode(parseInt(initial, 16) + code - start));
        }
    }
    return codes;
}

function originalType1Fonts(page) {
    const fonts = new Map(), retained = [], visited = new Set();
    function visit(resources, depth = 0) {
        if (resources.isNull() || depth > 32) return;
        const dictionary = resources.get("Font"), forms = resources.get("XObject");
        try {
            dictionary.forEach(font => {
                retained.push(font);
                const subtype = font.get("Subtype"), program = font.get("FontDescriptor", "FontFile"), name = font.get("BaseFont"), cmap = font.get("ToUnicode");
                try {
                    if (subtype.asName() !== "Type1" || program.isNull()) return;
                    const key = name.asName(), existing = fonts.get(key);
                    if (existing) {
                        // Same-name fonts with different resources are ambiguous.
                        const same = existing.resource.isIndirect() && font.isIndirect()
                            ? existing.resource.asIndirect() === font.asIndirect() : existing.resource.pointer === font.pointer;
                        if (!same) existing.codes.clear();
                        return;
                    }
                    let buffer;
                    try {
                        if (!cmap.isNull()) buffer = cmap.readStream();
                        fonts.set(key, { resource: font, codes: buffer ? type1CharacterCodes(buffer.asString()) : new Map() });
                    } finally { buffer?.destroy(); }
                } finally { subtype.destroy(); program.destroy(); name.destroy(); cmap.destroy(); }
            });
            forms.forEach(form => {
                let nested;
                try {
                    const id = form.isIndirect() ? `ref:${form.asIndirect()}` : `ptr:${form.pointer}`;
                    if (visited.has(id)) return;
                    visited.add(id); nested = form.get("Resources"); visit(nested, depth + 1);
                } finally { nested?.destroy(); form.destroy(); }
            });
        } finally { dictionary.destroy(); forms.destroy(); }
    }
    const object = page.getObject(), resources = object.getInheritable("Resources");
    try {
        visit(resources);
        return { fonts, destroy() { for (const font of retained) font.destroy(); } };
    } catch (error) { for (const font of retained) font.destroy(); throw error; }
    finally { resources.destroy(); object.destroy(); }
}

function planReplacement(unit, value, options, fallbacks, warnings, type1Fonts) {
    if (typeof value !== "string" || value.length > 20000) throw new Error("Replacement text must be shorter than 20,000 characters.");
    const tokens = styledReplacement(unit.tokens, value.replace(/\r\n?/g, "\n"));
    let fallback = false;
    let tokenOffset = 0;
    const resolved = tokens.map(token => {
        const { c, style } = token;
        const offset = tokenOffset; tokenOffset += c.length;
        if (c === "\n") return { ...token, offset, width: 0 };
        let font = style.font, glyph = font.encodeCharacter(c);
        const originalType1 = type1Fonts.get(style.name), code = originalType1?.codes.get(c);
        if ((!glyph || (originalType1 && !code)) && !/\s/.test(c)) {
            const name = baseFont(font);
            if (!fallbacks.has(name)) fallbacks.set(name, new mupdf.Font(name));
            if (!fallbacks.has("zh-Hans")) fallbacks.set("zh-Hans", new mupdf.Font("zh-Hans"));
            font = [options.userFont, fallbacks.get(name), fallbacks.get("zh-Hans")].filter(Boolean).find(f => f.encodeCharacter(c));
            if (!font) {
                const error = new Error(`No available font supports “${c}”.`);
                error.messageKey = "No available font supports “{character}”.";
                error.variables = { character: c };
                throw error;
            }
            glyph = font.encodeCharacter(c); fallback = true;
        }
        return { ...token, offset, font, glyph, originalType1: font === style.font && code ? originalType1 : undefined,
            code, width: font.advanceGlyph(glyph) * style.size };
    });
    const width = Math.max(10, unit.bbox[2] - unit.origins[0][0]);
    function layout(scale) {
        const rows = [[]]; let used = 0;
        for (const token of resolved) {
            if (token.c === "\n") { rows.push([]); used = 0; continue; }
            let row = rows.at(-1);
            if (unit.mode === "paragraph" && row.length && token.c !== " " && used + token.width * scale > width) {
                const breakAt = row.findLastIndex(t => /\s/.test(t.c));
                const tail = breakAt >= 0 ? row.splice(breakAt + 1) : [];
                rows.push(tail); row = tail; used = tail.reduce((n, t) => n + t.width * scale, 0);
            }
            row.push(token); used += token.width * scale;
        }
        return rows;
    }
    let scale = 1, rows = layout(scale);
    if (options.fit) {
        if (unit.mode === "paragraph") {
            while (scale > 0.5 && (rows.length > unit.origins.length || rows.some(r => r.reduce((n, t) => n + t.width * scale, 0) > width + 0.1))) {
                scale = Math.max(0.5, scale - 0.04); rows = layout(scale);
            }
        } else {
            const maxWidth = Math.max(0, ...rows.map(r => r.reduce((n, t) => n + t.width, 0)));
            if (maxWidth > width) scale = Math.max(0.5, width / maxWidth);
        }
    }
    if (rows.length > unit.origins.length || rows.some(r => r.reduce((n, t) => n + t.width * scale, 0) > width + 0.5))
        warnings.add("Some replacement text extends beyond its original box. Review the preview before downloading.");
    return { unit, rows, scale, fallback };
}

function sampledBackground(pixmap, rect) {
    const samples = new Map(), pixels = pixmap.getPixels(), stride = pixmap.getStride(), n = pixmap.getNumberOfComponents();
    const [x0, y0, x1, y1] = rect.map(Math.round);
    function sample(x, y) {
        x -= pixmap.getX(); y -= pixmap.getY();
        if (x < 0 || y < 0 || x >= pixmap.getWidth() || y >= pixmap.getHeight()) return;
        const i = y * stride + x * n, rgb = [pixels[i], pixels[i + 1], pixels[i + 2]].map(v => Math.floor(v / 8) * 8 + 4);
        const key = rgb.join(","); samples.set(key, (samples.get(key) || 0) + 1);
    }
    const step = Math.max(2, Math.ceil(((x1 - x0) + (y1 - y0)) / 100));
    for (let x = x0; x < x1; x += step) { sample(x, y0 - 2); sample(x, y1 + 2); }
    for (let y = y0; y < y1; y += step) { sample(x0 - 2, y); sample(x1 + 2, y); }
    const key = [...samples].sort((a, b) => b[1] - a[1])[0]?.[0];
    return key ? key.split(",").map(v => Math.min(1, Number(v) / 255)) : [1, 1, 1];
}

const intersection = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const area = r => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);

function excludeRects(rect, protectedRects) {
    let regions = [rect];
    for (const other of protectedRects) {
        regions = regions.flatMap(region => {
            const overlap = intersection(region, other);
            if (!area(overlap)) return [region];
            const [x0, y0, x1, y1] = region, [left, top, right, bottom] = overlap;
            return [[x0, y0, x1, top], [x0, bottom, x1, y1],
                [x0, top, left, bottom], [right, top, x1, bottom]].filter(r => area(r) > 0);
        });
    }
    return regions;
}

function planRemoval(plans, characters) {
    const selected = new Set(plans.flatMap(p => p.unit.tokens));
    // MuPDF removes a whole character when ANY part of its font box intersects
    // a redaction. Adjacent lines' boxes often overlap despite separate ink.
    const protectedRects = characters.filter(c => !selected.has(c)).map(c =>
        [c.rect[0] - 0.05, c.rect[1] - 0.05, c.rect[2] + 0.05, c.rect[3] + 0.05]);
    for (const plan of plans) {
        const nearby = protectedRects.filter(r => area(intersection(r, plan.unit.bbox)) > 0);
        plan.coverRects = plan.unit.rects.flatMap(r => excludeRects(r, nearby));
        plan.removalRects = plan.unit.tokens.filter(t => t.rect && area(t.rect) > 0).map(token => {
            const regions = plan.coverRects.map(r => intersection(r, token.rect)).filter(r => area(r) > 0);
            const rect = regions.sort((a, b) => area(b) - area(a))[0];
            if (!rect) throw new Error("This text overlaps other text too closely to edit safely.");
            // A small interior rectangle is enough to remove this glyph, without
            // touching any unselected character, including the line above/below.
            const dx = (rect[2] - rect[0]) / 4, dy = (rect[3] - rect[1]) / 4;
            return [rect[0] + dx, rect[1] + dy, rect[2] - dx, rect[3] - dy];
        });
    }
}

function overlayPdf(bounds, plans, background) {
    const buffer = new mupdf.Buffer(), writer = new mupdf.DocumentWriter(buffer, "pdf", "compress");
    const device = writer.beginPage(bounds), originalFonts = new Map();
    try {
        for (const plan of plans) {
            const glyphBounds = [];
            const stops = [];
            let offset = 0;
            if (background) for (const rect of plan.coverRects) {
                const path = new mupdf.Path();
                try { path.rect(...rect); device.fillPath(path, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, sampledBackground(background, rect), 1); }
                finally { path.destroy(); }
            }
            plan.rows.forEach((row, index) => {
                let x = index === 0 ? plan.unit.origins[0][0] : Math.min(...plan.unit.origins.map(p => p[0]));
                const y = plan.unit.origins[0][1] + index * plan.unit.pitch * plan.scale;
                const rowBounds = [];
                const rowStops = [];
                if (row.length) offset = row[0].offset;
                rowStops.push({ offset, x, baseline: y, row: index });
                for (const token of row) {
                    if (!/\s/.test(token.c)) {
                        const text = new mupdf.Text(), size = token.style.size * plan.scale;
                        try {
                            text.showGlyph(token.font, [size, 0, 0, -size, x, y], token.glyph, token.c.codePointAt(0));
                            if (token.originalType1) {
                                if (!originalFonts.has(token.originalType1)) originalFonts.set(token.originalType1, new Map());
                                originalFonts.get(token.originalType1).set(token.glyph, token.code);
                            }
                            device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, token.style.color, 1);
                            const rect = text.getBounds(null, mupdf.Matrix.identity);
                            glyphBounds.push(rect); rowBounds.push(rect);
                        } finally { text.destroy(); }
                    }
                    x += token.width * plan.scale;
                    offset = token.offset + token.c.length;
                    rowStops.push({ offset, x, baseline: y, row: index });
                }
                const rect = rowBounds.length ? union(rowBounds) : [x, y - plan.unit.main.size * plan.scale * 0.8, x, y + plan.unit.main.size * plan.scale * 0.2];
                stops.push(...rowStops.map(stop => ({ ...stop, top: rect[1], bottom: rect[3] })));
                offset++; // Explicit newline between rows in line/span mode.
            });
            plan.displayBounds = glyphBounds.length ? union(glyphBounds) : undefined;
            plan.layout = { stops, bounds: plan.displayBounds || plan.unit.bbox, pitch: plan.unit.pitch * plan.scale };
        }
        writer.endPage(); writer.close();
        const overlay = new mupdf.PDFDocument(buffer);
        try { restoreOriginalType1Fonts(overlay, originalFonts); return overlay; }
        catch (error) { overlay.destroy(); throw error; }
    } finally { device.destroy(); writer.destroy(); buffer.destroy(); }
}

function restoreOriginalType1Fonts(overlay, originalFonts) {
    if (!originalFonts.size) return;
    const page = overlay.loadPage(0), object = page.getObject(), fonts = object.get("Resources", "Font");
    const graft = overlay.newGraftMap(), temporaries = [], encodings = new Map();
    const keep = value => { temporaries.push(value); return value; };
    try {
        fonts.forEach((font, name) => {
            const base = font.get("BaseFont");
            try {
                for (const [original, codes] of originalFonts) {
                    const originalName = keep(original.resource.get("BaseFont"));
                    if (base.asName() !== originalName.asName()) continue;
                    fonts.put(name, keep(graft.graftObject(original.resource))); encodings.set(name, codes); break;
                }
            } finally { base.destroy(); font.destroy(); }
        });
        if (encodings.size < originalFonts.size) throw new Error("The PDF could not be processed. Try a different file.");
        const contents = keep(object.get("Contents"));
        const streams = contents.isArray() ? Array.from({ length: contents.length }, (_, i) => keep(contents.get(i))) : [contents];
        let encoding;
        for (const stream of streams) {
            const data = stream.readStream();
            try {
                // Only rewrite our PDF device's generated Tf/hex text operands,
                // never the source PDF's content. Keep the glyph drawing order.
                const commands = data.asString().replace(/\/(F\d+)\s+[+-]?[\d.]+\s+Tf|<([\da-f]*)>/gi, (match, name, hex) => {
                    if (name) { encoding = encodings.get(name); return match; }
                    if (!encoding) return match;
                    if (hex.length % 4) throw new Error("The PDF could not be processed. Try a different file.");
                    const codes = hex.match(/.{4}/g)?.map(glyph => encoding.get(parseInt(glyph, 16))) || [];
                    if (codes.some(code => !code)) throw new Error("The PDF could not be processed. Try a different file.");
                    return `<${codes.join("")}>`;
                });
                stream.writeStream(commands);
            } finally { data.destroy(); }
        }
    } finally {
        for (const object of temporaries.reverse()) object.destroy();
        graft.destroy(); fonts.destroy(); object.destroy(); page.destroy();
    }
}

// Isolate generated fonts/resources in a Form XObject, and map display coordinates
// back to PDF coordinates (including crop boxes and page rotation).
function appendOverlay(doc, page, overlay) {
    const overlayPage = overlay.loadPage(0), graft = doc.newGraftMap();
    const temporaries = [];
    const keep = object => { temporaries.push(object); return object; };
    try {
        const object = keep(page.getObject()), overlayObject = keep(overlayPage.getObject());
        const contents = keep(overlayObject.get("Contents")), stream = new mupdf.Buffer();
        try {
            const list = contents.isArray() ? Array.from({ length: contents.length }, (_, i) => keep(contents.get(i))) : [contents];
            for (const entry of list) { const data = entry.readStream(); try { stream.writeBuffer(data); stream.write("\n"); } finally { data.destroy(); } }
            const form = keep(doc.addStream(stream, { Type: "XObject", Subtype: "Form",
                BBox: keep(overlayObject.get("MediaBox")).asJS(), Resources: keep(graft.graftObject(keep(overlayObject.getInheritable("Resources")))) }));
            // Copy inherited dictionaries so siblings never acquire our overlay.
            const resources = keep(doc.newDictionary()), existing = keep(object.getInheritable("Resources"));
            existing.forEach((v, k) => { resources.put(k, v); v.destroy(); });
            const xobjects = keep(doc.newDictionary()), previous = keep(existing.get("XObject"));
            if (!previous.isNull()) previous.forEach((v, k) => { xobjects.put(k, v); v.destroy(); });
            let name = "ShipToolkitText";
            while (true) { const value = xobjects.get(name); const unused = value.isNull(); value.destroy(); if (unused) break; name += "X"; }
            xobjects.put(name, form); resources.put("XObject", xobjects); object.put("Resources", resources);
            const matrix = mupdf.Matrix.concat(overlayPage.getTransform(), mupdf.Matrix.invert(page.getTransform()));
            const prefix = keep(doc.addStream("q\n", {})), suffix = keep(doc.addStream(`Q\nq ${matrix.join(" ")} cm /${name} Do Q\n`, {}));
            const original = keep(object.get("Contents")), array = keep(doc.newArray());
            array.push(prefix);
            if (original.isArray()) for (let i = 0; i < original.length; i++) array.push(keep(original.get(i)));
            else if (!original.isNull()) array.push(original);
            array.push(suffix); object.put("Contents", array);
        } finally { stream.destroy(); }
    } finally { for (const object of temporaries.reverse()) object.destroy(); graft.destroy(); overlayPage.destroy(); }
}

export function applyEdits(bytes, edits, options = {}) {
    const doc = openPdf(bytes, options.password), warnings = new Set();
    const editBounds = [], editLayouts = [];
    const fallbacks = new Map();
    let userFont;
    try {
        if (options.fontBytes) { userFont = new mupdf.Font("UserFallback", options.fontBytes); options = { ...options, userFont }; }
        const pages = new Map();
        for (const edit of edits) {
            if (!Number.isInteger(edit.page) || edit.page < 0 || edit.page >= doc.countPages()) throw new Error("Invalid edit page.");
            if (!pages.has(edit.page)) pages.set(edit.page, []);
            pages.get(edit.page).push(edit);
        }
        for (const [index, items] of pages) {
            const page = doc.loadPage(index), extracted = readUnits(page, options.mode || "line");
            let overlay, background, type1;
            try {
                type1 = originalType1Fonts(page);
                if (page.getAnnotations().some(a => a.getType() === "Redact"))
                    throw new Error("This page has pending redactions. Apply or remove them in your PDF application before editing text.");
                const seen = new Set();
                const plans = items.map(edit => {
                    const unit = extracted.units[edit.id];
                    if (!unit || seen.has(edit.id)) throw new Error("Invalid or duplicate text selection.");
                    seen.add(edit.id);
                    return planReplacement(unit, edit.value, options, fallbacks, warnings, type1.fonts);
                });
                planRemoval(plans, extracted.characters);
                if (options.cover) background = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, false);
                overlay = overlayPdf(page.getBounds(), plans, background);
                for (const plan of plans) if (plan.displayBounds)
                    editBounds.push({ page: index, id: plan.unit.id, bounds: plan.displayBounds });
                for (const plan of plans) editLayouts.push({ page: index, id: plan.unit.id, layout: plan.layout });
                for (const plan of plans) {
                    if (!plan.removalRects.length) continue;
                    const annotation = page.createAnnotation("Redact");
                    try { annotation.setQuadPoints(plan.removalRects.map(([x0, y0, x1, y1]) => [x0, y0, x1, y0, x0, y1, x1, y1])); }
                    finally { annotation.destroy(); }
                }
                page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
                appendOverlay(doc, page, overlay);
                if (plans.some(p => p.fallback)) warnings.add("Some new characters use a fallback font because the original embedded font lacks those glyphs.");
            } finally { overlay?.destroy(); background?.destroy(); type1?.destroy(); extracted.destroy(); page.destroy(); }
        }
        return { doc, warnings: [...warnings], editBounds, editLayouts };
    } catch (error) { doc.destroy(); throw error; }
    finally { for (const font of fallbacks.values()) font.destroy(); userFont?.destroy(); }
}

export function parsePageRange(value, count) {
    if (!value.trim()) return Array.from({ length: count }, (_, i) => i);
    const pages = new Set();
    for (const part of value.split(/[,，]/)) {
        const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+)?)?$/);
        if (!match) throw new Error("Use page ranges such as 1-3, 5, 8-.");
        const first = Number(match[1]), last = part.includes("-") ? Number(match[2] || count) : first;
        if (first < 1 || last > count || last < first) throw new Error("The page range is outside this PDF.");
        for (let i = first; i <= last; i++) pages.add(i - 1);
    }
    return [...pages];
}

export function replacementFunction(find, replacement, { regex = false, caseSensitive = false } = {}) {
    if (!find) throw new Error("Enter text to find.");
    const escaped = regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let pattern;
    try { pattern = new RegExp(escaped, caseSensitive ? "g" : "gi"); }
    catch { throw new Error("Enter a valid regular expression."); }
    return text => regex ? text.replace(pattern, replacement) : text.replace(pattern, () => replacement);
}

export function editedPdfName(name) { return `${name.replace(/\.pdf$/i, "") || "document"}-edited.pdf`; }
