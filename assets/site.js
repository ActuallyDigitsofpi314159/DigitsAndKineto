/* ==========================================================================
   DIGITS & KINETO — SHARED SITE SCRIPT
   - Renders the header (logo + slanted scene buttons) into <header data-site-header>
   - Fades the page out before following internal links
   ========================================================================== */
(function () {
    'use strict';

    // Scene buttons, left to right. `href` is relative to the site root.
    // Leave `href` empty to show a locked "coming soon" button.
    var NAV = [
        { id: 'converter', label: 'DK Converter', href: 'dkconverter/' },
        { id: 'about',     label: 'About Us',      href: 'about/' },
        { id: 'updates',   label: 'Updates',      href: 'updates/' },
        { id: 'mystery',   label: '???',          href: '' }
    ];

    function rootPrefix() {
        var el = document.querySelector('[data-site-root]');
        return el ? el.getAttribute('data-site-root') : '';
    }

    function renderHeader() {
        var header = document.querySelector('[data-site-header]');
        if (!header) return;
        var root = rootPrefix();
        var current = header.getAttribute('data-current') || '';

        header.classList.add('site-header');
        var html = '<a class="site-logo" href="' + (root || './') + '" aria-label="Digits &amp; Kineto home" title="Home">' +
            '<img src="' + root + 'logo.svg" alt="DK" width="64" height="64"></a>' +
            '<a class="home-label" href="' + (root || './') + '">Home</a>' +
            '<nav class="scene-nav" aria-label="Main">';
        NAV.forEach(function (item, i) {
            if (!item.href) {
                html += '<button type="button" class="slant-btn is-locked" style="--i:' + i + '" aria-disabled="true">' +
                    '<span>' + item.label + '</span><span class="lock-tip">Soon&hellip;</span></button>';
                return;
            }
            var isCurrent = item.id === current;
            html += '<a class="slant-btn' + (isCurrent ? ' is-current' : '') + '" style="--i:' + i + '" href="' + root + item.href + '"' +
                (isCurrent ? ' aria-current="page"' : '') + '><span>' + item.label + '</span></a>';
        });
        html += '</nav>';
        header.innerHTML = html;

        header.querySelectorAll('.slant-btn.is-locked').forEach(function (btn) {
            btn.addEventListener('click', function () {
                btn.classList.remove('wobble');
                void btn.offsetWidth;
                btn.classList.add('wobble');
            });
            btn.addEventListener('animationend', function () { btn.classList.remove('wobble'); });
        });
    }

    // Fade out, then navigate. Exported so scripts can use it for JS navigation.
    function fadeTo(url) {
        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) { window.location.href = url; return; }
        document.body.classList.add('is-leaving');
        setTimeout(function () { window.location.href = url; }, 210);
    }

    function wireFadeLinks() {
        document.addEventListener('click', function (e) {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            var a = e.target.closest && e.target.closest('a[href]');
            if (!a || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-no-fade')) return;
            var href = a.getAttribute('href');
            if (!href || href.charAt(0) === '#' || /^(mailto|tel|sms|javascript):/i.test(href)) return;
            var url = new URL(a.href, window.location.href);
            if (url.origin !== window.location.origin && window.location.protocol !== 'file:') return;
            if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
            e.preventDefault();
            fadeTo(url.href);
        });
        // Coming back via the back button restores a faded page from cache; un-fade it.
        window.addEventListener('pageshow', function () { document.body.classList.remove('is-leaving'); });
    }

    window.DK = window.DK || {};
    window.DK.fadeTo = fadeTo;

    renderHeader();
    wireFadeLinks();
})();
