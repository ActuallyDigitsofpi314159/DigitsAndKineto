const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const zstdCodec = require("../dkconverter/vendor/zstd_wasm.umd.js");
const fzstd = require("../dkconverter/vendor/fzstd-ka.umd.js");

const width = 3000;
const height = 5333;
const rgbaPath = path.join(os.tmpdir(), "kitty-3000x5333-rgba.raw");
if (!fs.existsSync(rgbaPath)) {
    throw new Error("Missing 4K fixture data: " + rgbaPath);
}
const rgba = fs.readFileSync(rgbaPath);
if (rgba.length !== width * height * 4) {
    throw new Error("Unexpected 4K fixture byte length: " + rgba.length);
}

function makeContext(extra) {
    return vm.createContext(Object.assign({
        Math,
        performance,
        setTimeout,
        clearTimeout,
        DOMException,
        window: { Worker: undefined },
        Worker: undefined,
        navigator: { hardwareConcurrency: 4 },
        scheduler: { yield: () => Promise.resolve() },
        zstdCodec
    }, extra || {}));
}

function makeBase200Alphabet() {
    const alphabet = [];
    for (let codePoint = 33; codePoint <= 126; codePoint++) {
        const character = String.fromCharCode(codePoint);
        if (character !== '"' && character !== "\\") {
            alphabet.push(character);
        }
    }
    for (let codePoint = 0x100; codePoint <= 0x2FF && alphabet.length < 200; codePoint++) {
        const character = String.fromCharCode(codePoint);
        if (/\p{L}/u.test(character)) {
            alphabet.push(character);
        }
    }
    if (alphabet.length !== 200 || new Set(alphabet).size !== 200) {
        throw new Error("Could not build 200 distinct safe encoding characters.");
    }
    return alphabet;
}

function digitCount(byteCount, alphabetSize) {
    if (!byteCount) {
        return 0;
    }
    const work = new Array(byteCount).fill(255);
    let digits = 0;
    let hasValue = true;
    while (hasValue) {
        let remainder = 0;
        hasValue = false;
        for (let index = 0; index < work.length; index++) {
            const value = remainder * 256 + work[index];
            work[index] = Math.floor(value / alphabetSize);
            remainder = value % alphabetSize;
            if (work[index]) {
                hasValue = true;
            }
        }
        digits++;
    }
    return digits;
}

function encodedCharacterCount(byteCount, alphabetSize) {
    let characters = 0;
    for (let offset = 0; offset < byteCount; offset += 8) {
        characters += digitCount(
            Math.min(8, byteCount - offset),
            alphabetSize
        );
    }
    return characters;
}

async function compressInChunks(bytes, level, chunkBytes) {
    const chunks = [];
    let totalBytes = 0;
    const started = performance.now();
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        const end = Math.min(bytes.length, offset + chunkBytes);
        const compressed = zstdCodec.ZstdSimple.compress(
            bytes.subarray(offset, end),
            level
        );
        chunks.push(compressed);
        totalBytes += compressed.length;
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    return {
        compressedBytes: totalBytes,
        elapsedMs: Number((performance.now() - started).toFixed(2)),
        chunks: chunks.length,
        output: Buffer.concat(chunks)
    };
}

async function recompressChild(filePath, level, chunkBytes) {
    await zstdCodec.ZstdInit();
    const bytes = fs.readFileSync(filePath);
    const compressedChunks = [];
    const started = performance.now();
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        const end = Math.min(bytes.length, offset + chunkBytes);
        const source = bytes.subarray(offset, end);
        const compressed = zstdCodec.ZstdSimple.compress(source, level);
        const decoded = fzstd.decompress(new Uint8Array(compressed));
        if (!Buffer.from(decoded).equals(source)) {
            throw new Error("Zstandard round-trip differed for a chunk.");
        }
        compressedChunks.push(compressed);
    }
    const compressedBytes = compressedChunks.reduce(
        (total, chunk) => total + chunk.length,
        0
    );
    console.log(JSON.stringify({
        compressedBytes,
        elapsedMs: Number((performance.now() - started).toFixed(2)),
        chunks: compressedChunks.length,
        exactRoundTrip: true
    }));
}

function encodeWithAlphabet(bytes, alphabet) {
    const blockSize = 8;
    const alphabetSize = alphabet.length;
    const counts = [];
    for (let byteCount = 0; byteCount <= blockSize; byteCount++) {
        counts.push(digitCount(byteCount, alphabetSize));
    }
    const blocks = [];
    const started = performance.now();
    for (let offset = 0; offset < bytes.length; offset += blockSize) {
        const byteCount = Math.min(blockSize, bytes.length - offset);
        const work = Array.from(bytes.subarray(offset, offset + byteCount));
        const digits = [];
        let hasValue = true;
        while (hasValue) {
            let remainder = 0;
            hasValue = false;
            for (let index = 0; index < work.length; index++) {
                const value = remainder * 256 + work[index];
                work[index] = Math.floor(value / alphabetSize);
                remainder = value % alphabetSize;
                if (work[index]) {
                    hasValue = true;
                }
            }
            digits.push(alphabet[remainder]);
        }
        while (digits.length < counts[byteCount]) {
            digits.push(alphabet[0]);
        }
        blocks.push(digits.reverse().join(""));
    }
    const encoded = blocks.join("");
    return {
        characters: encoded.length,
        elapsedMs: Number((performance.now() - started).toFixed(2))
    };
}

async function main() {
    await zstdCodec.ZstdInit();
    const source = fs.readFileSync("dkconverter/converter.js", "utf8");
    const boundary = source.indexOf("\nasync function finishConversion(");
    if (boundary < 0) {
        throw new Error("Could not isolate converter encoding functions.");
    }
    const context = makeContext();
    vm.runInContext(source.slice(0, boundary), context);
    context.__rgba = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);

    const capturedInputs = [];
    const capturedCompressed = [];
    const originalCompress = zstdCodec.ZstdSimple.compress;
    zstdCodec.ZstdSimple.compress = function(bytes, level) {
        capturedInputs.push(Buffer.from(bytes));
        const compressed = originalCompress(bytes, level);
        capturedCompressed.push(Buffer.from(compressed));
        return compressed;
    };
    const start = performance.now();
    let frames;
    try {
        frames = await vm.runInContext(
            "encodeColorLimitedFrames([globalThis.__rgba], 3000, 5333, 256)",
            context
        );
    } finally {
        zstdCodec.ZstdSimple.compress = originalCompress;
    }
    const encodeMs = Number((performance.now() - start).toFixed(2));
    const frame = frames[0];
    const payload = Buffer.concat(capturedInputs);
    const compressedFrame = Buffer.concat(capturedCompressed);
    const base200Alphabet = makeBase200Alphabet();
    const currentAlphabetSize = vm.runInContext("BYTE_ALPHABET.length", context);
    const currentAlphabet = Array.from(
        vm.runInContext("BYTE_ALPHABET", context)
    );
    context.__frame = frame;
    const expectedLength = frame.paletteLength * 4 +
        Math.ceil(width * height * frame.bitDepth / 8);
    const expectedCharacters = vm.runInContext(
        "getBaseKCharacterCount(globalThis.__frame.encodedLength)",
        context
    );
    const metadataChecks = {
        formatMatchesPalette: 256 !== null && Number.isSafeInteger(frame.paletteLength),
        lengthMatches: frame.length === expectedLength,
        encodedLengthPositive: Number.isSafeInteger(frame.encodedLength) &&
            frame.encodedLength > 0,
        paddingValid: Number.isSafeInteger(frame.zstdPadding) &&
            frame.zstdPadding >= 0 && frame.zstdPadding <= 100,
        baseK: frame.baseK === true,
        blockSize: frame.baseKBlockSize === 8,
        payloadIsString: typeof frame.data === "string",
        characterCountMatches: frame.data.length === expectedCharacters,
        expectedLength,
        expectedCharacters
    };
    const baseEncoding = {
        base2115: encodeWithAlphabet(compressedFrame, currentAlphabet),
        base200: encodeWithAlphabet(compressedFrame, base200Alphabet)
    };

    const compressionExperiments = [];
    for (const experiment of [
        { level: 19, chunkBytes: 4 * 1024 * 1024 },
        { level: 22, chunkBytes: 4 * 1024 * 1024 },
        { level: 19, chunkBytes: 16 * 1024 * 1024 }
    ]) {
        const inputPath = path.join(os.tmpdir(), "dkc5-base200-probe.raw");
        try {
            fs.writeFileSync(inputPath, payload);
            const result = JSON.parse(execFileSync(process.execPath, [
                __filename,
                "--recompress",
                inputPath,
                String(experiment.level),
                String(experiment.chunkBytes)
            ], { encoding: "utf8" }));
            compressionExperiments.push(Object.assign({}, experiment, {
                compressedBytes: result.compressedBytes,
                elapsedMs: result.elapsedMs,
                chunks: result.chunks,
                exactRoundTrip: result.exactRoundTrip,
                base200Characters: encodedCharacterCount(
                    result.compressedBytes,
                    base200Alphabet.length
                )
            }));
        } catch (error) {
            compressionExperiments.push(Object.assign({}, experiment, {
                error: error.message || String(error)
            }));
        } finally {
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
        }
    }

    console.log(JSON.stringify({
        image: { width, height, pixels: width * height, sourceBytes: rgba.length },
        currentAlphabetSize,
        candidateBase200AlphabetSize: base200Alphabet.length,
        dkc5: {
            encodeMs,
            frameLength: frame.length,
            paletteLength: frame.paletteLength,
            bitDepth: frame.bitDepth,
            encodedBytesAtLevel19: frame.encodedLength,
            currentCharacters: frame.data.length,
            base200Characters: encodedCharacterCount(
                frame.encodedLength,
                base200Alphabet.length
            ),
            submittedBytesForRecompression: payload.length,
            compressedFrameBytes: compressedFrame.length,
            baseEncoding,
            metadataChecks,
            frameMetadata: {
                zstdPadding: frame.zstdPadding,
                baseK: frame.baseK,
                baseKBlockSize: frame.baseKBlockSize,
                dataLength: frame.data.length
            }
        },
        recompression: compressionExperiments,
        base200AlphabetSample: base200Alphabet.slice(92, 102)
    }, null, 2));
}

if (process.argv[2] === "--recompress") {
    recompressChild(
        process.argv[3],
        Number(process.argv[4]),
        Number(process.argv[5])
    ).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
} else {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
