'use client';

/**
 * TripJournalPanel — "ARABAM CEBİMDE" SEYİR DEFTERİ.
 *
 * ── NE GÖSTERİR ───────────────────────────────────────────────────────
 * Yalnız YETKİLİ olunan aracın **tamamlanmış** yolculuk özetlerini. Kapsam
 * sunucudadır (`list_vehicle_trips` + RLS); bu bileşen kapsam ÜRETMEZ ve
 * `vehicleId`yi bir yetki olarak KULLANMAZ — yetkisiz bir kimlik gönderilse
 * sunucu boş döner.
 *
 * ── TAM ROTA YOKTUR ───────────────────────────────────────────────────
 * Rota izi bulutta SAKLANMAZ (cihazda kalır), bu yüzden burada harita
 * çizgisi ÇİZİLMEZ ve kullanıcıya rota VAAT EDİLMEZ. Gösterilen "Tarsus →
 * Mersin" kaba ALAN ADIDIR, bir güzergâh değildir.
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────
 * "Okunamadı" ile "yolculuk yok" ASLA aynı ekranı göstermez; çevrimdışı ile
 * yetkisiz de ayrılır. Bilinmeyen metrik "Bilinmiyor" der — sahte `0` yok.
 * Karar mantığı saf modeldedir (`tripJournalView`); burası yalnız çizer.
 */

import { memo, useCallback, useEffect, useState } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import {
  fetchVehicleTripsResult, type TripFetchFailure,
} from '@/lib/vehicles.service';
import {
  buildJournalList, deriveJournalSurfaceState, journalSurfaceMessage,
  formatJournalDate, formatJournalTimeRange, formatJournalRoute,
  formatJournalDistance, formatJournalDuration, formatJournalSpeed,
  formatJournalScore, journalEndReasonNote, journalConfidenceLabel,
  UNKNOWN_LABEL,
  type JournalEntry, type JournalSurfaceState,
} from '@/lib/tripJournalView';

interface Props { vehicle: LiveVehicle | null }

/** Tek seferde çekilen azami yolculuk — sunucu tavanı 200. */
const PAGE_LIMIT = 50;

/* ── Durum ekranı ────────────────────────────────────────────────────── */

const STATE_TONE: Record<Exclude<JournalSurfaceState, 'READY'>, string> = {
  NO_VEHICLE:   'var(--pwa-text-3)',
  LOADING:      'var(--pwa-text-3)',
  EMPTY:        'var(--pwa-text-3)',
  OFFLINE:      '#fbbf24',
  UNAUTHORIZED: '#f87171',
  ERROR:        '#f87171',
};

const StateScreen = memo(function StateScreen({
  state, onRetry,
}: { state: Exclude<JournalSurfaceState, 'READY'>; onRetry: () => void }) {
  /* Yeniden denemenin ANLAMLI olduğu durumlar: geçici olanlar. Yetkisizlik
     bir bağlantı sorunu değildir; oraya "Tekrar dene" koymak kullanıcıyı
     sonuçsuz bir döngüye sokar. */
  const retryable = state === 'OFFLINE' || state === 'ERROR';

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center"
      data-testid="journal-state"
      data-state={state}
    >
      {state === 'LOADING' ? (
        <svg className="animate-spin w-5 h-5" viewBox="0 0 20 20" fill="none"
          style={{ color: 'var(--pwa-text-3)' }} aria-hidden="true">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"
            strokeDasharray="34" strokeDashoffset="11" opacity="0.4" />
          <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" />
        </svg>
      ) : null}

      <p className="text-xs leading-relaxed" style={{ color: STATE_TONE[state] }}>
        {journalSurfaceMessage(state)}
      </p>

      {retryable ? (
        <button
          onClick={onRetry}
          data-testid="journal-retry"
          className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
          style={{
            color: 'var(--pwa-text-2)',
            background: 'var(--pwa-border-soft)',
            border: '1px solid var(--pwa-border)',
          }}
        >
          Tekrar dene
        </button>
      ) : null}
    </div>
  );
});

/* ── Liste satırı ────────────────────────────────────────────────────── */

const JournalRow = memo(function JournalRow({
  entry, expanded, onToggle,
}: { entry: JournalEntry; expanded: boolean; onToggle: (key: string) => void }) {
  const note = journalEndReasonNote(entry);
  const confidence = journalConfidenceLabel(entry);
  const score = formatJournalScore(entry.score);

  return (
    <li
      data-testid="journal-entry"
      data-trip-key={entry.tripKey}
      data-clean-end={entry.cleanEnd ? 'true' : 'false'}
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'var(--pwa-surface)',
        border: '1px solid var(--pwa-border)',
      }}
    >
      <button
        onClick={() => onToggle(entry.tripKey)}
        aria-expanded={expanded}
        className="w-full text-left px-4 py-3 transition-colors active:scale-[0.99]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--pwa-text-2)' }}>
            {formatJournalDate(entry.startedAtMs)}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--pwa-text-3)' }}>
            {formatJournalTimeRange(entry)}
          </span>
        </div>

        <div className="mt-1 text-sm font-bold truncate" style={{ color: 'var(--pwa-text)' }}>
          {formatJournalRoute(entry)}
        </div>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]"
          style={{ color: 'var(--pwa-text-2)' }}>
          <span className="font-bold" style={{ color: 'var(--pwa-text)' }}>
            {formatJournalDistance(entry.distanceKm)}
          </span>
          <span>{formatJournalDuration(entry.durationMin)}</span>
          <span>Ort. {formatJournalSpeed(entry.avgSpeedKmh)}</span>
          <span>Maks. {formatJournalSpeed(entry.maxSpeedKmh)}</span>
          {/* Skor yoksa rozet HİÇ çizilmez — "0 puan" bir skor değildir. */}
          {entry.score !== null ? (
            <span data-testid="journal-score"
              className="px-1.5 py-0.5 rounded-md text-[9px] font-black tracking-wider"
              style={{ color: '#34d399', background: 'rgba(52,211,153,0.12)' }}>
              SKOR {score}
            </span>
          ) : null}
        </div>

        {note !== null ? (
          <p data-testid="journal-note" className="mt-2 text-[10px] leading-snug"
            style={{ color: '#fbbf24' }}>
            {note}
          </p>
        ) : null}
      </button>

      {expanded ? (
        <div
          data-testid="journal-detail"
          className="px-4 pb-4 pt-1 grid grid-cols-2 gap-x-4 gap-y-2"
          style={{ borderTop: '1px solid var(--pwa-border-soft)' }}
        >
          <Detail label="Başlangıç" value={entry.startArea ?? UNKNOWN_LABEL} />
          <Detail label="Varış"     value={entry.endArea ?? UNKNOWN_LABEL} />
          <Detail label="Toplam süre"   value={formatJournalDuration(entry.durationMin)} />
          <Detail label="Hareket süresi" value={formatJournalDuration(entry.movingMin)} />
          <Detail label="Duruş / mola"   value={formatJournalDuration(entry.stoppedMin)} />
          <Detail label="Toplam mesafe"  value={formatJournalDistance(entry.distanceKm)} />
          <Detail label="Ortalama hız"   value={formatJournalSpeed(entry.avgSpeedKmh)} />
          <Detail label="Maksimum hız"   value={formatJournalSpeed(entry.maxSpeedKmh)} />
          <Detail label="Sürüş skoru"    value={score} />
          {confidence !== null ? (
            <Detail label="Doğruluk" value={confidence} />
          ) : null}

          {/* Rota bulutta YOK — kullanıcıya bunu söylemek, boş bir harita
              göstermekten dürüsttür. */}
          <p className="col-span-2 mt-1 text-[9px] leading-snug"
            style={{ color: 'var(--pwa-text-3)' }}>
            Yolculuk rotası yalnız aracınızda saklanır; buraya gönderilmez.
          </p>
        </div>
      ) : null}
    </li>
  );
});

const Detail = memo(function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8px] font-black uppercase tracking-widest"
        style={{ color: 'var(--pwa-text-3)' }}>
        {label}
      </div>
      <div className="text-[11px] font-semibold" style={{ color: 'var(--pwa-text)' }}>
        {value}
      </div>
    </div>
  );
});

/* ── Panel ───────────────────────────────────────────────────────────── */

export default function TripJournalPanel({ vehicle }: Props) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [failure, setFailure] = useState<TripFetchFailure | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const vehicleId = vehicle?.id ?? null;

  useEffect(() => {
    if (vehicleId === null) {
      setEntries([]); setFailure(null); setRowCount(null); setLoading(false);
      return;
    }

    /* OTURUM/ARAÇ SINIRI: geç dönen bir yanıt, kullanıcı başka araca
       geçtikten sonra o aracın listesini EZEMEZ. */
    let live = true;
    setLoading(true);
    setFailure(null);

    void (async () => {
      const res = await fetchVehicleTripsResult(vehicleId, PAGE_LIMIT);
      if (!live) return;
      if (res.ok) {
        const list = buildJournalList(res.rows);
        setEntries(list);
        setRowCount(list.length);
        setFailure(null);
      } else {
        /* Hata durumunda ESKİ liste TEMİZLENMEZ: elde doğru veri varken onu
           silip "hata" göstermek, kullanıcının zaten görmüş olduğu gerçeği
           geri alır. Durum ekranı yalnız gösterilecek satır YOKSA çıkar. */
        setFailure(res.reason);
        setRowCount(null);
      }
      setLoading(false);
    })();

    return () => { live = false; };
  }, [vehicleId, nonce]);

  const retry = useCallback(() => { setNonce((n) => n + 1); }, []);
  const toggle = useCallback((key: string) => {
    setExpanded((cur) => (cur === key ? null : key));
  }, []);

  const state = deriveJournalSurfaceState({
    hasVehicle: vehicleId !== null,
    loading,
    failure,
    rowCount,
  });

  /* Elde gösterilecek satır VARSA liste gösterilir; hata bir şerit olarak
     üstte durur. Satır yoksa tam ekran durum gösterilir. */
  const showList = entries.length > 0 && (state === 'READY' || failure !== null);

  return (
    <section className="px-4 py-3" data-testid="trip-journal">
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-black tracking-tight" style={{ color: 'var(--pwa-text)' }}>
          Seyir Defteri
        </h2>
        <span className="text-[9px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--pwa-text-3)' }}>
          {entries.length > 0 ? `${entries.length} yolculuk` : ''}
        </span>
      </header>

      {showList ? (
        <>
          {failure !== null ? (
            <p
              data-testid="journal-stale-warning"
              className="mb-3 px-3 py-2 rounded-xl text-[10px] leading-snug"
              style={{
                color: '#fbbf24',
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.25)',
              }}
            >
              {journalSurfaceMessage(state as Exclude<JournalSurfaceState, 'READY'>)}
              {' '}Aşağıdaki liste son başarılı okumadan kalmadır.
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <JournalRow
                key={e.tripKey}
                entry={e}
                expanded={expanded === e.tripKey}
                onToggle={toggle}
              />
            ))}
          </ul>
        </>
      ) : (
        <StateScreen
          state={state as Exclude<JournalSurfaceState, 'READY'>}
          onRetry={retry}
        />
      )}
    </section>
  );
}
