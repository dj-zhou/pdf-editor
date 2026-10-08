// Optional browser regression check. Configure an existing Playwright installation
// or system Chrome with PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE.
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import lib from "pdf-lib";
import { openPdf } from "../pdf-tools/edit-text/pdf-text-editor.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = (process.argv[2] || "http://127.0.0.1:8000").replace(/\/$/, "");
const outputDir = await fs.mkdtemp(path.join(tmpdir(), "shiptoolkit-editor-smoke-"));
const output = name => path.join(outputDir, name);
const doc = await lib.PDFDocument.create();
for (let i = 0; i < 2; i++) {
    const page = doc.addPage([360, 480]);
    page.drawRectangle({ x: 20, y: 310, width: 320, height: 80, color: lib.rgb(0.94, 0.9, 0.82) });
    page.drawText("Original text", { x: 40, y: 350, size: 16 });
    page.drawText("Keep this line", { x: 40, y: 310, size: 16 });
}
await fs.writeFile(output("input.pdf"), await doc.save());
const tightDoc = await lib.PDFDocument.create(), tightPage = tightDoc.addPage([360, 480]);
tightPage.drawText("10/03/2026", { x: 40, y: 350, size: 16 });
tightPage.drawText("0 lb 15 oz", { x: 40, y: 334, size: 16 });
tightPage.drawLine({ start: { x: 30, y: 328 }, end: { x: 300, y: 328 }, thickness: 1 });
await fs.writeFile(output("tight-lines.pdf"), await tightDoc.save());
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE, headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", () => { throw new Error("Replacement must use the styled page dialog, not a browser alert."); });
    page.on("request", request => requests.push({ url: request.url(), method: request.method() }));
    const idle = async () => {
        try {
            await page.waitForFunction(() => document.querySelector("#text-editor").getAttribute("aria-busy") === "false");
        } catch (error) {
            throw new Error(`Editor did not become idle; browser errors: ${errors.join("; ")}`, { cause: error });
        }
    };
    const editsPresent = present => page.waitForFunction(present => document.querySelector("#reset").disabled === !present, present);
    const confirmReplacement = async (action, accept) => {
        await action();
        const dialog = page.locator("#open-dialog");
        await dialog.waitFor({ state: "visible" });
        assert.equal(await page.locator("#open-dialog-message").textContent(), "Opening another PDF will discard your current edits. Continue?");
        assert.equal(await dialog.evaluate(el => el.matches(":modal")), true);
        await page.locator(accept ? "#open-dialog-confirm" : "#open-dialog-cancel").click();
        await dialog.waitFor({ state: "hidden" });
    };
    const begin = async text => {
        await page.getByRole("button", { name: `Edit text: ${text}`, exact: true }).click();
        await idle();
        await page.waitForFunction(() => document.activeElement === document.querySelector("#inline-text"));
    };
    await page.goto(`${origin}/`);
    await idle();
    const fileTransfer = async (filePath, name = path.basename(filePath), type = "application/pdf") => page.evaluateHandle(
        ({ bytes, name, type }) => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
            return transfer;
        }, { bytes: Array.from(await fs.readFile(filePath)), name, type });
    const sourceTransfer = await fileTransfer(output("input.pdf"));
    assert.equal(await page.locator("#empty .pdf-drop-zone").isVisible(), true);
    await page.locator("#viewport").dispatchEvent("dragenter", { dataTransfer: sourceTransfer });
    await page.locator("#empty strong").dispatchEvent("dragenter", { dataTransfer: sourceTransfer });
    await page.locator("#empty strong").dispatchEvent("dragleave", { dataTransfer: sourceTransfer });
    assert.equal(await page.locator("#text-editor").evaluate(el => el.classList.contains("is-dragging")), true,
        "moving over children must retain the file-drag highlight");
    await page.locator("#viewport").dispatchEvent("dragleave", { dataTransfer: sourceTransfer });
    assert.equal(await page.locator("#text-editor").evaluate(el => el.classList.contains("is-dragging")), false);
    await page.locator("#viewport").dispatchEvent("dragenter", { dataTransfer: sourceTransfer });
    await page.screenshot({ path: output("drag-drop-empty.png"), fullPage: true });
    await page.locator("#empty strong").dispatchEvent("drop", { dataTransfer: sourceTransfer });
    await sourceTransfer.dispose();
    await page.waitForFunction(() => document.querySelectorAll(".text-editor-box").length === 2 && !document.querySelector("#next").disabled, null, { timeout: 15000 });
    await idle();
    assert.equal(await page.locator("#text-editor").evaluate(el => el.classList.contains("is-dragging")), false);
    assert.equal(await page.locator("#empty").isVisible(), false);
    const invalidTransfer = await fileTransfer(output("input.pdf"), "image.png", "image/png");
    await page.locator("#canvas").dispatchEvent("drop", { dataTransfer: invalidTransfer });
    await invalidTransfer.dispose();
    assert.equal(await page.locator("#status").count(), 0, "the bottom message area must be removed");
    assert.equal(await page.locator(".text-editor-box").count(), 2, "invalid drops must preserve the open PDF");
    assert.equal(await page.locator("#replacement, #selection-form").count(), 0, "there must be no external replacement text box");
    assert.equal(await page.locator("#password, #mode").count(), 0, "password and editing mode controls must be removed");
    assert.equal(await page.locator("#font, #font-info").count(), 0, "custom fallback font controls must be removed");
    assert.equal(await page.locator(".text-editor-find summary").count(), 0, "find and replace must not be collapsible");
    assert.equal(await page.locator("#find").isVisible(), true, "find and replace must be permanently visible");
    assert.equal(await page.locator("#edit-count").count(), 0, "edit counts must be removed");
    assert.equal(await page.locator(".text-editor-toolbar #fit, .text-editor-toolbar #cover").count(), 2,
        "both editing options must be in the top toolbar");
    assert.equal(await page.locator("#download").isDisabled(), true, "download stays disabled until the PDF is edited");
    const originalBox = await page.locator('.text-editor-box[data-id="0"]').boundingBox();

    await begin("Original text");
    const input = page.locator("#inline-text");
    assert.equal(await input.inputValue(), "Original text");
    const geometry = await page.evaluate(() => {
        const input = document.querySelector("#inline-text");
        const inputRect = input.getBoundingClientRect();
        const target = document.querySelector('.text-editor-box[data-id="0"]').getBoundingClientRect();
        return { insidePaper: document.querySelector("#paper").contains(input), x: Math.abs(inputRect.left - target.left), y: Math.abs(inputRect.top - target.top), height: target.height };
    });
    assert.ok(geometry.insidePaper && geometry.x < 2 && geometry.y < geometry.height / 2, "input must align with PDF text on the page");
    // Escape discards the draft, and IME Enter must not submit it.
    await input.fill("Canceled draft");
    assert.equal(await page.locator("#download").isDisabled(), false, "an active draft must enable download");
    assert.notEqual(await page.locator("#download").evaluate(button => getComputedStyle(button).backgroundImage), "none",
        "download must become bright when editing");
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true, bubbles: true });
    assert.equal(await page.locator("#inline-editor").isVisible(), true);
    await input.press("Escape");
    await idle(); await editsPresent(false);
    assert.equal(await page.locator("#download").isDisabled(), true, "canceling the only draft must disable download");
    assert.equal(await page.locator("#inline-editor").isVisible(), false);

    // An unchanged document opens the picker immediately. A draft prompts
    // before the picker, and canceling must preserve the draft and current PDF.
    let pickerCount = 0;
    page.on("filechooser", () => pickerCount++);
    const [cleanPicker] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#open").click()]);
    await cleanPicker.setFiles(output("input.pdf"));
    await idle();
    await begin("Original text"); await input.fill("Protected draft");
    await confirmReplacement(() => page.locator("#open").click(), false);
    assert.equal(pickerCount, 1, "canceling must not open the file picker");
    assert.equal(await input.inputValue(), "Protected draft");
    assert.equal(await page.locator("#inline-editor").isVisible(), true);
    await page.locator("#open").click();
    await page.locator("#open-dialog").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#open-dialog").waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), "Protected draft", "Escape must cancel without losing the draft");
    assert.equal(pickerCount, 1);
    const protectedTransfer = await fileTransfer(output("tight-lines.pdf"));
    await confirmReplacement(() => page.locator("#canvas").dispatchEvent("drop", { dataTransfer: protectedTransfer }), false);
    await protectedTransfer.dispose();
    assert.equal(await input.inputValue(), "Protected draft", "canceling a drop must preserve the draft");
    const acceptedPicker = page.waitForEvent("filechooser");
    await confirmReplacement(() => page.locator("#open").click(), true);
    await (await acceptedPicker).setFiles(output("input.pdf"));
    await page.waitForFunction(() => document.querySelector("#inline-editor").hidden);
    await idle(); await editsPresent(false);
    assert.equal(pickerCount, 2, "accepting must open the picker once");
    await begin("Original text"); await input.fill("Draft before an accepted drop");
    const acceptedTransfer = await fileTransfer(output("input.pdf"));
    await confirmReplacement(() => page.locator("#canvas").dispatchEvent("drop", { dataTransfer: acceptedTransfer }), true);
    await acceptedTransfer.dispose();
    await idle(); await editsPresent(false);
    assert.equal(await page.locator("#inline-editor").isVisible(), false);

    await begin("Original text");
    await input.fill("Replaced in browser");
    await page.screenshot({ path: output("desktop-inline.png"), fullPage: true });
    await input.press("Enter");
    await idle(); await editsPresent(true);
    const editedBox = await page.locator('.text-editor-box[data-id="0"]').boundingBox();
    assert.ok(editedBox.width > originalBox.width + 20, "the edited outline must expand to cover longer text");
    await page.screenshot({ path: output("desktop-edited-outline.png"), fullPage: true });
    await page.locator('.text-editor-box[data-id="0"]').click({ position: { x: editedBox.width - 3, y: editedBox.height / 2 } });
    await idle();
    assert.equal(await input.inputValue(), "Replaced in browser", "clicking the expanded outline must reopen the same edited unit");
    await input.press("Escape"); await idle();
    assert.equal(await page.locator("#inline-editor").isVisible(), false);
    await begin("Original text");
    await input.fill("Original text");
    assert.equal(await page.locator("#download").isDisabled(), true, "reverting the only edit must disable download");
    await input.press("Escape"); await idle();
    assert.equal(await page.locator("#download").isDisabled(), false, "canceling a reversion restores the saved edit");

    // Switching between text boxes commits the first draft and opens the next.
    await begin("Keep this line");
    await input.fill("Keep this edited line");
    await page.getByRole("button", { name: "Edit text: Original text", exact: true }).click();
    await idle(); await editsPresent(true);
    assert.equal(await input.inputValue(), "Replaced in browser");
    await input.press("Escape"); await idle();
    await page.locator("#undo").click(); await idle(); await editsPresent(true);

    // Clicking the page away from the inline input saves the text.
    await begin("Keep this line");
    await input.fill("Click-away saved");
    await page.locator("#viewport").click({ position: { x: 8, y: 8 } });
    await idle(); await editsPresent(true);
    assert.equal(await page.locator("#inline-editor").isVisible(), false);
    await page.locator("#undo").click(); await idle(); await editsPresent(true);

    await page.locator("#next").click(); await idle();
    await page.locator("#find").fill("Original");
    await page.locator("#replace-with").fill("Changed");
    await page.getByRole("button", { name: "Replace all", exact: true }).click();
    await idle(); await editsPresent(true);

    // Export must include the draft even when Enter has not been pressed.
    await begin("Original text");
    await input.fill("Downloaded draft");
    const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        page.locator("#download").click()
    ]);
    await download.saveAs(output("browser-output.pdf"));
    const result = openPdf(new Uint8Array(await fs.readFile(output("browser-output.pdf"))));
    try {
        for (let i = 0; i < 2; i++) {
            const pdfPage = result.loadPage(i), text = pdfPage.toStructuredText();
            try {
                assert.match(text.asText(), i === 0 ? /Replaced in browser/ : /Downloaded draft/);
                assert.match(text.asText(), /Keep this line/);
                assert.doesNotMatch(text.asText(), /Original text/);
            } finally { text.destroy(); pdfPage.destroy(); }
        }
    } finally { result.destroy(); }

    // Committed edits still prompt after download because replacing the PDF
    // discards the editing session. Cancel must keep the edited document.
    await idle();
    await confirmReplacement(() => page.locator("#open").click(), false);
    await editsPresent(true);
    assert.equal(await page.locator("#page").inputValue(), "2");

    await page.locator("#reset").click(); await idle(); await editsPresent(false);
    assert.equal(await page.locator("#download").isDisabled(), true, "reset must return download to its disabled state");
    await begin("Original text");
    await input.fill("First row"); await input.press("End"); await input.press("Shift+Enter");
    await input.pressSequentially("Second row");
    assert.equal(await input.inputValue(), "First row\nSecond row");
    assert.equal(await page.locator("#inline-editor").isVisible(), true);
    await input.press("Control+Enter"); await idle(); await editsPresent(true);
    const multilineBox = await page.locator('.text-editor-box[data-id="0"]').boundingBox();
    assert.ok(multilineBox.height > originalBox.height * 1.5, "the outline must cover all replacement lines");
    await page.locator("#reset").click(); await idle(); await editsPresent(false);

    await begin("Original text");
    await input.fill("Mobile edit");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500); await idle();
    assert.equal(await input.inputValue(), "Mobile edit", "resize must preserve the inline draft");
    assert.equal(await page.locator("#inline-editor").isVisible(), true);
    await editsPresent(false);
    await page.screenshot({ path: output("mobile-inline.png"), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, "mobile page overflows horizontally");
    await page.locator("#inline-save").click(); await idle(); await editsPresent(true);
    await page.locator("#reset").click(); await idle();

    // Closely spaced font boxes overlap. Opening the inline input temporarily
    // removes its source text; neither that preview nor export may lose the date.
    await page.setViewportSize({ width: 1440, height: 1000 });
    // File selection remains available, and dropping onto an open page replaces it.
    await page.locator("#file").setInputFiles(output("input.pdf"));
    await page.waitForFunction(() => document.querySelector("#page-count").textContent === "of 2");
    await idle();
    const replacementTransfer = await fileTransfer(output("tight-lines.pdf"));
    await page.locator("#canvas").dispatchEvent("dragenter", { dataTransfer: replacementTransfer });
    await page.locator("#canvas").dispatchEvent("drop", { dataTransfer: replacementTransfer });
    await replacementTransfer.dispose();
    await page.waitForFunction(() => document.querySelector('.text-editor-box[title="0 lb 15 oz"]'));
    await idle();
    assert.ok(await page.evaluate(() => {
        const date = document.querySelector('.text-editor-box[title="10/03/2026"]').getBoundingClientRect();
        const weight = document.querySelector('.text-editor-box[title="0 lb 15 oz"]').getBoundingClientRect();
        return weight.top > date.bottom;
    }), "the lower line's selection outline must not cover the date");
    const datePixels = () => page.evaluate(() => {
        const canvas = document.querySelector("#canvas"), scale = canvas.width / 360;
        return Array.from(canvas.getContext("2d").getImageData(Math.ceil(38 * scale), Math.ceil(117 * scale),
            Math.floor(140 * scale), Math.floor(14 * scale)).data);
    });
    const before = await datePixels();
    await begin("0 lb 15 oz");
    assert.deepEqual(await datePixels(), before, "opening the inline editor must leave the date visible");
    await input.fill("0 lbdfa 15 oz");
    await page.screenshot({ path: output("tight-lines-inline.png"), fullPage: true });
    await input.press("Enter"); await idle(); await editsPresent(true);
    assert.deepEqual(await datePixels(), before, "saving the inline edit must leave the date visible");
    await page.screenshot({ path: output("tight-lines-saved.png"), fullPage: true });
    const [tightDownload] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
    await tightDownload.saveAs(output("tight-lines-output.pdf"));
    const tightOutput = openPdf(new Uint8Array(await fs.readFile(output("tight-lines-output.pdf"))));
    const tightOutputPage = tightOutput.loadPage(0), tightText = tightOutputPage.toStructuredText();
    try {
        assert.match(tightText.asText(), /10\/03\/2026/);
        assert.match(tightText.asText(), /0 lbdfa 15 oz/);
    } finally { tightText.destroy(); tightOutputPage.destroy(); tightOutput.destroy(); }
    // pdfTeX embeds legacy Type 1 subsets. The editor preview and downloaded
    // PDF must agree, including mixed original and fallback characters.
    await page.locator("#file").setInputFiles(new URL("../tests/fixtures/latex-type1.pdf", import.meta.url).pathname);
    await page.waitForFunction(() => document.querySelector('.text-editor-box[title="Bold heading"]'));
    await idle();
    const canvasHash = () => page.evaluate(() => {
        const canvas = document.querySelector("#canvas");
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
        return hash;
    });
    const originalFontPixels = await canvasHash();
    await begin("Original text");
    assert.equal(await canvasHash(), originalFontPixels, "selecting Type 1 text must preserve its original glyphs and spacing");
    assert.equal(await input.evaluate(el => getComputedStyle(el).color), "rgba(0, 0, 0, 0)",
        "the typing surface must not draw a substitute browser font over the PDF glyphs");
    await input.fill("Original text ! Hello world");
    await page.waitForFunction(before => {
        const canvas = document.querySelector("#canvas");
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
        return hash !== before;
    }, originalFontPixels);
    const draftFontPixels = await canvasHash();
    await page.screenshot({ path: output("latex-type1-inline.png"), fullPage: true });
    await input.press("Enter"); await idle();
    assert.equal(await canvasHash(), draftFontPixels, "the live draft and committed text must use the same PDF fonts");
    await begin("Bold heading");
    await input.fill("Bold heading ! Edited"); await input.press("Enter"); await idle();
    await page.screenshot({ path: output("latex-type1-preview.png"), fullPage: true });
    const [latexDownload] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
    await latexDownload.saveAs(output("latex-type1-output.pdf")); await idle();
    const latexOutput = openPdf(new Uint8Array(await fs.readFile(output("latex-type1-output.pdf"))));
    const latexPage = latexOutput.loadPage(0), latexText = latexPage.toStructuredText(), latexObject = latexPage.getObject();
    const latexFonts = latexObject.get("Resources", "XObject", "ShipToolkitText", "Resources", "Font");
    let legacyFonts = 0;
    try {
        assert.match(latexText.asText(), /Original text ! Hello world/);
        assert.match(latexText.asText(), /Bold heading ! Edited/);
        latexFonts.forEach(font => {
            const subtype = font.get("Subtype"), program = font.get("FontDescriptor", "FontFile");
            const cidProgram = font.get("DescendantFonts", 0, "FontDescriptor", "FontFile");
            try {
                assert.equal(cidProgram.isNull(), true);
                if (subtype.asName() === "Type1" && !program.isNull()) legacyFonts++;
            } finally { subtype.destroy(); program.destroy(); cidProgram.destroy(); font.destroy(); }
        });
        assert.equal(legacyFonts, 2, "download must retain the regular and bold Type 1 fonts");
    } finally { latexFonts.destroy(); latexObject.destroy(); latexText.destroy(); latexPage.destroy(); latexOutput.destroy(); }
    assert.deepEqual(errors, []);
    assert.ok(requests.every(request => request.method === "GET" && request.url.startsWith(`${origin}/`)));
    console.log(JSON.stringify({ browser: "Chrome", dragAndDrop: true, replacementConfirmation: true, inPlaceEdit: true, enterEscapeClickAway: true, multilineAndMobile: true,
        draftIncludedInDownload: true, tightLinesPreserved: true, latexType1: true, pages: 2, errors, network: "Same-origin GETs only; no document uploads.", outputDir }));
} finally { await browser.close(); }
