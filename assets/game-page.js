/* ==========================================================================
   GAME SCREEN — renders the page for whichever game.js was loaded before it.
   Every games/<folder>/index.html is the same small file; only game.js differs.
   ========================================================================== */
(function () {
    'use strict';

    var ROOT = '../../';
    var game = window.DKGames && window.DKGames.current();

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var ICONS = {
        back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12H5"/><path d="M11 5l-7 7 7 7"/></svg>',
        play: '<svg viewBox="2.2 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 3.8v16.4a1.2 1.2 0 0 0 1.8 1l14-8.2a1.2 1.2 0 0 0 0-2L7.8 2.8A1.2 1.2 0 0 0 6 3.8z"/></svg>',
        share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
        playsSmall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
        copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
        mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
        chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
    };

    if (!game) {
        document.body.insertAdjacentHTML('beforeend',
            '<div class="gp-missing"><p>This game couldn&rsquo;t be loaded.</p><p><a href="' + ROOT + '">Back to the homepage</a></p></div>');
        return;
    }

    document.title = game.title + ' — DK Digital';
    document.body.style.setProperty('--game-color', game.color);

    var shareUrl = window.location.href.split('#')[0];
    var shareText = game.title + ' — ' + game.shortDescription;
    var canNativeShare = typeof navigator.share === 'function';

    document.body.insertAdjacentHTML('afterbegin',
        '<div class="gp-glow" aria-hidden="true"></div>' +
        '<header class="gp-banner">' +
            (game.banner ? '<img class="gp-banner-img" src="' + esc(game.banner) + '" alt="">' : '') +
            '<a class="gp-exit" href="' + ROOT + '" aria-label="Exit to homepage" title="Exit">' + ICONS.back + '</a>' +
            (game.logo ? '<img class="gp-logo" src="' + esc(game.logo) + '" alt="' + esc(game.title) + ' logo">' : '') +
            '<div class="gp-bar"></div>' +
            '<a class="gp-play" id="gp-play" href="' + esc(game.play) + '" aria-label="Play ' + esc(game.title) + '">' + ICONS.play + '</a>' +
        '</header>' +
        '<main class="gp-main">' +
            '<div class="gp-info">' +
                '<div>' +
                    '<h1 class="gp-title">' + esc(game.title) + '</h1>' +
                    '<p class="gp-short">' + esc(game.shortDescription) + '</p>' +
                '</div>' +
                '<div class="gp-actions">' +
                    '<button type="button" class="gp-share" id="gp-share" aria-label="Share" aria-haspopup="true" aria-expanded="false" title="Share">' + ICONS.share + '</button>' +
                    '<div class="gp-share-menu" id="gp-share-menu" role="menu" hidden>' +
                        '<span class="gp-share-url">' + esc(shareUrl.replace(/^https?:\/\//, '')) + '</span>' +
                        '<button type="button" role="menuitem" data-share="copy">' + ICONS.copy + 'Copy link</button>' +
                        (canNativeShare ? '<button type="button" role="menuitem" data-share="native">' + ICONS.send + 'Send to&hellip;</button>' : '') +
                        '<a role="menuitem" data-no-fade href="mailto:?subject=' + encodeURIComponent('Play ' + game.title) + '&body=' + encodeURIComponent(shareText + '\n' + shareUrl) + '">' + ICONS.mail + 'Email</a>' +
                        '<a role="menuitem" data-no-fade href="sms:?&body=' + encodeURIComponent(shareText + ' ' + shareUrl) + '">' + ICONS.chat + 'Text message</a>' +
                    '</div>' +
                    '<div class="gp-plays" id="gp-plays" title="Times you have played"><span id="gp-plays-n">0</span>' + ICONS.playsSmall + '</div>' +
                    '<div class="gp-plays-label">your plays</div>' +
                '</div>' +
            '</div>' +
            '<section class="gp-desc" aria-label="About this game">' +
                '<h2>About the game</h2>' +
                '<p>' + esc(game.description) + '</p>' +
            '</section>' +
        '</main>' +
        '<a class="gp-studio" href="' + ROOT + '">DK Digital</a>' +
        '<div class="gp-toast" id="gp-toast" role="status" aria-live="polite"></div>'
    );

    // ---- Plays ----
    var playsN = document.getElementById('gp-plays-n');
    var playsEl = document.getElementById('gp-plays');
    playsN.textContent = window.DKGames.getPlays(game.slug).toLocaleString();

    var playBtn = document.getElementById('gp-play');
    playBtn.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
            window.DKGames.addPlay(game.slug);
            return;
        }
        e.preventDefault();
        if (playBtn.classList.contains('is-launching')) return;
        playsN.textContent = window.DKGames.addPlay(game.slug).toLocaleString();
        playsEl.classList.remove('bump'); void playsEl.offsetWidth; playsEl.classList.add('bump');
        playBtn.classList.add('is-launching');
        setTimeout(function () { window.DK.fadeTo(playBtn.href); }, 260);
    });

    // ---- Share ----
    var shareBtn = document.getElementById('gp-share');
    var menu = document.getElementById('gp-share-menu');
    var toastEl = document.getElementById('gp-toast');
    var toastTimer;

    function toast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
    }
    function setMenu(open) {
        menu.hidden = !open;
        shareBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function copyLink() {
        function fallback() {
            var t = document.createElement('textarea');
            t.value = shareUrl;
            t.setAttribute('readonly', '');
            t.style.position = 'fixed'; t.style.opacity = '0';
            document.body.appendChild(t);
            t.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
            t.remove();
            toast(ok ? 'Link copied!' : 'Copy failed — copy it from the address bar');
        }
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(shareUrl).then(function () { toast('Link copied!'); }, fallback);
        } else {
            fallback();
        }
    }

    shareBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setMenu(menu.hidden);
    });
    menu.addEventListener('click', function (e) {
        var item = e.target.closest('[data-share]');
        if (!item) return;
        if (item.getAttribute('data-share') === 'copy') copyLink();
        if (item.getAttribute('data-share') === 'native') {
            navigator.share({ title: game.title, text: shareText, url: shareUrl }).catch(function () {});
        }
        setMenu(false);
    });
    document.addEventListener('click', function (e) {
        if (!menu.hidden && !menu.contains(e.target)) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !menu.hidden) { setMenu(false); shareBtn.focus(); }
    });
})();
