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
import { buildWeeklySummary } from '@/lib/home/weeklySummary';
import WeeklySummaryCard from '@/components/pwa/WeeklySummaryCard';
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

  /* F5 · HAFTALIK ÖZET — YENİ OKUMA YOK.
     Yalnız yukarıda ZATEN okunmuş yolculuklar sayılır. Yakıt/servis kaynakları
     bu yüzeyde okunmadığı için `undefined` geçilir: projeksiyon onlar hakkında
     hiçbir sayı ÜRETMEZ ("0 servis kaydı" demek, okunmamış kaynağı okunmuş
     göstermek olurdu). Tam özet Araç Hafızası yüzeyindedir. */
  const weekly = buildWeeklySummary({
    now: Date.now(),
    trips,
    fuel: undefined,
    services: undefined,
  });

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
    <div className="flex flex-col gap-3">
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
      {/* "Son zamanlarda ne oldu?" — kanıt varsa; yoksa kart hiç çıkmaz. */}
      {weekly.headline && <WeeklySummaryCard summary={weekly} compact />}
    </div>
  );
}

/* ── Ortak parçalar (yalnız görünüm) ───────────────────────────────────── */

/** M3 ikon kabı — 40dp tonal daire; ikon anlam TAŞIMAZ, metin taşır. */
function IconBadge({ children, tone = 'secondary' }: { children: React.ReactNode; tone?: 'secondary' | 'primary' }) {
  return (
    <span
      aria-hidden="true"
      className="w-10 h-10 flex items-center justify-center flex-shrink-0"
      style={{
        borderRadius: 'var(--md-shape-full)',
        background: tone === 'primary' ? 'var(--md-primary-container)' : 'var(--md-secondary-container)',
        color: tone === 'primary' ? 'var(--md-on-primary-container)' : 'var(--md-on-secondary-container)',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">{children}</svg>
    </span>
  );
}

function Chevron() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      className="md-on-surface-variant flex-shrink-0">
      <path d="M9.5 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Son yolculuk ──────────────────────────────────────────────────────── */

function RecentTripCard({ home }: { home: HomeModel }) {
  const t = home.recentTrip!;
  return (
    <section className="md-card-elevated px-4 py-4 flex items-center gap-4" aria-label="Son yolculuk">
      <IconBadge>
        <path d="M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 17h6.5a3.5 3.5 0 000-7h-5a3.5 3.5 0 010-7H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </IconBadge>
      <span className="flex-1 min-w-0">
        <span className="block md-label-m md-on-surface-variant">Son yolculuk</span>
        <span className="block md-title-m md-on-surface">
          {t.distanceLabel}{t.durationLabel ? ` · ${t.durationLabel}` : ''}
        </span>
      </span>
      <span className="md-body-s md-on-surface-variant flex-shrink-0">{t.whenLabel}</span>
    </section>
  );
}

/* ── Başlık ────────────────────────────────────────────────────────────── */

function HomeHeader({ home }: { home: HomeModel }) {
  const { identity, connection } = home;
  return (
    <header className="px-1 pt-2 pb-2">
      <h1 className="md-display-s md-on-surface" style={{ fontWeight: 500 }}>{identity.title}</h1>
      {identity.subtitle && (
        <p className="md-title-m md-on-surface-variant mt-1">{identity.subtitle}</p>
      )}
      {/* TEK CÜMLE DURUM ÖZETİ — bağlantı ≠ sağlık. Nokta tek başına anlam
          taşımaz, metinle birlikte okunur (renk körlüğü: §21). */}
      <p className="mt-3 inline-flex items-center gap-2 md-label-l px-3"
        style={{
          minHeight: 32,
          borderRadius: 'var(--md-shape-sm)',
          border: '1px solid var(--md-outline-variant)',
          color: 'var(--md-on-surface-variant)',
        }}>
        <span
          aria-hidden="true"
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: connection.isOnline ? 'var(--md-success)' : 'var(--md-outline)' }}
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
      <section className="md-card-filled px-5 py-6" style={{ borderRadius: 'var(--md-shape-xl)' }}
        aria-label="Aracınızın durumu">
        <p className="md-label-m md-on-surface-variant">Aracınızın durumu</p>
        <p className="mt-2 md-body-l md-on-surface">
          {loading ? 'Araç durumu okunuyor…' : 'Araç durumu okunamadı'}
        </p>
      </section>
    );
  }

  const tone = HEALTH_TONE[s.verdict];
  return (
    <button
      onClick={onOpen}
      className="md-state px-5 py-5 text-left w-full"
      style={{ background: tone.bg, color: tone.onBg, borderRadius: 'var(--md-shape-xl)' }}
      aria-label={`Aracınızın durumu: ${s.headline}. Detaylar için dokunun.`}
    >
      <div className="flex items-start gap-4">
        <span
          className="w-12 h-12 flex items-center justify-center flex-shrink-0 text-xl font-medium"
          style={{ borderRadius: 'var(--md-shape-lg)', background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
          aria-hidden="true"
        >
          {tone.glyph}
        </span>
        <div className="flex-1 min-w-0">
          <p className="md-label-m" style={{ opacity: 0.8 }}>Aracınızın durumu</p>
          <h2 className="mt-0.5 md-title-l">{s.headline}</h2>
          <p className="mt-1.5 md-body-m" style={{ opacity: 0.86 }}>{s.explanation}</p>
          <p className="mt-3 md-body-s" style={{ opacity: 0.8 }}>
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
      className="md-state md-card-outlined px-4 py-3 w-full flex items-center gap-3 text-left"
      style={{ borderColor: tone.fg, minHeight: 64 }}
    >
      {/* Durum yalnız renkle anlatılmaz; metin de taşır (§21). */}
      <span
        className="md-label-m px-2 flex-shrink-0 inline-flex items-center"
        style={{ minHeight: 24, borderRadius: 'var(--md-shape-sm)', background: tone.bg, color: tone.onBg }}
      >
        {a.verdict === 'CRITICAL' ? 'Acil' : 'Uyarı'}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block md-title-s md-on-surface">{a.detail}</span>
        <span className="block md-body-s md-on-surface-variant mt-0.5">{a.actionLabel}</span>
      </span>
      <Chevron />
    </button>
  );
}

/* ── Yakıt / menzil ────────────────────────────────────────────────────── */

function FuelRangeRow({ home }: { home: HomeModel }) {
  const { fuel, range } = home;
  return (
    <section className="grid grid-cols-2 gap-3" aria-label="Yakıt ve menzil">
      <div className="md-card-elevated px-4 py-4 flex flex-col" style={{ borderRadius: 'var(--md-shape-lg)' }}>
        <p className="md-label-l md-on-surface-variant">Yakıt</p>
        {fuel.kind === 'MEASURED' ? (
          <>
            <p className="mt-1 md-headline-m md-on-surface tabular-nums" style={{ fontWeight: 500 }}>
              {Math.round(fuel.percent)}<span className="md-title-m">%</span>
            </p>
            <p className="mt-0.5 md-body-s md-on-surface-variant">
              {fuel.freshness === 'LIVE' ? fuel.ageLabel : fuel.display}
            </p>
            {fuel.low && (
              <p className="mt-2 md-label-m self-start px-2 inline-flex items-center"
                style={{ minHeight: 24, borderRadius: 'var(--md-shape-sm)', background: 'var(--md-warning-container)', color: 'var(--md-on-warning-container)' }}>
                Yakıt azalıyor
              </p>
            )}
          </>
        ) : (
          /* Ölçüm yoksa sayı UYDURULMAZ. */
          <p className="mt-2 md-body-m md-on-surface-variant">{fuel.reason}</p>
        )}
      </div>

      <div className="md-card-elevated px-4 py-4" style={{ borderRadius: 'var(--md-shape-lg)' }}>
        <p className="md-label-l md-on-surface-variant">Tahmini menzil</p>
        {range.kind === 'ESTIMATE' ? (
          <>
            <p className="mt-1 md-headline-m md-on-surface tabular-nums" style={{ fontWeight: 500 }}>{range.display}</p>
            {/* Tahmin, ÖLÇÜM gibi sunulmaz — kaynağı hep yazılır. */}
            <p className="mt-0.5 md-body-s md-on-surface-variant">{range.provenance}</p>
          </>
        ) : (
          <p className="mt-2 md-body-m md-on-surface-variant">{range.reason}</p>
        )}
      </div>
    </section>
  );
}

/* ── Konum ─────────────────────────────────────────────────────────────── */

const PIN_ICON = (
  <>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="12" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.6" />
  </>
);

function LocationCard({ home, onOpenMap }: { home: HomeModel; onOpenMap: () => void }) {
  const l = home.location;

  if (l.kind === 'UNAVAILABLE') {
    return (
      <section className="md-card-elevated px-4 py-4 flex items-center gap-4" aria-label="Konum">
        <IconBadge>{PIN_ICON}</IconBadge>
        <span className="flex-1 min-w-0">
          <span className="block md-label-m md-on-surface-variant">Konum</span>
          <span className="block md-body-m md-on-surface-variant">{l.reason}</span>
        </span>
      </section>
    );
  }

  return (
    <button
      onClick={onOpenMap}
      className="md-state md-card-elevated px-4 py-4 w-full flex items-center gap-4 text-left md-on-surface"
    >
      <IconBadge tone="primary">{PIN_ICON}</IconBadge>
      <span className="flex-1 min-w-0">
        {/* "Park yeri" İDDİA EDİLMEZ: deterministic park kanıtı yok (§10). */}
        <span className="block md-title-m md-on-surface">{l.label}</span>
        <span className="block md-body-s md-on-surface-variant">{l.ageLabel}</span>
      </span>
      <span className="md-label-l md-primary-text flex-shrink-0">Haritada Göster</span>
    </button>
  );
}

export const AracimHome = memo(AracimHomeBase);
export default AracimHome;
