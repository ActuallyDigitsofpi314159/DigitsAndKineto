/* DK Digital game audio: music and sound effects for the web games.
 *
 * Everything is synthesized live with Web Audio from the note patterns below
 * (original pieces written for these games), so there are no sound files and
 * nothing copyrighted.
 *
 *   DKAudio.init('wumpus-hunt');      // once; loads that game's saved on/off settings
 *   DKAudio.music('wumpus-cave');     // start / switch song (null = silence)
 *   DKAudio.sfx('jump');              // play a sound effect (see SFX below)
 *   DKAudio.intensity(0.7);           // 0-1, fades in a song's "danger" parts
 *   DKAudio.paused(true);             // quieter music while a game is paused
 *   DKAudio.musicOn / DKAudio.sfxOn   // current settings
 *   DKAudio.toggleMusic() / DKAudio.toggleSfx()
 *
 * Browsers only allow sound after the player clicks, taps or presses a key; the
 * module listens for that itself and starts the music then.
 */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuffer = null;
  var gameId = 'game';
  var settings = { music: true, sfx: true };
  var wantedSong = null, current = null, intensityValue = 0, isPaused = false;
  var lastSfx = {};

  /* ------------------------------------------------------------ setup */

  function load() {
    try {
      var saved = JSON.parse(window.localStorage.getItem('dk-audio:' + gameId) || 'null');
      if (saved) {
        settings.music = saved.music !== false;
        settings.sfx = saved.sfx !== false;
      }
    } catch (e) { /* storage blocked: keep defaults */ }
  }
  function save() {
    try { window.localStorage.setItem('dk-audio:' + gameId, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  function ensure() {
    if (ctx || !AC) return !!ctx;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }
    var squash = ctx.createDynamicsCompressor();
    squash.threshold.value = -14;
    squash.ratio.value = 5;
    squash.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(squash);
    musicBus = ctx.createGain();
    musicBus.gain.value = settings.music ? musicLevel() : 0;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfx ? 1 : 0;
    sfxBus.connect(master);
    var rate = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, Math.floor(rate * 1.5), rate);
    var d = noiseBuffer.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function musicLevel() { return isPaused ? 0.3 : 0.55; }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
    if (wantedSong && !current && settings.music) startSong(wantedSong);
  }
  ['pointerdown', 'touchend', 'keydown', 'mousedown'].forEach(function (name) {
    window.addEventListener(name, unlock, true);
  });
  // no music from a background tab
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });

  /* ------------------------------------------------------------ building blocks */

  var NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteFreq(name) {
    var m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return 0;
    var n = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  // envelope: quick rise, hold, fade (exponential ramps never reach exactly 0)
  function env(param, t, peak, attack, hold, release) {
    peak = Math.max(peak, 0.0001);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) param.setValueAtTime(peak, t + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return t + attack + hold + release;
  }

  function osc(type, freq, t, out) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(out);
    return o;
  }

  function noise(t, out, offset) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuffer;
    s.loop = true;
    s.connect(out);
    s.start(t, offset || Math.random());
    return s;
  }

  function gainNode(out, value) {
    var g = ctx.createGain();
    g.gain.value = value === undefined ? 1 : value;
    g.connect(out);
    return g;
  }

  function filter(type, freq, q, out) {
    var f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    f.connect(out);
    return f;
  }

  /* ------------------------------------------------------------ instruments */

  var INSTRUMENTS = {
    bass: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0);
      var lp = filter('lowpass', 700, 1, g);
      var o = osc('triangle', f, t, lp), o2 = osc('square', f, t, gainNode(lp, 0.18));
      var end = env(g.gain, t, vol, 0.01, Math.max(0, dur - 0.08), 0.1);
      o.start(t); o.stop(end); o2.start(t); o2.stop(end);
    },
    pluck: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0);
      var lp = filter('lowpass', 2600, 0.7, g);
      var o = osc('triangle', f, t, lp);
      var end = env(g.gain, t, vol, 0.004, 0, Math.min(1.2, 0.25 + dur));
      o.start(t); o.stop(end);
    },
    lead: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0);
      var lp = filter('lowpass', 2400, 0.8, g);
      var o = osc('square', f, t, lp);
      var vib = osc('sine', 5.5, t, gainNode(o.frequency, f * 0.006));
      var end = env(g.gain, t, vol * 0.55, 0.012, Math.max(0, dur - 0.06), 0.08);
      o.start(t); o.stop(end); vib.start(t); vib.stop(end);
    },
    pad: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0);
      var lp = filter('lowpass', 1100, 0.6, g);
      var a = osc('sawtooth', f, t, lp), b = osc('sawtooth', f, t, lp);
      a.detune.value = -8; b.detune.value = 8;
      var attack = Math.min(0.6, dur * 0.4);
      var end = env(g.gain, t, vol * 0.4, attack, Math.max(0, dur - attack), 0.7);
      a.start(t); a.stop(end); b.start(t); b.stop(end);
    },
    bell: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0), g2 = gainNode(out, 0);
      var o = osc('sine', f, t, g), o2 = osc('sine', f * 2.76, t, g2);
      var end = env(g.gain, t, vol, 0.003, 0, 1.8);
      env(g2.gain, t, vol * 0.25, 0.003, 0, 0.5);
      o.start(t); o.stop(end); o2.start(t); o2.stop(end);
    },
    drone: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0);
      var lp = filter('lowpass', 380, 2, g);
      var wob = osc('sine', 0.15, t, gainNode(lp.frequency, 160));
      var o = osc('sawtooth', f, t, lp), o2 = osc('sine', f / 2, t, gainNode(g, 0.6));
      var attack = Math.min(1.2, dur * 0.4);
      var end = env(g.gain, t, vol * 0.5, attack, Math.max(0, dur - attack), 1.0);
      o.start(t); o.stop(end); o2.start(t); o2.stop(end); wob.start(t); wob.stop(end);
    },
    kick: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0);
      var o = osc('sine', 150, t, g);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      var end = env(g.gain, t, vol, 0.002, 0, 0.22);
      o.start(t); o.stop(end);
    },
    snare: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0);
      var s = noise(t, filter('bandpass', 1900, 0.8, g));
      var body = gainNode(out, 0), o = osc('triangle', 190, t, body);
      var end = env(g.gain, t, vol * 0.8, 0.002, 0, 0.16);
      env(body.gain, t, vol * 0.4, 0.002, 0, 0.08);
      s.stop(end); o.start(t); o.stop(end);
    },
    hat: function (f, t, dur, vol, out) {
      var g = gainNode(out, 0);
      var s = noise(t, filter('highpass', 7500, 0.5, g));
      s.stop(env(g.gain, t, vol * 0.35, 0.001, 0, 0.05));
    },
    heart: function (f, t, dur, vol, out) { // two soft low thumps
      [0, 0.17].forEach(function (d, i) {
        var g = gainNode(out, 0), o = osc('sine', i ? 52 : 60, t + d, g);
        o.frequency.exponentialRampToValueAtTime(35, t + d + 0.12);
        o.start(t + d); o.stop(env(g.gain, t + d, vol * (i ? 0.7 : 1), 0.004, 0, 0.18));
      });
    },
    drip: function (f, t, dur, vol, out) { // water drop in a cave
      var g = gainNode(out, 0), o = osc('sine', f, t, g);
      o.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.06);
      o.start(t); o.stop(env(g.gain, t, vol, 0.002, 0, 0.12));
    }
  };

  /* ------------------------------------------------------------ songs (original) */
  // Each part is a string of steps: a note (D3, F#4, Bb2) starts a note, "-" holds it,
  // "." is a rest. Drums use "x" (hit) and "X" (accent). "|" just marks bars.
  // step: steps per beat. layer: "danger" parts follow intensity(), "calm" parts fade as it rises.
  var SONGS = {
    // Wumpus Hunt - title: a curious, bouncy D minor tune
    'wumpus-title': { bpm: 104, step: 2, parts: [
      { inst: 'bass', vol: 0.32, seq: 'D2 - - - D2 - A1 - | Bb1 - - - Bb1 - F2 - | C2 - - - C2 - G1 - | A1 - - - A1 - E2 -' },
      { inst: 'pluck', vol: 0.16, seq: 'D4 F4 A4 F4 D4 F4 A4 D5 | D4 F4 Bb4 F4 D4 F4 Bb4 D5 | E4 G4 C5 G4 E4 G4 C5 E5 | C#4 E4 A4 E4 C#4 E4 A4 C#5' },
      { inst: 'bell', vol: 0.12, seq: 'A5 - - - . . D6 . | . . . . F5 - - - | G5 - - - . . E5 . | A5 - - - - - . . | ' +
        'F5 - - - . . A5 . | Bb5 - - - A5 - G5 . | E5 - - - G5 - C6 . | C#6 - - - - - . .' },
      { inst: 'kick', vol: 0.4, seq: 'x . . . x . . . | x . . . x . . . | x . . . x . . . | x . . . x . x .' },
      { inst: 'hat', vol: 0.3, seq: '. . x . . . x . ' }
    ] },
    // Wumpus Hunt - in the cave: slow and watchful
    'wumpus-cave': { bpm: 84, step: 2, parts: [
      { inst: 'drone', vol: 0.3, seq: 'D2 - - - - - - - - - - - - - - - | Bb1 - - - - - - - C2 - - - - - - -' },
      { inst: 'pluck', vol: 0.14, seq: 'D4 . Eb4 . D4 . . . | A3 . . . Bb3 . A3 . | D4 . F4 . Eb4 . D4 . | C4 . . . A3 . . . ' },
      { inst: 'heart', vol: 0.18, layer: 'danger', seq: 'x . . . . . . . ' },
      { inst: 'drip', vol: 0.06, seq: '. . . . . . . . | . . . A6 . . . . | . . . . . . . . | . . . . . E6 . . | . . . . . . . . ' }
    ] },
    // Maze Man 2 - title: cold, empty halls
    'maze-title': { bpm: 70, step: 2, parts: [
      { inst: 'drone', vol: 0.34, seq: 'C2 - - - - - - - | Ab1 - - - - - - - | F1 - - - - - - - | G1 - - - - - - - ' },
      { inst: 'pad', vol: 0.16, seq: 'Eb3 - - - - - - - | C3 - - - - - - - | Ab2 - - - - - - - | B2 - - - - - - - ' },
      { inst: 'bell', vol: 0.09, seq: 'G5 . . . Eb5 . . . | . . . . . . . . | F5 . . . D5 . . . | . . . . B4 - - - ' }
    ] },
    // Maze Man 2 - in the maze: a low pulse; the heartbeat and strings creep in as Larry gets close
    'maze-game': { bpm: 76, step: 2, parts: [
      { inst: 'drone', vol: 0.3, seq: 'C2 - - - - - - - - - - - - - - - | Db2 - - - - - - - C2 - - - - - - - ' },
      { inst: 'bass', vol: 0.18, layer: 'calm', seq: 'C2 . . . . . . . | . . . . G1 . . . ' },
      { inst: 'bell', vol: 0.05, layer: 'calm', seq: '. . . . . . . . | . . G5 . . . . . | . . . . . . . . | . . . . . Db5 . . ' },
      { inst: 'heart', vol: 0.5, layer: 'danger', seq: 'x . . . x . . . ' },
      { inst: 'pad', vol: 0.22, layer: 'danger', seq: 'C#5 - - - - - - - D5 - - - - - - - ' },
      { inst: 'pad', vol: 0.16, layer: 'danger', seq: 'G4 - - - - - - - Ab4 - - - - - - - ' }
    ] },
    // Path of Light - title: warm and hopeful
    'pol-title': { bpm: 72, step: 2, parts: [
      { inst: 'pad', vol: 0.2, seq: 'F3 - - - - - - - | D3 - - - - - - - | Bb2 - - - - - - - | C3 - - - - - - - ' },
      { inst: 'pad', vol: 0.15, seq: 'A3 - - - - - - - | F3 - - - - - - - | D3 - - - - - - - | E3 - - - - - - - ' },
      { inst: 'bell', vol: 0.1, seq: 'C6 . A5 . G5 . . . | A5 . F5 . . . . . | D5 . F5 . G5 . A5 . | G5 - - - . . . . | ' +
        'C6 . A5 . G5 . E5 . | F5 . . . A5 . . . | Bb5 . A5 . G5 . F5 . | E5 - - - . . . . ' }
    ] },
    // Path of Light - climbing: gentle steps upward
    'pol-game': { bpm: 84, step: 2, parts: [
      { inst: 'pad', vol: 0.16, seq: 'F3 - - - - - - - | C3 - - - - - - - | D3 - - - - - - - | Bb2 - - - - - - - ' },
      { inst: 'bass', vol: 0.2, seq: 'F2 . . . F2 . . . | C2 . . . C2 . . . | D2 . . . D2 . . . | Bb1 . . . C2 . . . ' },
      { inst: 'pluck', vol: 0.1, seq: 'F4 A4 C5 A4 F4 A4 C5 E5 | C4 E4 G4 E4 C4 E4 G4 C5 | D4 F4 A4 F4 D4 F4 A4 D5 | Bb3 D4 F4 D4 C4 E4 G4 E4' },
      { inst: 'bell', vol: 0.07, seq: '. . . . . . . . | A5 . . . G5 . . . | . . . . . . . . | F5 . . . E5 . . . | ' +
        '. . . . . . . . | C6 . . . A5 . . . | . . . . . . . . | G5 - - - . . . . ' }
    ] },
    // Generic Platformer: a bright, bouncy adventure loop in C
    'generic-main': { bpm: 128, step: 2, parts: [
      { inst: 'bass', vol: 0.3, seq: 'C3 . C3 . G2 . C3 . | A2 . A2 . E2 . A2 . | F2 . F2 . C3 . F2 . | G2 . G2 . D3 . G2 . ' },
      { inst: 'lead', vol: 0.2, seq: 'E5 - G5 - C6 - B5 A5 | G5 - E5 - C5 - D5 E5 | F5 - A5 - C6 - A5 F5 | G5 - - - D5 - G5 - | ' +
        'E5 - - C5 E5 G5 - E5 | A5 - G5 - E5 - C5 - | F5 - E5 - D5 - C5 - | D5 - - - G4 - B4 - ' },
      { inst: 'pluck', vol: 0.1, seq: 'C4 E4 G4 E4 C4 E4 G4 E4 | A3 C4 E4 C4 A3 C4 E4 C4 | F3 A3 C4 A3 F3 A3 C4 A3 | G3 B3 D4 B3 G3 B3 D4 B3' },
      { inst: 'kick', vol: 0.5, seq: 'x . . . x . . . ' },
      { inst: 'snare', vol: 0.32, seq: '. . x . . . x . ' },
      { inst: 'hat', vol: 0.5, seq: 'x x x x x x x X ' }
    ] }
  };

  function parseSong(song) {
    if (song.parsed) return song.parsed;
    song.parsed = song.parts.map(function (part) {
      var tokens = part.seq.split(/[\s|]+/).filter(Boolean);
      var events = []; // [step, freq, steps]
      for (var i = 0; i < tokens.length; i++) {
        var tk = tokens[i];
        if (tk === '.' || tk === '-') continue;
        var len = 1;
        while (i + len < tokens.length && tokens[i + len] === '-') len++;
        var accent = tk === 'X';
        events.push([i, tk === 'x' || tk === 'X' ? 0 : noteFreq(tk), len, accent]);
      }
      return { part: part, length: tokens.length, events: events };
    });
    return song.parsed;
  }

  /* ------------------------------------------------------------ the music player */

  function layerLevel(part) {
    if (part.layer === 'danger') return intensityValue;
    if (part.layer === 'calm') return 1 - 0.75 * intensityValue;
    return 1;
  }

  function startSong(name) {
    if (!ctx || !SONGS[name]) return;
    stopSong(0.8);
    var song = SONGS[name];
    var bus = gainNode(musicBus, 1);
    var parts = parseSong(song).map(function (p) {
      var g = gainNode(bus, 0);
      g.gain.setTargetAtTime(layerLevel(p.part), ctx.currentTime, 0.4);
      return { info: p, gain: g };
    });
    current = {
      name: name, song: song, parts: parts, bus: bus,
      stepTime: 60 / song.bpm / song.step,
      start: ctx.currentTime + 0.12, nextStep: 0, timer: null
    };
    pump(current);
  }

  function stopSong(fade) {
    if (!current) return;
    var old = current;
    current = null;
    clearTimeout(old.timer);
    if (ctx) {
      var now = ctx.currentTime;
      old.bus.gain.cancelScheduledValues(now);
      old.bus.gain.setValueAtTime(old.bus.gain.value, now);
      old.bus.gain.linearRampToValueAtTime(0.0001, now + (fade || 0.05));
      setTimeout(function () { try { old.bus.disconnect(); } catch (e) { /* gone */ } }, ((fade || 0.05) + 3) * 1000);
    }
  }

  function pump(state) {
    if (current !== state) return;
    var now = ctx.currentTime;
    if (state.start + state.nextStep * state.stepTime < now - 0.5) { // woke up from a long sleep: jump ahead
      state.nextStep = Math.ceil((now - state.start) / state.stepTime);
    }
    while (state.start + state.nextStep * state.stepTime < now + 0.3) {
      var stepIndex = state.nextStep;
      var at = state.start + stepIndex * state.stepTime;
      for (var p = 0; p < state.parts.length; p++) {
        var info = state.parts[p].info, local = stepIndex % info.length;
        for (var e = 0; e < info.events.length; e++) {
          var ev = info.events[e];
          if (ev[0] !== local) continue;
          var inst = INSTRUMENTS[info.part.inst];
          if (inst && at >= now - 0.02) {
            inst(ev[1], Math.max(at, now), ev[2] * state.stepTime, info.part.vol * (ev[3] ? 1.4 : 1), state.parts[p].gain);
          }
        }
      }
      state.nextStep++;
    }
    state.timer = setTimeout(function () { pump(state); }, 90);
  }

  /* ------------------------------------------------------------ sound effects */

  function sweep(type, from, to, t, length, vol, out) {
    var g = gainNode(out, 0), o = osc(type, from, t, g);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + length);
    o.start(t); o.stop(env(g.gain, t, vol, 0.005, length * 0.4, length * 0.6));
  }
  function noiseHit(type, freq, t, length, vol, out, q) {
    var g = gainNode(out, 0);
    noise(t, filter(type, freq, q || 0.8, g)).stop(env(g.gain, t, vol, 0.004, 0, length));
  }
  function notes(inst, list, gap, vol, out, t) {
    list.forEach(function (n, i) { INSTRUMENTS[inst](noteFreq(n), t + i * gap, gap, vol, out); });
  }

  var SFX = {
    click: function (t, o, v) { sweep('sine', 900, 1200, t, 0.05, 0.25 * v, o); },
    toggle: function (t, o, v) { sweep('triangle', 600, 900, t, 0.06, 0.25 * v, o); },
    jump: function (t, o, v) { sweep('square', 280, 720, t, 0.13, 0.12 * v, filter('lowpass', 2500, 0.7, o)); },
    land: function (t, o, v) { noiseHit('lowpass', 500, t, 0.09, 0.5 * v, o); sweep('sine', 120, 60, t, 0.08, 0.3 * v, o); },
    boing: function (t, o, v) {
      var g = gainNode(o, 0), osc1 = osc('sine', 180, t, g);
      osc1.frequency.exponentialRampToValueAtTime(820, t + 0.3);
      var wob = osc('sine', 22, t, gainNode(osc1.frequency, 60));
      var end = env(g.gain, t, 0.35 * v, 0.005, 0.1, 0.3);
      osc1.start(t); osc1.stop(end); wob.start(t); wob.stop(end);
    },
    burn: function (t, o, v) { noiseHit('highpass', 2500, t, 0.45, 0.4 * v, o); sweep('sawtooth', 300, 70, t, 0.4, 0.14 * v, filter('lowpass', 900, 1, o)); },
    fall: function (t, o, v) { sweep('triangle', 900, 120, t, 0.8, 0.22 * v, o); },
    win: function (t, o, v) { notes('pluck', ['C5', 'E5', 'G5', 'C6'], 0.1, 0.35 * v, o, t); notes('bell', ['G6'], 0.1, 0.2 * v, o, t + 0.4); },
    levelup: function (t, o, v) { notes('bell', ['C6', 'E6', 'G6', 'C7'], 0.09, 0.22 * v, o, t); noiseHit('highpass', 6000, t, 0.8, 0.1 * v, o); },
    death: function (t, o, v) { sweep('sawtooth', 320, 60, t, 0.9, 0.16 * v, filter('lowpass', 1200, 1, o)); noiseHit('lowpass', 400, t, 0.6, 0.3 * v, o); },
    step: function (t, o, v) { sweep('triangle', 210 + Math.random() * 60, 120, t, 0.07, 0.22 * v, o); },
    footstep: function (t, o, v) { noiseHit('lowpass', 300 + Math.random() * 120, t, 0.08, 0.25 * v, o); },
    bowdraw: function (t, o, v) { noiseHit('bandpass', 900, t, 0.22, 0.2 * v, o, 4); sweep('triangle', 160, 260, t, 0.2, 0.12 * v, o); },
    bowaway: function (t, o, v) { sweep('triangle', 260, 150, t, 0.12, 0.12 * v, o); },
    shoot: function (t, o, v) { sweep('triangle', 420, 140, t, 0.18, 0.3 * v, o); noiseHit('bandpass', 2400, t, 0.35, 0.18 * v, o, 1.5); },
    hit: function (t, o, v) { noiseHit('lowpass', 600, t, 0.15, 0.5 * v, o); notes('bell', ['A5', 'E6'], 0.09, 0.2 * v, o, t + 0.05); },
    roar: function (t, o, v) {
      var g = gainNode(o, 0), lp = filter('lowpass', 700, 2, g);
      var a = osc('sawtooth', 75, t, lp), b = osc('sawtooth', 79, t, lp);
      a.frequency.exponentialRampToValueAtTime(55, t + 1.2);
      var trem = osc('sine', 13, t, gainNode(g.gain, 0.15 * v));
      var end = env(g.gain, t, 0.35 * v, 0.06, 0.6, 0.6);
      a.start(t); a.stop(end); b.start(t); b.stop(end); trem.start(t); trem.stop(end);
      noiseHit('bandpass', 400, t, 1.0, 0.25 * v, o, 1);
    },
    pitfall: function (t, o, v) { sweep('sine', 700, 60, t, 1.6, 0.25 * v, o); noiseHit('bandpass', 800, t, 1.4, 0.12 * v, o, 0.6); },
    bats: function (t, o, v) { for (var i = 0; i < 8; i++) noiseHit('bandpass', 1200 + Math.random() * 600, t + i * 0.07, 0.05, 0.22 * v, o, 2); },
    lose: function (t, o, v) { notes('pluck', ['E4', 'D#4', 'D4', 'C#4'], 0.22, 0.3 * v, o, t); },
    whoosh: function (t, o, v) { noiseHit('bandpass', 700, t, 0.5, 0.18 * v, o, 0.7); },
    jumpscare: function (t, o, v) {
      noiseHit('highpass', 900, t, 1.1, 0.7 * v, o);
      ['C3', 'C#3', 'F#3', 'G4', 'G#4'].forEach(function (n) {
        var g = gainNode(o, 0), x = osc('sawtooth', noteFreq(n), t, g);
        x.frequency.exponentialRampToValueAtTime(noteFreq(n) * 0.7, t + 1.0);
        x.start(t); x.stop(env(g.gain, t, 0.12 * v, 0.01, 0.4, 0.7));
      });
    },
    portal: function (t, o, v) { sweep('sine', 200, 1600, t, 0.9, 0.2 * v, o); notes('bell', ['C6', 'G6', 'C7'], 0.12, 0.15 * v, o, t + 0.3); },
    growl: function (t, o, v) {
      var g = gainNode(o, 0), x = osc('sawtooth', 62, t, filter('lowpass', 500, 3, g));
      var trem = osc('sine', 9, t, gainNode(g.gain, 0.1 * v));
      var end = env(g.gain, t, 0.25 * v, 0.2, 0.5, 0.6);
      x.start(t); x.stop(end); trem.start(t); trem.stop(end);
    }
  };

  /* ------------------------------------------------------------ public API */

  var DK = window.DKAudio = {
    get musicOn() { return settings.music; },
    get sfxOn() { return settings.sfx; },
    init: function (id) {
      gameId = id || gameId;
      load();
      return DK;
    },
    music: function (name) {
      if (name === wantedSong) return;
      wantedSong = name || null;
      if (wantedSong && ensure() && ctx.state === 'suspended' && !document.hidden) {
        ctx.resume(); // allowed if the player already clicked on this site; otherwise waits for unlock()
      }
      if (!ctx || ctx.state !== 'running' && !current) {
        if (!wantedSong) stopSong(0.6);
        return; // starts on the next click / key press (unlock)
      }
      if (!wantedSong) { stopSong(0.8); return; }
      if (settings.music) startSong(wantedSong);
    },
    sfx: function (name, volume) {
      if (!settings.sfx || !SFX[name] || !ensure()) return;
      if (ctx.state !== 'running') return;
      var now = ctx.currentTime;
      if (lastSfx[name] && now - lastSfx[name] < 0.05) return; // same sound twice in one frame
      lastSfx[name] = now;
      try { SFX[name](now + 0.005, sfxBus, volume === undefined ? 1 : volume); } catch (e) { /* never break the game */ }
    },
    intensity: function (value) {
      value = Math.max(0, Math.min(1, value || 0));
      if (Math.abs(value - intensityValue) < 0.02) return;
      intensityValue = value;
      if (!current || !ctx) return;
      current.parts.forEach(function (p) { p.gain.gain.setTargetAtTime(layerLevel(p.info.part), ctx.currentTime, 0.3); });
    },
    paused: function (state) {
      if (!!state === isPaused) return;
      isPaused = !!state;
      if (ctx && settings.music) musicBus.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.15);
    },
    setMusic: function (on) {
      settings.music = !!on;
      save();
      if (!ensure()) return;
      musicBus.gain.setTargetAtTime(settings.music ? musicLevel() : 0, ctx.currentTime, 0.08);
      if (settings.music && wantedSong && !current && ctx.state === 'running') startSong(wantedSong);
      if (!settings.music) stopSong(0.3);
    },
    setSfx: function (on) {
      settings.sfx = !!on;
      save();
      if (!ensure()) return;
      sfxBus.gain.setTargetAtTime(settings.sfx ? 1 : 0, ctx.currentTime, 0.02);
    },
    toggleMusic: function () { DK.setMusic(!settings.music); return settings.music; },
    toggleSfx: function () { DK.setSfx(!settings.sfx); if (settings.sfx) DK.sfx('toggle'); return settings.sfx; },
    // for testing: the song and effect names
    songs: Object.keys(SONGS),
    effects: Object.keys(SFX)
  };
})();
