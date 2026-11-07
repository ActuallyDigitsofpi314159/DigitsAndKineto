const fs = require("node:fs");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const zstdCodec = require("../dkconverter/vendor/zstd_wasm.umd.js");
const jpegFixtureBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbABvAG8AbwBpAG4AZwAgAEkAbgBjAC4AIAAyADAAMQA2AAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYACADASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAwABBAL/xAAWEAEBAQAAAAAAAAAAAAAAAAAAAQL/xAAXAQADAQAAAAAAAAAAAAAAAAADBAUC/8QAGBEAAwEBAAAAAAAAAAAAAAAAAAEEAgP/2gAMAwEAAhEDEQA/AOXMLmPOYXMOJFKjsbmFzGZhcwVIiUdjkzC5iTKGqNMTMLmJCoiUaZ//2Q==";

const html = fs.readFileSync("dkconverter/index.html", "utf8");
const converterSource = fs.readFileSync("dkconverter/converter.js", "utf8");
const jpegDecoderSource = fs.readFileSync("dkconverter/jpeg-decoder.js", "utf8");
const jpegFixture = "/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNSMj5aYVpQYEpRUk//wAARCAAYACADASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAwABBAL/xAAWEAEBAQAAAAAAAAAAAAAAAAAAAQL/xAAXAQADAQAAAAAAAAAAAAAAAAADBAUC/8QAGBEAAwEBAAAAAAAAAAAAAAAAAAEEAgP/2gAMAwEAAhEDEQA/AOXMLmPOYXMOJFKjsbmFzGZhcwVIiUdjkzC5iTKGqNMTMLmJCoiUaZ//2Q==";
const openTag = '<pre id="utilityOutput" class="language-javascript">';
const start = html.indexOf(openTag);
const end = html.indexOf("</pre>", start);
if (start < 0 || end < 0) {
    throw new Error("Could not locate generated KA utility source.");
}

function decodeHtml(text) {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

const encoderContext = vm.createContext({
    window: { Worker: undefined },
    Worker: undefined,
    navigator: { hardwareConcurrency: 4 },
    scheduler: { yield: () => Promise.resolve() },
    zstdCodec,
    setTimeout,
    clearTimeout,
    performance,
    Math,
    Uint8Array,
    Uint8ClampedArray,
    Array,
    Object,
    JSON,
    Promise,
    Map,
    Set,
    Error,
    DOMException,
    console
});
const encoderBoundary = converterSource.indexOf("\nasync function finishConversion(");
if (encoderBoundary < 0) {
    throw new Error("Could not isolate converter encoding functions.");
}
vm.runInContext(converterSource.slice(0, encoderBoundary), encoderContext);
const alphabetLiteral = vm.runInContext("JSON.stringify(BYTE_ALPHABET.join(''))", encoderContext);
const digitCountsLiteral = vm.runInContext("JSON.stringify(BASE_K_DIGIT_COUNTS)", encoderContext);

function fillUtilityPlaceholders(source, alphabetJson, digitCountsJson) {
    return source
        .replace("__DK_ALPHABET__", alphabetJson)
        .replace("__DK_DIGIT_COUNTS__", digitCountsJson);
}

const utilitySource = decodeHtml(html.slice(start + openTag.length, end)).trim();
const utilityForStaticChecks = fillUtilityPlaceholders(
    utilitySource,
    JSON.stringify("abc"),
    "[0,2,3,4,5]"
);
const utilityTemplate = fillUtilityPlaceholders(
    utilitySource,
    alphabetLiteral,
    digitCountsLiteral
);
vm.runInContext(
    "fullUtilityTemplate = " + JSON.stringify(utilityTemplate),
    encoderContext
);
vm.runInContext(jpegDecoderSource, encoderContext, {
    filename: "jpeg-decoder.js"
});
const utilityForStyleChecks = utilityForStaticChecks.replace(
    /\/\* jshint ignore:\s*start \*\/[\s\S]*?\/\* jshint ignore:\s*end \*\//g,
    "\n"
);
const problems = [];
const forbidden = [
    ["Uint8Array", /\bUint8Array\b/],
    ["DecompressionStream", /\bDecompressionStream\b/],
    ["Promise.then", /\.then\s*\(/],
    ["Error constructor", /\bError\s*\(/],
    ["new Error", /\bnew\s+Error\b/],
    ["new Array", /\bnew\s+Array\b/],
    ["UMD module export", /\bmodule\.exports\b/],
    ["UMD module typeof", /\btypeof\s+module\b/],
    ["UMD define typeof", /\btypeof\s+define\b/]
];
for (const [name, pattern] of forbidden) {
    if (pattern.test(utilityForStaticChecks)) {
        problems.push("forbidden API: " + name);
    }
}

const nonES5Syntax = [
    ["const declaration", /\bconst\s+[A-Za-z_$]/],
    ["let declaration", /\blet\s+[A-Za-z_$]/],
    ["class declaration", /\bclass\s+[A-Za-z_$]/],
    ["arrow function", /=>/],
    ["template literal", /`/],
    ["async/await", /\b(?:async|await)\b/],
    ["spread/rest syntax", /\.\.\./],
    ["optional chaining", /\?\./],
    ["nullish coalescing", /\?\?/],
    ["for-of loop", /\bfor\s*\([^)]*\bof\b/],
    ["generator function", /\bfunction\s*\*/],
    ["destructuring declaration", /\b(?:var|let|const)\s*(?:\{[^}]*\}|\[[^\]]*\])\s*=/],
    ["new.target", /\bnew\s*\.\s*target\b/],
    ["module import/export", /^\s*(?:import|export)\s/m],
    ["numeric separator", /\b\d[\d_]*_[\d_]*\d\b/],
    ["binary or octal literal", /\b0[bBoO][0-9a-fA-F]+\b/],
    ["BigInt literal", /\b\d+n\b/],
    ["Unicode code-point escape", /\\u\{[0-9a-fA-F]+\}/],
    ["Unicode or sticky regex flag", /\/[^/\n]+\/[a-z]*[uy]\b/]
];
for (const [name, pattern] of nonES5Syntax) {
    if (pattern.test(utilityForStyleChecks)) {
        problems.push("non-ES5 syntax: " + name);
    }
}

const nonES5Methods = [
    ["Array.prototype.fill", /\.fill\s*\(/],
    ["Array.from", /\bArray\.from\s*\(/],
    ["Object.assign", /\bObject\.assign\s*\(/],
    ["String.prototype.includes", /\.includes\s*\(/],
    ["Array.prototype.find", /\.find\s*\(/]
];
for (const [name, pattern] of nonES5Methods) {
    if (pattern.test(utilityForStyleChecks)) {
        problems.push("non-ES5 built-in: " + name);
    }
}

if (/(?<![=!])(?:==|!=)(?!=)/.test(utilityForStyleChecks)) {
    problems.push("loose equality: use === or !==");
}

const lines = utilityForStyleChecks.split(/\r?\n/);
for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*if\s*\(.+\)\s*[^{}]+;\s*$/.test(line)) {
        problems.push("one-line if at line " + (index + 1));
    }
    if (/^\s*[?:]/.test(line)) {
        problems.push("leading ternary punctuation at line " + (index + 1));
    }
    if (/=\s*$/.test(line)) {
        problems.push("line ends with equals at line " + (index + 1));
    }
}

try {
    new vm.Script(utilityForStaticChecks, { filename: "generated-ka-utility.js" });
} catch (error) {
    problems.push("JavaScript syntax error: " + error.message);
}

const compactLosslessUtility = vm.runInContext(
    "getImageUtilityCode(false, false)",
    encoderContext
);
const compactColorUtility = vm.runInContext(
    "getImageUtilityCode(false, true)",
    encoderContext
);
const compactPixelArtUtility = vm.runInContext(
    "getImageUtilityCode(true, true)",
    encoderContext
);
const compactJPEGUtility = vm.runInContext(
    "getJPEGUtilityCode(false)",
    encoderContext
);
const compactCappedJPEGUtility = vm.runInContext(
    "getJPEGUtilityCode(true)",
    encoderContext
);
const simplifiedAudioReference = vm.runInContext(
    "simplifyGeneratedFunctionNames('dkPlayAudio(\"audio\", 1)')",
    encoderContext
);
if (simplifiedAudioReference.includes("dkPlayAudio")) {
    problems.push("generated output retains a DK-prefixed utility function call");
}
const simplifiedDataReference = vm.runInContext(
    "simplifyGeneratedFunctionNames('function drawImage(dat) { return dat.x; }')",
    encoderContext
);
if (/\bdat\b/.test(simplifiedDataReference)) {
    problems.push("generated output retains the typo-prone dat identifier");
}
const unusedUtilityFunctions = [
    compactLosslessUtility.includes('function drawColorImage') &&
        'lossless bundle includes color renderer',
    compactLosslessUtility.includes('function drawReadablePixelArt') &&
        'lossless bundle includes Pixel Art renderer',
    compactColorUtility.includes('function drawLosslessImage') &&
        'color bundle includes lossless renderer',
    compactColorUtility.includes('function drawReadablePixelArt') &&
        'color bundle includes Pixel Art renderer',
    compactPixelArtUtility.includes('function drawLosslessImage') &&
        'Pixel Art bundle includes lossless renderer',
    compactPixelArtUtility.includes('function decodeZstdBytes') &&
        'Pixel Art bundle includes Zstandard decoder'
].filter(Boolean);
if (unusedUtilityFunctions.length) {
    throw new Error(unusedUtilityFunctions.join('; '));
}

function makeKaSandbox() {
    const env = Object.create(null);
    env.Error = { name: "Error" };
    env.Math = Math;
    env.String = String;
    env.Number = Number;
    env.Object = Object;
    env.Array = Array;
    env.parseInt = parseInt;
    env.isNaN = isNaN;
    env.undefined = undefined;
    env.performance = performance;
    const sandbox = {
        __env__: env,
        Math,
        String,
        Number,
        Object,
        Array,
        parseInt,
        isNaN,
        undefined,
        performance
    };
    Object.defineProperty(sandbox, "Error", {
        value: env.Error,
        writable: true,
        configurable: true
    });
    return vm.createContext(sandbox);
}

try {
    for (const [name, source] of [
        ["lossless image", compactLosslessUtility],
        ["color-capped image", compactColorUtility],
        ["pixel-art image", compactPixelArtUtility],
        ["JPEG image", compactJPEGUtility],
        ["color-capped JPEG image", compactCappedJPEGUtility]
    ]) {
        new vm.Script(source, { filename: `ka-${name.replaceAll(" ", "-")}.js` });
        if (/\bfunction\s+dk[A-Z]\w*/.test(source) ||
            /\bdk[A-Z]\w*\s*\(/.test(source)) {
            throw new Error(name + " utility still exposes DK-prefixed functions.");
        }
        vm.runInContext(source, makeKaSandbox(), {
            filename: `ka-${name.replaceAll(" ", "-")}.js`
        });
    }
    const decoderStart = compactJPEGUtility.indexOf("function decodeJPEG");
    const ignoreStart = compactJPEGUtility.indexOf(
        "/* jshint ignore:start */",
        decoderStart
    );
    const ignoreEnd = compactJPEGUtility.indexOf(
        "/* jshint ignore:end */",
        ignoreStart
    );
    const lintVisibleJPEG = compactJPEGUtility.replace(
        /\/\* jshint ignore:start \*\/[\s\S]*?\/\* jshint ignore:end \*\//g,
        "\n"
    );
    if (decoderStart < 0 || ignoreStart < decoderStart || ignoreEnd < ignoreStart ||
        !/\bfunction\s+decodeJPEG\s*\([^)]*\)\s*\{\s*\}/.test(lintVisibleJPEG)) {
        problems.push("JPEG decoder declaration must remain visible outside its ignored body");
    }
    if (/\bfunction\s+(?:fail|read16|makeHuffman|readBit|readBits|decodeHuffman|receiveExtend|decodeBlock|sample)\s*\(/.test(
        compactJPEGUtility
    )) {
        problems.push("JPEG utility contains a named nested helper declaration");
    }
    if (/\bread\w*\b/.test(compactJPEGUtility)) {
        problems.push("JPEG utility contains a read-prefixed identifier that breaks KA parsing");
    }
    if (/\breturn\s*\{/.test(compactJPEGUtility)) {
        problems.push("JPEG utility returns an object literal that KA transpiles with invalid syntax");
    }
    const colorCapperPosition = compactCappedJPEGUtility.indexOf(
        "function capJPEGColors"
    );
    const colorCapCheckPosition = compactCappedJPEGUtility.lastIndexOf(
        "capJPEGColors(rgba"
    );
    const capIgnoreEnd = compactCappedJPEGUtility.indexOf(
        "/* jshint ignore:end */"
    );
    if (colorCapperPosition < capIgnoreEnd ||
        colorCapCheckPosition < colorCapperPosition) {
        problems.push("JPEG color capper must be declared outside the JSHint ignore block");
    }
    if (!/function capJPEGColors\(rgba, maxColors\) \{\r?\n/.test(
        compactCappedJPEGUtility
    ) || !/Math\.floor\(Math\.pow\(maxColors, 1 \/ 3\)\)/.test(
        compactCappedJPEGUtility
    )) {
        problems.push("JPEG color capper must retain readable, spaced source formatting");
    }
    if (/\bdat\b/.test(compactCappedJPEGUtility)) {
        problems.push("generated JPEG utility retains the typo-prone dat identifier");
    }

    const jpegSandbox = makeKaSandbox();
    let renderedPixels = null;
    jpegSandbox.JAVA2D = 0;
    jpegSandbox.createGraphics = (width, height) => {
        const sourceImg = {
            getContext: () => ({
                createImageData: () => ({
                    data: new Uint8ClampedArray(width * height * 4)
                }),
                putImageData: imageData => {
                    renderedPixels = Array.from(imageData.data);
                }
            })
        };
        return {
            get: () => ({ sourceImg }),
            image: () => {}
        };
    };
    jpegSandbox.image = () => {};
    vm.runInContext(compactCappedJPEGUtility, jpegSandbox);
    if (vm.runInContext("typeof capJPEGColors", jpegSandbox) !== "function") {
        problems.push("generated capped JPEG utility does not declare capJPEGColors");
    }
    jpegSandbox.decodeBaseK = () => [];
    jpegSandbox.decodeJPEG = () => [255, 0, 0, 255];
    jpegSandbox.createImageFromRGBA = rgba => rgba;
    jpegSandbox.__jpegTestData = {
        s: "",
        n: 4,
        w: 1,
        h: 1,
        c: 1
    };
    vm.runInContext(
        "drawJPEGImage(0, 0, 1, __jpegTestData)",
        jpegSandbox
    );
    if (!jpegSandbox.__jpegTestData._image ||
        jpegSandbox.__jpegTestData._image[0] !== 0) {
        problems.push("capped JPEG drawing did not apply the generated color capper");
    }
    if (/\b(?:Uint8Array|new\s+Array|new\s+Error)\b/.test(compactJPEGUtility)) {
        problems.push("JPEG utility contains a Khan-incompatible API");
    }
} catch (error) {
    problems.push("KA-like boot failed: " + (error && error.message || error));
}

if (problems.length) {
    throw new Error(problems.join("\n"));
}

(async function roundTrip() {
    await zstdCodec.ZstdInit();
    const width = 48;
    const height = 32;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = (i * 13) & 255;
        rgba[i + 1] = (i * 29) & 255;
        rgba[i + 2] = (i * 47) & 255;
        rgba[i + 3] = 255;
    }
    encoderContext.__rgba = rgba;
    const compressed = await vm.runInContext(
        "compressRGBAWithZstd(globalThis.__rgba, " + width + ", " + height + ")",
        encoderContext
    );
    const encoded = await vm.runInContext(
        "encodeBytes(globalThis.__compressed)",
        Object.assign(encoderContext, { __compressed: compressed.bytes })
    );
    const decoderSandbox = makeKaSandbox();
    vm.runInContext(compactLosslessUtility, decoderSandbox);
    decoderSandbox.__frameData = {
        length: rgba.length,
        encodedLength: compressed.bytes.length,
        baseK: true,
        baseKBlockSize: vm.runInContext("BASE_K_BLOCK_SIZE", encoderContext),
        zstd: true,
        zstdPadding: compressed.padding,
        data: encoded
    };
    const started = performance.now();
    const decoded = vm.runInContext(
        "decodeZstdFrame(__frameData, " + width + ", " + height + ")",
        decoderSandbox
    );
    const decodeMs = Number((performance.now() - started).toFixed(3));
    if (!decoded || decoded.length !== rgba.length) {
        throw new Error("KA decoder returned the wrong byte length.");
    }
    for (let index = 0; index < rgba.length; index++) {
        if (decoded[index] !== rgba[index]) {
            throw new Error("KA decoder round-trip differed at byte " + index + ".");
        }
    }
    const jpegBytes = new Uint8Array(
        fs.readFileSync("dkconverterstats/fixtures/kitty-338x600.jpg")
    );
    encoderContext.__jpegBytes = jpegBytes;
    const encodedJpeg = await vm.runInContext(
        "encodeBytes(globalThis.__jpegBytes)",
        encoderContext
    );
    const jpegSandbox = makeKaSandbox();
    let renderedPixels = null;
    jpegSandbox.JAVA2D = 0;
    jpegSandbox.createGraphics = (imageWidth, imageHeight) => {
        const sourceImg = {
            getContext: () => ({
                createImageData: () => ({
                    data: new Uint8ClampedArray(imageWidth * imageHeight * 4)
                }),
                putImageData: imageData => {
                    renderedPixels = Array.from(imageData.data);
                }
            })
        };
        return {
            get: () => ({ sourceImg }),
            image: () => {}
        };
    };
    jpegSandbox.image = () => {};
    vm.runInContext(compactCappedJPEGUtility, jpegSandbox);
    jpegSandbox.__jpeg = {
        w: 338,
        h: 600,
        n: jpegBytes.length,
        s: encodedJpeg,
        c: 2
    };
    vm.runInContext("drawJPEGImage(0, 0, 1, __jpeg)", jpegSandbox);
    if (!renderedPixels || renderedPixels.length !== 338 * 600 * 4 ||
        renderedPixels.some((value, index) =>
            index % 4 === 3 && value !== 255)) {
        throw new Error("JPEG utility did not render the capped JPEG fixture correctly.");
    }
    const renderedColors = new Set();
    for (let index = 0; index < renderedPixels.length; index += 4) {
        renderedColors.add(renderedPixels.slice(index, index + 3).join(","));
    }
    if (renderedColors.size > jpegSandbox.__jpeg.c) {
        throw new Error("Color-capped JPEG utility exceeded its requested color limit.");
    }
    console.log("KA utility syntax, boot, and decode checks passed (" +
        compactColorUtility.length.toLocaleString() +
        " color-capped utility chars; " +
        compactJPEGUtility.length.toLocaleString() +
        " uncapped JPEG utility chars; " +
        compactCappedJPEGUtility.length.toLocaleString() +
        " color-capped JPEG utility chars, decode " +
        decodeMs + " ms).");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
