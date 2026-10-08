# Standalone editor architecture

This document describes the engine implementation extracted from Ship Toolkit.
The entry point is now `/` in this standalone repository. All application runtime
files and translations load from this application's origin. Run `npm ci`,
`npm test`, `npm run build`, and `npm start`; build output is `dist/`.
The private Ship Toolkit application is not required to build or run this editor.

The implementation follows HPDFTool's text-editing workflow: extract text with
font, color, baseline, and bounding-box information; select a line;
remove edited text; redraw searchable replacement text at its original
baseline. It supports undo, text deletion, copy, page navigation, zoom, automatic
shrinking, background-color coverage, built-in font fallback, and literal or regex
find-and-replace across a page range. The interface uses line editing and has no
password field or extraction-mode selector.
Auto-shrink and background coverage are in the top toolbar. Download is disabled
until there are edits, including an active inline draft, and becomes a bright
filled button when the edited PDF is available. The toolbar has no edit counter.
Find and replace is permanently visible in the sidebar beneath compact editing
instructions. There is no custom font upload control.

Clicking text opens an input directly on the PDF. The visible text remains on
MuPDF's canvas, preserving its original embedded font, color, size, and spacing.
Typing renders a debounced live draft through the same font/layout path used for
export. A transparent textarea supplies keyboard, clipboard, undo, and IME input;
the caret and selection highlight use PDF glyph coordinates. Preview requests
are serialized and stale responses are ignored when typing or changing tools.
There is no sidebar replacement text box. Enter saves the edit; Shift+Enter adds
a new line. Escape cancels. Clicking away or using another tool saves the draft,
including before page navigation or downloading. Save/Cancel controls stay beside
the input for touch devices. Resizing preserves an active draft. Characters absent
from an embedded font still use the same fallback fonts in preview and export.

## Architecture

The official MuPDF JavaScript/WebAssembly binding (`mupdf` 1.28.1) runs in a module
Web Worker in the browser. The original document remains immutable; each preview
and export is rebuilt from it and the current edit list. No selected PDFs, passwords,
fonts, or replacement text are uploaded. A 60-second watchdog terminates stuck PDF
or regex processing without freezing the UI. Input PDFs are limited to 50 MB;
preview rendering is capped at 12 million pixels.

`pdf-text-editor.mjs` extracts structured character data, reuses embedded fonts
where they contain the requested glyphs, preserves unchanged style runs, and uses
Base-14/CJK fonts as fallback. Background colors are sampled directly
from MuPDF pixmap pixels; Pillow is unnecessary. Replacement text and optional
background fills are drawn into a PDF Form XObject with isolated resources, mapped
back through the source page transform. Redaction explicitly preserves images and
vector graphics. Existing pending redaction annotations block edits on their page
so the editor cannot accidentally commit unrelated redactions.

Raw PostScript Type 1 subsets, including pdfTeX's Computer Modern fonts, retain
their original PDF font resource and one-byte character encoding. MuPDF's
generated replacement streams are recoded before grafting them into the document:
wrapping those Type 1 programs in Identity-H CID fonts can look correct in MuPDF
but render as unrelated symbols in other readers. Characters without a usable
source encoding use a compatible fallback. Embedded CFF and TrueType fonts keep
the normal MuPDF writer path.

Export uses a full save with `garbage=2,compress=yes,encrypt=none`. Do not enable
object or stream deduplication (`garbage=3` or `garbage=4`) without testing:
1.28.1 can discard generated form streams when deduplicating multi-page edits
or documents containing images. Level 2 removes unused objects and compacts the
cross-reference table without deduplicating. Regression tests
reopen exported documents to check that replacement text survives the save.

The pinned 9.9 MB WASM library and JavaScript are served from
`vendor/mupdf/1.28.1/`, and are copied into the existing Cloudflare static build and
local Docker build. There is no server runtime dependency, new exposed port, or
deployment configuration to provision. Run the existing build/deployment process.

## Deployment

Deploy this repository's `dist/` to an HTTPS static host. Ship Toolkit embeds the
application by URL; the iframe sends layout height only. See README.md for local
preview, localization, and iframe requirements. There is no Python backend.

## Limits and licensing

This edits existing horizontal, left-to-right text. Scanned text requires OCR;
vertical, angled, and right-to-left text is excluded. Exact font matching is not
guaranteed for missing subset glyphs. Paragraph expansion can overlap nearby
content; the editor reports overflow and previews the result. Background coverage
uses a solid sampled color and cannot reconstruct a photograph or pattern.
Text removal and background coverage exclude the bounds of unselected characters,
including tightly spaced neighboring lines. Selection outlines use glyph ink
bounds rather than the larger font boxes. Fully overlapping text that cannot be
isolated is rejected instead of risking changes to neighboring text.
After an edit, the outline and click target follow the replacement's rendered
glyph bounds, including shorter, longer, multiline, and auto-shrunk replacements.
The original geometry and unit IDs remain available for subsequent edits.
Downloads remove password encryption, and modifications invalidate existing
digital signatures. This is a text editor, not a sensitive-data sanitization tool.

MuPDF.js, like PyMuPDF's underlying engine, uses AGPL/commercial licensing. The
vendored package license is preserved. Account for that license before distributing
or deploying the editor; moving the engine into a Python container does not remove
the licensing consideration. See the
[official MuPDF.js licensing documentation](https://mupdfjs.readthedocs.io/en/latest/faq/index.html#licensing).

The workflow was studied in the local HPDFTool project (copyright 2026
HIUWAHWONG, MIT). The JavaScript implementation does not import its Tkinter UI.

## Verification

```sh
node --test tests/test_pdf_text_editor.mjs
node --test tests/*.mjs
npm run build
python3 -m http.server 8000 --directory dist
```

Open `http://127.0.0.1:8000/` for the editor.

An optional Chrome/Playwright smoke test checks asynchronous engine startup,
on-page input alignment, Enter/Escape, IME handling, click-away saving, Shift+Enter
newlines, active drafts included in export, multi-page find-and-replace, saved PDF
text, tightly spaced lines in the inline preview and export, undo/reset, network privacy,
and mobile overflow. It writes screenshots and test PDFs to a temporary
directory. With Playwright available, run:

```sh
node scripts/test-pdf-text-editor-browser.mjs http://127.0.0.1:8000
node scripts/test-pdf-text-editor-locales-browser.mjs http://127.0.0.1:8000
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright/Playwright Core module;
`PLAYWRIGHT_EXECUTABLE` can point to a system Chrome executable. Neither is needed
for the application itself or the normal unit tests.

The unit suite includes a reproducible pdfTeX fixture in `tests/fixtures/` to
check Type 1 font resources, mixed original/fallback glyph order, unchanged
rendered pixels, nested forms, and missing character maps. The browser check
also edits and downloads that fixture. For independent rendering, inspect the
download with Poppler (`pdffonts` and `pdftoppm`) or another PDF reader.

The localization check opens all 15 languages on desktop and mobile, checks
page text and accessibility labels, edits and downloads a PDF, verifies draft
validation and the replacement confirmation, and detects horizontal overflow.
It also checks that the bottom message area is absent. Catalog tests cover the
remaining editor UI text and preserve translation placeholders.
