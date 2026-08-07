/**
 * KwpMonitorScreen — CAROS LAB · İletişim · KWP İzleyici (Faz A4).
 *
 * SALT-OKUNUR. Bu ekran KWP oturum yöneticisi, keep-alive motoru ya da kurtarma
 * merdiveni DEĞİLDİR: kurtarma tamamen native `ElmProtocol` içindedir. Burada yalnız
 * mevcut kanıt sayaçları okunur, OBSERVED/DERIVED/UNAVAILABLE/STALE olarak işaretlenir.
 *
 * YAPMADIKLARI (pazarlıksız): bağlantı açma/kapama · reconnect · reset · AT komutu ·
 * ATPC/ATWM gönderme · KWP kurtarma TETİKLEME · poll cadence değiştirme · DTC okuma/silme ·
 * Deep Scan başlatma · native sözleşme genişletme · yeni global store.
 *
 * ZAMANLAYICI YOK: repodaki CAROS LAB sağlık ekranı deseni (Session Inspector ·
 * Runtime Scheduling) periyodik yenileme KULLANMAZ — tek atış senkron okuma + elle
 * YENİLE. Bu ekran o deseni aynen izler; sürekli poll ne bütçeye ne de salt-okunur
 * beyanına uygundur.
 *
 * NATIVE SAYAÇ OKUMASI: `refreshKwpRecoveryEvidence()` tek atış çağrılır (Runtime
 * Scheduling'deki `refreshExtendedPollEvidence()` ile AYNI gerekçe). Çağrılan native
 * metot SALT SAYAÇ döndürür (`getObdKwpRecoveryEvidence`): araca komut GÖNDERMEZ,
 * kurtarma/poll/handshake TETİKLEMEZ. Çağrılmazsa kanıt önbelleği yalnız "Tanı Gönder"
 * yolundan dolduğu için ekran cihazda kurtarma çalışırken bile KÖR kalırdı.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { readKwpRawSnapshot } from '../../../platform/devtools/kwpMonitorSources';
import { refreshKwpRecoveryEvidence } from '../../../platform/obd/kwpRecoveryEvidence';
import {
  buildKwpSections, deriveKwpActivity, countByKwpClass,
  KWP_ACTIVITY_LABEL, KWP_RECOVERY_STATUS_LABEL,
  type KwpActivity, type KwpRawSnapshot,
} from '../../../platform/devtools/kwpMonitorModel';
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

const ACTIVITY_STYLE: Record<KwpActivity, string> = {
  HEALTHY:        'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  RECOVERING:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  DEGRADED:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NOT_APPLICABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
  UNKNOWN:        'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const FieldRow = memo(function FieldRow({ field, nowMs }: { field: InspectorField; nowMs: number }) {
  const age = formatAge(field.updatedAt, nowMs);
  // Ham kurtarma enum'u makine sözleşmesidir; ekranda Türkçe etiketi görünür.
  const shown = KWP_RECOVERY_STATUS_LABEL[field.value] ?? field.value;
  return (
    <div
      data-testid={`kwp-field-${field.id}`}
      data-class={field.klass}
      className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] px-2 py-1.5 last:border-b-0"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] text-[var(--oem-ink-2)]">{field.label}</span>
          <span className="break-all font-mono text-[11px] text-[var(--oem-ink)]">{shown}</span>
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

export const KwpMonitorScreen = memo(function KwpMonitorScreen() {
  // Tek seferlik senkron okuma. TIMER YOK, ABONELİK YOK, POLLING YOK.
  const [snap, setSnap] = useState<KwpRawSnapshot>(() => readKwpRawSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak) — async kanıt tazelemesi geri
     döndüğünde bileşen kapanmış olabilir. Tek ref, ek timer yok. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* Native sayaç önbelleğini tazele, SONRA senkron oku. Sıra önemli: tazeleme
     beklenmezse ekran yine boş önbelleği okur (körlüğün ta kendisi). */
  const refresh = useCallback(() => {
    void refreshKwpRecoveryEvidence()
      .catch(() => { /* fail-soft: kanıt yok → UNAVAILABLE */ })
      .finally(() => { if (mountedRef.current) setSnap(readKwpRawSnapshot()); });
  }, []);

  // Açılışta bir kez: ilk görüntü de tazelenmiş kanıtla gelsin (tek atış, polling YOK).
  useEffect(() => { refresh(); }, [refresh]);

  const sections    = useMemo(() => buildKwpSections(snap), [snap]);
  const activity    = useMemo(() => deriveKwpActivity(snap), [snap]);
  const classCounts = useMemo(() => countByKwpClass(sections), [sections]);

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="kwp-monitor">
      {/* Salt-okunur beyanı */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="text-[11px] font-bold tracking-wide text-[var(--oem-info)]">KWP İZLEYİCİ</span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — oturuma, ECU'ya veya kurtarmaya dokunmaz
          </span>
          <button
            type="button"
            data-testid="kwp-refresh"
            onClick={refresh}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <RefreshCw size={11} /> YENİLE
          </button>
          <span className="text-[var(--oem-ink-3)]">
            ÖLÇÜLDÜ {classCounts.OBSERVED} · TÜRETİLDİ {classCounts.DERIVED} ·
            BAYAT {classCounts.STALE} · KAYNAK YOK {classCounts.UNAVAILABLE}
          </span>
        </div>
        <p className="mt-1 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          KWP kurtarma merdiveni (ATPC) NATIVE tarafta çalışır; bu ekran onu yalnız İZLER —
          tetiklemez, durdurmaz, ayarını değiştirmez. YENİLE, salt-okunur native SAYAÇ
          kanıtını tazeler ve yan etkisiz senkron getter'ları yineler: araca komut göndermez.
          Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* Genel hüküm — fail-closed */}
      <div
        data-testid="kwp-activity"
        data-activity={activity.status}
        title={activity.status}
        className={`shrink-0 rounded border px-3 py-2 font-mono text-[11px] ${ACTIVITY_STYLE[activity.status]}`}
      >
        KWP DURUMU: {KWP_ACTIVITY_LABEL[activity.status]}
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] leading-relaxed opacity-80">
          {activity.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <div className="mt-1 text-[9px] opacity-50">
          Kanıt yokluğu "sorun yok" DEĞİLDİR: kaynak okunamadıysa hüküm BİLİNMİYOR kalır,
          sağlıklı VARSAYILMAZ. CAN araçlarda bu ekranın boş olması doğrudur.
        </div>
      </div>

      {/* Bölümler */}
      {sections.map((sec) => (
        <div
          key={sec.id}
          data-testid={`kwp-section-${sec.id}`}
          className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
              {sec.title}
            </span>
            {sec.id === 'keepalive' && (
              <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
                <AlertTriangle size={10} /> GÖZLEM KANALI YOK
              </span>
            )}
          </div>
          <div>
            {sec.fields.map((f) => <FieldRow key={f.id} field={f} nowMs={snap.readAt} />)}
          </div>
        </div>
      ))}

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        ATWM / ATSW / ATST değerleri yalnız native ElmInitSequencer içinde uygulanır ve JS'e
        raporlanmaz; bu yüzden "KAYNAK YOK" gösterilir. Native kaynak koddaki sabitleri buraya
        yazmak, ölçülmemiş bir değeri ölçülmüş gibi göstermek olurdu. Kurtarma merdiveninin
        GERÇEKTEN işe yarayıp yaramadığının tek ölçüsü "ATPC → ilk geçerli PID" süresidir.
      </p>
    </div>
  );
});
