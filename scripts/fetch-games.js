// Downloads the Offline HTML Games Pack into ./games-pack (or $GAMES_DIR).
// Never fails the build; the g4m3s page shows a friendly message if empty.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO = "https://github.com/CoolDude2349/Offline-HTML-Games-Pack.git";
const DEST = path.resolve(process.env.GAMES_DIR || path.join(__dirname, "..", "games-pack"));

function count(dir) {
  let n = 0; const stack = [dir];
  while (stack.length) {
    const d = stack.pop(); let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p); else if (/\.html?$/i.test(e.name)) n++;
    }
  }
  return n;
}

if (fs.existsSync(DEST) && count(DEST) > 0) { console.log(`[g4m3s] ${count(DEST)} games already present`); process.exit(0); }
fs.rmSync(DEST, { recursive: true, force: true });
console.log("[g4m3s] cloning", REPO);
const r = spawnSync("git", ["clone", "--depth", "1", REPO, DEST], { stdio: "inherit" });
if (r.status !== 0) { console.warn("[g4m3s] clone failed - continuing without games"); process.exit(0); }
fs.rmSync(path.join(DEST, ".git"), { recursive: true, force: true });
console.log(`[g4m3s] ready: ${count(DEST)} html files`);
