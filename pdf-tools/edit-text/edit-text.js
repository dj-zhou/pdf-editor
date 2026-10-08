// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
import { t } from "../../i18n.mjs";

const $ = id => document.getElementById(id);
const workspace = $("text-editor");
const inlineEditor = $("inline-editor"), inlineText = $("inline-text");
const caretLayer = $("inline-caret-layer");
let renderVersion = 0, draftTimer, draftRunning = false, draftAgain = false;
let worker, sequence = 0, pending = new Map();
let loaded = false, busy = false, count = 0, page = 0, name = "", selected;
let edits = [], history = [], units = [], savedState = "[]";
let bounds = [0, 0, 612, 792], cssScale = 1;
let initialInlineValue = "";
let fileDragDepth = 0;

function createWorker() {
    worker = new Worker(new URL("./text-editor-worker.mjs", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) return;
        clearTimeout(request.timeout); pending.delete(data.id);
        if (data.error) {
            request.reject(new Error(data.error));
        } else request.resolve(data.result);
    };
    worker.onerror = () => stopWorker("The PDF engine could not load. Reopen your PDF to try again.");
}
function stopWorker(reason) {
    worker?.terminate(); worker = undefined;
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(new Error(reason)); }
    pending.clear(); loaded = false;
    clearSelection();
    $("paper").hidden = true; $("empty").hidden = false;
    console.error(reason); controls();
}
function request(command, payload, transfers = []) {
    if (!worker) createWorker();
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        // Regex and malformed PDF work is isolated; terminate rather than freeze the page.
        const timeout = setTimeout(() => stopWorker("Processing took too long. Reopen the PDF and use a smaller document or a simpler search."), 60000);
        pending.set(id, { resolve, reject, timeout });
        worker.postMessage({ id, command, payload }, transfers);
    });
}
function controls() {
    if (busy) clearFileDrag();
    workspace.setAttribute("aria-busy", String(busy));
    workspace.querySelectorAll("[data-loaded]").forEach(el => { el.disabled = !loaded || busy; });
    $("open").disabled = busy; $("file").disabled = busy;
    $("undo").disabled = busy || !history.length;
    $("reset").disabled = busy || !edits.length;
    $("prev").disabled = !loaded || busy || page === 0;
    $("next").disabled = !loaded || busy || page === count - 1;
    for (const id of ["inline-text", "inline-save", "inline-cancel"]) $(id).disabled = busy || !loaded || !selected;
    $("boxes").querySelectorAll("button").forEach(button => { button.disabled = busy; });
    const hasEdits = selected
        ? edits.some(edit => edit.page !== selected.page || edit.id !== selected.id) || inlineText.value !== selected.text
        : edits.length > 0;
    $("download").disabled = !loaded || busy || !hasEdits;
}
async function operation(action, keepInline = false) {
    if (busy) return false;
    const restoreFocus = document.activeElement === inlineText;
    busy = true; controls();
    try {
        // Navigation, export, and other tools include the text currently being typed.
        if (selected && !keepInline) await commitInline();
        await action();
        return true;
    }
    catch (error) {
        console.error(error);
        if (selected) inlineEditor.dataset.error = "true";
        return false;
    }
    finally {
        busy = false; controls();
        if (selected && (restoreFocus || inlineEditor.dataset.error === "true")) inlineText.focus({ preventScroll: true });
    }
}
function options() { return { mode: "line", fit: $("fit").checked, cover: $("cover").checked }; }

function positionInlineEditor() {
    if (!selected) return;
    const layout = selected.layout;
    const left = Math.min(selected.origin[0], layout.bounds[0]);
    const top = Math.min(...layout.stops.map(stop => stop.top), layout.bounds[1]);
    const right = Math.max(selected.bbox[2], layout.bounds[2], ...layout.stops.map(stop => stop.x));
    const bottom = Math.max(layout.bounds[3], ...layout.stops.map(stop => stop.bottom));
    inlineEditor.style.left = `${(left - bounds[0]) * cssScale}px`;
    inlineEditor.style.top = `${(top - bounds[1]) * cssScale}px`;
    inlineEditor.style.width = `${Math.max(10, right - left) * cssScale}px`;
    inlineText.style.height = `${Math.max(layout.pitch, bottom - top) * cssScale}px`;
    // The transparent textarea supplies native keyboard, clipboard and IME
    // input. Visible glyphs, selection and caret use PDF font geometry.
    inlineText.style.fontSize = `${selected.size * cssScale}px`;
    inlineText.style.lineHeight = `${layout.pitch * cssScale}px`;
    const actions = inlineEditor.querySelector(".text-editor-inline-actions");
    const x = parseFloat(inlineEditor.style.left);
    actions.style.left = `${Math.max(-x, Math.min(0, $("paper").offsetWidth - x - actions.offsetWidth - 4))}px`;
    const edge = parseFloat(inlineEditor.style.top) + inlineText.offsetHeight;
    const textBelow = units.some(unit => unit.id !== selected.id && unit.rects.some(rect => {
        const y = (rect[1] - bounds[1]) * cssScale;
        return y >= edge - 2 && y < edge + 48 &&
            (rect[0] - bounds[0]) * cssScale < x + actions.offsetWidth && (rect[2] - bounds[0]) * cssScale > x;
    }));
    inlineEditor.dataset.actionsAbove = String(parseFloat(inlineEditor.style.top) > 48 && (textBelow || edge + 48 > $("paper").offsetHeight));
    paintCaret();
}
function caretStops() {
    // At a character boundary prefer the next glyph's original position to a
    // nominal font advance, preserving the source PDF's kerning.
    return [...new Map(selected.layout.stops.map(stop => [stop.offset, stop])).values()];
}
function paintCaret() {
    caretLayer.replaceChildren();
    if (!selected || document.activeElement !== inlineText) return;
    const stops = caretStops();
    const offset = inlineText.selectionDirection === "backward" ? inlineText.selectionStart : inlineText.selectionEnd;
    const current = stops.reduce((best, stop) => Math.abs(stop.offset - offset) < Math.abs(best.offset - offset) ? stop : best, stops[0]);
    if (!current) return;
    const left = parseFloat(inlineEditor.style.left), top = parseFloat(inlineEditor.style.top);
    function rectangle(x, y, width, height, className) {
        const element = document.createElement("span"); element.className = className;
        Object.assign(element.style, { left: `${(x - bounds[0]) * cssScale - left}px`, top: `${(y - bounds[1]) * cssScale - top}px`,
            width: `${width}px`, height: `${Math.max(3, height * cssScale)}px` });
        caretLayer.append(element);
    }
    if (inlineText.selectionStart !== inlineText.selectionEnd) {
        const rows = new Map();
        for (const stop of stops) {
            if (stop.offset < inlineText.selectionStart || stop.offset > inlineText.selectionEnd) continue;
            if (!rows.has(stop.row)) rows.set(stop.row, []);
            rows.get(stop.row).push(stop);
        }
        for (const row of rows.values()) {
            const x0 = Math.min(...row.map(s => s.x)), x1 = Math.max(...row.map(s => s.x));
            rectangle(x0, Math.min(...row.map(s => s.top)), (x1 - x0) * cssScale, Math.max(...row.map(s => s.bottom)) - Math.min(...row.map(s => s.top)), "text-editor-inline-highlight");
        }
    } else rectangle(current.x, current.top, 1.5, current.bottom - current.top, "text-editor-inline-caret");
}
function offsetAt(point) {
    const paper = $("paper").getBoundingClientRect();
    const x = (point.x - paper.left) / cssScale + bounds[0], y = (point.y - paper.top) / cssScale + bounds[1];
    return caretStops().reduce((best, stop) => {
        const distance = s => Math.abs(x - s.x) + Math.max(s.top - y, y - s.bottom, 0) * 10;
        return distance(stop) < distance(best) ? stop : best;
    }).offset;
}
function placeCaret(point) {
    const offset = point ? offsetAt(point) : inlineText.value.length;
    inlineText.setSelectionRange(offset, offset); paintCaret();
}
function scheduleDraft() {
    renderVersion++; clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
        if (!selected || busy) return;
        if (draftRunning) { draftAgain = true; return; }
        draftRunning = true;
        try { await render(); }
        catch (error) { if (selected) inlineEditor.dataset.error = "true"; console.error(error); }
        finally {
            draftRunning = false;
            if (draftAgain) { draftAgain = false; if (selected && !busy) scheduleDraft(); }
        }
    }, 80);
}

async function selectUnit(unit, point) {
    if (busy) return;
    if (selected?.id === unit.id) { inlineText.focus({ preventScroll: true }); return; }
    const success = await operation(async () => {
        selected = { ...unit, page };
        initialInlineValue = edits.find(e => e.page === page && e.id === unit.id)?.value ?? unit.text;
        inlineText.value = initialInlineValue;
        inlineEditor.hidden = false; inlineEditor.dataset.error = "false";
        positionInlineEditor();
        await render();
    });
    if (success && selected) { inlineText.focus({ preventScroll: true }); placeCaret(point); }
}

async function render(nextEdits = edits, nextPage = page, includeDraft = true) {
    const version = ++renderVersion;
    const active = includeDraft && selected?.page === nextPage ? { id: selected.id, value: inlineText.value } : undefined;
    const zoom = $("zoom").value;
    const cssWidth = zoom === "fit" ? Math.max(240, $("viewport").clientWidth - 48) : (bounds[2] - bounds[0]) * Number(zoom);
    const result = await request("render", { page: nextPage, width: cssWidth * Math.min(devicePixelRatio || 1, 2), edits: nextEdits, options: options(),
        draft: active });
    if (version !== renderVersion) return;
    page = nextPage; bounds = result.bounds; units = result.units;
    cssScale = zoom === "fit" ? cssWidth / (bounds[2] - bounds[0]) : Number(zoom);
    const canvas = $("canvas"); canvas.width = result.width; canvas.height = result.height;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height), 0, 0);
    $("paper").style.width = `${(bounds[2] - bounds[0]) * cssScale}px`;
    $("paper").style.height = `${(bounds[3] - bounds[1]) * cssScale}px`;
    const boxes = $("boxes"); boxes.replaceChildren();
    for (const unit of units) {
        const button = document.createElement("button"), edited = nextEdits.some(e => e.page === page && e.id === unit.id);
        button.type = "button"; button.className = `text-editor-box${edited ? " text-editor-box--edited" : ""}`;
        button.dataset.id = unit.id; button.setAttribute("aria-label", `${t("Edit text")}: ${unit.text}`);
        button.setAttribute("aria-pressed", String(selected?.id === unit.id)); button.title = unit.text;
        // Font ascent/descent boxes overlap tightly spaced lines. Draw selection
        // outlines around the actual ink so they don't cross neighboring text.
        const rect = unit.displayBounds || [unit.bbox[0], unit.inkBounds[1], unit.bbox[2], unit.inkBounds[3]];
        Object.assign(button.style, { left: `${(rect[0] - bounds[0]) * cssScale}px`, top: `${(rect[1] - bounds[1]) * cssScale}px`,
            width: `${Math.max(3, rect[2] - rect[0]) * cssScale}px`, height: `${(rect[3] - rect[1]) * cssScale}px` });
        button.addEventListener("click", event => selectUnit(unit, { x: event.clientX, y: event.clientY })); boxes.append(button);
    }
    $("page").value = page + 1; $("page").max = count;
    $("page-count").textContent = t("of {count}", { count });
    $("paper").hidden = false; $("empty").hidden = true;
    if (selected) { selected.layout = units.find(unit => unit.id === selected.id).layout; positionInlineEditor(); }
}
function clearSelection() {
    renderVersion++; clearTimeout(draftTimer); caretLayer.replaceChildren();
    selected = undefined; initialInlineValue = ""; inlineText.value = "";
    inlineEditor.hidden = true;
    for (const button of $("boxes").children) button.setAttribute("aria-pressed", "false");
}
async function commit(nextEdits) {
    await render(nextEdits, page, false);
    history.push(edits); edits = nextEdits; clearSelection();
}

async function commitInline() {
    if (!selected) return;
    if (inlineText.value === initialInlineValue) {
        await render(edits, page, false);
        clearSelection();
        return;
    }
    const next = edits.filter(e => e.page !== selected.page || e.id !== selected.id);
    if (inlineText.value !== selected.text) next.push({ page: selected.page, id: selected.id, value: inlineText.value });
    await commit(next);
}

function cancelInline() {
    return operation(async () => {
        await render(edits, page, false);
        clearSelection();
    }, true);
}

$("open").addEventListener("click", () => $("file").click());
const openDialog = $("open-dialog");
let replacementAction, allowFilePicker = false;
function hasReplacementEdits() {
    return loaded && (edits.length > 0 || (selected && inlineText.value !== initialInlineValue));
}
function confirmReplacement(action) {
    if (openDialog.open) return;
    replacementAction = action;
    openDialog.showModal();
}
openDialog.addEventListener("close", () => { if (!openDialog.open) replacementAction = undefined; });
openDialog.querySelector("form").addEventListener("submit", event => {
    event.preventDefault();
    const action = replacementAction;
    replacementAction = undefined;
    openDialog.close();
    // Run from the user's button click so mobile browsers allow the file picker.
    if (event.submitter?.value === "open") action?.();
});
$("file").addEventListener("click", event => {
    if (busy) { event.preventDefault(); return; }
    if (allowFilePicker) { allowFilePicker = false; return; }
    if (!hasReplacementEdits()) return;
    event.preventDefault();
    confirmReplacement(() => { allowFilePicker = true; $("file").click(); });
});
function loadPdf(file, confirm = true) {
    if (!file || busy) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
        $("file").value = "";
        return;
    }
    if (confirm && hasReplacementEdits()) { confirmReplacement(() => loadPdf(file, false)); return; }
    return operation(async () => {
        if (file.size > 50 * 1024 * 1024) throw new Error("Choose a PDF smaller than 50 MB.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await request("open", { bytes }, [bytes.buffer]);
        loaded = true; count = result.count; page = 0; name = file.name;
        edits = []; history = []; savedState = "[]"; clearSelection();
        await render();
    }).finally(() => { $("file").value = ""; });
}
// The file picker already confirmed before opening; dropped files confirm here.
$("file").addEventListener("change", () => loadPdf($("file").files[0], false));
const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes("Files");
function clearFileDrag() {
    fileDragDepth = 0;
    workspace.classList.remove("is-dragging");
}
for (const eventName of ["dragenter", "dragover"]) {
    workspace.addEventListener(eventName, event => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = busy ? "none" : "copy";
        if (busy) return;
        if (eventName === "dragenter") fileDragDepth++;
        workspace.classList.add("is-dragging");
    });
}
workspace.addEventListener("dragleave", event => {
    if (!isFileDrag(event)) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (!fileDragDepth) clearFileDrag();
});
workspace.addEventListener("drop", event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    clearFileDrag();
    loadPdf(event.dataTransfer.files[0]);
});
window.addEventListener("dragend", clearFileDrag);
inlineEditor.addEventListener("submit", event => {
    event.preventDefault(); if (!selected) return;
    operation(() => commitInline(), true);
});
$("inline-cancel").addEventListener("click", cancelInline);
inlineText.addEventListener("input", () => { inlineEditor.dataset.error = "false"; controls(); scheduleDraft(); });
inlineText.addEventListener("select", paintCaret);
inlineText.addEventListener("keyup", paintCaret);
inlineText.addEventListener("focus", paintCaret);
let pointerAnchor;
inlineText.addEventListener("pointerdown", event => {
    if (!selected || busy || event.pointerType === "touch") return;
    pointerAnchor = offsetAt({ x: event.clientX, y: event.clientY });
});
inlineText.addEventListener("pointerup", event => {
    if (pointerAnchor === undefined || !selected) return;
    const end = offsetAt({ x: event.clientX, y: event.clientY });
    inlineText.setSelectionRange(Math.min(pointerAnchor, end), Math.max(pointerAnchor, end), end < pointerAnchor ? "backward" : "forward");
    pointerAnchor = undefined; paintCaret();
});
inlineText.addEventListener("blur", event => {
    const target = event.relatedTarget;
    if (target && (inlineEditor.contains(target) || target.closest("button,select"))) return;
    setTimeout(async () => {
        if (!selected || busy || inlineEditor.contains(document.activeElement)) return;
        if (await operation(() => {})) target?.focus({ preventScroll: true });
    }, 0);
});
inlineText.addEventListener("keydown", event => {
    if (event.isComposing || busy) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelInline(); }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey || !event.shiftKey)) {
        event.preventDefault(); event.stopPropagation(); inlineEditor.requestSubmit();
    }
});
workspace.addEventListener("pointerdown", event => {
    if (!selected || busy || inlineEditor.contains(event.target) || event.target.closest(".text-editor-box")) return;
    // Tool controls flush the draft in their own operation, so their action also runs.
    if (event.target.closest("button,input,select,textarea,label,summary,a")) return;
    operation(() => {}, false);
});
$("undo").addEventListener("click", () => operation(async () => {
    if (!history.length) return;
    const previous = history.at(-1);
    await render(previous);
    edits = previous; history.pop(); clearSelection();
}));
$("reset").addEventListener("click", () => operation(() => commit([])));
async function goTo(index) {
    if (!Number.isInteger(index) || index < 0 || index >= count) { $("page").value = page + 1; return; }
    await operation(async () => { clearSelection(); await render(edits, index); });
}
$("prev").addEventListener("click", () => goTo(page - 1));
$("next").addEventListener("click", () => goTo(page + 1));
$("page").addEventListener("change", () => goTo(Number($("page").value) - 1));
for (const id of ["zoom", "fit", "cover"]) $(id).addEventListener("change", () => operation(async () => {
    clearSelection(); await render();
}));
$("find-form").addEventListener("submit", event => {
    event.preventDefault(); operation(async () => {
        const result = await request("replace", { edits, options: options(), find: $("find").value,
            replacement: $("replace-with").value, range: $("range").value,
            regex: $("regex").checked, caseSensitive: $("case").checked });
        if (result.changed) await commit(result.edits);
    });
});
$("download").addEventListener("click", () => operation(async () => {
    const result = await request("save", { edits, options: options() });
    const url = URL.createObjectURL(new Blob([result.bytes], { type: "application/pdf" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `${name.replace(/\.pdf$/i, "") || "document"}-edited.pdf`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000); savedState = JSON.stringify(edits);
}));
document.addEventListener("keydown", event => {
    if (!(event.ctrlKey || event.metaKey) || busy || openDialog.open) return;
    const editing = event.target.matches("input, textarea, select");
    if (event.key.toLowerCase() === "o") { event.preventDefault(); $("open").click(); }
    if (event.key.toLowerCase() === "s" && loaded) { event.preventDefault(); $("download").click(); }
    if (event.key.toLowerCase() === "z" && !editing) { event.preventDefault(); $("undo").click(); }
});
window.addEventListener("beforeunload", event => {
    if (loaded && (JSON.stringify(edits) !== savedState || (selected && inlineText.value !== initialInlineValue))) { event.preventDefault(); event.returnValue = ""; }
});
let resizeTimer;
new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (loaded && !busy && $("zoom").value === "fit") {
            operation(async () => { await render(); }, true);
        }
    }, 250);
}).observe($("viewport"));
controls();
