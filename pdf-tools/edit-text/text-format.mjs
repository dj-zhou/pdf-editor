// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
import { BUNDLED_FONTS, fontVariants } from "./font-catalog.mjs";

// A format contains only overrides; omitted properties preserve source styles.
export function normalizeFormat(format = {}) {
    if (!format || typeof format !== "object" || Array.isArray(format)) throw new Error("Invalid text formatting.");
    const result = {};
    const rules = {
        font: v => ["sans", "serif", "mono"].includes(v) || Object.hasOwn(BUNDLED_FONTS, v),
        size: v => Number.isFinite(v) && v >= 1 && v <= 300,
        bold: v => typeof v === "boolean",
        italic: v => typeof v === "boolean",
        underline: v => typeof v === "boolean",
        strike: v => typeof v === "boolean",
        color: v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v),
        align: v => ["left", "center", "right"].includes(v),
        letterSpacing: v => Number.isFinite(v) && v >= -5 && v <= 30,
        lineSpacing: v => Number.isFinite(v) && v >= 0.5 && v <= 3
    };
    for (const key of Object.keys(format)) if (!Object.hasOwn(rules, key)) throw new Error("Invalid text formatting.");
    for (const [key, valid] of Object.entries(rules)) if (Object.hasOwn(format, key)) {
        if (!valid(format[key])) throw new Error("Invalid text formatting.");
        result[key] = key === "color" ? format[key].toLowerCase() : format[key];
    }
    if (result.font) {
        const variants = fontVariants(result.font);
        if (!variants.includes("Bold")) result.bold = false;
        if (!variants.includes("Italic")) result.italic = false;
    }
    return result;
}
