// Optional browser regression check; configure PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";
import { openPdf } from "../pdf-tools/edit-text/pdf-text-editor.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = (process.argv[2] || "http://127.0.0.1:8011").replace(/\/$/, "");
const outputDir = await fs.mkdtemp(path.join(tmpdir(), "pdf-text-format-"));
const pdf = await PDFDocument.create(), sourcePage = pdf.addPage([500, 640]);
sourcePage.drawText("Format this string", { x: 180, y: 500, size: 16 });
sourcePage.drawText("Keep this line", { x: 40, y: 550, size: 16 });
const source = path.join(outputDir, "input.pdf");
await fs.writeFile(source, await pdf.save());
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const idle = () => page.waitForFunction(() => document.querySelector("#text-editor").getAttribute("aria-busy") === "false");
    const input = page.locator("#inline-text"), size = page.locator("#text-size");
    const begin = async () => {
        await page.getByRole("button", { name: "Edit text: Format this string", exact: true }).click();
        await idle(); await input.waitFor({ state: "visible" });
    };
    const download = async name => {
        const [file] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
        const filename = path.join(outputDir, name);
        await file.saveAs(filename); await idle();
        const document = openPdf(new Uint8Array(await fs.readFile(filename))), loaded = document.loadPage(0);
        const text = loaded.toStructuredText(), chars = [];
        try {
            text.walk({ onChar(c, origin, font, size, quad, color) {
                chars.push({ c, origin, size, color, name: font.getName(), bold: font.isBold(), italic: font.isItalic() }); font.destroy();
            } });
            assert.match(text.asText(), /Keep this line/);
            return chars;
        } finally { text.destroy(); loaded.destroy(); document.destroy(); }
    };
    await page.goto(origin); await idle();
    assert.equal(await size.isDisabled(), true);
    await page.locator("#file").setInputFiles(source);
    await page.waitForFunction(() => document.querySelectorAll(".text-editor-box").length === 2); await idle();
    await page.locator("#zoom").selectOption("1"); await idle();
    await page.locator("#fit").check(); await idle();
    await begin();
    assert.equal(await size.inputValue(), "16");
    assert.equal(await page.locator("#text-align select").count(), 0);
    await page.locator("#text-bold-italic").click();
    for (const key of ["bold", "italic", "bold-italic"]) assert.equal(await page.locator("#text-" + key).getAttribute("aria-pressed"), "true");
    await page.locator("#text-bold").click();
    assert.equal(await page.locator("#text-bold-italic").getAttribute("aria-pressed"), "false");
    assert.equal(await page.locator("#text-italic").getAttribute("aria-pressed"), "true");
    await page.locator("#text-bold-italic").click();
    await page.locator("#text-bold-italic").click();
    for (const key of ["bold", "italic", "bold-italic"]) assert.equal(await page.locator("#text-" + key).getAttribute("aria-pressed"), "false");
    await page.locator("#text-format-reset").click();
    await size.fill("0"); await size.press("Enter");
    assert.equal(await input.isVisible(), true, "invalid sizes must not commit a draft");
    await size.fill("16"); await input.fill("A much longer string that would otherwise shrink");
    const sourceSized = (await download("explicit-source-size.pdf")).filter(char => Math.abs(char.origin[1] - 140) < 0.1);
    assert.ok(sourceSized.length > 20 && sourceSized.every(char => Math.abs(char.size - 16) < 0.01),
        "explicitly choosing the source size must also override auto-shrink");
    await page.locator("#undo").click(); await idle(); await begin();
    await size.fill("24");
    assert.equal(await input.isVisible(), true, "clicking formatting controls must retain the selection");
    assert.equal(await page.locator("#download").isDisabled(), false, "a format-only draft must enable download");
    await page.locator("#text-font").selectOption("serif");
    for (const key of ["bold", "italic", "underline", "strike"]) await page.locator("#text-" + key).click();
    await page.locator("#text-color").evaluate(el => { el.value = "#336699"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#text-letter-spacing").fill("1.5");
    await page.locator("#text-line-spacing").fill("1.5");
    await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector("#inline-text").style.lineHeight) - 43.2) < 0.01);
    await page.screenshot({ path: path.join(outputDir, "format-desktop.png"), fullPage: true });
    const styled = (await download("formatted.pdf")).filter(char => Math.abs(char.origin[1] - 140) < 0.1);
    assert.equal(styled.map(char => char.c).join(""), "Format this string");
    for (const char of styled) {
        assert.ok(Math.abs(char.size - 24) < 0.01); assert.equal(char.bold, true); assert.equal(char.italic, true);
        char.color.forEach((v, i) => assert.ok(Math.abs(v - [0.2, 0.4, 0.6][i]) < 0.01));
    }
    await begin();
    assert.equal(await size.inputValue(), "24");
    assert.equal(await page.locator("#text-font").inputValue(), "serif");
    assert.equal(await page.locator("#text-color").inputValue(), "#336699");
    assert.equal(await page.locator("#text-underline").getAttribute("aria-pressed"), "true");
    await size.fill("30"); await size.press("Escape"); await idle();
    await begin(); assert.equal(await size.inputValue(), "24", "Cancel must restore saved formatting");
    await input.press("Escape"); await idle();
    await page.locator("#find-title").click();
    for (const [find, replacement] of [["Format this string", "Another string"], ["Another string", "Format this string"]]) {
        await page.locator("#find").fill(find); await page.locator("#replace-with").fill(replacement);
        await page.locator("#find-form button").click(); await idle();
    }
    await begin(); assert.equal(await size.inputValue(), "24", "searching back to source text must retain formatting");
    await input.press("Escape"); await idle();
    for (let i = 0; i < 2; i++) { await page.locator("#undo").click(); await idle(); }
    await begin();
    await input.fill("First row\nSecond row");
    await page.locator("#inline-move").focus(); await page.locator("#inline-move").press("Shift+ArrowDown");
    await input.press("Enter"); await idle();
    const multiline = await download("formatted-moved.pdf");
    const first = multiline.find(char => char.c === "F"), second = multiline.find(char => char.c === "S");
    assert.ok(Math.abs(first.origin[1] - 150) < 0.01);
    assert.ok(Math.abs(second.origin[1] - first.origin[1] - 43.2) < 0.01, "line spacing must scale with font size");
    await begin(); await page.locator("#text-format-reset").click();
    assert.equal(await input.inputValue(), "First row\nSecond row", "Reset formatting must retain text");
    await input.press("Enter"); await idle();
    const reset = await download("format-reset.pdf"), resetFirst = reset.find(char => char.c === "F");
    assert.ok(Math.abs(resetFirst.size - 16) < 0.01 && Math.abs(resetFirst.origin[1] - 150) < 0.01,
        "Reset formatting must retain movement");
    await page.locator("#undo").click(); await idle(); await begin();
    assert.equal(await size.inputValue(), "24", "Undo must restore formatting");
    await input.press("Escape"); await idle();
    for (let i = 0; i < 2; i++) { await page.locator("#undo").click(); await idle(); }
    assert.equal(await page.locator("#download").isDisabled(), true);
    await begin(); await size.fill("22"); await page.locator("#text-format-reset").click();
    assert.equal(await page.locator("#download").isDisabled(), true, "resetting the only format draft must leave no edits");
    await input.press("Escape"); await idle();
    const alignmentOrigins = [];
    for (const align of ["left", "center", "right"]) {
        await begin(); await input.fill("AB"); await page.locator("#text-align-" + align).click();
        for (const other of ["left", "center", "right"]) assert.equal(await page.locator("#text-align-" + other).getAttribute("aria-pressed"), String(other === align));
        const chars = await download(`align-${align}.pdf`);
        alignmentOrigins.push(chars.find(char => char.c === "A").origin[0]);
        await begin(); assert.equal(await page.locator("#text-align-" + align).getAttribute("aria-pressed"), "true");
        await input.press("Escape"); await idle();
    }
    assert.ok(alignmentOrigins[0] < alignmentOrigins[1] && alignmentOrigins[1] < alignmentOrigins[2]);
    assert.ok(Math.abs(2 * alignmentOrigins[1] - alignmentOrigins[0] - alignmentOrigins[2]) < 0.01);
    await page.locator("#reset").click(); await idle();
    for (const [family, expected] of [["arial", /LiberationSans/], ["times-new-roman", /LiberationSerif/],
        ["courier-new", /Cousine/], ["lato", /Lato/], ["crimson", /Crimson\s?Text/]]) {
        await begin(); await page.locator("#text-font").selectOption(family);
        await page.locator("#text-bold-italic").click();
        const chars = (await download(`font-${family}.pdf`)).filter(char => Math.abs(char.origin[1] - 140) < 0.1);
        assert.equal(chars.map(char => char.c).join(""), "Format this string");
        for (const char of chars) { assert.match(char.name, expected); assert.equal(char.bold, true); assert.equal(char.italic, true); }
        await begin(); assert.equal(await page.locator("#text-font").inputValue(), family);
        await input.press("Escape"); await idle();
        await page.locator("#reset").click(); await idle();
    }
    for (const [family, canBold] of [["michroma", false], ["orbitron", true]]) {
        await begin(); await page.locator("#text-bold-italic").click();
        await page.locator("#text-font").selectOption(family);
        assert.equal(await page.locator("#text-bold").isDisabled(), !canBold);
        assert.equal(await page.locator("#text-italic").isDisabled(), true);
        assert.equal(await page.locator("#text-bold-italic").isDisabled(), true);
        assert.equal(await page.locator("#text-italic").getAttribute("aria-pressed"), "false");
        const chars = (await download(`font-${family}.pdf`)).filter(char => Math.abs(char.origin[1] - 140) < 0.1);
        assert.equal(chars.map(char => char.c).join(""), "Format this string");
        for (const char of chars) {
            assert.match(char.name.toLowerCase(), new RegExp(family));
            assert.equal(char.bold, canBold); assert.equal(char.italic, false);
        }
        await begin(); assert.equal(await page.locator("#text-font").inputValue(), family);
        await page.locator("#text-font").selectOption("arial");
        assert.equal(await page.locator("#text-italic").isDisabled(), false, "switching font families must restore supported style controls");
        await input.press("Escape"); await idle();
        await page.locator("#reset").click(); await idle();
    }
    // Match Annotate PDF's sticky settings, including short-screen scrolling.
    const settings = page.locator(".text-editor-sidebar-content");
    await page.setViewportSize({ width: 1440, height: 650 });
    await page.evaluate(() => {
        const layout = document.querySelector(".text-editor-layout");
        window.scrollTo({ top: layout.getBoundingClientRect().top + window.scrollY + 120, behavior: "instant" });
    });
    await page.waitForFunction(() => Math.abs(document.querySelector(".text-editor-sidebar-content").getBoundingClientRect().top - 12) < 1);
    const sidebar = await settings.boundingBox(), paper = await page.locator("#paper").boundingBox();
    assert.ok(sidebar.x >= paper.x + paper.width, "pinned settings must remain to the right of the PDF");
    await page.locator("#viewport").evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert.ok(Math.abs((await settings.boundingBox()).y - 12) < 1, "scrolling to the PDF's bottom must keep settings visible");
    await page.setViewportSize({ width: 1440, height: 400 });
    await page.waitForFunction(() => document.querySelector(".text-editor-sidebar-content").clientHeight <= 376);
    assert.equal(await settings.evaluate(el => el.scrollHeight > el.clientHeight), true);
    await settings.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const lastControl = await page.locator("#find-form button").boundingBox();
    assert.ok(lastControl.y >= 12 && lastControl.y + lastControl.height <= 400, "the last control must remain reachable on short screens");
    await page.screenshot({ path: path.join(outputDir, "sticky-formatting.png"), fullPage: false });
    await settings.evaluate(el => { el.scrollTop = 0; });
    await page.locator("#viewport").evaluate(el => { el.scrollTop = 0; });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await settings.evaluate(el => getComputedStyle(el).position), "static", "mobile settings must keep the stacked layout");
    await page.locator("#zoom").selectOption("fit"); await idle();
    await begin(); await size.fill("18"); await page.locator("#text-underline").click();
    await page.waitForFunction(() => {
        const paperScale = document.querySelector("#paper").getBoundingClientRect().width / 500;
        return Math.abs(parseFloat(document.querySelector("#inline-text").style.lineHeight) - 21.6 * paperScale) < 0.01;
    });
    assert.equal(await input.isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(outputDir, "format-mobile.png"), fullPage: true });
    await input.press("Enter"); await idle();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ wholeStringFormatting: true, export: true, cancelUndoReset: true, searchPreservesFormat: true, stickySettings: true, desktopAndMobile: true, outputDir }));
} finally { await browser.close(); }
