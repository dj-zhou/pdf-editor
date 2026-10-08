import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { LOCALES, MESSAGES } from "../locales/catalog.mjs";
test("standalone editor translates all UI and accessible labels in 15 languages", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    const keys = new Set();
    for (const match of html.matchAll(/>([^<>]+)</g)) {
        const value = match[1].trim().replace(/\s+/g, " ");
        if (/[A-Za-z]/.test(value) && !/MuPDF|AGPL/.test(value)) keys.add(value);
    }
    for (const match of html.matchAll(/(?:aria-label|placeholder|title|content)="([^"]+)"/g))
        if (!match[1].includes("width=device-width")) keys.add(match[1]);
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    assert.equal(Object.keys(LOCALES).length, 15);
    for (const locale of Object.keys(LOCALES).filter(l => l !== "en")) {
        assert.deepEqual([...keys].filter(key => !MESSAGES[locale][key]), [], locale);
        for (const key of keys) assert.deepEqual(placeholders(MESSAGES[locale][key]), placeholders(key), `${locale}: ${key}`);
    }
});
