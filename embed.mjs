// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
// The embedding page receives layout information only; PDFs and edits stay in this app.
const params = new URL(location.href).searchParams;
if (params.get("embed") === "1" && parent !== window) {
    document.documentElement.dataset.embedded = "true";
    let parentOrigin;
    try { parentOrigin = new URL(document.referrer).origin; } catch {}
    if (parentOrigin) {
        let previousHeight = 0;
        const reportHeight = () => {
            const height = Math.ceil(document.body.getBoundingClientRect().height);
            if (height !== previousHeight) {
                previousHeight = height;
                parent.postMessage({ type: "pdf-editor:height", height }, parentOrigin);
            }
        };
        const observer = new ResizeObserver(reportHeight);
        observer.observe(document.body);
        // Cross-origin frames hidden during loading may not receive an initial
        // ResizeObserver callback in Chrome. Measure now to unblock the host.
        reportHeight();
    }
}
