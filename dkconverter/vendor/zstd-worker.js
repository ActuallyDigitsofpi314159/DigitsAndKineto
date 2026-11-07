/*
 * DK Converter Zstandard worker. The library is vendored beside this file so
 * the converter can run without a network connection.
 */
importScripts('./zstd_wasm.umd.js');

let zstdReadyPromise = null;

async function initializeZstd() {
    if (!zstdReadyPromise) {
        zstdReadyPromise = zstdCodec.ZstdInit();
    }
    await zstdReadyPromise;
}

self.onmessage = async event => {
    const message = event.data || {};
    if (message.type === 'init') {
        try {
            await initializeZstd();
            self.postMessage({ type: 'ready' });
        } catch (error) {
            self.postMessage({
                type: 'error',
                message: error && error.message || String(error)
            });
        }
        return;
    }
    if (message.type !== 'compress' || !Number.isSafeInteger(message.id) ||
        !(message.bytes instanceof ArrayBuffer)) {
        return;
    }

    try {
        await initializeZstd();
        const source = new Uint8Array(message.bytes);
        const padding = Math.max(0, 101 - source.length);
        const input = padding
            ? new Uint8Array(source.length + padding)
            : source;
        if (padding) input.set(source);

        const chunks = [];
        let compressedLength = 0;
        const chunkSize = 4 * 1024 * 1024;
        for (let offset = 0; offset < input.length; offset += chunkSize) {
            const end = Math.min(input.length, offset + chunkSize);
            const compressed = zstdCodec.ZstdSimple.compress(
                input.subarray(offset, end), 19
            );
            chunks.push(compressed);
            compressedLength += compressed.length;
            self.postMessage({
                type: 'progress',
                id: message.id,
                fraction: end / input.length
            });
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const output = new Uint8Array(compressedLength);
        let outputOffset = 0;
        for (const chunk of chunks) {
            output.set(chunk, outputOffset);
            outputOffset += chunk.length;
        }
        self.postMessage({
            type: 'compressed',
            id: message.id,
            padding,
            bytes: output.buffer
        }, [output.buffer]);
    } catch (error) {
        self.postMessage({
            type: 'error',
            id: message.id,
            message: error && error.message || String(error)
        });
    }
};
