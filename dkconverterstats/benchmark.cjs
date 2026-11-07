// Run from the repository root with Node.js. The competitor source is fetched
// from a pinned upstream commit into the OS temp directory on first run.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const zlib = require("node:zlib");
const zstdCodec = require("../dkconverter/vendor/zstd_wasm.umd.js");
const vexRepoUrl = "https://github.com/vExcess/imagenator.git";
const vexRepoCommit = "1479056d528362dbd60c4745199928f46f281353";
const tempRepo = path.join(os.tmpdir(), "dkconverter-bench-vexcess-" + vexRepoCommit.slice(0, 8));
if (!fs.existsSync(path.join(tempRepo, ".git"))) {
    execFileSync("git", ["clone", "--no-checkout", vexRepoUrl, tempRepo], { stdio: "inherit" });
}
try {
    execFileSync("git", ["-C", tempRepo, "cat-file", "-e", `${vexRepoCommit}^{commit}`], { stdio: "ignore" });
} catch (_) {
    execFileSync("git", ["-C", tempRepo, "fetch", "--depth=1", "origin", vexRepoCommit], { stdio: "inherit" });
}
execFileSync("git", ["-C", tempRepo, "checkout", "--detach", vexRepoCommit], { stdio: "ignore" });

function seededMath() {
    let state = 0x12345678;
    const math = Object.create(Math);
    math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
    };
    math.reset = seed => { state = seed >>> 0; };
    return math;
}

function makeContext(extra = {}) {
    const math = extra.Math || seededMath();
    const sandbox = {
        Math: math,
        performance,
        setTimeout,
        clearTimeout,
        DOMException,
        ...extra
    };
    const context = vm.createContext(sandbox);
    return { context, math };
}

function readKittyFixture() {
    const width = 338;
    const height = 600;
    const sourcePath = path.join("dkconverterstats", "fixtures", "kitty.avif");
    const rawPath = path.join(os.tmpdir(), "dk-kitty-338x600.rgba");
    execFileSync("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", sourcePath,
        "-vf", "scale=338:600:flags=lanczos",
        "-f", "rawvideo",
        "-pix_fmt", "rgba",
        rawPath
    ], { stdio: "inherit" });
    const rgba = new Uint8ClampedArray(fs.readFileSync(rawPath));
    if (rgba.length !== width * height * 4) {
        throw new Error(
            "Kitty fixture has unexpected byte length: " + rgba.length
        );
    }
    return {
        name: "Cat photo, 338x600",
        width,
        height,
        rgba,
        maxColors: Math.min(256, Math.max(1, Math.floor(width * height / 500)))
    };
}

function readFixture(name, width, height, makePixel) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const color = makePixel(x, y, width, height);
        const offset = (y * width + x) * 4;
        rgba[offset] = color[0];
        rgba[offset + 1] = color[1];
        rgba[offset + 2] = color[2];
        rgba[offset + 3] = color[3];
    }
    return {
        name,
        width,
        height,
        rgba,
        maxColors: Math.min(256, Math.max(1, Math.floor(width * height / 500)))
    };
}

let fixtures = [
    readKittyFixture(),
    readFixture("Graphic icon, transparent, 64x64", 64, 64, (x, y) => {
        const dx = x - 31.5, dy = y - 31.5;
        const radius = dx * dx + dy * dy;
        if (radius > 30 * 30) return [0, 0, 0, 0];
        const band = Math.floor((Math.atan2(dy, dx) + Math.PI) * 4 / Math.PI) & 7;
        const colors = [
            [20, 35, 80, 255], [35, 90, 180, 255], [55, 150, 220, 255],
            [245, 245, 250, 255], [250, 180, 35, 255], [220, 65, 55, 255],
            [65, 175, 100, 255], [130, 65, 170, 255]
        ];
        return colors[radius < 11 * 11 ? 3 : band];
    }),
    readFixture("Pixel art sprite, 12 colors, 32x32", 32, 32, (x, y) => {
        const index = ((x >> 2) + 3 * (y >> 2)) % 12;
        return [(index * 47 + 30) & 255, (index * 83 + 55) & 255, (index * 29 + 90) & 255, 255];
    }),
    readFixture("Photo-like gradient, 120x120", 120, 120, (x, y, width, height) => [
        Math.round(x * 255 / (width - 1)),
        Math.round(y * 255 / (height - 1)),
        Math.round((x + y) * 255 / (width + height - 2)),
        255
    ]),
    readFixture("Textured gradient, 200x200", 200, 200, (x, y, width, height) => {
        const noise = ((Math.imul(x + 17, 1103515245) ^ Math.imul(y + 53, 12345)) >>> 24) - 128;
        return [
            Math.max(0, Math.min(255, Math.round(x * 255 / (width - 1) + noise * 0.15))),
            Math.max(0, Math.min(255, Math.round(y * 255 / (height - 1) + noise * 0.15))),
            Math.max(0, Math.min(255, Math.round((x + y) * 255 / (width + height - 2) + noise * 0.15))),
            255
        ];
    }),
    readFixture("Photo-like gradient, 400x400", 400, 400, (x, y, width, height) => [
        Math.round(x * 255 / (width - 1)),
        Math.round(y * 255 / (height - 1)),
        Math.round((x + y) * 255 / (width + height - 2)),
        255
    ]),
    readFixture("Textured gradient, 600x600", 600, 600, (x, y, width, height) => {
        const noise = ((Math.imul(x + 17, 1103515245) ^ Math.imul(y + 53, 12345)) >>> 24) - 128;
        return [
            Math.max(0, Math.min(255, Math.round(x * 255 / (width - 1) + noise * 0.15))),
            Math.max(0, Math.min(255, Math.round(y * 255 / (height - 1) + noise * 0.15))),
            Math.max(0, Math.min(255, Math.round((x + y) * 255 / (width + height - 2) + noise * 0.15))),
            255
        ];
    }),
    readFixture("Photo-like gradient, 800x800", 800, 800, (x, y, width, height) => [
        Math.round(x * 255 / (width - 1)),
        Math.round(y * 255 / (height - 1)),
        Math.round((x + y) * 255 / (width + height - 2)),
        255
    ])
];

const rawFixtureArg = process.argv.find(argument => argument.startsWith("--raw-rgba="));
const rawWidthArg = process.argv.find(argument => argument.startsWith("--width="));
const rawHeightArg = process.argv.find(argument => argument.startsWith("--height="));
const rawNameArg = process.argv.find(argument => argument.startsWith("--name="));
const isRawFixtureRun = Boolean(rawFixtureArg);
if (isRawFixtureRun) {
    const rawPath = path.resolve(rawFixtureArg.slice("--raw-rgba=".length));
    const width = Number(rawWidthArg && rawWidthArg.slice("--width=".length));
    const height = Number(rawHeightArg && rawHeightArg.slice("--height=".length));
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
        throw new Error("Raw RGBA mode needs positive --width and --height values.");
    }
    const bytes = fs.readFileSync(rawPath);
    if (bytes.length !== width * height * 4) {
        throw new Error(`Raw RGBA length mismatch: got ${bytes.length}, expected ${width * height * 4}.`);
    }
    const rgba = new Uint8ClampedArray(bytes.length);
    rgba.set(bytes);
    fixtures = [{
        name: rawNameArg ? rawNameArg.slice("--name=".length) : path.basename(rawPath),
        width,
        height,
        rgba,
        maxColors: Math.min(256, Math.max(1, Math.floor(width * height / 500)))
    }];
}
const isFullMatrixRun = process.argv.includes("--all-fixtures");
// The full matrix favors coverage over timing confidence: one sample per pair.
const benchmarkWarmups = isRawFixtureRun || isFullMatrixRun ? 0 : 2;
const benchmarkIterations = isRawFixtureRun || isFullMatrixRun ? 1 : 7;
const tacDecoderCharacters = 10652;

function measureTacJPEGModel(fixture) {
    for (let offset = 3; offset < fixture.rgba.length; offset += 4) {
        if (fixture.rgba[offset] !== 255) return null;
    }

    const stem = `tac-jpeg-${process.pid}-${fixture.width}x${fixture.height}`;
    const sourcePath = path.join(os.tmpdir(), `${stem}.rgba`);
    const jpegPath = path.join(os.tmpdir(), `${stem}.jpg`);
    try {
        fs.writeFileSync(sourcePath, Buffer.from(
            fixture.rgba.buffer,
            fixture.rgba.byteOffset,
            fixture.rgba.byteLength
        ));
        execFileSync("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "rgba",
            "-video_size", `${fixture.width}x${fixture.height}`,
            "-i", sourcePath,
            "-frames:v", "1",
            "-q:v", "2",
            jpegPath
        ], { stdio: "inherit" });
        const jpegBytes = fs.statSync(jpegPath).size;
        const payloadCharacters = Math.ceil(jpegBytes / 4) * 5;
        return {
            jpegBytes,
            payloadCharacters,
            decoderCharacters: tacDecoderCharacters,
            combinedCharacters: payloadCharacters + tacDecoderCharacters
        };
    } finally {
        for (const temporaryPath of [sourcePath, jpegPath]) {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        }
    }
}

if (process.argv.includes("--tac-only")) {
    console.log(JSON.stringify({
        encoder: "Tac JPEG Base85 model",
        jpegQuality: "FFmpeg qscale 2",
        decoderCharacters: tacDecoderCharacters,
        fixtures: fixtures.map(fixture => ({
            name: fixture.name,
            width: fixture.width,
            height: fixture.height,
            result: measureTacJPEGModel(fixture)
        }))
    }, null, 2));
    process.exit(0);
}

const PNG_CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < PNG_CRC_TABLE.length; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    PNG_CRC_TABLE[n] = value >>> 0;
}

function pngCrc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = PNG_CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const typeBytes = Buffer.from(type, "ascii");
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return chunk;
}

function pngPaeth(left, up, upperLeft) {
    const predictor = left + up - upperLeft;
    const leftDistance = Math.abs(predictor - left);
    const upDistance = Math.abs(predictor - up);
    const upperLeftDistance = Math.abs(predictor - upperLeft);
    return leftDistance <= upDistance && leftDistance <= upperLeftDistance
        ? left
        : upDistance <= upperLeftDistance ? up : upperLeft;
}

function createFilteredScanlines(fixture) {
    const rowBytes = fixture.width * 4;
    const scanlines = Buffer.alloc((rowBytes + 1) * fixture.height);
    const pixels = Buffer.from(fixture.rgba.buffer, fixture.rgba.byteOffset, fixture.rgba.byteLength);
    for (let y = 0; y < fixture.height; y++) {
        const rowOffset = y * rowBytes;
        let bestScore = Infinity;
        let bestFilter = 0;
        let bestRow = null;
        for (let filter = 0; filter <= 4; filter++) {
            const filtered = Buffer.alloc(rowBytes);
            let score = 0;
            for (let x = 0; x < rowBytes; x++) {
                const current = pixels[rowOffset + x];
                const left = x >= 4 ? pixels[rowOffset + x - 4] : 0;
                const up = y > 0 ? pixels[rowOffset - rowBytes + x] : 0;
                const upperLeft = y > 0 && x >= 4 ? pixels[rowOffset - rowBytes + x - 4] : 0;
                const predictor = filter === 1 ? left
                    : filter === 2 ? up
                    : filter === 3 ? Math.floor((left + up) / 2)
                    : filter === 4 ? pngPaeth(left, up, upperLeft)
                    : 0;
                const residual = (current - predictor) & 255;
                filtered[x] = residual;
                score += Math.abs(residual < 128 ? residual : residual - 256);
            }
            if (score < bestScore) {
                bestScore = score;
                bestFilter = filter;
                bestRow = filtered;
            }
        }
        const destination = y * (rowBytes + 1);
        scanlines[destination] = bestFilter;
        bestRow.copy(scanlines, destination + 1);
    }
    return scanlines;
}

function encodePngBase64(fixture) {
    const scanlines = createFilteredScanlines(fixture);
    const deflated = zlib.deflateSync(scanlines, { level: 9 });
    const header = Buffer.alloc(13);
    header.writeUInt32BE(fixture.width, 0);
    header.writeUInt32BE(fixture.height, 4);
    header[8] = 8;
    header[9] = 6;
    const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", deflated),
        pngChunk("IEND", Buffer.alloc(0))
    ]);
    return png.toString("base64");
}

function getDKUtilityCharacterCounts(alphabetLiteral) {
    const html = fs.readFileSync("dkconverter/index.html", "utf8");
    const utilityMatch = html.match(/<pre id="utilityOutput"[^>]*>([\s\S]*?)<\/pre>/);
    if (!utilityMatch) throw new Error("Could not locate the DK utility template.");
    const template = utilityMatch[1]
        .replace(/\r\n/g, "\n")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace("__DK_ALPHABET__", alphabetLiteral)
        .replace(
            "__DK_DIGIT_COUNTS__",
            vm.runInContext("JSON.stringify(BASE_K_DIGIT_COUNTS)", currentEnv.context)
        )
        .trim();
    const parserStartMarker = "// DK JSON PARSER SUPPORT START";
    const parserEndMarker = "// DK JSON PARSER SUPPORT END";
    const parserStart = template.indexOf(parserStartMarker);
    const parserEnd = template.indexOf(parserEndMarker, parserStart);
    if (parserStart < 0 || parserEnd < 0) throw new Error("DK parser markers are missing.");
    const parserCharacters = template.slice(
        parserStart + parserStartMarker.length,
        parserEnd
    ).trim().length;
    const withoutParser = (
        template.slice(0, parserStart) +
        template.slice(parserEnd + parserEndMarker.length)
    ).trim();
    const audioStartMarker = "// DK AUDIO SUPPORT START";
    const audioEndMarker = "// DK AUDIO SUPPORT END";
    const audioStart = withoutParser.indexOf(audioStartMarker);
    const audioEnd = withoutParser.indexOf(audioEndMarker, audioStart);
    if (audioStart < 0 || audioEnd < 0) throw new Error("DK audio markers are missing.");
    const audioCharacters = withoutParser.slice(
        audioStart + audioStartMarker.length,
        audioEnd
    ).trim().length;
    const withoutAudio = (
        withoutParser.slice(0, audioStart) +
        withoutParser.slice(audioEnd + audioEndMarker.length)
    ).trim();
    const decoderStart = withoutAudio.indexOf("function dkBaseDigitCount");
    const zstdDecoderStart = withoutAudio.indexOf("function dkPaethPredictor", decoderStart);
    const encodedFrameStart = withoutAudio.indexOf(
        "function dkExpandEncoded",
        zstdDecoderStart
    );
    const decodeZstdStart = withoutAudio.indexOf(
        "function dkDecodeZstdBytes",
        encodedFrameStart
    );
    const frameDataStart = withoutAudio.indexOf(
        "function dkFrameCount",
        zstdDecoderStart
    );
    const imageRendererStart = withoutAudio.indexOf(
        "function dkCreateImageFromRGBA",
        frameDataStart
    );
    const durationStart = withoutAudio.indexOf(
        "function dkFrameDuration(",
        imageRendererStart
    );
    const paletteDecoderStart = withoutAudio.indexOf(
        "function dkDecodePalette",
        durationStart
    );
    const losslessDrawStart = withoutAudio.indexOf(
        "function drawLosslessImage",
        paletteDecoderStart
    );
    const colorDrawStart = withoutAudio.indexOf("function drawColorImage", losslessDrawStart);
    const pixelArtStart = withoutAudio.indexOf("function drawReadablePixelArt", colorDrawStart);
    const pixelArtEnd = withoutAudio.indexOf("function drawHugePixelArt", pixelArtStart);
    const markerIndexes = [
        decoderStart,
        zstdDecoderStart,
        encodedFrameStart,
        decodeZstdStart,
        frameDataStart,
        imageRendererStart,
        durationStart,
        paletteDecoderStart,
        losslessDrawStart,
        colorDrawStart,
        pixelArtStart,
        pixelArtEnd
    ];
    if (markerIndexes.some(index => index < 0) ||
        !(decoderStart < zstdDecoderStart &&
            zstdDecoderStart < encodedFrameStart &&
            encodedFrameStart < decodeZstdStart &&
            decodeZstdStart < frameDataStart &&
            frameDataStart < imageRendererStart &&
            imageRendererStart < durationStart &&
            durationStart < paletteDecoderStart &&
            paletteDecoderStart < losslessDrawStart &&
            losslessDrawStart < colorDrawStart &&
            colorDrawStart < pixelArtStart &&
            pixelArtStart < pixelArtEnd)) {
        throw new Error("DK renderer boundaries are missing or out of order.");
    }
    const shared = withoutAudio.slice(0, decoderStart);
    const encodedFrameHelper = withoutAudio.slice(
        encodedFrameStart,
        decodeZstdStart
    );
    const frameDataHelpers = withoutAudio.slice(
        frameDataStart,
        imageRendererStart
    );
    const baseKDecoder = withoutAudio.slice(decoderStart, zstdDecoderStart);
    const zstdDecoder = withoutAudio.slice(zstdDecoderStart, frameDataStart);
    const duration = withoutAudio.slice(durationStart, paletteDecoderStart);
    const imageBlit = withoutAudio.slice(imageRendererStart, durationStart);
    const paletteAndDeltaHelpers = withoutAudio.slice(
        paletteDecoderStart,
        losslessDrawStart
    );
    const losslessDraw = withoutAudio.slice(losslessDrawStart, colorDrawStart);
    const colorDraw = withoutAudio.slice(colorDrawStart, pixelArtStart);
    const imageDecoder = [
        baseKDecoder,
        zstdDecoder,
        frameDataHelpers,
        paletteAndDeltaHelpers
    ].join("\n\n");
    const pixelArtRenderer = withoutAudio.slice(pixelArtStart, pixelArtEnd);
    const losslessParts = [shared, imageDecoder, imageBlit, losslessDraw];
    const losslessUtility = losslessParts.map(part => part.trim())
        .filter(Boolean).join("\n\n");
    const imageUtility = [shared, imageDecoder, imageBlit, colorDraw]
        .map(part => part.trim()).filter(Boolean).join("\n\n");
    const pixelArtUtility = [
        shared,
        encodedFrameHelper,
        duration,
        pixelArtRenderer
    ].map(part => part.trim()).filter(Boolean).join("\n\n");
    if (!template.startsWith("// DK CONVERTER UTILITY [") ||
        !template.endsWith("// ]")) {
        throw new Error("DK universal utility wrapper markers are missing.");
    }
    return {
        characterCounts: {
            universal: template.length
        },
        template,
        losslessUtility,
        imageUtility
    };
}

const currentSource = fs.readFileSync("dkconverter/converter.js", "utf8");
const currentBoundary = currentSource.indexOf("\nasync function finishConversion(");
if (currentBoundary < 0) throw new Error("Could not isolate current encoder functions.");
const currentEnv = makeContext({
    window: { Worker: undefined },
    Worker: undefined,
    navigator: { hardwareConcurrency: 4 },
    scheduler: { yield: () => Promise.resolve() },
    zstdCodec
});
vm.runInContext(currentSource.slice(0, currentBoundary), currentEnv.context);
const mainYieldToBrowser = () => Promise.resolve();
async function mainCompressRGBAWithZstd(rgba, width, height) {
    const context = Object.assign(currentEnv.context, { __rgba: rgba });
    return vm.runInContext(
        `compressRGBAWithZstd(globalThis.__rgba, ${width}, ${height})`,
        context
    );
}
const mainEncodeBytes = new Function(
    "BASE_K_BLOCK_SIZE",
    "BYTE_ALPHABET",
    "BASE_K_DIGIT_COUNTS",
    "yieldToBrowser",
    `return (${vm.runInContext("encodeBytes.toString()", currentEnv.context)})`
)(
    vm.runInContext("BASE_K_BLOCK_SIZE", currentEnv.context),
    Array.from(vm.runInContext("BYTE_ALPHABET", currentEnv.context)),
    Array.from(vm.runInContext("BASE_K_DIGIT_COUNTS", currentEnv.context)),
    mainYieldToBrowser
);
const {
    characterCounts: dkUtilityCharacters,
    template: dkUtilityTemplate,
    losslessUtility,
    imageUtility
} = getDKUtilityCharacterCounts(
    vm.runInContext("JSON.stringify(BYTE_ALPHABET.join(''))", currentEnv.context)
);
vm.runInContext(
    "fullUtilityTemplate = " + JSON.stringify(dkUtilityTemplate),
    currentEnv.context
);
dkUtilityCharacters.imageLossless = vm.runInContext(
    "getImageUtilityCode(false, false).length",
    currentEnv.context
);
dkUtilityCharacters.imageColorCapped = vm.runInContext(
    "getImageUtilityCode(false, true).length",
    currentEnv.context
);
dkUtilityCharacters.pixelArt = vm.runInContext(
    "getImageUtilityCode(true, true).length",
    currentEnv.context
);
const zstdDecoderEnv = makeContext();
vm.runInContext(
    `${losslessUtility}\nglobalThis.__decodeDKZstdFrame = dkDecodeZstdFrame;`,
    zstdDecoderEnv.context
);
const imageDecoderEnv = makeContext();
vm.runInContext(
    `${imageUtility}\nglobalThis.__decodeDKPalette = dkDecodePalette; globalThis.__dkSliceFrame = dkSliceFrame;`,
    imageDecoderEnv.context
);

const legacySource = execFileSync("git", ["show", "c92b6ef:script.js"], { encoding: "utf8" });
const legacyBoundary = legacySource.indexOf("\nasync function processGIF(");
if (legacyBoundary < 0) throw new Error("Could not isolate legacy encoder functions.");
const legacyEnv = makeContext({
    Math: seededMath(),
    document: {},
    color: (...values) => values
});
vm.runInContext(legacySource.slice(0, legacyBoundary), legacyEnv.context);

const vexSource = fs.readFileSync(path.join(tempRepo, "vexcess", "imagenator.js"), "utf8") +
    "\nglobalThis.BenchCodec = CodecVexcessImagenator;";
const vexEnv = makeContext({ pow: Math.pow, floor: Math.floor });
vm.runInContext(vexSource, vexEnv.context);

const graphicsStub = `
function fakeGraphics(width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    const context2d = {
        getImageData: () => ({ data }),
        putImageData: () => {}
    };
    const sourceImg = { getContext: () => context2d };
    return {
        width, height, background: () => {}, image: () => {},
        get: () => ({ sourceImg })
    };
}
globalThis.dl = {
    createGraphics: fakeGraphics,
    snip: () => ({ sourceImage: { getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {} }) } })
};
globalThis.round = Math.round;
globalThis.map = (value, a, b, c, d) => c + (value - a) * (d - c) / (b - a);
globalThis.image = () => {};
`;
const bobSource = fs.readFileSync(path.join(tempRepo, "bob-lyon", "imagenator.js"), "utf8") +
    "\nglobalThis.BenchCodec = CodecBobLyonImagenator;";
const bobEnv = makeContext();
// The upstream UI decodes its result for the live preview inside encode();
// exclude that preview-only decode to measure encoder time.
vm.runInContext(graphicsStub + bobSource.replace("inflatedPJSImage = img180.inflate(imageJSONString);", ""), bobEnv.context);

function settingsFor(fixture) {
    return {
        imageWidth: fixture.width,
        imageHeight: fixture.height,
        imageData: {
            width: fixture.width,
            height: fixture.height,
            data: new Uint8ClampedArray(fixture.rgba)
        },
        compressionLevel: 0,
        grayscale: false
    };
}

async function measure(label, fixture, env, runner, warmups = benchmarkWarmups, iterations = benchmarkIterations) {
    const execute = async () => {
        env.math.reset(0x12345678);
        const start = performance.now();
        const outputCharacters = await runner(fixture);
        return { elapsedMs: performance.now() - start, outputCharacters };
    };
    for (let i = 0; i < warmups; i++) await execute();
    const samples = [];
    let outputCharacters = 0;
    for (let i = 0; i < iterations; i++) {
        const result = await execute();
        samples.push(result.elapsedMs);
        outputCharacters = result.outputCharacters;
    }
    samples.sort((a, b) => a - b);
    return {
        fixture: fixture.name,
        encoder: label,
        medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(2)),
        meanMs: Number((samples.reduce((sum, time) => sum + time, 0) / samples.length).toFixed(2)),
        outputCharacters
    };
}

function rgbaFrame(fixture) { return new Uint8Array(fixture.rgba); }

function webpQualityFrame(fixture, quality) {
    const stem = `dk-benchmark-${process.pid}-${quality}-${fixture.width}x${fixture.height}`;
    const sourcePath = path.join(os.tmpdir(), `${stem}.rgba`);
    const webpPath = path.join(os.tmpdir(), `${stem}.webp`);
    const decodedPath = path.join(os.tmpdir(), `${stem}-decoded.rgba`);
    try {
        fs.writeFileSync(sourcePath, Buffer.from(
            fixture.rgba.buffer,
            fixture.rgba.byteOffset,
            fixture.rgba.byteLength
        ));
        execFileSync("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "rgba",
            "-video_size", `${fixture.width}x${fixture.height}`,
            "-i", sourcePath,
            "-frames:v", "1",
            "-c:v", "libwebp", "-lossless", "0", "-q:v", String(quality),
            webpPath
        ], { stdio: "inherit" });
        execFileSync("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", webpPath,
            "-frames:v", "1",
            "-f", "rawvideo", "-pix_fmt", "rgba",
            decodedPath
        ], { stdio: "inherit" });
        const decoded = new Uint8ClampedArray(fs.readFileSync(decodedPath));
        if (decoded.length !== fixture.width * fixture.height * 4) {
            throw new Error(`WebP quality ${quality} produced an unexpected RGBA length.`);
        }
        return decoded;
    } finally {
        for (const temporaryPath of [sourcePath, webpPath, decodedPath]) {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        }
    }
}

const runners = [
    ["DK WebP Q20 + Color Cap", currentEnv, async fixture => {
        const qualityFrame = webpQualityFrame(fixture, 20);
        const frames = await vm.runInContext(
            `encodeColorLimitedFrames([globalThis.__frame], ${fixture.width}, ${fixture.height}, ${fixture.maxColors})`,
            Object.assign(currentEnv.context, { __frame: qualityFrame })
        );
        return frames[0].data.length;
    }],
    ["DK WebP Q50, No Color Cap", currentEnv, async fixture => {
        const qualityFrame = webpQualityFrame(fixture, 50);
        const compressed = await mainCompressRGBAWithZstd(
            qualityFrame, fixture.width, fixture.height
        );
        return (await mainEncodeBytes(compressed.bytes)).length;
    }],
    ["DK Lossless (DKL)", currentEnv, async fixture => {
        const compressed = await mainCompressRGBAWithZstd(
            rgbaFrame(fixture), fixture.width, fixture.height
        );
        return (await mainEncodeBytes(compressed.bytes)).length;
    }],
    ["DK Pixel Art", currentEnv, async fixture => {
        const frames = await vm.runInContext(
            `encodePixelArtFrames([globalThis.__frame], ${fixture.width}, ${fixture.height}, ${Math.min(fixture.maxColors, 93)})`,
            Object.assign(currentEnv.context, { __frame: rgbaFrame(fixture) })
        );
        return frames[0].rows.reduce((sum, row) => sum + row.length, 0) +
            JSON.stringify(frames[0].palette).length;
    }],
    ["Bob Lyon Imagenator", bobEnv, async fixture => {
        const result = await vm.runInContext(
            "BenchCodec.encode(globalThis.__settings)",
            Object.assign(bobEnv.context, { __settings: settingsFor(fixture) })
        );
        return result.length;
    }],
    ["vExcess Imagenator", vexEnv, async fixture => {
        const result = await vm.runInContext(
            "BenchCodec.encode(globalThis.__settings)",
            Object.assign(vexEnv.context, { __settings: settingsFor(fixture) })
        );
        return result.length;
    }],
    ["DK Converter Legacy", legacyEnv, async fixture => {
        const result = await vm.runInContext(`(() => {
            const rgba = globalThis.__rgba;
            const pixels = [];
            for (let i = 0; i < rgba.length; i += 4) {
                if (rgba[i + 3] > 10) pixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
            }
            const colors = pickVariedColorsFromPixels(pixels, ${fixture.maxColors});
            const canvas = { width: ${fixture.width}, height: ${fixture.height}, getContext: () => ({ getImageData: () => ({ data: rgba }) }) };
            const [rows, colorMap] = assignLettersToColors(canvas, LETTERS, colors);
            const raw = saveJsInMemory(rows, colorMap, ${fixture.width}, ${fixture.height});
            return raw.length;
        })()`, Object.assign(legacyEnv.context, { __rgba: fixture.rgba }));
        return result;
    }]
];
const benchmarkRunners = isRawFixtureRun && !isFullMatrixRun
    ? runners.filter(([label]) => [
        "DK WebP Q20 + Color Cap",
        "DK WebP Q50, No Color Cap",
        "DK Lossless (DKL)"
    ].includes(label))
    : runners;

function runnersForFixture(fixture) {
    if (isFullMatrixRun) {
        return benchmarkRunners;
    }
    if (isRawFixtureRun || fixture.name === "Cat photo, 338x600") {
        return benchmarkRunners;
    }
    if (fixture.width * fixture.height < 200000 || fixture.name === "Cat photo, 338x600") {
        return benchmarkRunners.filter(([label]) =>
            !label.startsWith("DK WebP Q")
        );
    }
    return benchmarkRunners.filter(([label]) =>
        !["DK Converter Legacy", "DK Pixel Art"].includes(label) &&
            !label.startsWith("DK WebP Q")
    );
}

(async () => {
    const results = [];
    for (const fixture of fixtures) {
        for (const [label, env, runner] of runnersForFixture(fixture)) {
            const result = await measure(label, fixture, env, runner);
            results.push(result);
            if (isRawFixtureRun) {
                console.log(`[benchmark] ${result.fixture} | ${result.encoder} | ${result.medianMs} ms | ${result.outputCharacters} chars`);
            }
        }
    }
    const losslessRoundTrips = [];
    const colorCappedRoundTrips = [];
    for (const fixture of fixtures) {
        const compressed = await mainCompressRGBAWithZstd(
            rgbaFrame(fixture), fixture.width, fixture.height
        );
        const encoded = await mainEncodeBytes(compressed.bytes);
        const frameData = {
            length: fixture.rgba.length,
            encodedLength: compressed.bytes.length,
            baseK: true,
            baseKBlockSize: vm.runInContext("BASE_K_BLOCK_SIZE", currentEnv.context),
            zstd: true,
            zstdPadding: compressed.padding,
            data: encoded
        };
        zstdDecoderEnv.context.__frameData = frameData;
        const decodeStarted = performance.now();
        const decoded = await vm.runInContext(
            `__decodeDKZstdFrame(globalThis.__frameData, ${fixture.width}, ${fixture.height})`,
            zstdDecoderEnv.context
        );
        const decodeMs = Number((performance.now() - decodeStarted).toFixed(2));
        const exact = Buffer.from(decoded).equals(Buffer.from(fixture.rgba));
        if (!exact) throw new Error(`DKL lossless round-trip changed pixels: ${fixture.name}`);
        losslessRoundTrips.push({ name: fixture.name, exact, decodeMs, characters: encoded.length });

        const cappedFrames = await vm.runInContext(
            `encodeColorLimitedFrames([globalThis.__frame], ${fixture.width}, ${fixture.height}, ${fixture.maxColors})`,
            Object.assign(currentEnv.context, { __frame: rgbaFrame(fixture) })
        );
        imageDecoderEnv.context.__frameData = {
            k: "DKC5",
            w: fixture.width,
            h: fixture.height,
            c: cappedFrames[0].paletteLength,
            b: cappedFrames[0].bitDepth,
            i: cappedFrames[0].transparentIndex,
            s: cappedFrames[0].data,
            p: cappedFrames[0].zstdPadding
        };
        const cappedDecodeStarted = performance.now();
        const capped = vm.runInContext(
            `__decodeDKPalette(__dkSliceFrame(globalThis.__frameData, 0), globalThis.__frameData, ${fixture.width * fixture.height}, 0)`,
            imageDecoderEnv.context
        );
        const cappedDecodeMs = Number((performance.now() - cappedDecodeStarted).toFixed(2));
        const cappedValid = capped.length === fixture.width * fixture.height * 4;
        if (!cappedValid) throw new Error(`DKC5 palette round-trip failed: ${fixture.name}`);
        colorCappedRoundTrips.push({
            name: fixture.name,
            validDimensions: cappedValid,
            decodeMs: cappedDecodeMs,
            characters: cappedFrames[0].data.length
        });
    }
    console.log(JSON.stringify({
        node: process.version,
        os: process.platform + " " + process.arch,
        dkLosslessZstd: { library: "One Identity Zstd WASM 1.0.3", level: 19, chunkBytes: 4 * 1024 * 1024 },
        losslessZstdAvailable: vm.runInContext("supportsZstdEncoding()", currentEnv.context),
        warmups: benchmarkWarmups,
        iterations: benchmarkIterations,
        fixtures: fixtures.map(fixture => ({ name: fixture.name, width: fixture.width, height: fixture.height, maxColors: fixture.maxColors })),
        tacJPEG: fixtures.map(fixture => ({
            name: fixture.name,
            result: measureTacJPEGModel(fixture)
        })),
        pngDataUriCharacters: isRawFixtureRun ? [] : fixtures.map(fixture => ({
            name: fixture.name,
            characters: "data:image/png;base64,".length + encodePngBase64(fixture).length
        })),
        dkLosslessZstdCharacters: results
            .filter(result => result.encoder === "DK Lossless (DKL)")
            .map(result => ({ name: result.fixture, characters: result.outputCharacters })),
        vsBobLyonPngString: isRawFixtureRun ? [] : fixtures.map(fixture => {
            const pngStringCharacters = "data:image/png;base64,".length +
                encodePngBase64(fixture).length;
            const dkl = results.find(result =>
                result.fixture === fixture.name &&
                result.encoder === "DK Lossless (DKL)"
            );
            return {
                name: fixture.name,
                pngStringCharacters,
                dklCharacters: dkl ? dkl.outputCharacters : null,
                dklShorterBy: dkl && dkl.outputCharacters
                    ? Number((pngStringCharacters / dkl.outputCharacters).toFixed(2))
                    : null
            };
        }),
        losslessRoundTrips,
        colorCappedRoundTrips,
        dkUtilityCharacters,
        results
    }, null, 2));
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
