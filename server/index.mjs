import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerEnv } from "./env.mjs";
import { createApiMiddleware } from "./api.mjs";

loadServerEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const dataDir = process.env.DATA_DIR || path.join(rootDir, "data");
const port = Number(process.env.PORT || 3000);

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
};

const apiMiddleware = createApiMiddleware(dataDir);

async function serveStatic(req, res) {
  const urlPath = new URL(req.url || "/", "http://localhost").pathname;
  const normalized = path.posix.normalize(urlPath);
  const relPath = normalized === "/" ? "index.html" : normalized.replace(/^\/+/, "");
  const candidate = path.resolve(distDir, relPath);

  if (!candidate.startsWith(distDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  let fileToServe = candidate;
  try {
    const stat = await fs.stat(fileToServe);
    if (stat.isDirectory()) {
      fileToServe = path.join(fileToServe, "index.html");
    }
  } catch {
    // SPA fallback to index.html for unknown client routes
    fileToServe = path.join(distDir, "index.html");
  }

  try {
    const data = await fs.readFile(fileToServe);
    const ext = path.extname(fileToServe).toLowerCase();
    const mime = STATIC_MIME[ext] || "application/octet-stream";
    const isAsset = fileToServe.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": data.length,
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found — run `npm run build` first.");
  }
}

export function startServer(customPort = port) {
  const server = http.createServer((req, res) => {
    apiMiddleware(req, res, () => {
      serveStatic(req, res);
    });
  });

  server.listen(customPort, "0.0.0.0", () => {
    console.log(`LazyMindmap server listening on http://0.0.0.0:${customPort} (data: ${dataDir})`);
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
