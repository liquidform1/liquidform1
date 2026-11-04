/* oxlint-disable no-undef */
/* eslint-disable no-undef */
/* global Notify, $scramjetLoadController, $scramjetLoadWorker, ScramjetController, BareMux, Cloak */

// The browser only talks to this site's own /wisp/ endpoint. The backend keeps
// the upstream server list private, health-checks it and switches automatically.
const WISP_URL = (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/wisp/";

// Clean up settings from older versions that stored server choices locally.
try { ["proxServer", "customWisps", "wispAutoswitch"].forEach(k => localStorage.removeItem(k)); } catch (e) {}

// =====================================================
// BROWSER STATE
// =====================================================
const BareMux = window.BareMux ?? { BareMuxConnection: class { setTransport() {} } };

// SINGLETON: Shared resources for all tabs (prevents connection exhaustion)
let sharedScramjet = null;
let sharedConnection = null;
let sharedConnectionReady = false;

let tabs = [];
let activeTabId = null;
let nextTabId = 1;

// =====================================================
// UTILITIES
// =====================================================
const getBasePath = () => {
    const basePath = location.pathname.replace(/[^/]*$/, '');
    return basePath.endsWith('/') ? basePath : basePath + '/';
};

const getActiveTab = () => tabs.find(t => t.id === activeTabId);

const notify = (type, title, message) => {
    if (typeof Notify !== 'undefined') {
        Notify[type](title, message);
    }
};

// =====================================================
// INITIALIZATION
// =====================================================
async function getSharedScramjet() {
    if (sharedScramjet) return sharedScramjet;

    const basePath = getBasePath();
    const { ScramjetController } = $scramjetLoadController();
    
    sharedScramjet = new ScramjetController({
        prefix: basePath + "scramjet/",
        files: {
            wasm: basePath + "engine/scramjet.wasm.wasm",
            all: basePath + "engine/scramjet.all.js",
            sync: basePath + "engine/scramjet.sync.js"
        }
    });

    // Expose a proxy-URL encoder so sub-pages (movies/games inside the proxy
    // frame) can route Internet Archive embeds through Scramjet + the WISP
    // transport. Returns a "/scramjet/<encoded>" path the SW (scope "/") proxies.
    window.flintProxyEncode = (u) => {
        try { return sharedScramjet ? sharedScramjet.encodeUrl(u) : null; }
        catch (e) { return null; }
    };
    
    try {
        await sharedScramjet.init();
    } catch (err) {
        if (err.message && err.message.includes('IDBDatabase') || err.message && err.message.includes('object stores')) {
            console.warn('Scramjet IndexedDB error, clearing cache and retrying...');
            
            try {
                const dbNames = ['scramjet-data', 'scrambase', 'ScramjetData'];
                for (const dbName of dbNames) {
                    const req = indexedDB.deleteDatabase(dbName);
                    req.onsuccess = () => console.log(`Cleared IndexedDB: ${dbName}`);
                    req.onerror = () => console.warn(`Failed to clear IndexedDB: ${dbName}`);
                }
            } catch (clearErr) {
                console.warn('Failed to clear IndexedDB:', clearErr);
            }
            
            sharedScramjet = null;
            return getSharedScramjet();
        }
        throw err;
    }
    
    return sharedScramjet;
}

async function getSharedConnection() {
    if (sharedConnectionReady) return sharedConnection;

    const basePath = getBasePath();
    sharedConnection = new BareMux.BareMuxConnection(basePath + "bareworker.js");
    await sharedConnection.setTransport(
        "https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-transport@2.1.28/dist/index.mjs",
        [{ wisp: WISP_URL }]
    );
    sharedConnectionReady = true;
    return sharedConnection;
}

// Open a fresh transport. The backend assigns each new connection to the best
// healthy upstream, so this is all the "auto switch" the client has to do.
async function reconnectNetwork(reportFailure) {
    if (reportFailure) { try { await fetch('/api/net/failure', { method: 'POST' }); } catch (e) {} }
    sharedConnectionReady = false;
    try { await getSharedConnection(); } catch (e) { console.warn('reconnect failed', e); }
    navigator.serviceWorker?.controller?.postMessage({ type: 'reconnect' });
}

async function initializeBrowser() {
    const root = document.getElementById("app");
    root.innerHTML = `
        <div class="browser-container">
            <div class="flex tabs" id="tabs-container"></div>
            <div class="flex nav">
                <button id="back-btn" title="Back"><i class="fa-solid fa-chevron-left"></i></button>
                <button id="fwd-btn" title="Forward"><i class="fa-solid fa-chevron-right"></i></button>
                <button id="reload-btn" title="Reload"><i class="fa-solid fa-rotate-right"></i></button>
                <div class="address-wrapper">
                    <input class="bar" id="address-bar" autocomplete="off" placeholder="Search or enter URL">
                    <button id="bookmark-btn" title="Bookmark this page"><i class="fa-regular fa-star"></i></button>
                    <button id="home-btn-nav" title="Home"><i class="fa-solid fa-house"></i></button>
                </div>
                <button id="devtools-btn" title="DevTools"><i class="fa-solid fa-code"></i></button>
                <button id="fullscreen-btn" title="Fullscreen"><i class="fa-solid fa-expand"></i></button>
                <button id="wisp-settings-btn" title="Settings"><i class="fa-solid fa-gear"></i></button>
            </div>
            <div class="loading-bar-container"><div class="loading-bar" id="loading-bar"></div></div>
            <div class="iframe-container" id="iframe-container">
                <div id="loading" class="message-container" style="display: none;">
                    <div class="message-content">
                        <div class="spinner"></div>
                        <h1 id="loading-title">Connecting</h1>
                        <p id="loading-url">+Loading ScramJet...</p>
                        <button id="skip-btn">Skip</button>
                    </div>
                </div>
                <div id="error" class="message-container" style="display: none;">
                    <div class="message-content">
                        <h1>Connection Error</h1>
                        <p id="error-message">An error occurred.</p>
                    </div>
                </div>
            </div>
        </div>`;

    const elements = {
        backBtn: document.getElementById('back-btn'),
        fwdBtn: document.getElementById('fwd-btn'),
        reloadBtn: document.getElementById('reload-btn'),
        addrBar: document.getElementById('address-bar'),
        skipBtn: document.getElementById('skip-btn')
    };

    elements.backBtn.onclick = () => getActiveTab()?.frame.back();
    elements.fwdBtn.onclick = () => getActiveTab()?.frame.forward();
    elements.reloadBtn.onclick = () => getActiveTab()?.frame.reload();
    document.getElementById('home-btn-nav').onclick = () => window.location.href = '../index.html';
    document.getElementById('devtools-btn').onclick = toggleDevTools;
    document.getElementById('fullscreen-btn').onclick = toggleFullscreen;
    document.getElementById('wisp-settings-btn').onclick = openSettings;
    document.getElementById('bookmark-btn').onclick = bookmarkCurrent;

    elements.skipBtn.onclick = () => {
        const tab = getActiveTab();
        if (tab) {
            tab.loading = false;
            showIframeLoading(false);
        }
    };

    elements.addrBar.onkeyup = (e) => e.key === 'Enter' && handleSubmit();
    elements.addrBar.onfocus = () => elements.addrBar.select();

    window.addEventListener('message', (e) => {
        if (e.data?.type === 'navigate') handleSubmit(e.data.url);
    });

    createTab(true);
    checkHashParameters();
}

// =====================================================
// TAB MANAGEMENT
// =====================================================
function createTab(makeActive = true) {
    const frame = sharedScramjet.createFrame();
    const tab = {
        id: nextTabId++,
        title: "New Tab",
        url: "/pages/nt.html",
        frame,
        loading: false,
        favicon: null,
        skipTimeout: null,
        loadStartTime: null
    };

    frame.frame.allow = "camera; microphone; display-capture; fullscreen; autoplay; clipboard-write; speaker-selection";
    frame.frame.src = "/pages/nt.html";

    frame.addEventListener("urlchange", (e) => {
        tab.url = e.url;
        tab.loading = true;
        tab.loadStartTime = Date.now();
        recordHistory(e.url);

        if (tab.id === activeTabId) {
            showIframeLoading(true, tab.url);
            updateBookmarkIcon();
        }

        try {
            const urlObj = new URL(e.url);
            tab.title = urlObj.hostname;
            tab.favicon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
        } catch {
            tab.title = "Browsing";
            tab.favicon = null;
        }
        
        updateTabsUI();
        updateAddressBar();
        updateLoadingBar(tab, 10);

        if (tab.skipTimeout) clearTimeout(tab.skipTimeout);
        tab.skipTimeout = setTimeout(() => {
            if (tab.loading && tab.id === activeTabId) {
                document.getElementById('skip-btn')?.style.setProperty('display', 'inline-block');
            }
        }, 200);
    });

    frame.frame.addEventListener('load', () => {
        // Detect a Scramjet/WISP fetch-failure page (e.g. "tls handshake eof")
        // and auto-recover by retrying on another pr0xy server.
        if (tab.url && tab.url.startsWith('http')) {
            try {
                const body = frame.frame.contentWindow.document.body;
                const txt = (body ? body.innerText : '').trim();
                if (txt.startsWith('Scramjet Fetch Error') || /tls handshake eof|hyper_util::client/i.test(txt)) {
                    handleProxyFailure(tab);
                    return;
                }
            } catch (e) { /* same-origin read failed: assume the page is fine */ }
        }

        tab.failover = 0; // successful load
        tab.loading = false;
        clearTimeout(tab.skipTimeout);

        if (tab.id === activeTabId) {
            showIframeLoading(false);
            const err = document.getElementById('error');
            if (err) err.style.display = 'none';
        }

        try {
            const title = frame.frame.contentWindow.document.title;
            if (title) tab.title = title;
        } catch { }

        if (frame.frame.contentWindow.location.href.includes('/pages/nt.html')) {
            tab.title = "New Tab";
            tab.url = "";
            tab.favicon = null;
        }

        updateTabsUI();
        updateAddressBar();
        updateLoadingBar(tab, 100);
    });

    tabs.push(tab);
    document.getElementById("iframe-container").appendChild(frame.frame);
    if (makeActive) switchTab(tab.id);
    return tab;
}

function showIframeLoading(show, url = '') {
    const loader = document.getElementById("loading");
    if (!loader) return;

    loader.style.display = show ? "flex" : "none";
    getActiveTab()?.frame.frame.classList.toggle('loading', show);

    if (show) {
        document.getElementById("loading-title").textContent = "Connecting";
        document.getElementById("loading-url").textContent = url || "Loading content...";
        document.getElementById("skip-btn").style.display = 'none';
    }
}

function switchTab(tabId) {
    activeTabId = tabId;
    const tab = getActiveTab();

    tabs.forEach(t => t.frame.frame.classList.toggle("hidden", t.id !== tabId));

    if (tab) {
        showIframeLoading(tab.loading, tab.url);
        
        const skipBtn = document.getElementById('skip-btn');
        if (tab.loading && tab.loadStartTime && skipBtn) {
            const elapsed = Date.now() - tab.loadStartTime;
            if (elapsed > 3000) skipBtn.style.display = 'inline-block';
        }
    }

    updateTabsUI();
    updateAddressBar();
}

function closeTab(tabId) {
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const tab = tabs[idx];
    clearTimeout(tab.skipTimeout);
    
    if (tab.frame?.frame) {
        tab.frame.frame.src = 'about:blank';
        tab.frame.frame.remove();
    }
    
    tabs.splice(idx, 1);

    if (activeTabId === tabId) {
        if (tabs.length > 0) switchTab(tabs[Math.max(0, idx - 1)].id);
        else window.location.reload();
    } else {
        updateTabsUI();
    }
}

function updateTabsUI() {
    const container = document.getElementById("tabs-container");
    container.innerHTML = "";

    tabs.forEach(tab => {
        const el = document.createElement("div");
        el.className = `tab ${tab.id === activeTabId ? "active" : ""}`;

        const iconHtml = tab.loading 
            ? `<div class="tab-spinner"></div>`
            : tab.favicon 
                ? `<img src="${tab.favicon}" class="tab-favicon" onerror="this.style.display='none'">`
                : '';

        el.innerHTML = `${iconHtml}<span class="tab-title">${tab.title}</span><span class="tab-close">&times;</span>`;
        el.onclick = () => switchTab(tab.id);
        el.querySelector(".tab-close").onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
        container.appendChild(el);
    });

    const newBtn = document.createElement("button");
    newBtn.className = "new-tab";
    newBtn.innerHTML = "<i class='fa-solid fa-plus'></i>";
    newBtn.onclick = () => createTab(true);
    container.appendChild(newBtn);
}

function updateAddressBar() {
    const bar = document.getElementById("address-bar");
    const tab = getActiveTab();
    if (bar && tab) {
        bar.value = (tab.url && !tab.url.includes("/pages/nt.html")) ? tab.url : "";
    }
}

function handleSubmit(url) {
    const tab = getActiveTab();
    if (!tab) return;

    let input = url ?? document.getElementById("address-bar").value.trim();
    if (!input) return;

    if (!input.startsWith('http')) {
        // Gets the URL from the dropdown in your HTML settings
        const engineSelect = document.getElementById('search-engine-select');
        const engineBase = engineSelect?.value || "https://search.brave.com/search?q=";
        
        // If it looks like a URL (no spaces + has a dot), go to it. Otherwise, search.
        input = (input.includes('.') && !input.includes(' ')) 
            ? `https://${input}` 
            : `${engineBase}${encodeURIComponent(input)}`;
    }

    tab.failover = 0; // fresh user navigation resets the failover counter
    const errBox = document.getElementById('error');
    if (errBox) errBox.style.display = 'none';
    tab.loading = true;
    showIframeLoading(true, input);
    updateLoadingBar(tab, 10);
    tab.frame.go(input);
}

// Called when a page renders the Scramjet fetch-error screen. Asks the backend
// to re-pick an upstream, reconnects and retries before showing a recovery screen.
const MAX_FAILOVERS = 3;
async function handleProxyFailure(tab) {
    tab.failover = (tab.failover || 0) + 1;
    if (tab.failover <= MAX_FAILOVERS) {
        notify('info', 'Reconnecting', `Site didn't load — switching connection…`);
        if (tab.id === activeTabId) showIframeLoading(true, tab.url);
        const url = tab.url;
        await reconnectNetwork(true);
        setTimeout(() => { try { tab.frame.go(url); } catch (e) {} }, 900);
    } else {
        tab.failover = 0; tab.loading = false;
        if (tab.id === activeTabId) { showIframeLoading(false); showProxyErrorUI(tab.url); }
    }
}

function showProxyErrorUI(url) {
    const err = document.getElementById('error');
    if (!err) return;
    const btnCss = "margin-top:8px;padding:9px 16px;background:transparent;color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;transition:all .15s;";
    err.querySelector('.message-content').innerHTML = `
        <h1>Couldn't load this site</h1>
        <p id="error-message">The page didn't respond. The site may be bl0ck1ng pr0xies right now — try again, re-optimize the connection, or open it in a new tab.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px;">
          <button id="err-retry" data-testid="proxy-error-retry" style="${btnCss}">Retry</button>
          <button id="err-settings" data-testid="proxy-error-settings" style="${btnCss}">Re-optimize connection</button>
          <button id="err-newtab" data-testid="proxy-error-newtab" style="${btnCss}">Open in new tab</button>
        </div>`;
    err.style.display = 'flex';
    document.getElementById('err-retry').onclick = () => { err.style.display = 'none'; handleSubmit(url); };
    document.getElementById('err-settings').onclick = async () => { err.style.display = 'none'; try { await fetch('/api/net/refresh', { method: 'POST' }); } catch (e) {} await reconnectNetwork(false); handleSubmit(url); };
    document.getElementById('err-newtab').onclick = () => window.open(url, '_blank', 'noopener');
}

function updateLoadingBar(tab, percent) {
    if (tab.id !== activeTabId) return;
    const bar = document.getElementById("loading-bar");
    bar.style.width = percent + "%";
    bar.style.opacity = percent === 100 ? "0" : "1";
    if (percent === 100) setTimeout(() => { bar.style.width = "0%"; }, 200);
}

// =====================================================
// SETTINGS & WISP
// =====================================================
function openSettings() {
    const modal = document.getElementById('wisp-settings-modal');
    modal.classList.remove('hidden');

    document.getElementById('close-wisp-modal').onclick = () => modal.classList.add('hidden');
    
    const sidebarItems = modal.querySelectorAll('.sidebar-item');
    const panes = modal.querySelectorAll('.settings-pane');

    sidebarItems.forEach(item => {
        item.onclick = () => {
            sidebarItems.forEach(i => i.classList.remove('active'));
            panes.forEach(p => p.classList.add('hidden'));

            item.classList.add('active');
            const targetPane = item.getAttribute('data-pane');
            document.getElementById(targetPane).classList.remove('hidden');
        };
    });

    const engineSelect = document.getElementById('search-engine-select');
    const savedEngine = localStorage.getItem('searchEngine');
    if (savedEngine) engineSelect.value = savedEngine;
    engineSelect.onchange = (e) => localStorage.setItem('searchEngine', e.target.value);

    const startupToggle = document.getElementById('startup-tab-toggle');
    const isStartupEnabled = localStorage.getItem('startupTab') !== 'false';
    startupToggle.classList.toggle('active', isStartupEnabled);
    
    startupToggle.onclick = () => {
        const newState = !startupToggle.classList.contains('active');
        startupToggle.classList.toggle('active', newState);
        localStorage.setItem('startupTab', newState);
    };

    modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };
    
    renderNetwork();
    renderCloaks();
    renderBookmarksList();
    renderHistoryList();
    const clearBtn = document.getElementById('clear-history-btn');
    if (clearBtn) clearBtn.onclick = () => { localStorage.removeItem('flint_history'); renderHistoryList(); };
}

function renderCloaks() {
    const list = document.getElementById('cloak-list');
    if (!list) return;
    const current = Cloak.getKey();
    list.innerHTML = '';
    Object.entries(Cloak.presets).forEach(([key, c]) => {
        const opt = document.createElement('div');
        opt.className = `cloak-opt ${key === current ? 'active' : ''}`;
        opt.dataset.testid = `cloak-${key}`;
        opt.innerHTML = `<img src="${c.icon}${c.icon.endsWith('.ico') ? '?thumb=1' : ''}" alt=""><span>${c.label}</span>`;
        opt.querySelector('img').onerror = function () {
            const ph = document.createElement('div');
            ph.className = 'co-none';
            ph.innerHTML = '<i class="fa-solid fa-mask"></i>';
            this.replaceWith(ph);
        };
        opt.onclick = () => {
            Cloak.set(key);
            list.querySelectorAll('.cloak-opt').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
        };
        list.appendChild(opt);
    });
}

function renderBookmarksList() {
    const list = document.getElementById('bookmark-list');
    if (!list) return;
    const bms = getBookmarks();
    list.innerHTML = '';
    if (!bms.length) {
        list.innerHTML = '<div class="bm-empty">No bookmarks yet. Tap the ☆ in the address bar while browsing to save a page.</div>';
        return;
    }
    bms.forEach(bm => {
        const item = document.createElement('div');
        item.className = 'bm-item';
        item.dataset.testid = 'bookmark-item';
        item.innerHTML = `
            <div style="min-width:0;">
                <div class="bm-title">${bm.title}</div>
                <div class="bm-url">${bm.url}</div>
            </div>
            <button class="bm-del" title="Remove" data-testid="bookmark-delete"><i class="fa-solid fa-trash"></i></button>`;
        item.querySelector('.bm-del').onclick = (e) => {
            e.stopPropagation();
            saveBookmarks(getBookmarks().filter(b => b.url !== bm.url));
            renderBookmarksList();
            updateBookmarkIcon();
        };
        item.onclick = () => {
            document.getElementById('wisp-settings-modal').classList.add('hidden');
            handleSubmit(bm.url);
        };
        list.appendChild(item);
    });
}

async function renderNetwork() {
    const ping = document.getElementById('net-ping');
    const dot = document.getElementById('net-dot');
    const detail = document.getElementById('net-detail');
    const btn = document.getElementById('net-refresh');
    if (!ping || !dot || !detail) return;
    const paint = (st) => {
        dot.classList.remove('status-success', 'status-error');
        if (st && st.online) {
            dot.classList.add('status-success');
            ping.textContent = st.latency != null ? `${st.latency}ms` : 'Online';
            detail.textContent = 'Connected — best route selected automatically';
        } else {
            dot.classList.add('status-error');
            ping.textContent = 'Offline';
            detail.textContent = 'No route available right now — retrying in the background';
        }
    };
    const load = async (method) => {
        try { const r = await fetch(method === 'POST' ? '/api/net/refresh' : '/api/net/status', { method, cache: 'no-store' }); paint(await r.json()); }
        catch (e) { paint(null); }
    };
    ping.textContent = '...'; detail.textContent = 'Checking connection...';
    await load('GET');
    if (btn) btn.onclick = async () => {
        btn.disabled = true; ping.textContent = '...';
        await load('POST'); await reconnectNetwork(false);
        notify('success', 'Connection optimized', 'Using the fastest available route.');
        btn.disabled = false;
    };
}

// =====================================================
// UTILITIES
// =====================================================
function toggleDevTools() {
    const win = getActiveTab()?.frame.frame.contentWindow;
    if (!win) return;
    if (win.eruda) {
        win.eruda.show();
        return;
    }
    const script = win.document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/eruda";
    script.onload = () => { win.eruda.init(); win.eruda.show(); };
    win.document.body.appendChild(script);
}

function toggleFullscreen() {
    // Fullscreen only the active proxy tab's content (not the whole site UI).
    const el = getActiveTab()?.frame?.frame || document.getElementById('iframe-container');
    if (!document.fullscreenElement) {
        (el?.requestFullscreen || el?.webkitRequestFullscreen)?.call(el);
    } else {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
}

document.addEventListener('fullscreenchange', () => {
    const icon = document.querySelector('#fullscreen-btn i');
    if (icon) icon.className = document.fullscreenElement ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
});

/* ---------------- Bookmarks ---------------- */
function getBookmarks() {
    try { return JSON.parse(localStorage.getItem('flint_bookmarks') || '[]'); } catch (e) { return []; }
}
function saveBookmarks(list) { localStorage.setItem('flint_bookmarks', JSON.stringify(list)); }

function bookmarkCurrent() {
    const tab = getActiveTab();
    const url = tab?.url;
    if (!url || url.includes('/pages/nt.html')) return;
    const list = getBookmarks();
    const existingIdx = list.findIndex(b => b.url === url);
    if (existingIdx >= 0) {
        list.splice(existingIdx, 1); // toggle off
    } else {
        let title = tab.title || url;
        try { title = new URL(url).hostname.replace('www.', ''); } catch (e) {}
        list.unshift({ url, title });
    }
    saveBookmarks(list);
    updateBookmarkIcon();
}

function updateBookmarkIcon() {
    const icon = document.querySelector('#bookmark-btn i');
    if (!icon) return;
    const url = getActiveTab()?.url;
    const saved = url && getBookmarks().some(b => b.url === url);
    icon.className = saved ? 'fa-solid fa-star' : 'fa-regular fa-star';
}

/* ---------------- History ---------------- */
function getHistory() {
    try { return JSON.parse(localStorage.getItem('flint_history') || '[]'); } catch (e) { return []; }
}
function recordHistory(url) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    // skip internal Liquidform pages
    if (/\/pages\/(nt|g|a|movies|shows|vms|ch4t|calling|music|window)\.html|\/window\.html|\/index\.html/i.test(url)) return;
    let host;
    try { host = new URL(url).hostname.replace('www.', ''); } catch (e) { return; }
    const list = getHistory();
    if (list[0] && list[0].url === url) return; // dedupe consecutive
    list.unshift({ url, title: host, time: Date.now() });
    localStorage.setItem('flint_history', JSON.stringify(list.slice(0, 200)));
}
function renderHistoryList() {
    const list = document.getElementById('history-list');
    if (!list) return;
    const hist = getHistory();
    list.innerHTML = '';
    if (!hist.length) {
        list.innerHTML = '<div class="bm-empty">No history yet. Pages you browse through Liquidform show up here.</div>';
        return;
    }
    hist.forEach((h, i) => {
        const when = new Date(h.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const item = document.createElement('div');
        item.className = 'bm-item';
        item.dataset.testid = 'history-item';
        item.innerHTML = `
            <div style="min-width:0;">
                <div class="bm-title">${h.title}</div>
                <div class="bm-url">${h.url}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                <span style="font-size:0.7rem;color:#777;white-space:nowrap;">${when}</span>
                <button class="bm-del" title="Remove" data-testid="history-delete"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
        item.querySelector('.bm-del').onclick = (ev) => {
            ev.stopPropagation();
            const h2 = getHistory();
            h2.splice(i, 1);
            localStorage.setItem('flint_history', JSON.stringify(h2));
            renderHistoryList();
        };
        item.onclick = () => {
            document.getElementById('wisp-settings-modal').classList.add('hidden');
            handleSubmit(h.url);
        };
        list.appendChild(item);
    });
}

/* ---------------- Cloak: see cloak.js ---------------- */
Cloak.init();

async function checkHashParameters() {
    if (window.location.hash) {
        const hash = decodeURIComponent(window.location.hash.substring(1));
        if (hash) handleSubmit(hash);
        history.replaceState(null, null, location.pathname);
    }
}

// =====================================================
// MAIN INITIALIZATION
// =====================================================
document.addEventListener('DOMContentLoaded', async function () {
    try {
        await getSharedScramjet();
        await getSharedConnection();
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.register(getBasePath() + 'sw.js', { scope: getBasePath() });
            await navigator.serviceWorker.ready;
            reg.update();
        }

        await initializeBrowser();
    } catch (err) {
        console.error("Initialization error:", err);
        const root = document.getElementById('app');
        if (root) {
            root.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif; background: #0a0a0a; color: #e4e4e7;">
                    <div style="text-align: center; max-width: 600px; padding: 20px;">
                        <h1 style="color: #ef4444; margin-bottom: 20px;">This browser does not allow Service Workers!</h1>
                        <p style="margin-bottom: 20px; line-height: 1.6;">${err.message || 'This site needs service workers.'}</p>
                        <p style="color: #a1a1a1; font-size: 14px; margin-bottom: 20px;">If you are on mobile, I reccomend using Firefox as your browser.</p>
                        <button onclick="location.reload()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">Retry</button>
                    </div>
                </div>
            `;
        }
    }
});
