// Trombinoscope HelloAsso - export PDF, sans bibliothèque externe.
// Chaque page A4 est dessinée dans un <canvas> (même mise en page que l'impression : 5 x 4 adhérents),
// puis enregistrée en JPEG et assemblée dans un fichier PDF minimal.
(function (root) {
  'use strict';

  const MM = 200 / 25.4;               // résolution : 200 points par pouce
  const A4 = { w: 210, h: 297 };       // en mm
  const MARGIN = 8, TITLE_H = 8, TITLE_GAP = 3, GAP = 3, COLS = 5, ROWS = 4, PER_PAGE = COLS * ROWS;
  const PAD = 1.5, PHOTO_H = 44;
  const FONT = 'system-ui, "Segoe UI", Roboto, Arial, sans-serif';
  const pt = n => n * 25.4 / 72;       // taille de police : points -> mm

  // texte tenant dans la largeur : police réduite jusqu'à 70 %, puis coupé avec « … »
  function fitText(ctx, text, maxW, sizeMm, weight) {
    let size = sizeMm;
    const set = () => { ctx.font = `${weight} ${size * MM}px ${FONT}`; };
    set();
    while (ctx.measureText(text).width > maxW * MM && size > sizeMm * 0.7) { size *= 0.95; set(); }
    if (ctx.measureText(text).width <= maxW * MM) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW * MM) t = t.slice(0, -1);
    return t + '…';
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // photo recadrée pour remplir la case (comme object-fit: cover)
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / s, sh = h / s;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  }

  function drawPage(members, images, { title, showDate, fmtDate }) {
    const c = document.createElement('canvas');
    c.width = Math.round(A4.w * MM); c.height = Math.round(A4.h * MM);
    const ctx = c.getContext('2d');
    const X = mm => mm * MM;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    const innerW = A4.w - 2 * MARGIN, innerH = A4.h - 2 * MARGIN;
    ctx.fillText(fitText(ctx, title, innerW, pt(14), 'bold'), X(A4.w / 2), X(MARGIN + TITLE_H / 2));
    const top = MARGIN + TITLE_H + TITLE_GAP;
    const cw = (innerW - GAP * (COLS - 1)) / COLS;
    const ch = (innerH - TITLE_H - TITLE_GAP - GAP * (ROWS - 1)) / ROWS;
    members.forEach((m, i) => {
      const x = MARGIN + (i % COLS) * (cw + GAP), y = top + Math.floor(i / COLS) * (ch + GAP);
      ctx.lineWidth = Math.max(1, 0.25 * MM); ctx.strokeStyle = '#999';
      roundRect(ctx, X(x), X(y), X(cw), X(ch), X(2)); ctx.stroke();
      const px = x + PAD, py = y + PAD, pw = cw - 2 * PAD;
      ctx.save(); roundRect(ctx, X(px), X(py), X(pw), X(PHOTO_H), X(1)); ctx.clip();
      const img = images.get(m.key);
      if (img) drawCover(ctx, img, X(px), X(py), X(pw), X(PHOTO_H));
      else {
        ctx.fillStyle = '#e3e6ec'; ctx.fillRect(X(px), X(py), X(pw), X(PHOTO_H));
        ctx.fillStyle = '#6b7280'; ctx.font = `${X(10)}px ${FONT}`; ctx.fillText('?', X(px + pw / 2), X(py + PHOTO_H / 2));
      }
      ctx.restore();
      const cx = X(x + cw / 2);
      let ty = py + PHOTO_H + 1.5 + pt(9.5) * 0.6;
      ctx.fillStyle = '#000';
      ctx.fillText(fitText(ctx, (m.lastName || '').toUpperCase(), pw, pt(9.5), 'bold'), cx, X(ty));
      ty += pt(9.5) * 1.15;
      ctx.fillText(fitText(ctx, m.firstName || '', pw, pt(9.5), 'normal'), cx, X(ty));
      if (showDate && m.date) {
        ctx.fillStyle = '#444';
        ty += pt(9.5) * 0.6 + pt(7.5) * 0.7;
        ctx.fillText(fitText(ctx, 'Adhérent depuis le', pw, pt(7.5), 'normal'), cx, X(ty));
        ty += pt(7.5) * 1.15;
        ctx.fillText(fitText(ctx, fmtDate(m.date), pw, pt(7.5), 'normal'), cx, X(ty));
      }
    });
    return c;
  }

  const canvasJpeg = c => new Promise((resolve, reject) => c.toBlob(b => b ? b.arrayBuffer().then(a => resolve({ bytes: new Uint8Array(a), w: c.width, h: c.height }), reject) : reject(new Error('Image de page impossible')), 'image/jpeg', 0.88));

  // assemble un PDF : une image JPEG pleine page par page A4
  function buildPdf(pages) {
    const enc = new TextEncoder(), parts = [], offsets = [];
    let size = 0;
    const push = p => { const b = typeof p === 'string' ? enc.encode(p) : p; parts.push(b); size += b.length; };
    const W = 595.28, H = 841.89;      // A4 en points PDF
    const n = pages.length;
    // objets : 1 catalogue, 2 liste des pages, puis pour chaque page : page, contenu, image
    const pageId = i => 3 + i * 3;
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const obj = (id, body) => { offsets[id] = size; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`));
    pages.forEach((p, i) => {
      const id = pageId(i);
      obj(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
      const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
      obj(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
      obj(id + 2, () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
        push(p.bytes); push('\nendstream');
      });
    });
    const count = 3 + n * 3, xref = size;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let id = 1; id < count; id++) table += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
    push(table + `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(size);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // members : adhérents dans l'ordre ; loadImage(m) -> promesse d'un HTMLImageElement chargé, ou null
  async function exportPdf(members, { title, showDate, fmtDate, loadImage, onProgress }) {
    const images = new Map();
    let done = 0;
    const queue = members.filter(m => m.photo);
    const worker = async () => {
      for (let m; (m = queue.shift());) {
        try { const img = await loadImage(m); if (img) images.set(m.key, img); } catch {}
        onProgress && onProgress(++done, members.filter(x => x.photo).length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const pages = [];
    const total = Math.ceil(members.length / PER_PAGE);
    for (let i = 0; i < members.length; i += PER_PAGE) {
      const t = total > 1 ? `${title} — page ${i / PER_PAGE + 1}/${total}` : title;
      pages.push(await canvasJpeg(drawPage(members.slice(i, i + PER_PAGE), images, { title: t, showDate, fmtDate })));
    }
    return buildPdf(pages);
  }

  root.TrombiPdf = { exportPdf, buildPdf, PER_PAGE };
})(typeof self !== 'undefined' ? self : this);
