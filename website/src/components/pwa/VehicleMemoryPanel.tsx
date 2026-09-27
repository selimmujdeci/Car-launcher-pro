'use client';

/**
 * ARAÇ HAFIZASI — kronolojik geçmiş yüzeyi (F4.3).
 *
 * ── BU BİLEŞEN GERÇEK ÜRETMEZ ────────────────────────────────────────────
 * Tek işi `buildVehicleMemory` projeksiyonunu render etmektir. Burada hüküm,
 * eşik, tahmin, bakım hesabı YOKTUR. Okuma mevcut kanonik servislerden
 * yapılır; yetkilendirme Supabase RLS'tedir (istemci `vehicle_id` filtresi
 * yetki DEĞİL, sorgu daraltmasıdır).
 *
 * ── BOŞLUK BİR HATA DEĞİLDİR ─────────────────────────────────────────────
 * Production'da servis/yakıt kaydı bugün SIFIRDIR. Demo olay ÜRETİLMEZ;
 * ekran dürüstçe "henüz kayıtlı geçmiş yok" der. Okunamayan kaynak ise
 * "kayıt yok" ile KARIŞTIRILMAZ, ayrıca bildirilir.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { fetchVehicleTripsResult } from '@/lib/vehicles.service';
import { loadFuelEntries, loadServiceEntries } from '@/lib/recordsService';
import { loadDiagnosticScans } from '@/lib/diagnostics/diagnosticScansReader';
import type { DiagnosticScanRecord } from '@/lib/diagnostics/diagnosticHistory';
import { SERVICE_DEFS } from '@/components/pwa/RecordsPanel';
import {
  buildVehicleMemory,
  memoryDayKey,
  provenanceLabel,
  MEMORY_PAGE_SIZE,
  type VehicleMemory,
  type VehicleMemoryEvent,
} from '@/lib/memory/vehicleMemory';
import { buildWeeklySummary, type WeeklySummary } from '@/lib/home/weeklySummary';
import WeeklySummaryCard from '@/components/pwa/WeeklySummaryCard';
import { buildVehicleShareReport } from '@/lib/reports/vehicleShareReport';
import { useVehicleHealth } from '@/hooks/useVehicleHealth';
import { vehicleSubtitle, vehicleTitle } from '@/lib/vehicleDisplay';
import { Icon, type IconName } from '@/components/pwa/ui/Icon';
import { EmptyState } from '@/components/pwa/ui/primitives';

/** Rol rengini saydamlaştırır — hex'e alfa eklemek `var(--md-*)` ile çalışmaz. */
function mix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

const SERVICE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SERVICE_DEFS.map((d) => [d.key, d.label]),
);

const TYPE_TINT: Record<VehicleMemoryEvent['type'], string> = {
  TRIP:            'var(--md-primary)',
  FUEL_RECORD:     'var(--md-success)',
  SERVICE_RECORD:  'var(--md-warning)',
  /* Teşhis taraması nötr moru: tek başına "arıza var" RENGİ DEĞİLDİR —
     taramanın sonucunu metin söyler, renk olay TÜRÜNÜ ayırt eder. */
  DIAGNOSTIC_SCAN: 'var(--md-tertiary)',
};

/** Olay türü → ikon; tür rengiyle birlikte ayırt edici, anlamı metin taşır. */
const TYPE_ICON: Record<VehicleMemoryEvent['type'], IconName> = {
  TRIP: 'route', FUEL_RECORD: 'local_gas_station', SERVICE_RECORD: 'build', DIAGNOSTIC_SCAN: 'car_repair',
};

function dayLabel(key: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (key === today) return 'Bugün';
  const d = new Date(`${key}T00:00:00.000Z`);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function VehicleMemoryPanelBase({ vehicle }: { vehicle: LiveVehicle | null }) {
  const [memory, setMemory] = useState<VehicleMemory | null>(null);
  /* Haftalık özet AYNI okumadan üretilir — ikinci sorgu YOK. */
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * Teşhis geçmişi — ÜÇ DURUM AYRI TUTULUR (F5.4):
   *   `undefined` kaynak bu kurulumda YOK · `null` okunamadı · dizi okundu.
   * Üçü de "arıza yok" DEĞİLDİR ve birbirine ÇEVRİLMEZ.
   */
  const [diagnosticScans, setDiagnosticScans] =
    useState<readonly DiagnosticScanRecord[] | null | undefined>(undefined);
  /* Sağlık TEK kanonik yoldan okunur (`useVehicleHealth`); paylaşılan özet
     kendi hükmünü ÜRETMEZ, F2.2 projeksiyonunu taşır. */
  const { summary: health } = useVehicleHealth(vehicle?.id ?? null, vehicle?.telemetry);
  const mounted = useRef(true);
  /**
   * Hangi araç için okuma başlatıldı — GEÇ GELEN SONUÇ KORUMASI.
   * A okunurken kullanıcı B'ye geçerse A'nın sonucu B ekranına SIZAMAZ.
   */
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const vehicleId = vehicle?.id ?? null;

  const load = useCallback(async () => {
    if (!vehicleId) {
      setMemory(null); setWeekly(null); setDiagnosticScans(undefined);
      requestedFor.current = null; return;
    }
    requestedFor.current = vehicleId;
    setLoading(true);

    /* Dört kanonik kaynak PARALEL okunur. Her biri kendi hatasını taşır:
       okunamayan kaynak `null` kalır ve "kayıt yok" SAYILMAZ.
       Teşhis geçmişi AYNI turda okunur: hafıza ve paylaşım özeti aynı
       veriyi kullanır, ikinci bir sorgu/otorite AÇILMAZ (F5.4A §3). */
    const [tripRes, fuelRes, svcRes, scans] = await Promise.all([
      fetchVehicleTripsResult(vehicleId, MEMORY_PAGE_SIZE),
      loadFuelEntries(vehicleId),
      loadServiceEntries(vehicleId),
      loadDiagnosticScans(vehicleId),
    ]);

    if (!mounted.current || requestedFor.current !== vehicleId) return;

    const trips = tripRes.ok ? tripRes.rows : null;
    const fuel = fuelRes.error ? null : fuelRes.entries;
    const services = svcRes.error ? null : svcRes.entries;

    /* Geç gelen sonuç koruması YUKARIDA yapıldı; buradan sonrası bu araca
       aittir. A'nın taraması B'nin ekranına/raporuna SIZAMAZ. */
    setDiagnosticScans(scans);

    setMemory(buildVehicleMemory({
      vehicleId,
      trips,
      fuel,
      services,
      serviceLabels: SERVICE_LABELS,
      diagnosticScans: scans,
    }));
    /* Üç kaynağın da OKUNDUĞU tek yüzey burasıdır; tam özet bu yüzden burada. */
    setWeekly(buildWeeklySummary({ now: Date.now(), trips, fuel, services }));
    setLoading(false);
  }, [vehicleId]);

  useEffect(() => { void load(); }, [load]);

  if (!vehicle) {
    return <EmptyState icon="directions_car" title="Araç seçilmedi" />;
  }

  if (!memory) {
    return (
      <p className="py-8 text-center md-body-m md-on-surface-variant" role="status">
        {loading ? 'Araç geçmişi okunuyor…' : 'Araç geçmişi okunamadı'}
      </p>
    );
  }

  /* Gün bazlı gruplama — aynı güne düşen olaylar tek başlık altında. */
  const days: Array<{ key: string; events: VehicleMemoryEvent[] }> = [];
  for (const e of memory.events) {
    const key = memoryDayKey(e.occurredAt);
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(e);
    else days.push({ key, events: [e] });
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="px-1 pt-2">
        <h1 className="md-headline-m md-on-surface">Araç Hafızası</h1>
        <p className="md-body-m md-on-surface-variant mt-1">
          Bu araç için kayıtlı geçmiş olaylar
        </p>
      </header>

      {weekly && <WeeklySummaryCard summary={weekly} />}

      <ShareSummaryButton
        vehicle={vehicle}
        memory={memory}
        weekly={weekly}
        health={health}
        diagnosticScans={diagnosticScans}
      />

      {/* Okunamayan kaynak "kayıt yok" DEĞİLDİR — ayrıca söylenir. */}
      {memory.unreadableSources.length > 0 && (
        <p className="md-body-s px-4 py-3 flex items-start gap-2"
          style={{ background: 'var(--md-warning-container)', color: 'var(--md-on-warning-container)', borderRadius: 'var(--md-shape-md)' }}>
          <Icon name="warning" size={18} className="flex-shrink-0" />
          <span>Şu kaynaklar okunamadı: {memory.unreadableSources.join(', ')}</span>
        </p>
      )}

      {memory.events.length === 0 ? (
        /* SAHTE OLAY ÜRETİLMEZ. */
        <EmptyState icon="history" title="Bu araç için henüz kayıtlı geçmiş yok."
          body="Yolculuk, yakıt, servis ve tarama kayıtları oluştukça burada gün gün görünür." />
      ) : (
        days.map(({ key, events }) => (
          <section key={key} className="flex flex-col">
            <h3 className="md-title-s md-on-surface-variant px-1 pb-2">
              {dayLabel(key)}
            </h3>
            <div className="md-card-elevated overflow-hidden">
              {events.map((e, i) => <MemoryRow key={e.id} event={e} first={i === 0} />)}
            </div>
          </section>
        ))
      )}

      {memory.truncated && (
        <p className="md-body-s text-center md-on-surface-variant">
          Yalnız son {MEMORY_PAGE_SIZE} olay gösteriliyor.
        </p>
      )}
    </div>
  );
}

/* ── Paylaşılabilir özet ───────────────────────────────────────────────── */

/**
 * "Servise gönderilebilir özet" — TEK EYLEM, YENİ OTORİTE YOK.
 *
 * Metin `buildVehicleShareReport` tarafından üretilir; bu bileşen yalnız
 * paylaşım yüzeyini seçer: `navigator.share` varsa o, yoksa panoya kopyalama.
 * İkisi de yoksa düğme SAHTE BAŞARI göstermez, gerekçeyi söyler.
 */
function ShareSummaryButton({
  vehicle, memory, weekly, health, diagnosticScans,
}: {
  vehicle: LiveVehicle;
  memory: VehicleMemory;
  weekly: WeeklySummary | null;
  health: ReturnType<typeof useVehicleHealth>['summary'];
  /** `undefined` kaynak yok · `null` okunamadı · dizi okundu (F5.4). */
  diagnosticScans: readonly DiagnosticScanRecord[] | null | undefined;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle');

  const share = useCallback(async () => {
    setState('busy');
    const report = buildVehicleShareReport({
      now: Date.now(),
      title: vehicleTitle(vehicle),
      subtitle: vehicleSubtitle(vehicle),
      health,
      weekly,
      events: memory.events,
      /* Hafızayla AYNI okumadan gelir — rapor kendi sorgusunu AÇMAZ.
         Üç durum (yok/okunamadı/boş) aynen taşınır; hiçbiri "arıza yok"
         diye sunulmaz. */
      diagnosticScans,
    });

    try {
      const nav = typeof navigator === 'undefined' ? null : navigator;
      if (nav && typeof nav.share === 'function') {
        await nav.share({ title: report.title, text: report.text });
        setState('idle');
        return;
      }
      if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
        await nav.clipboard.writeText(report.text);
        setState('copied');
        return;
      }
      setState('failed');
    } catch (err) {
      /* Kullanıcı paylaşım sayfasını KAPATTIYSA bu bir hata değildir. */
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      setState(aborted ? 'idle' : 'failed');
    }
  }, [vehicle, memory, weekly, health, diagnosticScans]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => { void share(); }}
        disabled={state === 'busy'}
        data-testid="share-vehicle-summary"
        className="md-btn-outlined md-state w-full disabled:opacity-60"
        style={{ minHeight: 48 }}
      >
        <Icon name={state === 'copied' ? 'check_circle' : 'share'} size={18} />
        {state === 'busy' ? 'Hazırlanıyor…' : 'Araç Durum Özetini Paylaş'}
      </button>
      <p className="md-body-s md-on-surface-variant px-1">
        {state === 'copied'
          ? 'Özet panoya kopyalandı.'
          : state === 'failed'
            ? 'Özet paylaşılamadı; cihazınız paylaşmayı ve panoya kopyalamayı desteklemiyor.'
            : 'Servise iletilebilir sade özet — yalnız gerçekten kaydedilmiş bilgiler.'}
      </p>
    </div>
  );
}

function MemoryRow({ event, first }: { event: VehicleMemoryEvent; first: boolean }) {
  const tint = TYPE_TINT[event.type];
  return (
    <article className="flex items-start gap-4 px-4 py-3"
      style={first ? undefined : { borderTop: '1px solid var(--md-outline-variant)' }}>
      <span aria-hidden="true" className="w-10 h-10 flex items-center justify-center flex-shrink-0"
        style={{ borderRadius: 'var(--md-shape-full)', color: tint, background: 'color-mix(in srgb, currentColor 14%, transparent)' }}>
        <Icon name={TYPE_ICON[event.type]} size={22} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="md-title-m md-on-surface flex-1 min-w-0">{event.title}</span>
          {event.summary && (
            <span className="md-body-m md-on-surface-variant flex-shrink-0 tabular-nums">{event.summary}</span>
          )}
        </div>

        {event.measurements.length > 0 && (
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {event.measurements.map((m) => (
              <div key={m.label} className="flex items-baseline gap-1.5">
                <dt className="md-body-s md-on-surface-variant">{m.label}</dt>
                <dd className="md-body-s font-medium md-on-surface tabular-nums">{m.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Kaynağın ne olduğu düz Türkçeyle söylenir — teknik etiket dayatılmaz. */}
        <p className="md-body-s md-on-surface-variant mt-0.5">{provenanceLabel(event.provenance)}</p>
      </div>
    </article>
  );
}

export const VehicleMemoryPanel = memo(VehicleMemoryPanelBase);
export default VehicleMemoryPanel;
