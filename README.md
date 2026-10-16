# PDF Editor

Standalone browser application for editing and moving existing PDF text in place, searching and replacing text, and downloading edited PDFs. Supports 15 languages, original-font previews, Type 1 LaTeX fonts, undo, page navigation, drag and drop, and optional auto-shrink/background coverage.

Select a text string, then drag its box border to reposition it. Click inside the box to edit the text. With the border focused, use arrow keys for 1-point adjustments or Shift+arrow for 10 points. Enter or clicking outside saves the text and position; Escape cancels both. Positions are included in undo and PDF downloads.

The Text formatting panel applies to the whole selected string: font family, size in points, bold, italic, underline, strikethrough, color, alignment within the original text width, letter spacing, and line spacing. Fonts include original, sans serif, serif, monospace, Arial-compatible (Liberation Sans), Times New Roman-compatible (Liberation Serif), Courier New-compatible (Cousine), Lato, Crimson Text, Michroma, and Orbitron. Michroma provides regular; Orbitron provides regular and bold; the other named choices provide all four regular/bold/italic/bold-italic styles. Unsupported style controls are disabled. Font files are loaded from this app's own origin on first use and embedded into downloads. Explicit font sizes override auto-shrink. Formatting previews use the same PDF writer as downloads and participate in Save, Cancel, Undo, and search/replace. Reset formatting restores source styles while keeping text edits and movement. Original fonts are retained where possible; changing the family or bold/italic variant can substitute a compatible font.

The engine is **MuPDF.js 1.28.1 / WebAssembly**, not Python PyMuPDF. No Python service, container, private Ship Toolkit checkout or production credentials are required.

## Run

Requires Node.js 22 or newer for development and deployment. Runtime engine files are pinned in vendor/mupdf/1.28.1; npm installs development and deployment tools only.

```sh
npm ci
npm test
npm run build
npm start
```

Open http://127.0.0.1:8011/. Use `?lang=es`, `?lang=zh-CN`, etc. to choose a locale. Run the optional browser scripts with an existing Playwright installation configured via PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE.

Deploy the contents of `dist/` to a static host. Serve `.wasm` as `application/wasm` and `.mjs` as JavaScript. Allow this application to be framed by the Ship Toolkit host; do not set `X-Frame-Options: DENY` or an incompatible `frame-ancestors` policy. HTTPS is required for production.

## Local Docker preview

```sh
docker build -t pdf-editor .
docker run --rm -p 127.0.0.1:8011:8011 pdf-editor
```

Ship Toolkit's `scripts/serve-in-local-containers.sh` builds a separate editor
container directly from the public GitHub repository when using the default local
editor URL. It resolves `master` to a commit on each startup; set `PDF_EDITOR_REF`
to a branch, tag or full commit SHA to choose another version. Local uncommitted
changes in this checkout are not included in that GitHub-based preview.

Pushing this repository to GitHub does not start a server. Local use requires
`npm start` or the Docker preview; public use requires deploying `dist/` to an
HTTPS static host and configuring Ship Toolkit's `PDF_EDITOR_URL` with that URL.

## Cloudflare deployment from GitHub

Push the deployment configuration and desired editor changes to this repository.
Create a separate Cloudflare Worker connected to `dj-zhou/pdf-editor`:

- Worker name: `pdf-editor` (matching `wrangler.jsonc`).
- Production branch: `master`.
- Root directory: repository root.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy`.

Cloudflare installs dependencies from `package-lock.json`, builds this repository,
and serves `dist/` at the editor's own HTTPS URL. Set Ship Toolkit's build variable
`PDF_EDITOR_URL` to that actual deployed URL. Deploy Ship Toolkit after the editor.
Subsequent editor commits deploy through its own Git integration, independently
of Ship Toolkit. No editor source or engine is copied into the Ship Toolkit build.

For a manual deployment after configuring Cloudflare authentication, run
`npm ci` followed by `npm run deploy`. Local builds do not deploy anything.

[Cloudflare Git builds documentation](https://developers.cloudflare.com/workers/ci-cd/builds/)

## Ship Toolkit integration

Ship Toolkit embeds this app in an iframe using a separately configured URL. The editor sends `pdf-editor:height` with a numeric layout height. The host sends `pdf-editor:viewport` with its visible height and top offset relative to the iframe, so the sidebar follows outer-page scrolling. Both sides check the sender and origin. No document contents, editing commands or engine APIs cross the frame boundary. `?embed=1&lang=…` hides the duplicated page heading. All runtime scripts, translations and engine assets load from this application's origin.

## Source and license

Application source: https://github.com/dj-zhou/pdf-editor

AGPL-3.0-or-later; see LICENSE and THIRD_PARTY_NOTICES.md. Preserve upstream notices. This checkout includes the upstream compiled WASM distribution. Before publishing a production release, finish docs/agpl-release-checklist.md, including the exact corresponding engine source/build toolchain and release-to-deployment mapping. Moving code to a repository is not by itself a completed license review.

Upstream WASM build instructions: https://github.com/ArtifexSoftware/mupdf/blob/master/platform/wasm/BUILDING.md

Application copyright: 2026 Element Express, Inc. No private Git history or credentials were copied into this repository.
