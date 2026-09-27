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
import { Icon, type IconName } from '@/components/pwa/ui/Icon';
import { StatusPill } from '@/components/pwa/ui/primitives';

/** Rol rengini saydamlaştırır — hex'e alfa eklemek `var(--md-*)` ile çalışmaz. */
function mix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

interface Props { vehicle: LiveVehicle | null }

/** Tek seferde çekilen azami yolculuk — sunucu tavanı 200. */
const PAGE_LIMIT = 50;

/* ── Durum ekranı ────────────────────────────────────────────────────── */

const STATE_ICON: Record<Exclude<JournalSurfaceState, 'READY'>, IconName> = {
  NO_VEHICLE:   'directions_car',
  LOADING:      'route',
  EMPTY:        'route',
  OFFLINE:      'cloud_off',
  UNAUTHORIZED: 'error',
  ERROR:        'error',
};

const StateScreen = memo(function StateScreen({
  state, onRetry,
}: { state: Exclude<JournalSurfaceState, 'READY'>; onRetry: () => void }) {
  /* Yeniden denemenin ANLAMLI olduğu durumlar: geçici olanlar. Yetkisizlik
     bir bağlantı sorunu değildir; oraya "Tekrar dene" koymak kullanıcıyı
     sonuçsuz bir döngüye sokar. */
  const retryable = state === 'OFFLINE' || state === 'ERROR';
  const bad = state === 'UNAUTHORIZED' || state === 'ERROR';

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center"
      data-testid="journal-state"
      data-state={state}
      role={state === 'LOADING' ? 'status' : undefined}
    >
      <span aria-hidden="true" className="flex items-center justify-center"
        style={{ width: 88, height: 88, borderRadius: 'var(--md-shape-xl)',
          background: bad ? 'var(--md-error-container)' : 'var(--md-surface-container-high)',
          color: bad ? 'var(--md-on-error-container)' : 'var(--md-on-surface-variant)' }}>
        {state === 'LOADING' ? (
          <svg className="animate-spin w-8 h-8" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="34" strokeDashoffset="11" opacity="0.3" />
            <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : <Icon name={STATE_ICON[state]} size={44} />}
      </span>

      <p className="md-body-l md-on-surface max-w-xs mt-1">{journalSurfaceMessage(state)}</p>

      {retryable ? (
        <button onClick={onRetry} data-testid="journal-retry" className="md-btn-tonal md-state min-h-12 mt-1">
          <Icon name="refresh" size={18} />
          Tekrar dene
        </button>
      ) : null}
    </div>
  );
});

/* ── Liste satırı ────────────────────────────────────────────────────── */

const JournalRow = memo(function JournalRow({
  entry, expanded, onToggle, first,
}: { entry: JournalEntry; expanded: boolean; onToggle: (key: string) => void; first: boolean }) {
  const note = journalEndReasonNote(entry);
  const confidence = journalConfidenceLabel(entry);
  const score = formatJournalScore(entry.score);

  return (
    <li
      data-testid="journal-entry"
      data-trip-key={entry.tripKey}
      data-clean-end={entry.cleanEnd ? 'true' : 'false'}
      style={first ? undefined : { borderTop: '1px solid var(--md-outline-variant)' }}
    >
      <button
        onClick={() => onToggle(entry.tripKey)}
        aria-expanded={expanded}
        className="md-state w-full text-left flex items-start gap-4 px-4 py-3 md-on-surface"
      >
        {/* Zaman çizelgesi işareti — rota başlangıç/varış */}
        <span aria-hidden="true" className="flex flex-col items-center pt-1 flex-shrink-0" style={{ width: 24 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, border: '2px solid var(--md-primary)' }} />
          <span style={{ width: 2, height: 22, background: 'var(--md-outline-variant)' }} />
          <span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--md-primary)' }} />
        </span>

        <span className="flex-1 min-w-0">
          {/* Güzergâh bilinmiyorsa başlık "Bilinmiyor" diye BAĞIRMAZ; nötr
              "Yolculuk" der ve bilinmediğini ikinci satırda açıkça söyler. */}
          {formatJournalRoute(entry) === UNKNOWN_LABEL ? (
            <>
              <span className="block md-title-m md-on-surface">Yolculuk</span>
              <span className="block md-body-s md-on-surface-variant">Güzergâh: {UNKNOWN_LABEL}</span>
            </>
          ) : (
            <span className="block md-title-m md-on-surface truncate">{formatJournalRoute(entry)}</span>
          )}
          <span className="block md-body-m md-on-surface-variant tabular-nums">
            {formatJournalTimeRange(entry)} · {formatJournalDuration(entry.durationMin)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 md-body-s md-on-surface-variant">
            <span>Ort. {formatJournalSpeed(entry.avgSpeedKmh)}</span>
            <span>Maks. {formatJournalSpeed(entry.maxSpeedKmh)}</span>
            {/* Skor yoksa rozet HİÇ çizilmez — "0 puan" bir skor değildir. */}
            {entry.score !== null ? (
              <span data-testid="journal-score"><StatusPill tone="success">Skor {score}</StatusPill></span>
            ) : null}
          </span>
          {note !== null ? (
            <span data-testid="journal-note" className="mt-1.5 flex items-start gap-1 md-body-s"
              style={{ color: 'var(--md-warning)' }}>
              <Icon name="info" size={16} className="flex-shrink-0 mt-px" />{note}
            </span>
          ) : null}
        </span>

        <span className="flex flex-col items-end flex-shrink-0">
          <span className="md-title-m md-on-surface tabular-nums">{formatJournalDistance(entry.distanceKm)}</span>
          <Icon name="expand_more" className="md-on-surface-variant mt-1"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--md-dur-short) var(--md-ease-standard)' }} />
        </span>
      </button>

      {expanded ? (
        <div
          data-testid="journal-detail"
          className="md-enter mx-4 mb-4 p-4 grid grid-cols-2 gap-x-4 gap-y-3"
          style={{ background: 'var(--md-surface-container-high)', borderRadius: 'var(--md-shape-md)' }}
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
          <p className="col-span-2 md-body-s md-on-surface-variant inline-flex items-start gap-1">
            <Icon name="info" size={16} className="flex-shrink-0 mt-px" />
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
      <div className="md-label-m md-on-surface-variant">{label}</div>
      <div className="md-body-m md-on-surface tabular-nums">{value}</div>
    </div>
  );
});

/** Ardışık aynı güne ait yolculukları toplar (sıra DEĞİŞMEZ). */
function groupByDay(list: readonly JournalEntry[]): Array<{ key: string; label: string; items: JournalEntry[] }> {
  const out: Array<{ key: string; label: string; items: JournalEntry[] }> = [];
  for (const e of list) {
    const label = formatJournalDate(e.startedAtMs);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(e);
    else out.push({ key: `${label}-${e.tripKey}`, label, items: [e] });
  }
  return out;
}

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
    <section data-testid="trip-journal">
      {/* Sayfa başlığı zaten "Yolculuklar"; burada yalnız kapsam söylenir. */}
      {entries.length > 0 && (
        <p className="md-body-m md-on-surface-variant px-1 -mt-2 mb-3">
          Son {entries.length} yolculuk · dokunarak ayrıntıyı açın
        </p>
      )}

      {showList ? (
        <>
          {failure !== null ? (
            <p
              data-testid="journal-stale-warning"
              className="mb-3 px-4 py-3 md-body-s flex items-start gap-2"
              style={{ background: 'var(--md-warning-container)', color: 'var(--md-on-warning-container)', borderRadius: 'var(--md-shape-md)' }}
            >
              <Icon name="history_toggle_off" size={18} className="flex-shrink-0" />
              <span>
                {journalSurfaceMessage(state as Exclude<JournalSurfaceState, 'READY'>)}
                {' '}Aşağıdaki liste son başarılı okumadan kalmadır.
              </span>
            </p>
          ) : null}

          {/* GÜNE GÖRE GRUPLAMA — yalnız görünüm; sıralama projeksiyondan
              geldiği gibi korunur, gün başlığı ardışık aynı günü toplar. */}
          <div className="flex flex-col gap-4">
            {groupByDay(entries).map((g) => (
              <div key={g.key}>
                <h3 className="md-title-s md-on-surface-variant px-1 pb-2">{g.label}</h3>
                <ul className="md-card-elevated overflow-hidden">
                  {g.items.map((e, i) => (
                    <JournalRow
                      key={e.tripKey}
                      entry={e}
                      first={i === 0}
                      expanded={expanded === e.tripKey}
                      onToggle={toggle}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
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
