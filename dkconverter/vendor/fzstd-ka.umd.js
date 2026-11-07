function dkFzstdArray(source, offset, length) {
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
}

!function(f){typeof module!='undefined'&&typeof exports=='object'?module.exports=f():typeof define!='undefined'&&define.amd?define(['fzstd',f]):(typeof self!='undefined'?self:this).dkFzstd=f()}(function(){var _e={};"use strict";var r=dkFzstdArray,t=dkFzstdArray,e=dkFzstdArray,n=dkFzstdArray,a=dkFzstdArray,s=dkFzstdArray,i=function(r,e,n){if(t.prototype.slice)return t.prototype.slice.call(r,e,n);(null==e||e<0)&&(e=0),(null==n||n>r.length)&&(n=r.length);var a=new t(n-e);return a.set(r.subarray(e,n)),a},o=function(r,e,n,a){if(t.prototype.fill)return t.prototype.fill.call(r,e,n,a);for((null==n||n<0)&&(n=0),(null==a||a>r.length)&&(a=r.length);n<a;++n)r[n]=e;return r},u=function(r,e,n,a){if(t.prototype.copyWithin)return t.prototype.copyWithin.call(r,e,n,a);for((null==n||n<0)&&(n=0),(null==a||a>r.length)&&(a=r.length);n<a;)r[e++]=r[n++]};_e.ZstdErrorCode={InvalidData:0,WindowSizeTooLarge:1,InvalidBlockType:2,FSEAccuracyTooHigh:3,DistanceTooFarBack:4,UnexpectedEOF:5};var h=["invalid zstd data","window size too large (>2046MB)","invalid block type","FSE accuracy too high","match distance too far back","unexpected EOF"],f=function(r,t,e){var n=Error(t||h[r]);if(n.code=r,Error.captureStackTrace&&Error.captureStackTrace(n,f),!e)throw n;return n},l=function(r,t,e){for(var n=0,a=0;n<e;++n)a|=r[t++]<<(n<<3);return a},v=function(r,t){return(r[t]|r[t+1]<<8|r[t+2]<<16|r[t+3]<<24)>>>0},c=function(r,e){var n=r[0]|r[1]<<8|r[2]<<16;if(3126568==n&&253==r[3]){var a=r[4],i=a>>5&1,o=a>>2&1,u=3&a,h=a>>6;8&a&&f(0);var c=6-i,b=3==u?4:u,y=l(r,c,b),p=h?1<<h:i,w=l(r,c+=b,p)+(1==h&&256),g=w;if(!i){var d=1<<10+(r[5]>>3);g=d+(d>>3)*(7&r[5])}g>2145386496&&f(1);return{b:c+p,y:0,l:0,d:y,w:e&&1!=e?e:new t(w||g),e:g,o:[1,4,8],u:w,c:o,m:Math.min(131072,g)}}if(25481893==(n>>4|r[3]<<20))return v(r,4)+8;f(0)},b=function(r){for(var t=0;1<<t<=r;++t);return t-1},y=function(dat,bytePos,maxBits){
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
    },p=function(dat,bytePos){
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
    },w=y(new t([81,16,99,140,49,198,24,99,12,33,196,24,99,102,102,134,70,146,4]),0,6)[1],g=y(new t([33,20,196,24,99,140,33,132,16,66,8,33,132,16,66,8,33,68,68,68,68,68,68,68,68,36,9]),0,6)[1],d=y(new t([32,132,16,66,102,70,68,68,68,68,36,73,2]),0,5)[1],m=function(r,t){for(var e=r.length,n=new s(e),a=0;a<e;++a)n[a]=t,t+=1<<r[a];return n},z=new t([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,3,3,4,6,7,8,9,10,11,12,13,14,15,16]),E=m(z,0),k=new t([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,2,2,3,3,4,4,5,7,8,9,10,11,12,13,14,15,16]),A=m(k,3),T=function(dat,out,table,offset,outputLength){
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
    },F=function(r,n,a){var s,u=n.b,h=r[u],l=h>>1&3;n.l=1&h;var v=h>>3|r[u+1]<<5|r[u+2]<<13,c=(u+=3)+v;if(1==l){if(u>=r.length)return;return n.b=u+1,a?(o(a,r[u],n.y,n.y+=v),a):o(new t(v),r[u])}if(!(c>r.length)){if(0==l)return n.b=c,a?(a.set(r.subarray(u,c),n.y),n.y+=v,a):i(r,u,c);if(2==l){var m=r[u],F=3&m,S=m>>2&3,B=m>>4,I=0,U=0;F<2?1&S?B|=r[++u]<<4|(2&S&&r[++u]<<12):B=m>>3:(U=S,S<2?(B|=(63&r[++u])<<4,I=r[u]>>6|r[++u]<<2):2==S?(B|=r[++u]<<4|(3&r[++u])<<12,I=r[u]>>2|r[++u]<<6):(B|=r[++u]<<4|(63&r[++u])<<12,I=r[u]>>6|r[++u]<<2|r[++u]<<10)),++u;var outputStart=n.y,D=a?a.subarray(n.y,n.y+n.m):new t(n.m),M=D.length-B;if(0==F)D.set(r.subarray(u,u+=B),M);else if(1==F)o(D,r[u++],M);else{var W=n.h;if(2==F){var O=p(r,u);I+=u-(u=O[0]),n.h=W=O[1]}else W||f(0);(U?x:T)(r.subarray(u,u+=I),D,W,M)}var j=r[u++];if(j){255==j?j=32512+(r[u++]|r[u++]<<8):j>127&&(j=j-128<<8|r[u++]);var C=r[u++];3&C&&f(0);for(var H=[g,d,w],L=2;L>-1;--L){var Z=C>>2+(L<<1)&3;if(1==Z){var q=[0,0,r[u++]];H[L]={s:[q[2]],n:[q[0]],t:[q[0]],b:0}}else 2==Z?(u=(s=y(r,u,9-(1&L)))[0],H[L]=s[1]):3==Z&&(n.t||f(0),H[L]=n.t[L])}var G=n.t=H,J=G[0],K=G[1],N=G[2],P=r[c-1];P||f(0);var Q=(c<<3)-8+b(P)-N.b,R=Q>>3,V=0,X=(r[R]|r[R+1]<<8)>>(7&Q)&(1<<N.b)-1,Y=(r[R=(Q-=K.b)>>3]|r[R+1]<<8)>>(7&Q)&(1<<K.b)-1,$=(r[R=(Q-=J.b)>>3]|r[R+1]<<8)>>(7&Q)&(1<<J.b)-1;for(++j;--j;){var _=N.s[X],rr=N.n[X],tr=J.s[$],er=J.n[$],nr=K.s[Y],ar=K.n[Y],sr=1<<nr,ir=sr+((r[R=(Q-=nr)>>3]|r[R+1]<<8|r[R+2]<<16|r[R+3]<<24)>>>(7&Q)&sr-1);R=(Q-=k[tr])>>3;var or=A[tr]+((r[R]|r[R+1]<<8|r[R+2]<<16)>>(7&Q)&(1<<k[tr])-1);R=(Q-=z[_])>>3;var ur=E[_]+((r[R]|r[R+1]<<8|r[R+2]<<16)>>(7&Q)&(1<<z[_])-1);if(R=(Q-=rr)>>3,X=N.t[X]+((r[R]|r[R+1]<<8)>>(7&Q)&(1<<rr)-1),R=(Q-=er)>>3,$=J.t[$]+((r[R]|r[R+1]<<8)>>(7&Q)&(1<<er)-1),R=(Q-=ar)>>3,Y=K.t[Y]+((r[R]|r[R+1]<<8)>>(7&Q)&(1<<ar)-1),ir>3)n.o[2]=n.o[1],n.o[1]=n.o[0],n.o[0]=ir-=3;else{var hr=ir-(0!=ur);hr?(ir=3==hr?n.o[0]-1:n.o[hr],hr>1&&(n.o[2]=n.o[1]),n.o[1]=n.o[0],n.o[0]=ir):ir=n.o[0]}for(L=0;L<ur;++L)D[V+L]=D[M+L];M+=ur;var fr=(V+=ur)-ir;if(fr<0){var lr=-fr,vr=n.e+fr;for(lr>or&&(lr=or),L=0;L<lr;++L)D[V+L]=n.w[vr+L];V+=lr,or-=lr,fr=0}for(L=0;L<or;++L)D[V+L]=D[fr+L];V+=or}if(V!=M)for(;M<D.length;)D[V++]=D[M++];else V=D.length;a?n.y+=V:D=i(D,0,V)}else if(a){if(n.y+=B,M)for(L=0;L<B;++L)D[L]=D[M+L]}else M&&(D=i(D,M));if(a){var outputLength=n.y-outputStart;a.set(D.subarray(0,outputLength),outputStart)}return n.b=c,D}f(2)}},S=function(r,e){if(1==r.length)return r[0];for(var n=new t(e),a=0,s=0;a<r.length;++a){var i=r[a];n.set(i,s),s+=i.length}return n};function B(r,t){for(var e=[],n=+!t,a=0,s=0;r.length;){var i=c(r,n||t);if("object"==typeof i){for(n?(t=null,i.w.length==i.u&&(e.push(t=i.w),s+=i.u)):(e.push(t),i.e=0);!i.l;){var o=F(r,i,t);o||f(5),t?i.e=i.y:(e.push(o),s+=o.length,u(i.w,0,o.length),i.w.set(o,i.w.length-o.length))}a=i.b+4*i.c}else a=i;r=r.subarray(a)}return S(e,s)}_e.decompress=B;var I=function(){function r(r){this.ondata=r,this.c=[],this.l=0,this.z=0}return r.prototype.push=function(r,e){if("number"==typeof this.s){var n=Math.min(r.length,this.s);r=r.subarray(n),this.s-=n}var a=r.length+this.l;if(!this.s){if(e){if(!a)return void this.ondata(new t(0),!0);a<5&&f(5)}else if(a<18)return this.c.push(r),void(this.l=a);if(this.l&&(this.c.push(r),r=S(this.c,a),this.c=[],this.l=0),"number"==typeof(this.s=c(r)))return this.push(r,e)}if("number"!=typeof this.s){if(a<(this.z||3))return e&&f(5),this.c.push(r),void(this.l=a);if(this.l&&(this.c.push(r),r=S(this.c,a),this.c=[],this.l=0),!this.z&&a<(this.z=2&r[this.s.b]?4:3+(r[this.s.b]>>3|r[this.s.b+1]<<5|r[this.s.b+2]<<13)))return e&&f(5),this.c.push(r),void(this.l=a);for(this.z=0;;){var s=F(r,this.s);if(!s){e&&f(5);var i=r.subarray(this.s.b);return this.s.b=0,this.c.push(i),void(this.l+=i.length)}if(this.ondata(s,!1),u(this.s.w,0,s.length),this.s.w.set(s,this.s.w.length-s.length),this.s.l){var o=r.subarray(this.s.b);return this.s=4*this.s.c,void this.push(o,e)}}}else e&&f(5)},r}();_e.Decompress=I;return _e})