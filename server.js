// Liquidform server (Render web service).
//  - serves frontend/public
//  - /wisp/          WebSocket relay to a hidden, health-checked pool of upstream wisp servers
//  - /api/net/*      anonymous connection status / failure reporting (no names, no URLs)
//  - /api/g4m3s      game catalogue | /g4m3s-files/*  game files (fetched from GitHub on first play, then cached)
//  - /api/ai/chat    Liquidform AI (OpenRouter)
//  - /icons/<key>.png  tab-cloak icons, fetched + cached server side
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { promisify } = require("util");
const { WebSocketServer } = require("ws");

const { WispPool, bridge } = require("./server/wisp-pool");
const games = require("./server/games");
const ai = require("./server/ai");

const gzip = promisify(zlib.gzip);
const ROOT = path.resolve(__dirname, "frontend", "public");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const MAX_WISP_CLIENTS = Number(process.env.MAX_WISP_CLIENTS) || 400;

const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm", ".ico": "image/x-icon", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".mp4": "video/mp4", ".webm": "video/webm", ".xml": "application/xml",
};
const COMPRESSIBLE = new Set([".html", ".htm", ".js", ".mjs", ".css", ".json", ".wasm", ".svg", ".txt", ".xml", ".map"]);

const pool = new WispPool();
pool.start();

function send(res, status, body, headers = {}) { res.writeHead(status, headers); res.end(body); }
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
}
function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const gzCache = new Map();
async function getGzip(file, stat) {
  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (gzCache.has(key)) return gzCache.get(key);
  const buf = await gzip(await fs.promises.readFile(file), { level: 6 });
  if (gzCache.size > 60) gzCache.delete(gzCache.keys().next().value);
  gzCache.set(key, buf);
  return buf;
}

function cacheControlFor(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (rel === "sw.js") return "no-cache";
  if (/^(engine|data|images)\//.test(rel)) return "public, max-age=86400";
  return "no-cache";
}

async function serveFile(req, res, file, stat, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Last-Modified": stat.mtime.toUTCString(),
    "ETag": `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    "Cache-Control": opts.cache || cacheControlFor(file),
  };
  if (path.basename(file) === "sw.js") headers["Service-Worker-Allowed"] = "/";
  if (req.headers["if-none-match"] === headers.ETag) { res.writeHead(304, headers); return res.end(); }

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const size = stat.size;
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (m[1] === "" && m[2] !== "") { start = Math.max(size - parseInt(m[2], 10), 0); end = size - 1; }
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
      end = Math.min(end, size - 1);
      headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      headers["Content-Length"] = end - start + 1;
      res.writeHead(206, headers);
      return fs.createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
    }
  }

  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "") && stat.size > 1024) {
    try {
      const buf = await getGzip(file, stat);
      headers["Content-Encoding"] = "gzip"; headers["Vary"] = "Accept-Encoding"; headers["Content-Length"] = buf.length;
      res.writeHead(200, headers);
      return req.method === "HEAD" ? res.end() : res.end(buf);
    } catch {}
  }
  headers["Content-Length"] = stat.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

function resolveInside(base, urlPath) {
  const target = path.resolve(base, "." + path.posix.normalize("/" + urlPath));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}
function notFound(res) {
  fs.readFile(path.join(ROOT, "404.html"), (e, buf) => e ? send(res, 404, "Not Found") : send(res, 404, buf, { "Content-Type": "text/html; charset=utf-8" }));
}

const ICON_DOMAINS = {
  classroom: "classroom.google.com", docs: "docs.google.com", drive: "drive.google.com",
  slides: "slides.google.com", gmail: "mail.google.com", clever: "clever.com",
  canvas: "canvas.instructure.com", wikipedia: "wikipedia.org", khan: "khanacademy.org",
};
const iconCache = new Map();
async function serveIcon(res, key) {
  const domain = ICON_DOMAINS[key];
  if (!domain) return notFound(res);
  let buf = iconCache.get(key);
  if (!buf) {
    try {
      const r = await fetch(`https://www.google.com/s2/favicons?sz=128&domain=${domain}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error("icon " + r.status);
      buf = Buffer.from(await r.arrayBuffer());
      iconCache.set(key, buf);
    } catch { return send(res, 404, "icon unavailable"); }
  }
  send(res, 200, buf, { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" });
}

const server = http.createServer(async (req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(res, 400, "Bad Request"); }
  try {
    if (urlPath === "/healthz") return json(res, 200, { ok: true });
    if (urlPath === "/api/net/status" && req.method === "GET") return json(res, 200, pool.summary());
    if (urlPath === "/api/net/failure" && req.method === "POST") { pool.reportFailure(); return json(res, 200, { ok: true }); }
    if (urlPath === "/api/net/refresh" && req.method === "POST") { await pool.checkAll(); return json(res, 200, pool.summary()); }
    if (urlPath === "/api/g4m3s" && req.method === "GET") return json(res, 200, { games: games.listGames() });
    if (urlPath === "/api/ai/chat") {
      if (req.method !== "POST") return json(res, 405, { detail: "Method not allowed" });
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { detail: "invalid JSON" }); }
      const out = await ai.chat(body);
      return json(res, out.status, out.body);
    }
    const iconMatch = /^\/icons\/([a-z]+)\.png$/.exec(urlPath);
    if (iconMatch) return serveIcon(res, iconMatch[1]);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");

    if (urlPath.startsWith("/g4m3s-files/")) {
      if (await games.serveGame(req, res, urlPath.slice("/g4m3s-files/".length))) return;
      return notFound(res);
    }

    let target = resolveInside(ROOT, urlPath);
    if (!target) return send(res, 403, "Forbidden");
    let st = await fs.promises.stat(target).catch(() => null);
    if (st && st.isDirectory()) { target = path.join(target, "index.html"); st = await fs.promises.stat(target).catch(() => null); }
    if (!st || !st.isFile()) return notFound(res);
    return serveFile(req, res, target, st);
  } catch (err) {
    console.error("request error:", err);
    if (!res.headersSent) send(res, 500, "Internal Server Error"); else res.destroy();
  }
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
let wispClients = 0;

server.on("upgrade", async (req, socket, head) => {
  let pathname = "";
  try { pathname = new URL(req.url, "http://x").pathname; } catch {}
  if (!/^\/wisp\/?/.test(pathname)) { socket.destroy(); return; }
  if (wispClients >= MAX_WISP_CLIENTS) { socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"); return socket.destroy(); }
  socket.on("error", () => {});
  const wanted = String(req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  let upstream;
  try { upstream = (await pool.connect(wanted)).ws; }
  catch { socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (client) => {
    wispClients++;
    client.on("close", () => { wispClients--; });
    bridge(client, upstream);
  });
});

server.listen(PORT, HOST, () => console.log(`Liquidform running on http://${HOST}:${PORT}`));
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { pool.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
}
