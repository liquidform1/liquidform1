/* oxlint-disable no-undef */
/* eslint-disable no-undef */
/* global importScripts, BareMux, registration, clients, $scramjetLoadWorker, ScramjetServiceWorker, ScramjetController */

const ADBLOCK = {
    blocked: [
  "googlevideo.com/videoplayback",
  "youtube.com/get_video_info",
  "youtube.com/api/stats/ads",
  "youtube.com/pagead",
  "youtube.com/api/stats",
  "youtube.com/get_midroll",
  "youtube.com/ptracking",
  "youtube.com/youtubei/v1/player",
  "youtube.com/s/player",
  "youtube.com/api/timedtext",
  "facebook.com/ads",
  "facebook.com/tr",
  "fbcdn.net/ads",
  "graph.facebook.com/ads",
  "graph.facebook.com/pixel",
  "ads-api.twitter.com",
  "analytics.twitter.com",
  "twitter.com/i/ads",
  "ads.yahoo.com",
  "advertising.com",
  "adtechus.com",
  "amazon-adsystem.com",
  "adnxs.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "rubiconproject.com",
  "pubmatic.com",
  "criteo.com",
  "openx.net",
  "taboola.com",
  "outbrain.com",
  "moatads.com",
  "casalemedia.com",
  "unityads.unity3d.com",
  "/ads/",
  "/adserver/",
  "/banner/",
  "/promo/",
  "/tracking/",
  "/beacon/",
  "/metrics/",
  "adsafeprotected.com",
  "chartbeat.com",
  "scorecardresearch.com",
  "quantserve.com",
  "krxd.net",
  "demdex.net"
]   
};

function isAdBlocked(url) {
    const urlStr = url.toString();
    for (const pattern of ADBLOCK.blocked) {
        let regexPattern = pattern
            .replace(/\*/g, '.*')
            .replace(/\./g, '\\.')
            .replace(/\?/g, '\\?');
        const regex = new RegExp('^' + regexPattern + '$', 'i');
        if (regex.test(urlStr)) {
            return true;
        }
    }
    return false;
}

const swPath = self.location.pathname;
const basePath = swPath.substring(0, swPath.lastIndexOf('/') + 1);
self.basePath = self.basePath || basePath;

self.$scramjet = {
    files: {
        wasm: basePath + "engine/scramjet.wasm.wasm",
        sync: basePath + "engine/scramjet.sync.js",
    }
};

importScripts(basePath + "engine/scramjet.all.js");
importScripts("https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux@2.1.9/dist/index.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker({
    prefix: basePath + "scramjet/"
});

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Network: the browser only ever connects to THIS origin at /wisp/. The backend
// owns the upstream list, health-checks it, picks the fastest and fails over.
const WISP_URL = (self.location.protocol === "https:" ? "wss://" : "ws://") + self.location.host + "/wisp/";
const EPOXY_URL = "https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-transport@2.1.28/dist/index.mjs";
const BARE_WORKER = basePath + "bareworker.js";

async function ensureClient() {
    if (scramjet.client) return;
    const connection = new BareMux.BareMuxConnection(BARE_WORKER);
    await connection.setTransport(EPOXY_URL, [{ wisp: WISP_URL }]);
    scramjet.connection = connection;
    scramjet.client = new BareMux.BareClient(BARE_WORKER);
}

// Drop the connection and open a fresh one; the backend assigns it to the best
// healthy upstream. Coalesced so a burst of failures triggers one reconnect.
let reconnectPromise = null;
let lastReconnect = 0;
function reconnect(reportFailure) {
    if (reconnectPromise) return reconnectPromise;
    if (Date.now() - lastReconnect < 3000) return Promise.resolve();
    reconnectPromise = (async () => {
        if (reportFailure) { try { await fetch("/api/net/failure", { method: "POST" }); } catch {} }
        scramjet.client = null;
        scramjet.connection = null;
        await ensureClient();
        lastReconnect = Date.now();
    })().finally(() => { reconnectPromise = null; });
    return reconnectPromise;
}

// Some CDNs (notably cdn.jsdelivr.net/gh/ and raw.githubusercontent.com) serve
// game .html files as "text/plain" with "nosniff", so a proxied iframe would
// render the raw markup instead of running the g4m3. Force an HTML content-type
// for .html/.htm documents mis-served as text so Scramjet renders + rewrites
// them (and their assets keep flowing through the pr0xy).
function fixGameContentType(url, resp) {
    try {
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("text/plain")) return resp;
        let path;
        try { path = new URL(url).pathname.toLowerCase(); } catch { path = String(url).toLowerCase(); }
        if (!(path.endsWith(".html") || path.endsWith(".htm"))) return resp;
        // IMPORTANT: Scramjet builds the FINAL response headers from
        // `response.rawHeaders` (a BareClient-specific plain object), not from
        // `response.headers`. Creating a new Response() loses rawHeaders, so the
        // browser kept receiving the upstream `text/plain`. Mutate rawHeaders in
        // place (and mirror onto .headers when it is mutable) and return the SAME
        // response object so Scramjet's rewriter + header path both see text/html.
        const raw = resp.rawHeaders;
        if (raw && typeof raw === "object") {
            for (const k of Object.keys(raw)) {
                const lk = k.toLowerCase();
                if (lk === "content-type" || lk === "x-content-type-options") delete raw[k];
            }
            raw["content-type"] = "text/html; charset=utf-8";
        }
        try {
            resp.headers.set("content-type", "text/html; charset=utf-8");
            resp.headers.delete("x-content-type-options");
            return resp;
        } catch (e) {
            const headers = new Headers(resp.headers);
            headers.set("content-type", "text/html; charset=utf-8");
            headers.delete("x-content-type-options");
            const out = new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
            try { Object.defineProperty(out, "rawHeaders", { value: raw, configurable: true }); } catch (e2) {}
            try { Object.defineProperty(out, "finalURL", { value: resp.finalURL, configurable: true }); } catch (e2) {}
            return out;
        }
    } catch (e) {
        return resp;
    }
}

self.addEventListener("message", ({ data }) => {
    if (data && data.type === "reconnect") reconnect(!!data.reportFailure);
});

self.addEventListener("fetch", (event) => {
    event.respondWith((async () => {
        if (isAdBlocked(event.request.url)) {
            return new Response(new ArrayBuffer(0), { status: 204 });
        }
        await scramjet.loadConfig();
        if (scramjet.route(event)) return scramjet.fetch(event);
        return fetch(event.request);
    })());
});

scramjet.addEventListener("request", async (e) => {
    e.response = (async () => {
        await ensureClient();
        const MAX_RETRIES = 2;
        let lastErr;
        for (let i = 0; i <= MAX_RETRIES; i++) {
            try {
                const resp = await scramjet.client.fetch(e.url, {
                    method: e.method, body: e.body, headers: e.requestHeaders,
                    credentials: "include", mode: e.mode === "cors" ? e.mode : "same-origin",
                    cache: e.cache, redirect: "manual", duplex: "half",
                });
                return fixGameContentType(e.url, resp);
            } catch (err) {
                lastErr = err;
                const m = String((err && err.message) || err).toLowerCase();
                const retryable = ["connect", "eof", "handshake", "reset", "closed", "websocket", "wisp"].some(k => m.includes(k));
                if (!retryable || i === MAX_RETRIES || e.method !== "GET") break;
                try { await reconnect(true); } catch {}
                await new Promise(r => setTimeout(r, 400 * (i + 1)));
            }
        }
        console.error("Scramjet Final Fetch Error:", lastErr);
        return new Response("Scramjet Fetch Error: " + (lastErr && lastErr.message), { status: 502 });
    })();
});
