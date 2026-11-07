const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("dkconverter/converter.js", "utf8");
const start = source.indexOf("function getValidMp3Bitrates");
const end = source.indexOf("function createAudioOutputCode");
if (start < 0 || end < 0) {
    throw new Error("Could not isolate audio encoding options.");
}
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const seen = new Map();
for (let quality = 1; quality <= 100; quality++) {
    const options = vm.runInContext(
        "getAudioEncodingOptions(" + quality + ")",
        context
    );
    const key = JSON.stringify(options);
    if (seen.has(key)) {
        throw new Error(
            "Quality " + quality + " matches quality " + seen.get(key) +
            ": " + key
        );
    }
    seen.set(key, quality);
}
const first = vm.runInContext("getAudioEncodingOptions(1)", context);
const last = vm.runInContext("getAudioEncodingOptions(100)", context);
console.log(JSON.stringify({ unique: seen.size, first, last }, null, 2));
