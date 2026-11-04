/* Liquidform about:blank guard.
   Every app page loads this first. If the page is not running inside the
   about:blank tab created by the launcher (index.html), it sends the visitor
   back to the launcher instead of showing any content. */
(function () {
    var ok = false;
    try {
        ok = window.top !== window && window.top.location.href === 'about:blank';
    } catch (e) { ok = false; }
    if (ok) return;
    document.documentElement.style.display = 'none';
    var root = document.currentScript ? new URL('./', document.currentScript.src).href : '/';
    window.location.replace(root);
})();
