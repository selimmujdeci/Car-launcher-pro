/**
 * PhoneHubProbeScreen — CAROS LAB · İletişim · Phone Hub Hardware Probe (P0.5).
 *
 * SALT-OKUNUR DONANIM GÖZLEMİ. Bu ekran hiçbir kullanıcı davranışı üretmez:
 * Bluetooth keşfi/taraması BAŞLATMAZ · eşleştirme YAPMAZ · soket/GATT AÇMAZ ·
 * adapter aç-kapat YAPMAZ · SCO BAŞLATMAZ · ses yolunu DEĞİŞTİRMEZ · medya tuşu
 * GÖNDERMEZ · çağrı BAŞLATMAZ · izin İSTEMEZ · vendor servisine BIND OLMAZ ·
 * OBD davranışına DOKUNMAZ.
 *
 * ZAMANLAYICI YOK: açılışta tek atışlık native pull + elle YENİLE (CAROS LAB deseni,
 * Runtime Scheduling ekranıyla aynı).
 *
 * GİZLİLİK: MAC · cihaz adı · telefon modeli · kişi adı · numara · medya başlığı ·
 * bildirim içeriği · dosya yolu · token · pairing key bu ekrana HİÇ GELMEZ.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, Smartphone } from 'lucide-react';
import { readPhoneHubProbeSnapshot } from '../../../platform/devtools/phoneHubProbeSources';
import { refreshPhoneHubProbe } from '../../../platform/phoneHub/phoneHubHardwareProbe';
import {
  buildPhSections, assessPhCollision, countByPhClass, deriveProbeStatus,
  COLLISION_LABEL, COLLISION_REASON_LABEL, PROBE_STATUS_LABEL,
  type PhoneHubProbeRaw, type CollisionLevel, type ProbeStatus,
} from '../../../platform/devtools/phoneHubProbeModel';
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

const COLLISION_STYLE: Record<CollisionLevel, string> = {
  NONE_OBSERVED: 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  POSSIBLE:      'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  HIGH:          'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNKNOWN:       'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const STATUS_STYLE: Record<ProbeStatus, string> = {
  AVAILABLE:   'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  return (
    <div
      data-testid={`ph-field-${field.id}`}
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

export const PhoneHubProbeScreen = memo(function PhoneHubProbeScreen() {
  // Açılışta senkron okuma (önbellek). TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<PhoneHubProbeRaw>(() => readPhoneHubProbeSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak) — native pull geri döndüğünde
     bileşen kapanmış olabilir. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* Native SALT-OKUNUR gözlemi tazele, SONRA senkron oku. Tek atış — polling DEĞİL. */
  const refresh = useCallback(() => {
    void refreshPhoneHubProbe()
      .catch(() => { /* fail-soft: kanıt yok → UNAVAILABLE */ })
      .finally(() => { if (mountedRef.current) setSnap(readPhoneHubProbeSnapshot()); });
  }, []);

  // Açılışta bir kez: ilk görüntü de tazelenmiş kanıtla gelsin (tek atış, polling YOK).
  useEffect(() => { refresh(); }, [refresh]);

  const sections    = useMemo(() => buildPhSections(snap), [snap]);
  const collision   = useMemo(() => assessPhCollision(snap), [snap]);
  const status      = useMemo(() => deriveProbeStatus(snap), [snap]);
  const classCounts = useMemo(() => countByPhClass(sections), [sections]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="phone-hub-probe">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Smartphone size={12} /> PHONE HUB HARDWARE PROBE
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — eşleştirme/tarama/komut YOK
          </span>
          <button
            type="button"
            data-testid="ph-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span
            data-testid="ph-status"
            data-status={status}
            className={`rounded border px-1.5 py-0.5 ${STATUS_STYLE[status]}`}
          >
            {PROBE_STATUS_LABEL[status]}
          </span>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {classCounts.OBSERVED} · TÜRETİLDİ {classCounts.DERIVED} ·
            BAYAT {classCounts.STALE} · KAYNAK YOK {classCounts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu ekran head unit'in NEYİ GÖRDÜĞÜNÜ ölçer, yetenek EKLEMEZ. "Bağlı görünmek"
          yetenek kanıtı DEĞİLDİR: A2DP/HFP bağlı olsa bile ses/çağrı yolunu vendor veya
          MCU yığını sürüyor olabilir. "Destekleniyor" ifadesi YALNIZ cihazdan gözlenmiş
          kanıt + uygulama otoritesi birlikteyken kullanılır. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* 7 · Çakışma değerlendirmesi */}
      <div
        data-testid="ph-collision"
        data-level={collision.level}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${COLLISION_STYLE[collision.level]}`}
      >
        ÇAKIŞMA RİSKİ: {COLLISION_LABEL[collision.level]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {collision.reasons.map((r) => (
            <li key={r} data-testid={`ph-reason-${r}`}>{COLLISION_REASON_LABEL[r] ?? r}</li>
          ))}
          {collision.reasons.length === 0 && <li>Gözlenen bir çakışma göstergesi yok.</li>}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Bu bir TÜRETİMDİR (DERIVED), ölçüm değil. OBD ile telefonun aynı anda sorunsuz
          çalıştığı ancak GERÇEK ARAÇTA gözlemlenerek doğrulanabilir.
        </div>
      </div>

      {/* Bölümler */}
      {sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`ph-section-${sec.id}`}
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
            {sec.id === 'vendor' && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                <AlertTriangle size={10} /> PAKET VARLIĞI ≠ API KULLANILABİLİR
              </span>
            )}
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KANIT SINIRLARI: eşleşmiş cihaz bulunması AKTİF BAĞLANTI değildir · üretici paketi
        bulunması vendor API'nin KULLANILABİLİR olduğunu kanıtlamaz · izin varlığı runtime
        yeteneği kanıtlamaz · MediaSession varlığı UZAK telefon oturumuna erişim demek
        değildir. GATT için adapter seviyesinde güvenilir salt-okunur durum API'si YOKTUR →
        tahmin edilmez. Üretici yayını gözlemi için depoda sayaç/damga altyapısı YOKTUR →
        "gözlendi" denmez. Cihaz adı, MAC ve diğer kişisel veriler bu ekrana HİÇ GELMEZ.
      </p>
    </div>
  );
});
