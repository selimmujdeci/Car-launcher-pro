/* Ufuk kısıtlı çözüm: ufuk y=64 · ego y=352 · ego'da 5.6 px/m (11 m yol = 62 px) */
const D2R = Math.PI / 180;
const UFUK = 64, EGO_Y = 352, PXM = 5.6;
for (const d of [40, 70, 100, 140]) {
  let best = null;
  for (let P = 40; P <= 70; P += 0.25) {
    const sP = Math.sin(P * D2R), cP = Math.cos(P * D2R), tP = Math.tan(P * D2R);
    for (let h = 4; h <= 120; h += 0.25) {
      const yc = d * cP - h * sP, zc = d * sP + h * cP;
      if (zc < 5) continue;
      const F = PXM * zc;                       // px/m kısıtı
      const CY = UFUK + F / tP;                 // ufuk kısıtı
      const y0 = CY - F * yc / zc;              // ego kısıtı
      const err = Math.abs(y0 - EGO_Y);
      if (!best || err < best.err) best = { P, h, F: +F.toFixed(1), CY: +CY.toFixed(1), y0: +y0.toFixed(1), err };
    }
  }
  // 250 m ileri nerede?
  const { P, h, F, CY } = best;
  const sP = Math.sin(P * D2R), cP = Math.cos(P * D2R);
  const f = (Y) => { const yc = (Y + d) * cP - h * sP, zc = (Y + d) * sP + h * cP; return CY - F * yc / zc; };
  console.log('d', String(d).padStart(3), '→ pitch', P.toFixed(2), '· h', h, 'm · F', F, '· CY', CY,
    '| ego y', best.y0, '| 100m y', f(100).toFixed(0), '| 250m y', f(250).toFixed(0),
    '| 600m y', f(600).toFixed(0), '| hata', best.err.toFixed(2));
}
