// Optional end-to-end localization check; use the same Playwright settings as
// test-pdf-text-editor-browser.mjs and a running static preview server.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { LOCALES, MESSAGES } from "../locales/catalog.mjs";
import { openPdf } from "../pdf-tools/edit-text/pdf-text-editor.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = (process.argv[2] || "http://127.0.0.1:8000").replace(/\/$/, "");
const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "shiptoolkit-editor-locales-"));
const pdf = await PDFDocument.create(), sourcePage = pdf.addPage([360, 480]);
sourcePage.drawText("Original text", { x: 40, y: 350, size: 16 });
const source = path.join(outputDir, "input.pdf");
await fs.writeFile(source, await pdf.save());
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE, headless: true });
const overflow = [];
try {
    for (const [locale, definition] of Object.entries(LOCALES)) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        const tr = (key, variables = {}) => (MESSAGES[locale][key] || key).replace(/\{(\w+)\}/g, (match, name) => variables[name] ?? match);
        const idle = () => page.waitForFunction(() => document.querySelector("#text-editor").getAttribute("aria-busy") === "false");
        const prefix = definition.path ? `/${definition.path}` : "";
        await page.goto(`${origin}/?lang=${encodeURIComponent(locale)}`);
        await idle();
        assert.equal(await page.locator("html").getAttribute("lang"), definition.languageTag);
        assert.equal(await page.locator("h1").textContent(), tr("Edit PDF Text"));
        assert.equal(await page.locator("#open").textContent(), tr("Open PDF"));
        assert.equal(await page.locator("#download").textContent(), tr("Download PDF"));
        assert.equal(await page.locator("#find-title").textContent(), tr("Find and replace"));
        assert.equal(await page.locator("#status").count(), 0);
        assert.equal(await page.locator("#range").getAttribute("placeholder"), tr("All pages; e.g. 1-3, 5, 8-"));
        assert.equal(await page.locator("#find").isVisible(), true);
        assert.equal(await page.locator("#fit").isChecked(), false);
        assert.equal(await page.locator("#cover").isChecked(), false);
        await page.locator("#file").setInputFiles(source);
        try {
            await page.waitForFunction(() => document.querySelectorAll(".text-editor-box").length === 1, null, { timeout: 65000 });
        } catch (error) {
            throw new Error(`${locale}: opening PDF timed out; browser errors: ${errors.join("; ")}`, { cause: error });
        }
        assert.equal(await page.locator(".text-editor-box").count(), 1,
            `${locale}: browser errors: ${errors.join("; ")}`);
        await idle();
        assert.equal(await page.locator("#page-count").textContent(), tr("of {count}", { count: 1 }));
        assert.equal(await page.locator("#status").count(), 0);
        assert.equal(await page.locator(".text-editor-box").getAttribute("aria-label"), `${tr("Edit text")}: Original text`);
        await page.locator(".text-editor-box").click(); await idle();
        assert.equal(await page.locator("#status").count(), 0);
        // An unsupported glyph must preserve the draft and mark its input as invalid.
        await page.locator("#inline-text").fill("\u0378");
        await page.locator("#inline-text").press("Enter"); await idle();
        assert.equal(await page.locator("#inline-editor").getAttribute("data-error"), "true");
        assert.equal(await page.locator("#inline-text").inputValue(), "\u0378");
        await page.locator("#inline-text").fill("中文 with much longer text");
        await page.locator("#inline-text").press("Enter"); await idle();
        assert.equal(await page.locator("#inline-editor").isVisible(), false);
        assert.equal(await page.locator("#status").count(), 0);
        await page.screenshot({ path: path.join(outputDir, `${locale}-desktop.png`), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(400); await idle();
        if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) overflow.push(locale);
        await page.screenshot({ path: path.join(outputDir, `${locale}-mobile.png`), fullPage: true });
        await page.locator("#find").fill("[");
        await page.locator("#replace-with").fill("x");
        await page.locator("#regex").check();
        await page.locator("#find-form button").click(); await idle();
        assert.equal(await page.locator("#inline-editor").isVisible(), false);
        assert.equal(await page.locator(".text-editor-box").count(), 1);
        const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#download").click()]);
        const outputPath = path.join(outputDir, `${locale}-output.pdf`);
        await download.saveAs(outputPath); await idle();
        assert.equal(await page.locator("#status").count(), 0);
        const output = openPdf(new Uint8Array(await fs.readFile(outputPath)));
        const outputPage = output.loadPage(0), text = outputPage.toStructuredText();
        // MuPDF can omit an inferred space between CJK and Latin text runs.
        try { assert.match(text.asText(), /中文\s*with much longer text/); }
        finally { text.destroy(); outputPage.destroy(); output.destroy(); }
        await page.locator("#open").click();
        await page.locator("#open-dialog").waitFor({ state: "visible" });
        assert.equal(await page.locator("#open-dialog-title").textContent(), tr("Open PDF"));
        assert.equal(await page.locator("#open-dialog-message").textContent(), tr("Opening another PDF will discard your current edits. Continue?"));
        assert.equal(await page.locator("#open-dialog-cancel").textContent(), tr("Cancel"));
        assert.equal(await page.locator("#open-dialog-confirm").textContent(), tr("Open PDF"));
        assert.ok(await page.locator("#open-dialog").evaluate(el => el.getBoundingClientRect().width <= innerWidth));
        await page.screenshot({ path: path.join(outputDir, `${locale}-confirmation.png`), fullPage: true });
        await page.locator("#open-dialog-cancel").click();
        await page.locator("#open-dialog").waitFor({ state: "hidden" });
        assert.equal(await page.locator(".text-editor-box").count(), 1);
        assert.deepEqual(errors, [], `${locale}: browser errors`);
        await page.close();
        console.log(`${locale}: page, inline editing, validation, download, confirmation checked`);
    }
    assert.deepEqual(overflow, [], "localized mobile layouts must not overflow");
    console.log(JSON.stringify({ locales: Object.keys(LOCALES).length, desktopAndMobile: true, outputDir }));
} finally { await browser.close(); }
