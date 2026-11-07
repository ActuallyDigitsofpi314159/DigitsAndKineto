const fs = require("node:fs");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const zstdCodec = require("../dkconverter/vendor/zstd_wasm.umd.js");

const html = fs.readFileSync("dkconverter/index.html", "utf8");
const converterSource = fs.readFileSync("dkconverter/converter.js", "utf8");
const openTag = '<pre id="utilityOutput" class="language-javascript">';
const start = html.indexOf(openTag);
const end = html.indexOf("</pre>", start);

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
vm.runInContext(converterSource.slice(0, encoderBoundary), encoderContext);
const alphabetLiteral = vm.runInContext("JSON.stringify(BYTE_ALPHABET.join(''))", encoderContext);
const digitCountsLiteral = vm.runInContext("JSON.stringify(BASE_K_DIGIT_COUNTS)", encoderContext);

let utility = decodeHtml(html.slice(start + openTag.length, end)).trim()
    .replace("__DK_ALPHABET__", alphabetLiteral)
    .replace("__DK_DIGIT_COUNTS__", digitCountsLiteral);

function stripSection(source, startMarker, endMarker) {
    const sectionStart = source.indexOf(startMarker);
    const sectionEnd = source.indexOf(endMarker, sectionStart);
    return (
        source.slice(0, sectionStart) +
        source.slice(sectionEnd + endMarker.length)
    ).trim();
}

utility = stripSection(
    stripSection(
        utility,
        "// DK JSON PARSER SUPPORT START",
        "// DK JSON PARSER SUPPORT END"
    ),
    "// DK AUDIO SUPPORT START",
    "// DK AUDIO SUPPORT END"
);

function makeKaSandbox() {
    const env = Object.create(null);
    env.Error = { name: "Error" };
    env.Math = Math;
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

(async function main() {
    await zstdCodec.ZstdInit();
    const width = 8;
    const height = 8;
    const frame0 = new Uint8Array(width * height * 4);
    const frame1 = new Uint8Array(width * height * 4);
    for (let i = 0; i < frame0.length; i += 4) {
        frame0[i] = 40;
        frame0[i + 1] = 80;
        frame0[i + 2] = 120;
        frame0[i + 3] = 255;
        frame1[i] = 40;
        frame1[i + 1] = 80;
        frame1[i + 2] = 120;
        frame1[i + 3] = 255;
    }
    frame1[0] = 255;
    frame1[4] = 10;
    frame1[5] = 20;
    frame1[6] = 30;

    encoderContext.__frames = [frame0, frame1];
    const frames = await vm.runInContext(
        "encodeColorLimitedFrames(globalThis.__frames, 8, 8, 16)",
        encoderContext
    );
    if (!frames[1].deltaFromPrevious) {
        throw new Error("Expected second frame to be marked as a delta.");
    }
    if (frames[1].data) {
        throw new Error("Later frames must not carry their own compressed payload.");
    }

    const properties = [
        "k:\"DKC5\"",
        "w:8",
        "h:8",
        "c:" + frames[0].paletteLength,
        "b:" + frames[0].bitDepth,
        "i:" + frames[0].transparentIndex,
        "q:2"
    ];
    if (frames[0].zstdPadding) {
        properties.push("p:" + frames[0].zstdPadding);
    }
    properties.push("s:" + JSON.stringify(frames[0].data));
    const objectSource = "({" + properties.join(",") + "})";

    const sandbox = makeKaSandbox();
    vm.runInContext(utility, sandbox);
    sandbox.__data = vm.runInContext(objectSource, sandbox);

    const rgba0 = vm.runInContext(
        "(function() {" +
        "  var d = __data;" +
        "  return dkDecodePalette(dkSliceFrame(d, 0), d, d.w * d.h, 0);" +
        "})()",
        sandbox
    );
    const rgba1 = vm.runInContext(
        "(function() {" +
        "  var d = __data;" +
        "  var packed = dkSliceFrame(d, 1);" +
        "  packed = dkApplyFrameDelta(packed, dkPreviousIndexBytes(d, 1));" +
        "  return dkDecodePalette(packed, d, d.w * d.h, 1);" +
        "})()",
        sandbox
    );

    if (!rgba0 || rgba0.length !== frame0.length) {
        throw new Error("Frame 0 decode failed.");
    }
    if (!rgba1 || rgba1.length !== frame1.length) {
        throw new Error("Frame 1 decode failed.");
    }

    let diff = 0;
    for (let i = 0; i < rgba0.length; i++) {
        if (rgba0[i] !== rgba1[i]) {
            diff++;
        }
    }
    if (diff === 0) {
        throw new Error("Expected decoded frames to differ after pixel edits.");
    }

    console.log(JSON.stringify({
        ok: true,
        deltaFrame: true,
        sharedPayload: true,
        frame0Length: frames[0].length,
        frame1Length: frames[1].length,
        payloadCharacters: frames[0].data.length,
        decodedDiffBytes: diff,
        objectCharacters: objectSource.length
    }, null, 2));
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
