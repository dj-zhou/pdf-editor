// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.

export function hostViewport(event, host, origin) {
    if (event.source !== host || event.origin !== origin || event.data?.type !== "pdf-editor:viewport") return null;
    const { top, height } = event.data;
    if (!Number.isFinite(top) || top < 0 || top > 100000 ||
        !Number.isFinite(height) || height < 1 || height > 10000) return null;
    return { top, height };
}
