// Games catalogue built from the CoolDude2349/Offline-HTML-Games-Pack checkout.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const GAMES_DIR = path.resolve(process.env.GAMES_DIR || path.join(__dirname, "..", "games-pack"));
const SKIP_DIRS = new Set([".git", ".github", "node_modules", "__MACOSX"]);
const SKIP_FILES = new Set(["index.html", "readme.html", "404.html"]);

let cache = { at: 0, list: [] };
let fetching = false;
let lastTry = 0;

function prettify(file) {
  let n = file.replace(/\.html?$/i, "").replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  return n.split(" ").map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

function walk(dir, rel, out, depth) {
  if (depth > 4) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(dir, e.name);
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs, r, out, depth + 1); }
    else if (/\.html?$/i.test(e.name) && !SKIP_FILES.has(e.name.toLowerCase())) out.push({ name: prettify(e.name), file: r });
  }
}

function listGames() {
  if (cache.list.length && Date.now() - cache.at < 10 * 60 * 1000) return cache.list;
  const out = [];
  if (fs.existsSync(GAMES_DIR)) walk(GAMES_DIR, "", out, 0);
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const seen = new Set();
  const list = [];
  for (const g of out) {
    const key = g.name.toLowerCase();
    const name = seen.has(key) ? `${g.name} (${g.file.split("/").slice(0, -1).pop() || "alt"})` : g.name;
    seen.add(key);
    list.push({ id: list.length, name, url: "/g4m3s-files/" + g.file.split("/").map(encodeURIComponent).join("/") });
  }
  cache = { at: Date.now(), list };
  return list;
}

function ensureGames() {
  if (fetching) return;
  if (listGames().length) return;
  if (Date.now() - lastTry < 5 * 60 * 1000) return;
  lastTry = Date.now();
  fetching = true;
  console.log("[g4m3s] games folder empty - fetching in the background...");
  const p = spawn(process.execPath, [path.join(__dirname, "..", "scripts", "fetch-games.js")], {
    stdio: "inherit", env: { ...process.env, GAMES_DIR },
  });
  p.on("close", () => { fetching = false; cache = { at: 0, list: [] }; console.log("[g4m3s]", listGames().length, "games available"); });
}

module.exports = { GAMES_DIR, listGames, ensureGames };
