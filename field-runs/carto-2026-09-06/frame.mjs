/**
 * KARE BESTECİSİ — harita SVG'si + CarOS chrome.
 *
 * Chrome disiplini: kenar bir kez çizilir (tek ray), panel yalnız üç yerde
 * (manevra · ETA · hız), amber YALNIZ chrome ve aktif durumda — yolda asla.
 * Manevra kartı ekrandaki en koyu yüzeydir: rotadan sonra gözün gittiği yer.
 */
const W = 904, H = 406;
const AMBER = '#E0A23C';

export const TEMA = {
  day: {
    sky: ['#cfdcea', '#e4ebf2'], bg: '#e4ebf2',
    panel: '#ffffff', panelKenar: 'rgba(12,18,28,0.14)',
    ink: '#0d1219', dim: 'rgba(13,18,25,0.58)',
    kart: '#12161e', kartInk: '#f4f1ea', kartDim: 'rgba(244,241,234,0.62)',
    golge: '0 2px 10px rgba(12,18,28,0.13), 0 8px 28px rgba(12,18,28,0.10)',
  },
  night: {
    sky: ['#0d1420', '#1d2738'], bg: '#1d2738',
    panel: '#232a38', panelKenar: 'rgba(255,240,210,0.17)',
    ink: '#f0ebe0', dim: 'rgba(240,235,224,0.64)',
    kart: '#0c1017', kartInk: '#f4f1ea', kartDim: 'rgba(244,241,234,0.62)',
    golge: '0 2px 12px rgba(0,0,0,0.45), 0 10px 30px rgba(0,0,0,0.35)',
  },
};

export const defs = (k) => `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${TEMA[k].sky[0]}"/><stop offset="1" stop-color="${TEMA[k].sky[1]}"/></linearGradient>
<linearGradient id="rot" x1="0" y1="1" x2="0" y2="0">
<stop offset="0" stop-color="#006CFF"/><stop offset=".55" stop-color="#0057D9"/><stop offset="1" stop-color="#00A6FF"/></linearGradient>
<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${TEMA[k].bg}" stop-opacity=".55"/><stop offset="1" stop-color="${TEMA[k].bg}" stop-opacity="0"/></linearGradient>
</defs>`;

/* ── ego işareti: gerçek kamera konumundan ─────────────────────────────────── */
export function ego(cam) {
  const p = cam.prj(0, 0, 0);
  if (!p) return '';
  const x = p[0].toFixed(1), y = p[1].toFixed(1);
  return `<g transform="translate(${x},${y})">
<ellipse cx="0" cy="7" rx="27" ry="9" fill="#0057D9" opacity="0.13"/>
<circle r="17" fill="#ffffff" opacity="0.94"/>
<circle r="17" fill="none" stroke="#0057D9" stroke-width="2.4"/>
<path d="M0,-9.5 L7.6,8.4 L0,4.2 L-7.6,8.4 Z" fill="#0057D9"/></g>`;
}

/* ── ikonlar (stroke, 24 kutu) ─────────────────────────────────────────────── */
const IK = {
  sol: 'M15 5 L7 13 L15 21 M7 13 L21 13',
  sag: 'M9 5 L17 13 L9 21 M17 13 L3 13',
  duz: 'M12 21 L12 5 M5 12 L12 5 L19 12',
  merkez: 'M12 2 L12 5 M12 19 L12 22 M2 12 L5 12 M19 12 L22 12 M12 7 A5 5 0 1 0 12 17 A5 5 0 1 0 12 7',
  arti: 'M12 5 L12 19 M5 12 L19 12',
  eksi: 'M5 12 L19 12',
  kat: 'M12 3 L21 8 L12 13 L3 8 Z M3 13 L12 18 L21 13 M3 17 L12 22 L21 17',
  ses: 'M4 9 L8 9 L13 5 L13 19 L8 15 L4 15 Z M16.5 9 A4.5 4.5 0 0 1 16.5 15',
  ara: 'M11 4 A7 7 0 1 0 11 18 A7 7 0 1 0 11 4 M16 16 L21 21',
  pin: 'M12 22 C12 22 19 14.5 19 9.5 A7 7 0 0 0 5 9.5 C5 14.5 12 22 12 22 Z M12 12 A2.5 2.5 0 1 0 12 7 A2.5 2.5 0 1 0 12 12',
  ev: 'M3 11 L12 3 L21 11 M6 9.5 L6 21 L18 21 L18 9.5',
  is: 'M3 8 L21 8 L21 20 L3 20 Z M9 8 L9 5 L15 5 L15 8',
};
export const ikon = (k, renk, sw = 2.1, boy = 21) =>
  `<svg width="${boy}" height="${boy}" viewBox="0 0 24 24" fill="none" stroke="${renk}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${IK[k]}"/></svg>`;

/* ── manevra kartı ─────────────────────────────────────────────────────────── */
export function manevraKarti(t, m, suanki) {
  if (!m) return '';
  const ok = m.yon === 'sag' ? 'sag' : m.yon === 'sol' ? 'sol' : 'duz';
  const buyuk = m.mesafe >= 1000 ? (m.mesafe / 1000).toFixed(1).replace('.', ',') : String(m.mesafe);
  const birim = m.mesafe >= 1000 ? 'km' : 'm';
  return `
<div style="position:absolute;left:16px;top:14px;width:290px;box-sizing:border-box;background:${t.kart};
     border-radius:16px;box-shadow:${t.golge};overflow:hidden;">
  <div style="display:flex;align-items:center;gap:14px;padding:14px 16px 12px;">
    <span style="width:50px;height:50px;border-radius:14px;background:${AMBER};flex:0 0 auto;
          display:flex;align-items:center;justify-content:center;">${ikon(ok, '#12161e', 2.6, 28)}</span>
    <div style="min-width:0;">
      <div style="line-height:1;color:${t.kartInk};letter-spacing:-0.6px;">
        <span style="font-size:31px;font-weight:700;">${buyuk}</span><span
          style="font-size:15px;font-weight:600;color:${t.kartDim};margin-left:4px;">${birim}</span></div>
      <div style="font-size:14px;font-weight:600;line-height:1.25;margin-top:6px;color:${t.kartInk};
           white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.ad}</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:7px;padding:8px 16px;
       background:rgba(255,255,255,0.055);border-top:1px solid rgba(255,255,255,0.08);">
    <span style="width:5px;height:5px;border-radius:50%;background:${AMBER};flex:0 0 auto;"></span>
    <span style="font-size:11px;font-weight:600;letter-spacing:0.35px;color:${t.kartDim};
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${suanki} üzerindesiniz</span>
  </div>
</div>`;
}

/* ── şerit rehberi: geçersiz şerit SÖNER ama SİLİNMEZ ──────────────────────── */
export function seritler(t, dizi) {
  const bir = (s) => `<span style="width:38px;height:44px;border-radius:9px;display:flex;
      align-items:center;justify-content:center;
      background:${s.gecerli ? 'rgba(224,162,60,0.15)' : 'transparent'};
      border:1px solid ${s.gecerli ? 'rgba(224,162,60,0.55)' : t.panelKenar};">
      ${ikon(s.ok, s.gecerli ? AMBER : t.dim, s.gecerli ? 2.5 : 1.8, 22)}</span>`;
  return `
<div style="position:absolute;left:322px;top:14px;display:flex;gap:6px;padding:8px;
     border-radius:14px;background:${t.panel};border:1px solid ${t.panelKenar};
     box-shadow:${t.golge};">${dizi.map(bir).join('')}</div>`;
}

/* ── tek ray: kenar BİR kez ────────────────────────────────────────────────── */
export function ray(t, tuslar) {
  const dg = tuslar.map((k, i) => `
    <span style="width:52px;height:52px;display:flex;align-items:center;justify-content:center;
      ${i ? 'border-top:1px solid ' + t.panelKenar + ';' : ''}">
      ${ikon(k.ik, k.aktif ? AMBER : t.dim, 2.1, 21)}</span>`).join('');
  return `
<div style="position:absolute;right:16px;top:14px;width:54px;box-sizing:border-box;border-radius:16px;
     background:${t.panel};border:1px solid ${t.panelKenar};box-shadow:${t.golge};
     overflow:hidden;">${dg}</div>`;
}

/* ── ETA şeridi ────────────────────────────────────────────────────────────── */
export function eta(t, o, varis) {
  const km = (o.metre / 1000).toFixed(1).replace('.', ',');
  return `
<div style="position:absolute;left:16px;bottom:14px;width:290px;box-sizing:border-box;
     display:flex;align-items:center;gap:14px;padding:11px 16px;border-radius:16px;
     background:${t.panel};border:1px solid ${t.panelKenar};box-shadow:${t.golge};">
  <div style="display:flex;flex-direction:column;gap:3px;">
    <span style="font-size:9px;font-weight:600;letter-spacing:1.1px;color:${t.dim};">VARIŞ</span>
    <span style="font-size:23px;font-weight:700;line-height:1;color:${t.ink};letter-spacing:-0.3px;">${varis}</span>
  </div>
  <span style="width:1px;height:32px;background:${t.panelKenar};"></span>
  <div style="display:flex;flex-direction:column;gap:4px;">
    <span style="font-size:14px;font-weight:600;line-height:1;color:${t.ink};">${o.dakika} dk</span>
    <span style="font-size:12px;font-weight:500;line-height:1;color:${t.dim};">${km} km</span>
  </div>
</div>`;
}

/* ── hız + hız limiti ──────────────────────────────────────────────────────── */
export function hiz(t, kmh, limit) {
  const lim = limit == null ? '' : `
  <span style="width:52px;height:52px;box-sizing:border-box;border-radius:50%;background:#ffffff;
        border:4px solid #C8322B;display:flex;align-items:center;justify-content:center;
        box-shadow:${t.golge};">
    <span style="font-size:20px;font-weight:700;color:#101418;">${limit}</span></span>`;
  return `
<div style="position:absolute;right:16px;bottom:14px;display:flex;align-items:center;gap:10px;">
  ${lim}
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
       width:78px;height:58px;box-sizing:border-box;border-radius:16px;background:${t.panel};
       border:1px solid ${t.panelKenar};box-shadow:${t.golge};">
    <span style="font-size:26px;font-weight:700;line-height:1;color:${t.ink};letter-spacing:-0.5px;">${kmh}</span>
    <span style="font-size:9px;font-weight:600;letter-spacing:0.9px;color:${t.dim};margin-top:3px;">KM/S</span>
  </div>
</div>`;
}

/* ── keşif modu: sol hedef kartları (rota yokken) ──────────────────────────── */
export function hedefKartlari(t, liste) {
  const kart = (h) => `
  <div style="display:flex;align-items:center;gap:12px;padding:10px 13px;border-radius:14px;
       background:${t.panel};border:1px solid ${t.panelKenar};box-shadow:${t.golge};width:246px;
       box-sizing:border-box;">
    <span style="width:36px;height:36px;border-radius:11px;flex:0 0 auto;display:flex;
          align-items:center;justify-content:center;background:${h.vurgu ? AMBER : 'transparent'};
          border:1px solid ${h.vurgu ? 'transparent' : t.panelKenar};">
      ${ikon(h.ik, h.vurgu ? '#12161e' : t.dim, 2.05, 19)}</span>
    <div style="min-width:0;">
      <div style="font-size:13.5px;font-weight:600;line-height:1.2;color:${t.ink};
           white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${h.ad}</div>
      <div style="font-size:11px;font-weight:500;line-height:1.2;margin-top:3px;color:${t.dim};
           white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${h.alt}</div>
    </div>
  </div>`;
  return `
<div style="position:absolute;left:16px;top:14px;display:flex;flex-direction:column;gap:8px;">
  <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;border-radius:14px;
       background:${t.panel};border:1px solid ${t.panelKenar};box-shadow:${t.golge};width:246px;
       box-sizing:border-box;">
    ${ikon('ara', t.dim, 2.05, 19)}
    <span style="font-size:13.5px;font-weight:500;color:${t.dim};">Nereye gidiyorsunuz?</span>
  </div>
  ${liste.map(kart).join('')}
</div>`;
}

/* ── konum şeridi (keşifte ETA yerine) ─────────────────────────────────────── */
export function konumSeridi(t, yol, ilce) {
  return `
<div style="position:absolute;left:50%;transform:translateX(-50%);bottom:14px;display:flex;
     align-items:center;gap:10px;padding:9px 16px;border-radius:14px;background:${t.panel};
     border:1px solid ${t.panelKenar};box-shadow:${t.golge};">
  ${ikon('pin', AMBER, 2.05, 18)}
  <span style="font-size:13.5px;font-weight:600;color:${t.ink};">${yol}</span>
  <span style="width:1px;height:16px;background:${t.panelKenar};"></span>
  <span style="font-size:12px;font-weight:500;color:${t.dim};">${ilce}</span>
</div>`;
}

/* ── kare gövdesi ────────────────────────────────────────── */
export function govde({ k, svg, chrome, w = W, h = H, radius = 0 }) {
  const t = TEMA[k];
  return `<div style="position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${t.bg};
     border-radius:${radius}px;font-family:Archivo,'Helvetica Neue',Arial,sans-serif;
     font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;">
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0;display:block;">
${defs(k)}
${svg}
  </svg>
${chrome}
</div>`;
}

const BAS = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap">
<body style="margin:0;background:#0b0d10;">`;

export const kare = (o) => BAS + govde(o) + '</body>';

/** Tasarım tuvali artboard'u — aynı gövde, .dc.html sarmalayıcısıyla. */
export function artboard(icerik, w, h) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap">
  <style>
    body { margin: 0; font-family: Archivo, 'Helvetica Neue', Arial, sans-serif;
           font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
  </style>
</helmet>
${icerik}
</x-dc>

<script data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>`;
}

export { W, H, AMBER };
