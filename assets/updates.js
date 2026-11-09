/* ==========================================================================
   UPDATES PAGE — renders posts from updates/posts.js (window.DK_UPDATES).
   Game cards use each game's game.js (cover, title, color, page link).
   ========================================================================== */
(function () {
    'use strict';

    var listEl = document.getElementById('post-list');
    var posts = (window.DK_UPDATES || []).slice();

    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];

    var LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
    var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Only allow ordinary web/relative links in post data.
    function safeUrl(url) {
        url = String(url || '').trim();
        return /^\s*(javascript|data|vbscript):/i.test(url) ? '#' : url;
    }

    // 'YYYY-MM-DD' -> 'November 9, 2026' (parsed as a local date, no timezone shift).
    function formatDate(str) {
        var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(str || '').trim());
        if (!m) return esc(str || '');
        return MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1];
    }

    function slugify(s) {
        return String(s || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'post';
    }

    function paragraphs(text) {
        return String(text || '').split(/\n\s*\n/).map(function (p) {
            p = p.trim();
            return p ? '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>' : '';
        }).join('');
    }

    function gameCard(slug) {
        var g = window.DKGames && DKGames.get(slug);
        if (!g) {
            // Folder not found in games.js — still link to where its page would be.
            return '<a class="post-game is-plain" href="../games/' + encodeURIComponent(slug) + '/">' +
                '<span class="post-game-title">' + esc(slug) + '</span></a>';
        }
        return '<a class="post-game" style="--game-color:' + esc(g.color) + '" href="' + esc(g.page) + '">' +
            '<img src="' + esc(g.cover) + '" alt="" width="56" height="56" loading="lazy">' +
            '<span class="post-game-text">' +
                '<span class="post-game-title">' + esc(g.title) + '</span>' +
                (g.shortDescription ? '<span class="post-game-sub">' + esc(g.shortDescription) + '</span>' : '') +
            '</span>' +
            '<span class="post-game-play">' + PLAY_ICON + '<span>Play</span></span>' +
        '</a>';
    }

    function postHTML(post, i, usedIds) {
        var id = slugify(post.title);
        while (usedIds[id]) id += '-' + (i + 1);
        usedIds[id] = true;

        var games = Array.isArray(post.games) ? post.games : [];
        var links = Array.isArray(post.links) ? post.links : [];

        var html = '<article class="post" id="' + id + '" style="--i:' + i + '">';
        if (post.image) {
            html += '<div class="post-image"><img src="' + esc(safeUrl(post.image)) + '" alt="" loading="' + (i === 0 ? 'eager' : 'lazy') + '"></div>';
        }
        html += '<div class="post-body">' +
            '<div class="post-meta">' +
                (post.date ? '<time datetime="' + esc(post.date) + '">' + formatDate(post.date) + '</time>' : '') +
                (i === 0 ? '<span class="post-new">Latest</span>' : '') +
                '<a class="post-permalink" href="#' + id + '" data-no-fade aria-label="Link to this post">#</a>' +
            '</div>' +
            '<h2 class="post-title">' + esc(post.title) + '</h2>' +
            '<div class="post-desc">' + paragraphs(post.description) + '</div>';

        if (games.length) {
            html += '<div class="post-games">' + games.map(gameCard).join('') + '</div>';
        }
        if (links.length) {
            html += '<div class="post-links">' + links.map(function (l, j) {
                var url = safeUrl(l.url);
                var external = /^https?:\/\//i.test(url) && url.indexOf(window.location.origin) !== 0;
                return '<a class="slant-btn slant-sm" style="--i:' + j + '" href="' + esc(url) + '"' +
                    (external ? ' target="_blank" rel="noopener"' : '') + '>' +
                    '<span>' + esc(l.label || url) + (external ? LINK_ICON : '') + '</span></a>';
            }).join('') + '</div>';
        }
        html += '</div></article>';
        return html;
    }

    function render() {
        if (!posts.length) {
            listEl.innerHTML = '<p class="empty-note">No updates yet &mdash; check back soon!</p>';
            return;
        }
        // Newest first. Posts without a date keep their place at the end.
        posts.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
        var usedIds = {};
        listEl.innerHTML = posts.map(function (p, i) { return postHTML(p, i, usedIds); }).join('');

        // Jump to a shared post link (#post-id) now that it exists.
        if (window.location.hash) {
            var target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
            if (target) target.scrollIntoView();
        }
    }

    // Load game.js for every game folder in games/games.js, then render.
    if (window.DKGames) {
        DKGames.loadAll('../games/').then(render, render);
    } else {
        render();
    }
})();
