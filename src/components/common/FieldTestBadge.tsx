/**
 * FieldTestBadge — sürüş sırasındaki PASİF saha testi göstergesi (görev §14).
 *
 * ── SÖZLEŞME (pazarlıksız) ─────────────────────────────────────────────
 *  · Oturum AKTİF DEĞİLKEN `null` render eder → ürün görünümü DEĞİŞMEZ.
 *  · POPUP AÇMAZ · modal göstermez · ses çalmaz · odak çalmaz · ekran
 *    değiştirmez · kullanıcıdan işlem İSTEMEZ (kritik sorunda bile).
 *  · Sürüş sırasında (hız > 0 veya hız bilinmiyor) DETAY AÇILMAZ; yalnız
 *    araç dururken kullanıcı isterse tek satırlık özet görebilir.
 *  · `pointer-events` yalnız gösterge kutusundadır; altındaki ürün
 *    arayüzünü ENGELLEMEZ.
 *
 * ── RENDER BÜTÇESİ ─────────────────────────────────────────────────────
 * Gözlemci 1 Hz döner ama bu bileşen SANİYEDE BİR RENDER OLMAZ: yalnız
 * GÖRÜNEN değer (dakika · 0,1 km · kritik sayısı · hareket) değişince
 * setState yapılır. Böylece 2026-07-27 ısınma bulgusundaki "1 Hz'de tüm
 * ağaç render" tuzağına düşülmez.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import {
  getLongRoadGlance, initLongRoadRecorder, subscribeLongRoad,
} from '../../platform/fieldValidation/longRoadRecorder';

interface View {
  readonly active: boolean;
  readonly minutes: number;
  readonly km: string | null;
  readonly critical: number;
  readonly moving: boolean;
}

const IDLE_VIEW: View = { active: false, minutes: 0, km: null, critical: 0, moving: false };

function readView(): View {
  try {
    const g = getLongRoadGlance();
    return {
      active: g.active,
      minutes: Math.floor(g.elapsedMs / 60_000),
      km: g.distanceKm === null ? null : g.distanceKm.toFixed(1),
      critical: g.criticalCount,
      moving: g.moving,
    };
  } catch {
    return IDLE_VIEW;
  }
}

function sameView(a: View, b: View): boolean {
  return a.active === b.active && a.minutes === b.minutes && a.km === b.km
    && a.critical === b.critical && a.moving === b.moving;
}

function FieldTestBadgeBase() {
  const [view, setView] = useState<View>(IDLE_VIEW);
  const [expanded, setExpanded] = useState(false);
  const viewRef = useRef<View>(IDLE_VIEW);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    /* Uygulama kapanıp açıldıysa DEVAM EDEN oturum burada sürdürülür (görev §13).
       Aktif oturum yoksa hiçbir şey başlatılmaz — ürün açılışı etkilenmez. */
    try { initLongRoadRecorder('APP_RESTART'); } catch { /* fail-soft */ }

    const sync = (): void => {
      if (!mountedRef.current) return;
      const next = readView();
      if (sameView(viewRef.current, next)) return;   // gereksiz render YOK
      viewRef.current = next;
      setView(next);
      if (next.moving) setExpanded(false);           // hareket başlayınca KAPAN
    };

    sync();
    const off = subscribeLongRoad(sync);
    return () => {
      mountedRef.current = false;
      off();                                          // Zero-Leak
    };
  }, []);

  if (!view.active) return null;

  const canExpand = !view.moving;

  return (
    /* ── KONUM: ÜST BANT ORTASI, BAŞLIK ŞERİDİNİN ALTI (kütük #605) ─────────
     *
     * ÖLÇÜLEN KUSUR: rozet `fixed left-2 top-2` idi ve sol üst köşe ürünün
     * MARKA MÜHRÜNÜN evi. Gerçek tarayıcıda, kırpma+görünürlük farkındalıklı
     * kutu ölçümüyle (2026-08-16) üç çözünürlükte de örtüşme ölçüldü:
     *   904×406  → `CAR` %64 · `OS` %67 · amblem %61 örtülü
     *   1280×480 → `CAR` %51 · `OS` %51 · amblem %51
     *   1024×600 → amblem %24 · `CAR` %15
     * Yani kusur TELEFONA ÖZEL DEĞİL; head unit'te de var → düzeltme geneldir.
     *
     * Aynı çapa haritada da çakışıyordu: `GPS` + `±0m` rozetleri (idle) ve
     * navigasyonda manevra kartı (`ŞİMDİ sonra` / `Sola dönün`). Tek bir
     * yanlış çapa ÜÇ ekranda birden örtüyordu.
     *
     * ÇAPA VERİYLE SEÇİLDİ, tahminle değil: altı aday (sol üst · üst orta ·
     * başlık altı sol/sağ/orta · dock üstü orta) ölçülen kutu kümesine karşı
     * 9 durumda (ana ekran · harita boşta · navigasyon × 3 çözünürlük)
     * sınandı. **Yalnız "başlık altı + yatay orta" 9/9 TEMİZ çıktı.**
     * Diğerleri: üst orta → adres arama çubuğu ve yol adı çipiyle çakışır;
     * başlık altı sol → mesafe/manevra ile; başlık altı sağ → KAPAT / ANA
     * EKRAN düğmesiyle; dock üstü orta → saat ve koordinat okumasıyla.
     *
     * `--sat` EKLENİR: çentikli cihazda başlık şeridi de güvenli alandan
     * sonra başlar; sabit 56 px yazılsaydı çentikte yeniden örterdi. */
    <div
      className="pointer-events-none fixed z-[9000] select-none"
      style={{ top: 'calc(var(--sat, 0px) + 56px)', left: '50%', transform: 'translateX(-50%)' }}
    >
      <div
        className="pointer-events-auto flex items-center gap-1.5 rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-1)]/90 px-2 py-1 text-[10px] text-[var(--oem-ink-2)] shadow-sm"
        onClick={canExpand ? () => setExpanded((v) => !v) : undefined}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        aria-label="Saha testi aktif"
      >
        <Activity size={11} className="text-[var(--oem-good)]" />
        <span className="font-medium tracking-wide">SAHA TESTİ AKTİF</span>
        <span className="font-mono">{view.minutes} dk</span>
        {view.km !== null && <span className="font-mono">{view.km} km</span>}
        {view.critical > 0 && (
          <span className="flex items-center gap-0.5 font-mono text-[var(--oem-danger)]">
            <AlertTriangle size={10} />{view.critical}
          </span>
        )}
      </div>

      {/* Özet YALNIZ araç dururken ve kullanıcı DOKUNURSA açılır. */}
      {expanded && canExpand && (
        <div className="pointer-events-auto mt-1 max-w-[240px] rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]/95 px-2 py-1.5 text-[10px] text-[var(--oem-ink-3)]">
          Ölçüm kendiliğinden sürüyor; hiçbir işlem yapmanız gerekmiyor.
          Kritik sorun: <span className="font-mono text-[var(--oem-ink-1)]">{view.critical}</span>.
          Ayrıntı ve rapor: CAROS LAB → Geliştirici → Uzun Yol Saha Doğrulama.
        </div>
      )}
    </div>
  );
}

export default memo(FieldTestBadgeBase);
