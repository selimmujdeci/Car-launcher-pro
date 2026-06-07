/**
 * Zayıf GPU tespiti — TEK kaynak (DRY).
 *
 * WebGL `UNMASKED_RENDERER` dizesini okur; Mali-400 sınıfı (Utgard: 300/400/450),
 * yazılım render (SwiftShader/llvmpipe) veya VideoCore (RPi sınıfı) ise true döner.
 * Bu GPU'larda backdrop-filter / büyük filter:blur donanım hızlandırması YOKTUR →
 * software compositing → kare başına stall.
 *
 * Hem `AdaptiveRuntimeManager` (--rt-blur / fps / polling tavanı) hem
 * `headUnitCompat` (data-compat-mode) bu fonksiyonu kullanır → iki sistem "zayıf
 * GPU" kararında YAPISAL olarak anlaşır (eskiden iki ayrı kopya regex vardı,
 * uyumsuzluk riski taşıyordu).
 *
 * GPU BİLİNEMİYORSA (WebGL yok / renderer maskeli / headless test) **false** döner:
 * yanlış pozitif yok; cihaz diğer head-unit sinyalleriyle (çekirdek/ekran) zaten
 * yakalanır. Sonuç değişmez (donanım sabit) ama ucuz olduğundan cache'lenir.
 */

let _cached: boolean | null = null;
let _rendererCached: string | null = null;   // ham UNMASKED_RENDERER (teşhis için)

export function hasWeakGpu(): boolean {
  if (_cached !== null) return _cached;
  _cached = _probe();
  return _cached;
}

/**
 * Ham WebGL `UNMASKED_RENDERER` dizesini döner (teşhis amaçlı; DevInspector kullanır).
 *  - '' → WebGL var ama renderer MASKELİ (extension yok / boş). weakGpu=false ile birlikte
 *    görülürse "low-end yanlış sınıflandı mı?" sorusunu doğrudan yanıtlar.
 *  - '(WebGL yok)' → WebGL bağlamı oluşturulamadı.
 * Sonuç donanım sabiti → cache'lenir. Hot-path değil; yalnız panel açıldığında okunur.
 */
export function getGpuRenderer(): string {
  if (_rendererCached !== null) return _rendererCached;
  _rendererCached = _probeRenderer();
  return _rendererCached;
}

/** WebGL renderer dizesini ham (orijinal harf) okur — yoksa boş/işaret döner. */
function _probeRenderer(): string {
  if (typeof document === 'undefined') return '';
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ||
                canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return '(WebGL yok)';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (!dbg) return '';   // renderer maskeli (extension yok)
    return String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '').trim();
  } catch {
    return '';
  }
}

function _probe(): boolean {
  const renderer = getGpuRenderer().toLowerCase();
  if (!renderer || renderer === '(webgl yok)') return false; // bilinmiyor → downgrade etme
  return /mali-?[34]\d\d|swiftshader|llvmpipe|software|videocore/.test(renderer);
}
