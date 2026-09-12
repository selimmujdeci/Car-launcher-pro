/**
 * RuntimeSchedulingScreen — CAROS LAB · Runtime · RUNTIME SCHEDULING (Faz A4).
 *
 * Queue Monitor ve Poll Scheduler için ORTAK, SALT-OKUNUR görünüm.
 *
 * YENİ scheduler · queue · polling motoru · runtime otoritesi OLUŞTURMAZ.
 * "Global queue/scheduler" varmış gibi davranmaz: her gerçek otorite AYRI kanaldır.
 *
 * YAPMADIKLARI: queue temizleme/pause/resume · poll hızı değiştirme · komut önceliği ·
 * reconnect · recovery tetikleme · keep-alive gönderme · AT komutu · PID/DID sorgusu ·
 * Deep Scan başlatma · CAN capture başlatma · ECU write · DTC clear.
 *
 * NATIVE SAYAÇ OKUMASI (saha 2026-07-25): `refreshExtendedPollEvidence()` bu ekranda
 * ÇAĞRILIR. Önceki tur bunu bilerek atlıyordu ("native pull yok") ama sonuç KÖRLÜK oldu:
 * kanıt önbelleğini yalnız tanı raporu yolu dolduruyordu, dolayısıyla LAB'da alan HER ZAMAN
 * "Kanıt mevcut değil (eski APK / poll başlamadı)" görünüyordu — cihazda poll çalışırken bile.
 * Çağrılan native metot SALT SAYAÇ döndürür (`CarLauncherPlugin.getObdExtendedPollEvidence`):
 * araca komut GÖNDERMEZ, poll/handshake TETİKLEMEZ → "araç iletişimini değiştirmez" beyanı
 * ihlal edilmez. Fail-soft: hata/eski APK → önbellek boş kalır, ekran UNAVAILABLE gösterir.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { readSchedRawSnapshot } from '../../../platform/devtools/runtimeSchedulingSources';
import { refreshExtendedPollEvidence } from '../../../platform/obd/extendedPollEvidence';
import { refreshExtendedElimination } from '../../../platform/obd/extendedElimination';
import {
  buildSchedChannels, buildSchedConflictInput, buildRuntimeSummaryInput,
  type SchedRawSnapshot,
} from '../../../platform/devtools/runtimeSchedulingBuild';
import {
  detectSchedConflicts, deriveRuntimeSummary, summarizeChannels,
  countBySchedClass, schedFormatAge, orderChannelsForFocus, resolveFocusChannel,
  SCHED_OBSERVABILITY_LABEL, CHANNEL_ACTIVITY_LABEL, RUNTIME_SUMMARY_LABEL,
  SCHED_FOCUS_LABEL, SCHED_CHANNEL_TITLE,
  type SchedField, type SchedObservability, type ChannelActivity, type RuntimeSummary,
  type SchedFocusContext,
} from '../../../platform/devtools/runtimeSchedulingModel';

const CLASS_STYLE: Record<SchedObservability, string> = {
  OBSERVED:          'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:           'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE:       'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:             'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  /* UNSAFE_TO_OBSERVE: gündüz modunda ayırt edilebilir bir mor token YOK; anlamı
     "okumak güvenli değil" olduğu için danger tonu kullanılır (etiket metni ayırır). */
  UNSAFE_TO_OBSERVE: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const ACTIVITY_STYLE: Record<ChannelActivity, string> = {
  RUNNING:     'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  NOT_RUNNING: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  BLOCKED:     'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNKNOWN:     'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const SUMMARY_STYLE: Record<RuntimeSummary, string> = {
  ACTIVE:  'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  PARTIAL: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  IDLE:    'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  BLOCKED: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNKNOWN: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: SchedField; nowMs: number }) {
  const age = schedFormatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`sched-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{field.value}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}{age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
        {field.note && <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>}
      </div>
      <span
        title={field.klass}
        className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[field.klass]}`}
      >
        {SCHED_OBSERVABILITY_LABEL[field.klass]}
      </span>
    </div>
  );
});

export interface RuntimeSchedulingScreenProps {
  /**
   * Ortak ekranı AÇAN katalog girişi (UX-F1). Yalnız BAŞLANGIÇ SIRASINI değiştirir:
   * kanal gizlemez, veri/hüküm/aktivite kuralına DOKUNMAZ. Verilmezse varsayılan
   * sıra korunur (geriye uyumluluk).
   */
  readonly focus?: SchedFocusContext;
}

export const RuntimeSchedulingScreen = memo(function RuntimeSchedulingScreen(
  { focus }: RuntimeSchedulingScreenProps,
) {
  // Tek seferlik senkron okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<SchedRawSnapshot>(() => readSchedRawSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak) — async kanıt tazelemesi geri döndüğünde
     bileşen kapanmış olabilir. Tek ref, ek timer yok. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* Native sayaç önbelleğini tazele, SONRA senkron oku. Sıra önemli: tazeleme
     beklenmezse ekran yine boş önbelleği okur (körlüğün ta kendisi). */
  const refresh = useCallback(() => {
    /* #524: eleme durumu da AYNI turda tazelenir — ikisi ayrı anda okunursa
       "kaç PID elendi" ile "kaç PID izleniyor" farklı anlardan gelir. */
    void Promise.all([
      refreshExtendedPollEvidence().catch(() => { /* fail-soft */ }),
      refreshExtendedElimination().catch(() => { /* fail-soft */ }),
    ]).finally(() => { if (mountedRef.current) setSnap(readSchedRawSnapshot()); });
  }, []);

  // Açılışta bir kez: ilk görüntü de tazelenmiş kanıtla gelsin (tek atış, polling YOK).
  useEffect(() => { refresh(); }, [refresh]);

  const allChannels = useMemo(() => buildSchedChannels(snap), [snap]);

  /* SAF sıralama — imperative scroll / DOM erişimi / gecikme YOK. Sayımlar ve hüküm
     sıradan BAĞIMSIZ olduğu için özet aynı kalır (yalnız gösterim sırası değişir). */
  const focusChannelId = resolveFocusChannel(focus);
  const channels  = useMemo(() => orderChannelsForFocus(allChannels, focus), [allChannels, focus]);

  const conflicts = useMemo(() => detectSchedConflicts(buildSchedConflictInput(snap)), [snap]);
  const counts    = useMemo(() => summarizeChannels(channels), [channels]);
  const summary   = useMemo(
    () => deriveRuntimeSummary(buildRuntimeSummaryInput(channels, conflicts.length, counts)),
    [channels, conflicts.length, counts],
  );
  const classCounts = useMemo(() => countBySchedClass(channels), [channels]);

  return (
    <div
      className="flex h-full flex-col gap-2 overflow-y-auto"
      data-testid="runtime-scheduling"
      data-focus={focus ?? 'none'}
      data-focus-channel={focusChannelId ?? 'none'}
    >
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="text-[11px] font-bold tracking-wide text-[var(--oem-info)]">ÇALIŞMA ZAMANI ZAMANLAMA</span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — araç iletişimini değiştirmez
          </span>
          <button
            type="button"
            data-testid="sched-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {classCounts.OBSERVED} · TÜRETİLDİ {classCounts.DERIVED} · BAYAT {classCounts.STALE} ·
            KAYNAK YOK {classCounts.UNAVAILABLE} · RİSKLİ {classCounts.UNSAFE_TO_OBSERVE}
          </span>
          {focus && focusChannelId && (
            <span
              data-testid="sched-focus"
              data-focus-entry={focus}
              className="rounded border border-[var(--oem-info)] bg-[var(--oem-info-soft)] px-1.5 py-0.5 text-[var(--oem-info)]"
            >
              GİRİŞ: {SCHED_FOCUS_LABEL[focus]} · birincil odak: {SCHED_CHANNEL_TITLE[focusChannelId]}
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Tek bir "genel kuyruk / zamanlayıcı" YOKTUR — aşağıdaki her kart AYRI bir çalışma
          zamanı otoritesidir ve birleştirilmez. YENİLE, native SAYAÇ kanıtını tazeler ve
          yan etkisiz senkron getter'ları yineler: araca sorgu göndermez, kuyruk boşaltmaz,
          handshake veya Derin Tarama tetiklemez. Kuyruk derinliği bilinmiyorsa 0 GÖSTERİLMEZ.
          {focus && focusChannelId && (
            <> Bu giriş yalnız SIRALAMAYI değiştirir: hiçbir kanal gizlenmez, hiçbir değer,
            aktivite kararı veya hüküm giriş'e göre farklılaşmaz.</>
          )}
        </p>
      </div>

      {/* Fail-closed runtime özeti */}
      <div
        data-testid="runtime-summary"
        data-summary={summary.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${SUMMARY_STYLE[summary.status]}`}
      >
        ÇALIŞMA ZAMANI: {RUNTIME_SUMMARY_LABEL[summary.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {summary.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Bu bir araç bağlantısı durumu DEĞİL, çalışma zamanı zamanlama durumudur. "Zamanlayıcı
          var" tek başına ETKİN kanıtı sayılmaz; kuyruk bilinmediği için BOŞTA varsayılmaz.
        </div>
      </div>

      {/* Çelişkiler */}
      {conflicts.length > 0 && (
        <div data-testid="sched-conflicts" className="shrink-0 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-3 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--oem-warn)]">
            <AlertTriangle size={12} /> ÇELİŞKİ ({conflicts.length})
          </div>
          {conflicts.map((c) => (
            <div key={c.id} data-testid={`sched-conflict-${c.id}`} className="mt-2 border-t border-[var(--oem-line)] pt-1.5">
              <div className="font-mono text-[10px] text-[var(--oem-warn)]">{c.topic}</div>
              <div className="mt-0.5 font-mono text-[10px] text-[var(--oem-ink-2)]">
                <div>A · {c.aSource} = <span className="text-[var(--oem-ink)]">{c.aValue}</span></div>
                <div>B · {c.bSource} = <span className="text-[var(--oem-ink)]">{c.bValue}</span></div>
              </div>
              <div className="mt-0.5 text-[9px] text-[var(--oem-ink-3)]">{c.note}</div>
            </div>
          ))}
        </div>
      )}

      {/* Kanallar */}
      {channels.map((ch) => (
        <div
          key={ch.id}
          data-testid={`sched-channel-${ch.id}`}
          data-primary={ch.id === focusChannelId ? 'true' : 'false'}
          className={`shrink-0 rounded border bg-[var(--oem-surface-1)] ${
            ch.id === focusChannelId
              ? 'border-[var(--oem-info)]'
              : 'border-[var(--oem-line)]'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">{ch.title}</span>
            {ch.id === focusChannelId && (
              <span
                data-testid={`sched-primary-${ch.id}`}
                className="rounded border border-[var(--oem-info)] bg-[var(--oem-info-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-info)]"
              >
                BİRİNCİL ODAK
              </span>
            )}
            <span
              data-testid={`sched-activity-${ch.id}`}
              data-activity={ch.activity}
              title={ch.activity}
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${ACTIVITY_STYLE[ch.activity]}`}
            >
              {CHANNEL_ACTIVITY_LABEL[ch.activity]}
            </span>
            <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">otorite: {ch.authority}</span>
          </div>
          <div className="border-b border-[var(--oem-line)] px-3 py-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
            {ch.activityNote}
          </div>
          <div>
            {ch.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        Komut kuyruğu derinliği ve anlık aktif iş native tarafta olduğu için okunamıyor;
        bu alanlar "KAYNAK YOK"tur ve boş kuyruk VARSAYILMAZ. Kurtarma İzleyici ve Adaptör
        Tanılama ayrı ekranlardır, bu turda yapılmamıştır.
      </p>
    </div>
  );
});
