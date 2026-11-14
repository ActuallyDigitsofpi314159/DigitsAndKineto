/* ==========================================================================
   SCARY LARRY - saved for later use.

   This is the real Larry from Maze Man 2 (also the "Scary Larry" skin in
   DASH Parkour): a stitched-up lab mutant with mismatched glowing eyes and
   needle teeth, drawn entirely with code. The drawing code below is copied
   word for word from maze-man-2/index.html, plus the few small helpers it
   needs, so this file works on its own.

   No page loads this file. To use it on any <canvas>:

       var ctx = canvas.getContext('2d');
       drawLarry(ctx, centreX, centreY, radius, { mouth: 0.25 });

   Options (all optional):
       mouth     0 = closed ... 1 = wide open
       lookX     -1 = eyes left ... 1 = eyes right
       lookY     -1 = eyes up ... 1 = eyes down
       emissive  true = draw only the glowing parts of the eyes (a glow mask)

   The head is about 1.9 x radius wide and reaches about 1.1 x radius below
   the centre, so on a square canvas of size N a good fit is
   drawLarry(ctx, N / 2, N * 0.482, N * 0.445, ...).
   ========================================================================== */
var TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function headPath(c, cx, cy, R) {
  c.beginPath();
  for (var i = 0; i <= 64; i++) {
    var th = i / 64 * TAU, sn = Math.sin(th);
    var r = R * (1 + 0.045 * Math.sin(3 * th + 0.7) + 0.03 * Math.sin(5 * th + 2.1) + 0.018 * Math.sin(9 * th + 1.3));
    var x = Math.cos(th) * r * 0.93, y = sn * r * (sn > 0 ? 1.08 : 1.0);
    if (sn > 0) x *= 1 - 0.3 * sn * sn;            // narrow, crooked jaw
    if (sn > 0) x += sn * sn * R * 0.04;
    if (i === 0) c.moveTo(cx + x, cy + y); else c.lineTo(cx + x, cy + y);
  }
  c.closePath();
}
function qpt(a, b, cc, t) { var u = 1 - t; return [u * u * a[0] + 2 * u * t * cc[0] + t * t * b[0], u * u * a[1] + 2 * u * t * cc[1] + t * t * b[1]]; }

function drawLarry(c, cx, cy, R, o) {
  o = o || {};
  var m = clamp(o.mouth || 0, 0, 1), lx = clamp(o.lookX || 0, -1, 1), ly = clamp(o.lookY || 0, -1, 1);
  var eL = { x: cx - 0.35 * R, y: cy - 0.16 * R }, eR = { x: cx + 0.33 * R, y: cy - 0.07 * R };
  if (o.emissive) {           // glow mask only (used for the 3D sprite)
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(eL.x + lx * 0.08 * R, eL.y + ly * 0.05 * R, 0.13 * R, 0, TAU); c.fill();
    c.beginPath(); c.arc(eR.x + lx * 0.05 * R, eR.y + ly * 0.03 * R, 0.08 * R, 0, TAU); c.fill();
    return;
  }
  c.save();
  // ---- head ----
  headPath(c, cx, cy, R);
  var sg = c.createRadialGradient(cx - 0.3 * R, cy - 0.45 * R, R * 0.05, cx, cy, R * 1.15);
  sg.addColorStop(0, '#c9343f'); sg.addColorStop(0.45, '#8f0b14'); sg.addColorStop(1, '#330004');
  c.fillStyle = sg; c.fill();
  c.save(); headPath(c, cx, cy, R); c.clip();
  // blotches
  for (var i = 0; i < 7; i++) {
    c.fillStyle = 'rgba(55,0,6,' + (0.25 + hash(i) * 0.25) + ')';
    c.beginPath();
    c.ellipse(cx + (hash(i + 10) - 0.5) * 1.5 * R, cy + (hash(i + 20) - 0.75) * 1.3 * R, R * (0.06 + hash(i + 30) * 0.12), R * (0.04 + hash(i + 40) * 0.08), hash(i + 50) * 3, 0, TAU);
    c.fill();
  }
  // veins
  c.strokeStyle = 'rgba(35,0,5,0.55)'; c.lineWidth = R * 0.014; c.lineCap = 'round';
  for (i = 0; i < 6; i++) {
    var va = hash(i + 60) * TAU, vx = cx + Math.cos(va) * R * 0.95, vy = cy + Math.sin(va) * R * 0.95;
    c.beginPath(); c.moveTo(vx, vy);
    c.quadraticCurveTo(lerp(vx, cx, 0.2) + (hash(i + 70) - 0.5) * R * 0.3, lerp(vy, cy, 0.2), lerp(vx, cx, 0.35), lerp(vy, cy, 0.35));
    c.stroke();
  }
  // highlight
  c.fillStyle = 'rgba(255,110,125,0.16)';
  c.beginPath(); c.ellipse(cx - 0.22 * R, cy - 0.58 * R, 0.34 * R, 0.13 * R, -0.2, 0, TAU); c.fill();
  // lower-face shadow
  var shg = c.createLinearGradient(0, cy + 0.2 * R, 0, cy + 1.1 * R);
  shg.addColorStop(0, 'rgba(0,0,0,0)'); shg.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = shg; c.fillRect(cx - R * 1.2, cy + 0.2 * R, R * 2.4, R);
  c.restore();
  headPath(c, cx, cy, R); c.strokeStyle = '#140002'; c.lineWidth = R * 0.045; c.stroke();

  // ---- forehead stitches ----
  var sp = [];
  for (i = 0; i <= 12; i++) { var t = i / 12; sp.push([cx + lerp(-0.5, 0.4, t) * R, cy + (lerp(-0.56, -0.7, t) + Math.sin(t * 9) * 0.025) * R]); }
  c.strokeStyle = '#2a0004'; c.lineWidth = R * 0.035; c.lineCap = 'round';
  c.beginPath(); c.moveTo(sp[0][0], sp[0][1]); for (i = 1; i < sp.length; i++) c.lineTo(sp[i][0], sp[i][1]); c.stroke();
  c.strokeStyle = '#d8c8a0'; c.lineWidth = R * 0.02;
  for (i = 1; i < 12; i += 2) {
    c.beginPath(); c.moveTo(sp[i][0] - R * 0.025, sp[i][1] - R * 0.07); c.lineTo(sp[i][0] + R * 0.025, sp[i][1] + R * 0.07); c.stroke();
  }
  // ---- temple bolt ----
  var bx = cx + 0.78 * R, by = cy - 0.3 * R;
  var bg = c.createRadialGradient(bx - R * 0.02, by - R * 0.02, 1, bx, by, R * 0.075);
  bg.addColorStop(0, '#d6d6d6'); bg.addColorStop(1, '#3b3b3b');
  c.fillStyle = bg; c.beginPath(); c.arc(bx, by, R * 0.07, 0, TAU); c.fill();
  c.strokeStyle = '#111'; c.lineWidth = R * 0.015; c.stroke();
  c.beginPath(); c.moveTo(bx - R * 0.04, by); c.lineTo(bx + R * 0.04, by); c.stroke();

  // ---- brows ----
  c.fillStyle = 'rgba(25,0,3,0.55)';
  c.beginPath(); c.ellipse(cx - 0.34 * R, cy - 0.34 * R, 0.31 * R, 0.09 * R, -0.22, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(cx + 0.32 * R, cy - 0.23 * R, 0.22 * R, 0.07 * R, 0.28, 0, TAU); c.fill();
  // ---- sockets ----
  function socket(x, y, rx, ry, rot) {
    var g = c.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, '#050000'); g.addColorStop(0.75, '#170002'); g.addColorStop(1, '#3a0006');
    c.fillStyle = g; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fill();
  }
  socket(eL.x, eL.y, 0.26 * R, 0.21 * R, -0.15);
  socket(eR.x, eR.y, 0.17 * R, 0.14 * R, 0.2);
  // ---- glowing eyes ----
  function iris(x, y, r, slit) {
    var g = c.createRadialGradient(x, y, 0, x, y, r * 1.6);
    g.addColorStop(0, '#fffbe0'); g.addColorStop(0.3, '#ffd23a'); g.addColorStop(0.55, '#ff7a00'); g.addColorStop(1, 'rgba(255,60,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 1.6, 0, TAU); c.fill();
    c.fillStyle = '#000';
    c.beginPath();
    if (slit) c.ellipse(x, y, r * 0.18, r * 0.72, 0, 0, TAU); else c.arc(x, y, r * 0.26, 0, TAU);
    c.fill();
  }
  iris(eL.x + lx * 0.08 * R, eL.y + ly * 0.05 * R, 0.12 * R, true);
  iris(eR.x + lx * 0.05 * R, eR.y + ly * 0.03 * R, 0.07 * R, false);
  // sagging lid
  c.strokeStyle = '#4a0007'; c.lineWidth = R * 0.03;
  c.beginPath(); c.ellipse(eL.x, eL.y + 0.04 * R, 0.25 * R, 0.2 * R, -0.15, 0.25 * Math.PI, 0.8 * Math.PI); c.stroke();
  // ---- nose slits ----
  c.fillStyle = '#160002';
  c.beginPath(); c.ellipse(cx - 0.06 * R, cy + 0.13 * R, 0.022 * R, 0.065 * R, 0.45, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(cx + 0.07 * R, cy + 0.12 * R, 0.022 * R, 0.06 * R, -0.45, 0, TAU); c.fill();
  // ---- crooked mouth with needle teeth ----
  var mL = [cx - 0.48 * R, cy + 0.42 * R], mR = [cx + 0.45 * R, cy + 0.31 * R];
  var cU = [cx - 0.02 * R, cy + 0.27 * R - 0.05 * R * m], cD = [cx + 0.02 * R, cy + 0.52 * R + 0.55 * R * m];
  c.beginPath(); c.moveTo(mL[0], mL[1]); c.quadraticCurveTo(cU[0], cU[1], mR[0], mR[1]); c.quadraticCurveTo(cD[0], cD[1], mL[0], mL[1]); c.closePath();
  var mg = c.createLinearGradient(0, cy + 0.3 * R, 0, cy + 0.8 * R);
  mg.addColorStop(0, '#0a0000'); mg.addColorStop(1, '#4d0008');
  c.fillStyle = mg; c.fill();
  c.save(); c.clip();
  c.fillStyle = '#efe6cc';
  for (i = 0; i < 11; i++) {          // top teeth
    var tt = 0.07 + i * 0.086, p = qpt(mL, mR, cU, tt), len = R * (0.07 + hash(i + 80) * 0.07) * (0.8 + m * 0.5), tw = R * 0.03;
    c.beginPath(); c.moveTo(p[0] - tw, p[1] - 2); c.lineTo(p[0] + tw, p[1] - 2); c.lineTo(p[0] + (hash(i + 90) - 0.5) * tw, p[1] + len); c.closePath(); c.fill();
  }
  for (i = 0; i < 9; i++) {           // bottom teeth
    tt = 0.12 + i * 0.095; p = qpt(mL, mR, cD, tt); len = R * (0.06 + hash(i + 100) * 0.07) * (0.8 + m * 0.5); tw = R * 0.028;
    c.beginPath(); c.moveTo(p[0] - tw, p[1] + 2); c.lineTo(p[0] + tw, p[1] + 2); c.lineTo(p[0] + (hash(i + 110) - 0.5) * tw, p[1] - len); c.closePath(); c.fill();
  }
  c.restore();
  c.strokeStyle = '#2a0004'; c.lineWidth = R * 0.03;
  c.beginPath(); c.moveTo(mL[0], mL[1]); c.quadraticCurveTo(cU[0], cU[1], mR[0], mR[1]); c.quadraticCurveTo(cD[0], cD[1], mL[0], mL[1]); c.stroke();
  if (m > 0.2) {                       // drool
    var dp = qpt(mL, mR, cD, 0.68);
    c.strokeStyle = 'rgba(255,170,180,0.45)'; c.lineWidth = R * 0.018;
    c.beginPath(); c.moveTo(dp[0], dp[1]); c.lineTo(dp[0] + R * 0.01, dp[1] + R * 0.22 * m); c.stroke();
  }
  c.restore();
}
