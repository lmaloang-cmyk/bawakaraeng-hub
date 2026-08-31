/* radio-qr.js — Pembuat QR minimal (mandiri, tanpa dependensi) untuk pairing
 * Radio PTT Offline Pintu Angin.
 *
 * Batasan sengaja: hanya mode BYTE, koreksi kesalahan level L, versi 1–40.
 * Mask dipilih otomatis (penalti terendah dari 8 mask) sesuai spesifikasi QR.
 * Port dari algoritma Nayuki qrcodegen + tabel spesifikasi ISO 18004,
 * diverifikasi bit-per-bit terhadap cv2.QRCodeEncoder/QRCodeDetector.
 *
 * API:
 *   QRGen.make(text) -> { size, modules (bool[row][col]), version, quiet }
 *   QRGen.toCanvas(text, canvas, modulePx) -> menggambar ke canvas
 *   QRGen.capacity(v) -> kapasitas byte mode L untuk versi v
 */
(function(root){
'use strict';

/* Kapasitas byte-mode level L per versi 1..40 (tabel referensi umum QR). */
var CAP_L=[17,32,53,78,106,134,154,192,230,271,321,367,425,458,520,570,644,718,792,858,
  929,1003,1091,1171,1273,1367,1465,1528,1628,1732,1840,1952,2068,2188,2303,2431,2563,2699,2809,2953];

/* [eccPerBlock, numBlocks] per versi untuk level L (ISO 18004 tabel 9).
 * v16 memakai [20,8] supaya cocok dengan kapasitas kanonik 570 byte. */
var ECC_SPLIT={
  1:[7,1],2:[10,1],3:[15,1],4:[20,1],5:[26,1],6:[18,2],7:[20,2],8:[24,2],9:[30,2],
  10:[18,4],11:[20,4],12:[24,4],13:[26,4],14:[30,4],15:[22,6],16:[24,6],17:[28,6],
  18:[30,6],19:[28,7],20:[28,8],21:[28,8],22:[28,9],23:[30,9],24:[30,10],25:[26,12],
  26:[28,12],27:[30,12],28:[30,13],29:[30,14],30:[30,15],31:[30,16],32:[30,17],33:[30,18],
  34:[30,19],35:[30,19],36:[30,20],37:[30,21],38:[30,22],39:[30,24],40:[30,25]
};
var ECC_OVERRIDE=null;
var MASK_OVERRIDE=null;
var VERSION_OVERRIDE=null;

function rawModules(v){
  var r=(16*v+128)*v+64;
  if(v>=2){var na=Math.floor(v/7)+2;r-=(25*na-10)*na-55;if(v>=7)r-=36;}
  return r;
}
function eccStruct(v){
  if(ECC_OVERRIDE&&ECC_OVERRIDE[v])return ECC_OVERRIDE[v];
  return ECC_SPLIT[v];
}
function dataCodewords(v){var e=eccStruct(v);return Math.floor(rawModules(v)/8)-e[0]*e[1];}
function capacity(v){var hdr=(v<=9)?12:20;return Math.floor((dataCodewords(v)*8-hdr)/8);}

/* ---- GF(256) polinom 0x11D ---- */
var EXP=new Uint8Array(512),LOG=new Uint8Array(256);
(function(){var x=1;for(var i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11D;}for(var i2=255;i2<512;i2++)EXP[i2]=EXP[i2-255];})();
function gfMul(a,b){return (a&&b)?EXP[LOG[a]+LOG[b]]:0;}

/* Polinom generator derajat deg; hasil: koefisien DESCENDING tanpa leading-1,
 * panjang deg — kompatibel dengan LFSR pembagian di bawah. */
function rsGenerator(deg){
  var res=new Array(deg).fill(0);
  res[deg-1]=1; /* mulai dari monomial x^0 (disimpan di ujung kanan, gaya Nayuki) */
  var rootv=1;
  for(var i=0;i<deg;i++){
    for(var j=0;j<deg;j++){
      res[j]=gfMul(res[j],rootv);
      if(j+1<deg)res[j]^=res[j+1];
    }
    rootv=gfMul(rootv,2);
  }
  return res;
}
function rsRemainder(data,poly){
  var res=new Array(poly.length).fill(0);
  for(var i=0;i<data.length;i++){
    var f=data[i]^res.shift();
    res.push(0);
    if(f)for(var j=0;j<poly.length;j++)res[j]^=gfMul(poly[j],f);
  }
  return res;
}

function alignPos(v){
  if(v===1)return[];
  var num=Math.floor(v/7)+2;
  var step=(v===32)?26:Math.ceil((v*4+4)/(num*2-2))*2;
  var size=v*4+17,res=[6];
  for(var pos=size-7;res.length<num;pos-=step)res.splice(1,0,pos);
  return res;
}

function BitBuf(){this.bits=[];}
BitBuf.prototype.put=function(val,len){for(var i=len-1;i>=0;i--)this.bits.push((val>>>i)&1);};
BitBuf.prototype.putBytes=function(arr){for(var i=0;i<arr.length;i++)this.put(arr[i],8);};

function buildCodewords(textBytes,v){
  var bb=new BitBuf();
  bb.put(4,4); /* mode byte */
  bb.put(textBytes.length,(v<=9)?8:16);
  bb.putBytes(textBytes);
  var capBits=dataCodewords(v)*8;
  var term=Math.min(4,capBits-bb.bits.length);
  if(term>0)bb.put(0,term);
  while(bb.bits.length%8!==0)bb.bits.push(0);
  var pi=0;
  while(bb.bits.length<capBits){bb.put(pi%2===0?0xEC:0x11,8);pi++;}
  var data=[];
  for(var i=0;i<bb.bits.length;i+=8){var b=0;for(var j=0;j<8;j++)b=(b<<1)|bb.bits[i+j];data.push(b);}

  var e=eccStruct(v),eccLen=e[0],numBlocks=e[1];
  var raw=Math.floor(rawModules(v)/8);
  var shortDataLen=Math.floor(raw/numBlocks)-eccLen;
  var numLong=raw%numBlocks;
  var gen=rsGenerator(eccLen);
  var blocks=[],off=0;
  for(var k=0;k<numBlocks;k++){
    var len=shortDataLen+(k>=numBlocks-numLong?1:0);
    var d=data.slice(off,off+len);off+=len;
    blocks.push({d:d,e:rsRemainder(d,gen)});
  }
  var out=[];
  for(var i2=0;i2<shortDataLen+1;i2++)for(var k2=0;k2<numBlocks;k2++)if(i2<blocks[k2].d.length)out.push(blocks[k2].d[i2]);
  for(var i3=0;i3<eccLen;i3++)for(var k3=0;k3<numBlocks;k3++)out.push(blocks[k3].e[i3]);
  return out;
}

function make(text){
  var utf=unescape(encodeURIComponent(text));
  var textBytes=[];for(var i=0;i<utf.length;i++)textBytes.push(utf.charCodeAt(i)&0xFF);
  var v=0;
  for(var vv=1;vv<=40;vv++)if(capacity(vv)>=textBytes.length){v=vv;break;}
  if(VERSION_OVERRIDE!=null){v=VERSION_OVERRIDE;if(capacity(v)<textBytes.length)throw new Error('Teks tidak muat di versi '+v);}
  if(!v)throw new Error('Teks terlalu panjang untuk QR (maks '+capacity(40)+' byte)');

  var size=v*4+17,r,c;
  var mod=[],func=[];
  for(r=0;r<size;r++){mod.push(new Array(size).fill(false));func.push(new Array(size).fill(false));}
  function mark(r0,c0,val){mod[r0][c0]=val;func[r0][c0]=true;}

  /* finder 7x7 + separator: hitam di ring==3 (bingkai) dan ring<=1 (inti 3x3) */
  function drawFinder(cr,cc){
    for(var dr=-4;dr<=4;dr++)for(var dc=-4;dc<=4;dc++){
      var rr=cr+dr,cc2=cc+dc;
      if(rr<0||rr>=size||cc2<0||cc2>=size)continue;
      var ring=Math.max(Math.abs(dr),Math.abs(dc));
      mark(rr,cc2,ring===3||ring<=1);
    }
  }
  drawFinder(3,3);drawFinder(3,size-4);drawFinder(size-4,3);

  /* alignment 5x5 */
  var ap=alignPos(v);
  for(var ai=0;ai<ap.length;ai++)for(var aj=0;aj<ap.length;aj++){
    if((ai===0&&aj===0)||(ai===0&&aj===ap.length-1)||(ai===ap.length-1&&aj===0))continue;
    var cr2=ap[ai],cc3=ap[aj];
    for(var dr2=-2;dr2<=2;dr2++)for(var dc2=-2;dc2<=2;dc2++)
      mark(cr2+dr2,cc3+dc2,Math.max(Math.abs(dr2),Math.abs(dc2))!==1);
  }

  /* timing */
  for(var t=0;t<size;t++){
    if(!func[6][t])mark(6,t,t%2===0);
    if(!func[t][6])mark(t,6,t%2===0);
  }

  /* tandai area format/versi sebagai modul fungsi (nilai ditulis setelah mask) */
  for(var f=0;f<9;f++){func[8][f]=true;func[f][8]=true;}
  for(var f2=0;f2<8;f2++){func[8][size-1-f2]=true;func[size-1-f2][8]=true;}
  if(v>=7)for(var vr=0;vr<6;vr++)for(var vc=0;vc<3;vc++){func[vr][size-11+vc]=true;func[size-11+vc][vr]=true;}

  /* data zigzag */
  var code=buildCodewords(textBytes,v);
  var bits=[];for(var bi=0;bi<code.length;bi++)for(var bj=7;bj>=0;bj--)bits.push((code[bi]>>>bj)&1);
  var idx=0,up=true,cStart=size-1;
  while(cStart>0){
    if(cStart===6)cStart=5;
    for(var ri=0;ri<size;ri++){
      var rr3=up?(size-1-ri):ri;
      for(var ci=0;ci<2;ci++){
        var cc4=cStart-ci;
        if(func[rr3][cc4])continue;
        mod[rr3][cc4]=idx<bits.length?bits[idx]===1:false;
        idx++;
      }
    }
    up=!up;cStart-=2;
  }

  /* mask + penalti */
  function maskBit(m,r2,c2){
    switch(m){
      case 0:return (r2+c2)%2===0;
      case 1:return r2%2===0;
      case 2:return c2%3===0;
      case 3:return (r2+c2)%3===0;
      case 4:return (Math.floor(r2/2)+Math.floor(c2/3))%2===0;
      case 5:return ((r2*c2)%2+(r2*c2)%3)===0;
      case 6:return (((r2*c2)%2+(r2*c2)%3))%2===0;
      case 7:return (((r2+c2)%2+(r2*c2)%3))%2===0;
    }
    return false;
  }
  function penalty(g){
    var pen=0,i,j,k;
    for(i=0;i<size;i++){
      var run=1;
      for(j=1;j<size;j++){if(g[i][j]===g[i][j-1]){run++;if(run===5)pen+=3;else if(run>5)pen++;}else run=1;}
      run=1;
      for(j=1;j<size;j++){if(g[j][i]===g[j-1][i]){run++;if(run===5)pen+=3;else if(run>5)pen++;}else run=1;}
    }
    for(i=0;i<size-1;i++)for(j=0;j<size-1;j++)
      if(g[i][j]===g[i][j+1]&&g[i][j]===g[i+1][j]&&g[i][j]===g[i+1][j+1])pen+=3;
    function light(r3,c3){return r3<0||c3<0||r3>=size||c3>=size?true:!g[r3][c3];}
    for(i=0;i<size;i++)for(j=0;j<=size-7;j++){
      if(g[i][j]&&!g[i][j+1]&&g[i][j+2]&&g[i][j+3]&&g[i][j+4]&&!g[i][j+5]&&g[i][j+6]){
        if((light(i,j-1)&&light(i,j-2)&&light(i,j-3)&&light(i,j-4))||
           (light(i,j+7)&&light(i,j+8)&&light(i,j+9)&&light(i,j+10)))pen+=40;
      }
      if(g[j][i]&&!g[j+1][i]&&g[j+2][i]&&g[j+3][i]&&g[j+4][i]&&!g[j+5][i]&&g[j+6][i]){
        if((light(j-1,i)&&light(j-2,i)&&light(j-3,i)&&light(j-4,i))||
           (light(j+7,i)&&light(j+8,i)&&light(j+9,i)&&light(j+10,i)))pen+=40;
      }
    }
    var dark=0;for(i=0;i<size;i++)for(j=0;j<size;j++)if(g[i][j])dark++;
    pen+=Math.floor(Math.abs(dark*20-size*size*10)/(size*size))*10;
    return pen;
  }
  var bestMask=0,bestPen=Infinity,bestGrid=null;
  var mList=MASK_OVERRIDE!=null?[MASK_OVERRIDE]:[0,1,2,3,4,5,6,7];
  for(var mi=0;mi<mList.length;mi++){
    var m=mList[mi];
    var g=[];
    for(r=0;r<size;r++){var row=new Array(size);for(c=0;c<size;c++)row[c]=func[r][c]?mod[r][c]:(mod[r][c]!==maskBit(m,r,c));g.push(row);}
    var p=penalty(g);
    if(p<bestPen){bestPen=p;bestMask=m;bestGrid=g;}
  }
  var grid=bestGrid;

  /* format info: level L=01, 15-bit BCH poly 0x537, xor 0x5412 */
  var fdata=(1<<3)|bestMask;
  var bch=fdata<<10;
  for(var sh2=14;sh2>=10;sh2--)if((bch>>>sh2)&1)bch^=0x537<<(sh2-10);
  var fmt=((fdata<<10)|(bch&0x3FF))^0x5412;
  function fb(i2){return ((fmt>>>i2)&1)===1;}
  for(var i4=0;i4<=5;i4++)grid[i4][8]=fb(i4);
  grid[7][8]=fb(6);grid[8][8]=fb(7);grid[8][7]=fb(8);
  for(var i5=9;i5<15;i5++)grid[8][14-i5]=fb(i5);
  for(var i6=0;i6<8;i6++)grid[8][size-1-i6]=fb(i6);
  for(var i7=8;i7<15;i7++)grid[size-15+i7][8]=fb(i7);
  grid[size-8][8]=true; /* dark module */

  /* info versi (v>=7): 18-bit BCH poly 0x1F25 */
  if(v>=7){
    var rem=v;
    for(var sh3=0;sh3<12;sh3++)rem=(rem<<1)^(((rem>>>11)&1)?0x1F25:0);
    var vinfo=(v<<12)|(rem&0xFFF);
    for(var vi=0;vi<18;vi++){
      var bit2=((vinfo>>>vi)&1)===1;
      var a=size-11+vi%3,b2=Math.floor(vi/3);
      grid[b2][a]=bit2;
      grid[a][b2]=bit2;
    }
  }

  return {size:size,modules:grid,version:v,quiet:4};
}

function toCanvas(text,canvas,modulePx){
  var q=make(text);
  var px=modulePx||4,total=(q.size+q.quiet*2)*px;
  canvas.width=total;canvas.height=total;
  var ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,total,total);
  ctx.fillStyle='#000';
  for(var r=0;r<q.size;r++)for(var c=0;c<q.size;c++)
    if(q.modules[r][c])ctx.fillRect((c+q.quiet)*px,(r+q.quiet)*px,px,px);
  return q;
}

var api={make:make,toCanvas:toCanvas,capacity:capacity,
  _setECCOverride:function(tbl){ECC_OVERRIDE=tbl;},
  _setMaskOverride:function(m){MASK_OVERRIDE=m;},
  _setVersionOverride:function(v){VERSION_OVERRIDE=v;},
  _rawModules:rawModules,_eccStruct:eccStruct,_buildCodewords:buildCodewords};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.QRGen=api;
})(typeof window!=='undefined'?window:globalThis);
