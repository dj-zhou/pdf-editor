// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
// Register the message handler before MuPDF's asynchronous WASM initialization.
// Static imports with top-level await can lose an early "open" message in browsers.
let mupdf, openPdf, readUnits, publicUnit, applyEdits, parsePageRange, replacementFunction;
const ready = Promise.all([
    import("../../vendor/mupdf/1.28.1/mupdf.js"), import("./pdf-text-editor.mjs")
]).then(([library, engine]) => {
    mupdf = library.default;
    ({ openPdf, readUnits, publicUnit, applyEdits, parsePageRange, replacementFunction } = engine);
});

let source, original, password;

function render({ page: index, width, edits = [], options = {}, draft }) {
    const basePage = original.loadPage(index);
    let extracted, modified, page, pixmap;
    try {
        extracted = readUnits(basePage, options.mode);
        const changes = edits.filter(edit => edit.page === index && edit.id !== draft?.id);
        // Draw the active draft with the PDF fonts. An unchanged selection keeps
        // the original pixels, including the PDF's character spacing/kerning.
        if (draft && draft.value !== extracted.units[draft.id]?.text) changes.push({ page: index, ...draft });
        if (changes.length) modified = applyEdits(source, changes, { ...options, password });
        page = modified ? modified.doc.loadPage(index) : basePage;
        const bounds = page.getBounds(), w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
        const scale = Math.min(Math.max(0.2, width / w), 4, Math.sqrt(12000000 / (w * h)));
        pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, true, true);
        const pixels = pixmap.getPixels().slice();
        const editBounds = new Map((modified?.editBounds || []).filter(edit => edit.page === index).map(edit => [edit.id, edit.bounds]));
        const editLayouts = new Map((modified?.editLayouts || []).filter(edit => edit.page === index).map(edit => [edit.id, edit.layout]));
        // Keep original units/IDs for subsequent edits, but use replacement ink
        // bounds for the visible outline and click target.
        return { units: extracted.units.map(unit => {
            const value = publicUnit(unit);
            return { ...value, layout: editLayouts.get(unit.id) || value.layout, displayBounds: editBounds.get(unit.id) };
        }), bounds, scale,
            width: pixmap.getWidth(), height: pixmap.getHeight(), pixels,
            warnings: modified?.warnings || [] };
    } finally {
        pixmap?.destroy(); if (page && page !== basePage) page.destroy();
        modified?.doc.destroy(); extracted?.destroy(); basePage.destroy();
    }
}

function replaceAll({ edits = [], options = {}, find, replacement, range, regex, caseSensitive }) {
    const replace = replacementFunction(find, replacement, { regex, caseSensitive });
    const next = new Map(edits.map(e => [`${e.page}:${e.id}`, e]));
    let changed = 0;
    for (const index of parsePageRange(range, original.countPages())) {
        const page = original.loadPage(index);
        let extracted;
        try {
            extracted = readUnits(page, options.mode);
            for (const unit of extracted.units) {
                const key = `${index}:${unit.id}`, current = next.get(key)?.value ?? unit.text;
                const value = replace(current);
                if (value === current) continue;
                changed++;
                if (value === unit.text) next.delete(key);
                else next.set(key, { page: index, id: unit.id, value });
            }
        } finally { extracted?.destroy(); page.destroy(); }
    }
    // Validate the entire transaction before returning it, including off-screen pages.
    const validated = applyEdits(source, [...next.values()], { ...options, password });
    validated.doc.destroy();
    return { edits: [...next.values()], changed, warnings: validated.warnings };
}

self.onmessage = async ({ data: { id, command, payload } }) => {
    try {
        await ready;
        let result;
        if (command === "open") {
            const document = openPdf(payload.bytes, payload.password);
            original?.destroy(); original = document;
            source = payload.bytes; password = payload.password;
            result = { count: original.countPages() };
        } else {
            if (!original) throw new Error("Open a PDF first.");
            if (command === "render") result = render(payload);
            else if (command === "replace") result = replaceAll(payload);
            else if (command === "save") {
                const modified = applyEdits(source, payload.edits, { ...payload.options, password });
                let buffer;
                try {
                    buffer = modified.doc.saveToBuffer("garbage=2,compress=yes,encrypt=none");
                    result = { bytes: buffer.asUint8Array().slice(), warnings: modified.warnings };
                } finally { buffer?.destroy(); modified.doc.destroy(); }
            } else throw new Error("Unknown editor operation.");
        }
        const transfers = result.pixels ? [result.pixels.buffer] : result.bytes ? [result.bytes.buffer] : [];
        self.postMessage({ id, result }, transfers);
    } catch (error) { self.postMessage({ id, error: error.message || String(error), messageKey: error.messageKey, variables: error.variables }); }
};
