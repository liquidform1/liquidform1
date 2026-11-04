# Deploying Liquidform on Render

One Node web service (`server.js`) serves `frontend/public/` and runs the backend pieces:

| Path | Purpose |
| --- | --- |
| `/wisp/` | WebSocket relay to a hidden pool of upstream wisp servers |
| `/api/net/*` | Anonymous connection status (online / latency only) |
| `/api/g4m3s`, `/g4m3s-files/*` | Game list + files from the Offline HTML Games Pack |
| `/api/ai/chat` | Liquidform AI (OpenRouter; key stays server-side) |
| `/icons/<name>.png` | Tab-cloak icons, cached server-side |

## Deploy
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo (reads `render.yaml`).
   Or **New → Web Service**: Build `npm install`, Start `npm start`, Health check `/healthz`.
3. *(Optional)* add `OPENROUTER_API_KEY` under Environment for the AI page.

Games: the pack is ~5.7 GB, too big to download at build time, so the list of 352 games ships in
`server/g4m3s-manifest.json`. Each game is fetched from GitHub the first time someone plays it (a large one
can take 10-30 s) and cached on disk; old files are evicted past `GAMES_CACHE_MB` (default 1500). Render's
disk is wiped on every redeploy/restart, so the cache simply refills as people play.

Covers: put an image named after the game's slug (e.g. `drift-hunters-pro.png`) in
`frontend/public/covers/`. Games without one show the Liquidform logo. Slugs are in the manifest.

Render's free plan sleeps after ~15 min idle (first visit afterwards takes a few seconds).
Vercel/Netlify can't host the `/wisp/` WebSocket relay, so their configs were removed.

## Hidden proxy pool
- Upstreams live only in `server/wisp-pool.js` or the `WISP_UPSTREAMS` env var.
- The backend pings them every 30 s and gives each new `/wisp/` connection to the fastest healthy
  one, silently trying the next if one fails.
- If pages stop loading, the browser reports it, the backend demotes the current best for 20 s,
  and the browser reconnects. Settings → Network shows only status + "Re-optimize connection".

## Local preview
```
npm install
npm start       # http://localhost:3000
```

## Open Cloaked launcher
`index.html` is a launcher. **Open Cloaked** opens the site in a normal new tab (`/?cloaked=true`) with the
chosen cloak title/icon, and sends the original tab to classroom.google.com. The app pages only run inside
that cloaked tab (`guard.js` sends direct visits back to the launcher). Visitors must allow pop-ups.
