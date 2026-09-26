// app.js — interfaz de la versión web.
import * as C from './core.js';

const $ = (s) => document.querySelector(s);
const PREVIEW_SRC = 900;      // resolución de los cuadros usados en la vista previa
const MAX_SCAN = 1500;        // máximo de cuadros que se analizan de un video
const GIFUCT = 'https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm';

// ------------------------------------------------------------------ estado
const S = {
  desde: 1, hasta: 1, cada: 1,
  rot: 0, fh: false, fv: false, rev: false,
  mode: C.DEFAULTS.mode, threshold: C.DEFAULTS.threshold, invert: false,
  grid: 'vertical', slitMm: C.DEFAULTS.slitMm, dpi: C.DEFAULTS.dpi,
  hubMm: C.DEFAULTS.hubMm, holeMm: C.DEFAULTS.holeMm,
  papel: 'carta', orient: 'auto', view: 'sim', speed: 120,
  maxFrames: C.DEFAULTS.maxFrames,
};
let source = null;            // { label, desc, total, getFrames(indices, maxDim), dispose() }
let thumbs = { frames: [], idx: [] };
let loadToken = 0;
let anim = { frames: [], i: 0, timer: null };
let pdfUrl = null;
let busy = false;

const opts = () => ({
  dpi: S.dpi, slitMm: S.slitMm, polar: S.grid === 'polar', horizontal: S.grid === 'horizontal',
  orient: S.orient, papel: S.papel, marginMm: C.DEFAULTS.marginMm, hubMm: S.hubMm, holeMm: S.holeMm,
  ref: C.DEFAULTS.ref, mode: S.mode, threshold: S.threshold, invert: S.invert,
  rot: S.rot, fh: S.fh, fv: S.fv,
});

// ------------------------------------------------------------------ utilidades
function log(msg) {
  const el = $('#log');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const once = (el, ev) => new Promise((res, rej) => {
  const ok = () => { cleanup(); res(); };
  const bad = () => { cleanup(); rej(new Error('Este navegador no pudo leer el video (formato o códec no soportado). ' +
    'Prueba en Chrome, Edge o Safari, o conviértelo a MP4 (H.264) o WebM.')); };
  const cleanup = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
  el.addEventListener(ev, ok); el.addEventListener('error', bad);
});
const fitDims = (w, h, maxDim) => {
  if (!maxDim || Math.max(w, h) <= maxDim) return [w, h];
  const k = maxDim / Math.max(w, h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
};
function domCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Dibuja cualquier fuente a (w,h) y devuelve un ImageBitmap (transferible al worker). */
async function toBitmap(src, w, h) {
  const c = domCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return createImageBitmap(c);
}

// ------------------------------------------------------------------ fuentes
async function videoSource(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  await once(v, 'loadedmetadata');
  if (v.readyState < 2) await once(v, 'loadeddata');
  const times = await scanFrameTimes(v);
  const dur = times.length > 1 ? (times[times.length - 1] - times[0]) / (times.length - 1) : 1 / 30;
  const frameTime = (i) => (i + 1 < times.length ? (times[i] + times[i + 1]) / 2 : times[i] + dur / 2);
  async function seek(t) {
    if (Math.abs(v.currentTime - t) < 1e-6) return;
    const p = once(v, 'seeked');
    v.currentTime = t;
    await Promise.race([p, new Promise((r) => setTimeout(r, 4000))]);
  }
  return {
    label: file.name,
    desc: `${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(2)} s`,
    total: times.length,
    async getFrames(indices, maxDim) {
      const out = [];
      for (const i of indices) {
        await seek(frameTime(i));
        const [w, h] = fitDims(v.videoWidth, v.videoHeight, maxDim);
        out.push({ bitmap: await toBitmap(v, w, h), w, h });
      }
      return out;
    },
    dispose() { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); },
  };
}

/** Lista los tiempos exactos de cada cuadro reproduciendo el video (requestVideoFrameCallback). */
async function scanFrameTimes(v) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
    log('Este navegador no reporta cuadros exactos; se asumen 30 cuadros por segundo.');
    return Array.from({ length: Math.max(1, Math.floor(v.duration * 30)) }, (_, i) => i / 30);
  }
  $('#src-info').textContent = 'Analizando cuadros del video…';
  v.playbackRate = v.duration <= 20 ? 0.5 : 1;
  const times = [0];
  await new Promise((resolve, reject) => {
    let finished = false;
    const done = () => { if (finished) return; finished = true; v.pause(); resolve(); };
    const cb = (_now, meta) => {
      times.push(meta.mediaTime);
      if (times.length % 10 === 0) $('#src-info').textContent = `Analizando cuadros del video… ${times.length}`;
      if (times.length >= MAX_SCAN) done(); else if (!finished) v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
    v.addEventListener('ended', () => setTimeout(done, 50), { once: true });
    setTimeout(done, (v.duration / v.playbackRate) * 1000 + 8000);
    v.play().catch(reject);
  });
  v.playbackRate = 1;
  times.sort((a, b) => a - b);
  const uniq = times.filter((t, i) => i === 0 || t - times[i - 1] > 1e-4);
  if (uniq.length > 1 && uniq[1] - uniq[0] < 1e-3) uniq.shift();
  return uniq;
}

async function animatedSource(file) {
  const type = file.type || (file.name.toLowerCase().endsWith('.gif') ? 'image/gif' : '');
  if ('ImageDecoder' in window && type && await ImageDecoder.isTypeSupported(type)) {
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
    await dec.tracks.ready;
    const total = dec.tracks.selectedTrack.frameCount;
    const first = (await dec.decode({ frameIndex: 0 })).image;
    const W = first.displayWidth, H = first.displayHeight;
    first.close();
    return {
      label: file.name, desc: `${W}×${H} · animación`, total,
      async getFrames(indices, maxDim) {
        const out = [];
        for (const i of indices) {
          const { image } = await dec.decode({ frameIndex: i });
          const [w, h] = fitDims(W, H, maxDim);
          out.push({ bitmap: await toBitmap(image, w, h), w, h });
          image.close();
        }
        return out;
      },
      dispose() { dec.close(); },
    };
  }
  if (type !== 'image/gif') return null;
  // Respaldo para navegadores sin ImageDecoder: gifuct-js
  log('Decodificando GIF con gifuct-js…');
  const { parseGIF, decompressFrames } = await import(GIFUCT);
  const gif = parseGIF(await file.arrayBuffer());
  const parts = decompressFrames(gif, true);
  const W = gif.lsd.width, H = gif.lsd.height;
  const full = domCanvas(W, H), fctx = full.getContext('2d');
  const patch = domCanvas(1, 1), pctx = patch.getContext('2d');
  const frames = [];
  let prev = null;
  for (const f of parts) {
    const { left, top, width, height } = f.dims;
    const saved = f.disposalType === 3 ? fctx.getImageData(0, 0, W, H) : null;
    patch.width = width; patch.height = height;
    pctx.putImageData(new ImageData(f.patch, width, height), 0, 0);
    fctx.drawImage(patch, left, top);
    frames.push(await createImageBitmap(full));
    if (f.disposalType === 2) fctx.clearRect(left, top, width, height);
    else if (saved) fctx.putImageData(saved, 0, 0);
    prev = f;
  }
  void prev;
  return {
    label: file.name, desc: `${W}×${H} · GIF`, total: frames.length,
    async getFrames(indices, maxDim) {
      const [w, h] = fitDims(W, H, maxDim);
      return Promise.all(indices.map(async (i) => ({ bitmap: await toBitmap(frames[i], w, h), w, h })));
    },
    dispose() { frames.forEach((b) => b.close()); },
  };
}

function imagesSource(files, label) {
  files = [...files].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(f.name));
  files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
  if (!files.length) throw new Error('No encontré imágenes en la selección.');
  return {
    label, desc: `${files.length} imágenes (ordenadas por nombre)`, total: files.length,
    async getFrames(indices, maxDim) {
      const out = [];
      for (const i of indices) {
        const bmp = await createImageBitmap(files[i], { imageOrientation: 'from-image' });
        const [w, h] = fitDims(bmp.width, bmp.height, maxDim);
        out.push({ bitmap: await toBitmap(bmp, w, h), w, h });
        bmp.close();
      }
      return out;
    },
    dispose() {},
  };
}

function demoSource() {
  return {
    label: 'Demo', desc: 'pelota que rebota y rueda que gira', total: 6,
    async getFrames(indices, maxDim) {
      const polar = S.grid === 'polar';
      const [W, H] = polar ? [1500, 1500] : [1500, 990];
      const [w, h] = fitDims(W, H, maxDim);
      const c = domCanvas(w, h), ctx = c.getContext('2d');
      const out = [];
      for (const i of indices) { C.drawDemoFrame(ctx, i, 6, w, h); out.push({ bitmap: await createImageBitmap(c), w, h }); }
      return out;
    },
    dispose() {},
  };
}

async function setSource(factory) {
  try {
    $('#src-info').textContent = 'Cargando…';
    const src = await factory();
    if (!src) throw new Error('Formato no soportado.');
    if (src.total < 2) throw new Error('El origen tiene menos de 2 cuadros.');
    if (source) source.dispose();
    source = src;
    $('#src-info').innerHTML = `<b>${escapeHtml(src.label)}</b><br>${escapeHtml(src.desc)} · ${src.total} cuadros`;
    const cada = src.total > S.maxFrames ? Math.ceil(src.total / 6) : 1;
    setField('desde', 1); setField('hasta', src.total); setField('cada', cada);
    $('#desde').max = $('#hasta').max = src.total;
    log(`Origen: ${src.label} (${src.total} cuadros)`);
    if (cada > 1) log(`Tiene más de ${S.maxFrames} cuadros: propuse tomar 1 de cada ${cada}. Ajusta el rango a un ciclo del movimiento.`);
    $('#btn-gen').disabled = false;
    onSelection();
  } catch (e) {
    $('#src-info').textContent = 'No se pudo usar ese origen.';
    log('✗ ' + (e.message || e));
    alert(e.message || e);
  }
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pickFiles(files) {
  files = [...files];
  if (!files.length) return;
  const vid = files.find((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));
  const anim = files.length === 1 && /\.(gif|webp|apng)$/i.test(files[0].name) ? files[0] : null;
  if (vid && files.length === 1) return setSource(() => videoSource(vid));
  if (vid) return alert('Usa UN video, o solo imágenes sueltas (no ambos).');
  if (anim) return setSource(async () => (await animatedSource(anim)) || imagesSource([anim], anim.name));
  return setSource(() => imagesSource(files, files.length === 1 ? files[0].name : `${files.length} imágenes`));
}

// ------------------------------------------------------------------ selección
function indices() {
  if (!source) return null;
  return C.selectionIndices(source.total, S.desde, S.hasta, S.cada);
}

function onSelection() {
  const idx = indices();
  const info = $('#sel-info');
  if (!idx) { info.textContent = ''; return; }
  const n = idx.length;
  if (n > S.maxFrames) { info.className = 'hint bad'; info.textContent = `Seleccionados: ${n} de ${source.total} — máximo ${S.maxFrames}. Reduce el rango o sube «1 de cada».`; }
  else if (n < 2) { info.className = 'hint bad'; info.textContent = `Seleccionados: ${n} — se necesitan al menos 2.`; }
  else { info.className = 'hint ok'; info.textContent = `Seleccionados: ${n} de ${source.total} cuadros (${idx.map((i) => i + 1).join(', ')})`; }
  reloadThumbs();
}

const reloadThumbs = debounce(async () => {
  const idx = indices();
  const token = ++loadToken;
  if (!idx || idx.length < 2 || idx.length > S.maxFrames) { setThumbs([], []); return; }
  try {
    const frames = await source.getFrames(idx, PREVIEW_SRC);
    if (token !== loadToken) { frames.forEach((f) => f.bitmap.close()); return; }
    setThumbs(frames, idx);
  } catch (e) { log('✗ ' + (e.message || e)); }
}, 300);

function setThumbs(frames, idx) {
  thumbs.frames.forEach((f) => f.bitmap.close && f.bitmap.close());
  thumbs = { frames, idx };
  render();
}

// ------------------------------------------------------------------ vista previa
const render = debounce(renderNow, 120);

function renderNow() {
  const o = opts();
  const frames = S.rev ? [...thumbs.frames].reverse() : thumbs.frames;
  const idx = S.rev ? [...thumbs.idx].reverse() : thumbs.idx;
  $('#polar-box').style.display = o.polar ? '' : 'none';
  $('#thr-row').style.display = S.mode === 'bw' ? '' : 'none';
  document.querySelectorAll('input[name=orient]').forEach((r) => { r.disabled = o.polar; });
  $('#rot-label').textContent = `${S.rot}°`;
  if (!frames.length) {
    setAnim([], source ? 'Ajusta la selección (entre 2 y ' + S.maxFrames + ' cuadros)' : 'Elige un origen o prueba el demo');
    $('#strip').innerHTML = '';
    $('#measures').innerHTML = '<li class="muted">—</li>';
    $('#warns').innerHTML = '';
    return;
  }
  const n = frames.length;
  const [ew, eh] = C.editedSize(frames[0].w, frames[0].h, S.rot);
  const aspect = eh / ew;
  $('#orient-auto').textContent = `Auto (${C.recommendedOrientation(aspect)})`;
  const lay = C.computeLayout(o, aspect, n);
  const d = C.describeLayout(lay, o);
  $('#measures').innerHTML = d.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
  $('#warns').innerHTML = d.warn.map((l) => `<li>⚠ ${escapeHtml(l)}</li>`).join('');
  const smm = C.pxToMm(lay.slit, lay.dpi);
  $('#slit-info').textContent = `= ${lay.slit} px a ${lay.dpi} dpi (${smm.toFixed(2)} mm reales)` +
    (o.polar ? ' en el radio de referencia' : ` · periodo ${(smm * n).toFixed(2)} mm`);

  const edits = { rot: S.rot, fh: S.fh, fv: S.fv };
  const box = o.polar ? [460, 460] : (aspect <= 1 ? [460, Math.max(1, Math.round(460 * aspect))] : [Math.max(1, Math.round(460 / aspect)), 460]);
  const small = frames.map((f) => C.prepareFrame(f.bitmap, f.w, f.h, box, edits, o));
  drawStrip(small, idx);

  let seq;
  if (S.view === 'frames') {
    seq = small;
  } else if (o.polar) {
    const Sz = Math.round(Math.min(1400, Math.max(460, (2 * 3 * lay.K) / (C.TAU * 0.75))));
    const k = Sz / lay.size[0];
    const big = frames.map((f) => C.prepareFrame(f.bitmap, f.w, f.h, [Sz, Sz], edits, o));
    seq = C.simulatePolar(big, lay.K, lay.hub * k, lay.hole * k);
  } else {
    const [W, H] = lay.size;
    let k = Math.max(box[0] / W, 2 / lay.slit);
    k = Math.min(k, 1600 / Math.max(W, H));
    const size = [Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k))];
    const big = frames.map((f) => C.prepareFrame(f.bitmap, f.w, f.h, size, edits, o));
    seq = C.simulateBars(big, Math.max(1, Math.round(lay.slit * k)), !o.horizontal);
  }
  setAnim(seq.map(rasterCanvas));
}

function rasterCanvas(r) {
  const c = domCanvas(r.w, r.h);
  c.getContext('2d').putImageData(C.rasterToImageData(r), 0, 0);
  return c;
}

function drawStrip(small, idx) {
  const strip = $('#strip');
  strip.innerHTML = '';
  small.forEach((r, i) => {
    const fig = document.createElement('figure');
    const c = rasterCanvas(r);
    fig.appendChild(c);
    const cap = document.createElement('figcaption');
    cap.textContent = `${i + 1} · cuadro ${idx[i] + 1}`;
    fig.appendChild(cap);
    strip.appendChild(fig);
  });
}

function setAnim(frames, msg = '') {
  clearTimeout(anim.timer);
  anim = { frames, i: 0, timer: null };
  $('#stage-msg').textContent = msg;
  $('#stage-msg').hidden = !!frames.length;
  const cv = $('#view');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (frames.length) tick();
}

function tick() {
  const cv = $('#view');
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(cv.clientWidth * dpr) || 460, H = Math.round(cv.clientHeight * dpr) || 460;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  const f = anim.frames[anim.i % anim.frames.length];
  const k = Math.min(W / f.width, H / f.height);
  const w = f.width * k, h = f.height * k;
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(f, (W - w) / 2, (H - h) / 2, w, h);
  anim.i++;
  anim.timer = setTimeout(tick, S.speed);
}

// ------------------------------------------------------------------ generar
async function generate() {
  const idx = indices();
  if (busy || !idx) return;
  if (idx.length < 2 || idx.length > S.maxFrames) { alert(`Ajusta la selección: entre 2 y ${S.maxFrames} cuadros.`); return; }
  busy = true;
  $('#btn-gen').disabled = true;
  $('#prog').hidden = false;
  $('#dl-row').hidden = true;
  log('──────────────');
  try {
    const o = opts();
    log('Leyendo cuadros a resolución completa…');
    let src = await source.getFrames(idx, null);
    if (S.rev) src.reverse();
    const [ew, eh] = C.editedSize(src[0].w, src[0].h, S.rot);
    const lay = C.computeLayout(o, eh / ew, src.length);
    C.describeLayout(lay, o).lines.forEach((l) => log(l));
    let pdf;
    try {
      pdf = await runWorker(src, o, lay);
    } catch (e) {
      if (!e.fallback) throw e;
      log('El navegador no permite trabajar en segundo plano; generando en la página (puede congelarse unos segundos)…');
      src = await source.getFrames(idx, null);
      if (S.rev) src.reverse();
      await new Promise((r) => setTimeout(r, 50));
      pdf = await C.generatePdf(src, o, lay, log);
    }
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
    $('#dl').href = pdfUrl;
    $('#open-pdf').href = pdfUrl;
    $('#dl-row').hidden = false;
    log('Listo. Página 1 → papel · Página 2 → acetato. Imprime ambas al 100 % (tamaño real).');
    if (o.polar) log('Recorta el disco por la línea circular clara, perfóralo en el centro y fíjalo sobre la cruz.');
  } catch (e) {
    log('✗ ' + (e.message || e));
    alert('No se pudo generar: ' + (e.message || e));
  } finally {
    busy = false;
    $('#btn-gen').disabled = false;
    $('#prog').hidden = true;
  }
}

function runWorker(src, o, lay) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); }
    catch { reject(Object.assign(new Error('sin worker'), { fallback: true })); return; }
    let started = false;
    w.onmessage = (e) => {
      started = true;
      const m = e.data;
      if (m.type === 'progress') log(m.msg);
      else if (m.type === 'done') { w.terminate(); resolve(m.pdf); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.msg)); }
    };
    w.onerror = (e) => {
      w.terminate();
      e.preventDefault();
      reject(started ? new Error(e.message || 'Error en el procesamiento') : Object.assign(new Error('sin worker'), { fallback: true }));
    };
    w.postMessage({ sources: src, opts: o, lay }, src.map((s) => s.bitmap));
  });
}

// ------------------------------------------------------------------ controles
function setField(k, v) {
  S[k] = v;
  const el = document.getElementById(k);
  if (el) { if (el.type === 'checkbox') el.checked = v; else el.value = v; }
}

function bind() {
  $('#in-video').addEventListener('change', (e) => { pickFiles(e.target.files); e.target.value = ''; });
  $('#in-images').addEventListener('change', (e) => { pickFiles(e.target.files); e.target.value = ''; });
  $('#in-folder').addEventListener('change', (e) => {
    const files = [...e.target.files];
    const vids = files.filter((f) => f.type.startsWith('video/'));
    if (vids.length === 1 && !files.some((f) => f.type.startsWith('image/'))) pickFiles(vids);
    else if (files.length) setSource(() => imagesSource(files, `Carpeta ${files[0].webkitRelativePath.split('/')[0] || ''}`));
    e.target.value = '';
  });
  $('#btn-demo').addEventListener('click', () => setSource(async () => demoSource()));

  for (const k of ['desde', 'hasta', 'cada']) {
    $('#' + k).addEventListener('input', (e) => { S[k] = Math.max(1, parseInt(e.target.value, 10) || 1); onSelection(); });
  }
  $('#rot-l').addEventListener('click', () => { S.rot = (S.rot + 270) % 360; render(); });
  $('#rot-r').addEventListener('click', () => { S.rot = (S.rot + 90) % 360; render(); });
  $('#reset-edits').addEventListener('click', () => { S.rot = 0; setField('fh', false); setField('fv', false); setField('rev', false); render(); });
  for (const k of ['fh', 'fv', 'rev', 'invert']) $('#' + k).addEventListener('change', (e) => { S[k] = e.target.checked; render(); });
  $('#mode').addEventListener('change', (e) => { S.mode = e.target.value; render(); });
  $('#threshold').addEventListener('input', (e) => { S.threshold = +e.target.value; $('#thr-out').value = e.target.value; render(); });
  $('#slitMm').addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (v > 0) { S.slitMm = v; render(); } });
  $('#dpi').addEventListener('change', (e) => { S.dpi = +e.target.value; render(); });
  $('#hubMm').addEventListener('input', (e) => { S.hubMm = Math.max(0, parseFloat(e.target.value) || 0); render(); });
  $('#holeMm').addEventListener('input', (e) => { S.holeMm = Math.max(0, parseFloat(e.target.value) || 0); render(); });
  $('#speed').addEventListener('input', (e) => { S.speed = 640 - +e.target.value; });
  S.speed = 640 - +$('#speed').value;
  $('#suggest').addEventListener('click', () => {
    const n = indices()?.length || 6;
    const s = C.suggestSlitMm(n, S.grid === 'polar', S.dpi);
    setField('slitMm', s.mm);
    log(`Franja sugerida para ${n} cuadros: ${s.px} px a ${S.dpi} dpi (${s.mm} mm).`);
    render();
  });
  document.querySelectorAll('input[name=grid]').forEach((r) => r.addEventListener('change', (e) => {
    const was = S.grid;
    S.grid = e.target.value;
    // cambia la franja por defecto al entrar/salir de polar (si no la tocaron)
    if (S.grid === 'polar' && S.slitMm === C.DEFAULTS.slitMm) setField('slitMm', C.DEFAULTS.slitMmPolar);
    if (was === 'polar' && S.grid !== 'polar' && S.slitMm === C.DEFAULTS.slitMmPolar) setField('slitMm', C.DEFAULTS.slitMm);
    if (source && source.label === 'Demo') reloadThumbs(); else render();
  }));
  document.querySelectorAll('input[name=papel]').forEach((r) => r.addEventListener('change', (e) => { S.papel = e.target.value; render(); }));
  document.querySelectorAll('input[name=orient]').forEach((r) => r.addEventListener('change', (e) => { S.orient = e.target.value; render(); }));
  document.querySelectorAll('input[name=view]').forEach((r) => r.addEventListener('change', (e) => { S.view = e.target.value; render(); }));
  $('#btn-gen').addEventListener('click', generate);

  // arrastrar y soltar
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; $('#drop').hidden = false; });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('#drop').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('#drop').hidden = true; pickFiles(e.dataTransfer.files); });
  window.addEventListener('resize', debounce(() => anim.frames.length && tick(), 200));
}

bind();
render();
// enlace al repositorio cuando se publica en usuario.github.io/repositorio
if (location.hostname.endsWith('github.io')) {
  const user = location.hostname.split('.')[0];
  const repo = location.pathname.split('/').filter(Boolean)[0];
  $('#repo-link').href = `https://github.com/${user}/${repo || user + '.github.io'}`;
} else {
  $('#repo-link').hidden = true;
}
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// para pruebas automatizadas
window.__rejilla = { S, get source() { return source; }, get thumbs() { return thumbs; }, get anim() { return anim; }, setSource, demoSource, videoSource, pickFiles };
