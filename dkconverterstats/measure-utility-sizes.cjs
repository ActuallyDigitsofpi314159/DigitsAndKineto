const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("dkconverter/index.html", "utf8");
const converterSource = fs.readFileSync("dkconverter/converter.js", "utf8");
const encoderBoundary = converterSource.indexOf("\nasync function finishConversion(");
if (encoderBoundary < 0) {
    throw new Error("Could not locate utility bundling functions.");
}
const encoderContext = vm.createContext({
    window: { Worker: undefined },
    Worker: undefined,
    navigator: { hardwareConcurrency: 4 },
    scheduler: { yield: () => Promise.resolve() }
});
vm.runInContext(converterSource.slice(0, encoderBoundary), encoderContext);
const alphabetLiteral = vm.runInContext(
    "JSON.stringify(BYTE_ALPHABET.join(''))",
    encoderContext
);
const digitCountsLiteral = vm.runInContext(
    "JSON.stringify(BASE_K_DIGIT_COUNTS)",
    encoderContext
);
const openTag = '<pre id="utilityOutput" class="language-javascript">';
const start = html.indexOf(openTag);
const end = html.indexOf("</pre>", start);
const utilityTemplate = html
    .slice(start + openTag.length, end)
    .replace(/\r\n/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace("__DK_ALPHABET__", alphabetLiteral)
    .replace("__DK_DIGIT_COUNTS__", digitCountsLiteral)
    .trim();
vm.runInContext(
    "fullUtilityTemplate = " + JSON.stringify(utilityTemplate),
    encoderContext
);
const generatedBundleSizes = vm.runInContext(`({
    imageLossless: getImageUtilityCode(false, false).length,
    imageColorCapped: getImageUtilityCode(false, true).length,
    pixelArt: getImageUtilityCode(true, true).length
})`, encoderContext);

const parserStartMarker = "// DK JSON PARSER SUPPORT START";
const parserEndMarker = "// DK JSON PARSER SUPPORT END";
const parserStart = utilityTemplate.indexOf(parserStartMarker);
const parserEnd = utilityTemplate.indexOf(parserEndMarker, parserStart);
const utilityWithoutParser = (
    utilityTemplate.slice(0, parserStart) +
    utilityTemplate.slice(parserEnd + parserEndMarker.length)
).trim();
const audioStartMarker = "// DK AUDIO SUPPORT START";
const audioEndMarker = "// DK AUDIO SUPPORT END";
const audioStart = utilityWithoutParser.indexOf(audioStartMarker);
const audioEnd = utilityWithoutParser.indexOf(audioEndMarker, audioStart);
const audioUtilityCode = utilityWithoutParser.slice(
    audioStart + audioStartMarker.length,
    audioEnd
).trim();
const utilityWithoutAudio = (
    utilityWithoutParser.slice(0, audioStart) +
    utilityWithoutParser.slice(audioEnd + audioEndMarker.length)
).trim();
const imageDecoderStart = utilityWithoutAudio.indexOf("function dkBaseDigitCount");
const zstdDecoderStart = utilityWithoutAudio.indexOf(
    "function dkPaethPredictor",
    imageDecoderStart
);
const encodedFrameStart = utilityWithoutAudio.indexOf(
    "function dkExpandEncoded",
    zstdDecoderStart
);
const decodeZstdStart = utilityWithoutAudio.indexOf(
    "function dkDecodeZstdBytes",
    encodedFrameStart
);
const frameDataStart = utilityWithoutAudio.indexOf(
    "function dkFrameCount",
    zstdDecoderStart
);
const imageRendererStart = utilityWithoutAudio.indexOf(
    "function dkCreateImageFromRGBA",
    frameDataStart
);
const frameDurationStart = utilityWithoutAudio.indexOf(
    "function dkFrameDuration(",
    imageRendererStart
);
const paletteDecoderStart = utilityWithoutAudio.indexOf(
    "function dkDecodePalette",
    frameDurationStart
);
const losslessDrawStart = utilityWithoutAudio.indexOf(
    "function drawLosslessImage",
    paletteDecoderStart
);
const colorDrawStart = utilityWithoutAudio.indexOf(
    "function drawColorImage",
    losslessDrawStart
);
const pixelArtRendererStart = utilityWithoutAudio.indexOf(
    "function drawReadablePixelArt",
    colorDrawStart
);
const pixelArtRendererEnd = utilityWithoutAudio.indexOf(
    "function drawHugePixelArt",
    pixelArtRendererStart
);
const markerIndexes = [
    imageDecoderStart,
    zstdDecoderStart,
    encodedFrameStart,
    decodeZstdStart,
    frameDataStart,
    imageRendererStart,
    frameDurationStart,
    paletteDecoderStart,
    losslessDrawStart,
    colorDrawStart,
    pixelArtRendererStart,
    pixelArtRendererEnd
];
if (markerIndexes.some(index => index < 0) ||
    !(imageDecoderStart < zstdDecoderStart &&
        zstdDecoderStart < encodedFrameStart &&
        encodedFrameStart < decodeZstdStart &&
        decodeZstdStart < frameDataStart &&
        frameDataStart < imageRendererStart &&
        imageRendererStart < frameDurationStart &&
        frameDurationStart < paletteDecoderStart &&
        paletteDecoderStart < losslessDrawStart &&
        losslessDrawStart < colorDrawStart &&
        colorDrawStart < pixelArtRendererStart &&
        pixelArtRendererStart < pixelArtRendererEnd)) {
    throw new Error("DK utility renderer boundaries are missing or out of order.");
}
const sharedHelpers = utilityWithoutAudio.slice(0, imageDecoderStart);
const encodedFrameHelper = utilityWithoutAudio.slice(
    encodedFrameStart,
    decodeZstdStart
);
const frameDataHelpers = utilityWithoutAudio.slice(
    frameDataStart,
    imageRendererStart
);
const frameDurationHelper = utilityWithoutAudio.slice(
    frameDurationStart,
    paletteDecoderStart
);
const decoderHelpers = utilityWithoutAudio.slice(imageDecoderStart, zstdDecoderStart);
const zstdDecoder = utilityWithoutAudio.slice(zstdDecoderStart, frameDataStart);
const paletteDecoder = utilityWithoutAudio.slice(
    paletteDecoderStart,
    losslessDrawStart
);
const imageBlit = utilityWithoutAudio.slice(
    imageRendererStart,
    frameDurationStart
);
const losslessDraw = utilityWithoutAudio.slice(
    losslessDrawStart,
    colorDrawStart
);
const colorDraw = utilityWithoutAudio.slice(
    colorDrawStart,
    pixelArtRendererStart
);
const imageDecoder = [
    decoderHelpers,
    zstdDecoder,
    frameDataHelpers,
    paletteDecoder
].join("\n\n");
const lossless = [
    sharedHelpers,
    decoderHelpers,
    zstdDecoder,
    frameDataHelpers,
    imageBlit,
    losslessDraw
].map(part => part.trim()).filter(Boolean).join("\n\n");
const image = [
    sharedHelpers,
    imageDecoder,
    imageBlit,
    colorDraw
].map(part => part.trim()).filter(Boolean).join("\n\n");
const pixelArt = [
    sharedHelpers,
    encodedFrameHelper,
    frameDurationHelper,
    utilityWithoutAudio.slice(pixelArtRendererStart, pixelArtRendererEnd)
].map(part => part.trim()).filter(Boolean).join("\n\n");
const audioHelpers = [sharedHelpers, decoderHelpers]
    .map(part => part.trim()).filter(Boolean).join("\n\n");
const universalFunctions = [
    "function dkParseJSON",
    "function dkDecodeBaseK",
    "function dkDecodeZstdBytes",
    "function dkPlayAudio",
    "function drawLosslessImage",
    "function drawColorImage",
    "function drawReadablePixelArt",
    "function drawHugePixelArt"
];
if (!utilityTemplate.startsWith("// DK CONVERTER UTILITY [") ||
    !utilityTemplate.endsWith("// ]") ||
    universalFunctions.some(functionSource =>
        !utilityTemplate.includes(functionSource)
    )) {
    throw new Error("The universal DK utility is missing a required marker or media function.");
}
console.log(JSON.stringify({
    universal: utilityTemplate.length,
    ...generatedBundleSizes,
    audioHelpers: audioUtilityCode.length,
    closingMarker: utilityTemplate.endsWith("// ]"),
    mediaFunctions: universalFunctions.map(functionSource =>
        functionSource.slice("function ".length)
    )
}, null, 2));
