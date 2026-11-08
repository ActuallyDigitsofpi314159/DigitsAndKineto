/* ==========================================================================
   HOMEPAGE — builds the featured game, search and game grid from games/games.js
   ========================================================================== */
(function () {
    'use strict';

    var featuredEl = document.getElementById('featured');
    var gridEl = document.getElementById('game-grid');
    var searchEl = document.getElementById('game-search');

    var ARROW_SVG =
        '<svg class="featured-arrow" viewBox="0 0 260 170" aria-hidden="true">' +
            '<path d="M232 10 C 246 80 196 120 66 121" fill="none" stroke="#4a0008" stroke-width="32" stroke-linecap="round"/>' +
            '<path d="M232 10 C 246 80 196 120 66 121" fill="none" stroke="#eb1c24" stroke-width="20" stroke-linecap="round"/>' +
            '<path d="M232 10 C 246 80 196 120 66 121" fill="none" stroke="#ff6b70" stroke-width="5" stroke-linecap="round" opacity=".55"/>' +
            '<polygon points="76,80 10,122 80,162" fill="#eb1c24" stroke="#4a0008" stroke-width="7" stroke-linejoin="round"/>' +
        '</svg>';

    var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>';

    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function renderFeatured(game) {
        if (!game) { featuredEl.hidden = true; return; }
        featuredEl.style.setProperty('--game-color', game.color);
        featuredEl.innerHTML =
            '<a class="featured-cover" href="' + esc(game.page) + '" aria-label="' + esc(game.title) + ' — open game page">' +
                '<img src="' + esc(game.cover) + '" alt="" width="800" height="800">' +
                '<span class="play-chip">' + PLAY_ICON + 'Play</span>' +
            '</a>' +
            '<div class="featured-info">' +
                '<h2 class="featured-title"><a href="' + esc(game.page) + '">' + esc(game.title) + '</a></h2>' +
                '<p class="featured-desc">' + esc(game.shortDescription) + '</p>' +
                ARROW_SVG +
            '</div>';
        featuredEl.classList.remove('is-loading');
    }

    function cardHTML(game, i) {
        if (game.placeholder) {
            return '<div class="game-card is-placeholder" style="--i:' + i + '" aria-label="' + esc(game.title) + ' (coming soon)">' +
                '<div class="cover"><span class="mark" aria-hidden="true">?</span><span class="soon">Coming soon</span></div>' +
                '<span class="title">' + esc(game.title) + '</span></div>';
        }
        return '<a class="game-card" style="--i:' + i + ';--game-color:' + esc(game.color) + '" href="' + esc(game.page) + '">' +
            '<div class="cover"><img src="' + esc(game.cover) + '" alt="" loading="lazy" width="800" height="800"></div>' +
            '<span class="title">' + esc(game.title) + '</span></a>';
    }

    var data = { featured: null, list: [] };

    function renderGrid() {
        var q = (searchEl.value || '').trim().toLowerCase();
        var items;
        if (!q) {
            // Every game except the featured one.
            items = data.list.filter(function (g) { return g !== data.featured; });
        } else {
            // While searching, include the featured game too.
            items = data.list.filter(function (g) {
                return (g.title + ' ' + (g.shortDescription || '')).toLowerCase().indexOf(q) !== -1;
            });
        }
        gridEl.innerHTML = items.length
            ? items.map(cardHTML).join('')
            : '<p class="no-results">No games match &ldquo;' + esc(searchEl.value.trim()) + '&rdquo;.</p>';
    }

    searchEl.addEventListener('input', renderGrid);
    document.addEventListener('keydown', function (e) {
        if (e.key === '/' && document.activeElement !== searchEl && !/input|textarea/i.test(document.activeElement.tagName)) {
            e.preventDefault();
            searchEl.focus();
        }
        if (e.key === 'Escape' && document.activeElement === searchEl) {
            searchEl.value = '';
            renderGrid();
        }
    });

    window.DKGames.loadAll('games/').then(function (result) {
        data = result;
        renderFeatured(result.featured);
        renderGrid();
    });
})();
