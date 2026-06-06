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

export function hasWeakGpu(): boolean {
  if (_cached !== null) return _cached;
  _cached = _probe();
  return _cached;
}

function _probe(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ||
                canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return false; // WebGL bilinmiyor → downgrade etme (test/headless güvenliği)
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (!dbg) return false;
    const renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '').toLowerCase();
    return /mali-?[34]\d\d|swiftshader|llvmpipe|software|videocore/.test(renderer);
  } catch {
    return false;
  }
}
