# PDF Editor

Standalone browser application for editing existing PDF text in place, searching and replacing text, and downloading edited PDFs. Supports 15 languages, original-font previews, Type 1 LaTeX fonts, undo, page navigation, drag and drop, and optional auto-shrink/background coverage.

The engine is **MuPDF.js 1.28.1 / WebAssembly**, not Python PyMuPDF. No Python service, container, private Ship Toolkit checkout or production credentials are required.

## Run

Requires Node.js 18 or newer. Runtime engine files are pinned in vendor/mupdf/1.28.1; npm installs only the development test dependency.

```sh
npm ci
npm test
npm run build
npm start
```

Open http://127.0.0.1:8011/. Use `?lang=es`, `?lang=zh-CN`, etc. to choose a locale. Run the optional browser scripts with an existing Playwright installation configured via PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE.

Deploy the contents of `dist/` to a static host. Serve `.wasm` as `application/wasm` and `.mjs` as JavaScript. Allow this application to be framed by the Ship Toolkit host; do not set `X-Frame-Options: DENY` or an incompatible `frame-ancestors` policy. HTTPS is required for production.

## Ship Toolkit integration

Ship Toolkit embeds this app in an iframe using a separately configured URL. The only message sent to the host is `pdf-editor:height` with a numeric layout height. No document contents, editing commands or engine APIs cross the frame boundary. `?embed=1&lang=…` hides the duplicated page heading. All runtime scripts, translations and engine assets load from this application's origin.

## Source and license

Application source: https://github.com/dj-zhou/pdf-editor

AGPL-3.0-or-later; see LICENSE and THIRD_PARTY_NOTICES.md. Preserve upstream notices. This checkout includes the upstream compiled WASM distribution. Before publishing a production release, finish docs/agpl-release-checklist.md, including the exact corresponding engine source/build toolchain and release-to-deployment mapping. Moving code to a repository is not by itself a completed license review.

Upstream WASM build instructions: https://github.com/ArtifexSoftware/mupdf/blob/master/platform/wasm/BUILDING.md

Application copyright: 2026 Element Express, Inc. No private Git history or credentials were copied into this repository.
