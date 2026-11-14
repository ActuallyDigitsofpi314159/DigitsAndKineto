/* DK Converter: SVG -> compact vector data (DKV1) for Khan Academy.
 *
 * The SVG stays a vector drawing: every shape becomes a path made only of
 * move / line / cubic curve / close steps, with transforms already applied, plus
 * its fill and stroke. Coordinates are rounded to a grid (the "precision") and
 * stored as small differences from the previous point, which Zstandard squeezes
 * well. The KA utility (DK SVG SUPPORT) redraws the paths sharply at any size.
 *
 * DKV1 layout ("v" = unsigned LEB128 varint, "z" = zig-zag signed varint):
 *   v version (1)   v precision Q (grid steps per pixel)
 *   v width*Q   v height*Q
 *   v palette size, then RGBA bytes for each color
 *   v shape count, then for each shape:
 *     v flags  (1 fill, 2 stroke, 4 even-odd, 8/16 cap, 32/64 join, 128 miter limit, 256 dashes)
 *     v fill color index (if fill)   v stroke color index, v stroke width*Q (if stroke)
 *     v miter limit*100 (if flag 128)
 *     v dash count, v dash lengths*Q..., z dash offset*Q (if flag 256)
 *     v step count
 *   u8[all steps] step kinds (0 move, 1 line, 2 curve, 3 close)
 *   z[...] point coordinates in grid units, each relative to the previous point
 */
'use strict';

/* ------------------------------------------------------------------ geometry */

const KAPPA = 0.5522847498307936; // circle -> cubic curve handle length

// Parses SVG path data into absolute steps: { op: 'M'|'L'|'C'|'Z', pts: [...] }.
// Quadratic curves, smooth curves, H/V lines and arcs all become L or C.
function parseSVGPathData(d) {
    const out = [];
    const text = String(d || '');
    const n = text.length;
    const numberPattern = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
    let i = 0;
    let command = '';
    let x = 0, y = 0, startX = 0, startY = 0;
    let lastCubicX = 0, lastCubicY = 0, lastQuadX = 0, lastQuadY = 0;
    let previous = '';

    function skipSeparators() {
        while (i < n) {
            const c = text.charCodeAt(i);
            if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 44) i++;
            else break;
        }
    }
    function readNumber() {
        skipSeparators();
        numberPattern.lastIndex = i;
        const match = numberPattern.exec(text);
        if (!match) return null;
        i = numberPattern.lastIndex;
        return parseFloat(match[0]);
    }
    function readFlag() {
        skipSeparators();
        const c = text.charAt(i);
        if (c === '0' || c === '1') { i++; return c === '1'; }
        return null;
    }
    function readNumbers(count) {
        const values = [];
        for (let k = 0; k < count; k++) {
            const value = readNumber();
            if (value === null || !isFinite(value)) return null;
            values.push(value);
        }
        return values;
    }
    function lineTo(nx, ny) { out.push({ op: 'L', pts: [nx, ny] }); x = nx; y = ny; }
    function cubicTo(x1, y1, x2, y2, nx, ny) {
        out.push({ op: 'C', pts: [x1, y1, x2, y2, nx, ny] });
        lastCubicX = x2; lastCubicY = y2;
        x = nx; y = ny;
    }
    function quadTo(qx, qy, nx, ny) {
        cubicTo(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), nx + 2 / 3 * (qx - nx), ny + 2 / 3 * (qy - ny), nx, ny);
        lastQuadX = qx; lastQuadY = qy;
    }

    while (true) {
        skipSeparators();
        if (i >= n) break;
        const c = text.charAt(i);
        if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
            command = c;
            i++;
        } else if (!command || command === 'Z' || command === 'z') {
            break; // a number with no command before it: stop, like browsers do
        }
        const relative = command === command.toLowerCase();
        const ox = relative ? x : 0;
        const oy = relative ? y : 0;
        const upper = command.toUpperCase();
        if (upper === 'Z') {
            out.push({ op: 'Z', pts: [] });
            x = startX; y = startY;
            previous = 'Z';
            continue;
        }
        if (upper === 'M') {
            const p = readNumbers(2);
            if (!p) break;
            x = ox + p[0]; y = oy + p[1];
            startX = x; startY = y;
            out.push({ op: 'M', pts: [x, y] });
            command = relative ? 'l' : 'L'; // extra pairs after M are lines
        } else if (upper === 'L') {
            const p = readNumbers(2);
            if (!p) break;
            lineTo(ox + p[0], oy + p[1]);
        } else if (upper === 'H') {
            const p = readNumbers(1);
            if (!p) break;
            lineTo((relative ? x : 0) + p[0], y);
        } else if (upper === 'V') {
            const p = readNumbers(1);
            if (!p) break;
            lineTo(x, (relative ? y : 0) + p[0]);
        } else if (upper === 'C') {
            const p = readNumbers(6);
            if (!p) break;
            cubicTo(ox + p[0], oy + p[1], ox + p[2], oy + p[3], ox + p[4], oy + p[5]);
        } else if (upper === 'S') {
            const p = readNumbers(4);
            if (!p) break;
            const reflect = previous === 'C' || previous === 'S';
            const x1 = reflect ? 2 * x - lastCubicX : x;
            const y1 = reflect ? 2 * y - lastCubicY : y;
            cubicTo(x1, y1, ox + p[0], oy + p[1], ox + p[2], oy + p[3]);
        } else if (upper === 'Q') {
            const p = readNumbers(4);
            if (!p) break;
            quadTo(ox + p[0], oy + p[1], ox + p[2], oy + p[3]);
        } else if (upper === 'T') {
            const p = readNumbers(2);
            if (!p) break;
            const reflect = previous === 'Q' || previous === 'T';
            const qx = reflect ? 2 * x - lastQuadX : x;
            const qy = reflect ? 2 * y - lastQuadY : y;
            quadTo(qx, qy, ox + p[0], oy + p[1]);
        } else if (upper === 'A') {
            const radii = readNumbers(3);
            if (!radii) break;
            const largeArc = readFlag();
            const sweep = readFlag();
            const end = largeArc === null || sweep === null ? null : readNumbers(2);
            if (!end) break;
            arcTo(x, y, radii[0], radii[1], radii[2], largeArc, sweep, ox + end[0], oy + end[1], cubicTo, lineTo);
        }
        previous = upper;
    }
    return out;
}

// Elliptical arc (SVG endpoint form) -> cubic curves, at most 90 degrees each.
function arcTo(x0, y0, rx, ry, rotationDegrees, largeArc, sweep, x, y, cubicTo, lineTo) {
    if (x0 === x && y0 === y) return;
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) { lineTo(x, y); return; }
    const phi = rotationDegrees * Math.PI / 180;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
    const rx2 = rx * rx, ry2 = ry * ry;
    let factor = (rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p) / (rx2 * y1p * y1p + ry2 * x1p * x1p);
    factor = Math.sqrt(Math.max(0, factor)) * (largeArc === sweep ? -1 : 1);
    const cxp = factor * rx * y1p / ry;
    const cyp = -factor * ry * x1p / rx;
    const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
    const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
    const angle = (ux, uy, vx, vy) => {
        const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        return a;
    };
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
    const step = delta / segments;
    const handle = 4 / 3 * Math.tan(step / 4);
    let t = theta1;
    const point = (a) => {
        const ex = rx * Math.cos(a), ey = ry * Math.sin(a);
        return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy];
    };
    const derivative = (a) => {
        const ex = -rx * Math.sin(a), ey = ry * Math.cos(a);
        return [cos * ex - sin * ey, sin * ex + cos * ey];
    };
    for (let s = 0; s < segments; s++) {
        const p0 = point(t), d0 = derivative(t);
        const t2 = t + step;
        const p3 = s === segments - 1 ? [x, y] : point(t2);
        const d3 = derivative(t2);
        cubicTo(p0[0] + handle * d0[0], p0[1] + handle * d0[1],
            p3[0] - handle * d3[0], p3[1] - handle * d3[1], p3[0], p3[1]);
        t = t2;
    }
}

function ellipseSteps(cx, cy, rx, ry) {
    const kx = rx * KAPPA, ky = ry * KAPPA;
    return [
        { op: 'M', pts: [cx + rx, cy] },
        { op: 'C', pts: [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry] },
        { op: 'C', pts: [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy] },
        { op: 'C', pts: [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry] },
        { op: 'C', pts: [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy] },
        { op: 'Z', pts: [] }
    ];
}

function rectSteps(x, y, w, h, rx, ry) {
    if (!(w > 0) || !(h > 0)) return [];
    rx = Math.min(Math.max(0, rx || 0), w / 2);
    ry = Math.min(Math.max(0, ry || 0), h / 2);
    if (!rx || !ry) {
        return [
            { op: 'M', pts: [x, y] }, { op: 'L', pts: [x + w, y] }, { op: 'L', pts: [x + w, y + h] },
            { op: 'L', pts: [x, y + h] }, { op: 'Z', pts: [] }
        ];
    }
    const kx = rx * KAPPA, ky = ry * KAPPA;
    return [
        { op: 'M', pts: [x + rx, y] },
        { op: 'L', pts: [x + w - rx, y] },
        { op: 'C', pts: [x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry] },
        { op: 'L', pts: [x + w, y + h - ry] },
        { op: 'C', pts: [x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h] },
        { op: 'L', pts: [x + rx, y + h] },
        { op: 'C', pts: [x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry] },
        { op: 'L', pts: [x, y + ry] },
        { op: 'C', pts: [x, y + ry - ky, x + rx - kx, y, x + rx, y] },
        { op: 'Z', pts: [] }
    ];
}

function pointListSteps(points, close) {
    const steps = [];
    for (let k = 0; k + 1 < points.length; k += 2) {
        steps.push({ op: steps.length ? 'L' : 'M', pts: [points[k], points[k + 1]] });
    }
    if (close && steps.length) steps.push({ op: 'Z', pts: [] });
    return steps;
}

// m = [a, b, c, d, e, f]  (x' = a x + c y + e,  y' = b x + d y + f)
function transformSteps(steps, m) {
    return steps.map(step => {
        const pts = [];
        for (let k = 0; k < step.pts.length; k += 2) {
            const px = step.pts[k], py = step.pts[k + 1];
            pts.push(m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]);
        }
        return { op: step.op, pts };
    });
}

/* ------------------------------------------------------------------ packing */

function pushVarint(out, value) {
    value = Math.max(0, Math.round(value));
    while (value >= 128) {
        out.push((value % 128) | 128);
        value = Math.floor(value / 128);
    }
    out.push(value);
}

function pushZigzag(out, value) {
    value = Math.round(value);
    pushVarint(out, value >= 0 ? value * 2 : -value * 2 - 1);
}

const SVG_OPS = { M: 0, L: 1, C: 2, Z: 3 };
const SVG_CAPS = { butt: 0, round: 1, square: 2 };
const SVG_JOINS = { miter: 0, round: 1, bevel: 2, 'miter-clip': 0, arcs: 0 };

// shapes: [{ steps, fill: [r,g,b,a]|null, stroke: [r,g,b,a]|null, strokeWidth, evenOdd,
//            lineCap, lineJoin, miterLimit, dashes: [..]|null, dashOffset }]
// in pixel coordinates of a width x height drawing. Returns DKV1 bytes (before Zstandard).
function packSVGShapes(shapes, width, height, precision) {
    const Q = Math.max(1, Math.round(precision));
    const palette = [];
    const paletteIndex = new Map();
    function colorIndex(rgba) {
        const key = rgba.join(',');
        if (!paletteIndex.has(key)) {
            paletteIndex.set(key, palette.length);
            palette.push(rgba);
        }
        return paletteIndex.get(key);
    }
    const table = [];
    const ops = [];
    const coords = [];
    let penX = 0, penY = 0; // last stored point, in grid units
    let shapeCount = 0;
    for (const shape of shapes) {
        if (!shape.steps.length || (!shape.fill && !shape.stroke)) continue;
        shapeCount++;
        let flags = 0;
        if (shape.fill) flags |= 1;
        if (shape.stroke) flags |= 2;
        if (shape.evenOdd) flags |= 4;
        flags |= (SVG_CAPS[shape.lineCap] || 0) << 3;
        flags |= (SVG_JOINS[shape.lineJoin] || 0) << 5;
        const customMiter = shape.stroke && shape.miterLimit && Math.abs(shape.miterLimit - 4) > 1e-6;
        if (customMiter) flags |= 128;
        const dashed = shape.stroke && shape.dashes && shape.dashes.length;
        if (dashed) flags |= 256;
        pushVarint(table, flags);
        if (shape.fill) pushVarint(table, colorIndex(shape.fill));
        if (shape.stroke) {
            pushVarint(table, colorIndex(shape.stroke));
            pushVarint(table, Math.max(1, shape.strokeWidth * Q));
        }
        if (customMiter) pushVarint(table, Math.max(100, shape.miterLimit * 100));
        if (dashed) {
            pushVarint(table, shape.dashes.length);
            for (const dash of shape.dashes) pushVarint(table, dash * Q);
            pushZigzag(table, (shape.dashOffset || 0) * Q);
        }
        pushVarint(table, shape.steps.length);
        for (const step of shape.steps) {
            ops.push(SVG_OPS[step.op]);
            for (let k = 0; k < step.pts.length; k += 2) {
                const gx = Math.round(step.pts[k] * Q);
                const gy = Math.round(step.pts[k + 1] * Q);
                pushZigzag(coords, gx - penX);
                pushZigzag(coords, gy - penY);
                penX = gx; penY = gy;
            }
        }
    }
    const out = [];
    pushVarint(out, 1);
    pushVarint(out, Q);
    pushVarint(out, width * Q);
    pushVarint(out, height * Q);
    pushVarint(out, palette.length);
    for (const color of palette) out.push(color[0], color[1], color[2], color[3]);
    pushVarint(out, shapeCount);
    const bytes = new Uint8Array(out.length + table.length + ops.length + coords.length);
    let offset = 0;
    for (const part of [out, table, ops, coords]) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return { bytes, shapeCount, paletteSize: palette.length, stepCount: ops.length };
}

// DKV1 bytes -> drawing (mirror of the KA decoder; used to self-check output)
function unpackSVGShapes(bytes) {
    let pos = 0;
    function varint() {
        let value = 0, scale = 1, b;
        do {
            if (pos >= bytes.length) throw new Error('DKV1 data ended early.');
            b = bytes[pos++];
            value += (b & 127) * scale;
            scale *= 128;
        } while (b & 128);
        return value;
    }
    function zigzag() { const v = varint(); return v % 2 ? -(v + 1) / 2 : v / 2; }
    if (varint() !== 1) throw new Error('Unknown DKV version.');
    const Q = varint();
    const width = varint() / Q, height = varint() / Q;
    const palette = [];
    const paletteSize = varint();
    for (let k = 0; k < paletteSize; k++) { palette.push([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]]); pos += 4; }
    const count = varint();
    const shapes = [];
    for (let s = 0; s < count; s++) {
        const shape = { flags: varint() };
        if (shape.flags & 1) shape.fill = varint();
        if (shape.flags & 2) { shape.stroke = varint(); shape.strokeWidth = varint() / Q; }
        if (shape.flags & 128) shape.miterLimit = varint() / 100;
        if (shape.flags & 256) {
            const dashCount = varint();
            shape.dashes = [];
            for (let k = 0; k < dashCount; k++) shape.dashes.push(varint() / Q);
            shape.dashOffset = zigzag() / Q;
        }
        shape.stepCount = varint();
        shapes.push(shape);
    }
    let penX = 0, penY = 0;
    const opsStart = pos;
    let total = 0;
    for (const shape of shapes) total += shape.stepCount;
    pos += total;
    let opIndex = opsStart;
    for (const shape of shapes) {
        shape.steps = [];
        for (let k = 0; k < shape.stepCount; k++) {
            const op = 'MLCZ'.charAt(bytes[opIndex++]);
            const pointCount = op === 'C' ? 3 : op === 'Z' ? 0 : 1;
            const pts = [];
            for (let p = 0; p < pointCount; p++) {
                penX += zigzag(); penY += zigzag();
                pts.push(penX / Q, penY / Q);
            }
            shape.steps.push({ op, pts });
        }
    }
    if (pos !== bytes.length) throw new Error('DKV1 data has extra bytes.');
    return { Q, width, height, palette, shapes };
}

/* ------------------------------------------------------------------ reading an SVG in the browser */

const SVG_SKIPPED_TAGS = new Set([
    'defs', 'clippath', 'mask', 'pattern', 'marker', 'symbol', 'lineargradient', 'radialgradient',
    'filter', 'style', 'script', 'title', 'desc', 'metadata', 'animate', 'animatetransform',
    'animatemotion', 'set', 'cursor', 'view', 'font', 'font-face'
]);
const SVG_SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

function svgLength(animated) {
    try { return animated.baseVal.value; } catch (e) { return 0; }
}

// Reads an SVG file's text and returns { width, height, shapes, warnings }.
// Needs a browser page (the SVG is laid out off-screen so the browser works out
// styles, units and transforms exactly as it would when showing it).
function readSVGDrawing(svgText, maxDimension) {
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (parsed.getElementsByTagName('parsererror').length) {
        throw new Error('This SVG file could not be read (it is not valid XML).');
    }
    const source = parsed.documentElement;
    if (!source || source.localName !== 'svg') throw new Error('This file has no <svg> element.');

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:auto;height:auto;opacity:0;pointer-events:none;overflow:hidden;';
    const svg = document.importNode(source, true);
    host.appendChild(svg);
    document.body.appendChild(host);
    const warnings = new Map();
    const warn = (key, text) => { warnings.set(key, text); };
    try {
        // <script> never runs from importNode, but remove it anyway
        svg.querySelectorAll('script, foreignObject').forEach(node => {
            if (node.localName === 'foreignObject') warn('foreign', 'HTML inside the SVG (foreignObject) was skipped.');
            node.remove();
        });
        expandUseElements(svg, warn);

        // ---- the drawing's own size ----
        const viewBox = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0 && svg.viewBox.baseVal.height > 0
            ? svg.viewBox.baseVal : null;
        const absoluteLength = (name) => {
            const attribute = svg.getAttribute(name);
            if (!attribute || /%\s*$/.test(attribute)) return null;
            const value = svgLength(svg[name]);
            return value > 0 ? value : null;
        };
        let width = absoluteLength('width');
        let height = absoluteLength('height');
        if (viewBox) {
            if (width === null && height === null) { width = viewBox.width; height = viewBox.height; }
            else if (width === null) width = height * viewBox.width / viewBox.height;
            else if (height === null) height = width * viewBox.height / viewBox.width;
        }
        if (width === null || height === null) {
            svg.setAttribute('width', '1000');
            svg.setAttribute('height', '1000');
            let box = null;
            try { box = svg.getBBox(); } catch (e) { box = null; }
            if (box && box.width > 0 && box.height > 0) {
                svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
                width = width || box.width;
                height = height || box.height;
            } else {
                width = width || 300;
                height = height || 150;
            }
        }
        let outputScale = 1;
        if (maxDimension && Math.max(width, height) > maxDimension) {
            outputScale = maxDimension / Math.max(width, height);
        }
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.style.cssText += ';display:block;margin:0;padding:0;border:0;';

        const rootBox = svg.getBoundingClientRect();
        const ids = new Map();
        svg.querySelectorAll('[id]').forEach(node => { if (!ids.has(node.id)) ids.set(node.id, node); });
        const colorCanvas = document.createElement('canvas').getContext('2d');
        const shapes = [];

        const toPixels = (element) => {
            const screen = element.getScreenCTM();
            if (!screen) return null;
            const s = outputScale;
            return [screen.a * s, screen.b * s, screen.c * s, screen.d * s,
                (screen.e - rootBox.left) * s, (screen.f - rootBox.top) * s];
        };

        const walk = (element, inheritedOpacity) => {
            const tag = (element.localName || '').toLowerCase();
            if (SVG_SKIPPED_TAGS.has(tag)) return;
            if (tag === 'text' || tag === 'tspan' || tag === 'textpath') {
                warn('text', 'Text was skipped. In your editor, convert text to paths (outlines) first to keep it.');
                return;
            }
            if (tag === 'image') { warn('image', 'Pictures inside the SVG (<image>) were skipped.'); return; }
            const style = getComputedStyle(element);
            if (style.display === 'none') return;
            const opacity = inheritedOpacity * (parseFloat(style.opacity) || (style.opacity === '0' ? 0 : 1));
            if (style.filter && style.filter !== 'none') warn('filter', 'Filters (blur, shadows...) were ignored.');
            if (style.clipPath && style.clipPath !== 'none') warn('clip', 'Clip paths were ignored, so some shapes may show more than in the original.');
            if (style.mask && style.mask !== 'none') warn('mask', 'Masks were ignored.');
            if (SVG_SHAPE_TAGS.has(tag)) {
                if (style.visibility !== 'hidden' && style.visibility !== 'collapse' && opacity > 0) {
                    const shape = readShape(element, tag, style, opacity);
                    if (shape) shapes.push(shape);
                }
                return;
            }
            for (const child of Array.from(element.children)) walk(child, opacity);
        };

        const readShape = (element, tag, style, opacity) => {
            let steps;
            if (tag === 'path') steps = parseSVGPathData(element.getAttribute('d') || style.getPropertyValue('d').replace(/^path\(["']?|["']?\)$/g, ''));
            else if (tag === 'rect') {
                const rxAttr = element.hasAttribute('rx'), ryAttr = element.hasAttribute('ry');
                let rx = svgLength(element.rx), ry = svgLength(element.ry);
                if (rxAttr && !ryAttr) ry = rx;
                if (ryAttr && !rxAttr) rx = ry;
                steps = rectSteps(svgLength(element.x), svgLength(element.y), svgLength(element.width), svgLength(element.height), rx, ry);
            } else if (tag === 'circle') {
                const r = svgLength(element.r);
                steps = r > 0 ? ellipseSteps(svgLength(element.cx), svgLength(element.cy), r, r) : [];
            } else if (tag === 'ellipse') {
                const rx = svgLength(element.rx), ry = svgLength(element.ry);
                steps = rx > 0 && ry > 0 ? ellipseSteps(svgLength(element.cx), svgLength(element.cy), rx, ry) : [];
            } else if (tag === 'line') {
                steps = [{ op: 'M', pts: [svgLength(element.x1), svgLength(element.y1)] },
                    { op: 'L', pts: [svgLength(element.x2), svgLength(element.y2)] }];
            } else {
                const list = element.points;
                const points = [];
                for (let k = 0; list && k < list.numberOfItems; k++) {
                    const p = list.getItem(k);
                    points.push(p.x, p.y);
                }
                steps = pointListSteps(points, tag === 'polygon');
            }
            if (!steps.length) return null;
            const matrix = toPixels(element);
            if (!matrix) return null;
            const unitScale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]));
            const fill = tag === 'line' ? null // a line has no inside to fill
                : paint(style.fill, parseFloat(style.fillOpacity), opacity);
            const strokeWidth = (parseFloat(style.strokeWidth) || 0) * unitScale;
            const stroke = strokeWidth > 0 ? paint(style.stroke, parseFloat(style.strokeOpacity), opacity) : null;
            if (!fill && !stroke) return null;
            let dashes = null;
            if (stroke && style.strokeDasharray && style.strokeDasharray !== 'none') {
                const values = style.strokeDasharray.split(/[\s,]+/).map(v => parseFloat(v) * unitScale).filter(v => isFinite(v) && v >= 0);
                if (values.length && values.some(v => v > 0)) dashes = values.length % 2 ? values.concat(values) : values;
            }
            return {
                steps: transformSteps(steps, matrix),
                fill,
                stroke,
                strokeWidth,
                evenOdd: style.fillRule === 'evenodd',
                lineCap: style.strokeLinecap,
                lineJoin: style.strokeLinejoin,
                miterLimit: parseFloat(style.strokeMiterlimit) || 4,
                dashes,
                dashOffset: (parseFloat(style.strokeDashoffset) || 0) * unitScale
            };
        };

        // CSS paint value -> [r, g, b, a] (0-255) or null for "none"
        const paint = (value, paintOpacity, opacity) => {
            if (!value || value === 'none') return null;
            let rgba = null;
            const url = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(value);
            if (url) {
                rgba = averageGradientColor(ids.get(url[1]), ids);
                if (!rgba) {
                    const fallback = value.replace(url[0], '').trim();
                    if (!fallback || fallback === 'none') return null;
                    rgba = cssColor(fallback);
                } else {
                    warn('gradient', 'Gradients and patterns were replaced by their average color.');
                }
            } else {
                rgba = cssColor(value);
            }
            if (!rgba) return null;
            const alpha = rgba[3] * (isFinite(paintOpacity) ? paintOpacity : 1) * opacity;
            if (alpha <= 0.002) return null;
            return [rgba[0], rgba[1], rgba[2], Math.round(Math.min(1, alpha) * 255)];
        };

        const cssColor = (value) => {
            colorCanvas.fillStyle = '#000000';
            colorCanvas.fillStyle = value;
            const normalized = String(colorCanvas.fillStyle);
            let m = /^#([0-9a-f]{6})$/i.exec(normalized);
            if (m) {
                const n = parseInt(m[1], 16);
                return [n >> 16, (n >> 8) & 255, n & 255, 1];
            }
            m = /rgba?\(([^)]+)\)/.exec(normalized);
            if (m) {
                const parts = m[1].split(',').map(parseFloat);
                return [Math.round(parts[0]), Math.round(parts[1]), Math.round(parts[2]), parts.length > 3 ? parts[3] : 1];
            }
            return null;
        };

        const averageGradientColor = (gradient, idMap) => {
            const seen = new Set();
            let node = gradient;
            while (node && !seen.has(node)) {
                seen.add(node);
                const stops = Array.from(node.children || []).filter(child => child.localName === 'stop');
                if (stops.length) {
                    const sum = [0, 0, 0, 0];
                    for (const stop of stops) {
                        const stopStyle = getComputedStyle(stop);
                        const c = cssColor(stopStyle.stopColor) || [0, 0, 0, 1];
                        const a = c[3] * (parseFloat(stopStyle.stopOpacity) >= 0 ? parseFloat(stopStyle.stopOpacity) : 1);
                        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; sum[3] += a;
                    }
                    return [Math.round(sum[0] / stops.length), Math.round(sum[1] / stops.length),
                        Math.round(sum[2] / stops.length), sum[3] / stops.length];
                }
                if (node.localName === 'pattern') return [128, 128, 128, 1];
                const href = node.getAttribute('href') || node.getAttribute('xlink:href') ||
                    node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
                node = href && href.charAt(0) === '#' ? idMap.get(href.slice(1)) : null;
            }
            return null;
        };

        walk(svg, 1);
        if (!shapes.length) {
            throw new Error(warnings.has('text')
                ? 'This SVG only has text, which cannot be converted. Convert the text to paths (outlines) in your editor first.'
                : 'No drawable shapes were found in this SVG.');
        }
        return {
            width: width * outputScale,
            height: height * outputScale,
            shapes,
            warnings: Array.from(warnings.values())
        };
    } finally {
        host.remove();
    }
}

// <use> -> a copy of what it points at, so styles and transforms resolve normally
function expandUseElements(svg, warn) {
    for (let pass = 0; pass < 8; pass++) {
        const uses = Array.from(svg.querySelectorAll('use'));
        if (!uses.length) return;
        for (const use of uses) {
            const href = use.getAttribute('href') || use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
                use.getAttribute('xlink:href') || '';
            const target = href.charAt(0) === '#' ? svg.querySelector('#' + CSS.escape(href.slice(1))) : null;
            if (!target || target.contains(use)) { use.remove(); continue; }
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            for (const attribute of Array.from(use.attributes)) {
                if (!/^(x|y|width|height|href|xlink:href)$/.test(attribute.name)) group.setAttribute(attribute.name, attribute.value);
            }
            const x = parseFloat(use.getAttribute('x')) || 0, y = parseFloat(use.getAttribute('y')) || 0;
            group.setAttribute('transform', (use.getAttribute('transform') || '') + ` translate(${x} ${y})`);
            let copy;
            if (target.localName === 'symbol') {
                copy = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                for (const attribute of Array.from(target.attributes)) {
                    if (attribute.name !== 'id') copy.setAttribute(attribute.name, attribute.value);
                }
                copy.setAttribute('width', use.getAttribute('width') || target.getAttribute('width') || '100%');
                copy.setAttribute('height', use.getAttribute('height') || target.getAttribute('height') || '100%');
                copy.setAttribute('overflow', 'visible');
                for (const child of Array.from(target.childNodes)) copy.appendChild(child.cloneNode(true));
            } else {
                copy = target.cloneNode(true);
            }
            copy.removeAttribute('id');
            copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
            group.appendChild(copy);
            use.replaceWith(group);
        }
    }
    warn('use', 'Some <use> references were nested too deeply and were skipped.');
    svg.querySelectorAll('use').forEach(node => node.remove());
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseSVGPathData, packSVGShapes, unpackSVGShapes, rectSteps, ellipseSteps, transformSteps };
}
