/* ==========================================================================
   ADS — every ad spot on the site goes through this file.

   The spots:
     1. Game pre-roll: a full-screen video ad after the Play button is pressed
        on a game page, before the game opens. (assets/game-page.js calls
        DKAds.preroll() and waits for it.)
     2. Converter: a banner/video box on DK Converter's loading screen, shown
        while a file is loading or converting. (The <div data-dk-ad="converter">
        in dkconverter/index.html.)

   TURNING ADS ON: fill in CONFIG below. While `provider` is '' nothing loads
   and the site behaves exactly as it did without ads.

   PREVIEWING THE SPOTS: add ?ads=preview to a game page or converter address,
   e.g. /games/dash-parkour/?ads=preview — placeholder ads appear, no ad
   service needed.
   ========================================================================== */
(function () {
    'use strict';

    var CONFIG = {
        provider: '',           // '' = ads off  ·  'adsense' = Google AdSense
        adsenseClient: '',      // your publisher ID, e.g. 'ca-pub-1234567890123456'
        slots: {
            converter: ''       // ad unit ID for the converter box, e.g. '1234567890'
        },
        testMode: false,        // true = pre-roll shows Google's test ads (for trying it out)
        prerollWaitMs: 1500     // if no ad has started by then, go straight to the game
    };

    var script = document.currentScript;
    var wantsPreroll = !!script && script.hasAttribute('data-preroll');
    var preview = /[?&]ads=preview\b/.test(window.location.search);
    var adsense = !preview && CONFIG.provider === 'adsense' && !!CONFIG.adsenseClient;
    var scriptFailed = false;

    if (adsense) {
        var s = document.createElement('script');
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' +
            encodeURIComponent(CONFIG.adsenseClient);
        s.setAttribute('data-ad-client', CONFIG.adsenseClient);
        if (CONFIG.testMode) s.setAttribute('data-adbreak-test', 'on');
        s.onerror = function () { scriptFailed = true; };      // e.g. an ad blocker
        document.head.appendChild(s);
        window.adsbygoogle = window.adsbygoogle || [];
        // Fetch the pre-roll ahead of time so it is ready when Play is pressed.
        if (wantsPreroll) window.adsbygoogle.push({ preloadAdBreaks: 'on', sound: 'on' });
    }

    // ---- 1. Pre-roll -------------------------------------------------------
    // Returns a promise that resolves when the ad has finished, was skipped,
    // or there was no ad to show. It never rejects and never hangs.
    function preroll() {
        if (preview) return previewPreroll();
        if (!adsense || !wantsPreroll || scriptFailed) return Promise.resolve();
        return new Promise(function (resolve) {
            var started = false;
            var timer = setTimeout(function () { if (!started) resolve(); }, CONFIG.prerollWaitMs);
            window.adsbygoogle.push({
                type: 'start',
                name: 'game-launch',
                beforeAd: function () { started = true; },
                adBreakDone: function () { clearTimeout(timer); resolve(); }
            });
        });
    }

    function previewPreroll() {
        return new Promise(function (resolve) {
            var left = 5;
            var el = document.createElement('div');
            el.className = 'dk-ad-preroll';
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-label', 'Advertisement');
            el.innerHTML = '<div class="dk-ad-label">Advertisement</div>' +
                '<div class="dk-ad-video dk-ad-placeholder">Video ad plays here</div>' +
                '<div class="dk-ad-count"></div>';
            var count = el.lastChild;
            document.body.appendChild(el);
            (function tick() {
                if (left === 0) { el.remove(); resolve(); return; }
                count.textContent = 'Your game starts in ' + left + '…';
                left -= 1;
                setTimeout(tick, 1000);
            })();
        });
    }

    // ---- 2. Slots (boxes on the page) --------------------------------------
    // Each <div class="dk-ad" data-dk-ad="NAME"> is filled the first time it
    // is actually visible, and keeps that one ad from then on.
    function fill(el, slotId) {
        var box = el.querySelector('.dk-ad-box');
        if (preview) {
            box.classList.add('dk-ad-placeholder');
            box.innerHTML = 'Ad space<small>' + box.offsetWidth + ' × ' + box.offsetHeight + '</small>';
            return;
        }
        var ins = document.createElement('ins');
        ins.className = 'adsbygoogle';
        ins.style.cssText = 'display:inline-block;width:' + box.offsetWidth + 'px;height:' + box.offsetHeight + 'px';
        ins.setAttribute('data-ad-client', CONFIG.adsenseClient);
        ins.setAttribute('data-ad-slot', slotId);
        box.appendChild(ins);
        window.adsbygoogle.push({});
    }

    function setUpSlots() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-dk-ad]'), function (el) {
            var slotId = CONFIG.slots[el.getAttribute('data-dk-ad')];
            if (!preview && !(adsense && slotId)) return;      // stays hidden
            el.classList.add('dk-ad', 'is-on');
            el.innerHTML = '<div class="dk-ad-label">Advertisement</div><div class="dk-ad-box"></div>';
            if (!('IntersectionObserver' in window)) return;
            var io = new IntersectionObserver(function (entries) {
                if (!entries.some(function (e) { return e.isIntersecting; })) return;
                if (!el.querySelector('.dk-ad-box').offsetWidth) return;   // hidden on this screen size
                io.disconnect();
                fill(el, slotId);
            });
            io.observe(el);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setUpSlots);
    else setUpSlots();

    window.DKAds = { preroll: preroll };
})();
