/**
 * MediaAuthorityScreen — CAROS LAB · Çalışma Zamanı · Medya Otoritesi (Müzik Hub Paket A).
 *
 * SALT-OKUNUR. Native playback authority'nin (CarosPlaybackService · ExoPlayer ·
 * MediaSession · AudioFocus) gerçek durumunu gösterir; hiçbir komut GÖNDERMEZ.
 *
 * YAPMADIKLARI (pazarlıksız): çal/duraklat/geç/seek · kaynak değiştirme ·
 * ses veya duck değiştirme · kurtarma tetikleme · servis başlatma/durdurma ·
 * yeni timer/polling/abonelik · yeni global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB deseni — açılışta tek okuma + elle YENİLE.
 *
 * GİZLİLİK: parça başlığı · sanatçı · URI · kapak BU EKRANA GELMEZ; yalnız
 * "metadata var mı" bilgisi, sayılar ve durum kodları gösterilir.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Music4 } from 'lucide-react';
import {
  readMediaAuthoritySnapshot, type MediaAuthorityRawSnapshot,
} from '../../../platform/devtools/mediaAuthoritySources';
import {
  buildMediaAuthorityCards, countByMediaAuthorityClass, deriveMediaAuthorityVerdict,
  MEDIA_AUTHORITY_VERDICT_LABEL, type MediaAuthorityVerdict,
} from '../../../platform/devtools/mediaAuthorityModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';
import {
  DEVICE_SCENARIOS, SCENARIO_RESULT_LABEL, type ScenarioResult,
} from '../../../platform/media/authority/deviceValidationModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

/** Senaryo sonucu rozet stili — KOŞULMADI nötr kalır, "iyi" görünmez. */
const RESULT_STYLE: Record<ScenarioResult, string> = {
  PASS:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  FAIL:    'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  BLOCKED: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NOT_RUN: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const VERDICT_STYLE: Record<MediaAuthorityVerdict, string> = {
  RENDERING:         'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  REQUESTED_ONLY:    'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  PAUSED_BY_USER:    'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  PAUSED_BY_FOCUS:   'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  IDLE:              'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  DUPLICATE_BACKEND: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNAVAILABLE:       'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`ma-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
        {field.note && (
          <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
        )}
      </div>
      <span
        title={field.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}
      >
        {OBSERVABILITY_LABEL[field.klass]}
      </span>
    </div>
  );
});

export const MediaAuthorityScreen = memo(function MediaAuthorityScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<MediaAuthorityRawSnapshot>(() => readMediaAuthoritySnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readMediaAuthoritySnapshot());
  }, []);

  /* PAKET B: senaryo tablosu — katalog SABİT, sonuçlar okunan kayıttan gelir.
     Hiç kaydı olmayan senaryo KOŞULMADI kalır (varsayılan uydurulmaz). */
  const scenarioRows = useMemo(
    () => DEVICE_SCENARIOS.map((s) => ({
      id: s.id,
      action: s.action,
      result: snap.validationResults[s.id] ?? ('NOT_RUN' as ScenarioResult),
    })),
    [snap.validationResults],
  );

  const cards       = useMemo(() => buildMediaAuthorityCards(snap), [snap]);
  const verdict     = useMemo(() => deriveMediaAuthorityVerdict(snap), [snap]);
  const classCounts = useMemo(() => countByMediaAuthorityClass(cards), [cards]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="media-authority">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Music4 size={12} /> MEDYA OTORİTESİ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — oynatma komutu göndermez
          </span>
          <button
            type="button"
            data-testid="ma-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {classCounts.OBSERVED} · TÜRETİLDİ {classCounts.DERIVED} ·
            KAYNAK YOK {classCounts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Yalnız mevcut senkron getter'lar okunur: çal/duraklat/geç/seek, kaynak değişimi,
          ses veya duck değişimi, kurtarma ve servis başlatma TETİKLENMEZ. Parça başlığı,
          sanatçı, URI ve kapak bu ekrana hiç gelmez. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Hüküm — fail-closed */}
      <div
        data-testid="ma-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        OYNATMA GERÇEĞİ: {MEDIA_AUTHORITY_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          "Komut kabul edildi" ile "ses çıkıyor" AYNI ŞEY DEĞİLDİR. Bu ekran ikisini
          birbirine karıştırmaz: kanıt yoksa YALNIZ İSTEK olarak gösterilir.
        </div>
      </div>

      {/* Kartlar */}
      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`ma-card-${card.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {card.title}
            </span>
            {card.id === 'truth' && snap.evidence.counters.duplicateBackendDetected > 0 && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-danger)]">
                <AlertTriangle size={10} /> SÖZLEŞME İHLALİ
              </span>
            )}
          </div>
          <div>
            {card.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      {/* PAKET B · Cihaz doğrulama senaryo tablosu — SALT OKUNUR.
          Buradan test BAŞLATILMAZ: ekran yalnız hangi senaryonun hangi sonuçla
          kaydedildiğini gösterir. Kayıt, cihazda ölçüm yapan geliştiricinin
          açtığı oturumla oluşur. */}
      <div
        data-testid="ma-scenarios"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            13 · Cihaz Senaryoları
          </span>
          <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
            KOŞULMADI = cihazda hiç denenmedi (sahte yeşil ÜRETİLMEZ)
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {scenarioRows.map((row) => (
            <div
              key={row.id}
              data-testid={`ma-scenario-${row.id}`}
              data-result={row.result}
              className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="font-mono text-[10px] text-[var(--oem-ink)]">{row.id}</div>
                <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
                  {row.action}
                </div>
              </div>
              <span
                className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                  RESULT_STYLE[row.result]
                }`}
              >
                {SCENARIO_RESULT_LABEL[row.result]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Otoritenin kapsamı: yerel müzik (LOCAL), internet akışı (STREAM) ve radyo
        (INTERNET_RADIO) native ExoPlayer'da çalar — ses kanıtı ÜRETİLEBİLİR. YouTube
        IFrame, Spotify Connect ve harici Android MediaSession koordinatör kontrolündedir
        ama ses yolları BİZDE OLMADIĞI için "duyulabilir" doğrulaması YAPILAMAZ; bu
        kaynaklarda sonuç en fazla "istek gönderildi" düzeyindedir ve öyle gösterilir.
      </p>
    </div>
  );
});
