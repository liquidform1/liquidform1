// Wisp upstream pool + relay. The browser only talks to THIS server at /wisp/.
// Upstream names/URLs never leave the backend. Set WISP_UPSTREAMS (comma
// separated wss:// URLs) to override the default pool.
const WebSocket = require("ws");

const DEFAULT_UPSTREAMS = [
  "wss://wisp.mercurywork.shop/",
  "wss://anura.pro/",
  "wss://lunarrr.eminescusm.ro/w/",
  "wss://dash.goip.de/wisp/",
];

function parseUpstreams() {
  const raw = (process.env.WISP_UPSTREAMS || "").trim();
  const list = raw ? raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : DEFAULT_UPSTREAMS;
  return list.filter((u) => /^wss?:\/\//i.test(u));
}

const PROBE_TIMEOUT = 3500;
const CHECK_INTERVAL = Number(process.env.WISP_CHECK_INTERVAL_MS) || 30000;
const COOLDOWN_MS = 20000;

class WispPool {
  constructor(urls = parseUpstreams()) {
    this.nodes = urls.map((url) => ({ url, ok: null, latency: Infinity, failUntil: 0, fails: 0 }));
    this.timer = null;
  }
  start() {
    this.checkAll();
    this.timer = setInterval(() => this.checkAll(), CHECK_INTERVAL);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); }

  probe(node) {
    return new Promise((resolve) => {
      const started = Date.now();
      let done = false, ws;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws && ws.terminate(); } catch {}
        resolve({ ok, latency: ok ? Date.now() - started : Infinity });
      };
      const timer = setTimeout(() => finish(false), PROBE_TIMEOUT);
      try {
        ws = new WebSocket(node.url, { handshakeTimeout: PROBE_TIMEOUT, perMessageDeflate: false });
        ws.on("open", () => finish(true));
        ws.on("error", () => finish(false));
        ws.on("close", () => finish(false));
      } catch { finish(false); }
    });
  }

  async checkAll() {
    const results = await Promise.all(this.nodes.map((n) => this.probe(n)));
    results.forEach((r, i) => {
      const n = this.nodes[i];
      n.ok = r.ok; n.latency = r.latency;
      if (r.ok) { n.fails = 0; n.failUntil = 0; } else n.fails++;
    });
  }

  ordered() {
    const now = Date.now();
    const score = (n) => {
      if (n.failUntil > now) return 1e9 + n.fails;
      if (n.ok === false) return 1e8 + n.fails;
      if (n.ok === null) return 1e4;
      return n.latency;
    };
    return [...this.nodes].sort((a, b) => score(a) - score(b));
  }

  markFailed(url) {
    const n = this.nodes.find((x) => x.url === url);
    if (!n) return;
    n.fails++;
    n.failUntil = Date.now() + COOLDOWN_MS;
  }

  reportFailure() {
    const best = this.ordered()[0];
    if (best) this.markFailed(best.url);
    this.checkAll();
  }

  // Anonymous: never includes names or URLs.
  summary() {
    const best = this.ordered().find((n) => n.ok && n.failUntil <= Date.now());
    return { online: !!best, latency: best ? best.latency : null, pool: this.nodes.length };
  }

  async connect(protocols) {
    let lastErr = new Error("no upstream available");
    for (const node of this.ordered()) {
      try {
        const ws = await openUpstream(node.url, protocols);
        node.ok = true; node.fails = 0;
        return { ws, url: node.url };
      } catch (err) {
        lastErr = err; node.ok = false; this.markFailed(node.url);
      }
    }
    throw lastErr;
  }
}

function openUpstream(url, protocols) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url, protocols && protocols.length ? protocols : undefined, {
      handshakeTimeout: 6000, perMessageDeflate: false,
    });
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch {}
      reject(err instanceof Error ? err : new Error("upstream failed"));
    };
    ws._early = [];
    ws.on("message", (data, isBinary) => { if (!ws._attached) ws._early.push([data, isBinary]); });
    ws.once("open", () => { if (settled) return; settled = true; resolve(ws); });
    ws.once("error", fail);
    ws.once("close", () => fail(new Error("closed during handshake")));
  });
}

function bridge(client, upstream) {
  upstream._attached = true;
  const toClient = (d, b) => { if (client.readyState === WebSocket.OPEN) client.send(d, { binary: b }); };
  const toUpstream = (d, b) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(d, { binary: b }); };
  for (const [d, b] of upstream._early) toClient(d, b);
  upstream._early = [];
  upstream.on("message", toClient);
  client.on("message", toUpstream);
  const closeBoth = (code) => {
    const safe = code && code !== 1005 && code !== 1006 && code < 5000 ? code : 1011;
    try { client.close(safe); } catch {}
    try { upstream.close(); } catch {}
    setTimeout(() => { try { client.terminate(); } catch {} try { upstream.terminate(); } catch {} }, 2000).unref?.();
  };
  upstream.on("close", (c) => closeBoth(c));
  client.on("close", () => closeBoth(1000));
  upstream.on("error", () => closeBoth(1011));
  client.on("error", () => closeBoth(1011));
}

module.exports = { WispPool, bridge };
