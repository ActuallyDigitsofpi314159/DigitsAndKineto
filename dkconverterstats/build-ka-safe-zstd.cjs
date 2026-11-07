const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zstdCodec = require("../dkconverter/vendor/zstd_wasm.umd.js");

const sourcePath = path.join(__dirname, "../dkconverter/vendor/fzstd.umd.js");
const outputPath = path.join(__dirname, "../dkconverter/vendor/fzstd-ka.umd.js");
const constructorAliases =
    "var r=ArrayBuffer,t=Uint8Array,e=Uint16Array,n=Int16Array,a=Uint32Array,s=Int32Array";

const arrayHelper = `function dkFzstdArray(source, offset, length) {
    var result = [];
    var index;
    var destinationOffset;
    if (typeof source === "number") {
        length = source;
        for (index = 0; index < length; index++) {
            result[index] = 0;
        }
    } else if (source && typeof source.length === "number") {
        offset = offset || 0;
        if (length === undefined) {
            length = source.length - offset;
        }
        for (index = 0; index < length; index++) {
            result[index] = source[offset + index] || 0;
        }
    }
    result.subarray = function(start, end) {
        if (start < 0) {
            start = Math.max(0, result.length + start);
        }
        if (end === undefined) {
            end = result.length;
        }
        if (end < 0) {
            end = Math.max(0, result.length + end);
        }
        return dkFzstdArray(result.slice(start, end));
    };
    result.set = function(values, start) {
        destinationOffset = start || 0;
        for (index = 0; index < values.length; index++) {
            result[destinationOffset + index] = values[index] || 0;
        }
    };
    return result;
}`;

function makeArray(source, kind, offset, length) {
    let values = [];
    let i;
    if (typeof source === "number") {
        length = source;
        for (i = 0; i < length; i++) values[i] = 0;
    } else if (source && source.byteValues) {
        const bytes = source.byteValues;
        offset = offset || 0;
        const width = kind === "byte" ? 1 : kind.indexOf("16") >= 0 ? 2 : 4;
        if (length === undefined) length = Math.floor((bytes.length - offset) / width);
        for (i = 0; i < length; i++) {
            let value = 0;
            for (let j = 0; j < width; j++) {
                value |= (bytes[offset + i * width + j] || 0) << (j * 8);
            }
            values[i] = castValue(value, kind);
        }
    } else if (source && typeof source.length === "number") {
        offset = offset || 0;
        if (length === undefined) length = source.length - offset;
        for (i = 0; i < length; i++) values[i] = castValue(source[offset + i] || 0, kind);
    }

    values.subarray = function(start, end) {
        if (start < 0) start = Math.max(0, values.length + start);
        if (end === undefined) end = values.length;
        if (end < 0) end = Math.max(0, values.length + end);
        return makeArray(values.slice(start, end), kind);
    };
    values.set = function(sourceValues, destinationOffset) {
        destinationOffset = destinationOffset || 0;
        for (let j = 0; j < sourceValues.length; j++) {
            values[destinationOffset + j] = castValue(sourceValues[j], kind);
        }
    };
    values.byteValues = encodeBytes(values, kind);
    return values;
}

function castValue(value, kind) {
    if (kind === "byte") return value & 255;
    if (kind === "u16") return value & 65535;
    if (kind === "i16") {
        value &= 65535;
        return value > 32767 ? value - 65536 : value;
    }
    if (kind === "u32") return value >>> 0;
    return value | 0;
}

function encodeBytes(values, kind) {
    const width = kind === "byte" ? 1 : kind.indexOf("16") >= 0 ? 2 : 4;
    const bytes = new Array(values.length * width);
    for (let i = 0; i < values.length; i++) {
        const value = values[i] >>> 0;
        for (let j = 0; j < width; j++) {
            bytes[i * width + j] = (value >>> (j * 8)) & 255;
        }
    }
    return bytes;
}

function replaceBetween(code, start, end, replacement) {
    const first = code.indexOf(start);
    const last = code.indexOf(end, first);
    if (first < 0 || last < 0) throw new Error(`Missing boundary: ${start}`);
    return code.slice(0, first) + replacement + code.slice(last);
}

function expandLittleEndianWords(words) {
    const bytes = [];
    for (const word of words.split(",").map(Number)) {
        const value = word >>> 0;
        for (let shift = 0; shift < 32; shift += 8) {
            bytes.push((value >>> shift) & 255);
        }
    }
    return bytes.join(",");
}

function portFrequencyTable() {
    return `y=function(dat,bytePos,maxBits){
        var bitPos=(bytePos<<3)+4;
        var accuracy=(dat[bytePos]&15)+5;
        if(accuracy>maxBits){f(3);}
        var size=1<<accuracy,remaining=size,symbol=-1,repeat=-1,position=-1,high=size;
        var frequencies=new Array(256),nextState=new Array(256),states=new Array(size),symbols=new Array(size),bitsTable=new Array(size);
        var i;
        for(i=0;i<256;i++){frequencies[i]=0;nextState[i]=0;}
        for(i=0;i<size;i++){states[i]=0;symbols[i]=0;bitsTable[i]=0;}
        while(symbol<255&&remaining>0){
            var countBits=b(remaining+1),bytePosNow=bitPos>>3;
            var mask=(1<<(countBits+1))-1;
            var value=((dat[bytePosNow]|(dat[bytePosNow+1]<<8)|(dat[bytePosNow+2]<<16))>>(bitPos&7))&mask;
            var lowerMask=(1<<countBits)-1,maximumSmall=mask-remaining-1,small=value&lowerMask;
            if(small<maximumSmall){bitPos+=countBits;value=small;}
            else{bitPos+=countBits+1;if(value>lowerMask){value-=maximumSmall;}}
            frequencies[++symbol]=--value;
            if(value===-1){remaining+=value;symbols[--high]=symbol;}
            else{remaining-=value;}
            if(value===0){
                do{
                    var repeatPos=bitPos>>3;
                    repeat=((dat[repeatPos]|(dat[repeatPos+1]<<8))>>(bitPos&7))&3;
                    bitPos+=2;
                    symbol+=repeat;
                }while(repeat===3);
            }
        }
        if(symbol>255||remaining){f(0);}
        var symbolPos=0,step=(size>>1)+(size>>3)+3,symbolMask=size-1,sf;
        for(var s=0;s<=symbol;s++){
            sf=frequencies[s];
            if(sf<1){nextState[s]=(-sf)&65535;continue;}
            nextState[s]=sf;
            for(i=0;i<sf;i++){
                symbols[symbolPos]=s;
                do{symbolPos=(symbolPos+step)&symbolMask;}while(symbolPos>=high);
            }
        }
        if(symbolPos){f(0);}
        for(i=0;i<size;i++){
            var state=nextState[symbols[i]];
            nextState[symbols[i]]=(state+1)&65535;
            bitsTable[i]=accuracy-b(state);
            states[i]=((state<<bitsTable[i])-size)&65535;
        }
        return[(bitPos+7)>>3,{b:accuracy,s:symbols,n:bitsTable,t:states}];
    }`;
}

function portHuffmanTable() {
    return `p=function(dat,bytePos){
        var i=0,weightCount=-1,header=dat[bytePos],weights=new Array(256),rankCounts=new Array(12),rankIndexes=new Array(13);
        for(i=0;i<weights.length;i++)weights[i]=0;
        for(i=0;i<rankCounts.length;i++)rankCounts[i]=0;
        for(i=0;i<rankIndexes.length;i++)rankIndexes[i]=0;
        if(header<128){
            var decoded=y(dat,bytePos+1,6),table=decoded[1],endBit=decoded[0]<<3;
            bytePos+=header;
            var lastByte=dat[bytePos];
            if(!lastByte){f(0);}
            var state1=0,state2=0,bits1=table.b,bits2=bits1,bitPos=(++bytePos<<3)-8+b(lastByte);
            for(;;){
                bitPos-=bits1;
                if(bitPos<endBit)break;
                var currentByte=bitPos>>3;
                state1+=((dat[currentByte]|(dat[currentByte+1]<<8))>>(bitPos&7))&((1<<bits1)-1);
                weights[++weightCount]=table.s[state1];
                bitPos-=bits2;
                if(bitPos<endBit)break;
                currentByte=bitPos>>3;
                state2+=((dat[currentByte]|(dat[currentByte+1]<<8))>>(bitPos&7))&((1<<bits2)-1);
                weights[++weightCount]=table.s[state2];
                bits1=table.n[state1];state1=table.t[state1];
                bits2=table.n[state2];state2=table.t[state2];
            }
            if(++weightCount>255){f(0);}
        }else{
            weightCount=header-127;
            for(i=0;i<weightCount;i+=2){
                var nextByte=dat[++bytePos];
                weights[i]=nextByte>>4;
                weights[i+1]=nextByte&15;
            }
            ++bytePos;
        }
        var weightSum=0;
        for(i=0;i<weightCount;i++){
            var weight=weights[i];
            if(weight>11){f(0);}
            weightSum+=weight&&(1<<(weight-1));
        }
        var maxBits=b(weightSum)+1,tableSize=1<<maxBits,remainder=tableSize-weightSum;
        if(remainder&(remainder-1)){f(0);}
        weights[weightCount++]=b(remainder)+1;
        for(i=0;i<weightCount;i++){
            var currentWeight=weights[i];
            var numberBits=currentWeight&&(maxBits+1-currentWeight);
            weights[i]=numberBits;
            rankCounts[numberBits]++;
        }
        var symbols=new Array(tableSize),numberBitsTable=new Array(tableSize);
        for(i=0;i<tableSize;i++){symbols[i]=0;numberBitsTable[i]=0;}
        rankIndexes[maxBits]=0;
        for(i=maxBits;i>0;i--){
            var previous=rankIndexes[i];
            o(numberBitsTable,i,previous,rankIndexes[i-1]=previous+rankCounts[i]*(1<<(maxBits-i)));
        }
        if(rankIndexes[0]!==tableSize){f(0);}
        for(i=0;i<weightCount;i++){
            var length=weights[i];
            if(length){
                var code=rankIndexes[length];
                o(symbols,i,code,rankIndexes[length]=code+(1<<(maxBits-length)));
            }
        }
        return[bytePos,{n:numberBitsTable,b:maxBits,s:symbols}];
    }`;
}

function build() {
    let code = fs.readFileSync(sourcePath, "utf8");
    code = code.replace(
        constructorAliases,
        "var r=dkFzstdArray,t=dkFzstdArray,e=dkFzstdArray,n=dkFzstdArray,a=dkFzstdArray,s=dkFzstdArray"
    );
    code = code.replace("this).fzstd=f()", "this).dkFzstd=f()");
    code = replaceBetween(code, "y=function(", ",p=function(", portFrequencyTable());
    code = replaceBetween(code, "p=function(", ",w=y(", portHuffmanTable());
    code = code.replace(
        /z=new t\(new s\(\[([0-9,]+)\]\)\.buffer,0,36\),E=m\(z,0\),k=new t\(new s\(\[([0-9,]+)\]\)\.buffer,0,53\),A=m\(k,3\)/,
        function(_, zWords, kWords) {
            return "z=new t([" + expandLittleEndianWords(zWords) +"]),E=m(z,0),k=new t([" +
                expandLittleEndianWords(kWords).split(",").slice(0, 53).join(",") + "]),A=m(k,3)";
        }
    );
    code = code.replace(
        "var q=new t([0,0,r[u++]]);H[L]={s:q.subarray(2,3),n:q.subarray(0,1),t:new e(q.buffer,0,1),b:0}",
        "var q=[0,0,r[u++]];H[L]={s:[q[2]],n:[q[0]],t:[q[0]],b:0}"
    );
    code = code.replace(
        "var D=a?a.subarray(n.y,n.y+n.m):new t(n.m),M=D.length-B;",
        "var outputStart=n.y,D=a?a.subarray(n.y,n.y+n.m):new t(n.m),M=D.length-B;"
    );
    code = code.replace(
        "return n.b=c,D}f(2)",
        "if(a){var outputLength=n.y-outputStart;a.set(D.subarray(0,outputLength),outputStart)}return n.b=c,D}f(2)"
    );
    code = replaceBetween(code, "T=function(", ",F=function(", `T=function(dat,out,table,offset,outputLength){
        var length=dat.length,count=outputLength===undefined?out.length-(offset||0):outputLength,lastByte=dat[length-1],mask=(1<<table.b)-1,endBits=-table.b;
        if(!lastByte){f(0);}
        var state=0,bits=table.b,bitPos=(length<<3)-8+b(lastByte)-bits,index=-1;
        for(;bitPos>endBits&&index<count;){
            var currentByte=bitPos>>3;
            var value=(dat[currentByte]|(dat[currentByte+1]<<8)|(dat[currentByte+2]<<16))>>(bitPos&7);
            state=((state<<bits)|value)&mask;
            out[(offset||0)+ ++index]=table.s[state];
            bitPos-=bits=table.n[state];
        }
        if(bitPos!==endBits||index+1!==count){f(0);}
    },x=function(dat,out,table,offset){
        var bitOffset=6,base=offset||0;
        var count=out.length-base,first=(count+3)>>2,second=first<<1,third=first+second;
        T(dat.subarray(bitOffset,bitOffset+=(dat[0]|(dat[1]<<8))),out,table,base,first);
        T(dat.subarray(bitOffset,bitOffset+=(dat[2]|(dat[3]<<8))),out,table,base+first,first);
        T(dat.subarray(bitOffset,bitOffset+=(dat[4]|(dat[5]<<8))),out,table,base+second,first);
        T(dat.subarray(bitOffset),out,table,base+third,count-third);
    }`);
    code = code.replace(
        "(U?x:T)(r.subarray(u,u+=I),D.subarray(M),W)",
        "(U?x:T)(r.subarray(u,u+=I),D,W,M)"
    );
    code = code.replace(
        "var m=new t((1==e?w||g:e?0:g)+12);return m[0]=1,m[4]=4,m[8]=8,{b:c+p,y:0,l:0,d:y,w:e&&1!=e?e:m.subarray(12),e:g,o:new s(m.buffer,0,3),u:w,c:o,m:Math.min(131072,g)}",
        "return{b:c+p,y:0,l:0,d:y,w:e&&1!=e?e:new t(w||g),e:g,o:[1,4,8],u:w,c:o,m:Math.min(131072,g)}"
    );
    code = code.replace("t:new e(rbuf.buffer,0,1)", "t:new e([0])");
    const forbidden = ["Uint8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array", "ArrayBuffer", "DecompressionStream", ".then("];
    for (const api of forbidden) {
        if (code.indexOf(api) >= 0) {
            throw new Error("Forbidden API remained in transformed decoder: " + api);
        }
    }
    return arrayHelper + "\n\n" + code;
}

async function main() {
    await zstdCodec.ZstdInit();
    const code = build();
    const context = { module: undefined, exports: undefined };
    context.self = context;
    vm.runInNewContext(code, context);
    function assertRoundTrip(input, chunkSize) {
        const compressedParts = [];
        let start;
        for (start = 0; start < input.length; start += chunkSize) {
            compressedParts.push(zstdCodec.ZstdSimple.compress(
                input.subarray(start, Math.min(start + chunkSize, input.length)), 19
            ));
        }
        const compressedLength = compressedParts.reduce((total, part) => total + part.length, 0);
        const compressed = new Uint8Array(compressedLength);
        let offset = 0;
        for (const part of compressedParts) {
            compressed.set(part, offset);
            offset += part.length;
        }
        const output = context.dkFzstd.decompress(context.dkFzstdArray(Array.from(compressed)));
        const baseline = require("../dkconverter/vendor/fzstd.umd.js").decompress(compressed);
        let mismatch = -1;
        for (let index = 0; index < Math.min(output.length, input.length); index++) {
            if (output[index] !== input[index]) {
                mismatch = index;
                break;
            }
        }
        if (output.length !== input.length || mismatch >= 0 ||
            !Buffer.from(baseline).equals(Buffer.from(input))) {
            throw new Error("Array-only decoder round trip failed at byte " + mismatch + ".");
        }
        return { inputBytes: input.length, compressedBytes: compressed.length };
    }
    const patterned = new Uint8Array(512 * 1024);
    const repeated = new Uint8Array(192 * 1024);
    const noisy = new Uint8Array(96 * 1024);
    let seed = 0x13579bdf;
    for (let i = 0; i < patterned.length; i++) {
        patterned[i] = ((i * 31) ^ (i >>> 4) ^ (i % 97)) & 255;
    }
    repeated.fill(73);
    for (let i = 0; i < noisy.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        noisy[i] = seed >>> 24;
    }
    const roundTrips = [
        assertRoundTrip(patterned, 131072),
        assertRoundTrip(repeated, 65536),
        assertRoundTrip(noisy, 32768)
    ];
    const iconColors = [
        [20, 35, 80, 255], [35, 90, 180, 255], [55, 150, 220, 255],
        [245, 245, 250, 255], [250, 180, 35, 255], [220, 65, 55, 255],
        [65, 175, 100, 255], [130, 65, 170, 255]
    ];
    const icon = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
            const dx = x - 31.5;
            const dy = y - 31.5;
            const radius = dx * dx + dy * dy;
            let color = [0, 0, 0, 0];
            if (radius <= 30 * 30) {
                const band = Math.floor((Math.atan2(dy, dx) + Math.PI) * 4 / Math.PI) & 7;
                color = iconColors[radius < 11 * 11 ? 3 : band];
            }
            const pixelOffset = (y * 64 + x) * 4;
            for (let channel = 0; channel < 4; channel++) {
                icon[pixelOffset + channel] = color[channel];
            }
        }
    }
    const iconScanlines = new Uint8Array(64 * (64 * 4 + 1));
    const iconRow = new Uint8Array(64 * 4);
    function iconPaeth(left, up, upperLeft) {
        const estimate = left + up - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const upDistance = Math.abs(estimate - up);
        const upperLeftDistance = Math.abs(estimate - upperLeft);
        if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
        if (upDistance <= upperLeftDistance) return up;
        return upperLeft;
    }
    for (let y = 0; y < 64; y++) {
        const rowOffset = y * 64 * 4;
        const destination = y * (64 * 4 + 1);
        let bestScore = Infinity;
        let bestFilter = 0;
        for (let filter = 0; filter <= 4; filter++) {
            let score = 0;
            for (let x = 0; x < 64 * 4; x++) {
                const current = icon[rowOffset + x];
                const left = x >= 4 ? icon[rowOffset + x - 4] : 0;
                const up = y > 0 ? icon[rowOffset - 64 * 4 + x] : 0;
                const upperLeft = y > 0 && x >= 4 ? icon[rowOffset - 64 * 4 + x - 4] : 0;
                let predictor = 0;
                if (filter === 1) predictor = left;
                else if (filter === 2) predictor = up;
                else if (filter === 3) predictor = Math.floor((left + up) / 2);
                else if (filter === 4) predictor = iconPaeth(left, up, upperLeft);
                const residual = (current - predictor) & 255;
                iconRow[x] = residual;
                score += Math.abs(residual < 128 ? residual : residual - 256);
            }
            if (score < bestScore) {
                bestScore = score;
                bestFilter = filter;
                iconScanlines.set(iconRow, destination + 1);
            }
        }
        iconScanlines[destination] = bestFilter;
    }
    const iconCompressed = zstdCodec.ZstdSimple.compress(iconScanlines, 19);
    const iconDecoded = context.dkFzstd.decompress(
        context.dkFzstdArray(Array.from(iconCompressed))
    );
    let iconMismatch = -1;
    for (let index = 0; index < iconScanlines.length; index++) {
        if (iconDecoded[index] !== iconScanlines[index]) {
            iconMismatch = index;
            break;
        }
    }
    if (iconDecoded.length !== iconScanlines.length || iconMismatch >= 0) {
        throw new Error("Image-like Zstd block round trip failed at byte " + iconMismatch + ".");
    }
    roundTrips.push({ inputBytes: iconScanlines.length, compressedBytes: iconCompressed.length, imageFixture: true });
    console.log(JSON.stringify({
        sourceBytes: fs.statSync(sourcePath).size,
        arrayDecoderBytes: code.length,
        roundTrips
    }));
    fs.writeFileSync(outputPath, code);
}

main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
