
// A little more than a thousand
const LETTERS = Array.from(new Set("!#$%&'()*+,./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~¡¢£¤¥§ª«¬±µ¶º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþĀĂĄĆĊČĎĐĒĖĘĚĞĠĦĨĪĮİĶĻĽŁŃŅŇŌŒœŘŚŞŠŤŨŪŮŰŴŶŸŹŻŽžƆƒƕƙƧƨǍǏǑǓǝǫȘȚɐɞɢɪɴʀʏʙʜʟʬʭΓΔΘΛΞΠΣΦΨΩαβγδεζηθικλμνξπρστυφχψωϠϡϬЁБДЖЙЪЫЭЮЯджйъыэюяёғ৳ะ฿๐๑๒๓๕៛ᴀᴄᴅᴇᴊᴋᴍᴏᴘᴛᴜᴠᴡᴢẞẼ–†‡•…‼⁑₠₡₢₣₤₥₦₧₨₩₪₫€₭₮₯₰₱₳₴℀℁ℂ℃℅℆℉ℍℕℙℚ℠℡™ℤ⅁⅄←↑→↓↔↕↨∀∁∂∃∄∅∇∈∉∊∋∌∍∐∓√∛∜∝∞∟∧∨∩∪∫∬∭∮∴∵∷≂≃≄≅≆≇≈≠≤≥≦≧≨≩≮≯⊂⊃⊄⊅⊆⊇⊊⊋⊌⊍⊎⊕⊖⊗⊘⊙⊚⊛⊜⊠⊡⊰⊱⋇⋐⋑⋒⋓⋖⋗⋚⋛⋜⋝⋞⋟⋠⋡⋢⋣⋤⋥⋦⋧⋨⋩⋯▖▗▘▙▚▛▜▝▞▟■□▣▤▥▦▧▨▩▪▫▬▭▮▯▰▱▲▴▵►▼◀◁◄◆◇◈○◌◍◎◐◑◒◓◔◕◘◙◚◛◜◝◞◟◠◡◢◣◤◥◧◨◩◪◫◬◭◮◰◱◲◳◴◵◶◷◸◹◺◿☼♀♂♠♣♥♦♪♫⩒⫐⫑⫒ぁあぃいぅうぇえぉおかァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネハバパヒビピフブプヘベペホボPOマミムメモャヤュ伊儿吉娜开欧艾西诶贼车轩铃龙龟ぢづでどにぬねのはひふへほまみむめもやゆよらりるれろわゐゑをんゔゕゖゝゞヰヱヲヴヵヶヽヾ一二三四五六七八九十百千万上下左右中大小日月火水木金土本人力学生先語時名国年見行来気電車校海空山川花音体心手足口目耳가각간갇갈감갑값갓강개객갠갤거걱건걸검겁것겉게겨격견결겸경계고곡곤곧골곰곱곳공과곽관광괜괴교구국군굴굽궁권귀규균그극근글금급긍기긴길김깊까깍깎깡깨꺼껀껄껌껍껏께껴꼬꼭꼰꼴꼼꼽꽂꽃꽤꾀꾸꾼꿀</tool_call>꿈你我他她它們们好嗎是有無天地風雨龍馬鳥魚草森林愛新長高黒白青赤黄緑अआइईउऊऋएऐओऔंःकखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहகஙசஞடணதநபமயரலவழளறனԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖאבגדהוזחטיךכלםמןנסעףפץצקרשתАВГЕЗИKЛМНОПРСТУФХЦЧШЩЬабвгезиклмнопрстуфхцчшщь".slice(0, 1000))).join('');
// Cap max colors dynamically to the exact number of available characters
const MAX_ALLOWED_COLORS = LETTERS.length;
const DEFAULT_MAX_DIMENSION = 400;

let generatedFuncName = null;

// Perceptual color distance matching human visual sensitivity equally across all brightness levels
function colorDistance(c1, c2) {
    const dr = c1[0] - c2[0];
    const dg = c1[1] - c2[1];
    const db = c1[2] - c2[2];
    return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const diff = mx - mn;
    let h = 0;
    if (diff !== 0) {
        if (mx === r) h = (60 * ((g - b) / diff) + 360) % 360;
        else if (mx === g) h = (60 * ((b - r) / diff) + 120) % 360;
        else h = (60 * ((r - g) / diff) + 240) % 360;
    }
    const s = mx === 0 ? 0 : diff / mx;
    const v = mx;
    return [h, s, v];
}

function pixelateImage(img, maxDimension = DEFAULT_MAX_DIMENSION) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = img.width, height = img.height;
    if (Math.max(width, height) > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
    } else {
        canvas.width = width;
        canvas.height = height;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
}

function pixelateImageFromCanvas(canvas, maxDimension = DEFAULT_MAX_DIMENSION) {
    const width = canvas.width, height = canvas.height;
    if (Math.max(width, height) > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        const newCanvas = document.createElement('canvas');
        newCanvas.width = Math.max(1, Math.round(width * scale));
        newCanvas.height = Math.max(1, Math.round(height * scale));
        const ctx = newCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0, newCanvas.width, newCanvas.height);
        return newCanvas;
    }
    return canvas;
}

function pickVariedColorsFromPixels(pixels, maxColors) {
    const targetColors = Math.min(maxColors, MAX_ALLOWED_COLORS);
    const nPixels = pixels.length;
    if (nPixels === 0) return [];

    const uniquePixelMap = new Map();
    const uniquePixelList = [];
    for (let i = 0; i < nPixels; i++) {
        const p = pixels[i];
        const key = `${p[0]},${p[1]},${p[2]}`;
        if (!uniquePixelMap.has(key)) {
            uniquePixelMap.set(key, true);
            uniquePixelList.push([p[0], p[1], p[2]]);
        }
    }

    if (uniquePixelList.length <= targetColors) {
        return uniquePixelList;
    }

    let sample = pixels;
    const sampleSize = Math.min(10000, nPixels);
    if (nPixels > sampleSize) {
        sample = new Array(sampleSize);
        for (let i = 0; i < sampleSize; i++) {
            sample[i] = pixels[Math.floor(Math.random() * nPixels)];
        }
    }

    // k-means++ initialization
    let centers = [sample[Math.floor(Math.random() * sample.length)]];
    const distances = new Float64Array(sample.length).fill(Infinity);
    for (let i = 1; i < targetColors; i++) {
        const lastCenter = centers[centers.length - 1];
        let total = 0;
        for (let j = 0; j < sample.length; j++) {
            const dist = colorDistance(sample[j], lastCenter);
            if (dist < distances[j]) distances[j] = dist;
            total += distances[j];
        }
        let rand = Math.random() * total;
        for (let j = 0; j < sample.length; j++) {
            rand -= distances[j];
            if (rand <= 0) {
                centers.push(sample[j]);
                break;
            }
        }
    }

    // Lloyd iterations
    const maxIter = 10;
    for (let iter = 0; iter < maxIter; iter++) {
        const clusters = Array.from({ length: centers.length }, () => []);
        for (const pixel of sample) {
            let minDist = Infinity, idx = 0;
            for (let j = 0; j < centers.length; j++) {
                const dist = colorDistance(pixel, centers[j]);
                if (dist < minDist) { minDist = dist; idx = j; }
            }
            clusters[idx].push(pixel);
        }
        let changed = false;
        for (let j = 0; j < centers.length; j++) {
            if (clusters[j].length > 0) {
                let sumR = 0, sumG = 0, sumB = 0;
                const len = clusters[j].length;
                for (let k = 0; k < len; k++) {
                    sumR += clusters[j][k][0];
                    sumG += clusters[j][k][1];
                    sumB += clusters[j][k][2];
                }
                const newCenter = [Math.round(sumR / len), Math.round(sumG / len), Math.round(sumB / len)];
                if (newCenter[0] !== centers[j][0] || newCenter[1] !== centers[j][1] || newCenter[2] !== centers[j][2]) {
                    centers[j] = newCenter;
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }

    // Strictly enforce duplicate-free RGB output map entries
    const usedMap = new Map();
    const finalCenters = [];

    for (let c of centers) {
        let key = `${c[0]},${c[1]},${c[2]}`;
        if (!usedMap.has(key)) {
            usedMap.set(key, true);
            finalCenters.push(c);
        } else {
            let replaced = false;
            for (const candidate of uniquePixelList) {
                const candKey = `${candidate[0]},${candidate[1]},${candidate[2]}`;
                if (!usedMap.has(candKey)) {
                    usedMap.set(candKey, true);
                    finalCenters.push([candidate[0], candidate[1], candidate[2]]);
                    replaced = true;
                    break;
                }
            }
            if (!replaced) {
                let [r, g, b] = c;
                for (let dr = -5; dr <= 5 && !replaced; dr++) {
                    for (let dg = -5; dg <= 5 && !replaced; dg++) {
                        for (let db = -5; db <= 5 && !replaced; db++) {
                            const nr = Math.min(255, Math.max(0, r + dr));
                            const ng = Math.min(255, Math.max(0, g + dg));
                            const nb = Math.min(255, Math.max(0, b + db));
                            const nudgeKey = `${nr},${ng},${nb}`;
                            if (!usedMap.has(nudgeKey)) {
                                usedMap.set(nudgeKey, true);
                                finalCenters.push([nr, ng, nb]);
                                replaced = true;
                            }
                        }
                    }
                }
            }
        }
    }

    return finalCenters;
}

function pickVariedColors(canvas, maxColors) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 10) {
            pixels.push([data[i], data[i + 1], data[i + 2]]);
        }
    }
    return pickVariedColorsFromPixels(pixels, maxColors);
}

function assignLettersToColors(canvas, letters, colors) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const rows = canvas.height, cols = canvas.width;

    const uniqueMap = new Map();
    const uniqueColors = [];
    for (const c of colors) {
        const key = `${c[0]},${c[1]},${c[2]}`;
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, true);
            uniqueColors.push(c);
        }
    }

    const colorsWithVal = uniqueColors.map(c => ({
        rgb: c,
        val: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    }));
    colorsWithVal.sort((a, b) => b.val - a.val);

    const colorsSorted = colorsWithVal.map(c => c.rgb);
    const numColors = Math.min(colorsSorted.length, letters.length);
    colorsSorted.splice(numColors);

    const clusterToLetter = {};
    const letterColors = {};
    for (let i = 0; i < numColors; i++) {
        clusterToLetter[i] = letters[i];
        letterColors[letters[i]] = colorsSorted[i];
    }

    const asciiLines = [];
    for (let y = 0; y < rows; y++) {
        let line = '';
        for (let x = 0; x < cols; x++) {
            const idx = (y * cols + x) * 4;
            if (data[idx + 3] > 10) {
                const pixel = [data[idx], data[idx + 1], data[idx + 2]];
                let minDist = Infinity, colorIdx = 0;
                for (let j = 0; j < colorsSorted.length; j++) {
                    const dist = colorDistance(pixel, colorsSorted[j]);
                    if (dist < minDist) { minDist = dist; colorIdx = j; }
                }
                line += clusterToLetter[colorIdx];
            } else {
                line += '-';
            }
        }
        asciiLines.push(line);
    }
    return [asciiLines, letterColors];
}

function compressLine(line) {
    if (!line) return '';
    let out = '';
    let prev = line[0], count = 1;
    for (let i = 1; i < line.length; i++) {
        if (line[i] === prev) count++;
        else {
            out += count === 1 ? prev : prev + count;
            prev = line[i]; count = 1;
        }
    }
    out += count === 1 ? prev : prev + count;
    return out;
}

function saveJsInMemory(asciiLines, letterColors, width, height) {
    let js = `/*\n--- Image Data Generated By DK Converter ---\n${width}x${height}, ${width * height} total pixels\nwith ${Object.keys(letterColors).length} different colors used\n*/\nvar createData = [\n`;
    for (let i = 0; i < asciiLines.length; i++) {
        js += `    "${compressLine(asciiLines[i])}",\n`;
    }
    js += '];\n\nvar Colors = {\n';
    for (const [letter, [r, g, b]] of Object.entries(letterColors)) {
        js += `    "${letter}": color(${r}, ${g}, ${b}),\n`;
    }
    js += '};\n';
    return js;
}

function saveJsInMemoryForGIF(framesData, globalLetterColors, width, height) {
    let js = `/*\n--- GIF Data Generated By D.K. Converter ---\n${width}x${height}, ${framesData.length} frames, ${width * height * framesData.length} total pixels\nwith ${Object.keys(globalLetterColors).length} different colors used\n*/\nvar createData = [\n`;
    for (let f = 0; f < framesData.length; f++) {
        js += `    [\n`;
        for (let i = 0; i < framesData[f].asciiLines.length; i++) {
            js += `        "${compressLine(framesData[f].asciiLines[i])}",\n`;
        }
        js += `    ],\n`;
    }
    js += '];\n\nvar Colors = {\n';
    for (const [letter, [r, g, b]] of Object.entries(globalLetterColors)) {
        js += `    "${letter}": color(${r}, ${g}, ${b}),\n`;
    }
    js += '};\n';
    return js;
}

async function processGIF(file, maxRes, colorCount) {
    generatedFuncName = null;
    const arrayBuffer = await file.arrayBuffer();
    const gif = new GifReader(new Uint8Array(arrayBuffer));
    const numFrames = gif.numFrames();
    const frameCanvases = [];

    const gifWidth = gif.width;
    const gifHeight = gif.height;

    const persistentCanvas = document.createElement('canvas');
    persistentCanvas.width = gifWidth;
    persistentCanvas.height = gifHeight;
    const persistentCtx = persistentCanvas.getContext('2d', { willReadFrequently: true });

    let totalSampledPixels = 0;
    const sampledPixels = [];
    const maxSamples = 10000;

    for (let i = 0; i < numFrames; i++) {
        const currentImageData = persistentCtx.getImageData(0, 0, gifWidth, gifHeight);
        gif.decodeAndBlitFrameRGBA(i, currentImageData.data);
        persistentCtx.putImageData(currentImageData, 0, 0);

        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = gifWidth;
        frameCanvas.height = gifHeight;
        const frameCtx = frameCanvas.getContext('2d');
        frameCtx.drawImage(persistentCanvas, 0, 0);

        const pixelatedCanvas = pixelateImageFromCanvas(frameCanvas, maxRes);
        frameCanvases.push(pixelatedCanvas);

        const pCtx = pixelatedCanvas.getContext('2d');
        const pImageData = pCtx.getImageData(0, 0, pixelatedCanvas.width, pixelatedCanvas.height);
        const data = pImageData.data;

        for (let j = 0; j < data.length; j += 4) {
            if (data[j + 3] > 10) {
                totalSampledPixels++;
                const px = [data[j], data[j + 1], data[j + 2]];
                if (sampledPixels.length < maxSamples) {
                    sampledPixels.push(px);
                } else {
                    const rIdx = Math.floor(Math.random() * totalSampledPixels);
                    if (rIdx < maxSamples) sampledPixels[rIdx] = px;
                }
            }
        }
    }

    const combinedColors = pickVariedColorsFromPixels(sampledPixels, colorCount);

    const framesData = [];
    const globalLetterColors = {};

    for (const canvas of frameCanvases) {
        const [asciiLines, letterColors] = assignLettersToColors(canvas, LETTERS, combinedColors);
        framesData.push({ asciiLines });
        Object.assign(globalLetterColors, letterColors);
    }

    const jsContent = saveJsInMemoryForGIF(framesData, globalLetterColors, frameCanvases[0].width, frameCanvases[0].height);
    const wrappedCode = getWrappedResultCode(jsContent, true);
    document.getElementById('jsOutput').textContent = wrappedCode;

    document.getElementById('rectCount').textContent = `${frameCanvases[0].width * frameCanvases[0].height * numFrames}`;
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('success').textContent = `GIF processed successfully! (${numFrames} frames)`;
    document.getElementById('success').style.display = 'block';
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('generate-button').disabled = false;
    document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });

    let convertedCount = parseInt(localStorage.getItem('dk_converted_count') || '0', 10);
    convertedCount += 1;
    localStorage.setItem('dk_converted_count', String(convertedCount));
    document.getElementById('converted-count').textContent = String(convertedCount);
}

function getWrappedResultCode(rawCode, isGIF = false) {
    const prefix = isGIF ? 'drawGIF' : 'drawImage';
    if (!generatedFuncName) {
        const funcNum = Math.floor(Math.random() * 900) + 100;
        generatedFuncName = prefix + funcNum;
    }
    const funcName = generatedFuncName;

    let body = rawCode.trim();
    let header = "";
    if (body.startsWith('/*')) {
        const endIdx = body.indexOf('*/');
        if (endIdx !== -1) {
            header = body.slice(0, endIdx + 2) + "\n\n";
            body = body.slice(endIdx + 2).trim();
        }
    }

    const usageComment = isGIF
        ? `// For drawing a frame: ${funcName}(0, 0, 1, 0);\n// For animation:\ndraw = function() {\n    ${funcName}(0, 0, 1, frameCount);\n};`
        : `${funcName}(0, 0, 1, 0);`;

    const gifNote = isGIF ? "    // For GIFs, createData is an array of frames, frame wraps around\n" : "";

    const indentedBody = body.split('\n').map(line => line ? '    ' + line : '').join('\n');

    return `${header}function ${funcName}(x, y, size, frame) {\n` +
           `${gifNote}` +
           `${indentedBody}\n\n` +
           `    // Call the utility function 'drawHugePixelArt' (requires the utility code to be pasted above this)\n` +
           `    drawHugePixelArt(x, y, size, createData, Colors, frame);\n` +
           `}\n\n` +
           `/*\n// Example usage: (Adjust x, y, and size as needed to fit your canvas (size = 1 is original size))\n${usageComment}\n*/`;
}

function getWrappedResultCodeForGIF(rawCode) {
    return getWrappedResultCode(rawCode, true);
}

function showLoading() {
    const fileInput = document.getElementById('image_file');
    if (!fileInput.files.length) {
        return true; 
    }

    const colorInput = document.getElementById('color_count');
    const resInput = document.getElementById('max_resolution');
    try {
        if (colorInput && colorInput.value) localStorage.setItem('dk_last_color_count', String(Math.round(Number(colorInput.value) || 0)));
        if (resInput && resInput.value) localStorage.setItem('dk_last_max_resolution', String(Math.round(Number(resInput.value) || 0)));
    } catch (e) {
        console.warn('Unable to save last inputs to localStorage', e);
    }
    
    const loadingScreen = document.getElementById('loading-screen');
    const btn = document.getElementById('generate-button');
    if (loadingScreen) loadingScreen.style.display = 'flex';
    if (btn) btn.disabled = true;

    return true;
}

function simpleHash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    }
    return String(h);
}

function initAds() {
    const ads = [
        {img: '', href: '#', text: 'Sponsored — Example Ad 1'},
        {img: '', href: '#', text: 'Sponsored — Example Ad 2'},
        {img: '', href: '#', text: 'Sponsored — Example Ad 3'},
        {img: '', href: '#', text: 'Sponsored — Example Ad 4'}
    ];

    const loadingAdImg = document.getElementById('loading-ad-img');
    const loadingAdLink = document.getElementById('loading-ad-link');
    const loadingAdText = document.getElementById('loading-ad-text');
    const loadingAdImg2 = document.getElementById('loading-ad-img2');
    const loadingAdLink2 = document.getElementById('loading-ad-link2');
    const loadingAdText2 = document.getElementById('loading-ad-text2');
    const pageAdImg = document.getElementById('page-ad-img');
    const pageAdLink = document.getElementById('page-ad-link');
    const pageAdText = document.getElementById('page-ad-text');

    if (!ads || !ads.length) return;
    let idx = 0;
    function showAd(i) {
        const a = ads[i] || ads[0];
        const a2 = ads[(i + 1) % ads.length] || ads[0];
        try {
            if (loadingAdImg) loadingAdImg.src = a.img || '';
            if (loadingAdLink) loadingAdLink.href = a.href || '#';
            if (loadingAdText) loadingAdText.textContent = a.text || '';
            if (loadingAdImg2) loadingAdImg2.src = a2.img || '';
            if (loadingAdLink2) loadingAdLink2.href = a2.href || '#';
            if (loadingAdText2) loadingAdText2.textContent = a2.text || '';
            if (pageAdImg) pageAdImg.src = a.img || '';
            if (pageAdLink) pageAdLink.href = a.href || '#';
            if (pageAdText) pageAdText.textContent = a.text || '';
        } catch (e) { console.warn('showAd error', e); }
    }

    showAd(idx);
    try { setInterval(() => { idx = (idx + 1) % ads.length; showAd(idx); }, 6000); } catch(e) { console.warn('Ad rotator failed', e); }
}

function restoreSavedInputs() {
    const colorInput = document.getElementById('color_count');
    const resInput = document.getElementById('max_resolution');

    if (colorInput) {
        const lastColor = localStorage.getItem('dk_last_color_count');
        if (lastColor !== null) {
            const min = parseInt(colorInput.min || '1', 10);
            const max = MAX_ALLOWED_COLORS;
            let val = Math.round(Number(lastColor) || 0);
            val = Math.min(max, Math.max(min, val));
            colorInput.value = val;
        }
    }
    if (resInput) {
        const lastRes = localStorage.getItem('dk_last_max_resolution');
        if (lastRes !== null) {
            const min = parseInt(resInput.min || '1', 10);
            let val = Math.round(Number(lastRes) || 0);
            if (val >= min) resInput.value = val;
        }
    }
}

window.addEventListener('pageshow', () => {
    try { restoreSavedInputs(); } catch(e) { console.warn('pageshow restore failed', e); }
});

document.addEventListener('DOMContentLoaded', () => {
    const colorInput = document.getElementById('color_count');
    const resInput = document.getElementById('max_resolution');
    const btn = document.getElementById('generate-button');

    if (colorInput) {
        colorInput.max = MAX_ALLOWED_COLORS;
        const maxColorsLabel = document.getElementById('maxColors');
        if (maxColorsLabel) maxColorsLabel.textContent = MAX_ALLOWED_COLORS;
        const lastColor = localStorage.getItem('dk_last_color_count');
        if (lastColor) {
            const min = parseInt(colorInput.min || '1', 10);
            const max = MAX_ALLOWED_COLORS;
            let val = Math.round(Number(lastColor) || 0);
            val = Math.min(max, Math.max(min, val));
            colorInput.value = val;
        }
    }
    if (resInput) {
        const lastRes = localStorage.getItem('dk_last_max_resolution');
        if (lastRes) {
            const min = parseInt(resInput.min || '1', 10);
            let val = Math.round(Number(lastRes) || 0);
            if (val >= min) resInput.value = val;
        }
    }

    const convertedCountEl = document.getElementById('converted-count');
    let convertedCount = parseInt(localStorage.getItem('dk_converted_count') || '0', 10);
    if (isNaN(convertedCount)) convertedCount = 0;
    if (convertedCountEl) convertedCountEl.textContent = String(convertedCount);

    const errorElement = document.querySelector('.error');
    const successElement = document.querySelector('.success');
    const resultElement = document.getElementById('jsOutput');
    const loadingScreen = document.getElementById('loading-screen');
    const resultSection = document.getElementById('result-section');

    const copyButtons = Array.from(document.querySelectorAll('.copy-button'));
    copyButtons.forEach(btnEl => {
        const w = btnEl.offsetWidth;
        if (w && !btnEl.style.minWidth) {
            btnEl.style.minWidth = w + 'px';
        }
    });

    if (errorElement || resultElement) {
        if (loadingScreen) loadingScreen.style.display = 'none';
        if (btn) btn.disabled = false;

        if (resultElement) {
            const rawCode = resultElement.textContent;
            const wrappedCode = getWrappedResultCode(rawCode);
            resultElement.textContent = wrappedCode;
        }

        if (resultSection) {
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        if (colorInput) localStorage.setItem('dk_last_color_count', String(colorInput.value));
        if (resInput) localStorage.setItem('dk_last_max_resolution', String(resInput.value));
    }
    try { initAds(); } catch (e) { console.warn('initAds error', e); }
    try { hljs.highlightElement(document.getElementById('utilityOutput')); } catch (e) { console.warn('highlight error', e); }
});

document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    generatedFuncName = null; // Re-scramble function name numbers on every submit
    const fileInput = document.getElementById('image_file');
    const colorCount = Math.min(parseInt(document.getElementById('color_count').value), MAX_ALLOWED_COLORS);
    const maxRes = parseInt(document.getElementById('max_resolution').value);
    if (!fileInput.files[0]) {
        document.getElementById('error').textContent = 'Please select an image file.';
        document.getElementById('error').style.display = 'block';
        return;
    }
    localStorage.setItem('dk_last_color_count', colorCount);
    localStorage.setItem('dk_last_max_resolution', maxRes);
    
    document.getElementById('result-section').style.display = 'none';
    document.getElementById('error').style.display = 'none';
    document.getElementById('success').style.display = 'none';
    showLoading();
    try {
        const file = fileInput.files[0];
        if (file.type === 'image/gif') {
            processGIF(file, maxRes, colorCount);
        } else {
            const img = new Image();
            img.onload = function() {
                const canvas = pixelateImage(img, maxRes);
                const colors = pickVariedColors(canvas, colorCount);
                const [asciiLines, letterColors] = assignLettersToColors(canvas, LETTERS, colors);
                const jsContent = saveJsInMemory(asciiLines, letterColors, canvas.width, canvas.height);
                const wrappedCode = getWrappedResultCode(jsContent);
                document.getElementById('jsOutput').textContent = wrappedCode;
                
                document.getElementById('rectCount').textContent = `${canvas.width * canvas.height}`;
                document.getElementById('result-section').style.display = 'block';
                document.getElementById('success').textContent = 'Image processed successfully!';
                document.getElementById('success').style.display = 'block';
                
                document.getElementById('loading-screen').style.display = 'none';
                document.getElementById('generate-button').disabled = false;
                
                document.getElementById('result-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
                
                let convertedCount = parseInt(localStorage.getItem('dk_converted_count') || '0', 10);
                convertedCount += 1;
                localStorage.setItem('dk_converted_count', String(convertedCount));
                document.getElementById('converted-count').textContent = String(convertedCount);
            };
            img.onerror = function() {
                document.getElementById('error').textContent = 'Failed to load image.';
                document.getElementById('error').style.display = 'block';
                document.getElementById('loading-screen').style.display = 'none';
                document.getElementById('generate-button').disabled = false;
            };
            img.src = URL.createObjectURL(file);
        }
    } catch (err) {
        document.getElementById('error').textContent = 'An error occurred: ' + err.message;
        document.getElementById('error').style.display = 'block';
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('generate-button').disabled = false;
    }
});

function copyResult(btn) {
    copyText(document.getElementById("jsOutput").textContent, btn);
}

function copyUtility(btn) {
    copyText(document.getElementById("utilityOutput").textContent, btn);
}

function copyText(textToCopy, buttonEl) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                showCopiedState(buttonEl);
            })
            .catch(err => {
                console.error('Could not copy text: ', err);
                fallbackCopyText(textToCopy, buttonEl);
            });
    } else {
        fallbackCopyText(textToCopy, buttonEl);
    }
}

function fallbackCopyText(textToCopy, buttonEl) {
    const tempTextArea = document.createElement('textarea');
    tempTextArea.value = textToCopy;
    document.body.appendChild(tempTextArea);
    tempTextArea.select();

    try {
        document.execCommand('copy');
        showCopiedState(buttonEl);
    } catch (err) {
        alert('Unable to copy code. Please copy manually.');
    }

    document.body.removeChild(tempTextArea);
}

function showCopiedState(buttonEl) {
    if (!buttonEl) return;

    if (!buttonEl.style.minWidth) {
        const w = buttonEl.offsetWidth;
        if (w) buttonEl.style.minWidth = w + 'px';
    }

    const originalText = buttonEl.innerHTML;
    buttonEl.innerHTML = "✔ COPIED";
    buttonEl.classList.add("copied");
    buttonEl.disabled = true;

    setTimeout(() => {
        buttonEl.innerHTML = originalText;
        buttonEl.classList.remove("copied");
        buttonEl.disabled = false;
    }, 1500);
}