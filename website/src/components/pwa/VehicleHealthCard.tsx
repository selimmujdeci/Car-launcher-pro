'use client';

/**
 * ARACINIZIN DURUMU — OEM++ sağlık kartı (F2.2).
 *
 * ── BU BİLEŞEN HÜKÜM VERMEZ ──────────────────────────────────────────────
 * Tek işi `buildVehicleHealthSummary` projeksiyonunu RENDER etmektir. Burada
 * eşik yok, severity yok, "arıza yok" kararı yok. UI'da karar üretmek, F2.1'de
 * kapatılan yalanı (taşıma başarısını ölçüm başarısı sanmak) geri getirirdi.
 *
 * Kart yeni komut GÖNDERMEZ: aracın daha önce yazdığı ölçümü okur. Tarama
 * başlatmak kullanıcının açık eylemidir ve altındaki teşhis panelinde durur.
 */

import { memo } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import {
  healthMeasuredAtLabel,
  type VehicleHealthSummary,
} from '@/lib/diagnostics/vehicleHealth';
import { useVehicleHealth } from '@/hooks/useVehicleHealth';
import type { Verdict } from '@/lib/console/evidenceModel';

/* ── Görsel dil ────────────────────────────────────────────────────────────
   Korkutucu kırmızı YALNIZ `CRITICAL`de. `NO_EVIDENCE` sakin gri: "bilmiyoruz"
   bir hata durumu gibi gösterilmez (§16). */
export interface HealthTone {
  /** Vurgu rengi (M3 rol) — ikon/kod metni. */
  fg: string;
  /** Kap rengi — tonal kart zemini. */
  bg: string;
  /** Kap üstündeki metin rengi (AA kontrastı rol çiftinden gelir). */
  onBg: string;
  border: string;
  glyph: string;
}

/* M3 rol çiftleri (container / on-container) → açık ve koyu temada AA garanti.
   Eski sabit hex'ler koyu temaya göre seçilmişti ve açık temada başlık
   okunmuyordu (#34d399 beyaz zemin üstünde ~1.9:1). */
export const HEALTH_TONE: Record<Verdict, HealthTone> = {
  VERIFIED:    { fg: 'var(--md-success)', bg: 'var(--md-success-container)', onBg: 'var(--md-on-success-container)', border: 'transparent', glyph: '✓' },
  WARNING:     { fg: 'var(--md-warning)', bg: 'var(--md-warning-container)', onBg: 'var(--md-on-warning-container)', border: 'transparent', glyph: '!' },
  CRITICAL:    { fg: 'var(--md-error)',   bg: 'var(--md-error-container)',   onBg: 'var(--md-on-error-container)',   border: 'transparent', glyph: '!' },
  NO_EVIDENCE: { fg: 'var(--md-on-surface-variant)', bg: 'var(--md-surface-container-high)', onBg: 'var(--md-on-surface)', border: 'transparent', glyph: '—' },
};

interface Props {
  vehicle: LiveVehicle | null;
}

function VehicleHealthCardBase({ vehicle }: Props) {
  /* Okuma ve bileşim TEK yerdedir (`useVehicleHealth`) — ana ekran da aynı
     yolu kullanır, yani iki yüzey arasında ikinci bir bileşim doğmaz. */
  const { summary, loading } = useVehicleHealth(vehicle?.id ?? null, vehicle?.telemetry);

  if (!vehicle) return null;
  return <HealthCardView summary={summary} loading={loading} now={Date.now()} />;
}

/**
 * SAF GÖRÜNÜM — yalnız projeksiyonu basar.
 *
 * Veri okuma ve hüküm DIŞARIDADIR: burada `fetch` de yoktur, eşik de. Ayrım
 * bilinçlidir — böylece "UI karar üretmiyor" iddiası yapısal olarak DOĞRUDUR
 * ve gerçek render ile sınanabilir.
 */
export function HealthCardView({
  summary,
  loading,
  now,
}: {
  summary: VehicleHealthSummary | null;
  loading: boolean;
  now: number;
}) {
  if (!summary) {
    return (
      <div className="md-card-filled px-5 py-6">
        <p className="md-title-m md-on-surface">Aracınızın durumu</p>
        <p className="mt-2 md-body-m md-on-surface-variant">
          {loading ? 'Sağlık verisi okunuyor…' : 'Sağlık verisi okunamadı'}
        </p>
      </div>
    );
  }

  const tone = HEALTH_TONE[summary.verdict];

  return (
    <section className="flex flex-col gap-3" aria-label="Aracınızın durumu">
      {/* ── Ana sonuç: ilk bakışta TEK cümle — tonal kap ──────────────── */}
      <div className="px-5 py-5 flex items-start gap-4"
        style={{ background: tone.bg, color: tone.onBg, borderRadius: 'var(--md-shape-xl)' }}>
        <div
          className="w-12 h-12 flex items-center justify-center flex-shrink-0 text-xl font-medium"
          style={{ borderRadius: 'var(--md-shape-lg)', background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
          aria-hidden="true"
        >
          {tone.glyph}
        </div>
        <div className="flex-1 min-w-0">
          <p className="md-label-m" style={{ opacity: 0.8 }}>Aracınızın durumu</p>
          <h2 className="mt-1 md-title-l">{summary.headline}</h2>
          <p className="mt-1.5 md-body-m" style={{ opacity: 0.86 }}>{summary.explanation}</p>
          <p className="mt-2 md-body-s" style={{ opacity: 0.8 }}>{healthMeasuredAtLabel(summary, now)}</p>
        </div>
      </div>

      {/* ── Arıza kodları: araçtan geldiği kadarıyla ───────────────────── */}
      {summary.dtcs.length > 0 && (
        <ul className="md-card-outlined flex flex-col" aria-label="Tespit edilen arıza kodları">
          {summary.dtcs.map((d, i) => (
            <li key={d.code}
              className="flex items-baseline gap-3 px-4 py-3"
              style={i > 0 ? { borderTop: '1px solid var(--md-outline-variant)' } : undefined}>
              <span className="md-label-l flex-shrink-0 tabular-nums" style={{ color: tone.fg }}>
                {d.code}
              </span>
              <span className="md-body-m md-on-surface">{d.desc}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Kanıtlar: veri yoksa SAHTE KART DOLDURULMAZ ─────────────────── */}
      <ul className="grid grid-cols-3 gap-2" aria-label="Sağlık kanıtları">
        {summary.evidence.map((e) => {
          const t = HEALTH_TONE[e.verdict];
          return (
            <li key={e.id} className="md-card-elevated px-3 py-3 flex flex-col gap-1">
              <span className="md-label-m md-on-surface-variant">{e.label}</span>
              <span className="md-body-s font-medium" style={{ color: t.fg }}>{e.detail}</span>
            </li>
          );
        })}
      </ul>

      {/* ── Kapsam sınırları: hükmün NEYİ kapsamadığı ───────────────────── */}
      {summary.limitations.length > 0 && (
        <ul className="flex flex-col gap-1 px-1" aria-label="Değerlendirme sınırları">
          {summary.limitations.map((l) => (
            <li key={l} className="md-body-s md-on-surface-variant pl-3 relative">
              <span aria-hidden="true" className="absolute left-0">·</span>
              {l}
            </li>
          ))}
        </ul>
      )}

      {/* ── BAĞLANTI: sağlıkla KARIŞTIRILMAZ (§11) ──────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-1 pt-1">
        <span className="md-label-m md-on-surface-variant">Bağlantı</span>
        <span className="md-body-s md-on-surface-variant text-right">
          {summary.connection.label} · son veri {summary.connection.lastSeenLabel}
        </span>
      </div>
    </section>
  );
}

export const VehicleHealthCard = memo(VehicleHealthCardBase);
export default VehicleHealthCard;
