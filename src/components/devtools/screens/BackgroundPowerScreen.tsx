/**
 * BackgroundPowerScreen — CAROS LAB · Çalışma Zamanı · Arka Plan Gücü (kütük #667 borcu).
 *
 * NEDEN VAR: arka plan güç politikası sahada ölçülen 612 mAh/h sızıntıyı kapatmak için
 * yazıldı ama gözlem yüzeyi yoktu — "kısma gerçekten uygulandı mı" sorusunun cihazda
 * yanıtı yoktu. Gözlemlenemeyen özellik tamamlanmış sayılmaz (CLAUDE.md).
 *
 * SALT-OKUNUR. YAPMADIKLARI (pazarlıksız): karar tetikleme (`reevaluateBackgroundPower`
 * ÇAĞRILMAZ) · GPS modu değiştirme · mikrofon açma/kapama · ayar yazma · yeni timer /
 * abonelik / polling / global store.
 *
 * ASIL İŞİ: kapının KARARI ile servislerin GERÇEK hâlini yan yana koymak. Bu depoda
 * tekrar eden kusur "karar üretildi ama uygulanmadı" desenidir; ekran ikisini
 * birleştirmez, çeliştiklerinde ÇELİŞKİ olarak listeler.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, BatteryCharging, AlertTriangle } from 'lucide-react';
import {
  readBackgroundPowerSnapshot,
  type BackgroundPowerRawSnapshot,
} from '../../../platform/devtools/backgroundPowerLabSources';
import {
  buildBgPowerFields, buildBgPowerSections, detectBgPowerMismatches, deriveBgPowerVerdict,
  BG_VERDICT_LABEL,
  type BgPowerVerdict,
} from '../../../platform/devtools/backgroundPowerLabModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const VERDICT_STYLE: Record<BgPowerVerdict, string> = {
  THROTTLED:   'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  FULL_POWER:  'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  IDLE:        'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  NOT_STARTED: 'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  DRIFT:       'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`bgp-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] font-bold text-[var(--oem-ink)]">
            {field.value}
          </span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-3)]">
          {field.source}
          {age ? <> · {age}</> : <> · zaman damgası yok</>}
        </div>
        <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{field.note}</div>
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

export const BackgroundPowerScreen = memo(function BackgroundPowerScreen() {
  // Açılışta TEK okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<BackgroundPowerRawSnapshot>(() => readBackgroundPowerSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak). */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(() => {
    if (mountedRef.current) setSnap(readBackgroundPowerSnapshot());
  }, []);

  const fields     = useMemo(() => buildBgPowerFields(snap), [snap]);
  const mismatches = useMemo(() => detectBgPowerMismatches(snap), [snap]);
  const verdict    = useMemo(() => deriveBgPowerVerdict(snap, mismatches), [snap, mismatches]);

  const sections = useMemo(() => buildBgPowerSections(fields), [fields]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="background-power">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <BatteryCharging size={12} /> ARKA PLAN GÜCÜ
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — karar tetiklemez
          </span>
          <button
            type="button"
            data-testid="bgp-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekran `reevaluateBackgroundPower()` ÇAĞIRMAZ, GPS modunu ve mikrofonu
          DEĞİŞTİRMEZ. Okunamayan alan KAYNAK YOK yazar — `false` ile "okunamadı" ayrıdır.
          Head unit'te (sürekli besleme) kısma beklenmez: karar TAM GÜÇ çıkar.
        </p>
      </div>

      {/* Hüküm */}
      <div
        data-testid="bgp-verdict"
        data-verdict={verdict.status}
        title={verdict.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${VERDICT_STYLE[verdict.status]}`}
      >
        POLİTİKA DURUMU: {BG_VERDICT_LABEL[verdict.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      {/* Çelişkiler — hiçbir taraf kazanmaz */}
      {mismatches.length > 0 && (
        <div
          data-testid="bgp-mismatches"
          className="shrink-0 rounded border border-[var(--oem-danger)] bg-[var(--oem-danger-soft)]"
        >
          <div className="flex items-center gap-1 border-b border-[var(--oem-danger)] px-3 py-1.5 font-mono text-[11px] text-[var(--oem-danger)]">
            <AlertTriangle size={11} /> KARAR ↔ GERÇEK ÇELİŞKİSİ ({mismatches.length})
          </div>
          {mismatches.map((m) => (
            <div key={m.id} data-testid={`bgp-mismatch-${m.id}`} className="border-b border-[var(--oem-line)] px-3 py-1.5 last:border-b-0">
              <div className="font-mono text-[10px] text-[var(--oem-ink)]">{m.topic}</div>
              <div className="mt-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
                {m.aSource} = <b>{m.aValue}</b> · {m.bSource} = <b>{m.bValue}</b>
              </div>
              <div className="mt-0.5 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">{m.note}</div>
            </div>
          ))}
        </div>
      )}

      {sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`bgp-section-${sec.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
            {sec.title}
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        SAHA ÖLÇÜMÜ (2026-08-20, Redmi Note 13 Pro 5G): uygulama arka planda ve araç
        hareketsizken JS konum akışı HIGH_ACCURACY @10 s ile 6 s 16 dk kesintisiz çalıştı
        (86.422 fix) ve pasif mikrofon hiç susmadı (PARTIAL_WAKE_LOCK 'AudioIn') → 16 saatte
        yalnız 169 dk deep sleep, 612 mAh/h. Native `CarLauncherForegroundService` park
        kısmasını zaten doğru yapıyordu; kaçak tamamen JS tarafındaydı. Bu ekran o kaçağın
        geri gelip gelmediğini cihazda GÖZLEMLENEBİLİR kılar — ama ekran açıkken uygulama
        ÖN PLANDADIR: kısma kararı ancak arka planda doğar, bu yüzden burada çoğunlukla
        TAM GÜÇ görürsün. Kısmanın kanıtı `adb shell dumpsys location` çıktısıdır.
      </p>
    </div>
  );
});
