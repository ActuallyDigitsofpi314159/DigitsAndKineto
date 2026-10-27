const BYTE_ALPHABET = [];
const UNSAFE_TEXT_CHARACTER = /[\p{C}\p{M}\p{Z}]/u;
const THREE_BYTE_LETTER = /\p{L}/u;

for (let codePoint = 33; codePoint <= 126; codePoint++) {
    const character = String.fromCharCode(codePoint);
    if (character !== '"' && character !== '\\') {
        BYTE_ALPHABET.push(character);
    }
}
for (let codePoint = 0x80; codePoint <= 0x7FF; codePoint++) {
    const character = String.fromCharCode(codePoint);
    if (!UNSAFE_TEXT_CHARACTER.test(character)) {
        BYTE_ALPHABET.push(character);
    }
}
for (let codePoint = 0x1E00; codePoint <= 0x1FFF; codePoint++) {
    const character = String.fromCharCode(codePoint);
    if (THREE_BYTE_LETTER.test(character)) {
        BYTE_ALPHABET.push(character);
    }
}
const BASE_K_BLOCK_SIZE = 32;
const generatedFunctionNames = new Set();
let fullUtilityCode = '';
let fullImageCode = '';
let highestProgress = 0;
let baseUtilityCode = '';
let dataParserCode = '';
let audioUtilityCode = '';
let audioUtilityRequired = false;
let dataParserRequired = false;

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

function getBaseKCharacterCount(byteCount) {
    let characterCount = 0;
    for (let offset = 0; offset < byteCount; offset += BASE_K_BLOCK_SIZE) {
        characterCount += BASE_K_DIGIT_COUNTS[
            Math.min(BASE_K_BLOCK_SIZE, byteCount - offset)
        ];
    }
    return characterCount;
}

function compressLZSS(bytes) {
    const output = [];
    const heads = new Int32Array(65536);
    heads.fill(-1);
    const previousAt = new Int32Array(bytes.length);

    function addPosition(position) {
        if (position + 2 >= bytes.length) return;
        const hash = ((bytes[position] * 251 + bytes[position + 1]) * 251 + bytes[position + 2]) & 65535;
        previousAt[position] = heads[hash];
        heads[hash] = position;
    }

    let index = 0;

    while (index < bytes.length) {
        const flagIndex = output.length;
        output.push(0);
        let flags = 0;

        for (let bit = 0; bit < 8 && index < bytes.length; bit++) {
            let bestLength = 0;
            let bestOffset = 0;
            if (index + 2 < bytes.length) {
                const hash = ((bytes[index] * 251 + bytes[index + 1]) * 251 + bytes[index + 2]) & 65535;
                let previous = heads[hash];
                let checked = 0;
                while (previous >= 0 && index - previous <= 4095 && checked < 16) {
                    checked++;
                    if (bytes[previous] === bytes[index] &&
                        bytes[previous + 1] === bytes[index + 1] &&
                        bytes[previous + 2] === bytes[index + 2]) {
                        const limit = Math.min(18, bytes.length - index);
                        const offset = index - previous;
                        let length = 0;
                        while (length < limit && bytes[previous + (length % offset)] === bytes[index + length]) length++;
                        if (length > bestLength && length >= 3) {
                            bestLength = length;
                            bestOffset = offset;
                            if (length === limit) break;
                        }
                    }
                    previous = previousAt[previous];
                }
            }

            if (bestLength >= 3) {
                const token = (bestOffset << 4) | (bestLength - 3);
                output.push((token >> 8) & 255, token & 255);
                for (let i = 0; i < bestLength; i++) addPosition(index + i);
                index += bestLength;
            } else {
                flags |= 1 << bit;
                output.push(bytes[index]);
                addPosition(index);
                index++;
            }
        }
        output[flagIndex] = flags;
    }
    return Uint8Array.from(output);
}

function compressImageChunk(bytes) {
    const rawCompressed = compressLZSS(bytes);
    let bestBytes = bytes;
    let bestCompressed = false;
    let bestDelta = false;

    if (rawCompressed.length < bestBytes.length) {
        bestBytes = rawCompressed;
        bestCompressed = true;
    }

    const deltaBytes = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        deltaBytes[i] = (bytes[i] - (i >= 4 ? bytes[i - 4] : 0) + 256) & 255;
    }
    const deltaCompressed = compressLZSS(deltaBytes);
    if (deltaCompressed.length < bestBytes.length) {
        bestBytes = deltaCompressed;
        bestCompressed = true;
        bestDelta = true;
    }

    const result = { bytes: bestBytes, compressed: bestCompressed, delta: bestDelta };
    const decoded = result.compressed
        ? decodeCompressedChunk(result.bytes, bytes.length, result.delta)
        : result.bytes;
    if (decoded.length !== bytes.length) {
        throw new Error(`Encoder emitted ${decoded.length} bytes for a ${bytes.length}-byte chunk.`);
    }
    for (let i = 0; i < bytes.length; i++) {
        if (decoded[i] !== bytes[i]) throw new Error(`Encoder round-trip mismatch at byte ${i}.`);
    }
    return result;
}

function decodeCompressedChunk(bytes, expectedLength, deltaEncoded) {
    const output = new Uint8Array(expectedLength);
    let inputIndex = 0;
    let outputIndex = 0;
    while (inputIndex < bytes.length && outputIndex < output.length) {
        const flags = bytes[inputIndex++];
        for (let bit = 0; bit < 8 && outputIndex < output.length; bit++) {
            if (flags & (1 << bit)) {
                if (inputIndex >= bytes.length) throw new Error('Compressed chunk has a truncated literal.');
                output[outputIndex++] = bytes[inputIndex++];
            } else {
                if (inputIndex + 1 >= bytes.length) throw new Error('Compressed chunk has a truncated match.');
                const token = (bytes[inputIndex++] << 8) | bytes[inputIndex++];
                const offset = token >> 4;
                const length = (token & 15) + 3;
                if (!offset || offset > outputIndex || outputIndex + length > output.length) {
                    throw new Error('Compressed chunk contains an invalid match.');
                }
                for (let copy = 0; copy < length; copy++) {
                    output[outputIndex] = output[outputIndex - offset];
                    outputIndex++;
                }
            }
        }
    }
    if (outputIndex !== expectedLength || inputIndex !== bytes.length) {
        throw new Error(`Compressed chunk length mismatch: decoded ${outputIndex}/${expectedLength} bytes.`);
    }
    if (deltaEncoded) {
        for (let i = 4; i < output.length; i++) output[i] = (output[i] + output[i - 4]) & 255;
    }
    return output;
}

async function encodeBytes(bytes, onProgress) {
    const blocks = [];
    let blocksSinceYield = 0;
    const blockCount = Math.ceil(bytes.length / BASE_K_BLOCK_SIZE);
    let completedBlocks = 0;
    for (let start = 0; start < bytes.length; start += BASE_K_BLOCK_SIZE) {
        const byteCount = Math.min(BASE_K_BLOCK_SIZE, bytes.length - start);
        const work = Array.from(bytes.subarray(start, start + byteCount));
        const digits = [];
        let hasValue = true;
        while (hasValue) {
            let remainder = 0;
            hasValue = false;
            for (let i = 0; i < work.length; i++) {
                const value = remainder * 256 + work[i];
                work[i] = Math.floor(value / BYTE_ALPHABET.length);
                remainder = value % BYTE_ALPHABET.length;
                if (work[i] !== 0) hasValue = true;
            }
            digits.push(BYTE_ALPHABET[remainder]);
        }
        while (digits.length < BASE_K_DIGIT_COUNTS[byteCount]) {
            digits.push(BYTE_ALPHABET[0]);
        }
        blocks.push(digits.reverse().join(''));
        completedBlocks++;
        if (onProgress) {
            onProgress(completedBlocks / blockCount);
        }
        blocksSinceYield++;
        if (blocksSinceYield === 128) {
            blocksSinceYield = 0;
            await yieldToBrowser();
        }
    }
    return blocks.join('');
}

function encodeCompressedFrames(rawFrames, onProgress) {
    const chunkSize = 32 * 1024;
    const frames = rawFrames.map(rgba => ({ length: rgba.length, chunks: [] }));
    const jobs = [];
    rawFrames.forEach((rgba, frameIndex) => {
        for (let offset = 0; offset < rgba.length; offset += chunkSize) {
            const chunkIndex = frames[frameIndex].chunks.length;
            frames[frameIndex].chunks.push(null);
            const bytes = rgba.slice(offset, offset + chunkSize);
            jobs.push({
                frameIndex,
                chunkIndex,
                jobIndex: jobs.length,
                length: bytes.length,
                bytes
            });
        }
    });

    const jobProgress = new Array(jobs.length).fill(0);
    let totalJobProgress = 0;
    let completedJobs = 0;
    async function saveCompressedChunk(job, compressedBytes) {
        frames[job.frameIndex].chunks[job.chunkIndex] = {
            length: job.length,
            encodedLength: compressedBytes.bytes.length,
            compressed: compressedBytes.compressed,
            delta: compressedBytes.delta,
            baseK: true,
            data: await encodeBytes(compressedBytes.bytes, fraction => {
                totalJobProgress += fraction - jobProgress[job.jobIndex];
                jobProgress[job.jobIndex] = fraction;
                if (onProgress) {
                    onProgress(totalJobProgress, jobs.length);
                }
            })
        };
        totalJobProgress += 1 - jobProgress[job.jobIndex];
        jobProgress[job.jobIndex] = 1;
        completedJobs++;
        if (completedJobs === jobs.length) {
            totalJobProgress = jobs.length;
        }
        if (onProgress) {
            onProgress(totalJobProgress, jobs.length);
        }
    }

    if (!window.Worker || !jobs.length) {
        return (async () => {
            for (const job of jobs) {
                await saveCompressedChunk(job, compressImageChunk(job.bytes));
                await yieldToBrowser();
            }
            return frames;
        })();
    }

    const workerSource = `${compressLZSS.toString()}\n${decodeCompressedChunk.toString()}\n${compressImageChunk.toString()}\n` +
        `self.onmessage = function(event) {\n` +
        `    var input = new Uint8Array(event.data.bytes);\n` +
        `    var result = compressImageChunk(input);\n` +
        `    self.postMessage({jobIndex: event.data.jobIndex, length: input.length, compressed: result.compressed, delta: result.delta, bytes: result.bytes.buffer}, [result.bytes.buffer]);\n` +
        `};`;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const workerCount = Math.min(jobs.length, Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4)));

    return new Promise((resolve, reject) => {
        const workers = [];
        let nextJob = 0;
        let completedWorkers = 0;
        let settled = false;

        function cleanup() {
            workers.forEach(worker => worker.terminate());
            URL.revokeObjectURL(workerUrl);
        }

        function fail(error) {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        }

        function dispatch(worker) {
            if (nextJob >= jobs.length) {
                worker.terminate();
                completedWorkers++;
                if (completedWorkers === workerCount && !settled) {
                    settled = true;
                    URL.revokeObjectURL(workerUrl);
                    resolve(frames);
                }
                return;
            }

            const jobIndex = nextJob++;
            const job = jobs[jobIndex];
            worker.postMessage({
                jobIndex,
                bytes: job.bytes.buffer
            }, [job.bytes.buffer]);
        }

        try {
            for (let i = 0; i < workerCount; i++) {
                const worker = new Worker(workerUrl);
                workers.push(worker);
                worker.onmessage = event => {
                    try {
                        const result = event.data;
                        const job = jobs[result.jobIndex];
                        if (!job) throw new Error('Image compression worker returned an unknown chunk.');
                        if (result.length !== job.length) {
                            throw new Error(`Worker reported ${result.length} bytes for a ${job.length}-byte chunk.`);
                        }
                        const compressedBytes = new Uint8Array(result.bytes);
                        saveCompressedChunk(job, {
                            bytes: compressedBytes,
                            compressed: result.compressed,
                            delta: result.delta
                        }).then(() => dispatch(worker)).catch(fail);
                    } catch (error) {
                        fail(error);
                    }
                };
                worker.onerror = event => fail(new Error(event.message || 'Image compression worker failed.'));
            }
            workers.forEach(dispatch);
        } catch (error) {
            fail(error);
        }
    });
}

function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
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
    if (statusText && status) statusText.textContent = status;
}

function updateCount() {
    const countElement = document.getElementById('converted-count');
    const count = Number(localStorage.getItem('dk_converted_count') || 0) + 1;
    localStorage.setItem('dk_converted_count', String(count));
    if (countElement) countElement.textContent = String(count);
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
    const automaticLimit = Math.max(1, Math.floor(width * height / 500));
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

function getColorBoxBounds(colors) {
    const minimum = [255, 255, 255, 255];
    const maximum = [0, 0, 0, 0];
    let population = 0;
    for (const color of colors) {
        population += color.count;
        for (let channel = 0; channel < 4; channel++) {
            minimum[channel] = Math.min(minimum[channel], color[channel]);
            maximum[channel] = Math.max(maximum[channel], color[channel]);
        }
    }
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
    for (const color of colors) {
        if (color[bounds.splitChannel] <= threshold) first.push(color);
        else second.push(color);
    }
    if (!first.length || !second.length) {
        const sorted = colors.slice().sort((left, right) =>
            left[bounds.splitChannel] - right[bounds.splitChannel]);
        first = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)));
        second = sorted.slice(first.length);
    }
    return [first, second];
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
    const boxes = [colors];
    let splitsSinceYield = 0;
    while (boxes.length < maxColors) {
        let splitIndex = -1;
        let splitScore = -1;
        for (let index = 0; index < boxes.length; index++) {
            if (boxes[index].length < 2) continue;
            const bounds = getColorBoxBounds(boxes[index]);
            const score = bounds.range * Math.log2(bounds.population + 1);
            if (score > splitScore) {
                splitScore = score;
                splitIndex = index;
            }
        }
        if (splitIndex < 0) break;
        const target = boxes.splice(splitIndex, 1)[0];
        const halves = splitColorBox(target, getColorBoxBounds(target));
        boxes.push(halves[0], halves[1]);
        splitsSinceYield++;
        if (splitsSinceYield === 4) {
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
        const box = boxes[index];
        let count = 0;
        const sum = [0, 0, 0, 0];
        for (const color of box) {
            count += color.count;
            for (let channel = 0; channel < 4; channel++) {
                sum[channel] += color[channel] * color.count;
            }
            colorIndexes.set(color.key, index);
            processedColors++;
            if (processedColors % 2048 === 0) {
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
            if (pixelsProcessed % 16384 === 0) {
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
        if (processedColors % 8192 === 0) {
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

async function encodeColorLimitedFrames(rawFrames, width, height, maxColors, onProgress) {
    const packedFrames = [];
    const paletteMetadata = [];
    for (let index = 0; index < rawFrames.length; index++) {
        const rgba = rawFrames[index];
        const result = await createPaletteFromRGBA(
            rgba,
            width,
            height,
            maxColors,
            fraction => {
                if (onProgress) {
                    onProgress((index + fraction) / rawFrames.length * 0.4);
                }
            }
        );
        let hasTransparency = false;
        for (let offset = 3; offset < rgba.length; offset += 4) {
            if (rgba[offset] === 0) {
                hasTransparency = true;
                break;
            }
        }
        const transparentIndex = hasTransparency ? result.palette.length : -1;
        const symbolCount = result.palette.length + (hasTransparency ? 1 : 0);
        const bitDepth = Math.max(1, Math.ceil(Math.log2(Math.max(2, symbolCount))));
        const packed = new Uint8Array(
            Math.ceil(width * height * bitDepth / 8)
        );
        let packedIndex = 0;
        let bitBuffer = 0;
        let bufferedBits = 0;
        for (let pixel = 0; pixel < width * height; pixel++) {
            const offset = pixel * 4;
            let paletteIndex;
            if (rgba[offset + 3] === 0) {
                paletteIndex = transparentIndex;
            } else {
                const key = getColorBinKey(
                    rgba[offset],
                    rgba[offset + 1],
                    rgba[offset + 2],
                    rgba[offset + 3]
                );
                paletteIndex = result.colorIndexes.get(key);
            }
            bitBuffer = (bitBuffer << bitDepth) | paletteIndex;
            bufferedBits += bitDepth;
            while (bufferedBits >= 8) {
                bufferedBits -= 8;
                packed[packedIndex] =
                    (bitBuffer >> bufferedBits) & 255;
                packedIndex++;
                bitBuffer &= (1 << bufferedBits) - 1;
            }
            if (pixel > 0 && pixel % 16384 === 0) {
                if (onProgress) {
                    onProgress(
                        0.4 +
                            (index + pixel / (width * height)) /
                                rawFrames.length * 0.2
                    );
                }
                await yieldToBrowser();
            }
        }
        if (bufferedBits > 0) {
            packed[packedIndex] = bitBuffer << (8 - bufferedBits);
        }
        const payload = new Uint8Array(result.palette.length * 4 + packed.length);
        let payloadOffset = 0;
        for (const color of result.palette) {
            for (let channel = 0; channel < 4; channel++) {
                payload[payloadOffset] = color[channel];
                payloadOffset++;
            }
        }
        payload.set(packed, payloadOffset);
        packedFrames.push(payload);
        paletteMetadata.push({
            paletteLength: result.palette.length,
            bitDepth,
            transparentIndex
        });
        if (onProgress) {
            onProgress(
                0.4 +
                    (index + 1) / rawFrames.length * 0.2
            );
        }
    }
    const encodedFrames = await encodeCompressedFrames(packedFrames, (completed, total) => {
        if (onProgress) {
            onProgress(0.6 + (completed / total) * 0.4);
        }
    });
    return encodedFrames.map((frame, index) => Object.assign(
        frame,
        paletteMetadata[index]
    ));
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

async function wrapPixelArtCode(width, height, frames, isGIF, maxColors, onProgress) {
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
    return `/* Pixel-art image data: ${width}x${height}; up to ${maxColors} colors */\n` +
        `function ${functionName}(x, y, size, frame) {\n` +
        `    if (!${functionName}.createData) {\n` +
        `        ${functionName}.createData = {\n` +
        `            format: "DKP2",\n` +
        `            width: ${width},\n` +
        `            height: ${height},\n` +
        `            frames: [\n${encodedFrames}\n            ]\n` +
        `        };\n` +
        `    }\n` +
        `    drawHugePixelArt(x, y, size, ${functionName}.createData, null, frame);\n` +
        `}\n\n/* Example usage:\n${usage}\n*/`;
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
    onProgress
) {
    const expectedFrameLength = maxColors === null
        ? width * height * 4
        : null;
    frames.forEach((frame, index) => {
        if (!frame || !Array.isArray(frame.chunks) || frame.chunks.some(chunk => !chunk)) {
            throw new Error(`Encoded frame ${index + 1} is incomplete.`);
        }
        const expectedLength = maxColors === null
            ? expectedFrameLength
            : frame.paletteLength * 4 +
                Math.ceil(width * height * frame.bitDepth / 8);
        if (frame.length !== expectedLength) {
            throw new Error(
                maxColors === null
                    ? `Encoded frame ${index + 1} declares ${frame.length} bytes; expected ${expectedLength} RGBA bytes.`
                    : `Encoded frame ${index + 1} declares ${frame.length} encoded palette/index bytes; expected ${expectedLength}.`
            );
        }
        if (maxColors !== null &&
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
        const chunkLength = frame.chunks.reduce((sum, chunk) => {
            if (!Number.isSafeInteger(chunk.length) || chunk.length <= 0 ||
                !Number.isSafeInteger(chunk.encodedLength) || chunk.encodedLength <= 0 ||
                chunk.baseK !== true || typeof chunk.data !== 'string' ||
                chunk.data.length !== getBaseKCharacterCount(chunk.encodedLength)) {
                throw new Error(`Encoded frame ${index + 1} has invalid chunk metadata.`);
            }
            return sum + chunk.length;
        }, 0);
        if (chunkLength !== frame.length) {
            throw new Error(`Encoded frame ${index + 1} chunks total ${chunkLength} bytes; expected ${frame.length}.`);
        }
    });
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
    const totalSerializationItems = frames.reduce((total, frame) => {
        return total + Object.keys(frame).reduce((frameTotal, key) => {
            const value = frame[key];
            return frameTotal +
                (Array.isArray(value) ? value.length : 1);
        }, 0);
    }, 0);
    let completedSerializationItems = 0;
    let serializationItemsSinceYield = 0;
    const serializedFrames = [];
    for (const frame of frames) {
        const properties = [];
        for (const key of Object.keys(frame)) {
            const value = frame[key];
            let serializedValue;
            if (Array.isArray(value)) {
                const itemSegments = [];
                let items = [];
                for (const item of value) {
                    items.push(JSON.stringify(item));
                    completedSerializationItems++;
                    serializationItemsSinceYield++;
                    if (onProgress) {
                        onProgress(
                            completedSerializationItems /
                                totalSerializationItems
                        );
                    }
                    if (serializationItemsSinceYield === 32) {
                        serializationItemsSinceYield = 0;
                        itemSegments.push(items.join(','));
                        items = [];
                        await yieldToBrowser();
                    }
                }
                if (items.length) {
                    itemSegments.push(items.join(','));
                }
                serializedValue = `[${itemSegments.join(',')}]`;
            } else {
                serializedValue = JSON.stringify(value);
                completedSerializationItems++;
                if (onProgress) {
                    onProgress(
                        completedSerializationItems /
                            totalSerializationItems
                    );
                }
            }
            properties.push(
                `${JSON.stringify(key)}:${serializedValue}`
            );
        }
        serializedFrames.push(`{${properties.join(',')}}`);
    }
    const encodedFrames = serializedFrames.join(',\n    ');
    const audioFunctionName = `play${funcName.slice(4)}Audio`;
    const startFunctionName = `start${funcName.slice(4)}`;
    const videoStartFrameName = `${funcName}StartFrame`;
    const outputFormat = maxColors === null ? 'DKL4' : 'DKC5';
    const mediaDataGetterName = `get${funcName}Data`;
    let mediaDataGetterCode = '';
    let frameDataInitialization = '';
    if (mediaType === 'video' && audioBase64) {
        const header = `{"format":${JSON.stringify(outputFormat)},"width":${width},"height":${height},"frames":[`;
        const escapedSegments = [JSON.stringify(header).slice(1, -1)];
        for (let index = 0; index < serializedFrames.length; index++) {
            if (index > 0) escapedSegments.push(',');
            escapedSegments.push(
                JSON.stringify(serializedFrames[index]).slice(1, -1)
            );
            if (index % 16 === 15) await yieldToBrowser();
        }
        const footer = `],"audio":${JSON.stringify(audioBase64)}}`;
        escapedSegments.push(JSON.stringify(footer).slice(1, -1));
        mediaDataGetterCode =
            `function ${mediaDataGetterName}() {\n` +
            `    if (!${mediaDataGetterName}.data) {\n` +
            `        var combinedMediaData = dkParseJSON("${escapedSegments.join('')}");\n` +
            `        ${mediaDataGetterName}.data = combinedMediaData;\n` +
            `    }\n` +
            `    return ${mediaDataGetterName}.data;\n` +
            `}\n\n`;
        frameDataInitialization = `${funcName}.createData = ${mediaDataGetterName}();`;
    } else {
        frameDataInitialization =
            `${funcName}.createData = {format: "${outputFormat}", width: ${width}, height: ${height}, frames: [\n    ${encodedFrames}\n        ]};`;
    }
    const usage = mediaType === 'video' && audioBase64
        ? `var ${videoStartFrameName} = null;\n\nfunction ${startFunctionName}() {\n    ${videoStartFrameName} = null;\n    ${audioFunctionName}(1, function() {\n        ${videoStartFrameName} = frameCount;\n    });\n}\n\ndraw = function() {\n    ${funcName}(0, 0, 1, ${videoStartFrameName} === null ? 0 : frameCount - ${videoStartFrameName});\n};\n\nmouseClicked = function() {\n    ${startFunctionName}();\n};`
        : isAnimation
            ? `// For animation:\ndraw = function() {\n    ${funcName}(0, 0, 1, frameCount);\n};`
        : `${funcName}(0, 0, 1, 0);`;
    const imageDescription = maxColors === null
        ? `Lossless DK Converter ${mediaType} data`
        : `Color-limited DK Converter ${mediaType} data (maximum ${maxColors} colors)`;
    const payloadDescription = maxColors === null
        ? 'RGBA bytes'
        : 'embedded palette RGBA bytes and packed palette-index bytes';
    const audioCode = audioBase64
        ? `\n\nfunction ${audioFunctionName}(volume, afterStart) {\n` +
            `    dkPlayAudio(${JSON.stringify(funcName)}, ${mediaDataGetterName}().audio, volume, afterStart);\n` +
            `}`
        : '';
    return `/*\n${imageDescription}: ${width}x${height}, ${frames.length} frame(s)\n${payloadDescription}: ${rawBytes}; encoded data characters: ${payloadCharacters}\n*/\n` +
        mediaDataGetterCode +
        `function ${funcName}(x, y, size, frame) {\n` +
        `    if (!${funcName}.createData) {\n` +
        `        ${frameDataInitialization}\n` +
        `    }\n` +
        `    drawHugePixelArt(x, y, size, ${funcName}.createData, null, frame);\n` +
        `}${audioCode}\n\n/*// Example usage:\n${usage}` +
        (audioBase64
            ? `\n// Click the canvas to start synchronized video and audio playback.`
            : '') +
        `\n*/`;
}

function updateUtilityCode(includeAudio, includeParser) {
    const utilityParts = [baseUtilityCode];
    if (includeParser) utilityParts.push(dataParserCode);
    if (includeAudio) utilityParts.push(audioUtilityCode);
    fullUtilityCode = utilityParts.join('\n');
    const utilityOutput = document.getElementById('utilityOutput');
    utilityOutput.textContent = createCodePreview(fullUtilityCode);
    utilityOutput.classList.add('code-preview');
}

async function finishConversion(
    width,
    height,
    frames,
    mediaType,
    pixelArt,
    maxColors,
    audioBase64
) {
    let payloadCharacters = 0;
    let outputCode;
    updateProgress(86, 'Preparing generated code...');
    await yieldToBrowser();
    if (pixelArt) {
        payloadCharacters = frames.reduce((total, frame) =>
            total + frame.rows.reduce((rowTotal, row) => rowTotal + row.length, 0), 0);
        outputCode = await wrapPixelArtCode(
            width,
            height,
            frames,
            mediaType !== 'image',
            maxColors,
            fraction => updateProgress(
                86 + fraction * 13,
                'Building editable output code...'
            )
        );
        const usedColors = frames.reduce((maximum, frame) =>
            Math.max(maximum, frame.palette.length), 0);
        document.getElementById('rectCount').textContent =
            `${width * height * frames.length} pixels; ${usedColors} colors`;
    } else {
        payloadCharacters = frames.reduce((total, frame) =>
            total + frame.chunks.reduce((frameTotal, chunk) => frameTotal + chunk.data.length, 0), 0);
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
                86 + fraction * 13,
                'Building generated output code...'
            )
        );
        document.getElementById('rectCount').textContent =
            `${width * height * frames.length} pixels encoded`;
    }
    updateProgress(99, 'Preparing the code preview...');
    await yieldToBrowser();
    fullImageCode = outputCode;
    document.getElementById('copy-all-button').disabled = false;
    const imageOutput = document.getElementById('jsOutput');
    imageOutput.textContent = createCodePreview(outputCode);
    imageOutput.classList.add('code-preview');
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('success').textContent =
        `${pixelArt ? 'Pixel-art' : maxColors === null ? 'Lossless' : 'Color-limited'} ${mediaType} processed (${frames.length} frame${frames.length === 1 ? '' : 's'}); ${payloadCharacters.toLocaleString()} frame-data characters.${audioBase64 ? ` Embedded ${audioBase64.length.toLocaleString()} MP3 characters; click the canvas to start synchronized video and audio.` : ''}`;
    document.getElementById('success').style.display = 'block';
    updateProgress(100, 'Conversion complete.');
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('generate-button').disabled = false;
    document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateCount();
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
    const response = await fetch(url);
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
        if (onProgress && totalLength) {
            onProgress(Math.min(1, receivedLength / totalLength));
        }
    }
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
            updateProgress(5, 'Downloading the FFmpeg video engine (first use only)...');
            const wasmUrl = await downloadFFmpegAsset(
                FFMPEG_WASM_URL,
                'application/wasm',
                fraction => updateProgress(
                    5 + fraction * 10,
                    `Downloading FFmpeg conversion engine (${Math.round(fraction * 100)}%)...`
                )
            );
            const ffmpeg = new ffmpegModule.FFmpeg();
            await ffmpeg.load({
                classWorkerURL: workerUrl,
                coreURL: FFMPEG_CORE_URL,
                wasmURL: wasmUrl
            });
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

function getAudioEncodingOptions(quality) {
    return {
        bitrate: Math.round(8 + ((quality - 1) / 99) * 312),
        sampleRate: quality <= 5
            ? 8000
            : quality <= 15
                ? 11025
                : quality <= 35
                    ? 22050
                    : 44100,
        channels: quality <= 35 ? 1 : 2,
        lowPass: quality <= 5
    };
}

function createAudioOutputCode(audioBase64) {
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
        `    var audioData = ${JSON.stringify(audioBase64)};\n` +
        `    dkPlayAudio(${JSON.stringify(functionName)}, audioData, volume);\n` +
        `}\n\n` +
        `// Call ${functionName}(1) from a user click to play the audio.`;
}

async function finishAudioConversion(audioBase64) {
    updateProgress(90, 'Preparing audio playback code...');
    await yieldToBrowser();
    fullImageCode = createAudioOutputCode(audioBase64);
    document.getElementById('copy-all-button').disabled = false;
    const imageOutput = document.getElementById('jsOutput');
    imageOutput.textContent = createCodePreview(fullImageCode);
    imageOutput.classList.add('code-preview');
    document.getElementById('rectCount').textContent =
        `${audioBase64.length.toLocaleString()} embedded audio characters`;
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('success').textContent =
        `Audio converted successfully; ${audioBase64.length.toLocaleString()} embedded MP3 characters. Call the generated play function from a user click.`;
    document.getElementById('success').style.display = 'block';
    updateProgress(100, 'Conversion complete.');
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('generate-button').disabled = false;
    document.getElementById('result-section').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
    updateCount();
}

async function processVideo(file, maxDimension, settings) {
    updateProgress(2, 'Loading video conversion engine...');
    const ffmpeg = await getFFmpegRuntime();
    updateProgress(16, 'Preparing the video for conversion...');
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    let captureInputLog = null;
    let captureEncodeLog = null;
    let updateVideoProgress = null;
    try {
        await ffmpeg.writeFile('/input-media', sourceBytes);
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
        settings.maxColors = getEffectiveMaxColors(
            dimensions.width,
            dimensions.height,
            settings.requestedMaxColors,
            false
        );
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
        args.push('-an', '-y', '/frame-%06d.png');
        if (hasAudio) {
            args.push(
                '-map', '0:a:0',
                '-vn',
                ...(audioEncoding.lowPass ? ['-af', 'lowpass=f=1200'] : []),
                '-codec:a', 'libmp3lame',
                '-b:a', `${audioEncoding.bitrate}k`,
                '-ar', String(audioEncoding.sampleRate),
                '-ac', String(audioEncoding.channels),
                '-y', '/audio.mp3'
            );
        }

        let encodingProgress = 0;
        updateVideoProgress = event => {
            if (Number.isFinite(event.progress) && event.progress >= 0) {
                encodingProgress = Math.max(encodingProgress, Math.min(1, event.progress));
                updateProgress(
                    16 + encodingProgress * 38,
                    hasAudio
                        ? 'Extracting frames and compressing audio...'
                        : 'Extracting video frames...'
                );
            }
        };
        updateProgress(
            16,
            hasAudio
                ? 'Extracting video frames and compressing audio...'
                : 'Extracting video frames...'
        );
        const encodeLogs = [];
        captureEncodeLog = entry => encodeLogs.push(entry.message);
        ffmpeg.on('log', captureEncodeLog);
        ffmpeg.on('progress', updateVideoProgress);
        let encodeExitCode;
        try {
            encodeExitCode = await ffmpeg.exec(args);
        } finally {
            ffmpeg.off('log', captureEncodeLog);
            captureEncodeLog = null;
            ffmpeg.off('progress', updateVideoProgress);
            updateVideoProgress = null;
        }
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
        const batchSize = 16;
        const frameDelay = stride * 100 / frameRate;
        const finalFrameDelay = Math.max(
            1,
            (duration - ((frameFiles.length - 1) * stride / frameRate)) * 100
        );
        for (let start = 0; start < frameFiles.length; start += batchSize) {
            const batchFiles = frameFiles.slice(start, start + batchSize);
            const rawFrames = [];
            for (let index = 0; index < batchFiles.length; index++) {
                const fileName = batchFiles[index];
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
                    54 + ((start + index + 1) / frameFiles.length) * 18,
                    `Preparing video frame ${start + index + 1} of ${frameFiles.length}...`
                );
            }
            const encodedBatch = await encodeColorLimitedFrames(
                rawFrames,
                dimensions.width,
                dimensions.height,
                settings.maxColors,
                fraction => updateProgress(
                    72 + ((start + fraction * batchFiles.length) / frameFiles.length) * 13,
                    `Applying color cap to video frames (${Math.min(frameFiles.length, start + Math.ceil(fraction * batchFiles.length))} of ${frameFiles.length})...`
                )
            );
            encodedBatch.forEach((frame, index) => {
                frame.delay = start + index === frameFiles.length - 1
                    ? finalFrameDelay
                    : frameDelay;
                frames.push(frame);
            });
        }

        let audioBase64 = null;
        if (hasAudio) {
            const audioBytes = await ffmpeg.readFile('/audio.mp3');
            audioBase64 = encodeBytesAsBase64(audioBytes);
        }
        await finishConversion(
            dimensions.width,
            dimensions.height,
            frames,
            'video',
            false,
            settings.maxColors,
            audioBase64
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
    updateProgress(16, 'Preparing audio for compression...');
    let captureLog = null;
    let updateAudioProgress = null;
    try {
        const sourceBytes = new Uint8Array(await file.arrayBuffer());
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
        if (audioEncoding.lowPass) {
            args.push('-af', 'lowpass=f=1200');
        }
        args.push(
            '-codec:a', 'libmp3lame',
            '-b:a', `${audioEncoding.bitrate}k`,
            '-ar', String(audioEncoding.sampleRate),
            '-ac', String(audioEncoding.channels),
            '-y', '/audio-output.mp3'
        );
        updateAudioProgress = event => {
            if (Number.isFinite(event.progress) && event.progress >= 0) {
                updateProgress(
                    16 + Math.min(1, event.progress) * 65,
                    'Compressing audio...'
                );
            }
        };
        ffmpeg.on('progress', updateAudioProgress);
        let exitCode;
        try {
            exitCode = await ffmpeg.exec(args);
        } finally {
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
        await finishAudioConversion(encodeBytesAsBase64(outputBytes));
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
    const batchSize = 32;

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
        const encodeBatch = settings.pixelArt
            ? encodePixelArtFrames(
                batchFrames,
                outputDimensions.width,
                outputDimensions.height,
                settings.maxColors,
                (fraction, total) => {
                    updateGIFProgress(
                        50 * (decodedFrameCount / frameCount) +
                        50 * ((encodedFrameCount + fraction * batchLength) / outputFrameCount),
                        `Creating pixel art (${Math.min(outputFrameCount, encodedFrameCount + Math.ceil(fraction * batchLength))} of ${outputFrameCount} GIF frames)...`
                    );
                }
            )
            : settings.maxColors !== null
                ? encodeColorLimitedFrames(
                    batchFrames,
                    outputDimensions.width,
                    outputDimensions.height,
                    settings.maxColors,
                    fraction => {
                        const completedFrameFraction = encodedFrameCount + fraction * batchLength;
                        updateGIFProgress(
                            50 * (decodedFrameCount / frameCount) +
                                50 * (completedFrameFraction / outputFrameCount),
                            `Applying color cap and compressing GIF frames (${Math.min(outputFrameCount, Math.ceil(completedFrameFraction))} of ${outputFrameCount})...`
                        );
                    }
                )
                : encodeCompressedFrames(batchFrames, (completed, total) => {
                    const fraction = total ? completed / total : 1;
                    const completedFrameFraction = encodedFrameCount + fraction * batchLength;
                    updateGIFProgress(
                        50 * (decodedFrameCount / frameCount) + 50 * (completedFrameFraction / outputFrameCount),
                        `Compressing GIF frames (${Math.min(batchLength, Math.ceil(fraction * batchLength))} of ${batchLength} in current batch)...`
                    );
                });
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

        if (rawFrames.length >= batchSize || i === frameCount - 1) {
            await compressFrameBatch(i + 1);
        }
    }

    await finishConversion(
        outputCanvas.width,
        outputCanvas.height,
        frames,
        'GIF',
        settings.pixelArt,
        settings.maxColors
    );
}

function showLoading() {
    const fileInput = document.getElementById('image_file');
    if (!fileInput.files.length) return true;
    highestProgress = 0;
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
    document.getElementById('error').textContent = `Conversion failed: ${error.message || error}`;
    document.getElementById('error').style.display = 'block';
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('generate-button').disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
    const convertedCount = Number(localStorage.getItem('dk_converted_count') || 0);
    document.getElementById('converted-count').textContent = String(convertedCount);
    const maxResolutionInput = document.getElementById('max_resolution');
    const savedMaxResolution = localStorage.getItem('dk_last_max_resolution');
    if (savedMaxResolution !== null) {
        maxResolutionInput.value = savedMaxResolution;
    }
    const imageFileInput = document.getElementById('image_file');
    const gifFrameOptions = document.getElementById('gif-frame-options');
    const maxFramesInput = document.getElementById('max_frames');
    const maxFramesLabel = document.getElementById('max-frames-label');
    const maxFramesHelp = document.getElementById('max-frames-help');
    const mediaAudioOptions = document.getElementById('media-audio-options');
    const imageVideoOptions = document.getElementById('image-video-options');
    const audioQualityInput = document.getElementById('audio_quality');
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
    function updateMediaOptions() {
        const file = imageFileInput.files[0];
        const isGIF = !!file && isGIFFile(file);
        const isVideo = !!file && isVideoFile(file);
        const isAudio = !!file && isAudioFile(file);
        audioUtilityRequired = isVideo || isAudio;
        dataParserRequired = isVideo;
        updateUtilityCode(audioUtilityRequired, dataParserRequired);
        imageVideoOptions.hidden = isAudio;
        gifFrameOptions.hidden = !isGIF && !isVideo;
        mediaAudioOptions.hidden = !isVideo && !isAudio;
        maxFramesLabel.textContent = isVideo ? 'Maximum video frames' : 'Maximum GIF frames';
        maxFramesHelp.textContent = isVideo
            ? 'Leave blank for all frames. Video sampling uses a whole-frame interval and may use substantial memory.'
            : 'Leave blank for all frames. Long GIFs are sampled at a whole-frame interval.';
        updateColorCapOptions();
    }
    imageFileInput.addEventListener('change', updateMediaOptions);
    const pixelArtInput = document.getElementById('pixel_art_mode');
    const pixelArtOptions = document.getElementById('pixel-art-options');
    const capColorsInput = document.getElementById('cap_colors');
    const maxColorsOptions = document.getElementById('max-colors-options');
    const maxColorsInput = document.getElementById('max_colors');
    const maxColorsHelp = document.getElementById('max-colors-help');
    let capColorsBeforeVideo = null;
    function updateColorCapOptions() {
        const file = imageFileInput.files[0];
        const videoSelected = !!file && isVideoFile(file);
        const audioSelected = !!file && isAudioFile(file);
        imageVideoOptions.hidden = audioSelected;
        if (videoSelected && capColorsBeforeVideo === null) {
            capColorsBeforeVideo = capColorsInput.checked;
        } else if (!videoSelected && capColorsBeforeVideo !== null) {
            capColorsInput.checked = capColorsBeforeVideo;
            capColorsBeforeVideo = null;
        }
        pixelArtOptions.hidden = videoSelected;
        pixelArtInput.disabled = videoSelected;
        if (pixelArtInput.checked && !videoSelected) {
            capColorsInput.checked = true;
        }
        if (videoSelected) capColorsInput.checked = true;
        capColorsInput.disabled = pixelArtInput.checked || videoSelected;
        const pixelArt = pixelArtInput.checked && !videoSelected;
        const colorCapEnabled = pixelArt || videoSelected || capColorsInput.checked;
        maxColorsOptions.hidden = !colorCapEnabled;
        maxColorsInput.disabled = !colorCapEnabled;
        maxColorsInput.max = pixelArt
            ? String(PIXEL_COLOR_ALPHABET.length)
            : String(MAX_COLOR_BINS);
        maxColorsHelp.textContent = videoSelected
            ? 'Video always uses color reduction. Blank uses the automatic limit (output pixels ÷ 500).'
            : pixelArt
                ? 'Up to 93 colors are supported; fully transparent pixels stay transparent.'
                : 'Blank uses the automatic limit (output pixels ÷ 500). Up to 1,048,576 palette colors are supported.';
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
        const pixelArt = !isVideo && !isAudio && pixelArtInput.checked;
        const capColors = isVideo || (!isAudio && (pixelArt || capColorsInput.checked));
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
                    updateProgress(10, 'Building editable pixel art...');
                    frames = await encodePixelArtFrames(
                        [new Uint8Array(image.rgba)],
                        image.width,
                        image.height,
                        settings.maxColors,
                        (fraction, total) => {
                            updateProgress(
                                10 + fraction * 75,
                                `Building pixel art (${Math.min(total, Math.ceil(fraction * total))} of ${total} frames)...`
                            );
                        }
                    );
                } else if (capColors) {
                    settings.maxColors = getEffectiveMaxColors(
                        image.width,
                        image.height,
                        requestedMaxColors,
                        false
                    );
                    updateProgress(10, 'Applying color cap and encoding...');
                    frames = await encodeColorLimitedFrames(
                        [new Uint8Array(image.rgba)],
                        image.width,
                        image.height,
                        settings.maxColors,
                        fraction => {
                            updateProgress(
                                10 + fraction * 75,
                                fraction < 0.5
                                    ? 'Applying color cap...'
                                    : 'Compressing color-limited image data...'
                            );
                        }
                    );
                } else {
                    updateProgress(10, 'Image loaded. Compressing image data...');
                    frames = await encodeCompressedFrames(
                        [new Uint8Array(image.rgba)],
                        (completed, total) => {
                            updateProgress(
                                10 + (completed / total) * 75,
                                `Compressing image data (${completed} of ${total} chunks)...`
                            );
                        }
                    );
                }
                await finishConversion(
                    image.width,
                    image.height,
                    frames,
                    'image',
                    pixelArt,
                    settings.maxColors
                );
            }
        } catch (error) {
            reportError(error);
        }
    });

    const utilityTemplate = document.getElementById('utilityOutput').textContent
        .replace('__DK_ALPHABET__', JSON.stringify(BYTE_ALPHABET.join('')))
        .trim();
    const parserStartMarker = '// DK JSON PARSER SUPPORT START';
    const parserEndMarker = '// DK JSON PARSER SUPPORT END';
    const parserStart = utilityTemplate.indexOf(parserStartMarker);
    const parserEnd = utilityTemplate.indexOf(parserEndMarker, parserStart);
    if (parserStart < 0 || parserEnd < 0) {
        throw new Error('DK Converter utility parser markers are missing.');
    }
    dataParserCode = utilityTemplate.slice(
        parserStart + parserStartMarker.length,
        parserEnd
    ).trim();
    const utilityWithoutParser = (
        utilityTemplate.slice(0, parserStart) +
        utilityTemplate.slice(parserEnd + parserEndMarker.length)
    ).trim();
    const audioStartMarker = '// DK AUDIO SUPPORT START';
    const audioEndMarker = '// DK AUDIO SUPPORT END';
    const audioStart = utilityWithoutParser.indexOf(audioStartMarker);
    const audioEnd = utilityWithoutParser.indexOf(audioEndMarker, audioStart);
    if (audioStart < 0 || audioEnd < 0) {
        throw new Error('DK Converter utility audio markers are missing.');
    }
    baseUtilityCode = (
        utilityWithoutParser.slice(0, audioStart) +
        utilityWithoutParser.slice(audioEnd + audioEndMarker.length)
    ).trim();
    audioUtilityCode = utilityWithoutParser.slice(
        audioStart + audioStartMarker.length,
        audioEnd
    ).trim();
    updateUtilityCode(audioUtilityRequired, dataParserRequired);
});

function copyResult(button) {
    copyText(fullImageCode, button);
}

function copyUtility(button) {
    copyText(fullUtilityCode, button);
}

function copyAll(button) {
    copyText(`${fullUtilityCode}\n\n${fullImageCode}`, button);
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
