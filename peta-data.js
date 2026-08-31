/* peta-data.js — Data jalur Bawakaraeng yang dipakai bersama oleh
 * index.html (bagian "Peta Jalur interaktif") dan peta-fullscreen.html.
 *
 * PENTING: data jalur/pos/air/sinyal HANYA boleh diubah di file ini.
 * Jangan disalin ulang ke file lain supaya tidak ada versi yang berbeda.
 *
 * Dependensi eksternal: TIDAK ADA. File ini hanya mendefinisikan data global.
 */
var _jStart=[-5.2536,119.9056], _jEnd=[-5.31694,119.94444];
function _jc(f){return [_jStart[0]+(_jEnd[0]-_jStart[0])*f, _jStart[1]+(_jEnd[1]-_jStart[1])*f];}
var jalurPos=[
  {n:'Lembanna (Pintu Masuk)',f:0,el:1514,st:'ok',d:'Titik awal & registrasi SIMAKSI. Desa terakhir — ada warung & basecamp.'},
  {n:'Pos 0',f:0.126,el:1680,st:'ok',d:'Awal jalur menembus hutan pinus.'},
  {n:'Pos 1',f:0.156,el:1719,st:'ok',d:'Tugu & papan penunjuk arah — pemisah jalur Lembah Ramma dan jalur puncak.'},
  {n:'Pos 2',f:0.225,el:1810,st:'ok',d:'💧 Sumber air · ⛺ cocok mendirikan tenda.'},
  {n:'Pintu Rimba',f:0.288,el:1893,st:'ok',d:'Gerbang masuk hutan lebat, jalur mulai menanjak.'},
  {n:'Pos 3',f:0.331,el:1950,st:'warn',d:'Padang rumput luas, sering tertutup kabut tebal.'},
  {n:'Pos 5',f:0.499,el:2170,st:'warn',d:'💧 Batas sumber air TERAKHIR — isi penuh persediaan di sini.'},
  {n:'Memorial',f:0.544,el:2230,st:'warn',d:'Tugu peringatan untuk mengenang pendaki.'},
  {n:'Pos 8',f:0.703,el:2440,st:'warn',d:'Vegetasi menipis, angin mulai kencang.'},
  {n:'Pos 9',f:0.833,el:2610,st:'danger',d:'Perpotongan jalur Sinjai. Trek menanjak & tebing curam menuju puncak.'},
  {n:'Puncak Bawakaraeng',f:1,el:2830,st:'danger',d:'🏔️ Puncak 2.830 mdpl. Hati-hati cuaca cepat berubah.'}
];
var waterPos=[
  {n:'Sumber Air Pos 2',f:0.225,el:1810,type:'Mata air / aliran',note:'Aliran air kecil dekat Pos 2. Cocok untuk isi ulang & area mendirikan tenda.'},
  {n:'Sumber Air Pos 5',f:0.499,el:2170,type:'Mata air (TERAKHIR)',note:'Titik air TERAKHIR sebelum puncak - WAJIB isi penuh semua persediaan di sini.'}
];
var signalPos=[
  {n:'Lembanna (Basecamp)',f:0,el:1514,q:'kuat',op:'Telkomsel / XL',d:'Desa terakhir & titik registrasi. Sinyal paling stabil — kirim kabar dan unduh peta di sini sebelum naik.'},
  {n:'Punggungan Pos 1',f:0.156,el:1719,q:'lemah',op:'Telkomsel',d:'Area tugu cukup terbuka. Sinyal timbul-tenggelam; coba angkat HP tinggi menghadap arah lembah/kota.'},
  {n:'Padang Pos 3',f:0.331,el:1950,q:'lemah',op:'Telkomsel',d:'Padang rumput terbuka. Saat kabut tipis kadang dapat sinyal untuk SMS atau telepon darurat.'},
  {n:'Punggungan Pos 8',f:0.703,el:2440,q:'lemah',op:'Telkomsel',d:'Vegetasi menipis dan terbuka ke arah barat. Sinyal muncul di titik-titik tertentu saja.'},
  {n:'Pertigaan Pos 9 (Ridge Sinjai)',f:0.833,el:2610,q:'kuat',op:'Telkomsel / XL',d:'Punggungan tinggi dengan pandangan lepas. Salah satu titik sinyal terbaik di jalur atas.'},
  {n:'Puncak Bawakaraeng',f:1,el:2830,q:'kuat',op:'Telkomsel / XL',d:'Puncak terbuka 2.830 mdpl. Umumnya dapat sinyal untuk kabar singkat — hemat baterai HP.'}
];
var _SIG_Q={kuat:{c:'#2ecc71',t:'Kuat'},lemah:{c:'#e5951c',t:'Lemah'}};
var _jzc={ok:'#08a35f',warn:'#d5803b',danger:'#ff2d55'};
var _jzt={ok:'Aman',warn:'Waspada',danger:'Bahaya'};
