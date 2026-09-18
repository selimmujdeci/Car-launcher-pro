'use client';

/**
 * ARACIM — tüketici ana ekranı (F3).
 *
 * ── BU BİLEŞEN GERÇEK ÜRETMEZ ────────────────────────────────────────────
 * Tek işi `buildAracimHome` projeksiyonunu render etmektir. Burada eşik yok,
 * hüküm yok, tahmin matematiği yok, komut otoritesi yok. Hızlı kontroller
 * mevcut `MobileCarControl` yüzeyine devredilir: F0.3 kanıt dili
 * (`commandEvidence`) ve komut izleyici orada durur, KOPYALANMAZ.
 *
 * ── SIRALAMA GEREKÇESİ ───────────────────────────────────────────────────
 * Başlık → sağlık → (uyarı) → yakıt/menzil → konum → kontroller → son yolculuk.
 * Uyarı bilinçli olarak sağlığın HEMEN ALTINDADIR: "kontrol edilmesi gereken
 * bir durum"u yakıt ve konumun altına gömmek OEM bir uygulamada yanlış olurdu.
 * Aynı uyarı üç kez tekrar etmez — kodların listesi YALNIZ uyarı kartındadır.
 */

import { memo, useEffect, useRef, useState } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { fetchVehicleTripsResult } from '@/lib/vehicles.service';
import type { TripRow } from '@/lib/fleet/vehicleTripsView';
import MobileCarControl from '@/components/dashboard/MobileCarControl';
import { HEALTH_TONE } from '@/components/pwa/VehicleHealthCard';
import { healthMeasuredAtLabel } from '@/lib/diagnostics/vehicleHealth';
import { useVehicleHealth } from '@/hooks/useVehicleHealth';
import {
  buildAracimHome,
  type AracimHome as HomeModel,
  type RangeTripSample,
} from '@/lib/home/aracimHome';
import { ALERT_THRESHOLDS } from '@/lib/constants';

/** PostgREST `numeric`i metin döndürür; boş metin `0` TUZAĞINA düşülmez. */
function finite(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Yolculuk geçmişini okur — menzil kanıtı ve son yolculuk için TEK okuma.
 *
 * `null` = OKUNAMADI ("yolculuk yok" DEĞİL). Projeksiyon bu ayrımı korur:
 * okunamayan geçmişten menzil tahmini ÜRETİLMEZ.
 */
function useVehicleTrips(vehicleId: string | null): TripRow[] | null {
  const [rows, setRows] = useState<TripRow[] | null>(null);
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!vehicleId) { setRows(null); return; }
    requestedFor.current = vehicleId;
    void (async () => {
      const res = await fetchVehicleTripsResult(vehicleId, 30);
      /* Araç değiştiyse ESKİ aracın yolculukları yeni ekrana SIZAMAZ (§17). */
      if (!alive || requestedFor.current !== vehicleId) return;
      setRows(res.ok ? res.rows : null);
    })();
    return () => { alive = false; };
  }, [vehicleId]);

  return rows;
}

interface Props {
  vehicle: LiveVehicle | null;
  vehicles: LiveVehicle[];
  onSelectVehicle: (id: string) => void;
  onAddVehicle: () => void;
  /** Sağlık detayına götürür — ana ekran teşhis yüzeyini KOPYALAMAZ. */
  onOpenHealth: () => void;
  /** Haritaya götürür — ham koordinat kullanıcıya DÖKÜLMEZ. */
  onOpenMap: () => void;
}

function AracimHomeBase({
  vehicle, vehicles, onSelectVehicle, onAddVehicle, onOpenHealth, onOpenMap,
}: Props) {
  const { summary, loading } = useVehicleHealth(vehicle?.id ?? null, vehicle?.telemetry);
  const trips = useVehicleTrips(vehicle?.id ?? null);

  /* Araç yoksa ana ekran YOKTUR; eşleştirme boş durumu çağıran tarafındadır. */
  if (!vehicle) return null;

  const rangeTrips: RangeTripSample[] | null = trips === null ? null : trips.map((t) => ({
    distanceKm: finite(t.distance_km),
    fuelUsedPercent: finite(t.fuel_used_percent),
  }));

  const latest = trips?.[0] ?? null;

  const home = buildAracimHome({
    now: Date.now(),
    vehicle,
    health: summary,
    rangeTrips,
    recentTrip: latest
      ? {
          distanceKm: finite(latest.distance_km),
          durationMin: finite(latest.duration_min),
          endedAt: latest.ended_at ?? null,
        }
      : null,
    /* Düşük yakıt eşiği mevcut kanonik sabitten gelir; yeni eşik YOK. */
    lowFuelPct: ALERT_THRESHOLDS.FUEL_LOW_PCT,
  });

  return (
    <div className="flex flex-col gap-4">
      <HomeHeader home={home} />
      <HealthHero home={home} loading={loading} onOpen={onOpenHealth} />
      {home.alert && <ImportantAlert home={home} onOpen={onOpenHealth} />}
      <FuelRangeRow home={home} />
      <LocationCard home={home} onOpenMap={onOpenMap} />

      {/* Hızlı kontroller — mevcut komut yüzeyi AYNEN kullanılır. */}
      <MobileCarControl
        key={vehicle.id}
        vehicle={vehicle}
        vehicles={vehicles}
        onSelectVehicle={onSelectVehicle}
        onAddVehicle={onAddVehicle}
        variant="embedded"
      />

      {home.recentTrip && <RecentTripCard home={home} />}
    </div>
  );
}

/* ── Son yolculuk ──────────────────────────────────────────────────────── */

function RecentTripCard({ home }: { home: HomeModel }) {
  const t = home.recentTrip!;
  return (
    <section className="rounded-2xl px-4 py-3.5 flex items-center gap-3"
      style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
      <span className="flex-1 min-w-0">
        <span className="block text-[9px] font-black uppercase tracking-widest pwa-text-3">
          Son yolculuk
        </span>
        <span className="block text-[13px] font-bold pwa-text mt-0.5">
          {t.distanceLabel}{t.durationLabel ? ` · ${t.durationLabel}` : ''}
        </span>
      </span>
      <span className="text-[11px] pwa-text-3 flex-shrink-0">{t.whenLabel}</span>
    </section>
  );
}

/* ── Başlık ────────────────────────────────────────────────────────────── */

function HomeHeader({ home }: { home: HomeModel }) {
  const { identity, connection } = home;
  return (
    <header className="px-1">
      <h1 className="text-2xl font-black leading-tight pwa-text">{identity.title}</h1>
      {identity.subtitle && (
        <p className="text-sm pwa-text-2 mt-0.5">{identity.subtitle}</p>
      )}
      {/* Bağlantı ≠ sağlık. Nokta tek başına anlam taşımaz, metinle birlikte
          okunur (renk körlüğü: §21). */}
      <p className="mt-2 flex items-center gap-2 text-xs pwa-text-3">
        <span
          aria-hidden="true"
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: connection.isOnline ? '#34d399' : 'rgba(255,255,255,0.25)' }}
        />
        {connection.isOnline
          ? `Son veri · ${connection.lastDataLabel}`
          : `${connection.label} · son veri ${connection.lastDataLabel}`}
      </p>
    </header>
  );
}

/* ── Sağlık hero ───────────────────────────────────────────────────────── */

function HealthHero({
  home, loading, onOpen,
}: { home: HomeModel; loading: boolean; onOpen: () => void }) {
  const s = home.health;

  /* LOADING ≠ UNKNOWN: veri henüz okunuyorken "kanıt yok" DENMEZ (§19). */
  if (!s) {
    return (
      <section
        className="rounded-3xl px-5 py-6"
        style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}
        aria-label="Aracınızın durumu"
      >
        <p className="text-[10px] font-black uppercase tracking-[0.18em] pwa-text-3">
          Aracınızın durumu
        </p>
        <p className="mt-2 text-sm pwa-text-2">
          {loading ? 'Araç durumu okunuyor…' : 'Araç durumu okunamadı'}
        </p>
      </section>
    );
  }

  const tone = HEALTH_TONE[s.verdict];
  return (
    <button
      onClick={onOpen}
      className="rounded-3xl px-5 py-5 text-left w-full transition-transform active:scale-[0.99]"
      style={{ background: tone.bg, border: `1.5px solid ${tone.border}` }}
      aria-label={`Aracınızın durumu: ${s.headline}. Detaylar için dokunun.`}
    >
      <div className="flex items-start gap-3.5">
        <span
          className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-xl font-black"
          style={{ background: `${tone.fg}1f`, border: `1px solid ${tone.fg}3d`, color: tone.fg }}
          aria-hidden="true"
        >
          {tone.glyph}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-black leading-tight" style={{ color: tone.fg }}>
            {s.headline}
          </h2>
          <p className="mt-1.5 text-[13px] leading-snug pwa-text-2">{s.explanation}</p>
          <p className="mt-2 text-[11px] pwa-text-3">
            {healthMeasuredAtLabel(s, Date.now())}
          </p>
        </div>
      </div>
    </button>
  );
}

/* ── Tek önemli aksiyon ────────────────────────────────────────────────── */

function ImportantAlert({ home, onOpen }: { home: HomeModel; onOpen: () => void }) {
  const a = home.alert!;
  const tone = HEALTH_TONE[a.verdict];
  return (
    <button
      onClick={onOpen}
      className="rounded-2xl px-4 py-3.5 w-full flex items-center gap-3 text-left transition-transform active:scale-[0.99]"
      style={{ background: 'var(--pwa-surface-3)', border: `1px solid ${tone.border}` }}
    >
      {/* Durum yalnız renkle anlatılmaz; metin de taşır (§21). */}
      <span
        className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg flex-shrink-0"
        style={{ color: tone.fg, background: `${tone.fg}1a`, border: `1px solid ${tone.fg}33` }}
      >
        {a.verdict === 'CRITICAL' ? 'Acil' : 'Uyarı'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-bold pwa-text">{a.detail}</span>
        <span className="block text-[11px] pwa-text-3 mt-0.5">{a.actionLabel}</span>
      </span>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="flex-shrink-0">
        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" className="pwa-text-3" />
      </svg>
    </button>
  );
}

/* ── Yakıt / menzil ────────────────────────────────────────────────────── */

function FuelRangeRow({ home }: { home: HomeModel }) {
  const { fuel, range } = home;
  return (
    <section className="grid grid-cols-2 gap-3" aria-label="Yakıt ve menzil">
      <div className="rounded-2xl px-4 py-3.5"
        style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
        <p className="text-[9px] font-black uppercase tracking-widest pwa-text-3">Yakıt</p>
        {fuel.kind === 'MEASURED' ? (
          <>
            <p className="mt-1 text-2xl font-black tabular-nums pwa-text">
              {Math.round(fuel.percent)}<span className="text-base">%</span>
            </p>
            <p className="mt-0.5 text-[10px] pwa-text-3">
              {fuel.freshness === 'LIVE' ? fuel.ageLabel : fuel.display}
            </p>
            {fuel.low && (
              <p className="mt-1 text-[10px] font-bold" style={{ color: '#fbbf24' }}>
                Yakıt azalıyor
              </p>
            )}
          </>
        ) : (
          /* Ölçüm yoksa sayı UYDURULMAZ. */
          <p className="mt-2 text-sm pwa-text-3">{fuel.reason}</p>
        )}
      </div>

      <div className="rounded-2xl px-4 py-3.5"
        style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
        <p className="text-[9px] font-black uppercase tracking-widest pwa-text-3">
          Tahmini menzil
        </p>
        {range.kind === 'ESTIMATE' ? (
          <>
            <p className="mt-1 text-2xl font-black tabular-nums pwa-text">{range.display}</p>
            {/* Tahmin, ÖLÇÜM gibi sunulmaz — kaynağı hep yazılır. */}
            <p className="mt-0.5 text-[10px] pwa-text-3 leading-snug">{range.provenance}</p>
          </>
        ) : (
          <p className="mt-2 text-sm pwa-text-3 leading-snug">{range.reason}</p>
        )}
      </div>
    </section>
  );
}

/* ── Konum ─────────────────────────────────────────────────────────────── */

function LocationCard({ home, onOpenMap }: { home: HomeModel; onOpenMap: () => void }) {
  const l = home.location;

  if (l.kind === 'UNAVAILABLE') {
    return (
      <section className="rounded-2xl px-4 py-3.5"
        style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
        <p className="text-[9px] font-black uppercase tracking-widest pwa-text-3">Konum</p>
        <p className="mt-2 text-sm pwa-text-3">{l.reason}</p>
      </section>
    );
  }

  return (
    <button
      onClick={onOpenMap}
      className="rounded-2xl px-4 py-3.5 w-full flex items-center gap-3 text-left transition-transform active:scale-[0.99]"
      style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}
    >
      <span className="flex-1 min-w-0">
        {/* "Park yeri" İDDİA EDİLMEZ: deterministic park kanıtı yok (§10). */}
        <span className="block text-[13px] font-bold pwa-text">{l.label}</span>
        <span className="block text-[11px] pwa-text-3 mt-0.5">{l.ageLabel}</span>
      </span>
      <span className="text-[11px] font-bold flex-shrink-0" style={{ color: '#60a5fa' }}>
        Haritada Göster
      </span>
    </button>
  );
}

export const AracimHome = memo(AracimHomeBase);
export default AracimHome;
