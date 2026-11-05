/* Liquidform tab cloak - shared by the launcher (index.html) and the app.
   Icons are absolute same-origin URLs (/icons/*.png) so they resolve inside
   an about:blank document; a single icon link is kept; every preset is
   enforced so proxied pages can't overwrite the tab title/icon. */
(function () {
    var KEY = 'flint_cloak';
    var DEFAULT_KEY = 'drive';
    var PRESETS = {
        none:      { label: 'None (Liquidform)', title: 'Liquidform',            icon: '/images/favicon.ico' },
        classroom: { label: 'Google Classroom',  title: 'Home',                  icon: '/icons/classroom.png' },
        docs:      { label: 'Google Docs',       title: 'Google Docs',           icon: '/icons/docs.png' },
        drive:     { label: 'Google Drive',      title: 'Home - Google Drive',   icon: '/icons/drive.png' },
        slides:    { label: 'Google Slides',     title: 'Google Slides',         icon: '/icons/slides.png' },
        gmail:     { label: 'Gmail',             title: 'Inbox',                 icon: '/icons/gmail.png' },
        clever:    { label: 'Clever',            title: 'Clever | Portal',       icon: '/icons/clever.png' },
        canvas:    { label: 'Canvas',            title: 'Dashboard',             icon: '/icons/canvas.png' },
        wikipedia: { label: 'Wikipedia',         title: 'Wikipedia',             icon: '/icons/wikipedia.png' },
        khan:      { label: 'Khan Academy',      title: 'Dashboard | Khan Academy', icon: '/icons/khan.png' }
    };
    function absIcon(p) { return new URL(p.icon, location.origin).href; }
    function getKey() {
        var k = null;
        try { k = localStorage.getItem(KEY); } catch (e) {}
        return (k && PRESETS[k]) ? k : DEFAULT_KEY;
    }
    function applyTo(doc, key) {
        var p = PRESETS[key] || PRESETS[DEFAULT_KEY];
        try {
            if (!doc || !doc.head) return;
            if (doc.title !== p.title) doc.title = p.title;
            var href = absIcon(p);
            var links = doc.querySelectorAll("link[rel~='icon'], link[rel='shortcut icon']");
            var link = links[0];
            for (var i = 1; i < links.length; i++) links[i].parentNode.removeChild(links[i]);
            if (!link) { link = doc.createElement('link'); link.rel = 'icon'; doc.head.appendChild(link); }
            if (link.href !== href) link.href = href;
        } catch (e) {}
    }
    function targetDocs() {
        var docs = [document];
        try { if (window.top && window.top !== window && window.top.document) docs.push(window.top.document); } catch (e) {}
        return docs;
    }
    var activeKey = null, watching = false;
    function enforce() { if (activeKey) targetDocs().forEach(function (d) { applyTo(d, activeKey); }); }
    function watch() {
        if (watching) return;
        watching = true;
        targetDocs().forEach(function (d) {
            try {
                new MutationObserver(enforce).observe(d.head, { childList: true, subtree: true, characterData: true, attributes: true });
            } catch (e) {}
        });
        setInterval(enforce, 1000);
    }
    function apply(key) { activeKey = PRESETS[key] ? key : DEFAULT_KEY; enforce(); watch(); }
    window.Cloak = {
        presets: PRESETS, getKey: getKey, applyTo: applyTo, apply: apply,
        init: function () { apply(getKey()); },
        set: function (key) { try { localStorage.setItem(KEY, key); } catch (e) {} apply(key); }
    };
})();
