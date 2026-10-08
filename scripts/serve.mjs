// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Element Express, Inc.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT || 8011);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };
http.createServer(async (req, res) => {
    try {
        let filename = path.resolve(root, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
        if (filename !== path.resolve(root) && !filename.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid path");
        if ((await stat(filename)).isDirectory()) filename = path.join(filename, "index.html");
        const bytes = await readFile(filename);
        res.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(bytes);
    } catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log(`PDF editor: http://127.0.0.1:${port}/`));
