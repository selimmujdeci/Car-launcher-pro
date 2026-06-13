/**
 * ChameleonScaler — "Bukalemun" ekran uyumu.
 *
 * Tema içeriğini (NewHomeLayout) ölçtüğü ALANA göre orantılı ölçekler:
 * her ekran (head unit · telefon · tablet · ne olursa) kendi boyutuna adapte olur.
 *
 * Neden `transform: scale` (zoom DEĞİL):
 *   - `zoom` bu WebView'da TUTARSIZ (bir sürüm küçültüp boşluk bırakıyor, diğeri
 *     büyütüp taşırıyordu). `transform` spec'te kesin tanımlı, eski Chrome 64-78
 *     dahil her WebView'da AYNI davranır.
 *   - Mali-400 dostu: statik (animasyonsuz) tek compositor katmanı.
 *   - Harita (MiniMap/WebGL): transform'lu ata altında canvas TAM çözünürlükte
 *     render olur, görüntüde küçülür → KESKİN kalır; dokunma tarayıcı tarafından
 *     transform'a göre doğru eşlenir.
 *
 * Neden YALNIZ tema içeriğini sarar (tüm app'i değil):
 *   - Güvenlik overlay'leri (geri vites kamerası z-100000, HUD, modaller) MainLayout
 *     KARDEŞLERİ → ölçek dışında → viewport'u tam kaplamaya devam eder.
 *   - Tam ekran navigasyon haritası ayrı overlay → native çözünürlük korunur.
 *
 * Ölçek = min(alanW/BASE_W, alanH/BASE_H), [MIN, MAX] aralığında.
 *   - BASE = temaların taşmadan render olduğu referans (head unit ~1024×600).
 *   - Kısa kenar referansa göre ölçeklenir → İÇERİK her zaman ≥ BASE mantıksal
 *     alana yerleşir (dikey taşma biter), sonra alana sığacak şekilde ölçeklenir.
 *   - İki boyut da 100/scale'e açıldığından LETTERBOX yok — alanı tam doldurur.
 *   - ≈1.0 (head unit) → transform UYGULANMAZ (no-op) → mevcut yol birebir korunur.
 *
 * Zero-Leak: tek resize/orientation dinleyicisi, cleanup'lı.
 */
import { useState, useRef, useLayoutEffect, useCallback, type ReactNode } from 'react';

const BASE_W = 1024;   // referans genişlik (CSS px) — temaların tasarım tabanı
const BASE_H = 600;    // referans yükseklik — temalar bunun altında dikey taşar
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.6;
const NEAR_ONE_LO = 0.99;
const NEAR_ONE_HI = 1.01;

/**
 * Saf ölçek matematiği — regresyon testi için dışa açık (UI'dan bağımsız).
 * min(w/BASE_W, h/BASE_H) → kısa kenar referansa göre; [MIN, MAX]'e kısıtlı.
 * Head unit (~1024×600) → ~1.0. ASLA letterbox: iki boyut da 100/scale'e açılır.
 */
export function computeChameleonScale(w: number, h: number): number {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  const raw = Math.min(w / BASE_W, h / BASE_H);
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
}

export function ChameleonScaler({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    setScale(Number(computeChameleonScale(w, h).toFixed(4)));
  }, []);

  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('orientationchange', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [measure]);

  const nearOne = scale > NEAR_ONE_LO && scale < NEAR_ONE_HI;
  const inv = `${(100 / scale).toFixed(3)}%`;

  return (
    <div ref={ref} className="relative w-full h-full overflow-hidden">
      {nearOne ? (
        // Head unit / referans ekran: transform uygulanmaz (sıfır risk, no-op).
        children
      ) : (
        <div
          style={{
            position:        'absolute',
            top:             0,
            left:            0,
            width:           inv,
            height:          inv,
            transform:       `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
