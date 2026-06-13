/**
 * viewportScale — "Bukalemun" ekran uyumu.
 *
 * Sorun: temalar ~1024×600 (head unit) referansıyla tasarlandı, fixed-px içerir.
 * Telefon yüksek DPR'li → CSS px'te ÇOK GENİŞ ama KISA viewport (örn. 986×444):
 * dikey içerik taşıyordu. Çok farklı en-boy oranları nedeniyle "sabit tuvali
 * ortala+ölçekle" letterbox yaratırdı; bunun yerine `zoom` kullanılır.
 *
 * Neden CSS `zoom` (transform DEĞİL):
 *   - zoom layout'a KATILIR → grid/flex yeni efektif alana göre yeniden akar,
 *     ekranın tamamı dolar (letterbox yok).
 *   - Metin KESKİN kalır (transform raster blur yapmaz).
 *   - Harita (MapLibre/WebGL): zoom-farkındalıklı clientWidth → daha yüksek
 *     efektif çözünürlükte render + downscale → blur/dokunma kayması YOK
 *     (transform: scale bunu bozardı). Mali-400 dostu (tek compositor işlemi).
 *   - Android WebView (eski Chrome 64-78 dahil) `zoom`'u destekler.
 *
 * Ölçek = min(w/BASE_W, h/BASE_H), [MIN_SCALE, 1] aralığına kısıtlı.
 *   - Head unit (1024×600): ≈1.0 → zoom UYGULANMAZ (no-op) → SIFIR risk, var olan
 *     compat-mode/clamp yolu birebir korunur.
 *   - Telefon (986×444): ≈0.74 → kısa kenar referansa ulaşana dek küçültülür,
 *     efektif yükseklik 600'e çıkar → taşma biter, ekran dolar.
 *   - Asla 1'in üstüne çıkmaz (büyütme yok → büyük ekranda taşma riski yok).
 *
 * Zero-Leak: tek resize/orientationchange dinleyicisi, rAF ile coalesce, idempotent.
 */

const BASE_W = 1024;   // head unit referans genişliği (CSS px)
const BASE_H = 600;    // head unit referans yüksekliği (CSS px)
const MIN_SCALE = 0.70;
const APPLY_THRESHOLD = 0.985;  // bunun üstünde zoom uygulanmaz (head unit/masaüstü no-op)

let _rafId = 0;
let _onResize: (() => void) | null = null;

function computeScale(): number {
  if (typeof window === 'undefined') return 1;
  const w = window.innerWidth  || 0;
  const h = window.innerHeight || 0;
  if (w === 0 || h === 0) return 1;
  const s = Math.min(w / BASE_W, h / BASE_H);
  return Math.max(MIN_SCALE, Math.min(1, s));
}

function apply(): void {
  if (typeof document === 'undefined') return;
  const root = document.getElementById('root');
  if (!root) return;
  const scale = computeScale();
  // Gelecekteki opt-in kullanımlar için ham değeri de yayınla.
  document.documentElement.style.setProperty('--ui-scale', String(scale));
  if (scale >= APPLY_THRESHOLD) {
    // Head unit / masaüstü: dokunma — harita/WebGL ve compat-mode etkilenmesin.
    root.style.removeProperty('zoom');
  } else {
    // Telefon / kısa ekran: orantılı küçült (layout'a katılan zoom).
    root.style.setProperty('zoom', String(scale));
  }
}

/**
 * Boot'ta bir kez çağrılır (main.tsx, React öncesi). Sonraki resize/orientation
 * değişikliklerini rAF ile coalesce ederek yeniden uygular. İdempotent.
 */
export function applyViewportScale(): void {
  if (typeof window === 'undefined') return;
  apply();
  if (_onResize) return;  // dinleyici zaten kurulu
  _onResize = () => {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(apply);
  };
  window.addEventListener('resize', _onResize, { passive: true });
  window.addEventListener('orientationchange', _onResize, { passive: true });
}

/** Test/teardown için — dinleyiciyi kaldırır, zoom'u sıfırlar. */
export function stopViewportScale(): void {
  if (_onResize) {
    window.removeEventListener('resize', _onResize);
    window.removeEventListener('orientationchange', _onResize);
    _onResize = null;
  }
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
  const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
  root?.style.removeProperty('zoom');
}
