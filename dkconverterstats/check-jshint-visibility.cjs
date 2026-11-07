const fs = require("node:fs");

const html = fs.readFileSync("dkconverter/index.html", "utf8");
const openTag = '<pre id="utilityOutput" class="language-javascript">';
const start = html.indexOf(openTag);
const end = html.indexOf("</pre>", start);
const utility = html
    .slice(start + openTag.length, end)
    .replace(/\r\n/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const stripped = utility.replace(
    /\/\* jshint ignore:\s*start \*\/[\s\S]*?\/\* jshint ignore:\s*end \*\//g,
    "\n"
);

const hasDecl = /\bvar\s+dkFzstd\b/.test(stripped);
const hasUse = /\bdkFzstd\s*\./.test(stripped);
const assignOutsideIgnore = /\bdkFzstd\s*=/.test(stripped);

if (!hasDecl) {
    throw new Error("var dkFzstd must remain outside jshint ignore so KA can see it.");
}
if (!hasUse) {
    throw new Error("dkFzstd.decompress use missing after ignore strip.");
}
if (assignOutsideIgnore) {
    throw new Error("dkFzstd assignment should stay inside jshint ignore.");
}

console.log("JSHint visibility check passed: dkFzstd is declared outside ignore.");
