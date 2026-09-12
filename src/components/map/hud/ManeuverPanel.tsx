/**
 * ManeuverPanel — P0-NAV-04 · sürüş HUD'unun BİRİNCİL kartı.
 *
 * ── HEDEF ─────────────────────────────────────────────────────────────────
 * 0,5 saniyelik bakışta üç şey: **nereye dönüyorum · kaç metre kaldı · hangi
 * yola gireceğim.** Bu üçü kartın TAMAMIDIR. Başka hiçbir şey burada durmaz.
 *
 * ── KALDIRILAN GÖRSEL GÜRÜLTÜ (gerçek cihaz karesinde ölçüldü) ────────────
 *  · `GPS ±2m` rozeti ve toplam rota `27.3 KM` çipi kartın SOL kenarına
 *    biniyordu (eski kodun kendi yorumunda 47×20 px örtüşme kaydı vardı ve
 *    kart bunu "sağa kaydırarak" çözmeye çalışıyordu). İkisi de bu karttan
 *    ÇIKARILDI: GPS durumu `NavigationStatus`a, toplam mesafe `TripSummary`ye.
 *  · Ayrı "yol tabelası" kutusu (üst ORTA, koyu mavi) kaldırıldı — üzerinde
 *    olunan sokak, girilecek sokakla YARIŞIYORDU ve ekranın en değerli
 *    bölgesini kaplıyordu. Sürücünün sorusu "hangi yoldayım" değil, "hangi
 *    yola gireceğim"dir; o zaten bu kartta.
 *  · İkincil "sonra …" satırı artık yalnız YER VARSA ve manevra UZAKKEN
 *    görünür (`hudPresentationModel.showNextManeuver`).
 *
 * Karar VERMEZ: hangi varyantın çizileceği `hudPresentationModel`den gelir.
 */

import { memo, type ReactNode } from 'react';
import type { RouteStep } from '../../../platform/routingService';
import type { HudPresentation } from '../../../platform/navigation/core/hudPresentationModel';
import { ManeuverArrow } from './ManeuverArrow';
import { formatManeuverDistance, splitManeuverDistance } from './formatManeuverDistance';

export interface ManeuverPanelProps {
  readonly step: RouteStep;
  /** Sonraki manevraya YOL-BOYU mesafe (m). */
  readonly distToTurnM: number;
  /** Gösterilen manevranın ARDINDAKİ manevra — ikincil satır için. */
  readonly nextStep?: RouteStep;
  readonly hud: HudPresentation;
  /** Şerit rehberi — yalnız gerçek veri varsa çizilir (çağıran karar verir). */
  readonly lanes?: ReactNode;
}

export const ManeuverPanel = memo(function ManeuverPanel({
  step, distToTurnM, nextStep, hud, lanes,
}: ManeuverPanelProps) {
  const isArrive = step.maneuverType === 'arrive';
  const portrait = hud.layout === 'PORTRAIT';
  const big = hud.maneuverEmphasis;

  /* Ölçüler tek yerde: yaklaşmada kart büyür ama ekran bütçesi
     (`maneuverHeightBudget`) aşılmayacak biçimde sınırlı kalır. */
  const arrowSize = big ? 'xl' : portrait ? 'lg' : 'lg';
  const distFont  = big ? (portrait ? 44 : 52) : (portrait ? 34 : 40);
  const streetFont = big ? (portrait ? 17 : 19) : (portrait ? 15 : 17);

  /* Canonical hedef mesafeyi BÜYÜK değer + KÜÇÜK birim olarak dizer.
     Parçalama tek kaynaktan gelir (`splitManeuverDistance`); burada hiçbir
     eşik ya da yuvarlama YENİDEN tanımlanmaz. */
  const dist = isArrive
    ? { value: 'VARIŞ', unit: null as 'm' | 'km' | null, fullText: 'VARIŞ' }
    : splitManeuverDistance(distToTurnM);
  /* Girilecek yol: OSRM `streetName`. Yoksa talimat metni kullanılır —
     UYDURULMAZ, yalnız elde olan gösterilir. */
  const enterRoad = step.streetName?.trim() || step.instruction?.trim() || '';

  const accent = hud.tone === 'FOCUS'
    ? 'var(--oem-accent, #E0A23C)'
    : 'var(--oem-ink, #F0EBE0)';

  return (
    <div
      data-editable="nav.maneuver" data-editable-type="card"
      data-testid="maneuver-panel"
      data-hud-state={hud.state}
      data-emphasis={big ? '1' : '0'}
      className="absolute z-[var(--z-map-hud)] pointer-events-none"
      style={{
        top:  'calc(var(--sat, 0px) + 12px)',
        left: 'max(12px, var(--sal, 0px))',
        /* Dikeyde kart tam genişliğe yayılır (bilgi önceliği yeniden akar);
           yatayda dar tutulur ki HARİTA görünür kalsın — bu turun şartı. */
        right: portrait ? 'max(12px, var(--sar, 0px))' : undefined,
        width: portrait ? undefined : (big ? 360 : 316),
        maxWidth: 'calc(100vw - 24px)',
      }}
    >
      <div
        className="oem-glass overflow-hidden rounded-[1.4rem]"
        style={{
          padding: big ? '14px 18px' : '11px 15px',
          background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
          border: `1px solid ${hud.tone === 'FOCUS'
            ? 'var(--oem-line-warm, oklch(66% 0.10 55 / 0.45))'
            : 'var(--oem-line-strong, rgba(255,240,210,0.18))'}`,
          boxShadow: 'var(--oem-shadow-raised, 0 28px 56px -26px rgba(0,0,0,0.62))',
          backdropFilter: 'blur(calc(var(--rt-blur, 1) * 20px)) saturate(118%)',
          WebkitBackdropFilter: 'blur(calc(var(--rt-blur, 1) * 20px)) saturate(118%)',
        }}
      >
        {/* ── BİRİNCİL ŞERİT: ok · mesafe ─────────────────────────────────── */}
        <div className="flex items-center" style={{ gap: big ? 16 : 12 }}>
          <span style={{ color: accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <ManeuverArrow mod={step.maneuverModifier} type={step.maneuverType} size={arrowSize} />
          </span>
          <span
            data-testid="maneuver-distance"
            data-distance-value={dist.value}
            data-distance-unit={dist.unit ?? ''}
            className="tabular-nums leading-none"
            style={{
              fontSize: distFont,
              fontWeight: 800,
              letterSpacing: '-0.035em',
              color: 'var(--oem-ink, #F0EBE0)',
              /* Birim değerin TABANINA hizalanır; değeri yukarı itmez. */
              display: 'flex', alignItems: 'baseline', gap: dist.unit ? 4 : 0,
              /* Uzun yol adı mesafeyi İTEMEZ: mesafe kendi genişliğini korur. */
              flexShrink: 0,
            }}
            aria-label={dist.fullText}
          >
            {dist.value}
            {dist.unit !== null && (
              <span
                data-testid="maneuver-distance-unit"
                aria-hidden
                style={{
                  /* Birim ikincildir: değerin ~%38'i, daha ince, daha soluk.
                     Değerin görsel ağırlığını ASLA geçmez. */
                  fontSize: Math.round(distFont * 0.38),
                  fontWeight: 600,
                  letterSpacing: '0',
                  color: 'var(--oem-ink-2, rgba(240,235,224,0.72))',
                }}
              >
                {dist.unit}
              </span>
            )}
          </span>
        </div>

        {/* ── GİRİLECEK YOL ───────────────────────────────────────────────── */}
        {enterRoad !== '' && (
          <div
            data-testid="maneuver-road"
            className="truncate"
            style={{
              marginTop: big ? 8 : 6,
              fontSize: streetFont,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--oem-ink-2, rgba(240,235,224,0.80))',
            }}
          >
            {enterRoad}
          </div>
        )}

        {/* ── İKİNCİL: sonraki manevra (yalnız yer varsa ve uzakken) ──────── */}
        {hud.showNextManeuver && nextStep && !isArrive && step.distance > 0 && (
          <div
            data-testid="maneuver-next"
            className="flex items-center gap-2 truncate"
            style={{
              marginTop: 8, paddingTop: 8,
              borderTop: '1px solid var(--oem-line, rgba(255,240,210,0.10))',
              fontSize: 12, fontWeight: 600,
              color: 'var(--oem-ink-3, rgba(240,235,224,0.52))',
            }}
          >
            <span style={{ display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <ManeuverArrow mod={nextStep.maneuverModifier} type={nextStep.maneuverType} size="xs" />
            </span>
            <span className="truncate">
              {formatManeuverDistance(step.distance)} sonra{nextStep.streetName ? ` · ${nextStep.streetName}` : ''}
            </span>
          </div>
        )}

        {/* Şerit rehberi — SADECE gerçek veri (çağıran süzer). */}
        {hud.showLaneGuidance && lanes !== undefined && (
          <div style={{ marginTop: 10 }}>{lanes}</div>
        )}
      </div>
    </div>
  );
});
