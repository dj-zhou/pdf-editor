// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.resolve(root, process.argv[2] || "dist");
const sourceRoot = path.resolve(root);
if (target === sourceRoot || sourceRoot.startsWith(target + path.sep) ||
    (target.startsWith(sourceRoot + path.sep) && target !== path.join(sourceRoot, "dist"))) {
    throw new Error("Use dist/ or an output directory outside the repository; do not overwrite source files.");
}
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of ["index.html", "i18n.mjs", "embed.mjs", "styles", "locales", "pdf-tools", "vendor", "LICENSE", "THIRD_PARTY_NOTICES.md"])
    await cp(path.join(root, name), path.join(target, name), { recursive: true });
console.log(`Standalone PDF editor built in ${target}`);
