// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
import { LOCALES, MESSAGES } from "./locales/catalog.mjs";
export { LOCALES, MESSAGES };
const requested = new URL(globalThis.location?.href || "http://localhost/").searchParams.get("lang");
export const locale = Object.keys(LOCALES).find(key => key.toLowerCase() === requested?.toLowerCase()) || "en";
export function t(message, variables = {}) {
    return (MESSAGES[locale]?.[message] || message).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
        (match, name) => Object.hasOwn(variables, name) ? String(variables[name]) : match);
}
if (typeof document !== "undefined") {
    document.documentElement.lang = LOCALES[locale].languageTag;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest("script, style")) continue;
        const key = node.textContent.trim().replace(/\s+/g, " ");
        if (MESSAGES[locale]?.[key]) node.textContent = node.textContent.replace(node.textContent.trim(), t(key));
    }
    for (const el of document.querySelectorAll("*")) for (const key of ["aria-label", "placeholder", "title", "content"]) {
        if (el.hasAttribute(key)) el.setAttribute(key, t(el.getAttribute(key)));
    }
    document.title = t("Edit PDF Text");
}
