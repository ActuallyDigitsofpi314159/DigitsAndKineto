/* DK Digital universal mobile controls for the 3D games.
 *
 *   DKTouch.init({
 *     active:  function () { return true; },     // are controls live right now? (false on menus / pause / cutscenes)
 *     ignore:  function (target, x, y) {},       // return true to leave a touch alone (own HUD buttons, menus)
 *     jump:    true,                             // false = no jump button (e.g. Maze Man)
 *     onLook:  function (dx, dy) {},             // pixels dragged on the "look" area
 *     onJump:  function (down) {},               // optional
 *     bottomPad: 0                               // extra px to lift controls
 *   });
 *
 *   Read every frame:  DKTouch.move.x / DKTouch.move.y   (-1..1, y > 0 = backward / down)
 *                      DKTouch.jumpHeld, DKTouch.jumpBuffered()  (true for 150 ms after a tap)
 *
 * Behaviour (best of each game's old stick):
 *   - floating stick: appears wherever you press on the left 45% of the screen, with a ghost
 *     stick at the resting spot so people know where to start
 *   - base follows your thumb when you drag past the edge, so you never "lose" the stick
 *   - small dead zone, rescaled so movement ramps up smoothly from zero
 *   - responsive size, safe-area / portrait lift so browser bars never cover it
 *   - jump button: bottom-right, generous hit area, buffered taps, up-arrow icon
 *   - every other touch drags to look; all touches are multi-touch safe
 */
(function () {
  'use strict';
  var cfg = { active: function () { return true; }, ignore: null, jump: true, onLook: null, onJump: null, bottomPad: 0 };
  var DK = window.DKTouch = {
    move: { x: 0, y: 0 }, jumpHeld: false, enabled: false,
    jumpBuffered: function () { return performance.now() < jumpUntil; },
    consumeJump: function () { jumpUntil = 0; },
    reset: function () { releaseJoy(); releaseJump(); lookId = null; }
  };
  var DEAD = 0.12, STICK_ZONE = 0.45;
  var root, base, knob, jbtn, built = false, shown = false;
  var joyId = null, jumpId = null, lookId = null;
  var joyOX = 0, joyOY = 0, lastX = 0, lastY = 0, jumpUntil = 0, radius = 64;

  function isCoarse() {
    return window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : ('ontouchstart' in window);
  }
  function css() {
    var s = document.createElement('style');
    s.textContent =
      '#dk-touch{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:40;opacity:0;transition:opacity .2s;' +
      '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}' +
      '#dk-touch.on{opacity:1}' +
      '#dk-joy{position:absolute;border-radius:50%;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.4);box-sizing:border-box;transition:background .12s,opacity .2s}' +
      '#dk-joy.idle{opacity:.55}#dk-joy.active{background:rgba(255,255,255,.24)}' +
      '#dk-knob{position:absolute;left:50%;top:50%;border-radius:50%;background:rgba(255,255,255,.65);box-shadow:0 2px 8px rgba(0,0,0,.35)}' +
      '#dk-jump{position:absolute;border-radius:50%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;' +
      'background:rgba(255,255,255,.16);border:2px solid rgba(255,255,255,.5);transition:background .08s,transform .08s}' +
      '#dk-jump svg{width:48%;height:48%;fill:none;stroke:#fff;stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;opacity:.9}' +
      '#dk-jump.down{background:rgba(255,255,255,.4);transform:scale(.93)}';
    document.head.appendChild(s);
  }
  function build() {
    if (built || !document.body) return;
    built = true; css();
    root = document.createElement('div'); root.id = 'dk-touch';
    base = document.createElement('div'); base.id = 'dk-joy'; base.className = 'idle';
    knob = document.createElement('div'); knob.id = 'dk-knob'; base.appendChild(knob);
    root.appendChild(base);
    if (cfg.jump) {
      jbtn = document.createElement('div'); jbtn.id = 'dk-jump';
      jbtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 20V5"/><path d="M5.5 11.5 12 5l6.5 6.5"/></svg>';
      root.appendChild(jbtn);
    }
    document.body.appendChild(root);
    layout(); window.addEventListener('resize', layout); window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });
    (function tick() {
      var on = !!cfg.active();
      if (on !== shown) { shown = on; root.classList.toggle('on', on); if (!on) DK.reset(); }
      requestAnimationFrame(tick);
    })();
  }
  function layout() {
    if (!built) return;
    var w = window.innerWidth, h = window.innerHeight, m = Math.min(w, h);
    radius = Math.max(50, Math.min(80, m * 0.16));
    var portrait = h > w, lift = (portrait ? Math.max(90, h * 0.12) : Math.max(36, h * 0.08)) + cfg.bottomPad;
    var side = portrait ? 20 : 28;
    var kr = Math.max(38, Math.min(56, m * 0.11));
    var safeB = 'env(safe-area-inset-bottom,0px)';
    base.style.width = base.style.height = radius * 2 + 'px';
    knob.style.width = knob.style.height = radius * 0.9 + 'px';
    knob.style.margin = (-radius * 0.45) + 'px 0 0 ' + (-radius * 0.45) + 'px';
    if (joyId === null) restBase(lift, side, safeB);
    if (jbtn) {
      jbtn.style.width = jbtn.style.height = kr * 2 + 'px';
      jbtn.style.right = side + 4 + 'px'; jbtn.style.bottom = 'calc(' + (lift + 8) + 'px + ' + safeB + ')';
    }
    base._rest = [lift, side, safeB];
  }
  function restBase(lift, side, safeB) {
    base.style.left = side + 'px'; base.style.top = 'auto';
    base.style.bottom = 'calc(' + lift + 'px + ' + safeB + ')';
    base.className = 'idle';
  }
  function hitJump(x, y) {
    if (!jbtn) return false;
    var r = jbtn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = r.width / 2 * 1.35;
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad;
  }
  function setJoy(x, y) {
    var dx = x - joyOX, dy = y - joyOY, d = Math.sqrt(dx * dx + dy * dy);
    if (d > radius) { // drag the base along so the thumb never leaves it
      var k = (d - radius) / d; joyOX += dx * k; joyOY += dy * k;
      base.style.left = joyOX - radius + 'px'; base.style.top = joyOY - radius + 'px';
      dx = x - joyOX; dy = y - joyOY; d = radius;
    }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    var m = d / radius;
    if (m < DEAD) { DK.move.x = 0; DK.move.y = 0; return; }
    var s = (m - DEAD) / (1 - DEAD) / m;   // ramp smoothly from 0 outside the dead zone
    DK.move.x = dx / radius * s; DK.move.y = dy / radius * s;
  }
  function startJoy(id, x, y) {
    joyId = id; joyOX = x; joyOY = y;
    base.style.left = x - radius + 'px'; base.style.top = y - radius + 'px'; base.style.bottom = 'auto';
    base.className = 'active'; setJoy(x, y);
  }
  function releaseJoy() {
    if (!built) return;
    joyId = null; DK.move.x = 0; DK.move.y = 0; knob.style.transform = '';
    var r = base._rest; if (r) restBase(r[0], r[1], r[2]);
  }
  function pressJump() { DK.jumpHeld = true; jumpUntil = performance.now() + 150; if (jbtn) jbtn.classList.add('down'); if (cfg.onJump) cfg.onJump(true); }
  function releaseJump() {
    var was = DK.jumpHeld; jumpId = null; DK.jumpHeld = false;
    if (jbtn) jbtn.classList.remove('down');
    if (was && cfg.onJump) cfg.onJump(false);
  }

  function onStart(e) {
    if (!shown) return;
    var claimed = false;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], x = t.clientX, y = t.clientY;
      if (cfg.ignore && cfg.ignore(t.target, x, y)) continue;
      if (jumpId === null && hitJump(x, y)) { jumpId = t.identifier; pressJump(); }
      else if (joyId === null && x < window.innerWidth * STICK_ZONE) startJoy(t.identifier, x, y);
      else if (lookId === null) { lookId = t.identifier; lastX = x; lastY = y; }
      else continue;
      claimed = true;
    }
    if (claimed) e.preventDefault();
  }
  function onMove(e) {
    var used = false;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === joyId) { setJoy(t.clientX, t.clientY); used = true; }
      else if (t.identifier === lookId) {
        if (cfg.onLook) cfg.onLook(t.clientX - lastX, t.clientY - lastY);
        lastX = t.clientX; lastY = t.clientY; used = true;
      } else if (t.identifier === jumpId) used = true;
    }
    if (used) e.preventDefault();
  }
  function onEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var id = e.changedTouches[i].identifier;
      if (id === joyId) releaseJoy();
      if (id === jumpId) releaseJump();
      if (id === lookId) lookId = null;
    }
  }

  var wired = false;
  DK.init = function (opts) {
    for (var k in opts) cfg[k] = opts[k];
    if (!isCoarse() && !opts.force) return;
    DK.enable();
  };
  DK.enable = function () {
    if (DK.enabled) return; DK.enabled = true;
    if (!wired) {
      wired = true;
      document.addEventListener('touchstart', onStart, { passive: false });
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onEnd);
      window.addEventListener('blur', DK.reset);
    }
    if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
  };
})();
