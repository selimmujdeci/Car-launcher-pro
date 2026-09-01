/**
 * TripSummary — P0-NAV-04 · yolculuk özeti (varış · kalan süre · kalan mesafe).
 *
 * ── ÖLÇÜLEN KUSUR (gerçek cihaz karesi) ───────────────────────────────────
 * Eski alt bar ekranın tüm genişliğini kaplıyor ve dört sütun taşıyordu:
 * VARIŞ · MESAFE · **YAKIT `—`** · sonlandır. Yakıt sütunu bir navigasyon
 * hükmü DEĞİLDİ (anlık depo yüzdesiydi; etiketi bir kez zaten düzeltilmişti)
 * ve veri yokken **dekoratif bir tire** olarak duruyordu. Kaldırıldı:
 * gösterilecek bir şey yoksa alan da olmaz.
 *
 * ── DÜRÜSTLÜK (navigationHonestyModel — bypass EDİLMEDİ) ──────────────────
 *  · Varış saati YALNIZ `etaTrustworthy` iken sayı olur; aksi hâlde `—`.
 *  · Yaklaşık değerler `~` ile işaretlenir.
 *  · `DEGRADED`/`PROVISIONAL` GİZLENMEZ — ama sürekli büyük alarm da olmaz:
 *    şerit tek satır, sakin ve alt barın içinde durur (`NOTICE` dili).
 * Bu bileşen hüküm ÜRETMEZ; `honesty` dışarıdan gelir.
 */

import { memo } from 'react';
import { X } from 'lucide-react';
import { formatDistance, formatEta } from '../../../platform/navigationService';
import type { NavigationHonestyVerdict } from '../../../platform/navigation/core/navigationHonestyModel';
import type { HudPresentation } from '../../../platform/navigation/core/hudPresentationModel';

export interface TripSummaryProps {
  /** Kalan süre (sn) — motorun `EtaVerdict`inden gelir. */
  readonly etaSeconds: number;
  readonly remainingMeters: number;
  readonly totalMeters: number;
  readonly honesty: NavigationHonestyVerdict;
  readonly hud: HudPresentation;
  readonly onStop: () => void;
  /** Çevrimdışı rota — mevcut `isOfflineResult` bayrağı. */
  readonly offline?: boolean;
}

function _arrivalClock(etaSeconds: number): string {
  const a = new Date(Date.now() + etaSeconds * 1_000);
  return `${a.getHours().toString().padStart(2, '0')}:${a.getMinutes().toString().padStart(2, '0')}`;
}

export const TripSummary = memo(function TripSummary({
  etaSeconds, remainingMeters, totalMeters, honesty, hud, onStop, offline = false,
}: TripSummaryProps) {
  const portrait = hud.layout === 'PORTRAIT';
  const etaOk = honesty.etaTrustworthy && etaSeconds > 0;

  /* FAIL-CLOSED: motor sayı üretmediğinde ekran SAAT UYDURMAZ (bu kapı
     P0-NAV-02'de eklendi ve burada birebir korunur). */
  const arrival = etaOk ? _arrivalClock(etaSeconds) : '—';
  const remainTime = etaOk ? formatEta(etaSeconds) : '—';

  const distFmt = formatDistance(remainingMeters);
  const progress = totalMeters > 0
    ? Math.max(0, Math.min(1, 1 - remainingMeters / totalMeters))
    : 0;

  const approx = (on: boolean) => on
    ? <span aria-hidden style={{ color: 'var(--oem-warn)', marginRight: 2 }}>~</span>
    : null;

  const cell = (label: string, value: React.ReactNode, testid: string) => (
    <div className="flex flex-1 flex-col min-w-0" data-testid={testid}>
      <span
        className="font-black uppercase leading-none"
        style={{
          fontSize: 9, letterSpacing: '0.16em',
          color: 'var(--oem-ink-3, rgba(240,235,224,0.52))',
        }}
      >
        {label}
      </span>
      <span
        className="tabular-nums leading-none truncate"
        style={{
          marginTop: 5,
          fontSize: portrait ? 22 : 26,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: 'var(--oem-ink, #F0EBE0)',
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <div
      data-testid="trip-summary"
      className="absolute z-[var(--z-map-hud)] pointer-events-auto rounded-[1.4rem] overflow-hidden"
      style={{
        /* ── SOL KENAR: GLOBAL TANI DÜĞMESİ TEMİZLENİR (P0-NAV-05) ──────────
         * ÖLÇÜLDÜ: `GlobalDiagnosticButton` uygulama düzeyinde `fixed`tir
         * (`left: 8 · bottom: 8 · 34×34 · zIndex 9000`) ve harita yüzeyinin
         * yığın bağlamının DIŞINDA olduğu için HUD'un üstüne boyanır. Kart
         * `left: 12`den başlayınca yuvarlak düğme "VARIŞ" rakamının üstüne
         * biniyordu. Kartın sol kenarı düğmenin sağ kenarını (8+34=42) 14 px
         * boşlukla geçecek biçimde kaydırıldı. Düğme KALDIRILMADI — o bir
         * geliştirici aracıdır ve FAZ A politikası gereği yerinde kalır. */
        left: 'max(56px, calc(var(--sal, 0px) + 44px))',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)',
        /* Alt bar artık TÜM genişliği kaplamıyor: sağ alt köşe hız kümesine
           bırakıldı, harita alt-orta bandı açıldı. */
        maxWidth: portrait ? 'calc(100vw - 24px)' : 460,
        background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
        border: '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
        boxShadow: 'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
        backdropFilter: 'blur(calc(var(--rt-blur, 1) * 20px)) saturate(118%)',
        WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 20px)) saturate(118%)',
      }}
    >
      {/* İlerleme — ince, üst kenarda, tek bilgi */}
      <div className="h-[3px]" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          data-testid="trip-progress"
          className="h-full"
          style={{
            width: `${progress * 100}%`,
            background: 'var(--oem-accent, #E0A23C)',
            transition: 'width 900ms linear',
          }}
        />
      </div>

      {/* ── BİLGİ ALANI ve KONTROL AYRI ─────────────────────────────────────
       * Üç sütun AYNI görsel sistemin parçasıdır: eşit `flex` payı, aynı
       * etiket/rakam ölçüsü, aralarında yalnız ince ayraç. Sonlandır düğmesi
       * bilgi alanının İÇİNDE değil, kendi DİKEY AYRAÇLI bölmesindedir —
       * böylece dar ekranda rakamları sıkıştıramaz. */}
      <div className="flex items-stretch">
        <div className="flex flex-1 min-w-0 items-center gap-3 px-4 py-2.5">
          {cell('Varış', arrival, 'trip-arrival')}
          <div className="w-px self-stretch" style={{ background: 'var(--oem-line, rgba(255,240,210,0.12))' }} />
          {cell('Kalan', <>{approx(honesty.etaApproximate && etaOk)}{remainTime}</>, 'trip-remaining-time')}
          <div className="w-px self-stretch" style={{ background: 'var(--oem-line, rgba(255,240,210,0.12))' }} />
          {cell('Mesafe', <>{approx(honesty.distanceApproximate)}{distFmt}</>, 'trip-remaining-dist')}
        </div>

        <div className="w-px self-stretch" style={{ background: 'var(--oem-line-strong, rgba(255,240,210,0.18))' }} />
        <button
          onClick={onStop}
          aria-label="Navigasyonu sonlandır"
          data-testid="trip-stop"
          className="flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
          /* Dokunma hedefi araç ekranı için BÜYÜK kalır (48 px). */
          style={{
            width: 52, minHeight: 48, alignSelf: 'stretch',
            background: 'rgba(239,68,68,0.10)',
            color: '#fca5a5',
          }}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── DÜRÜSTLÜK ŞERİDİ — sakin, tek satır, alarm DEĞİL ──────────────── */}
      {(honesty.visible || offline) && (
        <div
          data-testid="nav-honesty-strip"
          data-honesty-level={honesty.level}
          className="flex flex-wrap items-center gap-1.5 px-4 pb-2"
        >
          {offline && (
            <span
              data-testid="nav-honesty-offline"
              className="rounded-full px-2 py-0.5"
              style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                color: 'var(--oem-warn)', background: 'var(--oem-warn-soft)',
                border: '1px solid var(--oem-warn)',
              }}
            >
              ÇEVRİMDIŞI
            </span>
          )}
          {honesty.chips.map((c) => (
            <span
              key={c.id}
              data-testid={`nav-honesty-${c.id}`}
              title={c.detail}
              aria-label={c.detail}
              className="rounded-full px-2 py-0.5"
              style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                ...(c.level === 'DEGRADED'
                  ? { color: 'var(--oem-warn)', background: 'var(--oem-warn-soft)', border: '1px solid var(--oem-warn)' }
                  : { color: 'var(--oem-ink-3)', background: 'var(--oem-surface-2)', border: '1px solid var(--oem-line-strong)' }),
              }}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
