/**
 * Production static file server.
 * - Adds COOP/COEP headers (required for SharedArrayBuffer / cross-origin isolation)
 * - Handles HTTP Range requests (required for WGB streaming / ZIP random access)
 * - SPA fallback: unknown paths → index.html
 */
import path from "path";

const DIST = path.resolve(import.meta.dir, "..", "dist");
const PORT = parseInt(process.env.PORT ?? "5173");

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".wgb": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
};

const COOP_COEP = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
};

Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    async fetch(req) {
        const url = new URL(req.url);
        let pathname = decodeURIComponent(url.pathname);

        // SPA fallback for extensionless paths
        if (!path.extname(pathname)) pathname = "/index.html";

        const filePath = path.join(DIST, pathname);

        // Prevent path traversal
        if (!filePath.startsWith(DIST + path.sep) && filePath !== DIST) {
            return new Response("Forbidden", { status: 403 });
        }

        const ext = path.extname(filePath).toLowerCase();
        const file = Bun.file(filePath);
        const fileSize = await file.size;

        if (fileSize === 0 && !(await file.exists())) {
            // SPA fallback only for extensionless paths — never for binary assets
            if (!ext) {
                const index = Bun.file(path.join(DIST, "index.html"));
                if (await index.exists()) {
                    return new Response(index, {
                        headers: { "Content-Type": "text/html; charset=utf-8", ...COOP_COEP },
                    });
                }
            }
            return new Response("Not Found", { status: 404, headers: COOP_COEP });
        }
        const contentType = MIME[ext] ?? "application/octet-stream";
        const rangeHeader = req.headers.get("Range");

        if (rangeHeader) {
            const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
            if (!match) {
                return new Response("Invalid Range", { status: 416, headers: COOP_COEP });
            }

            const rawStart = match[1];
            const rawEnd = match[2];
            const start = rawStart ? parseInt(rawStart) : fileSize - parseInt(rawEnd);
            const end = rawEnd ? Math.min(parseInt(rawEnd), fileSize - 1) : fileSize - 1;

            if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
                return new Response("Range Not Satisfiable", {
                    status: 416,
                    headers: { "Content-Range": `bytes */${fileSize}`, ...COOP_COEP },
                });
            }

            return new Response(file.slice(start, end + 1), {
                status: 206,
                headers: {
                    "Content-Type": contentType,
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Content-Length": String(end - start + 1),
                    "Accept-Ranges": "bytes",
                    ...COOP_COEP,
                },
            });
        }

        return new Response(file, {
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(fileSize),
                "Accept-Ranges": "bytes",
                ...COOP_COEP,
            },
        });
    },
});

console.log(`Serving /app/dist on http://0.0.0.0:${PORT}`);
