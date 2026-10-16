// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
export const BUNDLED_FONTS = {
    arial: { name: "LiberationSans", file: "liberation/LiberationSans" },
    "times-new-roman": { name: "LiberationSerif", file: "liberation/LiberationSerif" },
    "courier-new": { name: "Cousine", file: "cousine/Cousine" },
    lato: { name: "Lato", file: "lato/Lato" },
    crimson: { name: "Crimson Text", file: "crimsontext/CrimsonText" },
    michroma: { name: "Michroma", file: "michroma/Michroma", variants: ["Regular"] },
    orbitron: { name: "Orbitron", file: "orbitron/Orbitron", variants: ["Regular", "Bold"] }
};
export const FONT_VARIANTS = ["Regular", "Bold", "Italic", "BoldItalic"];
export const fontVariants = font => BUNDLED_FONTS[font]?.variants || FONT_VARIANTS;
export const fontVariant = (bold, italic) => bold ? (italic ? "BoldItalic" : "Bold") : (italic ? "Italic" : "Regular");
