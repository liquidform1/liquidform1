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
   Or **New → Web Service**: Build `npm install && npm run build`, Start `npm start`, Health check `/healthz`.
3. *(Optional)* add `OPENROUTER_API_KEY` under Environment for the AI page.

The build clones the games pack into `games-pack/`. If that fails the site still deploys and the
server retries in the background; the G4m3s page shows "still being set up" until it lands.

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
npm run build   # optional: downloads games
npm start       # http://localhost:3000
```

## about:blank launcher
`index.html` is a launcher: **Open Cloaked** opens the app in a new cloaked tab and sends the original tab to classroom.google.com. The app (`window.html` and `pages/*`) only loads inside an `about:blank`
tab opened by **Open Cloaked** (`guard.js` redirects direct visits). Visitors must allow pop-ups.
