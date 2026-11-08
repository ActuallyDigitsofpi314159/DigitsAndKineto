/* ==========================================================================
   GAME REGISTRY
   Each games/<folder>/game.js calls DKGames.register({...}). The folder name
   becomes the game's id, and every path inside game.js is resolved relative
   to that folder. The homepage loads every folder listed in games/games.js.
   ========================================================================== */
(function () {
    'use strict';

    var games = {};
    var lastRegistered = null;

    function folderOf(src) {
        var url = new URL(src, window.location.href);
        var parts = url.pathname.split('/');
        parts.pop();                       // game.js
        return { slug: decodeURIComponent(parts[parts.length - 1]), base: new URL('./', url).href };
    }

    function resolve(path, base) {
        return path ? new URL(path, base).href : '';
    }

    function register(meta) {
        var script = document.currentScript;
        var where = folderOf(script ? script.src : window.location.href);
        var game = {
            slug: where.slug,
            title: meta.title || where.slug,
            shortDescription: meta.shortDescription || '',
            description: meta.description || '',
            color: meta.color || '#fd3a40',
            cover: resolve(meta.cover, where.base),
            banner: resolve(meta.banner, where.base),
            logo: resolve(meta.logo, where.base),
            play: resolve(meta.play, where.base),
            page: where.base
        };
        games[game.slug] = game;
        lastRegistered = game;
        return game;
    }

    function loadScript(src) {
        return new Promise(function (resolveLoad) {
            var s = document.createElement('script');
            s.src = src;
            s.onload = function () { resolveLoad(true); };
            s.onerror = function () {
                console.warn('[DKGames] Could not load ' + src);
                resolveLoad(false);
            };
            document.head.appendChild(s);
        });
    }

    // Loads every folder in window.DK_GAMES.order (relative to gamesDir).
    // Resolves to { featured: game|null, list: [game | placeholder, ...] }.
    function loadAll(gamesDir) {
        var config = window.DK_GAMES || { order: [] };
        var order = config.order || [];
        var folders = order.filter(function (e) { return typeof e === 'string'; });
        if (config.featured && folders.indexOf(config.featured) === -1) folders.push(config.featured);

        return Promise.all(folders.map(function (f) {
            return games[f] ? true : loadScript(gamesDir + encodeURIComponent(f) + '/game.js');
        })).then(function () {
            var list = [];
            order.forEach(function (entry) {
                if (typeof entry === 'string') {
                    if (games[entry]) list.push(games[entry]);
                } else if (entry && entry.placeholder) {
                    list.push({ placeholder: true, title: entry.title || 'Coming soon', slug: '' });
                }
            });
            return { featured: games[config.featured] || null, list: list };
        });
    }

    // ---- Per-visitor play counter (localStorage) ----
    var PLAYS_KEY = 'dk-plays:';

    function getPlays(slug) {
        try {
            var n = parseInt(window.localStorage.getItem(PLAYS_KEY + slug), 10);
            return isFinite(n) && n > 0 ? n : 0;
        } catch (e) { return 0; }
    }

    function addPlay(slug) {
        var n = getPlays(slug) + 1;
        try { window.localStorage.setItem(PLAYS_KEY + slug, String(n)); } catch (e) { /* storage blocked */ }
        return n;
    }

    window.DKGames = {
        register: register,
        loadAll: loadAll,
        get: function (slug) { return games[slug] || null; },
        current: function () { return lastRegistered; },
        getPlays: getPlays,
        addPlay: addPlay
    };
})();
