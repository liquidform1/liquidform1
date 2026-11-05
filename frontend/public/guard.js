/* Liquidform guard.
   Every app page loads this first. App pages only run inside the cloaked tab
   (index.html?cloaked=true). Anywhere else the visitor is sent back to the
   launcher instead of seeing any content. */
(function () {
    var ok = false;
    try {
        ok = window.top !== window && window.top.location.origin === window.location.origin &&
             /(^|[?&])cloaked(=|&|$)/.test(window.top.location.search);
    } catch (e) { ok = false; }
    if (ok) return;
    document.documentElement.style.display = 'none';
    var root = document.currentScript ? new URL('./', document.currentScript.src).href : '/';
    window.location.replace(root);
})();
