/* radio-ptt.js — Radio PTT Offline Pintu Angin
 *
 * Walkie-talkie suara antar-HP TANPA internet & tanpa sinyal seluler:
 * suara mengalir lewat WebRTC di dalam hotspot WiFi yang dibuat satu HP.
 *
 * Pairing tanpa server memakai QR (kode sesi WebRTC dipadatkan):
 *   - QR Ruangan (BWKR1|R|…)  : dibagikan ketua tim lewat WA — 1 QR untuk semua.
 *   - QR Tawaran (BWKR1|O|…)  : ditampilkan HP host di gunung, dipindai anggota.
 *   - QR Jawaban (BWKR1|A|…)  : ditampilkan HP anggota, dipindai host. Selesai.
 *
 * Host menjadi "menara": menerima mic tiap anggota, mencampur (mix-minus via
 * Web Audio), dan mengirim balik ke semua anggota. Jangkauan = jangkauan WiFi.
 *
 * Dependensi: radio-qr.js (QRGen). Web Bluetooth/aplikasi native: tidak perlu.
 */
window.BWKRadio = (function () {
'use strict';

/* ================= util dasar ================= */
var LS_KEY = 'bwkRadioRooms';
function loadRooms() { try { var r = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
function saveRooms(l) { try { localStorage.setItem(LS_KEY, JSON.stringify(l)); } catch (e) { } }

function b64u(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64uDec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

async function deflateText(t) {
  if (!window.CompressionStream) throw new Error('no-compress');
  var st = new Blob([new TextEncoder().encode(t)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return 'z' + b64u(new Uint8Array(await new Response(st).arrayBuffer()));
}
async function inflateText(p) {
  if (p.charAt(0) === 'z') {
    var st = new Blob([b64uDec(p.slice(1))]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(st).text();
  }
  if (p.charAt(0) === 'r') return new TextDecoder().decode(b64uDec(p.slice(1)));
  return p; /* kompatibilitas: payload mentah */
}
async function packSdp(sdp) {
  try { return await deflateText(sdp); } catch (e) { return 'r' + b64u(new TextEncoder().encode(sdp)); }
}

/* ================= kode QR ================= */
function encodeRoom(room) { return 'BWKR1|R|' + b64u(new TextEncoder().encode(JSON.stringify(room))); }
function parseCode(text) {
  if (!text || typeof text !== 'string') return null;
  text = text.trim();
  if (text.indexOf('BWKR1|') !== 0) return null;
  var parts = text.split('|');
  if (parts[1] === 'R') {
    try { var room = JSON.parse(new TextDecoder().decode(b64uDec(parts[2]))); return { type: 'R', room: room }; } catch (e) { return null; }
  }
  if (parts[1] === 'O' || parts[1] === 'A') {
    var slot = parseInt(parts[2], 10);
    if (isNaN(slot)) return null;
    return { type: parts[1], slot: slot, payload: parts.slice(3).join('|') };
  }
  return null;
}

/* ================= state ================= */
var S = {
  room: null, role: null,        // role: 'host' | 'member'
  stream: null, micTrack: null, actx: null, hostMicSrc: null,
  pcs: {},        // slot -> RTCPeerConnection (sisi host)
  pc: null,       // sisi anggota
  slot: -1, pendingSlot: -1,
  mixDests: {},   // slot -> MediaStreamDestination (mix-minus per anggota)
  remoteSrcs: {}, // slot -> MediaStreamAudioSourceNode (mic anggota)
  remoteEls: {},  // slot/name -> elemen audio (pemakaian anggota)
  members: {},    // slot -> {state}
  talking: false,
  scanHandler: null, scanStop: null
};
var listeners = {};
function on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); }
function emit(ev, d) { (listeners[ev] || []).forEach(function (f) { try { f(d); } catch (e) { } }); }
function log(m) { emit('log', m); }

/* ================= ruangan ================= */
function createRoom(name) {
  var id = 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  var slug = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 12) || 'bwk';
  var pass = '';
  var d = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // tanpa karakter ambigu
  for (var i = 0; i < 8; i++) pass += d.charAt(Math.floor(Math.random() * d.length));
  var room = { i: id, n: (name || 'Rombongan').slice(0, 40), s: ('BWK-' + slug).slice(0, 24), p: pass };
  var l = loadRooms(); l.push(room); saveRooms(l);
  return room;
}
function joinRoomByText(text) {
  var c = parseCode(text);
  if (!c || c.type !== 'R') return null;
  var l = loadRooms();
  if (!l.some(function (r) { return r.i === c.room.i; })) { l.push(c.room); saveRooms(l); }
  return c.room;
}
function deleteRoom(id) { saveRooms(loadRooms().filter(function (r) { return r.i !== id; })); }

/* ================= audio & peer ================= */
async function initAudio() {
  if (S.stream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no-media');
  S.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  S.micTrack = S.stream.getAudioTracks()[0];
  S.micTrack.enabled = false; // PTT: mati sampai tombol ditahan
  S.actx = new (window.AudioContext || window.webkitAudioContext)();
  if (S.actx.state === 'suspended') { try { await S.actx.resume(); } catch (e) { } }
  S.hostMicSrc = S.actx.createMediaStreamSource(S.stream);
}

function waitIce(pc) {
  return new Promise(function (res) {
    if (pc.iceGatheringState === 'complete') return res();
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; res(); } }, 3500);
    pc.addEventListener('icegatheringstatechange', function () {
      if (pc.iceGatheringState === 'complete' && !done) { done = true; clearTimeout(to); res(); }
    });
  });
}

function watchPc(pc, slot) {
  pc.onconnectionstatechange = function () {
    var st = pc.connectionState;
    S.members[slot] = { state: st };
    if (st === 'connected') { log('Slot ' + slot + ' tersambung'); }
    emit('peer', { slot: slot, state: st });
  };
  pc.onicecandidateerror = function () { };
}

function hostWireIncomingTrack(slot, stream) {
  /* Mic anggota masuk: sambungkan ke speaker host + ke mix semua anggota LAIN */
  try {
    var src = S.actx.createMediaStreamSource(stream);
    S.remoteSrcs[slot] = src;
    src.connect(S.actx.destination); /* host ikut mendengar */
    Object.keys(S.mixDests).forEach(function (k) {
      if (+k !== slot) { try { src.connect(S.mixDests[k]); } catch (e) { } }
    });
  } catch (e) { }
}

async function hostMakeOffer() {
  await initAudio();
  var slot = 0;
  while (S.pcs[slot]) slot++;
  var pc = new RTCPeerConnection({ iceServers: [] });
  S.pcs[slot] = pc; S.pendingSlot = slot;

  /* mix khusus untuk anggota ini (mix-minus: tanpa suaranya sendiri) */
  var dest = S.actx.createMediaStreamDestination();
  S.mixDests[slot] = dest;
  S.hostMicSrc.connect(dest); /* suara host → anggota ini */
  Object.keys(S.remoteSrcs).forEach(function (k) { if (+k !== slot) { try { S.remoteSrcs[k].connect(dest); } catch (e) { } } });

  pc.addTransceiver(dest.stream.getAudioTracks()[0], { direction: 'sendrecv' });
  pc.ontrack = function (ev) { hostWireIncomingTrack(slot, ev.streams[0] || new MediaStream([ev.track])); };
  watchPc(pc, slot);

  var offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc);
  return 'BWKR1|O|' + slot + '|' + await packSdp(pc.localDescription.sdp);
}

async function hostAcceptAnswer(text) {
  var c = parseCode(text);
  if (!c || c.type !== 'A') throw new Error('bukan-jawaban');
  var pc = S.pcs[c.slot];
  if (!pc) throw new Error('slot-tak-dikenal');
  var sdp = await inflateText(c.payload);
  await pc.setRemoteDescription({ type: 'answer', sdp: sdp });
  return c.slot;
}

async function memberAnswer(offerText) {
  var c = parseCode(offerText);
  if (!c || c.type !== 'O') throw new Error('bukan-tawaran');
  await initAudio();
  var pc = new RTCPeerConnection({ iceServers: [] });
  S.pc = pc; S.slot = c.slot;
  pc.ontrack = function (ev) {
    /* mix dari host berisi suara host + anggota lain (tanpa diri sendiri) */
    var st = ev.streams[0] || new MediaStream([ev.track]);
    var el = new Audio();
    el.autoplay = true; el.playsInline = true; el.srcObject = st;
    S.remoteEls.host = el;
    el.play().catch(function () { });
  };
  watchPc(pc, c.slot);
  var sdp = await inflateText(c.payload);
  await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
  pc.addTrack(S.micTrack); /* menempel ke transceiver yang disiapkan host */
  var ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  await waitIce(pc);
  return 'BWKR1|A|' + c.slot + '|' + await packSdp(pc.localDescription.sdp);
}

/* ================= PTT ================= */
function setTalking(onOff) {
  S.talking = !!onOff;
  if (S.micTrack) S.micTrack.enabled = S.talking;
  emit('talking', S.talking);
}
function isTalking() { return S.talking; }

function memberList() {
  return Object.keys(S.members).map(function (k) { return { slot: +k, state: S.members[k].state }; });
}

function leave() {
  try { Object.keys(S.pcs).forEach(function (k) { S.pcs[k].close(); }); } catch (e) { }
  try { if (S.pc) S.pc.close(); } catch (e) { }
  try { if (S.stream) S.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { }
  try { if (S.actx) S.actx.close(); } catch (e) { }
  if (S.scanStop) { try { S.scanStop(); } catch (e) { } }
  S.pcs = {}; S.pc = null; S.slot = -1; S.pendingSlot = -1;
  S.mixDests = {}; S.remoteSrcs = {}; S.remoteEls = {}; S.members = {};
  S.stream = null; S.micTrack = null; S.actx = null; S.hostMicSrc = null;
  S.talking = false; S.scanHandler = null;
  emit('peer', { slot: -1, state: 'closed' });
}

/* ================= pemindai QR (kamera) ================= */
function startScan(videoEl, onResult, onError) {
  /* scanHandler dipasang duluan agar hook pengujian tetap bisa menyuntikkan hasil
     pindai walau kamera/BarcodeDetector tidak tersedia (mis. saat uji otomatis) */
  S.scanHandler = onResult;
  var stopped = false, stream = null, iv = null;
  function stop() { stopped = true; if (iv) clearInterval(iv); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); }
  S.scanStop = stop;
  if (!window.BarcodeDetector) { if (onError) onError('no-bd'); return stop; }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(function (s) {
      stream = s; videoEl.srcObject = s; videoEl.play().catch(function () { });
      var bd = new BarcodeDetector({ formats: ['qr_code'] });
      iv = setInterval(async function () {
        if (stopped) return;
        try {
          var codes = await bd.detect(videoEl);
          if (codes && codes.length) { stop(); onResult(codes[0].rawValue); }
        } catch (e) { }
      }, 400);
    })
    .catch(function (e) { if (onError) onError('cam-' + (e && e.name || 'err')); });
  return stop;
}
function stopScan() { if (S.scanStop) { try { S.scanStop(); } catch (e) { } S.scanStop = null; } }

/* ================= API ================= */
return {
  createRoom: createRoom,
  encodeRoom: encodeRoom,
  joinRoomByText: joinRoomByText,
  listRooms: loadRooms,
  deleteRoom: deleteRoom,
  parseCode: parseCode,
  hostMakeOffer: hostMakeOffer,
  hostAcceptAnswer: hostAcceptAnswer,
  memberAnswer: memberAnswer,
  setTalking: setTalking,
  isTalking: isTalking,
  memberList: memberList,
  leave: leave,
  startScan: startScan,
  stopScan: stopScan,
  on: on,
  /* untuk pengujian otomatis */
  _state: S,
  _injectScan: function (text) { if (S.scanHandler) S.scanHandler(text); }
};
})();
