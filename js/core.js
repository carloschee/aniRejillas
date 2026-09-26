// core.js — motor de la animación de rejilla de barrera (scanimation).
// Sin dependencias. Se usa en el hilo principal (vista previa) y en el worker (PDF final).

export const TAU = Math.PI * 2;

export const PAPERS = {
  carta: { label: 'Carta', w: 215.9, h: 279.4 },
  media: { label: 'Media carta', w: 139.7, h: 215.9 },
};

export const DEFAULTS = {
  dpi: 300,
  slitMm: 0.6,        // barras: buen balance nitidez/alineación
  slitMmPolar: 1.0,   // polar: más ancha, gira más suave
  mode: 'bw',
  threshold: 128,
  marginMm: 8,        // margen no imprimible de la hoja
  hubMm: 12,
  holeMm: 1.5,
  ref: 0.75,
  maxFrames: 10,
};

export const mmToPx = (mm, dpi) => Math.max(1, Math.round((mm / 25.4) * dpi));
export const pxToMm = (px, dpi) => (px / dpi) * 25.4;

/** Índices (base 0) elegidos. start/end base 1 e inclusivos. */
export function selectionIndices(total, start = 1, end = null, step = 1) {
  start = Math.max(1, Math.floor(start || 1));
  end = !end ? total : Math.min(Math.floor(end), total);
  step = Math.max(1, Math.floor(step || 1));
  const out = [];
  for (let i = start - 1; i < end; i += step) out.push(i);
  return out;
}

export const recommendedOrientation = (aspect) => (aspect < 1 ? 'horizontal' : 'vertical');
export const editedSize = (w, h, rot) => (rot % 180 ? [h, w] : [w, h]);

export function polarSectors(n, radiusPx, slitPx, ref = DEFAULTS.ref) {
  const per = Math.max(1, Math.round((TAU * radiusPx * ref) / (slitPx * n)));
  return per * n;
}

/** Franja sugerida (mm) para n cuadros: periodo ≈ 3.6 mm en barras. */
export function suggestSlitMm(n, polar, dpi) {
  const mm = polar ? Math.max(0.5, 6 / n) : Math.max(0.34, 3.6 / n);
  const px = mmToPx(mm, dpi);
  return { px, mm: Math.round(pxToMm(px, dpi) * 100) / 100 };
}

/** Hoja, tamaño de imagen, franja y parámetros polares. aspect = alto/ancho del cuadro editado. */
export function computeLayout(o, aspect, n) {
  const dpi = o.dpi;
  const slit = mmToPx(o.slitMm, dpi);
  const orient = o.polar ? 'vertical' : (o.orient === 'auto' ? recommendedOrientation(aspect) : o.orient);
  const P = PAPERS[o.papel];
  let [pw, ph] = [P.w, P.h];
  if (orient === 'horizontal') [pw, ph] = [ph, pw];
  const pagePx = [mmToPx(pw, dpi), mmToPx(ph, dpi)];
  const M = mmToPx(o.marginMm, dpi);
  const aw = pagePx[0] - 2 * M, ah = pagePx[1] - 2 * M;
  let w, h;
  if (o.polar) { w = h = Math.min(aw, ah); }
  else { w = Math.floor(Math.min(aw, ah / aspect)); h = Math.min(Math.floor(w * aspect), ah); }
  const lay = { dpi, slit, orient, papel: o.papel, pageMm: [pw, ph], pagePx, size: [w, h], n };
  if (o.polar) {
    lay.R = w / 2;
    lay.hub = mmToPx(o.hubMm, dpi);
    lay.hole = mmToPx(o.holeMm, dpi);
    lay.K = polarSectors(n, lay.R, slit, o.ref ?? DEFAULTS.ref);
  }
  return lay;
}

export function describeLayout(lay, o) {
  const mm = (px) => pxToMm(px, lay.dpi);
  const { n, slit } = lay;
  const lines = [];
  const warn = [];
  lines.push(`Hoja: ${PAPERS[lay.papel].label} ${lay.orient} (${(lay.pageMm[0] / 10).toFixed(1)} × ${(lay.pageMm[1] / 10).toFixed(1)} cm) a ${lay.dpi} dpi`);
  if (o.polar) {
    const deg = 360 / lay.K;
    lines.push(`Polar · ${n} cuadros · ${lay.K} sectores · ${deg.toFixed(3)}° por cuadro`);
    lines.push(`Diámetro ${mm(lay.size[0]).toFixed(0)} mm · rendija ≈ ${mm(slit).toFixed(2)} mm a ${Math.round((o.ref ?? 0.75) * 100)}% del radio`);
    lines.push(`Una vuelta = ${lay.K / n} ciclos (${(deg * n).toFixed(2)}° por ciclo)`);
  } else {
    lines.push(`${n} cuadros · franja ${slit} px (${mm(slit).toFixed(2)} mm) · periodo ${mm(n * slit).toFixed(2)} mm`);
    lines.push(`Imagen ${mm(lay.size[0]).toFixed(0)} × ${mm(lay.size[1]).toFixed(0)} mm · rejilla: hoja completa`);
    if (mm(n * slit) > 4.6) warn.push('Periodo grande: las barras se notarán. Usa «Sugerir» o una franja más fina.');
  }
  if (n > 8) warn.push(`${n} cuadros: solo 1/${n} de la imagen es visible (se verá oscura). Lo ideal es 4–6.`);
  const bytes = estimateBytes(lay, o);
  if (bytes > 1.2e9) warn.push(`Requiere ~${(bytes / 1e9).toFixed(1)} GB de memoria: puede fallar. Prueba 300 dpi o media carta.`);
  return { lines, warn };
}

export function estimateBytes(lay, o) {
  const ch = o.mode === 'color' ? 3 : 1;
  const [w, h] = lay.size, [PW, PH] = lay.pagePx;
  return lay.n * w * h * ch + PW * PH * (ch + 1) * 1.6;
}

// ------------------------------------------------------------------ lienzos
export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Dibuja `src` rotado (horario) y reflejado, ocupando el rectángulo destino. */
export function drawEdited(ctx, src, e, dx, dy, dw, dh) {
  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.scale(e.fh ? -1 : 1, e.fv ? -1 : 1);
  ctx.rotate(((e.rot || 0) * Math.PI) / 180);
  const [w0, h0] = e.rot % 180 ? [dh, dw] : [dw, dh];
  ctx.drawImage(src, -w0 / 2, -h0 / 2, w0, h0);
  ctx.restore();
}

/**
 * Ajusta un cuadro al tamaño `size` (contener + relleno blanco), aplica rotación/reflejo
 * y el modo de color. Se procesa por franjas para no rebasar el límite de tamaño de canvas.
 * Devuelve un raster {w, h, ch, data} (ch = 1 gris/BN, 3 color).
 */
export function prepareFrame(src, sw, sh, size, e, o) {
  const [W, H] = size;
  const [ew, eh] = editedSize(sw, sh, e.rot || 0);
  const k = Math.min(W / ew, H / eh);
  const dw = ew * k, dh = eh * k, dx = (W - dw) / 2, dy = (H - dh) / 2;
  const ch = o.mode === 'color' ? 3 : 1;
  const out = new Uint8Array(W * H * ch);
  const band = Math.max(1, Math.min(H, Math.floor(4e6 / W)));
  const cv = makeCanvas(W, band);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const thr = o.threshold ?? 128, inv = !!o.invert;
  for (let y0 = 0; y0 < H; y0 += band) {
    const bh = Math.min(band, H - y0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, band);
    ctx.translate(0, -y0);
    drawEdited(ctx, src, e, dx, dy, dw, dh);
    const d = ctx.getImageData(0, 0, W, bh).data;
    const base = y0 * W;
    const npx = W * bh;
    if (ch === 1) {
      for (let i = 0, j = 0; i < npx; i++, j += 4) {
        let v = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114 + 500) / 1000 | 0;
        if (inv) v = 255 - v;
        if (o.mode === 'bw') v = v >= thr ? 255 : 0;
        out[base + i] = v;
      }
    } else {
      for (let i = 0, j = 0; i < npx; i++, j += 4) {
        const p = (base + i) * 3;
        out[p] = inv ? 255 - d[j] : d[j];
        out[p + 1] = inv ? 255 - d[j + 1] : d[j + 1];
        out[p + 2] = inv ? 255 - d[j + 2] : d[j + 2];
      }
    }
  }
  return { w: W, h: H, ch, data: out };
}

// ------------------------------------------------------------------ vistas previas (simulación)
/** Barras: el cuadro i visto a través de la rejilla desplazada i franjas. */
export function simulateBars(frames, slit, vertical) {
  const n = frames.length;
  const { w, h, ch } = frames[0];
  const out = [];
  const col = new Uint8Array(vertical ? w : h);
  for (let x = 0; x < col.length; x++) col[x] = Math.floor(x / slit) % n;
  for (let i = 0; i < n; i++) {
    const src = frames[i].data;
    const r = new Uint8Array(w * h * ch);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((vertical ? col[x] : col[y]) !== i) continue;
        const p = (y * w + x) * ch;
        r[p] = src[p];
        if (ch === 3) { r[p + 1] = src[p + 1]; r[p + 2] = src[p + 2]; }
      }
    }
    out.push({ w, h, ch, data: r });
  }
  return out;
}

/** Polar: el disco girado i sectores muestra el cuadro i. */
export function simulatePolar(frames, K, hub, hole) {
  const n = frames.length;
  const { w, h, ch } = frames[0];
  const cx = (w - 1) / 2, cy = (h - 1) / 2, R = Math.min(w, h) / 2, kf = K / TAU;
  const sec = new Int32Array(w * h), rad = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      let th = Math.atan2(dy, dx); if (th < 0) th += TAU;
      let s = (th * kf) | 0; if (s >= K) s = K - 1;
      sec[y * w + x] = s; rad[y * w + x] = Math.sqrt(dx * dx + dy * dy);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = new Uint8Array(w * h * ch);
    for (let q = 0; q < w * h; q++) {
      const rr = rad[q];
      let src = null;
      if (rr > R) { r[q * ch] = 255; if (ch === 3) { r[q * 3 + 1] = 255; r[q * 3 + 2] = 255; } continue; }
      if (rr < hole) src = frames[0].data;
      else if (rr >= hub && sec[q] % n === i) src = frames[i].data;
      if (!src) continue;
      const p = q * ch;
      r[p] = src[p];
      if (ch === 3) { r[p + 1] = src[p + 1]; r[p + 2] = src[p + 2]; }
    }
    out.push({ w, h, ch, data: r });
  }
  return out;
}

export function rasterToImageData(r) {
  const img = new ImageData(r.w, r.h);
  const d = img.data, s = r.data;
  for (let i = 0, j = 0; i < r.w * r.h; i++, j += 4) {
    if (r.ch === 1) { d[j] = d[j + 1] = d[j + 2] = s[i]; }
    else { d[j] = s[i * 3]; d[j + 1] = s[i * 3 + 1]; d[j + 2] = s[i * 3 + 2]; }
    d[j + 3] = 255;
  }
  return img;
}

// ------------------------------------------------------------------ páginas a resolución completa
/**
 * Página 1: imagen entrelazada centrada en la hoja.
 * Página 2: rejilla a hoja completa (0 = tinta, 255 = rendija).
 */
export function renderPages(frames, o, lay) {
  const n = frames.length;
  const [PW, PH] = lay.pagePx;
  const [w, h] = lay.size;
  const ch = frames[0].ch;
  const ox = Math.floor((PW - w) / 2), oy = Math.floor((PH - h) / 2);
  const p1 = new Uint8Array(PW * PH * ch).fill(255);
  const p2 = new Uint8Array(PW * PH);
  const put = (dst, di, src, si) => {
    if (ch === 1) dst[di] = src[si];
    else { dst[di * 3] = src[si * 3]; dst[di * 3 + 1] = src[si * 3 + 1]; dst[di * 3 + 2] = src[si * 3 + 2]; }
  };
  const setv = (dst, di, v) => {
    if (ch === 1) dst[di] = v; else { dst[di * 3] = v; dst[di * 3 + 1] = v; dst[di * 3 + 2] = v; }
  };

  if (!o.polar) {
    const s = lay.slit, vertical = !o.horizontal;
    // imagen entrelazada
    const colIdx = new Uint8Array(vertical ? w : h);
    for (let i = 0; i < colIdx.length; i++) colIdx[i] = Math.floor(i / s) % n;
    for (let y = 0; y < h; y++) {
      const rowBase = (oy + y) * PW + ox;
      for (let x = 0; x < w; x++) {
        const k = vertical ? colIdx[x] : colIdx[y];
        put(p1, rowBase + x, frames[k].data, y * w + x);
      }
    }
    // rejilla (hoja completa), en fase con la imagen: sobrepuestas sin mover muestran el cuadro 1
    const P = s * n;
    const open = (v) => (((v % P) + P) % P) < s;
    if (vertical) {
      const row = new Uint8Array(PW);
      for (let x = 0; x < PW; x++) row[x] = open(x - ox) ? 255 : 0;
      for (let y = 0; y < PH; y++) p2.set(row, y * PW);
    } else {
      for (let y = 0; y < PH; y++) if (open(y - oy)) p2.fill(255, y * PW, (y + 1) * PW);
    }
    return { p1, p2, ch };
  }

  // --- polar: mismo centro para imagen y rejilla
  const { K, R, hub, hole } = lay;
  const cx = ox + (w - 1) / 2, cy = oy + (h - 1) / 2;
  const kf = K / TAU;
  const lw = Math.max(2, Math.round(Math.min(w, h) / 1500));
  const m = Math.max(6, Math.floor(hub / 3));
  const disc = m + 2 * lw;
  const lwCut = Math.max(1, Math.min(PW, PH) / 3000);
  for (let y = 0; y < PH; y++) {
    const dy = y - cy;
    const inY = y >= oy && y < oy + h;
    for (let x = 0; x < PW; x++) {
      const dx = x - cx;
      const r = Math.sqrt(dx * dx + dy * dy);
      let th = Math.atan2(dy, dx); if (th < 0) th += TAU;
      let sct = (th * kf) | 0; if (sct >= K) sct = K - 1;
      const q = y * PW + x;
      // rejilla
      p2[q] = ((sct % n === 0 && r >= hub) || r < hole || Math.abs(r - R) < lwCut) ? 255 : 0;
      // imagen
      if (!inY || x < ox || x >= ox + w || r > R) continue;
      if (Math.abs(r - R) < lw / 2 + 0.5) { setv(p1, q, 0); continue; }          // contorno
      if (r < disc) {                                                              // cruz de centro
        const cross = (Math.abs(dy) < lw / 2 && Math.abs(dx) <= m) || (Math.abs(dx) < lw / 2 && Math.abs(dy) <= m);
        setv(p1, q, cross ? 0 : 255);
        continue;
      }
      const k = r < hub ? 0 : sct % n;
      put(p1, q, frames[k].data, (y - oy) * w + (x - ox));
    }
  }
  return { p1, p2, ch };
}

// ------------------------------------------------------------------ PDF (sin pérdida)
async function deflate(u8) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([u8]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function isBinary(data) {
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v !== 0 && v !== 255) return false; }
  return true;
}

function packBits(data, w, h) {
  const rb = Math.ceil(w / 8);
  const out = new Uint8Array(rb * h);
  for (let y = 0; y < h; y++) {
    const si = y * w, di = y * rb;
    for (let x = 0; x < w; x++) if (data[si + x] >= 128) out[di + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return out;
}

/** Página → objeto de imagen PDF. B/N puro en 1 bit; gris/color en 8 bits. Todo con Flate. */
export async function encodePage(data, w, h, ch) {
  if (ch === 1 && isBinary(data)) {
    return { w, h, bpc: 1, cs: 'DeviceGray', data: await deflate(packBits(data, w, h)) };
  }
  return { w, h, bpc: 8, cs: ch === 3 ? 'DeviceRGB' : 'DeviceGray', data: await deflate(data) };
}

/** PDF mínimo: cada imagen cubre su página completa. */
export function buildPdf(pages, pageMm, title = 'Animacion de rejilla de barrera') {
  const enc = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); offset += b.length; };
  const [wPt, hPt] = pageMm.map((v) => ((v / 25.4) * 72).toFixed(2));
  const nP = pages.length;
  // 1 catálogo, 2 páginas, 3 info, luego por página: page, contents, image
  const pageId = (i) => 4 + i * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (id, body, stream) => {
    offsets[id] = offset;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${nP} >>`);
  obj(3, `<< /Title (${title.replace(/[()\\]/g, '')}) /Producer (rejilla-animacion web) >>`);
  pages.forEach((im, i) => {
    const pid = pageId(i), cid = pid + 1, iid = pid + 2;
    obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Contents ${cid} 0 R ` +
      `/Resources << /XObject << /Im${i} ${iid} 0 R >> /ProcSet [/PDF /ImageB /ImageC] >> >>`);
    const content = enc.encode(`q ${wPt} 0 0 ${hPt} 0 0 cm /Im${i} Do Q`);
    obj(cid, `<< /Length ${content.length} >>`, content);
    obj(iid, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.cs} ` +
      `/BitsPerComponent ${im.bpc} /Filter /FlateDecode /Length ${im.data.length} >>`, im.data);
  });
  const nObj = 4 + nP * 3;
  const xref = offset;
  let x = `xref\n0 ${nObj}\n0000000000 65535 f \n`;
  for (let id = 1; id < nObj; id++) x += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${nObj} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const total = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) { total.set(c, p); p += c.length; }
  return total;
}

/**
 * Proceso completo a resolución de impresión.
 * sources: [{bitmap, w, h}] en el orden final; o: opciones; lay: computeLayout(...)
 */
export async function generatePdf(sources, o, lay, progress = () => {}) {
  const t0 = performance.now();
  const step = (m) => progress(`[${((performance.now() - t0) / 1000).toFixed(1)} s] ${m}`);
  const edits = { rot: o.rot || 0, fh: o.fh, fv: o.fv };
  const frames = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    frames.push(prepareFrame(s.bitmap, s.w, s.h, lay.size, edits, o));
    if (s.bitmap.close) s.bitmap.close();
    step(`cuadro ${i + 1}/${sources.length} ajustado`);
  }
  const { p1, p2, ch } = renderPages(frames, o, lay);
  frames.length = 0;
  step(o.polar ? 'imagen entrelazada y rejilla polar' : 'imagen entrelazada y rejilla');
  const [PW, PH] = lay.pagePx;
  const e1 = await encodePage(p1, PW, PH, ch);
  const e2 = await encodePage(p2, PW, PH, 1);
  step(`páginas comprimidas (${e1.bpc === 1 ? '1 bit sin pérdida' : e1.bpc + ' bits sin pérdida'})`);
  const pdf = buildPdf([e1, e2], lay.pageMm);
  step(`PDF listo (${(pdf.length / 1024).toFixed(0)} KB)`);
  return pdf;
}

// ------------------------------------------------------------------ demo
export function drawDemoFrame(ctx, i, n, w, h) {
  const t = i / n;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
  const r = Math.min(w, h) * 0.12, cx = w * 0.3;
  const cy = h * 0.75 - Math.abs(Math.sin(t * Math.PI)) * h * 0.45;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  const R = Math.min(w, h) * 0.28, ox = w * 0.7, oy = h * 0.5;
  ctx.lineWidth = R * 0.18;
  ctx.beginPath(); ctx.arc(ox, oy, R - ctx.lineWidth / 2, 0, TAU); ctx.stroke();
  ctx.lineWidth = R * 0.15;
  for (let k = 0; k < 4; k++) {
    const a = t * (Math.PI / 2) + (k * Math.PI) / 2;
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + R * Math.cos(a), oy + R * Math.sin(a)); ctx.stroke();
  }
}
