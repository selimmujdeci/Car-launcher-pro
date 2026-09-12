/**
 * SttMicScreen — CAROS LAB · Yapay Zekâ · Mavi STT / Mikrofon (MAVI-STT-LAB-1).
 *
 * SALT-OKUNUR GÖZLEM. Bu ekran hiçbir ses davranışı üretmez:
 * mikrofon BAŞLATMAZ/DURDURMAZ · STT veya wake motorunu açıp kapatmaz ·
 * VAD eşiği DEĞİŞTİRMEZ · AudioSource seçimine DOKUNMAZ · AEC/NS/AGC aç-kapa
 * YAPMAZ · izin İSTEMEZ · ham ses KAYDETMEZ veya DIŞA AKTARMAZ.
 *
 * ZAMANLAYICI: açılışta tek atışlık native pull + elle YENİLE. Otomatik yenileme
 * VARSAYILAN KAPALIDIR; açılırsa en az {@link STT_AUTO_REFRESH_MS} ms aralıkla
 * çalışır ve unmount'ta temizlenir. Ekran kapalıyken (host `{open && <X/>}` ile
 * unmount eder) HİÇBİR polling kalmaz.
 *
 * GİZLİLİK: transcript · n-best · wake sözcüğü · grammar kelimeleri · ham ses
 * örneği · kişi adı · konum · VIN · cihaz kimliği bu ekrana HİÇ GELMEZ.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Mic } from 'lucide-react';
import { readSttMicSnapshot } from '../../../platform/devtools/sttMicSources';
import { refreshVoiceMicDiagnostics } from '../../../platform/voice/voiceMicDiagnosticsProbe';
import {
  buildSttSections, countBySttClass, deriveSttProbeStatus, normalizePath,
  STT_PROBE_STATUS_LABEL, STT_PATH_LABEL,
  type SttMicRaw, type SttProbeStatus,
} from '../../../platform/devtools/sttMicModel';
import {
  formatAge, OBSERVABILITY_LABEL,
  type InspectorField, type Observability,
} from '../../../platform/devtools/sessionInspectorModel';
/* MAVI-STT-LAB-2: elle başlatılan kabin gürültü ölçüm defteri. Kendi koşucusunun
   SAHİBİ o bileşendir (unmount'ta dispose) — bu ekranın timer'ıyla karışmaz. */
import { SttMeasurementSection } from './SttMeasurementSection';

/** Otomatik yenileme aralığı — TABAN sınır (daha sık POLLING YAPILMAZ). */
export const STT_AUTO_REFRESH_MS = 2000;

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const STATUS_STYLE: Record<SttProbeStatus, string> = {
  AVAILABLE:   'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`stt-field-${field.id}`}
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

export const SttMicScreen = memo(function SttMicScreen() {
  // Açılışta senkron okuma (önbellek). TIMER YOK, ABONELİK YOK.
  const [snap, setSnap] = useState<SttMicRaw>(() => readSttMicSnapshot());
  // Otomatik yenileme VARSAYILAN KAPALI (görev kuralı).
  const [autoRefresh, setAutoRefresh] = useState(false);

  /* Unmount sonrası setState YASAK (zero-leak) — native pull geri döndüğünde
     bileşen kapanmış olabilir. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* Native SALT-OKUNUR gözlemi tazele, SONRA senkron oku. Tek atış — polling DEĞİL. */
  const refresh = useCallback(() => {
    void refreshVoiceMicDiagnostics()
      .catch(() => { /* fail-soft: kanıt yok → KANIT YOK */ })
      .finally(() => { if (mountedRef.current) setSnap(readSttMicSnapshot()); });
  }, []);

  // Açılışta bir kez: ilk görüntü de tazelenmiş kanıtla gelsin (tek atış).
  useEffect(() => { refresh(); }, [refresh]);

  /* Otomatik yenileme — YALNIZ açıkken. Kapatınca ve unmount'ta interval temizlenir
     (zero-leak). Aralık sabit tabandan KISALTILAMAZ. */
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, STT_AUTO_REFRESH_MS);
    return () => { clearInterval(id); };
  }, [autoRefresh, refresh]);

  const sections    = useMemo(() => buildSttSections(snap), [snap]);
  const status      = useMemo(() => deriveSttProbeStatus(snap), [snap]);
  const classCounts = useMemo(() => countBySttClass(sections), [sections]);
  const path        = useMemo(() => normalizePath(snap.path), [snap.path]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="stt-mic">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Mic size={12} /> MAVİ STT / MİKROFON
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — mikrofon/eşik/efekt komutu YOK
          </span>
          <button
            type="button"
            data-testid="stt-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <button
            type="button"
            data-testid="stt-auto-toggle"
            data-auto={autoRefresh ? 'on' : 'off'}
            onClick={() => setAutoRefresh((v) => !v)}
            className={`rounded border px-2 py-1 ${
              autoRefresh
                ? 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]'
                : 'border-[var(--oem-line-strong)] text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]'
            }`}
          >
            OTO YENİLE {autoRefresh ? `AÇIK (${STT_AUTO_REFRESH_MS / 1000}sn)` : 'KAPALI'}
          </button>
          <span
            data-testid="stt-status"
            data-status={status}
            className={`rounded border px-1.5 py-0.5 ${STATUS_STYLE[status]}`}
          >
            {STT_PROBE_STATUS_LABEL[status]}
          </span>
          <span data-testid="stt-path" data-path={path} className="text-[var(--oem-ink-2)]">
            {STT_PATH_LABEL[path]}
          </span>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {classCounts.OBSERVED} · TÜRETİLDİ {classCounts.DERIVED} ·
            BAYAT {classCounts.STALE} · KAYNAK YOK {classCounts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekran mikrofon zincirinin NE ÖLÇTÜĞÜNÜ gösterir, davranışı DEĞİŞTİRMEZ.
          Değerler SON yakalama oturumuna aittir (oturum kapandığında silinmez — yoksa
          hiçbir şey gözlemlenemezdi). Aktif dinleme ile wake yolu AYRI ölçülür: aktif
          dinleme gürültü tabanını ÖĞRENİR, wake yolu SABİT eşik kullanır ve efekt
          KURMAZ. Hız ile gürültü aynı okuma turunda örneklenir; aradaki sapma
          "örnekleme sapması" alanında dürüstçe gösterilir — nedensellik ÇIKARILMAZ.
        </p>
      </div>

      {/* Bölümler */}
      {sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`stt-section-${sec.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {sec.title}
            </span>
            {sec.id === 'restrictions' && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-good)]">
                <ShieldCheck size={10} /> STATİK TESTLE KİLİTLİ
              </span>
            )}
            {sec.id === 'vehicle' && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                <AlertTriangle size={10} /> ÖLÇÜM YAN YANA — NEDENSELLİK DEĞİL
              </span>
            )}
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      {/* 7 · Ölçüm defteri — MAVI-STT-LAB-2 */}
      <SttMeasurementSection />

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KANIT SINIRLARI: kaynağın "SİNYAL VAR" olması tanımanın ÇALIŞACAĞINI kanıtlamaz ·
        efektin MEVCUT olması OLUŞTURULDUĞUNU, oluşturulmuş olması ETKİN olduğunu
        kanıtlamaz (üçü ayrı gösterilir) · konuşma algılanması tanıma BAŞARISI değildir ·
        JS'in "wake açık" demesi native motorun çalıştığını kanıtlamaz (iki alan ayrı
        tutulur, çelişebilirler) · klima/fan seviyesi için repoda KAYNAK YOKTUR, saha
        ölçümünde elle not edilmelidir · gürültü tabanı yalnız aktif dinleme yolunda
        öğrenilir. Ham ses örneği hiçbir yerde saklanmaz; RMS değerleri normalize
        skalerdir, sesin kendisi değildir.
      </p>
    </div>
  );
});
