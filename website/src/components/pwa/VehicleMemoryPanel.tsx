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

const SERVICE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SERVICE_DEFS.map((d) => [d.key, d.label]),
);

const TYPE_TINT: Record<VehicleMemoryEvent['type'], string> = {
  TRIP:            '#60a5fa',
  FUEL_RECORD:     '#34d399',
  SERVICE_RECORD:  '#fbbf24',
  /* Teşhis taraması nötr moru: tek başına "arıza var" RENGİ DEĞİLDİR —
     taramanın sonucunu metin söyler, renk olay TÜRÜNÜ ayırt eder. */
  DIAGNOSTIC_SCAN: '#a78bfa',
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
    if (!vehicleId) { setMemory(null); setWeekly(null); requestedFor.current = null; return; }
    requestedFor.current = vehicleId;
    setLoading(true);

    /* Üç kanonik kaynak PARALEL okunur. Her biri kendi hatasını taşır:
       okunamayan kaynak `null` kalır ve "kayıt yok" SAYILMAZ. */
    const [tripRes, fuelRes, svcRes] = await Promise.all([
      fetchVehicleTripsResult(vehicleId, MEMORY_PAGE_SIZE),
      loadFuelEntries(vehicleId),
      loadServiceEntries(vehicleId),
    ]);

    if (!mounted.current || requestedFor.current !== vehicleId) return;

    const trips = tripRes.ok ? tripRes.rows : null;
    const fuel = fuelRes.error ? null : fuelRes.entries;
    const services = svcRes.error ? null : svcRes.entries;

    setMemory(buildVehicleMemory({
      vehicleId,
      trips,
      fuel,
      services,
      serviceLabels: SERVICE_LABELS,
    }));
    /* Üç kaynağın da OKUNDUĞU tek yüzey burasıdır; tam özet bu yüzden burada. */
    setWeekly(buildWeeklySummary({ now: Date.now(), trips, fuel, services }));
    setLoading(false);
  }, [vehicleId]);

  useEffect(() => { void load(); }, [load]);

  if (!vehicle) {
    return <p className="py-6 text-center text-sm pwa-text-3">Araç seçilmedi</p>;
  }

  if (!memory) {
    return (
      <p className="py-8 text-center text-sm pwa-text-3">
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
      <header className="px-1">
        <h2 className="text-lg font-black pwa-text">Araç Hafızası</h2>
        <p className="text-[11px] pwa-text-3 mt-0.5">
          Bu araç için kayıtlı geçmiş olaylar
        </p>
      </header>

      {weekly && <WeeklySummaryCard summary={weekly} />}

      <ShareSummaryButton
        vehicle={vehicle}
        memory={memory}
        weekly={weekly}
        health={health}
      />

      {/* Okunamayan kaynak "kayıt yok" DEĞİLDİR — ayrıca söylenir. */}
      {memory.unreadableSources.length > 0 && (
        <p className="text-[11px] px-3 py-2 rounded-xl"
          style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)', color: 'rgba(255,255,255,0.45)' }}>
          Şu kaynaklar okunamadı: {memory.unreadableSources.join(', ')}
        </p>
      )}

      {memory.events.length === 0 ? (
        /* SAHTE OLAY ÜRETİLMEZ. */
        <p className="py-10 text-center text-sm pwa-text-3">
          Bu araç için henüz kayıtlı geçmiş yok.
        </p>
      ) : (
        days.map(({ key, events }) => (
          <section key={key} className="flex flex-col gap-2">
            <h3 className="text-[10px] font-black uppercase tracking-[0.18em] pwa-text-3 px-1">
              {dayLabel(key)}
            </h3>
            {events.map((e) => <MemoryRow key={e.id} event={e} />)}
          </section>
        ))
      )}

      {memory.truncated && (
        <p className="text-[11px] text-center pwa-text-3">
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
  vehicle, memory, weekly, health,
}: {
  vehicle: LiveVehicle;
  memory: VehicleMemory;
  weekly: WeeklySummary | null;
  health: ReturnType<typeof useVehicleHealth>['summary'];
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
  }, [vehicle, memory, weekly, health]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => { void share(); }}
        disabled={state === 'busy'}
        data-testid="share-vehicle-summary"
        className="w-full min-h-[48px] rounded-2xl px-4 text-[13px] font-semibold transition-transform active:scale-[0.99] disabled:opacity-60"
        style={{
          background: 'rgba(59,130,246,0.12)',
          border: '1px solid rgba(59,130,246,0.28)',
          color: '#93c5fd',
        }}
      >
        {state === 'busy' ? 'Hazırlanıyor…' : 'Araç Durum Özetini Paylaş'}
      </button>
      <p className="text-[10px] pwa-text-3 px-1 leading-snug">
        {state === 'copied'
          ? 'Özet panoya kopyalandı.'
          : state === 'failed'
            ? 'Özet paylaşılamadı; cihazınız paylaşmayı ve panoya kopyalamayı desteklemiyor.'
            : 'Servise iletilebilir sade özet — yalnız gerçekten kaydedilmiş bilgiler.'}
      </p>
    </div>
  );
}

function MemoryRow({ event }: { event: VehicleMemoryEvent }) {
  const tint = TYPE_TINT[event.type];
  return (
    <article
      className="rounded-2xl px-4 py-3 flex flex-col gap-1.5"
      style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}
    >
      <div className="flex items-baseline gap-2">
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: tint }} />
        <span className="text-[13px] font-bold pwa-text flex-1 min-w-0">{event.title}</span>
        {event.summary && (
          <span className="text-[12px] pwa-text-2 flex-shrink-0">{event.summary}</span>
        )}
      </div>

      {event.measurements.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 pl-3.5">
          {event.measurements.map((m) => (
            <div key={m.label} className="flex items-baseline gap-1.5">
              <dt className="text-[10px] pwa-text-3">{m.label}</dt>
              <dd className="text-[11px] font-semibold pwa-text-2">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Kaynağın ne olduğu düz Türkçeyle söylenir — teknik etiket dayatılmaz. */}
      <p className="text-[10px] pwa-text-3 pl-3.5">{provenanceLabel(event.provenance)}</p>
    </article>
  );
}

export const VehicleMemoryPanel = memo(VehicleMemoryPanelBase);
export default VehicleMemoryPanel;
