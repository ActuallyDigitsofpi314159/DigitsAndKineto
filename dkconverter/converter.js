const BYTE_ALPHABET = [];
const TARGET_ALPHABET_SIZE = 200;
for (let codePoint = 33; codePoint <= 126; codePoint++) {
    const character = String.fromCharCode(codePoint);
    if (character !== '"' && character !== '\\' && character !== '`') {
        BYTE_ALPHABET.push(character);
    }
}
for (let codePoint = 0x100;
    codePoint <= 0x24F && BYTE_ALPHABET.length < TARGET_ALPHABET_SIZE;
    codePoint++) {
    const character = String.fromCharCode(codePoint);
    if (/\p{L}/u.test(character)) {
        BYTE_ALPHABET.push(character);
    }
}
const BASE_K_BLOCK_SIZE = 4;
const PROGRESS_STATUS_INTERVAL_MS = 250;
const generatedFunctionNames = new Set();
let fullUtilityCode = '';
let fullImageCode = '';
let fullImageUtilityCode = '';
let highestProgress = 0;
let lastProgressStatusAt = 0;
let progressStatusTimer = null;
let pendingProgressStatus = '';
let conversionCancelled = false;
let activeConversionController = null;
let activeFFmpegRuntime = null;
let activeZstdWorker = null;
let zstdWorkerReadyPromise = null;
let zstdWorkerInitReject = null;
let activeZstdCompression = null;
let zstdWorkerUnsupported = false;
let zstdMainThreadReadyPromise = null;
let nextZstdRequestId = 1;
let fullUtilityTemplate = '';

function simplifyGeneratedFunctionNames(code) {
    const functionNames = new Set();
    const sources = [code];
    if (typeof fullUtilityTemplate === 'string') {
        sources.push(fullUtilityTemplate);
    }
    for (const source of sources) {
        for (const match of source.matchAll(/\bfunction\s+(dk[A-Z][A-Za-z0-9_]*)\s*\(/g)) {
            functionNames.add(match[1]);
        }
    }
    let simplifiedCode = code;
    for (const name of functionNames) {
        const simpleName = name === 'dkThrow'
            ? 'raiseError'
            : name.slice(2, 3).toLowerCase() + name.slice(3);
        simplifiedCode = simplifiedCode.replace(
            new RegExp(`\\b${name}\\b`, 'g'),
            simpleName
        );
    }
    return simplifiedCode.replace(/\bdat\b/g, 'data');
}

function createCodePreview(code, edgeLength) {
    const previewLength = edgeLength || 1600;
    if (code.length <= previewLength * 2) {
        return code;
    }
    const omittedLength = code.length - previewLength * 2;
    return code.slice(0, previewLength) +
        `\n\n... ${omittedLength.toLocaleString()} characters omitted from preview ...\n\n` +
        code.slice(-previewLength);
}

function removeUtilitySection(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start < 0 || end < 0) {
        throw new Error(`Could not locate utility section ${startMarker}.`);
    }
    return source.slice(0, start) +
        source.slice(end + endMarker.length);
}

function getImageUtilityCode(pixelArt, colorLimited) {
    let utility = removeUtilitySection(
        fullUtilityTemplate,
        '// DK JSON PARSER SUPPORT START',
        '// DK JSON PARSER SUPPORT END'
    );
    utility = removeUtilitySection(
        utility,
        '// DK AUDIO SUPPORT START',
        '// DK AUDIO SUPPORT END'
    );

    const positions = {
        baseKDecoder: utility.indexOf('function dkBaseDigitCount'),
        zstdDecoder: utility.indexOf('function dkPaethPredictor'),
        encodedFrame: utility.indexOf('function dkExpandEncoded'),
        decodeZstd: utility.indexOf('function dkDecodeZstdBytes'),
        frameData: utility.indexOf('function dkFrameCount'),
        imageRenderer: utility.indexOf('function dkCreateImageFromRGBA'),
        frameDuration: utility.indexOf('function dkFrameDuration('),
        paletteDecoder: utility.indexOf('function dkDecodePalette'),
        losslessRenderer: utility.indexOf('function drawLosslessImage'),
        colorRenderer: utility.indexOf('function drawColorImage'),
        pixelArtRenderer: utility.indexOf('function drawReadablePixelArt'),
        hugePixelArtRenderer: utility.indexOf('function drawHugePixelArt')
    };
    const orderedPositions = [
        positions.baseKDecoder,
        positions.zstdDecoder,
        positions.encodedFrame,
        positions.decodeZstd,
        positions.frameData,
        positions.imageRenderer,
        positions.frameDuration,
        positions.paletteDecoder,
        positions.losslessRenderer,
        positions.colorRenderer,
        positions.pixelArtRenderer,
        positions.hugePixelArtRenderer
    ];
    if (orderedPositions.some(position => position < 0) ||
        orderedPositions.some((position, index) =>
            index > 0 && position <= orderedPositions[index - 1])) {
        throw new Error('Image utility function boundaries are missing or out of order.');
    }

    const sharedHelpers = utility.slice(0, positions.baseKDecoder);
    const encodedFrameHelper = utility.slice(
        positions.encodedFrame,
        positions.decodeZstd
    );
    const frameDataHelpers = utility.slice(
        positions.frameData,
        positions.imageRenderer
    );
    const frameDurationHelper = utility.slice(
        positions.frameDuration,
        positions.paletteDecoder
    );
    const decoderHelpers = utility.slice(
        positions.baseKDecoder,
        positions.zstdDecoder
    );
    const zstdDecoder = utility.slice(
        positions.zstdDecoder,
        positions.frameData
    );
    const paletteDecoder = utility.slice(
        positions.paletteDecoder,
        positions.losslessRenderer
    );
    const imageBlit = utility.slice(
        positions.imageRenderer,
        positions.frameDuration
    );

    if (pixelArt) {
        return simplifyGeneratedFunctionNames([
            sharedHelpers,
            encodedFrameHelper,
            frameDurationHelper,
            utility.slice(
                positions.pixelArtRenderer,
                positions.hugePixelArtRenderer
            )
        ].map(part => part.trim()).filter(Boolean).join('\n\n'));
    }
    return simplifyGeneratedFunctionNames([
        sharedHelpers,
        decoderHelpers,
        zstdDecoder,
        frameDataHelpers,
        colorLimited ? paletteDecoder : '',
        imageBlit,
        utility.slice(
            colorLimited ? positions.colorRenderer : positions.losslessRenderer,
            colorLimited ? positions.pixelArtRenderer : positions.colorRenderer
        )
    ].map(part => part.trim()).filter(Boolean).join('\n\n'));
}

function getJPEGUtilityCode(colorLimited) {
    let utility = removeUtilitySection(
        fullUtilityTemplate,
        '// DK JSON PARSER SUPPORT START',
        '// DK JSON PARSER SUPPORT END'
    );
    utility = removeUtilitySection(
        utility,
        '// DK AUDIO SUPPORT START',
        '// DK AUDIO SUPPORT END'
    );
    const imageRenderer = utility.indexOf('function dkCreateImageFromRGBA');
    const imageRendererEnd = utility.indexOf('function dkDrawCached', imageRenderer);
    if (imageRenderer < 0 || imageRendererEnd <= imageRenderer) {
        throw new Error('JPEG image utility function boundaries are missing.');
    }
    const alphabet = JSON.stringify(BYTE_ALPHABET.join(''));
    const digitCounts = JSON.stringify(BASE_K_DIGIT_COUNTS);
    const decoder = decodeDKJPEG.toString()
        .replace(/\bdecodeDKJPEG\b/g, 'decodeJPEG')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}()[\],;:?=+*<>!&|%])\s*/g, '$1');
    if (!/^function decodeJPEG\s*\(/.test(decoder) || !decoder.endsWith('}')) {
        throw new Error('JPEG decoder function boundaries are missing.');
    }
    const decoderBodyStart = decoder.indexOf('{');
    const decoderBodyEnd = decoder.lastIndexOf('}');
    if (decoderBodyStart < 0 || decoderBodyEnd <= decoderBodyStart) {
        throw new Error('JPEG decoder function boundaries are missing.');
    }
    const lintSafeDecoder = decoder.slice(0, decoderBodyStart + 1) +
        '\n/* jshint ignore:start */\n' +
        decoder.slice(decoderBodyStart + 1, decoderBodyEnd) +
        '\n/* jshint ignore:end */\n' +
        decoder.slice(decoderBodyEnd);
    const colorCapper = colorLimited
        ? capDKJPEGColors.toString()
            .replace(/\bcapDKJPEGColors\b/g, 'capJPEGColors')
        : '';
    const colorCapCheck = colorLimited
        ? `if (typeof dat.c === "number") {
            capJPEGColors(rgba, dat.c);
        }`
        : '';
    return simplifyGeneratedFunctionNames([
        `var DK_ALPHABET=${alphabet};
var DK_ALPHABET_INDEX={};
var DK_BASE_K_DIGIT_COUNTS=${digitCounts};
var dkAlphabetPosition;
for(dkAlphabetPosition=0;dkAlphabetPosition<DK_ALPHABET.length;dkAlphabetPosition++){
    DK_ALPHABET_INDEX[DK_ALPHABET.charAt(dkAlphabetPosition)]=dkAlphabetPosition;
}
function dkDecodeBaseK(encoded,byteLength){
    if(typeof encoded!=="string"||!isFinite(byteLength)||Math.floor(byteLength)!==byteLength||byteLength<0){
        throw "DK JPEG: invalid encoded image length.";
    }
    var output=[];
    var outputOffset=0;
    var inputOffset=0;
    while(outputOffset<byteLength){
        var blockLength=Math.min(4,byteLength-outputOffset);
        var digitCount=DK_BASE_K_DIGIT_COUNTS[blockLength];
        var value=0;
        var i;
        for(i=0;i<digitCount;i++){
            var digit=DK_ALPHABET_INDEX[encoded.charAt(inputOffset+i)];
            if(typeof digit!=="number"){
                throw "DK JPEG: invalid encoded image character.";
            }
            value=value*DK_ALPHABET.length+digit;
        }
        inputOffset+=digitCount;
        if(value>=Math.pow(256,blockLength)){
            throw "DK JPEG: encoded image block overflow.";
        }
        for(i=blockLength-1;i>=0;i--){
            output[outputOffset+i]=value%256;
            value=Math.floor(value/256);
        }
        outputOffset+=blockLength;
    }
    if(inputOffset!==encoded.length){
        throw "DK JPEG: encoded image length mismatch.";
    }
    return output;
}
function dkThrow(message){
    throw message;
}`,
utility.slice(imageRenderer, imageRendererEnd),
lintSafeDecoder,
colorCapper,
        `function drawJPEGImage(x, y, size, dat) {
    if (!dat._image) {
        var rgba = decodeJPEG(decodeBaseK(dat.s, dat.n), dat.w, dat.h);
        ${colorCapCheck}
        dat._image = dkCreateImageFromRGBA(rgba, dat.w, dat.h);
    }
    image(dat._image, x, y, Math.round(dat.w * size), Math.round(dat.h * size));
}`
    ].map(part => part.trim()).filter(Boolean).join('\n\n'));
}

function getBaseKDigitCount(byteCount) {
    if (byteCount === 0) return 0;
    const work = new Array(byteCount).fill(255);
    let digitCount = 0;
    while (work.some(value => value !== 0)) {
        let remainder = 0;
        for (let i = 0; i < work.length; i++) {
            const value = remainder * 256 + work[i];
            work[i] = Math.floor(value / BYTE_ALPHABET.length);
            remainder = value % BYTE_ALPHABET.length;
        }
        digitCount++;
    }
    return digitCount;
}

const BASE_K_DIGIT_COUNTS = Array.from(
    { length: BASE_K_BLOCK_SIZE + 1 },
    (_, byteCount) => getBaseKDigitCount(byteCount)
);
const KA_BASE_K_DIGIT_COUNTS = [0, 2, 3, 4, 5];
if (BASE_K_BLOCK_SIZE !== 4 ||
    BYTE_ALPHABET.length !== TARGET_ALPHABET_SIZE ||
    BYTE_ALPHABET.length !== new Set(BYTE_ALPHABET).size ||
    BYTE_ALPHABET.length ** 5 < 2 ** 32 ||
    BASE_K_DIGIT_COUNTS.join() !== KA_BASE_K_DIGIT_COUNTS.join()) {
    throw new Error('KA Base-K decoder table does not match the encoder alphabet.');
}

function getBaseKCharacterCount(byteCount) {
    let characterCount = 0;
    for (let offset = 0; offset < byteCount; offset += BASE_K_BLOCK_SIZE) {
        characterCount += BASE_K_DIGIT_COUNTS[
            Math.min(BASE_K_BLOCK_SIZE, byteCount - offset)
        ];
    }
    return characterCount;
}

async function encodeBytes(bytes, onProgress) {
    const alphabetSize = BYTE_ALPHABET.length;
    const blocks = [];
    let blocksSinceYield = 0;
    const blockCount = Math.ceil(bytes.length / BASE_K_BLOCK_SIZE);
    let completedBlocks = 0;
    for (let start = 0; start < bytes.length; start += BASE_K_BLOCK_SIZE) {
        const byteCount = Math.min(BASE_K_BLOCK_SIZE, bytes.length - start);
        const digitCount = BASE_K_DIGIT_COUNTS[byteCount];
        let value = 0;
        for (let i = 0; i < byteCount; i++) {
            value = value * 256 + bytes[start + i];
        }
        const digits = new Array(digitCount);
        for (let i = digitCount - 1; i >= 0; i--) {
            digits[i] = BYTE_ALPHABET[value % alphabetSize];
            value = Math.floor(value / alphabetSize);
        }
        blocks.push(digits.join(''));
        completedBlocks++;
        if (onProgress) {
            onProgress(completedBlocks / blockCount);
        }
        blocksSinceYield++;
        if (blocksSinceYield === 2048) {
            blocksSinceYield = 0;
            await yieldToBrowser();
        }
    }
    return blocks.join('');
}

function supportsZstdEncoding() {
    return typeof zstdCodec !== 'undefined' &&
        zstdCodec && zstdCodec.ZstdSimple &&
        typeof zstdCodec.ZstdSimple.compress === 'function' &&
        typeof zstdCodec.ZstdInit === 'function';
}

function stopActiveZstdWorker(error, unsupported) {
    const worker = activeZstdWorker;
    activeZstdWorker = null;
    zstdWorkerReadyPromise = null;
    if (unsupported) zstdWorkerUnsupported = true;
    if (worker) worker.terminate();
    const initReject = zstdWorkerInitReject;
    zstdWorkerInitReject = null;
    if (initReject) initReject(error);
    const pending = activeZstdCompression;
    activeZstdCompression = null;
    if (pending) pending.reject(error);
}

function getZstdWorker() {
    if (typeof Worker !== 'function' || zstdWorkerUnsupported ||
        typeof location !== 'undefined' && location.protocol === 'file:') {
        return Promise.resolve(null);
    }
    if (zstdWorkerReadyPromise) return zstdWorkerReadyPromise;

    zstdWorkerReadyPromise = new Promise((resolve, reject) => {
        let worker;
        try {
            worker = new Worker(new URL('vendor/zstd-worker.js', document.baseURI));
        } catch (error) {
            zstdWorkerUnsupported = true;
            zstdWorkerReadyPromise = null;
            resolve(null);
            return;
        }
        activeZstdWorker = worker;
        zstdWorkerInitReject = reject;
        worker.onmessage = event => {
            const message = event.data || {};
            if (message.type === 'ready') {
                zstdWorkerInitReject = null;
                resolve(worker);
                return;
            }
            if (message.type === 'progress' && activeZstdCompression &&
                message.id === activeZstdCompression.id) {
                if (activeZstdCompression.onProgress) {
                    activeZstdCompression.onProgress(message.fraction);
                }
                return;
            }
            if (message.type === 'compressed' && activeZstdCompression &&
                message.id === activeZstdCompression.id) {
                const pending = activeZstdCompression;
                activeZstdCompression = null;
                pending.resolve({
                    bytes: new Uint8Array(message.bytes),
                    padding: message.padding
                });
                return;
            }
            if (message.type === 'error') {
                stopActiveZstdWorker(
                    new Error(message.message || 'Zstandard compression failed.'),
                    true
                );
            }
        };
        worker.onerror = event => {
            event.preventDefault();
            stopActiveZstdWorker(
                new Error(event.message || 'The Zstandard worker could not start.'),
                true
            );
        };
        worker.postMessage({ type: 'init' });
    });
    return zstdWorkerReadyPromise.catch(error => {
        stopActiveZstdWorker(error, true);
        return null;
    });
}

async function compressBytesWithZstd(bytes, onProgress) {
    if (!supportsZstdEncoding()) {
        throw new Error('This browser cannot run the DK Zstandard image encoder.');
    }
    await yieldToBrowser();
    let worker = null;
    try {
        worker = await getZstdWorker();
    } catch (error) {
        if (conversionCancelled || error && error.name === 'AbortError') throw error;
    }
    if (conversionCancelled) {
        throw new DOMException('Conversion cancelled.', 'AbortError');
    }
    if (worker) {
        const id = nextZstdRequestId++;
        const transferBuffer = bytes.byteOffset === 0 &&
            bytes.byteLength === bytes.buffer.byteLength
            ? bytes.buffer
            : bytes.slice().buffer;
        return new Promise((resolve, reject) => {
            activeZstdCompression = { id, onProgress, resolve, reject };
            worker.postMessage({ type: 'compress', id, bytes: transferBuffer }, [transferBuffer]);
        });
    }

    if (!zstdMainThreadReadyPromise) {
        zstdMainThreadReadyPromise = zstdCodec.ZstdInit();
    }
    await zstdMainThreadReadyPromise;
    await yieldToBrowser();
    const padding = Math.max(0, 101 - bytes.length);
    const input = padding ? new Uint8Array(bytes.length + padding) : bytes;
    if (padding) input.set(bytes);
    const chunks = [];
    let compressedLength = 0;
    const chunkSize = 4 * 1024 * 1024;
    for (let offset = 0; offset < input.length; offset += chunkSize) {
        await yieldToBrowser();
        const end = Math.min(input.length, offset + chunkSize);
        const compressed = zstdCodec.ZstdSimple.compress(
            input.subarray(offset, end), 19
        );
        chunks.push(compressed);
        compressedLength += compressed.length;
        if (onProgress) onProgress(end / input.length);
    }
    const output = new Uint8Array(compressedLength);
    let outputOffset = 0;
    for (const chunk of chunks) {
        output.set(chunk, outputOffset);
        outputOffset += chunk.length;
    }
    return { bytes: output, padding };
}

function paethPredictor(left, up, upperLeft) {
    const estimate = left + up - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    return leftDistance <= upDistance && leftDistance <= upperLeftDistance
        ? left
        : upDistance <= upperLeftDistance ? up : upperLeft;
}

function concatByteArrays(parts) {
    let total = 0;
    for (const part of parts) {
        total += part.length;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    return bytes;
}

async function filterRGBABytes(rgba, width, height, onProgress) {
    const rowBytes = width * 4;
    const filteredBytes = new Uint8Array(height * (rowBytes + 1));
    const filteredRow = new Uint8Array(rowBytes);
    const rowsPerBatch = 16;
    for (let batchStart = 0; batchStart < height; batchStart += rowsPerBatch) {
        const batchEnd = Math.min(height, batchStart + rowsPerBatch);
        for (let y = batchStart; y < batchEnd; y++) {
            const rowOffset = y * rowBytes;
            const destination = y * (rowBytes + 1);
            let bestScore = Infinity;
            let bestFilter = 0;
            for (let filter = 0; filter <= 4; filter++) {
                let score = 0;
                for (let x = 0; x < rowBytes; x++) {
                    const current = rgba[rowOffset + x];
                    const left = x >= 4 ? rgba[rowOffset + x - 4] : 0;
                    const up = y > 0 ? rgba[rowOffset - rowBytes + x] : 0;
                    const upperLeft = y > 0 && x >= 4
                        ? rgba[rowOffset - rowBytes + x - 4]
                        : 0;
                    const predictor = filter === 1 ? left
                        : filter === 2 ? up
                            : filter === 3 ? Math.floor((left + up) / 2)
                                : filter === 4 ? paethPredictor(left, up, upperLeft)
                                    : 0;
                    const residual = (current - predictor) & 255;
                    filteredRow[x] = residual;
                    score += Math.abs(residual < 128 ? residual : residual - 256);
                }
                if (score < bestScore) {
                    bestScore = score;
                    bestFilter = filter;
                    filteredBytes.set(filteredRow, destination + 1);
                }
            }
            filteredBytes[destination] = bestFilter;
        }
        if (onProgress) onProgress(batchEnd / height);
        await yieldToBrowser();
    }
    return filteredBytes;
}

async function compressRGBAWithZstd(rgba, width, height, onProgress) {
    const filteredBytes = await filterRGBABytes(
        rgba,
        width,
        height,
        fraction => onProgress && onProgress(fraction * 0.3)
    );
    const compressed = await compressBytesWithZstd(
        filteredBytes,
        fraction => onProgress && onProgress(0.3 + fraction * 0.65)
    );
    if (onProgress) onProgress(0.95);
    return compressed;
}

async function encodeZstdFrames(rawFrames, width, height, onProgress) {
    const parts = [];
    const frames = [];
    for (let frameIndex = 0; frameIndex < rawFrames.length; frameIndex++) {
        const filtered = await filterRGBABytes(
            rawFrames[frameIndex],
            width,
            height,
            fraction => onProgress && onProgress(
                0.5 * (frameIndex + fraction) / rawFrames.length
            )
        );
        parts.push(filtered);
        frames.push({
            length: rawFrames[frameIndex].length
        });
    }
    const combined = concatByteArrays(parts);
    const compressed = await compressBytesWithZstd(
        combined,
        fraction => onProgress && onProgress(0.5 + fraction * 0.45)
    );
    const data = await encodeBytes(
        compressed.bytes,
        fraction => onProgress && onProgress(0.95 + fraction * 0.05)
    );
    frames[0].encodedLength = compressed.bytes.length;
    frames[0].baseK = true;
    frames[0].baseKBlockSize = BASE_K_BLOCK_SIZE;
    frames[0].zstd = true;
    frames[0].zstdPadding = compressed.padding;
    frames[0].data = data;
    return frames;
}

async function encodeZstdPaletteFrames(rawFrames, paletteMetadata, onProgress) {
    const combined = concatByteArrays(rawFrames);
    const compressed = await compressBytesWithZstd(
        combined,
        fraction => onProgress && onProgress(0.6 + fraction * 0.3)
    );
    const data = await encodeBytes(
        compressed.bytes,
        fraction => onProgress && onProgress(0.9 + fraction * 0.1)
    );
    return paletteMetadata.map((metadata, frameIndex) => Object.assign({
        length: rawFrames[frameIndex].length,
        encodedLength: frameIndex === 0 ? compressed.bytes.length : 0,
        baseK: true,
        baseKBlockSize: BASE_K_BLOCK_SIZE,
        zstd: true,
        zstdPadding: frameIndex === 0 ? compressed.padding : 0,
        data: frameIndex === 0 ? data : ''
    }, metadata));
}

function yieldToBrowser() {
    const yieldPromise = typeof scheduler !== 'undefined' &&
        typeof scheduler.yield === 'function'
        ? scheduler.yield()
        : new Promise(resolve => setTimeout(resolve, 0));
    return yieldPromise.then(() => {
        if (conversionCancelled) throw new DOMException('Conversion cancelled.', 'AbortError');
    });
}

function updateProgress(percent, status) {
    highestProgress = Math.max(
        highestProgress,
        Math.max(0, Math.min(100, Math.round(percent)))
    );
    const progress = highestProgress;
    const bar = document.getElementById('conversion-progress-bar');
    const container = document.getElementById('conversion-progress');
    const text = document.getElementById('conversion-progress-text');
    const statusText = document.getElementById('loading-status');
    if (bar) bar.style.width = `${progress}%`;
    if (container) container.setAttribute('aria-valuenow', String(progress));
    if (text) text.textContent = `${progress}%`;
    if (statusText && status) {
        pendingProgressStatus = status.replace(
            /(\bframes?\b[^\d]*)(\d+(?:\.\d+)?)(\s*(?:of|\/)\s*\d+)/gi,
            (_, prefix, count, suffix) => `${prefix}${Math.round(Number(count))}${suffix}`
        );
        if (pendingProgressStatus === statusText.textContent) return;
        const now = performance.now();
        const flushStatus = () => {
            statusText.textContent = pendingProgressStatus;
            lastProgressStatusAt = performance.now();
            progressStatusTimer = null;
        };
        if (progress >= 100 || now - lastProgressStatusAt >= PROGRESS_STATUS_INTERVAL_MS) {
            if (progressStatusTimer !== null) {
                clearTimeout(progressStatusTimer);
                progressStatusTimer = null;
            }
            flushStatus();
        } else if (progressStatusTimer === null) {
            progressStatusTimer = setTimeout(
                flushStatus,
                Math.max(0, PROGRESS_STATUS_INTERVAL_MS - (now - lastProgressStatusAt))
            );
        }
    }
}

function updateCount(mediaType) {
    const countElement = document.getElementById('converted-count');
    const count = Number(localStorage.getItem('dk_converted_count') || 0) + 1;
    localStorage.setItem('dk_converted_count', String(count));
    if (countElement) countElement.textContent = String(count);
    const label = mediaType.toLowerCase();
    const description = document.getElementById('converted-description');
    if (description) {
        description.textContent = `${label} ${count === 1 ? 'file' : 'files'} with DK Converter`;
    }
}

function getOutputDimensions(width, height, maxDimension) {
    if (!Number.isFinite(width) || !Number.isFinite(height) ||
        width < 1 || height < 1) {
        throw new Error('The source image has invalid dimensions.');
    }
    const scale = maxDimension === null
        ? 1
        : Math.min(1, maxDimension / Math.max(width, height));
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

async function applyImageQualityToFrames(rawFrames, width, height, quality, onProgress) {
    if (!Number.isSafeInteger(quality) || quality < 0 || quality > 100) {
        throw new Error('Image compression quality must be a whole number from 0 to 100.');
    }
    if (quality === 100) return rawFrames;
    if (typeof createImageBitmap !== 'function') {
        throw new Error('This browser cannot decode the WebP image quality output.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create an image compression canvas.');

    for (let index = 0; index < rawFrames.length; index++) {
        const imageData = context.createImageData(width, height);
        imageData.data.set(rawFrames[index]);
        context.putImageData(imageData, 0, 0);
        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/webp', quality / 100);
        });
        if (!blob) throw new Error('The browser could not compress this image as WebP.');
        if (blob.type.toLowerCase() !== 'image/webp') {
            throw new Error('This browser does not support lossy WebP image compression.');
        }

        const bitmap = await createImageBitmap(blob);
        try {
            context.clearRect(0, 0, width, height);
            context.drawImage(bitmap, 0, 0);
            rawFrames[index].set(context.getImageData(0, 0, width, height).data);
        } finally {
            bitmap.close();
        }
        if (onProgress) onProgress((index + 1) / rawFrames.length);
        await yieldToBrowser();
    }
    return rawFrames;
}

function hasOpaquePixels(rgba) {
    for (let offset = 3; offset < rgba.length; offset += 4) {
        if (rgba[offset] !== 255) return false;
    }
    return true;
}

async function encodeJPEGFrame(rgba, width, height, quality, maxColors, onProgress) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create an image compression canvas.');
    const imageData = context.createImageData(width, height);
    imageData.data.set(rgba);
    context.putImageData(imageData, 0, 0);
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => {
            if (!result) {
                reject(new Error('The browser could not compress this image as JPEG.'));
                return;
            }
            if (result.type.toLowerCase() !== 'image/jpeg') {
                reject(new Error('This browser does not support JPEG image compression.'));
                return;
            }
            resolve(result);
        }, 'image/jpeg', quality / 100);
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const data = await encodeBytes(bytes, onProgress);
    return {
        jpeg: true,
        data,
        byteLength: bytes.length,
        maxColors
    };
}

function getGIFFrameSelection(sourceDelays, maxFrames) {
    const frameCount = sourceDelays.length;
    const stride = maxFrames === null
        ? 1
        : Math.max(1, Math.ceil(frameCount / maxFrames));
    const indices = [];
    const delays = [];
    for (let start = 0; start < frameCount; start += stride) {
        indices.push(start);
        let groupedDelay = 0;
        const groupEnd = Math.min(frameCount, start + stride);
        for (let index = start; index < groupEnd; index++) {
            groupedDelay += sourceDelays[index];
        }
        delays.push(groupedDelay);
    }
    return { stride, indices, delays };
}

const PIXEL_COLOR_ALPHABET = Array.from({ length: 94 }, (_, index) =>
    String.fromCharCode(index + 33)
).filter(character => character !== '.');
const MAX_COLOR_BINS = 1 << 20;
const PIXEL_ART_ALPHABET = Array.from(
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
).concat(
    Array.from({ length: 94 }, (_, index) =>
        String.fromCharCode(index + 33)
    ).filter(character => !/[a-zA-Z0-9-]/.test(character))
);
const PIXEL_TRANSPARENT_SYMBOL = '-';
function getEffectiveMaxColors(width, height, requestedMaxColors, pixelArt) {
    if (requestedMaxColors !== null) {
        return requestedMaxColors;
    }
    const automaticLimit = Math.min(256, Math.max(1, Math.floor(width * height / 500)));
    return pixelArt
        ? Math.min(PIXEL_COLOR_ALPHABET.length, automaticLimit)
        : automaticLimit;
}

function getColorBinKey(red, green, blue, alpha) {
    return ((red >> 3) << 15) |
        ((green >> 3) << 10) |
        ((blue >> 3) << 5) |
        (alpha >> 3);
}

function createColorBoxBounds(minimum, maximum, population) {
    let splitChannel = 0;
    for (let channel = 1; channel < 4; channel++) {
        if (maximum[channel] - minimum[channel] >
            maximum[splitChannel] - minimum[splitChannel]) {
            splitChannel = channel;
        }
    }
    return {
        minimum,
        maximum,
        population,
        splitChannel,
        range: maximum[splitChannel] - minimum[splitChannel]
    };
}

function getColorBoxBounds(colors) {
    const minimum = [255, 255, 255, 255];
    const maximum = [0, 0, 0, 0];
    let population = 0;
    for (const color of colors) {
        population += color.count;
        for (let channel = 0; channel < 4; channel++) {
            if (color[channel] < minimum[channel]) minimum[channel] = color[channel];
            if (color[channel] > maximum[channel]) maximum[channel] = color[channel];
        }
    }
    return createColorBoxBounds(minimum, maximum, population);
}

function splitColorBox(colors, bounds) {
    const buckets = new Array(256).fill(0);
    for (const color of colors) buckets[color[bounds.splitChannel]] += color.count;
    const midpoint = Math.ceil(bounds.population / 2);
    let cumulative = 0;
    let threshold = 0;
    for (; threshold < buckets.length - 1; threshold++) {
        cumulative += buckets[threshold];
        if (cumulative >= midpoint) break;
    }
    let first = [];
    let second = [];
    const firstMinimum = [255, 255, 255, 255];
    const firstMaximum = [0, 0, 0, 0];
    const secondMinimum = [255, 255, 255, 255];
    const secondMaximum = [0, 0, 0, 0];
    let firstPopulation = 0;
    let secondPopulation = 0;
    for (const color of colors) {
        const goesFirst = color[bounds.splitChannel] <= threshold;
        const target = goesFirst ? first : second;
        const minimum = goesFirst ? firstMinimum : secondMinimum;
        const maximum = goesFirst ? firstMaximum : secondMaximum;
        target.push(color);
        if (goesFirst) firstPopulation += color.count;
        else secondPopulation += color.count;
        for (let channel = 0; channel < 4; channel++) {
            if (color[channel] < minimum[channel]) minimum[channel] = color[channel];
            if (color[channel] > maximum[channel]) maximum[channel] = color[channel];
        }
    }
    if (!first.length || !second.length) {
        const sorted = colors.slice().sort((left, right) =>
            left[bounds.splitChannel] - right[bounds.splitChannel]);
        first = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));
        second = sorted.slice(first.length);
        return [
            { colors: first, bounds: getColorBoxBounds(first) },
            { colors: second, bounds: getColorBoxBounds(second) }
        ];
    }
    return [
        {
            colors: first,
            bounds: createColorBoxBounds(firstMinimum, firstMaximum, firstPopulation)
        },
        {
            colors: second,
            bounds: createColorBoxBounds(secondMinimum, secondMaximum, secondPopulation)
        }
    ];
}

async function createPaletteFromColors(colors, maxColors, onProgress) {
    if (!colors.length) return { palette: [], colorIndexes: new Map() };
    if (colors.length <= maxColors) {
        const palette = [];
        const colorIndexes = new Map();
        for (let index = 0; index < colors.length; index++) {
            const color = colors[index];
            palette.push([color[0], color[1], color[2], color[3]]);
            colorIndexes.set(color.key, index);
            if (index > 0 && index % 4096 === 0) {
                if (onProgress) {
                    onProgress(0.8 + 0.1 * index / colors.length);
                }
                await yieldToBrowser();
            }
        }
        if (onProgress) onProgress(0.9);
        return { palette, colorIndexes };
    }
    const createColorBox = (boxColors, bounds = getColorBoxBounds(boxColors)) => {
        return {
            colors: boxColors,
            bounds,
            score: bounds.range * Math.log2(bounds.population + 1)
        };
    };
    const boxes = [createColorBox(colors)];
    let splitsSinceYield = 0;
    while (boxes.length < maxColors) {
        let splitIndex = -1;
        let splitScore = -1;
        for (let index = 0; index < boxes.length; index++) {
            if (boxes[index].colors.length < 2) continue;
            if (boxes[index].score > splitScore) {
                splitScore = boxes[index].score;
                splitIndex = index;
            }
        }
        if (splitIndex < 0) break;
        const target = boxes.splice(splitIndex, 1)[0];
        const halves = splitColorBox(target.colors, target.bounds);
        boxes.push(
            createColorBox(halves[0].colors, halves[0].bounds),
            createColorBox(halves[1].colors, halves[1].bounds)
        );
        splitsSinceYield++;
        if (splitsSinceYield === 8) {
            splitsSinceYield = 0;
            if (onProgress) {
                onProgress(0.4 + 0.2 * boxes.length / maxColors);
            }
            await yieldToBrowser();
        }
    }

    const palette = [];
    const colorIndexes = new Map();
    let processedColors = 0;
    for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index].colors;
        let count = 0;
        const sum = [0, 0, 0, 0];
        for (const color of box) {
            count += color.count;
            for (let channel = 0; channel < 4; channel++) {
                sum[channel] += color[channel] * color.count;
            }
            colorIndexes.set(color.key, index);
            processedColors++;
            if (processedColors % 8192 === 0) {
                if (onProgress) {
                    onProgress(0.8 + 0.1 * processedColors / colors.length);
                }
                await yieldToBrowser();
            }
        }
        palette.push(sum.map(value => Math.round(value / count)));
    }
    if (onProgress) onProgress(0.9);
    return { palette, colorIndexes };
    }

async function createPaletteFromRGBA(rgba, width, height, maxColors, onProgress) {
    const histogram = new Map();
    let pixelsProcessed = 0;
    for (let y = 0; y < height; y++) {
        const rowOffset = y * width * 4;
        for (let x = 0; x < width; x++) {
            const offset = rowOffset + x * 4;
            pixelsProcessed++;
            if (pixelsProcessed % 65536 === 0) {
                if (onProgress) {
                    onProgress(0.4 * pixelsProcessed / (width * height));
                }
                await yieldToBrowser();
            }
            if (rgba[offset + 3] === 0) continue;
            const key = getColorBinKey(
                rgba[offset],
                rgba[offset + 1],
                rgba[offset + 2],
                rgba[offset + 3]
            );
            let color = histogram.get(key);
            if (!color) {
                color = {
                    key,
                    0: 0,
                    1: 0,
                    2: 0,
                    3: 0,
                    count: 0
                };
                histogram.set(key, color);
            }
            color[0] += rgba[offset];
            color[1] += rgba[offset + 1];
            color[2] += rgba[offset + 2];
            color[3] += rgba[offset + 3];
            color.count++;
        }
    }
    if (onProgress) onProgress(0.4);
    const colors = [];
    let processedColors = 0;
    for (const entry of histogram.values()) {
        colors.push({
            key: entry.key,
            0: Math.round(entry[0] / entry.count),
            1: Math.round(entry[1] / entry.count),
            2: Math.round(entry[2] / entry.count),
            3: Math.round(entry[3] / entry.count),
            count: entry.count
        });
        processedColors++;
        if (processedColors % 16384 === 0) {
            if (onProgress) {
                onProgress(0.4 + 0.4 * processedColors / histogram.size);
            }
            await yieldToBrowser();
        }
    }
    if (onProgress) onProgress(0.8);
    const paletteLimit = Math.min(MAX_COLOR_BINS, Math.max(1, maxColors));
    return createPaletteFromColors(colors, paletteLimit, onProgress);
}

function addRGBAToPaletteHistogram(rgba, histogram) {
    let hasTransparency = false;
    for (let offset = 0; offset < rgba.length; offset += 4) {
        if (rgba[offset + 3] === 0) {
            hasTransparency = true;
            continue;
        }
        const key = getColorBinKey(
            rgba[offset],
            rgba[offset + 1],
            rgba[offset + 2],
            rgba[offset + 3]
        );
        let color = histogram.get(key);
        if (!color) {
            color = {
                key,
                0: 0,
                1: 0,
                2: 0,
                3: 0,
                count: 0
            };
            histogram.set(key, color);
        }
        color[0] += rgba[offset];
        color[1] += rgba[offset + 1];
        color[2] += rgba[offset + 2];
        color[3] += rgba[offset + 3];
        color.count++;
    }
    return hasTransparency;
}

function deltaPackedBytes(current, previous) {
    const delta = new Uint8Array(current.length);
    for (let index = 0; index < current.length; index++) {
        delta[index] = (current[index] - previous[index] + 256) % 256;
    }
    return delta;
}

function packFramePaletteIndexes(rgba, width, height, colorIndexes, transparentIndex, bitDepth) {
    const packed = new Uint8Array(Math.ceil(width * height * bitDepth / 8));
    let packedIndex = 0;
    let bitBuffer = 0;
    let bufferedBits = 0;
    for (let pixel = 0; pixel < width * height; pixel++) {
        const offset = pixel * 4;
        const paletteIndex = rgba[offset + 3] === 0
            ? transparentIndex
            : colorIndexes.get(getColorBinKey(
                rgba[offset],
                rgba[offset + 1],
                rgba[offset + 2],
                rgba[offset + 3]
            ));
        bitBuffer = (bitBuffer << bitDepth) | paletteIndex;
        bufferedBits += bitDepth;
        while (bufferedBits >= 8) {
            bufferedBits -= 8;
            packed[packedIndex] = (bitBuffer >> bufferedBits) & 255;
            packedIndex++;
            bitBuffer &= (1 << bufferedBits) - 1;
        }
    }
    if (bufferedBits > 0) {
        packed[packedIndex] = bitBuffer << (8 - bufferedBits);
    }
    return packed;
}

async function encodeColorLimitedFrames(rawFrames, width, height, maxColors, onProgress) {
    const histogram = new Map();
    let hasTransparency = false;
    const pixelCount = width * height;
    for (let index = 0; index < rawFrames.length; index++) {
        if (addRGBAToPaletteHistogram(rawFrames[index], histogram)) {
            hasTransparency = true;
        }
        if (onProgress) {
            onProgress((index + 1) / rawFrames.length * 0.35);
        }
        if (index % 2 === 1) await yieldToBrowser();
    }
    const colors = [];
    for (const entry of histogram.values()) {
        colors.push({
            key: entry.key,
            0: Math.round(entry[0] / entry.count),
            1: Math.round(entry[1] / entry.count),
            2: Math.round(entry[2] / entry.count),
            3: Math.round(entry[3] / entry.count),
            count: entry.count
        });
    }
    const result = await createPaletteFromColors(
        colors,
        Math.min(MAX_COLOR_BINS, Math.max(1, maxColors)),
        fraction => onProgress && onProgress(0.35 + fraction * 0.2)
    );
    const transparentIndex = hasTransparency ? result.palette.length : -1;
    const symbolCount = result.palette.length + (hasTransparency ? 1 : 0);
    const bitDepth = Math.max(1, Math.ceil(Math.log2(Math.max(2, symbolCount))));
    const sharePalette = rawFrames.length > 1;
    const packedFrames = [];
    const paletteMetadata = [];
    let previousPacked = null;
    for (let index = 0; index < rawFrames.length; index++) {
        const packed = packFramePaletteIndexes(
            rawFrames[index],
            width,
            height,
            result.colorIndexes,
            transparentIndex,
            bitDepth
        );
        const embedPalette = !sharePalette || index === 0;
        const metadata = {
            paletteLength: result.palette.length,
            bitDepth,
            transparentIndex
        };
        let payloadPacked = packed;
        if (sharePalette && previousPacked) {
            payloadPacked = deltaPackedBytes(packed, previousPacked);
            metadata.deltaFromPrevious = true;
        }
        previousPacked = packed;
        let payload = payloadPacked;
        if (embedPalette) {
            payload = new Uint8Array(result.palette.length * 4 + payloadPacked.length);
            let payloadOffset = 0;
            for (const color of result.palette) {
                for (let channel = 0; channel < 4; channel++) {
                    payload[payloadOffset] = color[channel];
                    payloadOffset++;
                }
            }
            payload.set(payloadPacked, payloadOffset);
        } else {
            metadata.embedPalette = false;
        }
        packedFrames.push(payload);
        paletteMetadata.push(metadata);
        if (onProgress) {
            onProgress(0.55 + (index + 1) / rawFrames.length * 0.15);
        }
        if (pixelCount > 65536 || index % 2 === 1) await yieldToBrowser();
    }
    return encodeZstdPaletteFrames(
        packedFrames,
        paletteMetadata,
        fraction => onProgress && onProgress(fraction)
    );
}

async function encodePixelArtFrame(rgba, width, height, maxColors, onProgress) {
    const result = await createPaletteFromRGBA(
        rgba,
        width,
        height,
        maxColors,
        fraction => {
            if (onProgress) {
                onProgress(fraction * (0.6 / 0.9));
            }
        }
    );
    const rows = [];
    let pixelsProcessed = 0;
    for (let y = 0; y < height; y++) {
        let row = '';
        const rowOffset = y * width * 4;
        for (let x = 0; x < width; x++) {
            const offset = rowOffset + x * 4;
            if (rgba[offset + 3] === 0) {
                row += PIXEL_TRANSPARENT_SYMBOL;
            } else {
                const key = getColorBinKey(
                    rgba[offset],
                    rgba[offset + 1],
                    rgba[offset + 2],
                    rgba[offset + 3]
                );
                row += PIXEL_ART_ALPHABET[result.colorIndexes.get(key)];
            }
            pixelsProcessed++;
            if (pixelsProcessed % 16384 === 0) {
                if (onProgress) {
                    onProgress(0.6 + 0.4 * pixelsProcessed / (width * height));
                }
                await yieldToBrowser();
            }
        }
        rows.push(row);
    }
    if (onProgress) onProgress(1);
    return { palette: result.palette, rows };
}

async function encodePixelArtFrames(rawFrames, width, height, maxColors, onProgress) {
    const frames = [];
    for (let index = 0; index < rawFrames.length; index++) {
        const frame = await encodePixelArtFrame(
            rawFrames[index],
            width,
            height,
            maxColors,
            fraction => {
                if (onProgress) {
                    onProgress((index + fraction) / rawFrames.length, rawFrames.length);
                }
            }
        );
        frames.push(frame);
        if (onProgress) onProgress((index + 1) / rawFrames.length, rawFrames.length);
        await yieldToBrowser();
    }
    return frames;
}

async function wrapPixelArtCode(width, height, frames, isGIF, maxColors, imageQuality, onProgress) {
    const prefix = isGIF ? 'drawGIF' : 'drawImage';
    if (generatedFunctionNames.size >= 900) {
        throw new Error('Generated all available three-digit image function names. Reload the converter to continue.');
    }
    let suffix;
    do {
        suffix = String(Math.floor(Math.random() * 900) + 100);
    } while (generatedFunctionNames.has(suffix));
    generatedFunctionNames.add(suffix);
    const functionName = prefix + suffix;
    const totalItems = frames.reduce((total, frame) =>
        total + frame.rows.length + frame.palette.length + 1, 0);
    let completedItems = 0;
    let itemsSinceYield = 0;
    const serializedFrames = [];
    for (const frame of frames) {
        const rows = [];
        for (const row of frame.rows) {
            rows.push(`                    ${JSON.stringify(row)}`);
            completedItems++;
            itemsSinceYield++;
            if (onProgress) onProgress(completedItems / totalItems);
            if (itemsSinceYield === 64) {
                itemsSinceYield = 0;
                await yieldToBrowser();
            }
        }
        const colors = [];
        for (let index = 0; index < frame.palette.length; index++) {
            const color = frame.palette[index];
            colors.push(
                `                    ${JSON.stringify(PIXEL_ART_ALPHABET[index])}: color(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`
            );
            completedItems++;
            itemsSinceYield++;
            if (onProgress) onProgress(completedItems / totalItems);
            if (itemsSinceYield === 64) {
                itemsSinceYield = 0;
                await yieldToBrowser();
            }
        }
        const serializedRows = rows.join(',\n');
        const colorMap = colors.join(',\n');
        const properties = [
            `                canvasData: [\n${serializedRows}\n                ]`,
            `                colorMap: {\n${colorMap}\n                }`
        ];
        if (frame.delay !== undefined) {
            properties.push(`                delay: ${frame.delay}`);
        }
        serializedFrames.push(`            {\n${properties.join(',\n')}\n            }`);
        completedItems++;
        if (onProgress) onProgress(completedItems / totalItems);
    }
    const encodedFrames = serializedFrames.join(',\n');
    const usage = isGIF
        ? `draw = function() {\n    ${functionName}(0, 0, 1, frameCount);\n};`
        : `${functionName}(0, 0, 1, 0);`;
    const qualityDescription = imageQuality === 100
        ? 'lossless source quality'
        : `lossy WebP quality ${imageQuality}/100`;
    return `/* Pixel-art image data: ${width}x${height}; up to ${maxColors} colors; ${qualityDescription} */\n` +
        `function ${functionName}(x, y, size, frame) {\n` +
        `    if (!${functionName}.createData) {\n` +
        `        ${functionName}.createData = {\n` +
        `            k: "DKP2",\n` +
        `            width: ${width},\n` +
        `            height: ${height},\n` +
        `            frames: [\n${encodedFrames}\n            ]\n` +
        `        };\n` +
        `    }\n` +
        `    drawReadablePixelArt(x, y, size, ${functionName}.createData, frame);\n` +
        `}\n\n` +
        `/* Example usage:\n${usage}\n*/`;
}

function stringifyAsJoinedLiterals(text, chunkSize) {
    const size = chunkSize || 400;
    const chunks = [];
    for (let offset = 0; offset < text.length; offset += size) {
        chunks.push(JSON.stringify(text.slice(offset, offset + size)));
    }
    return chunks.length ? chunks.join(' +\n            ') : '""';
}

function serializeEncodedValue(value) {
    return JSON.stringify(value);
}

function wrapJPEGResultCode(width, height, frame, imageQuality, maxColors) {
    if (!frame || frame.jpeg !== true ||
        !Number.isSafeInteger(frame.byteLength) || frame.byteLength <= 0 ||
        typeof frame.data !== 'string' ||
        frame.data.length !== getBaseKCharacterCount(frame.byteLength)) {
        throw new Error('Encoded JPEG image has invalid data.');
    }
    if (generatedFunctionNames.size >= 900) {
        throw new Error('Generated all available three-digit image function names. Reload the converter to continue.');
    }
    let suffix;
    do {
        suffix = String(Math.floor(Math.random() * 900) + 100);
    } while (generatedFunctionNames.has(suffix));
    generatedFunctionNames.add(suffix);
    const functionName = `drawImage${suffix}`;
    const data = {
        w: width,
        h: height,
        n: frame.byteLength,
        s: frame.data
    };
    if (maxColors !== null) {
        if (!Number.isSafeInteger(maxColors) ||
            maxColors < 1 || maxColors > MAX_COLOR_BINS) {
            throw new Error('JPEG image has an invalid maximum-color limit.');
        }
        data.c = maxColors;
    }
    return `/* DK Converter JPEG image data: ${width}x${height}; quality ${imageQuality}/100; ${frame.byteLength} JPEG bytes${maxColors === null ? '' : `; maximum ${maxColors} colors`} */\n` +
        `function ${functionName}(x, y, size, frame) {\n` +
        `    if (!${functionName}.createData) {\n` +
        `        ${functionName}.createData = ${serializeEncodedValue(data)};\n` +
        `    }\n` +
        `    drawJPEGImage(x, y, size, ${functionName}.createData);\n` +
        `}\n\n` +
        `/* Example usage:\n${functionName}(0, 0, 1, 0);\n*/`;
}

async function wrapResultCode(
    width,
    height,
    frames,
    mediaType,
    payloadCharacters,
    rawBytes,
    maxColors,
    audioBase64,
    onProgress,
    playbackRate,
    imageQuality
) {
    const payloadFrame = frames[0];
    if (!payloadFrame || payloadFrame.zstd !== true) {
        throw new Error('DK output must use Zstandard.');
    }
    frames.forEach((frame, index) => {
        const hasPalette = Number.isSafeInteger(frame.paletteLength);
        const packedLength = Number.isSafeInteger(frame.bitDepth)
            ? Math.ceil(width * height * frame.bitDepth / 8)
            : 0;
        const expectedLength = hasPalette
            ? (frame.embedPalette === false ? 0 : frame.paletteLength * 4) +
                packedLength
            : width * height * 4;
        if ((maxColors === null) === hasPalette ||
            frame.length !== expectedLength) {
            throw new Error(`Encoded frame ${index + 1} has invalid DK payload length.`);
        }
        if (hasPalette &&
            (!Number.isSafeInteger(frame.paletteLength) ||
                frame.paletteLength < 0 ||
                !Number.isSafeInteger(frame.bitDepth) ||
                frame.bitDepth < 1 || frame.bitDepth > 21 ||
                frame.paletteLength > MAX_COLOR_BINS ||
                frame.paletteLength > maxColors ||
                !Number.isSafeInteger(frame.transparentIndex) ||
                frame.transparentIndex < -1 ||
                frame.transparentIndex !== -1 &&
                    frame.transparentIndex !== frame.paletteLength ||
                Math.pow(2, frame.bitDepth) <
                    frame.paletteLength +
                        (frame.transparentIndex === frame.paletteLength ? 1 : 0))) {
            throw new Error(`Encoded frame ${index + 1} has invalid color-index metadata.`);
        }
        if (index > 0 && frame.data) {
            throw new Error('DK frames must share one compressed payload.');
        }
    });
    const expectedCharacterCount = Number.isSafeInteger(payloadFrame.encodedLength) &&
        payloadFrame.encodedLength > 0
        ? getBaseKCharacterCount(payloadFrame.encodedLength)
        : null;
    if (!Number.isSafeInteger(payloadFrame.encodedLength) ||
        payloadFrame.encodedLength <= 0 ||
        !Number.isSafeInteger(payloadFrame.zstdPadding) ||
        payloadFrame.zstdPadding < 0 || payloadFrame.zstdPadding > 100 ||
        payloadFrame.baseK !== true ||
        payloadFrame.baseKBlockSize !== BASE_K_BLOCK_SIZE ||
        typeof payloadFrame.data !== 'string' ||
        payloadFrame.data.length !== expectedCharacterCount) {
        throw new Error('Encoded DK Zstandard payload has invalid metadata.');
    }
    if (generatedFunctionNames.size >= 900) {
        throw new Error('Generated all available three-digit image function names. Reload the converter to continue.');
    }
    const isAnimation = mediaType !== 'image';
    const prefix = mediaType === 'video'
        ? 'drawVideo'
        : isAnimation ? 'drawGIF' : 'drawImage';
    let suffix;
    do {
        suffix = String(Math.floor(Math.random() * 900) + 100);
    } while (generatedFunctionNames.has(suffix));
    generatedFunctionNames.add(suffix);
    const funcName = prefix + suffix;
    const audioFunctionName = `play${funcName.slice(4)}Audio`;
    const startFunctionName = `start${funcName.slice(4)}`;
    const videoStartFrameName = `${funcName}StartFrame`;
    const outputFormat = maxColors === null ? 'DKL' : 'DKC5';
    const rendererName = maxColors === null ? 'drawLosslessImage' : 'drawColorImage';
    const mediaDataGetterName = `get${funcName}Data`;
    const extraProperties = audioBase64
        ? `,audio:${serializeAudioPayload(audioBase64)}`
        : '';
    const properties = [
        `k:${JSON.stringify(outputFormat)}`,
        `w:${width}`,
        `h:${height}`
    ];
    if (Number.isSafeInteger(frames[0].paletteLength)) {
        properties.push(`c:${frames[0].paletteLength}`);
        properties.push(`b:${frames[0].bitDepth}`);
        properties.push(`i:${frames[0].transparentIndex}`);
    }
    if (frames.length > 1) {
        properties.push(`q:${frames.length}`);
    }
    if (payloadFrame.zstdPadding) {
        properties.push(`p:${payloadFrame.zstdPadding}`);
    }
    properties.push(`s:${JSON.stringify(payloadFrame.data)}`);
    const delays = frames.map(frame => frame.delay);
    const hasDelay = delays.some(delay => Number.isFinite(delay));
    if (hasDelay) {
        const sameDelay = delays.every(delay => delay === delays[0]);
        properties.push(sameDelay
            ? `t:${delays[0]}`
            : `t:[${delays.join(',')}]`);
    }
    if (onProgress) onProgress(1);
    const objectLiteral = `{${properties.join(',')}${extraProperties}}`;
    let mediaDataGetterCode = '';
    let frameDataInitialization = '';
    if (mediaType === 'video') {
        mediaDataGetterCode =
            `function ${mediaDataGetterName}() {\n` +
            `    if (!${mediaDataGetterName}.loaded) {\n` +
            `        /* jshint ignore:start */\n` +
            `        ${mediaDataGetterName}.loaded = ${objectLiteral};\n` +
            `        /* jshint ignore:end */\n` +
            `    }\n` +
            `    return ${mediaDataGetterName}.loaded;\n` +
            `}\n\n`;
        frameDataInitialization = `${funcName}.createData = ${mediaDataGetterName}();`;
    } else {
        frameDataInitialization =
            `/* jshint ignore:start */\n` +
            `        ${funcName}.createData = ${objectLiteral};\n` +
            `        /* jshint ignore:end */`;
    }
    const usage = mediaType === 'video' && audioBase64
        ? `var ${videoStartFrameName} = null;\n\nfunction ${startFunctionName}() {\n    ${videoStartFrameName} = null;\n    ${audioFunctionName}(1, function() {\n        ${videoStartFrameName} = frameCount;\n    });\n}\n\ndraw = function() {\n    ${funcName}(0, 0, 1, ${videoStartFrameName} === null ? 0 : frameCount - ${videoStartFrameName});\n};\n\nmouseClicked = function() {\n    ${startFunctionName}();\n};`
        : isAnimation
            ? `// For animation:\ndraw = function() {\n    ${funcName}(0, 0, 1, frameCount);\n};`
        : `${funcName}(0, 0, 1, 0);`;
    const qualityDescription = imageQuality === 100
        ? 'lossless source quality'
        : `lossy WebP quality ${imageQuality}/100`;
    const imageDescription = maxColors === null
        ? `DK Converter ${mediaType} data (${qualityDescription})`
        : `Color-limited DK Converter ${mediaType} data (maximum ${maxColors} colors; ${qualityDescription})`;
    const hasSharedPalette = frames.some(frame => frame.embedPalette === false);
    const payloadDescription = maxColors === null
        ? 'RGBA bytes'
        : hasSharedPalette
            ? 'shared palette on the first frame, later frames store packed-index deltas vs the previous frame'
            : 'embedded palette RGBA bytes and packed palette-index bytes';
    const playbackRateArg = playbackRate && playbackRate !== 1
        ? `, ${playbackRate}`
        : '';
    const audioCode = audioBase64
        ? `\n\nfunction ${audioFunctionName}(volume, afterStart) {\n` +
            `    dkPlayAudio(${JSON.stringify(funcName)}, ${mediaDataGetterName}().audio, volume, afterStart${playbackRateArg});\n` +
            `}`
        : '';
    return `/*\n${imageDescription}: ${width}x${height}, ${frames.length} frame(s)\n${payloadDescription}: ${rawBytes}; encoded data characters: ${payloadCharacters}\n*/\n` +
        mediaDataGetterCode +
        `function ${funcName}(x, y, size, frame) {\n` +
        `    if (!${funcName}.createData) {\n` +
        `        ${frameDataInitialization}\n` +
        `    }\n` +
        `    ${rendererName}(x, y, size, ${funcName}.createData, frame);\n` +
        `}${audioCode}\n\n` +
        `/*// Example usage:\n${usage}` +
        (audioBase64
            ? `\n// Click the canvas to start synchronized video and audio playback.`
            : '') +
        `\n*/`;
}

function updateUtilityCode(pixelArt, colorLimited) {
    fullUtilityCode = getImageUtilityCode(pixelArt, colorLimited);
    updateUtilityCodeDisplay();
}

function updateUtilityCodeDisplay() {
    const utilityOutput = document.getElementById('utilityOutput');
    utilityOutput.textContent = createCodePreview(fullUtilityCode);
    utilityOutput.classList.add('code-preview');
    const utilityCharacterCount = document.getElementById('utilityCharacterCount');
    if (utilityCharacterCount) {
        utilityCharacterCount.textContent =
            `${fullUtilityCode.length.toLocaleString()} characters`;
    }
}

async function finishConversion(
    width,
    height,
    frames,
    mediaType,
    pixelArt,
    maxColors,
    audioBase64,
    playbackRate,
    imageQuality
) {
    let payloadCharacters = 0;
    let outputCode;
    const jpegFrame = frames[0] && frames[0].jpeg === true
        ? frames[0]
        : null;
    const codeBuildStart = mediaType === 'video' ? 92 : 86;
    const codeBuildRange = 99 - codeBuildStart;
    updateProgress(codeBuildStart, 'Preparing generated code...');
    await yieldToBrowser();
    if (jpegFrame) {
        payloadCharacters = jpegFrame.data.length;
        outputCode = wrapJPEGResultCode(
            width,
            height,
            jpegFrame,
            imageQuality,
            maxColors
        );
        document.getElementById('rectCount').textContent =
            `${(width * height).toLocaleString()} pixels encoded | ${outputCode.length.toLocaleString()} characters | ${width.toLocaleString()} x ${height.toLocaleString()} px`;
    } else if (pixelArt) {
        payloadCharacters = frames.reduce((total, frame) =>
            total + frame.rows.reduce((rowTotal, row) => rowTotal + row.length, 0), 0);
        outputCode = await wrapPixelArtCode(
            width,
            height,
            frames,
            mediaType !== 'image',
            maxColors,
            imageQuality,
            fraction => updateProgress(
                codeBuildStart + fraction * codeBuildRange,
                'Building editable output code...'
            )
        );
        const usedColors = frames.reduce((maximum, frame) =>
            Math.max(maximum, frame.palette.length), 0);
        document.getElementById('rectCount').textContent =
            `${(width * height * frames.length).toLocaleString()} pixels encoded | ${outputCode.length.toLocaleString()} characters | ${width.toLocaleString()} x ${height.toLocaleString()} px | ${usedColors.toLocaleString()} colors`;
    } else {
        payloadCharacters = frames[0] && frames[0].data ? frames[0].data.length : 0;
        const rawBytes = frames.reduce((total, frame) => total + frame.length, 0);
        outputCode = await wrapResultCode(
            width,
            height,
            frames,
            mediaType,
            payloadCharacters,
            rawBytes,
            maxColors,
            audioBase64,
            fraction => updateProgress(
                codeBuildStart + fraction * codeBuildRange,
                'Building generated output code...'
            ),
            playbackRate,
            imageQuality
        );
        const maximumPaletteLength = frames.reduce(
            (maximum, frame) => Number.isFinite(frame.paletteLength)
                ? Math.max(maximum, frame.paletteLength)
                : maximum,
            0
        );
        const sharedPalette = frames.some(frame => frame.embedPalette === false);
        const colorSummary = maximumPaletteLength
            ? sharedPalette
                ? ` | ${maximumPaletteLength.toLocaleString()} shared colors`
                : ` | up to ${maximumPaletteLength.toLocaleString()} colors per frame`
            : '';
        document.getElementById('rectCount').textContent =
            `${(width * height * frames.length).toLocaleString()} pixels encoded | ${outputCode.length.toLocaleString()} characters | ${width.toLocaleString()} x ${height.toLocaleString()} px${colorSummary}`;
    }
    updateProgress(99, 'Preparing the code preview...');
    await yieldToBrowser();
    outputCode = simplifyGeneratedFunctionNames(outputCode);
    fullImageCode = outputCode;
    const needsUniversalUtility = mediaType === 'audio' ||
        mediaType === 'video' && audioBase64;
    fullImageUtilityCode = needsUniversalUtility
        ? fullUtilityTemplate
        : jpegFrame
            ? getJPEGUtilityCode(maxColors !== null)
            : getImageUtilityCode(pixelArt, maxColors !== null);
    fullImageUtilityCode = simplifyGeneratedFunctionNames(fullImageUtilityCode);
    fullUtilityCode = fullImageUtilityCode;
    document.getElementById('copy-all-button').disabled = false;
    updateUtilityCodeDisplay();
    const imageOutput = document.getElementById('jsOutput');
    imageOutput.textContent = createCodePreview(outputCode);
    imageOutput.classList.add('code-preview');
    document.getElementById('result-section').style.display = 'block';
    const qualitySummary = imageQuality < 100
        ? ` (lossy ${jpegFrame ? 'JPEG' : 'WebP'} quality ${imageQuality})`
        : '';
    const outputMode = pixelArt
        ? `Pixel-art${qualitySummary}`
        : jpegFrame
            ? `Lossy JPEG quality ${imageQuality}${maxColors === null ? '' : ` + ${maxColors.toLocaleString()}-color cap`}`
        : maxColors !== null
            ? `Color-limited${qualitySummary}`
            : imageQuality < 100
                ? `Lossy WebP quality ${imageQuality}`
                : 'Lossless';
    document.getElementById('success').textContent =
        `${outputMode} ${mediaType} processed (${frames.length} frame${frames.length === 1 ? '' : 's'}); ${payloadCharacters.toLocaleString()} frame-data characters.${audioBase64 ? ` Embedded ${audioBase64.data.length.toLocaleString()} MP3 characters; click the canvas to start synchronized video and audio.` : ''}`;
    document.getElementById('success').style.display = 'block';
    updateProgress(100, 'Conversion complete.');
    const mediaLabel = { image: 'Image', GIF: 'GIF', video: 'Video' }[mediaType] || mediaType;
    document.getElementById('result-section').querySelector('h2').textContent =
        `Generated ${mediaLabel} Code`;
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('generate-button').disabled = false;
    document.getElementById('cancel-conversion-button').hidden = true;
    activeConversionController = null;
    activeFFmpegRuntime = null;
    document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateCount(mediaType);
}

async function readImage(file, maxDimension) {
    const url = URL.createObjectURL(file);
    try {
        const image = await new Promise((resolve, reject) => {
            const loadedImage = new Image();
            loadedImage.onload = () => resolve(loadedImage);
            loadedImage.onerror = () => reject(new Error('The source image could not be decoded.'));
            loadedImage.src = url;
        });
        const dimensions = getOutputDimensions(image.naturalWidth, image.naturalHeight, maxDimension);
        const canvas = document.createElement('canvas');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not create an image canvas.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height, rgba: context.getImageData(0, 0, canvas.width, canvas.height).data };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function readVideoMetadata(file) {
    const url = URL.createObjectURL(file);
    try {
        return await new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                if (video.videoWidth > 0 && video.videoHeight > 0 &&
                    Number.isFinite(video.duration) && video.duration > 0) {
                    resolve({
                        width: video.videoWidth,
                        height: video.videoHeight,
                        duration: video.duration
                    });
                    return;
                }
                reject(new Error('The video has invalid dimensions or duration metadata.'));
            };
            video.onerror = () => reject(new Error('The video metadata could not be read by the browser.'));
            video.src = url;
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function readMediaDurationSeconds(file) {
    const type = (file.type || '').toLowerCase();
    if (type.startsWith('video/') ||
        /\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/i.test(file.name)) {
        return (await readVideoMetadata(file)).duration;
    }
    if (type === 'image/gif' || /\.gif$/i.test(file.name)) {
        const reader = new GifReader(new Uint8Array(await file.arrayBuffer()));
        let durationHundredths = 0;
        for (let index = 0; index < reader.numFrames(); index++) {
            durationHundredths += Math.max(1, reader.frameInfo(index).delay || 10);
        }
        return durationHundredths / 100;
    }
    throw new Error('Choose a video or GIF before selecting an FPS preset.');
}

const FFMPEG_WORKER_URL =
    'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js';
const FFMPEG_MODULE_URL =
    'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
const FFMPEG_CORE_URL =
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js';
const FFMPEG_WASM_URL =
    'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm';
let ffmpegRuntimePromise = null;
let ffmpegObjectUrls = [];

async function downloadFFmpegAsset(url, contentType, onProgress) {
    const response = await fetch(url, { signal: activeConversionController?.signal });
    if (!response.ok || !response.body) {
        throw new Error(`Could not download FFmpeg asset (${response.status}).`);
    }
    const totalLength = response.headers.get('content-encoding')
        ? 0
        : Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const chunks = [];
    let receivedLength = 0;
    while (true) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
        receivedLength += result.value.length;
        if (onProgress) {
            onProgress(totalLength
                ? Math.min(1, receivedLength / totalLength)
                : Math.min(0.9, 1 - Math.exp(-receivedLength / (24 * 1024 * 1024))));
        }
    }
    if (activeConversionController?.signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
    if (onProgress) onProgress(1);
    const objectUrl = URL.createObjectURL(new Blob(chunks, { type: contentType }));
    ffmpegObjectUrls.push(objectUrl);
    return objectUrl;
}

async function getFFmpegRuntime() {
    if (!ffmpegRuntimePromise) {
        ffmpegRuntimePromise = (async () => {
            const ffmpegModule = await import(FFMPEG_MODULE_URL);
            const workerUrl = URL.createObjectURL(new Blob(
                [`import ${JSON.stringify(FFMPEG_WORKER_URL)};`],
                { type: 'text/javascript' }
            ));
            ffmpegObjectUrls.push(workerUrl);
            updateProgress(5, 'Downloading FFmpeg video engine (first use only)...');
            const wasmUrl = await downloadFFmpegAsset(
                FFMPEG_WASM_URL,
                'application/wasm',
                fraction => updateProgress(
                    5 + fraction * 21,
                    `Downloading FFmpeg WebAssembly engine (${Math.round(fraction * 100)}%)...`
                )
            );
            const coreUrl = await downloadFFmpegAsset(
                FFMPEG_CORE_URL,
                'text/javascript',
                fraction => updateProgress(
                    26 + fraction * 3,
                    `Downloading FFmpeg loader (${Math.round(fraction * 100)}%)...`
                )
            );
            updateProgress(30, 'Initializing the FFmpeg video engine...');
            const ffmpeg = new ffmpegModule.FFmpeg();
            activeFFmpegRuntime = ffmpeg;
            const initializationStarted = Date.now();
            const initializationTimer = setInterval(() => {
                const elapsedSeconds = (Date.now() - initializationStarted) / 1000;
                updateProgress(
                    30 + Math.min(7, elapsedSeconds / 10),
                    `Initializing FFmpeg WebAssembly engine (${Math.floor(elapsedSeconds)} seconds)...`
                );
            }, 1000);
            let startupTimeout;
            try {
                await Promise.race([
                    ffmpeg.load({
                        classWorkerURL: workerUrl,
                        coreURL: coreUrl,
                        wasmURL: wasmUrl
                    }),
                    new Promise((_, reject) => {
                        startupTimeout = setTimeout(() => {
                            reject(new Error(
                                'FFmpeg did not finish initializing within 90 seconds. Check that the FFmpeg assets are reachable and try again.'
                            ));
                            ffmpeg.terminate();
                        }, 90000);
                    })
                ]);
            } finally {
                clearInterval(initializationTimer);
                clearTimeout(startupTimeout);
            }
            updateProgress(38, 'FFmpeg engine ready. Preparing conversion...');
            activeFFmpegRuntime = ffmpeg;
            return ffmpeg;
        })().catch(error => {
            ffmpegObjectUrls.forEach(url => URL.revokeObjectURL(url));
            ffmpegObjectUrls = [];
            ffmpegRuntimePromise = null;
            throw error;
        });
    }
    return ffmpegRuntimePromise;
}

function encodeBytesAsBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const end = Math.min(bytes.length, offset + chunkSize);
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, end));
    }
    return btoa(binary);
}

async function encodeAudioPayload(bytes, onProgress) {
    const sourceBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const data = await encodeBytes(sourceBytes, onProgress);
    return {
        data,
        encodedLength: sourceBytes.length,
        baseK: true,
        baseKBlockSize: BASE_K_BLOCK_SIZE
    };
}

function serializeAudioPayload(audioPayload) {
    return `{s:${JSON.stringify(audioPayload.data)},n:${audioPayload.encodedLength},b:${audioPayload.baseKBlockSize}}`;
}

function getValidMp3Bitrates(sampleRate) {
    if (sampleRate >= 32000) {
        return [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    }
    if (sampleRate >= 16000) {
        return [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    }
    return [8, 16, 24, 32, 40, 48, 56, 64];
}

function getAudioEncodingOptions(quality) {
    const level = Math.max(1, Math.min(100, Math.round(Number(quality) || 1)));
    const sampleRate = level <= 8
        ? 8000
        : level <= 16
            ? 11025
            : level <= 28
                ? 16000
                : level <= 45
                    ? 22050
                    : level <= 70
                        ? 32000
                        : 44100;
    const bitrates = getValidMp3Bitrates(sampleRate);
    const bitrate = bitrates[
        Math.round((level - 1) / 99 * (bitrates.length - 1))
    ];
    const minLowPassHz = 1000;
    const maxLowPassHz = Math.max(
        minLowPassHz + 99,
        Math.floor(sampleRate * 0.45)
    );
    const encodeSpeed = level <= 20
        ? Number((1 + 3 * (20 - level) / 19).toFixed(4))
        : 1;
    return {
        bitrate,
        sampleRate,
        channels: level < 36 ? 1 : 2,
        lowPassHz: Math.round(
            minLowPassHz + (level - 1) * (maxLowPassHz - minLowPassHz) / 99
        ),
        encodeSpeed,
        playbackRate: Number((1 / encodeSpeed).toFixed(4))
    };
}

function getAudioFilterGraph(encoding) {
    const filters = ['aresample=' + encoding.sampleRate];
    if (encoding.encodeSpeed && Math.abs(encoding.encodeSpeed - 1) > 0.001) {
        filters.push(
            'asetrate=' + Math.round(encoding.sampleRate * encoding.encodeSpeed)
        );
        filters.push('aresample=' + encoding.sampleRate);
    }
    filters.push('lowpass=f=' + encoding.lowPassHz);
    return filters.join(',');
}

function createAudioOutputCode(audioBase64, playbackRate) {
    if (generatedFunctionNames.size >= 900) {
        throw new Error('Generated all available three-digit media function names. Reload the converter to continue.');
    }
    let suffix;
    do {
        suffix = String(Math.floor(Math.random() * 900) + 100);
    } while (generatedFunctionNames.has(suffix));
    generatedFunctionNames.add(suffix);
    const functionName = `playAudio${suffix}`;
    return `/* Compressed audio data stays local to this function. */\n` +
        `function ${functionName}(volume) {\n` +
        `    var audioData;\n` +
        `    /* jshint ignore:start */\n` +
        `    audioData = ${serializeAudioPayload(audioBase64)};\n` +
        `    /* jshint ignore:end */\n` +
        `    dkPlayAudio(${JSON.stringify(functionName)}, audioData, volume` +
        (playbackRate && playbackRate !== 1 ? `, undefined, ${playbackRate}` : '') +
        `);\n` +
        `}\n\n` +
        `// mouseClicked = function () { ${functionName}(0.7); }; // Play on mouse click with 70% volume`;
}

async function finishAudioConversion(audioBase64, playbackRate) {
    updateProgress(90, 'Preparing audio playback code...');
    await yieldToBrowser();
    fullImageCode = createAudioOutputCode(audioBase64, playbackRate);
    fullImageUtilityCode = fullUtilityTemplate;
    fullUtilityCode = fullImageUtilityCode;
    document.getElementById('copy-all-button').disabled = false;
    updateUtilityCodeDisplay();
    const imageOutput = document.getElementById('jsOutput');
    imageOutput.textContent = createCodePreview(fullImageCode);
    imageOutput.classList.add('code-preview');
    document.getElementById('rectCount').textContent =
        `${audioBase64.data.length.toLocaleString()} embedded audio characters`;
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('result-section').querySelector('h2').textContent = 'Generated Audio Code';
    document.getElementById('success').textContent =
        `Audio converted successfully; ${audioBase64.data.length.toLocaleString()} embedded MP3 characters. Call the generated play function from a user click.`;
    document.getElementById('success').style.display = 'block';
    updateProgress(100, 'Conversion complete.');
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('generate-button').disabled = false;
    document.getElementById('cancel-conversion-button').hidden = true;
    activeConversionController = null;
    activeFFmpegRuntime = null;
    document.getElementById('result-section').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
    updateCount('audio');
}

function normalizeFFmpegProgress(progress) {
    if (!Number.isFinite(progress) || progress < 0) {
        return 0;
    }
    if (progress > 1 && progress <= 100) {
        return progress / 100;
    }
    return Math.min(1, progress);
}

async function processVideo(file, maxDimension, settings) {
    updateProgress(2, 'Loading video conversion engine...');
    const ffmpeg = await getFFmpegRuntime();
    activeFFmpegRuntime = ffmpeg;
    updateProgress(8, 'Reading video file...');
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    let captureInputLog = null;
    let captureEncodeLog = null;
    let updateVideoProgress = null;
    try {
        updateProgress(11, 'Copying video into the converter...');
        await ffmpeg.writeFile('/input-media', sourceBytes);
        updateProgress(14, 'Inspecting video streams...');
        const inputLogs = [];
        captureInputLog = entry => inputLogs.push(entry.message);
        ffmpeg.on('log', captureInputLog);
        let probeExitCode;
        try {
            probeExitCode = await ffmpeg.exec(['-hide_banner', '-i', '/input-media']);
        } finally {
            ffmpeg.off('log', captureInputLog);
            captureInputLog = null;
        }
        const probeOutput = inputLogs.join('\n');
        const videoStream = inputLogs.find(line => line.includes('Video:'));
        if (!videoStream) {
            throw new Error(
                probeOutput.trim()
                    ? `Could not read a video stream: ${probeOutput.trim().split('\n').slice(-2).join(' ')}`
                    : `FFmpeg could not inspect the video (exit ${probeExitCode}).`
            );
        }
        const durationMatch = probeOutput.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        const resolutionMatches = Array.from(
            videoStream.matchAll(/\b([1-9]\d{0,4})x([1-9]\d{0,4})\b/g)
        );
        const resolutionMatch = resolutionMatches.length
            ? resolutionMatches[resolutionMatches.length - 1]
            : null;
        const frameRateMatch = videoStream.match(/([\d.]+)\s+fps\b/) ||
            videoStream.match(/([\d.]+)\s+tbr\b/);
        let duration = durationMatch
            ? Number(durationMatch[1]) * 3600 +
                Number(durationMatch[2]) * 60 +
                Number(durationMatch[3])
            : NaN;
        let frameRate = frameRateMatch ? Number(frameRateMatch[1]) : NaN;
        let sourceWidth = resolutionMatch ? Number(resolutionMatch[1]) : 0;
        let sourceHeight = resolutionMatch ? Number(resolutionMatch[2]) : 0;
        if (sourceWidth < 1 || sourceHeight < 1 || !Number.isFinite(duration) || duration <= 0) {
            const metadata = await readVideoMetadata(file);
            sourceWidth = sourceWidth > 0 ? sourceWidth : metadata.width;
            sourceHeight = sourceHeight > 0 ? sourceHeight : metadata.height;
            duration = Number.isFinite(duration) && duration > 0
                ? duration
                : metadata.duration;
        }
        if (!Number.isFinite(frameRate) || frameRate <= 0) {
            frameRate = 30;
        }

        const dimensions = getOutputDimensions(sourceWidth, sourceHeight, maxDimension);
        const estimatedFrameCount = Math.max(1, Math.ceil(duration * frameRate));
        const stride = settings.maxFrames === null
            ? 1
            : Math.max(1, Math.ceil(estimatedFrameCount / settings.maxFrames));
        settings.maxColors = settings.capColors
            ? getEffectiveMaxColors(
                dimensions.width,
                dimensions.height,
                settings.requestedMaxColors,
                false
            )
            : null;
        const hasAudio = inputLogs.some(line => line.includes('Audio:'));
        const audioEncoding = getAudioEncodingOptions(settings.audioQuality);
        const selectFilter = `select=not(mod(n\\,${stride})),scale=${dimensions.width}:${dimensions.height}:flags=lanczos`;
        const args = [
            '-hide_banner',
            '-i', '/input-media',
            '-map', '0:v:0',
            '-vf', selectFilter,
            '-vsync', '0'
        ];
        if (settings.maxFrames !== null) {
            args.push('-frames:v', String(settings.maxFrames));
        }
        args.push('-an', '-compression_level', '1', '-y', '/frame-%06d.png');
        if (hasAudio) {
            args.push(
                '-map', '0:a:0',
                '-vn',
                '-af', getAudioFilterGraph(audioEncoding),
                '-codec:a', 'libmp3lame',
                '-b:a', `${audioEncoding.bitrate}k`,
                '-ar', String(audioEncoding.sampleRate),
                '-ac', String(audioEncoding.channels),
                '-y', '/audio.mp3'
            );
        }

        const extractStart = 18;
        const extractSpan = 28;
        let encodingProgress = 0;
        const extractStatus = hasAudio
            ? 'Extracting frames and compressing audio...'
            : 'Extracting video frames...';
        const extractStartedAt = Date.now();
        const reportExtractProgress = () => {
            const elapsedSeconds = Math.floor((Date.now() - extractStartedAt) / 1000);
            const estimated = Math.min(0.93, elapsedSeconds / Math.max(6, duration * 1.2));
            const shown = Math.max(encodingProgress, estimated);
            const elapsedStatus = elapsedSeconds >= 5
                ? ` (${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, '0')}s elapsed)`
                : '';
            updateProgress(
                extractStart + shown * extractSpan,
                `${extractStatus}${elapsedStatus}`
            );
        };
        updateVideoProgress = event => {
            encodingProgress = Math.max(
                encodingProgress,
                normalizeFFmpegProgress(event && event.progress)
            );
            reportExtractProgress();
        };
        updateProgress(extractStart, extractStatus);
        const extractHeartbeat = setInterval(reportExtractProgress, 250);
        const encodeLogs = [];
        captureEncodeLog = entry => encodeLogs.push(entry.message);
        ffmpeg.on('log', captureEncodeLog);
        ffmpeg.on('progress', updateVideoProgress);
        let encodeExitCode;
        try {
            encodeExitCode = await ffmpeg.exec(args);
        } finally {
            clearInterval(extractHeartbeat);
            ffmpeg.off('log', captureEncodeLog);
            captureEncodeLog = null;
            ffmpeg.off('progress', updateVideoProgress);
            updateVideoProgress = null;
        }
        updateProgress(extractStart + extractSpan, 'Reading extracted frames...');
        if (encodeExitCode !== 0) {
            const detail = encodeLogs.slice(-5).join(' ').trim();
            throw new Error(
                detail
                    ? `FFmpeg video conversion failed (exit ${encodeExitCode}): ${detail}`
                    : `FFmpeg video conversion failed (exit ${encodeExitCode}).`
            );
        }

        const directory = await ffmpeg.listDir('/');
        const frameFiles = directory
            .map(entry => entry.name)
            .filter(name => /^frame-\d+\.png$/.test(name))
            .sort();
        if (!frameFiles.length) {
            throw new Error('FFmpeg did not produce any video frames.');
        }
        if (settings.maxFrames !== null && frameFiles.length > settings.maxFrames) {
            throw new Error(`FFmpeg produced ${frameFiles.length} frames, exceeding the ${settings.maxFrames}-frame limit.`);
        }

        const canvas = document.createElement('canvas');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not create a video frame canvas.');
        const frames = [];
        const rawFrames = [];
        const frameDelay = stride * 100 / frameRate;
        const finalFrameDelay = Math.max(
            1,
            (duration - ((frameFiles.length - 1) * stride / frameRate)) * 100
        );
        for (let index = 0; index < frameFiles.length; index++) {
            const fileName = frameFiles[index];
            const bytes = await ffmpeg.readFile(`/${fileName}`);
            const frameUrl = URL.createObjectURL(
                new Blob([bytes], { type: 'image/png' })
            );
            try {
                const image = await new Promise((resolve, reject) => {
                    const decodedImage = new Image();
                    decodedImage.onload = () => resolve(decodedImage);
                    decodedImage.onerror = () => reject(new Error('An extracted video frame could not be decoded.'));
                    decodedImage.src = frameUrl;
                });
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                rawFrames.push(new Uint8Array(
                    context.getImageData(0, 0, canvas.width, canvas.height).data
                ));
            } finally {
                URL.revokeObjectURL(frameUrl);
            }
            await ffmpeg.deleteFile(`/${fileName}`);
            updateProgress(
                46 + ((index + 1) / frameFiles.length) * 8,
                `Preparing video frame ${index + 1} of ${frameFiles.length}...`
            );
        }
        const qualityOffset = settings.imageQuality === 100 ? 0 : 0.25;
        const qualityFrames = await applyImageQualityToFrames(
            rawFrames,
            dimensions.width,
            dimensions.height,
            settings.imageQuality,
            fraction => updateProgress(
                54 + fraction * 10,
                `Applying WebP quality to video frames (${Math.min(frameFiles.length, Math.round(fraction * frameFiles.length))} of ${frameFiles.length})...`
            )
        );
        const reportVideoEncodeProgress = fraction => updateProgress(
            54 + qualityOffset * 40 + fraction * 40 * (1 - qualityOffset),
            `Encoding video frames (${Math.min(frameFiles.length, Math.round(fraction * frameFiles.length))} of ${frameFiles.length})...`
        );
        const encodedFrames = settings.maxColors === null
            ? await encodeZstdFrames(
                qualityFrames,
                dimensions.width,
                dimensions.height,
                reportVideoEncodeProgress
            )
            : await encodeColorLimitedFrames(
                qualityFrames,
                dimensions.width,
                dimensions.height,
                settings.maxColors,
                reportVideoEncodeProgress
            );
        encodedFrames.forEach((frame, index) => {
            frame.delay = index === frameFiles.length - 1
                ? finalFrameDelay
                : frameDelay;
            frames.push(frame);
        });

        let audioBase64 = null;
        if (hasAudio) {
            const audioBytes = await ffmpeg.readFile('/audio.mp3');
            audioBase64 = await encodeAudioPayload(audioBytes);
        }
        await finishConversion(
            dimensions.width,
            dimensions.height,
            frames,
            'video',
            false,
            settings.maxColors,
            audioBase64,
            hasAudio ? audioEncoding.playbackRate : undefined,
            settings.imageQuality
        );
    } finally {
        if (captureInputLog) ffmpeg.off('log', captureInputLog);
        if (captureEncodeLog) ffmpeg.off('log', captureEncodeLog);
        if (updateVideoProgress) ffmpeg.off('progress', updateVideoProgress);
        for (const entry of await ffmpeg.listDir('/')) {
            if (entry.name === 'input-media' || entry.name === 'audio.mp3' ||
                /^frame-\d+\.png$/.test(entry.name)) {
                await ffmpeg.deleteFile(`/${entry.name}`);
            }
        }
    }
}

async function processAudio(file, settings) {
    updateProgress(2, 'Loading audio conversion engine...');
    const ffmpeg = await getFFmpegRuntime();
    activeFFmpegRuntime = ffmpeg;
    updateProgress(8, 'Reading audio file...');
    let captureLog = null;
    let updateAudioProgress = null;
    try {
        const sourceBytes = new Uint8Array(await file.arrayBuffer());
        updateProgress(12, 'Copying audio into the converter...');
        await ffmpeg.writeFile('/input-audio', sourceBytes);
        const logs = [];
        captureLog = entry => logs.push(entry.message);
        ffmpeg.on('log', captureLog);
        const audioEncoding = getAudioEncodingOptions(settings.audioQuality);
        const args = [
            '-hide_banner',
            '-i', '/input-audio',
            '-map', '0:a:0',
            '-vn'
        ];
        args.push(
            '-af', getAudioFilterGraph(audioEncoding),
            '-codec:a', 'libmp3lame',
            '-b:a', `${audioEncoding.bitrate}k`,
            '-ar', String(audioEncoding.sampleRate),
            '-ac', String(audioEncoding.channels),
            '-y', '/audio-output.mp3'
        );
        let audioProgress = 0;
        const audioStartedAt = Date.now();
        const reportAudioProgress = () => {
            const elapsedSeconds = (Date.now() - audioStartedAt) / 1000;
            const estimated = Math.min(0.93, elapsedSeconds / 12);
            updateProgress(18 + Math.max(audioProgress, estimated) * 64, 'Compressing audio...');
        };
        updateAudioProgress = event => {
            audioProgress = Math.max(
                audioProgress,
                normalizeFFmpegProgress(event && event.progress)
            );
            reportAudioProgress();
        };
        updateProgress(18, 'Compressing audio...');
        const audioHeartbeat = setInterval(reportAudioProgress, 250);
        ffmpeg.on('progress', updateAudioProgress);
        let exitCode;
        try {
            exitCode = await ffmpeg.exec(args);
        } finally {
            clearInterval(audioHeartbeat);
            ffmpeg.off('log', captureLog);
            captureLog = null;
            ffmpeg.off('progress', updateAudioProgress);
            updateAudioProgress = null;
        }
        if (exitCode !== 0) {
            const detail = logs.slice(-5).join(' ').trim();
            throw new Error(
                detail
                    ? `FFmpeg audio conversion failed (exit ${exitCode}): ${detail}`
                    : `FFmpeg audio conversion failed (exit ${exitCode}).`
            );
        }
        const outputBytes = await ffmpeg.readFile('/audio-output.mp3');
        if (!outputBytes.length) {
            throw new Error('FFmpeg produced an empty audio file.');
        }
        updateProgress(84, 'Encoding compressed audio data...');
        await finishAudioConversion(
            await encodeAudioPayload(outputBytes),
            audioEncoding.playbackRate
        );
    } finally {
        if (captureLog) ffmpeg.off('log', captureLog);
        if (updateAudioProgress) ffmpeg.off('progress', updateAudioProgress);
        for (const entry of await ffmpeg.listDir('/')) {
            if (entry.name === 'input-audio' || entry.name === 'audio-output.mp3') {
                await ffmpeg.deleteFile(`/${entry.name}`);
            }
        }
    }
}

async function processGIF(file, maxDimension, settings) {
    updateProgress(1, 'Loading GIF data...');
    const gifBytes = await file.arrayBuffer();
    updateProgress(3, 'Reading GIF frames...');
    const reader = new GifReader(new Uint8Array(gifBytes));
    const width = reader.width;
    const height = reader.height;
    const frameCount = reader.numFrames();
    if (!frameCount) throw new Error('The GIF contains no frames.');
    updateProgress(5, `Preparing ${frameCount} GIF frames...`);
    const maxFrames = settings.maxFrames;
    const sourceDelays = [];
    for (let index = 0; index < frameCount; index++) {
        sourceDelays.push(reader.frameInfo(index).delay || 0);
    }
    const frameSelection = getGIFFrameSelection(sourceDelays, maxFrames);
    const frameStride = frameSelection.stride;
    const outputFrameCount = frameSelection.indices.length;
    const outputDimensions = getOutputDimensions(width, height, maxDimension);
    settings.maxColors = settings.capColors
        ? getEffectiveMaxColors(
            outputDimensions.width,
            outputDimensions.height,
            settings.requestedMaxColors,
            settings.pixelArt
        )
        : null;
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputDimensions.width;
    outputCanvas.height = outputDimensions.height;
    const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext || !outputContext) throw new Error('Could not create GIF processing canvases.');
    const frames = [];
    let rawFrames = [];
    let outputFrameDelays = [];
    const composited = new Uint8ClampedArray(width * height * 4);
    let previousInfo = null;
    let restorePrevious = null;
    let encodedFrameCount = 0;

    function updateGIFProgress(percent, status) {
        updateProgress(5 + percent * 0.8, status);
    }

    async function compressFrameBatch(decodedFrameCount) {
        if (!rawFrames.length) return;
        const batchFrames = rawFrames;
        const batchDelays = outputFrameDelays;
        const batchLength = batchFrames.length;
        rawFrames = [];
        outputFrameDelays = [];
        const qualityOffset = settings.imageQuality === 100 ? 0 : 0.5;
        const qualityFrames = await applyImageQualityToFrames(
            batchFrames,
            outputDimensions.width,
            outputDimensions.height,
            settings.imageQuality,
            fraction => updateGIFProgress(
                50 * (decodedFrameCount / frameCount) +
                50 * ((encodedFrameCount + fraction * batchLength * 0.5) / outputFrameCount),
                `Applying WebP quality to GIF frames (${Math.min(outputFrameCount, encodedFrameCount + Math.round(fraction * batchLength))} of ${outputFrameCount})...`
            )
        );
        const encodeBatch = settings.pixelArt
            ? encodePixelArtFrames(
                qualityFrames,
                outputDimensions.width,
                outputDimensions.height,
                settings.maxColors,
                (fraction, total) => {
                    updateGIFProgress(
                        50 * (decodedFrameCount / frameCount) +
                        50 * ((encodedFrameCount + (qualityOffset + fraction * (1 - qualityOffset)) * batchLength) / outputFrameCount),
                        `Creating pixel art (${Math.min(outputFrameCount, encodedFrameCount + Math.round(fraction * batchLength))} of ${outputFrameCount} GIF frames)...`
                    );
                }
            )
            : settings.maxColors !== null
                ? encodeColorLimitedFrames(
                    qualityFrames,
                    outputDimensions.width,
                    outputDimensions.height,
                    settings.maxColors,
                    fraction => {
                        const completedFrameFraction = encodedFrameCount + fraction * batchLength;
                        updateGIFProgress(
                            50 * (decodedFrameCount / frameCount) +
                                50 * ((encodedFrameCount + (qualityOffset + fraction * (1 - qualityOffset)) * batchLength) / outputFrameCount),
                                `Applying color cap and compressing GIF frames (${Math.min(outputFrameCount, Math.round(completedFrameFraction))} of ${outputFrameCount})...`
                        );
                    }
                )
                : encodeZstdFrames(
                        qualityFrames,
                        outputDimensions.width,
                        outputDimensions.height,
                        fraction => updateGIFProgress(
                            50 * (decodedFrameCount / frameCount) +
                                50 * ((encodedFrameCount + (qualityOffset + fraction * (1 - qualityOffset)) * batchLength) / outputFrameCount),
                            `Filtering and compressing lossless GIF frames (${Math.min(outputFrameCount, Math.round(encodedFrameCount + fraction * batchLength))} of ${outputFrameCount})...`
                        )
                    );
        const encodedBatch = await encodeBatch;
        encodedBatch.forEach((encodedFrame, index) => {
            encodedFrame.delay = batchDelays[index];
            frames.push(encodedFrame);
        });
        encodedFrameCount += batchLength;
        updateGIFProgress(
            50 * (decodedFrameCount / frameCount) + 50 * (encodedFrameCount / outputFrameCount),
            `Processed ${encodedFrameCount} of ${outputFrameCount} GIF frames...`
        );
    }

    for (let i = 0; i < frameCount; i++) {
        updateGIFProgress(
            50 * (i / frameCount) + 50 * (encodedFrameCount / outputFrameCount),
            `Decoding GIF frame ${i + 1} of ${frameCount}...`
        );
        await yieldToBrowser();
        if (previousInfo && previousInfo.disposal === 2) {
            for (let y = previousInfo.y; y < previousInfo.y + previousInfo.height; y++) {
                const start = (y * width + previousInfo.x) * 4;
                composited.fill(0, start, start + previousInfo.width * 4);
            }
        } else if (previousInfo && previousInfo.disposal === 3 && restorePrevious) {
            composited.set(restorePrevious);
        }

        const info = reader.frameInfo(i);
        restorePrevious = info.disposal === 3 ? composited.slice() : null;
        const decoded = new Uint8Array(width * height * 4);
        reader.decodeAndBlitFrameRGBA(i, decoded);
        for (let y = info.y; y < info.y + info.height; y++) {
            for (let x = info.x; x < info.x + info.width; x++) {
                const offset = (y * width + x) * 4;
                if (decoded[offset + 3] !== 0) {
                    composited[offset] = decoded[offset];
                    composited[offset + 1] = decoded[offset + 1];
                    composited[offset + 2] = decoded[offset + 2];
                    composited[offset + 3] = decoded[offset + 3];
                }
            }
            if ((y - info.y + 1) % 32 === 0) {
                updateGIFProgress(
                    50 * (i / frameCount) +
                        50 * (encodedFrameCount / outputFrameCount),
                    `Compositing GIF frame ${i + 1} of ${frameCount}...`
                );
                await yieldToBrowser();
            }
        }
        previousInfo = info;

        if (i % frameStride === 0) {
            const sourceImage = sourceContext.createImageData(width, height);
            sourceImage.data.set(composited);
            sourceContext.putImageData(sourceImage, 0, 0);
            outputContext.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
            outputContext.drawImage(sourceCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
            rawFrames.push(new Uint8Array(outputContext.getImageData(0, 0, outputCanvas.width, outputCanvas.height).data));
            outputFrameDelays.push(frameSelection.delays[encodedFrameCount + rawFrames.length - 1]);
        }

        if (i === frameCount - 1) {
            await compressFrameBatch(i + 1);
        }
    }

    await finishConversion(
        outputCanvas.width,
        outputCanvas.height,
        frames,
        'GIF',
        settings.pixelArt,
        settings.maxColors,
        undefined,
        undefined,
        settings.imageQuality
    );
}

function showLoading() {
    const fileInput = document.getElementById('image_file');
    if (!fileInput.files.length) return true;
    highestProgress = 0;
    lastProgressStatusAt = 0;
    pendingProgressStatus = '';
    if (progressStatusTimer !== null) {
        clearTimeout(progressStatusTimer);
        progressStatusTimer = null;
    }
    const file = fileInput.files[0];
    const isAudio = (file.type || '').toLowerCase().startsWith('audio/') ||
        /\.(mp3|wav|m4a|aac|ogg|opus|flac|wma|aiff?)$/i.test(file.name);
    const isVideo = (file.type || '').toLowerCase().startsWith('video/') ||
        /\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/i.test(file.name);
    const isGIF = (file.type || '').toLowerCase() === 'image/gif' ||
        /\.gif$/i.test(file.name);
    document.querySelector('#loading-screen h2').textContent = isVideo
        ? 'PROCESSING VIDEO...'
        : isAudio
            ? 'PROCESSING AUDIO...'
        : isGIF
            ? 'PROCESSING GIF...'
            : 'PROCESSING IMAGE...';
    document.getElementById('loading-screen').style.display = 'flex';
    document.getElementById('cancel-conversion-button').hidden = false;
    document.getElementById('generate-button').disabled = true;
    updateProgress(
        0,
        isVideo
            ? 'Preparing video...'
            : isAudio
                ? 'Preparing audio...'
                : isGIF
                    ? 'Preparing GIF...'
                    : 'Preparing image...'
    );
    return true;
}

function reportError(error) {
    if (conversionCancelled || error?.name === 'AbortError') {
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('generate-button').disabled = false;
        document.getElementById('cancel-conversion-button').hidden = true;
        document.getElementById('cancel-conversion-button').disabled = false;
        conversionCancelled = false;
        activeConversionController = null;
        activeFFmpegRuntime = null;
        return;
    }
    document.getElementById('error').textContent = `Conversion failed: ${error.message || error}`;
    document.getElementById('error').style.display = 'block';
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('generate-button').disabled = false;
    document.getElementById('cancel-conversion-button').hidden = true;
    document.getElementById('cancel-conversion-button').disabled = false;
    activeConversionController = null;
    activeFFmpegRuntime = null;
}

function cancelConversion() {
    if (!activeConversionController) return;
    conversionCancelled = true;
    activeConversionController.abort();
    stopActiveZstdWorker(
        new DOMException('Conversion cancelled.', 'AbortError'),
        false
    );
    document.getElementById('cancel-conversion-button').disabled = true;
    document.getElementById('loading-status').textContent = 'Cancelling conversion...';
    if (activeFFmpegRuntime) {
        activeFFmpegRuntime.terminate();
        activeFFmpegRuntime = null;
        ffmpegRuntimePromise = null;
        ffmpegObjectUrls.forEach(url => URL.revokeObjectURL(url));
        ffmpegObjectUrls = [];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const convertedCount = Number(localStorage.getItem('dk_converted_count') || 0);
    document.getElementById('converted-count').textContent = String(convertedCount);
    const maxResolutionInput = document.getElementById('max_resolution');
    const imageFileInput = document.getElementById('image_file');
    const gifFrameOptions = document.getElementById('gif-frame-options');
    const maxFramesInput = document.getElementById('max_frames');
    const maxFramesLabel = document.getElementById('max-frames-label');
    const maxFramesHelp = document.getElementById('max-frames-help');
    const mediaAudioOptions = document.getElementById('media-audio-options');
    const imageVideoOptions = document.getElementById('image-video-options');
    const audioQualityInput = document.getElementById('audio_quality');
    const imageQualityInput = document.getElementById('image_quality');
    const imageQualityOptions = document.getElementById('image-quality-options');
    const pixelArtInput = document.getElementById('pixel_art_mode');
    const pixelArtOptions = document.getElementById('pixel-art-options');
    const capColorsInput = document.getElementById('cap_colors');
    const maxColorsOptions = document.getElementById('max-colors-options');
    const maxColorsInput = document.getElementById('max_colors');
    const maxColorsHelp = document.getElementById('max-colors-help');
    const colorOptionsGroup = document.getElementById('color-options-group');

    // Restore user preferences from localStorage
    const savedMaxResolution = localStorage.getItem('dk_max_resolution') ?? localStorage.getItem('dk_last_max_resolution');
    if (savedMaxResolution !== null) {
        maxResolutionInput.value = savedMaxResolution;
    }
    const savedMaxFrames = localStorage.getItem('dk_max_frames');
    if (savedMaxFrames !== null) {
        maxFramesInput.value = savedMaxFrames;
    }
    const savedMaxColors = localStorage.getItem('dk_max_colors');
    if (savedMaxColors !== null) {
        maxColorsInput.value = savedMaxColors;
    }
    const savedAudioQuality = localStorage.getItem('dk_audio_quality');
    if (savedAudioQuality !== null) {
        audioQualityInput.value = savedAudioQuality;
        const slider = document.getElementById('audio_quality_slider');
        if (slider) slider.value = savedAudioQuality;
    }
    const savedImageQuality = localStorage.getItem('dk_image_quality');
    if (savedImageQuality !== null) {
        imageQualityInput.value = savedImageQuality;
        const slider = document.getElementById('image_quality_slider');
        if (slider) slider.value = savedImageQuality;
    }
    const savedPixelArt = localStorage.getItem('dk_pixel_art_mode');
    if (savedPixelArt !== null) {
        pixelArtInput.checked = savedPixelArt === 'true';
    }
    // Auto-check color reduction by default unless user explicitly unchecked it
    const savedCapColors = localStorage.getItem('dk_cap_colors');
    if (savedCapColors !== null) {
        capColorsInput.checked = savedCapColors === 'true';
    } else {
        capColorsInput.checked = true;
    }

    function syncPresetPills(input) {
        document.querySelectorAll(
            `.preset-pill[data-target="${input.id}"]`
        ).forEach(pill => {
            pill.classList.toggle(
                'active',
                pill.getAttribute('data-value') === input.value
            );
        });
    }

    // Persist all user input changes into localStorage
    maxResolutionInput.addEventListener('input', () => {
        localStorage.setItem('dk_max_resolution', maxResolutionInput.value);
        localStorage.setItem('dk_last_max_resolution', maxResolutionInput.value);
        syncPresetPills(maxResolutionInput);
    });
    maxFramesInput.addEventListener('input', () => {
        localStorage.setItem('dk_max_frames', maxFramesInput.value);
        syncPresetPills(maxFramesInput);
    });
    maxColorsInput.addEventListener('input', () => {
        localStorage.setItem('dk_max_colors', maxColorsInput.value);
    });
    audioQualityInput.addEventListener('input', () => {
        localStorage.setItem('dk_audio_quality', audioQualityInput.value);
    });
    imageQualityInput.addEventListener('input', () => {
        localStorage.setItem('dk_image_quality', imageQualityInput.value);
    });
    pixelArtInput.addEventListener('change', () => {
        localStorage.setItem('dk_pixel_art_mode', String(pixelArtInput.checked));
        updateMediaOptions();
        if (!fullImageCode) {
            updateUtilityCode(pixelArtInput.checked, capColorsInput.checked);
        }
    });
    capColorsInput.addEventListener('change', () => {
        localStorage.setItem('dk_cap_colors', String(capColorsInput.checked));
        updateMediaOptions();
        if (!fullImageCode) {
            updateUtilityCode(pixelArtInput.checked, capColorsInput.checked);
        }
    });

    function isGIFFile(file) {
        return (file.type || '').toLowerCase() === 'image/gif' ||
            /\.gif$/i.test(file.name);
    }
    function isVideoFile(file) {
        return (file.type || '').toLowerCase().startsWith('video/') ||
            /\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/i.test(file.name);
    }
    function isAudioFile(file) {
        return (file.type || '').toLowerCase().startsWith('audio/') ||
            /\.(mp3|wav|m4a|aac|ogg|opus|flac|wma|aiff?)$/i.test(file.name);
    }
    let framePresetRequest = 0;
    document.querySelectorAll('.preset-pill').forEach(button => {
        button.addEventListener('click', async () => {
            const targetId = button.getAttribute('data-target');
            const targetValue = button.getAttribute('data-value');
            const input = document.getElementById(targetId);
            if (!input) return;
            const requestId = ++framePresetRequest;
            let value = targetValue;
            if (targetId === 'max_frames' && targetValue !== '') {
                try {
                    const file = imageFileInput.files[0];
                    if (!file || (!isGIFFile(file) && !isVideoFile(file))) {
                        throw new Error('Select a video or GIF before choosing an FPS preset.');
                    }
                    const duration = await readMediaDurationSeconds(file);
                    if (requestId !== framePresetRequest) return;
                    value = String(Math.max(1, Math.ceil(duration * Number(targetValue))));
                    button.title = `${targetValue} FPS for ${duration.toFixed(2)} seconds (${Number(value).toLocaleString()} frames)`;
                } catch (error) {
                    if (requestId !== framePresetRequest) return;
                    const errorBanner = document.getElementById('error');
                    errorBanner.textContent = `Could not apply FPS preset: ${error.message || error}`;
                    errorBanner.style.display = 'block';
                    return;
                }
            }
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            syncPresetPills(input);
        });
    });
    syncPresetPills(maxResolutionInput);
    syncPresetPills(maxFramesInput);

    function updateMediaOptions() {
        const file = imageFileInput.files[0];
        const isGIF = !!file && isGIFFile(file);
        const isVideo = !!file && isVideoFile(file);
        const isAudio = !!file && isAudioFile(file);
        updateColorCapOptions();
        updateUtilityCode(pixelArtInput.checked, capColorsInput.checked);
        imageVideoOptions.hidden = isAudio;
        imageQualityOptions.hidden = isAudio;
        gifFrameOptions.hidden = !isGIF && !isVideo;
        mediaAudioOptions.hidden = !isVideo && !isAudio;
        if (colorOptionsGroup) {
            colorOptionsGroup.hidden = isAudio;
        }
        maxFramesLabel.textContent = isVideo ? 'Maximum video frames' : 'Maximum GIF frames';
        maxFramesHelp.textContent = isVideo
            ? 'Leave blank for all frames. FPS presets calculate a frame count from the video duration; frames are sampled at a whole-frame interval.'
            : 'Leave blank for all frames. FPS presets calculate a frame count from the GIF duration; long GIFs are sampled at a whole-frame interval.';
    }
    imageFileInput.addEventListener('change', updateMediaOptions);
    function updateColorCapOptions() {
        const file = imageFileInput.files[0];
        const gifSelected = !!file && isGIFFile(file);
        const videoSelected = !!file && isVideoFile(file);
        const audioSelected = !!file && isAudioFile(file);
        imageVideoOptions.hidden = audioSelected;
        imageQualityOptions.hidden = audioSelected;
        if (colorOptionsGroup) {
            colorOptionsGroup.hidden = audioSelected;
        }
        pixelArtOptions.hidden = videoSelected;
        pixelArtInput.disabled = videoSelected;
        if (pixelArtInput.checked && !videoSelected) {
            capColorsInput.checked = true;
        }
        capColorsInput.disabled = pixelArtInput.checked;
        const pixelArt = pixelArtInput.checked && !videoSelected;
        const colorCapEnabled = pixelArt || capColorsInput.checked;
        maxColorsOptions.hidden = !colorCapEnabled;
        maxColorsInput.disabled = !colorCapEnabled;
        maxColorsInput.max = pixelArt
            ? String(PIXEL_COLOR_ALPHABET.length)
            : String(MAX_COLOR_BINS);
        maxColorsHelp.textContent = videoSelected
            ? 'When enabled, video frames share one palette. Turn it off for uncapped pixels; blank uses min(256, floor(output pixels ÷ 500)).'
            : gifSelected
                ? 'When enabled, GIF frames share one color palette. Turn it off for uncapped pixels; blank uses min(256, floor(output pixels ÷ 500)).'
            : pixelArt
                ? 'Up to 93 colors are supported; fully transparent pixels stay transparent.'
                : 'Blank uses min(256, floor(output pixels ÷ 500)); enter a number for a different cap. GIFs share one palette across frames.';
    }
    pixelArtInput.addEventListener('change', updateColorCapOptions);
    capColorsInput.addEventListener('change', updateColorCapOptions);
    updateColorCapOptions();
    document.getElementById('uploadForm').addEventListener('submit', async event => {
        event.preventDefault();
        const file = imageFileInput.files[0];
        const maxResolutionValue = maxResolutionInput.value.trim();
        const maxDimension = maxResolutionValue === ''
            ? null
            : Number(maxResolutionValue);
        if (!file) {
            reportError(new Error('Please select an image, GIF, or video file.'));
            return;
        }
        const isGIF = isGIFFile(file);
        const isVideo = isVideoFile(file);
        const isAudio = isAudioFile(file);
        const isImage = (file.type || '').toLowerCase().startsWith('image/') ||
            /\.(png|jpe?g|bmp|webp|avif|svg|tiff?)$/i.test(file.name);
        if (!isGIF && !isVideo && !isAudio && !isImage) {
            reportError(new Error('Choose a supported image, GIF, video, or audio file.'));
            return;
        }
        if (!isAudio && !supportsZstdEncoding()) {
            reportError(new Error(
                'This browser cannot encode DK image data. Use a modern browser with WebAssembly support.'
            ));
            return;
        }
        if (!isAudio && maxDimension !== null &&
            (!Number.isSafeInteger(maxDimension) || maxDimension < 1)) {
            reportError(new Error('Max output resolution must be a positive whole number.'));
            return;
        }
        const maxFramesValue = maxFramesInput.value.trim();
        const maxFrames = !isGIF && !isVideo || maxFramesValue === ''
            ? null
            : Number(maxFramesValue);
        if (maxFrames !== null &&
            (!Number.isSafeInteger(maxFrames) || maxFrames < 1)) {
            reportError(new Error('Maximum frames must be a positive whole number, or blank.'));
            return;
        }
        const audioQuality = Number(audioQualityInput.value);
        if ((isVideo || isAudio) &&
            (!Number.isSafeInteger(audioQuality) || audioQuality < 1 || audioQuality > 100)) {
            reportError(new Error('Audio compression level must be a whole number from 1 to 100.'));
            return;
        }
        const imageQuality = Number(imageQualityInput.value);
        if (!isAudio &&
            (!Number.isSafeInteger(imageQuality) || imageQuality < 0 || imageQuality > 100)) {
            reportError(new Error('Image compression quality must be a whole number from 0 to 100.'));
            return;
        }
        const pixelArt = !isVideo && !isAudio && pixelArtInput.checked;
        const capColors = !isAudio && (pixelArt || capColorsInput.checked);
        const requestedMaxColors = !capColors || maxColorsInput.value.trim() === ''
            ? null
            : Number(maxColorsInput.value);
        const maximumColors = pixelArt
            ? PIXEL_COLOR_ALPHABET.length
            : MAX_COLOR_BINS;
        if (!isAudio && requestedMaxColors !== null &&
            (!Number.isSafeInteger(requestedMaxColors) ||
                requestedMaxColors < 1 ||
                requestedMaxColors > maximumColors)) {
            reportError(new Error(
                `Maximum colors must be a whole number from 1 to ${maximumColors.toLocaleString()}, or blank.`
            ));
            return;
        }
        const settings = {
            pixelArt,
            capColors,
            requestedMaxColors,
            maxFrames,
            audioQuality,
            imageQuality,
            maxColors: null
        };
        localStorage.setItem(
            'dk_last_max_resolution',
            maxDimension === null ? '' : String(maxDimension)
        );

        document.getElementById('result-section').style.display = 'none';
        fullImageCode = '';
        document.getElementById('copy-all-button').disabled = true;
        document.getElementById('error').style.display = 'none';
        document.getElementById('success').style.display = 'none';
        showLoading();
        conversionCancelled = false;
        activeConversionController = new AbortController();
        document.getElementById('cancel-conversion-button').disabled = false;

        try {
            if (isAudio) {
                await processAudio(file, settings);
            } else if (isVideo) {
                await processVideo(file, maxDimension, settings);
            } else if (isGIF) {
                await processGIF(file, maxDimension, settings);
            } else {
                updateProgress(5, 'Loading image...');
                const image = await readImage(file, maxDimension);
                updateProgress(10, 'Image loaded. Preparing image data...');
                let frames;
                if (pixelArt) {
                    settings.maxColors = getEffectiveMaxColors(
                        image.width,
                        image.height,
                        requestedMaxColors,
                        true
                    );
                    const rawFrames = [new Uint8Array(image.rgba)];
                    await applyImageQualityToFrames(
                        rawFrames,
                        image.width,
                        image.height,
                        settings.imageQuality,
                        fraction => updateProgress(
                            10 + fraction * 10,
                            `Applying WebP image quality (${Math.round(fraction * 100)}%)...`
                        )
                    );
                    updateProgress(20, 'Building editable pixel art...');
                    frames = await encodePixelArtFrames(
                        rawFrames,
                        image.width,
                        image.height,
                        settings.maxColors,
                        (fraction, total) => {
                            updateProgress(
                                20 + fraction * 65,
                                `Building pixel art (${Math.min(total, Math.ceil(fraction * total))} of ${total} frames)...`
                            );
                        }
                    );
                } else if (settings.imageQuality < 100 &&
                    hasOpaquePixels(image.rgba)) {
                    if (capColors) {
                        settings.maxColors = getEffectiveMaxColors(
                            image.width,
                            image.height,
                            requestedMaxColors,
                            false
                        );
                    }
                    updateProgress(
                        20,
                        capColors
                            ? 'Compressing image as JPEG and applying color cap...'
                            : 'Compressing image as JPEG...'
                    );
                    frames = [await encodeJPEGFrame(
                        image.rgba,
                        image.width,
                        image.height,
                        settings.imageQuality,
                        settings.maxColors,
                        fraction => updateProgress(
                            20 + fraction * 65,
                            `Encoding JPEG image (${Math.round(fraction * 100)}%)...`
                        )
                    )];
                } else if (capColors) {
                    settings.maxColors = getEffectiveMaxColors(
                        image.width,
                        image.height,
                        requestedMaxColors,
                        false
                    );
                    const rawFrames = [new Uint8Array(image.rgba)];
                    await applyImageQualityToFrames(
                        rawFrames,
                        image.width,
                        image.height,
                        settings.imageQuality,
                        fraction => updateProgress(
                            10 + fraction * 10,
                            `Applying WebP image quality (${Math.round(fraction * 100)}%)...`
                        )
                    );
                    updateProgress(20, 'Applying color cap and encoding...');
                    frames = await encodeColorLimitedFrames(
                        rawFrames,
                        image.width,
                        image.height,
                        settings.maxColors,
                        fraction => {
                            updateProgress(
                                20 + fraction * 65,
                                fraction < 0.5
                                    ? 'Applying color cap...'
                                    : 'Compressing color-limited image data...'
                            );
                        }
                    );
                } else {
                    const rawFrames = [new Uint8Array(image.rgba)];
                    await applyImageQualityToFrames(
                        rawFrames,
                        image.width,
                        image.height,
                        settings.imageQuality,
                        fraction => updateProgress(
                            10 + fraction * 10,
                            `Applying WebP image quality (${Math.round(fraction * 100)}%)...`
                        )
                    );
                    updateProgress(20, 'Compressing image data...');
                    frames = await encodeZstdFrames(
                        rawFrames,
                        image.width,
                        image.height,
                        fraction => updateProgress(
                            20 + fraction * 65,
                            `Filtering and compressing image data (${Math.round(fraction * 100)}%)...`
                        )
                    );
                }
                await finishConversion(
                    image.width,
                    image.height,
                    frames,
                    'image',
                    pixelArt,
                    settings.maxColors,
                    undefined,
                    undefined,
                    settings.imageQuality
                );
            }
        } catch (error) {
            reportError(error);
        }
    });

    fullUtilityTemplate = document.getElementById('utilityOutput').textContent
        .replace('__DK_ALPHABET__', JSON.stringify(BYTE_ALPHABET.join('')))
        .replace('__DK_DIGIT_COUNTS__', JSON.stringify(BASE_K_DIGIT_COUNTS))
        .trim();
    if (!fullUtilityTemplate.startsWith('// DK CONVERTER UTILITY [') ||
        !fullUtilityTemplate.endsWith('// ]')) {
        throw new Error('DK Converter utility must have its Khan Academy wrapper markers.');
    }
    updateUtilityCode();
    updateMediaOptions();
});

function copyResult(button) {
    copyText(fullImageCode, button);
}

function copyUtility(button) {
    copyText(fullImageUtilityCode || fullUtilityCode, button);
}

function copyAll(button) {
    copyText(`${fullImageUtilityCode || fullUtilityCode}\n\n${fullImageCode}`, button);
}

function copyText(text, button) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => showCopiedState(button)).catch(error => {
            console.error('Could not copy text:', error);
            fallbackCopyText(text, button);
        });
    } else {
        fallbackCopyText(text, button);
    }
}

function fallbackCopyText(text, button) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        if (!document.execCommand('copy')) throw new Error('Copy command was rejected.');
        showCopiedState(button);
    } catch (error) {
        console.error('Could not copy text:', error);
        alert('Unable to copy code. Please copy manually.');
    } finally {
        document.body.removeChild(textarea);
    }
}

function showCopiedState(button) {
    if (!button) return;
    const originalText = button.dataset.originalText || button.innerHTML;
    button.dataset.originalText = originalText;
    if (button.copyResetTimer) clearTimeout(button.copyResetTimer);
    button.innerHTML = '✔ COPIED';
    button.disabled = true;
    button.copyResetTimer = setTimeout(() => {
        button.innerHTML = originalText;
        button.disabled = false;
        delete button.copyResetTimer;
    }, 1000);
}
