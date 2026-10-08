# TODO: Publish the PDF editor source under AGPL

Extraction completed: October 8, 2026. Application repository: https://github.com/dj-zhou/pdf-editor.

The standalone application, 15-language catalog, tests, license, source notice and static build are present. Publication, the exact corresponding engine source/toolchain and deployed-release mapping still need verification.

Goal: make the complete source for the publicly deployed PDF editor available
under AGPL-3.0-or-later, with a visible source and license link on the page.
Free access and future AdSense revenue are compatible with this approach, subject
to license compliance. Source obligations apply to public distribution even
before the website earns money.

This checklist is an implementation plan, not a completed licensing review.

## 1. Define the release scope

- [x] Choose the public GitHub repository name and URL, for example
  `pdf-editor`.
- [ ] Record the production editor version and the source commit it was built from.
- [ ] Identify the complete covered application and its dependencies. Start with
  `pdf-tools/edit-text/`, then trace its shared styles, scripts, translations,
  assets, and build requirements. Include the actual versions used in production.
- [ ] Confirm the licensing boundary for shared code and other Ship Toolkit tools;
  a separate repository alone does not establish that they are independent works.
  Obtain licensing advice if that boundary remains unclear.
- [ ] Confirm ownership or permission to license all included application code.
  Preserve existing third-party licenses instead of replacing them with your own.
- [x] Export the required files to a clean release directory. Exclude credentials,
  private PDFs, unrelated projects, and private Git history.

## 2. Obtain the corresponding MuPDF source

Current dependency: official Artifex `mupdf` npm package, version **1.28.1**.
The existing `vendor/mupdf/1.28.1/` contains JavaScript and a compiled WASM engine,
plus upstream notices. The npm package archive alone is not the complete source
needed to build that engine.

- [ ] Identify the exact upstream source revision used for the bundled 1.28.1
  package, including the JavaScript bindings and MuPDF C source.
- [ ] Obtain the required source dependencies, including any submodules, and
  preserve their license and copyright notices.
- [ ] Obtain the WASM build scripts, toolchain requirements, and build options.
  Ask Artifex for the corresponding source/build details if the release mapping
  cannot be established from upstream materials.
- [ ] Make the complete corresponding source available through the public release.
  Prefer retaining a source archive rather than relying solely on an upstream
  moving branch. Document exact versions, revisions, and checksums.
- [ ] Update `vendor/mupdf/README.md`: distinguish the npm distribution archive
  from the complete engine source and document where both can be obtained.

## 3. Prepare a usable source release

- [x] Add the AGPL-3.0-or-later license text and clear application license notices.
- [ ] Add accurate application copyright attribution and retain Artifex attribution.
- [x] Add third-party notices covering included libraries, fonts, and other assets.
  Review any applicable producer/copyright notice requirements as well.
- [x] Add a README explaining what the editor does, its license, dependency
  versions, and how to obtain the matching engine source.
- [x] Include scripts and instructions to build and run the editor from a fresh
  checkout, including the localized page build and WASM build procedure.
- [x] Verify that the exported release can run without private workspace files,
  production credentials, or undocumented dependencies.
- [ ] Tag the release corresponding to the deployed application and offer a
  downloadable archive. A latest-development-only link is insufficient when
  production uses an older version.

## 4. Add the page notice and source link

- [ ] Publish and verify the repository/release before adding its URL to production.
- [ ] Add a visible source and license notice to `index.html`.
  Suggested wording:

  > Powered by MuPDF. This editor is licensed under AGPL-3.0-or-later.
  > View source and license.

- [ ] Link to the corresponding source release and provide access to the license
  text and applicable legal notices. Do not use a placeholder GitHub URL.
- [ ] Translate the notice and link text in all 15 supported languages through
  `locales/catalog.mjs` and the existing locale build.
- [ ] Keep the notice readable and its link accessible on desktop and mobile.

## 5. Verify and publish

- [ ] Run `npm test` from `web-apps/09-ship-toolkit`.
- [ ] Run `sh scripts/build-cloudflare.sh /tmp/shiptoolkit-agpl-preview`.
- [ ] Verify the source/license notice and matching release URL in every localized
  editor page. Extend the existing localization checks for the new notice.
- [ ] Run the editor browser checks against a local static preview, including
  `scripts/test-pdf-text-editor-browser.mjs` and
  `scripts/test-pdf-text-editor-locales-browser.mjs`.
  Use the Playwright settings documented in `docs/pdf-text-editor.md`.
- [ ] Download the public release without authentication and verify its build/run
  instructions from a fresh directory.
- [ ] Confirm that the deployed editor matches the published release, then deploy
  the notice and verify the production links.

## 6. Keep future releases aligned

- [ ] Publish matching source and update the page link with each deployed release.
- [ ] Retain source availability while the corresponding binaries are distributed.
- [ ] Recheck dependency licenses and source packages when upgrading MuPDF.
- [ ] Before adding AdSense, review the integration for compatibility with the
  covered application; advertising income itself does not remove AGPL rights or
  obligations.

## References

- [Existing editor implementation notes](architecture.md)
- [Pinned dependency notes](../vendor/mupdf/README.md)
- [Official MuPDF.js licensing guidance](https://mupdfjs.readthedocs.io/en/latest/faq/index.html#licensing)
- [GNU AGPL license](https://www.gnu.org/licenses/agpl.en.html)
- [GNU guidance on source hosted separately from binaries](https://www.gnu.org/licenses/gpl-faq.en.html#SourceAndBinaryOnDifferentSites)
- [GNU guidance on applying license notices and offering source](https://www.gnu.org/licenses/gpl-howto.en.html)
