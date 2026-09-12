/**
 * MANEVRA ÇIKARIMI — rota geometrisinden, uydurma değil.
 *
 * Sürücüye gösterilen "300 m sonra sağa" cümlesinin her parçası ölçülür:
 * mesafe rota boyunca gerçek metredir, yön birikimli baş açısı değişimidir,
 * dönülecek yolun adı karodaki `transportation_name` katmanından okunur.
 * Bilinmeyen alan UNKNOWN kalır — sahte ad üretilmez.
 */
const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ACI = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
const NORM = (t) => { while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI; return t; };

export function manevra(world, route, opts = {}) {
  const { line, ni } = route;
  const ESIK = (opts.esikDerece ?? 32) * Math.PI / 180;
  const MENZIL = opts.menzil ?? 1200;

  let s = 0, biriken = 0, i = ni;
  let baz = ACI(line[Math.max(0, ni - 1)], line[Math.min(line.length - 1, ni + 1)]);
  for (; i < line.length - 1; i++) {
    if (i > ni) s += D(line[i], line[i - 1]);
    if (s > MENZIL) break;
    const h = ACI(line[i], line[i + 1]);
    const d = NORM(h - baz);
    biriken = Math.abs(d) > 0.06 ? biriken + d : biriken * 0.72;   // gürültü sönümü
    baz = h;
    if (Math.abs(biriken) >= ESIK && s > 40) {
      return {
        mesafe: Math.round(s / 10) * 10,
        yon: biriken > 0 ? 'sag' : 'sol',
        derece: Math.round(Math.abs(biriken) * 180 / Math.PI),
        nokta: line[i],
        ad: adBul(world, line[i]) || 'UNKNOWN',
      };
    }
  }
  return null;
}

/** Manevra noktasına en yakın adlandırılmış yol — 90 m içinde yoksa UNKNOWN. */
function adBul(world, p) {
  let best = null, bd = 90;
  for (const n of world.names) {
    if (!n.p.name || n.p.subclass === 'junction') continue;
    for (const g of n.g) for (const q of g) {
      const d = D(q, p);
      if (d < bd) { bd = d; best = n.p.name; }
    }
  }
  return best;
}

/** Ego'nun bulunduğu yolun adı. */
export function suankiYol(world, route) {
  return adBul(world, route.line[route.ni]) || 'UNKNOWN';
}

/** Kalan rota metresi + varsayılan seyir hızından türetilmiş ETA. */
export function ozet(route, kmh = 34) {
  let m = 0;
  for (let i = route.ni + 1; i < route.line.length; i++)
    m += D(route.line[i], route.line[i - 1]);
  const dk = Math.max(1, Math.round(m / 1000 / kmh * 60));
  return { metre: Math.round(m), dakika: dk, kmh };
}
