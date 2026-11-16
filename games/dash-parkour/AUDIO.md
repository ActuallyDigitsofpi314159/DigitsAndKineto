# DASH Parkour: audio asset list

Every song and sound effect in DASH Parkour is synthesized in the browser
with the Web Audio API. There are no audio files to load. This page lists
every audio asset, where it lives and when the game plays it.

How the music is built, and which motifs each song uses, is described in
[`dash-parkour/audio/README.md`](../../dash-parkour/audio/README.md).

## Files

| File | Type | What it holds |
|---|---|---|
| `dash-parkour/audio/dash-audio.js` | Engine | Synth instruments, mixer, music player, `window.DashAudio` |
| `dash-parkour/audio/dash-music.js` | Songs | All 17 songs and cutscene cues (`window.DASH_SONGS`) and the motifs (`window.DASH_MOTIFS`) |
| `dash-parkour/audio/dash-sfx.js` | Sound effects | All 86 effects (`window.DASH_SFX`) |
| `dash-parkour/index.html` | Triggers | `dashMusicTrack()` picks the song, `dashMusicTick()` sends the game state, `sfx()` / `sfxAt()` play effects |
| `dash-parkour/Dash Main Motif.mid` | Source | The Dash motif (used in every song) |
| `dash-parkour/Boss battle motif.mid` | Source | The Guards' motif |
| `_sound-test/index.html` | Team tool | Plays every song, boss state and effect. Not published on the site |
| `_sound-test/export.html`, `export-music.py` | Team tool | Renders the whole soundtrack to numbered WAV / MP3 files for the OST |

A recording can replace any synthesized sound. Paste a DK Converter object
into the `DASH_SOUNDS` or `DASH_MUSIC` slots at the top of `index.html`.

## Music

All songs are in `dash-music.js`, under the names below. "Loop" songs repeat
seamlessly. "Dynamic" songs change with the game. "Cue" songs follow a
cutscene scene by scene, then hold a quiet loop.

| Song | Type | Where and when | Sections, layers and variations |
|---|---|---|---|
| `title` | Loop | Title screen, menus, settings, achievements, runs; the map when no area is selected | intro → A → B → bridge → A2 → (A) |
| `area1` | Loop | Area 1 levels (1-1 to 1-3), 1-4 before the fight, Area 1 on the map | intro → A → A2 → B → C → (A) |
| `area2` | Loop | Area 2 levels, 2-4 before the fight, Area 2 on the map | intro → A (minor) → A2 (major) → B → C → (A) |
| `area3` | Loop | Area 3 levels, 3-4 before the fight, Area 3 on the map | intro → A → B → A2 → bridge → (A) |
| `areaX` | Loop | Area X levels X-1 and X-2, X-4 before the Parkour Master's arena rises, Area X on the map | intro → A → B → A2 → (A) |
| `ech0` | Dynamic | X-3, the race against ECH0 | intro → A → B → A2 → (A).<br>**Layers:** `close` (taiko, snare, high choir) while ECH0 is within 600 px of Dash. |
| `shop` | Loop | The shop | intro → A → B → (A); swung |
| `guard1` | Dynamic | Diamond Guard fight (1-4), from the moment the arena rises | **Sections:** intro (arena rising) → introLoop (waits for the fight) → A ↔ B → end (defeat chord).<br>**Layers:** `groove`, `riff`, `lead` (off while the Guard is tired), `vuln` (the opening), `attack` and one colour per attack (`atk_bullets`, `atk_bombs`, `atk_icicles`, `atk_spikes`).<br>**One-shots:** a riser and strike for the dive, and a crash when the band comes back. |
| `guard2` | Dynamic | Emerald Guard fight (2-4) | As `guard1`, 168 BPM, plus `emerald` (string ostinato) |
| `guard3` | Dynamic | Ruby Guard fight (3-4) | As `guard2`, 172 BPM, plus `ruby` (choir, 16th hats) |
| `final1` | Dynamic | Final Boss Stage 1: the Parkour Master (X-4 arena) | **Sections:** as the Guards.<br>**Layers:** `atk_laser`, `atk_fall`, `atk_decay`, `atk_poison`, plus `phase2` (choir, timpani, 16th strings and hats) for waves 4 and 5. |
| `final2` | Dynamic | Final Boss Stage 2: the vortex, then the "into Area 1" cutscene | **Sections:** intro → V ↔ W, in a new key for 3 lives (V3/W3) and 2 lives (V2/W2).<br>**Layers:** `l4`, `l3`, `l2` join as lives are lost, `alarm` while stabilizing, `danger` at low stability.<br>**Hero:** Hin → H ↔ H2 at the final stabilization.<br>**Escape:** e1–e7 (escape cutscene scenes) → escHold. |
| `final3` | Loop | Final Mini-Stage 3: the chase back through Area 1 | intro → three laps of A, B (duel), C (climb), in F, F♯ and G minor → (A0) |
| `prologue` | Cue | The opening story cutscene ("One day...") | 13 scenes, then a hold; leads into `title` |
| `cutPortal` | Cue | After the Ruby Guard ("...the challenge is not over") | 5 scenes, then a hold |
| `cutMasterX` | Cue | After the Parkour Master falls (the Master X reveal) | 14 scenes, then a hold; leads into `final2` |
| `ending` | Cue | The ending ("victory") after catching Master X | 7 scenes, then a hold; leads into `title` |

No music plays during the level-complete and game-over jingles. Pausing
muffles the music and keeps it going.

### Jingles

These are in `dash-sfx.js` and played as effects. They dip the music while
they play.

| Name | When | What it is |
|---|---|---|
| `levelComplete` | A normal level is finished | The motif's first bar as a brass fanfare, landing on C major |
| `bossFanfare` | A boss level is finished | The dash cell climbing three times, then a big chord |
| `gameOver` | Game over | The motif's drop in C minor, slow and heavy |

## Sound effects

All in `dash-sfx.js`. Every effect has a minimum gap so it can't machine-gun.
"Menu" effects play on the music/menu audio and keep going in the pause menu.
"Game" effects play on the game audio, which freezes while paused.

### Menus and screens

| Name | Context | When | Variations |
|---|---|---|---|
| `click` | Menu | Any canvas button, the mobile menu button, copying a save code | |
| `hover` | Menu | The pointer moves onto a clickable thing (mouse only; off after any touch) | |
| `toggle` | Menu | A settings switch flips | Rises for on, falls for off |
| `slider` | Menu | The render-scale slider moves | Pitch follows the slider |
| `sceneWipe` | Menu | A scene transition starts (if transitions are on) | |
| `pauseOpen` / `pauseClose` | Menu | The pause (Q) menu opens / closes | |
| `levelStart` | Menu | A level begins | |
| `levelExit` | Menu | Leaving a finished level | |
| `achievement` | Menu | An achievement unlocks | |
| `buy` / `equip` / `denied` | Menu | Shop: buying, equipping, not enough vouchers | |
| `voucher` | Menu | Vouchers are awarded | |
| `sign` | Game | A sign's tip appears | |

### Dash

| Name | Context | When | Variations |
|---|---|---|---|
| `jump` | Game | Dash jumps | |
| `land` | Game | Landing on any surface | Louder for harder landings |
| `hurt` | Game | Losing more than 4 HP at once; a soft one every 12 HP of steady damage | `spike`, `crush` or `hit`, from the cause; volume follows the damage |
| `burn` | Game | Standing in lava (a few times a second) | |
| `poison` | Game | Falling into poison | |
| `zap` / `unzap` | Game | Paralysed / paralysis wears off | |
| `freeze` / `thaw` | Game | Frozen by an icicle / thawing out | |
| `decay` | Game | Starting to decay | |
| `death` | Game | Dash dies | |
| `respawn` | Game | Dash respawns | |
| `checkpoint` | Game | Reaching a checkpoint | |

### Level objects

| Name | Context | When | Variations |
|---|---|---|---|
| `trampoline` | Game | Bouncing on a trampoline | |
| `launcher` / `launchLand` | Game | A launcher fires Dash / Dash lands after a launch | |
| `boingJump` | Game | A Boing enemy jumps | Panned and quieter with distance |
| `zappCrackle` | Game | Near a Zapp enemy | Panned and quieter with distance; a different crackle each time |
| `spikeWave` | Game | A wave of spikes rises | |

### Guards (bosses 1 to 3)

| Name | Context | When | Variations |
|---|---|---|---|
| `bossRumble` | Game | The arena rises (boss intro) | |
| `bossBanner` | Menu | The boss name banner drops in | |
| `bossHop` | Game | A Guard lands from a hop | Panned by position |
| `boingLand` | Game | A minion lands | Panned, quieter |
| `bossShoot` / `bulletPop` | Game | Bullets fired / a bullet hits | |
| `diveCharge` / `diveSlam` | Game | Dive wind-up (length follows the wind-up) / the dive lands | |
| `bombThrow` / `bombExplode` | Game | A bomb thrown / exploding | |
| `icicleForm` / `icicleShatter` | Game | Icicles form / shatter | `icicleForm`: a slightly different shimmer each time |
| `bossTired` | Game | The boss tires (the opening) | |
| `bossRecover` | Game | The opening was missed | |
| `bossHit` | Game | Dash hits the boss | |
| `bossDefeat` | Game | The boss is defeated | |

### Parkour Master (Final Stage 1)

| Name | Context | When | Variations |
|---|---|---|---|
| `cloneSummon` / `cloneVanish` | Game | Clones (or a minion) appear / vanish | Quieter for a single minion |
| `laserCharge` / `laserFire` | Game | The laser cross charges / fires (also the vortex's paralysis beams) | |
| `hazardFall` | Game | Parkour hazards drop from above | Slightly different each time |
| `decayZone` | Game | Decay spots appear | |
| `poisonWave` | Game | The poison wave starts | |

### Vortex (Final Stage 2)

| Name | Context | When | Variations |
|---|---|---|---|
| `fireball` / `spikeWall` / `thornShot` / `poisonSpray` / `vortexZap` | Game | Each vortex attack | `poisonSpray`: random bubbles |
| `vortexAlarm` | Game | The vortex starts collapsing (stabilize now) | |
| `touchpoint` | Game | Touching a touchpoint | Each one plays the next note of the Dash motif |
| `vortexBreak` | Game | A vortex life is broken | |
| `vortexSwallow` | Game | Swallowed by the vortex | |
| `victoryCatch` | Menu | Dash catches Master X (Stage 3) | |

### Cutscenes

| Name | Context | When |
|---|---|---|
| `cutWhoosh` | Menu | Prologue: the ground slides in (frames 636, 651). Master X reveal: he swoops past (1401, 1451) and Dash is pulled into the portal (1951). Into Area 1: out through the portal (191), Master X chases (321). Ending: sealed in the portal (151). After the Ruby Guard: the portal opens (331). |
| `cutImpact` | Menu | Prologue: the ground slams into place (671, 686). Master X reveal: the sacrifice (1041) and the MASTER X title (1501). Into Area 1: Dash lands (719). Ending: Dash's final strike (31). |

### Multiplayer

| Name | Context | When | Variations |
|---|---|---|---|
| `playerJoin` / `playerLeave` | Menu | A player joins / leaves | |
| `chat` | Menu | A chat message arrives | |
| `countBeep` / `countGo` | Menu | The 3-2-1 countdown / GO | |
| `raceWin` / `raceLose` | Menu | A race ends: you won / someone else won | |

### Admin tools

| Name | Context | When | Variations |
|---|---|---|---|
| `adminToggle` | Menu | An admin toggle (fly, noclip...) changes | |
| `teleportOut` / `teleportIn` | Game | Beaming away / arriving | |
| `strikeLock` / `strikeFire` / `strikeRing` | Game | Orbital strike: target lock, fire, ears ringing | `strikeRing` is quieter farther away |
| `skullBurst` | Game | Someone caught by a strike explodes | Slightly different each time |

## Exporting the soundtrack

`python3 _sound-test/export-music.py` renders every song with the game's engine in
headless Chrome and saves numbered 44.1 kHz WAV and 320 kbps MP3 files into
`ost-export/` (git-ignored). Use `--format wav` or `--format mp3` for one format,
and `--out <folder>` to save the files somewhere else. Loops play twice and fade out.
Boss songs play a scripted fight that ends with the defeat. Cutscene cues play
straight through.
