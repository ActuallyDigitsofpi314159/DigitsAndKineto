/* Avoid returned object literals in nested helpers; KA's Processing.js transpiler corrupts them. */
function decodeDKJPEG(bytes, expectedWidth, expectedHeight) {
    var zigzag = [
        0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
        12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
        35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44,
        51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
    ];
    var position = 2;
    var width = 0;
    var height = 0;
    var components = [];
    var quantization = [];
    var huffmanDC = [];
    var huffmanAC = [];
    var restartInterval = 0;
    var scan = null;
    var marker;

    var fail = function() {
        throw "DK JPEG: unsupported or invalid baseline image.";
    };

    var get16 = function(offset) {
        return bytes[offset] * 256 + bytes[offset + 1];
    };

    var makeHuffman = function(counts, values) {
        var minimum = [];
        var maximum = [];
        var offsets = [];
        var code = 0;
        var valueOffset = 0;
        var length;
        var table = {};
        for (length = 1; length <= 16; length++) {
            minimum[length] = code;
            maximum[length] = code + counts[length - 1] - 1;
            offsets[length] = valueOffset - code;
            valueOffset += counts[length - 1];
            code = (code + counts[length - 1]) * 2;
        }
        table.minimum = minimum;
        table.maximum = maximum;
        table.offsets = offsets;
        table.values = values;
        return table;
    };

    while (position < bytes.length) {
        if (bytes[position++] !== 255) fail();
        while (bytes[position] === 255) position++;
        marker = bytes[position++];
        if (marker === 217) break;
        if (marker === 216 || marker === 1 ||
            marker >= 208 && marker <= 215) continue;

        var segmentLength = get16(position);
        var end = position + segmentLength;
        if (segmentLength < 2 || end > bytes.length) fail();
        position += 2;

        if (marker === 219) {
            while (position < end) {
                var quantizationInfo = bytes[position++];
                var precision = quantizationInfo >> 4;
                var quantizationId = quantizationInfo & 15;
                if (precision !== 0 || quantizationId > 3) fail();
                var quantizationTable = [];
                var quantizationIndex;
                for (quantizationIndex = 0; quantizationIndex < 64; quantizationIndex++) {
                    quantizationTable[zigzag[quantizationIndex]] = bytes[position++];
                }
                quantization[quantizationId] = quantizationTable;
            }
        } else if (marker === 196) {
            while (position < end) {
                var huffmanInfo = bytes[position++];
                var huffmanClass = huffmanInfo >> 4;
                var huffmanId = huffmanInfo & 15;
                var counts = [];
                var valueCount = 0;
                var countIndex;
                for (countIndex = 0; countIndex < 16; countIndex++) {
                    counts[countIndex] = bytes[position++];
                    valueCount += counts[countIndex];
                }
                var values = bytes.subarray
                    ? bytes.subarray(position, position + valueCount)
                    : bytes.slice(position, position + valueCount);
                position += valueCount;
                if (huffmanId > 3 || huffmanClass > 1) fail();
                (huffmanClass ? huffmanAC : huffmanDC)[huffmanId] =
                    makeHuffman(counts, values);
            }
        } else if (marker === 192) {
            if (bytes[position++] !== 8) fail();
            height = get16(position);
            width = get16(position + 2);
            var componentCount = bytes[position + 4];
            position += 5;
            if ((componentCount !== 1 && componentCount !== 3) ||
                width !== expectedWidth || height !== expectedHeight ||
                position + componentCount * 3 > end) fail();
            components = [];
            var componentIndex;
            for (componentIndex = 0; componentIndex < componentCount; componentIndex++) {
                var componentId = bytes[position++];
                var sampling = bytes[position++];
                components.push({
                    id: componentId,
                    h: sampling >> 4,
                    v: sampling & 15,
                    quantizationId: bytes[position++]
                });
            }
        } else if (marker === 221) {
            restartInterval = get16(position);
        } else if (marker === 218) {
            if (!components.length) fail();
            var scanComponentCount = bytes[position++];
            if (scanComponentCount !== components.length) fail();
            scan = [];
            for (componentIndex = 0; componentIndex < scanComponentCount; componentIndex++) {
                var scanId = bytes[position++];
                var tableIds = bytes[position++];
                var componentFound = null;
                var componentSearch;
                for (componentSearch = 0; componentSearch < components.length; componentSearch++) {
                    if (components[componentSearch].id === scanId) {
                        componentFound = components[componentSearch];
                        break;
                    }
                }
                if (!componentFound) fail();
                componentFound.dc = huffmanDC[tableIds >> 4];
                componentFound.ac = huffmanAC[tableIds & 15];
                componentFound.qt = quantization[componentFound.quantizationId];
                if (!componentFound.dc || !componentFound.ac || !componentFound.qt) fail();
                scan.push(componentFound);
            }
            if (bytes[position++] !== 0 || bytes[position++] !== 63 ||
                bytes[position++] !== 0 || position !== end) fail();
            break;
        }
        position = end;
    }
    if (!scan || !width || !height) fail();

    var maxH = 1;
    var maxV = 1;
    var componentIndex;
    for (componentIndex = 0; componentIndex < components.length; componentIndex++) {
        maxH = Math.max(maxH, components[componentIndex].h);
        maxV = Math.max(maxV, components[componentIndex].v);
    }
    var mcuColumns = Math.ceil(width / (maxH * 8));
    var mcuRows = Math.ceil(height / (maxV * 8));
    for (componentIndex = 0; componentIndex < components.length; componentIndex++) {
        var component = components[componentIndex];
        component.planeWidth = mcuColumns * component.h * 8;
        component.planeHeight = mcuRows * component.v * 8;
        component.plane = Array(component.planeWidth * component.planeHeight);
        component.predictor = 0;
    }

    var transform = [];
    var x;
    var u;
    for (x = 0; x < 8; x++) {
        transform[x] = [];
        for (u = 0; u < 8; u++) {
            transform[x][u] = 0.5 * (u === 0 ? Math.SQRT1_2 : 1) *
                Math.cos((2 * x + 1) * u * Math.PI / 16);
        }
    }

    var bitBuffer = 0;
    var bitsRemaining = 0;
    var getBit = function() {
        if (!bitsRemaining) {
            bitBuffer = bytes[position++];
            if (bitBuffer === 255) {
                if (bytes[position++] !== 0) fail();
            }
            bitsRemaining = 8;
        }
        bitsRemaining--;
        return (bitBuffer >> bitsRemaining) & 1;
    };
    var getBits = function(count) {
        var result = 0;
        while (count--) result = result * 2 + getBit();
        return result;
    };
    var decodeHuffman = function(table) {
        var code = 0;
        var length;
        for (length = 1; length <= 16; length++) {
            code = code * 2 + getBit();
            if (code <= table.maximum[length] && code >= table.minimum[length]) {
                return table.values[table.offsets[length] + code];
            }
        }
        fail();
    };
    var receiveExtend = function(length) {
        if (!length) return 0;
        var value = getBits(length);
        return value < Math.pow(2, length - 1)
            ? value - Math.pow(2, length) + 1
            : value;
    };
    var decodeBlock = function(component, blockX, blockY) {
        var coefficients = Array(64);
        var coefficient;
        for (coefficient = 0; coefficient < 64; coefficient++) {
            coefficients[coefficient] = 0;
        }
        component.predictor += receiveExtend(decodeHuffman(component.dc));
        coefficients[0] = component.predictor * component.qt[0];
        var coefficientIndex = 1;
        while (coefficientIndex < 64) {
            var runSize = decodeHuffman(component.ac);
            var run = runSize >> 4;
            var size = runSize & 15;
            if (!size) {
                if (run === 15) {
                    coefficientIndex += 16;
                    continue;
                }
                break;
            }
            coefficientIndex += run;
            if (coefficientIndex >= 64) fail();
            var zigzagIndex = zigzag[coefficientIndex++];
            coefficients[zigzagIndex] =
                receiveExtend(size) * component.qt[zigzagIndex];
        }
        var temporary = Array(64);
        var row;
        var column;
        var frequency;
        for (row = 0; row < 8; row++) {
            for (column = 0; column < 8; column++) {
                var sum = 0;
                for (frequency = 0; frequency < 8; frequency++) {
                    sum += coefficients[row * 8 + frequency] *
                        transform[column][frequency];
                }
                temporary[row * 8 + column] = sum;
            }
        }
        var plane = component.plane;
        var baseX = blockX * 8;
        var baseY = blockY * 8;
        for (row = 0; row < 8; row++) {
            for (column = 0; column < 8; column++) {
                sum = 0;
                for (frequency = 0; frequency < 8; frequency++) {
                    sum += temporary[frequency * 8 + column] *
                        transform[row][frequency];
                }
                plane[(baseY + row) * component.planeWidth + baseX + column] =
                    Math.max(0, Math.min(255, Math.round(sum + 128)));
            }
        }
    };

    var mcuIndex = 0;
    var mcuX;
    var mcuY;
    var vertical;
    var horizontal;
    for (mcuY = 0; mcuY < mcuRows; mcuY++) {
        for (mcuX = 0; mcuX < mcuColumns; mcuX++) {
            for (componentIndex = 0; componentIndex < scan.length; componentIndex++) {
                component = scan[componentIndex];
                for (vertical = 0; vertical < component.v; vertical++) {
                    for (horizontal = 0; horizontal < component.h; horizontal++) {
                        decodeBlock(
                            component,
                            mcuX * component.h + horizontal,
                            mcuY * component.v + vertical
                        );
                    }
                }
            }
            mcuIndex++;
            if (restartInterval && mcuIndex % restartInterval === 0 &&
                mcuIndex < mcuColumns * mcuRows) {
                bitsRemaining = 0;
                if (bytes[position++] !== 255) fail();
                while (bytes[position] === 255) position++;
                if (bytes[position++] < 208 || bytes[position - 1] > 215) fail();
                for (componentIndex = 0; componentIndex < components.length; componentIndex++) {
                    components[componentIndex].predictor = 0;
                }
            }
        }
    }

    var sample = function(component, pixelX, pixelY) {
        var sampleX = (pixelX + 0.5) * component.h / maxH - 0.5;
        var sampleY = (pixelY + 0.5) * component.v / maxV - 0.5;
        sampleX = Math.max(0, Math.min(component.planeWidth - 1, sampleX));
        sampleY = Math.max(0, Math.min(component.planeHeight - 1, sampleY));
        var x0 = Math.floor(sampleX);
        var y0 = Math.floor(sampleY);
        var x1 = Math.min(component.planeWidth - 1, x0 + 1);
        var y1 = Math.min(component.planeHeight - 1, y0 + 1);
        var fx = sampleX - x0;
        var fy = sampleY - y0;
        var plane = component.plane;
        var top = plane[y0 * component.planeWidth + x0] * (1 - fx) +
            plane[y0 * component.planeWidth + x1] * fx;
        var bottom = plane[y1 * component.planeWidth + x0] * (1 - fx) +
            plane[y1 * component.planeWidth + x1] * fx;
        return top * (1 - fy) + bottom * fy;
    };

    var output = Array(width * height * 4);
    var pixel;
    var offset;
    var luminance;
    var cb;
    var cr;
    var red;
    var green;
    var blue;
    for (pixel = 0; pixel < width * height; pixel++) {
        x = pixel % width;
        var y = Math.floor(pixel / width);
        luminance = sample(components[0], x, y);
        if (components.length === 1) {
            red = green = blue = luminance;
        } else {
            cb = sample(components[1], x, y) - 128;
            cr = sample(components[2], x, y) - 128;
            red = luminance + 1.402 * cr;
            green = luminance - 0.344136 * cb - 0.714136 * cr;
            blue = luminance + 1.772 * cb;
        }
        offset = pixel * 4;
        output[offset] = Math.max(0, Math.min(255, Math.round(red)));
        output[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
        output[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
        output[offset + 3] = 255;
    }
    return output;
}

function capDKJPEGColors(rgba, maxColors) {
    if (typeof maxColors !== "number" || !isFinite(maxColors) ||
        Math.floor(maxColors) !== maxColors || maxColors < 1) {
        throw "DK JPEG: invalid color limit.";
    }
    var redLevels = Math.max(1, Math.min(256, Math.floor(Math.pow(maxColors, 1 / 3))));
    var greenLevels = redLevels;
    var blueLevels = redLevels;
    while (true) {
        var changed = false;
        if (redLevels < 256 &&
            (redLevels + 1) * greenLevels * blueLevels <= maxColors) {
            redLevels++;
            changed = true;
        }
        if (greenLevels < 256 &&
            redLevels * (greenLevels + 1) * blueLevels <= maxColors) {
            greenLevels++;
            changed = true;
        }
        if (blueLevels < 256 &&
            redLevels * greenLevels * (blueLevels + 1) <= maxColors) {
            blueLevels++;
            changed = true;
        }
        if (!changed) break;
    }
    var redStep = redLevels > 1 ? 255 / (redLevels - 1) : 0;
    var greenStep = greenLevels > 1 ? 255 / (greenLevels - 1) : 0;
    var blueStep = blueLevels > 1 ? 255 / (blueLevels - 1) : 0;
    var offset;
    for (offset = 0; offset < rgba.length; offset += 4) {
        rgba[offset] = redLevels > 1 ?
            Math.round(Math.round(rgba[offset] / redStep) * redStep)
            : 0;
        rgba[offset + 1] = greenLevels > 1 ?
            Math.round(Math.round(rgba[offset + 1] / greenStep) * greenStep)
            : 0;
        rgba[offset + 2] = blueLevels > 1 ?
            Math.round(Math.round(rgba[offset + 2] / blueStep) * blueStep)
            : 0;
    }
    return rgba;
}
