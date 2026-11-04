/* Liquidform custom dropdowns: any <select data-custom> becomes a themed
   button + menu. The native <select> stays (hidden) so .value / "change"
   keep working, and setting .value from script updates the label. */
(function () {
    var openMenu = null;
    function closeOpen() {
        if (!openMenu) return;
        openMenu.menu.remove();
        openMenu.btn.classList.remove('open');
        openMenu.btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', openMenu.onDoc, true);
        document.removeEventListener('scroll', openMenu.onScroll, true);
        window.removeEventListener('resize', closeOpen);
        window.removeEventListener('blur', closeOpen);
        openMenu = null;
    }
    function enhance(select) {
        if (select._cs) return;
        select._cs = true;
        var wrap = document.createElement('div');
        wrap.className = 'cs-wrap';
        var btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'cs-btn';
        btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<span class="cs-label"></span><i class="cs-caret fa-solid fa-chevron-down"></i>';
        var label = btn.querySelector('.cs-label');
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(btn); wrap.appendChild(select);
        select.classList.add('cs-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
        function refresh() { var o = select.options[select.selectedIndex]; label.textContent = o ? o.textContent : ''; }
        var desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        Object.defineProperty(select, 'value', {
            get: function () { return desc.get.call(this); },
            set: function (v) { desc.set.call(this, v); refresh(); },
            configurable: true
        });
        refresh();
        function choose(i) {
            if (i < 0 || i >= select.options.length) return;
            var changed = select.selectedIndex !== i;
            select.selectedIndex = i; refresh();
            if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        function open() {
            if (openMenu && openMenu.btn === btn) return closeOpen();
            closeOpen();
            var menu = document.createElement('div');
            menu.className = 'cs-menu'; menu.setAttribute('role', 'listbox');
            var active = select.selectedIndex;
            Array.prototype.forEach.call(select.options, function (o, i) {
                var item = document.createElement('div');
                item.className = 'cs-item' + (i === select.selectedIndex ? ' selected' : '');
                item.setAttribute('role', 'option');
                item.innerHTML = '<span></span><i class="fa-solid fa-check"></i>';
                item.firstChild.textContent = o.textContent;
                item.onmousedown = function (e) { e.preventDefault(); };
                item.onclick = function () { choose(i); closeOpen(); btn.focus(); };
                item.onmouseenter = function () { setActive(i); };
                menu.appendChild(item);
            });
            document.body.appendChild(menu);
            var r = btn.getBoundingClientRect();
            menu.style.minWidth = r.width + 'px';
            var mh = menu.offsetHeight, below = window.innerHeight - r.bottom;
            var up = below < mh + 12 && r.top > below;
            menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
            menu.style.top = (up ? Math.max(8, r.top - mh - 6) : r.bottom + 6) + 'px';
            menu.style.maxHeight = Math.max(120, (up ? r.top : below) - 20) + 'px';
            btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
            function setActive(i) { active = i; Array.prototype.forEach.call(menu.children, function (c, k) { c.classList.toggle('active', k === i); }); }
            setActive(active);
            openMenu = {
                btn: btn, menu: menu, setActive: setActive, getActive: function () { return active; },
                onDoc: function (e) { if (!menu.contains(e.target) && !btn.contains(e.target)) closeOpen(); },
                onScroll: function (e) { if (!menu.contains(e.target)) closeOpen(); }
            };
            document.addEventListener('mousedown', openMenu.onDoc, true);
            document.addEventListener('scroll', openMenu.onScroll, true);
            window.addEventListener('resize', closeOpen);
            window.addEventListener('blur', closeOpen);
        }
        btn.addEventListener('click', open);
        btn.addEventListener('keydown', function (e) {
            var n = select.options.length;
            if (openMenu && openMenu.btn === btn) {
                if (e.key === 'ArrowDown') { e.preventDefault(); openMenu.setActive((openMenu.getActive() + 1) % n); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); openMenu.setActive((openMenu.getActive() - 1 + n) % n); }
                else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(openMenu.getActive()); closeOpen(); }
                else if (e.key === 'Escape' || e.key === 'Tab') closeOpen();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
        });
    }
    function enhanceAll(root) { (root || document).querySelectorAll('select[data-custom]').forEach(enhance); }
    window.CustomSelect = { enhance: enhance, enhanceAll: enhanceAll };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { enhanceAll(); });
    else enhanceAll();
})();
