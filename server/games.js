// G4m3s backend.
//
// The Offline HTML Games Pack is ~5.7 GB, far too big to download during a
// Render build. Instead the list of games ships in g4m3s-manifest.json and each
// game file is fetched from GitHub the first time someone plays it, streamed to
// the player, and cached on disk (oldest files evicted past GAMES_CACHE_MB).
//
// Covers: drop an image named <slug>.png|jpg|jpeg|webp|gif|svg into
// frontend/public/covers/ and it is picked up automatically. Games without one
// use the Liquidform logo.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");

const MANIFEST = require("./g4m3s-manifest.json");
const COVERS_DIR = path.resolve(__dirname, "..", "frontend", "public", "covers");
const LOGO = "/images/logo.png";
const CACHE_DIR = path.resolve(process.env.GAMES_CACHE_DIR || path.join(os.tmpdir(), "liquidform-games"));
const CACHE_LIMIT = (Number(process.env.GAMES_CACHE_MB) || 1500) * 1024 * 1024;
// Override for self-hosting a mirror (or tests). Must end with "/".
const RAW_BASE = (process.env.GAMES_RAW_BASE ||
  `https://raw.githubusercontent.com/${MANIFEST.repo}/${MANIFEST.branch}/${MANIFEST.dir}/`).replace(/\/?$/, "/");
// Optional local copy of the pack's offline/ folder; served first if present.
const LOCAL_DIR = process.env.GAMES_DIR ? path.resolve(process.env.GAMES_DIR) : null;

const byFile = new Map(MANIFEST.games.map((g) => [g.file, g]));
fs.mkdirSync(CACHE_DIR, { recursive: true });

function coverMap() {
  const map = new Map();
  try {
    for (const f of fs.readdirSync(COVERS_DIR)) {
      const m = /^(.+)\.(png|jpe?g|webp|gif|svg)$/i.exec(f);
      if (m) map.set(m[1].toLowerCase(), "/covers/" + encodeURIComponent(f));
    }
  } catch {}
  return map;
}

function listGames() {
  const covers = coverMap();
  return MANIFEST.games.map((g, id) => {
    const cover = covers.get(g.slug);
    return { id, name: g.name, url: "/g4m3s-files/" + encodeURIComponent(g.file), cover: cover || LOGO, hasCover: !!cover };
  });
}

// ---- file delivery ---------------------------------------------------------
const inflight = new Set();

function pruneCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => !f.endsWith(".part")).map((f) => {
      const p = path.join(CACHE_DIR, f); const st = fs.statSync(p);
      return { p, size: st.size, t: st.atimeMs || st.mtimeMs };
    });
    let total = files.reduce((a, f) => a + f.size, 0);
    files.sort((a, b) => a.t - b.t);
    for (const f of files) { if (total <= CACHE_LIMIT) break; try { fs.unlinkSync(f.p); total -= f.size; } catch {} }
  } catch {}
}

function htmlHeaders(extra = {}) {
  return { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=86400", ...extra };
}

// Resolves with true when the request was handled, false when the file is not a known game.
async function serveGame(req, res, relName) {
  const game = byFile.get(relName);
  if (!game) return false;

  const cached = path.join(CACHE_DIR, game.file);
  const local = LOCAL_DIR && path.join(LOCAL_DIR, game.file);
  for (const p of [local, cached]) {
    if (!p) continue;
    const st = await fs.promises.stat(p).catch(() => null);
    if (st && st.isFile()) {
      if (p === cached) fs.utimes(p, new Date(), st.mtime, () => {});
      res.writeHead(200, htmlHeaders({ "Content-Length": st.size }));
      if (req.method === "HEAD") { res.end(); return true; }
      fs.createReadStream(p).on("error", () => res.destroy()).pipe(res);
      return true;
    }
  }

  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });
  let up;
  try {
    up = await fetch(RAW_BASE + encodeURIComponent(game.file), { signal: ac.signal });
  } catch {
    if (!res.headersSent) { res.writeHead(502, { "Content-Type": "text/plain" }); res.end("Game source is unreachable right now. Try again in a moment."); }
    return true;
  }
  if (!up.ok || !up.body) {
    res.writeHead(up.status === 404 ? 404 : 502, { "Content-Type": "text/plain" });
    res.end("Couldn't load this game right now.");
    return true;
  }

  // GitHub serves .html as text/plain + nosniff, so we set our own type.
  const headers = htmlHeaders();
  const len = up.headers.get("content-length");
  if (len) headers["Content-Length"] = len;
  res.writeHead(200, headers);
  if (req.method === "HEAD") { ac.abort(); res.end(); return true; }

  const body = Readable.fromWeb(up.body);
  let part = null;
  if (!inflight.has(game.file)) {
    inflight.add(game.file);
    const tmp = path.join(CACHE_DIR, game.file + ".part");
    part = fs.createWriteStream(tmp);
    let ok = false;
    const done = (success) => {
      inflight.delete(game.file);
      if (success) fs.rename(tmp, cached, (e) => { if (!e) pruneCache(); });
      else fs.unlink(tmp, () => {});
    };
    body.on("end", () => { ok = true; });
    part.on("finish", () => done(ok));
    part.on("error", () => { try { part.destroy(); } catch {} done(false); });
    body.on("error", () => { try { part.destroy(); } catch {} });
    body.on("close", () => { if (!ok) { try { part.destroy(); } catch {} done(false); } });
    body.pipe(part);
  }
  body.on("error", () => res.destroy());
  body.pipe(res);
  return true;
}

module.exports = { listGames, serveGame, count: MANIFEST.games.length };
