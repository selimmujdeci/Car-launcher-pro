'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { sendCommand, subscribeCommandStatus } from '@/lib/commandService';
import { describeDtcOutcome, type DtcCode, type DtcOutcome } from '@/lib/diagnostics/dtcResultContract';
import { judge, BATTERY_RULE, type Verdict } from '@/lib/console/evidenceModel';
import {
  readDtcOutcome,
  readDtcOutcomeForType,
  readVoltageOutcome,
} from '@/lib/diagnostics/dtcResultReader';

interface Props { vehicle: LiveVehicle | null }

// ── Türkçe DTC kod sistemi arayüzü ───────────────────────────────────────────

const DTC_SYSTEM_COLORS: Record<string, string> = {
  'Yakıt':      'var(--md-warning)',
  'Egzoz':      '#f97316',
  'Elektrik':   'var(--md-error)',
  'İgnisyon':   '#a78bfa',
  'Emisyon':    '#60a5fa',
  'Şanzıman':   '#34d399',
  'ABS/Fren':   '#fb923c',
  'Bilinmeyen': '#6b7280',
};

const SEV_CONFIG = {
  critical: { label: 'KRİTİK',  color: 'var(--md-error)',   bg: 'var(--md-error-container)',   border: 'transparent' },
  warning:  { label: 'UYARI',   color: 'var(--md-warning)', bg: 'var(--md-warning-container)', border: 'transparent' },
  info:     { label: 'BİLGİ',   color: 'var(--md-primary)', bg: 'var(--md-primary-container)', border: 'transparent' },
};

/** Rol rengini saydamlaştırır — hex'e alfa eklemek `var(--md-*)` ile çalışmaz. */
function mix(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// ── Battery voltage gauge ─────────────────────────────────────────────────────

/* ── F2.2 · TEK AKÜ EŞİĞİ ──────────────────────────────────────────────────
   ÖLÇÜLEN ÇELİŞKİ: bu gösterge kendi eşiklerini taşıyordu (11.5 / 12.0),
   sağlık hükmü ise kanonik `BATTERY_RULE`u (11.8 / 12.2). 12.1 V'ta aynı
   ekranda gösterge "Normal" derken sağlık kartı "kontrol edilmeli" diyebilirdi.
   Alarm sınırları artık TEK otoriteden gelir; 12.7/13.5 üstü etiketler ise
   eşik değil, şarj durumunu anlatan betimlemedir. */
function voltageVerdict(v: number): Verdict {
  return judge(
    { value: v, state: 'LIVE', observedAt: null, ageMs: null, source: 'HEAD_UNIT_OBD' },
    BATTERY_RULE,
  ).verdict;
}

function voltageColor(v: number): string {
  const verdict = voltageVerdict(v);
  if (verdict === 'CRITICAL') return 'var(--md-error)';
  if (verdict === 'WARNING')  return 'var(--md-warning)';
  return v < 12.7 ? 'var(--md-success)' : 'var(--md-primary)';
}

function voltageLabel(v: number): string {
  const verdict = voltageVerdict(v);
  if (verdict === 'CRITICAL') return 'Kritik — Araç Çalışmayabilir';
  if (verdict === 'WARNING')  return 'Düşük — Şarj Önerili';
  if (v < 12.7)  return 'Normal';
  if (v < 13.5)  return 'Şarj Edilmiş';
  return 'Motor Çalışıyor (Alternatör)';
}

function voltagePct(v: number): number {
  // 10V = 0%, 15V = 100%
  return Math.max(0, Math.min(100, ((v - 10) / 5) * 100));
}

const BatteryGauge = memo(function BatteryGauge({
  voltage,
  loading,
  errorMsg,
  onRefresh,
}: {
  voltage: number | undefined;
  loading: boolean;
  /** Aracın bildirdiği GERÇEK ölçüm gerekçesi — yoksa genel mesaj gösterilir. */
  errorMsg?: string;
  onRefresh: () => void;
}) {
  const v     = voltage ?? 0;
  const color = voltage != null ? voltageColor(v) : 'var(--md-outline)';
  const pct   = voltage != null ? voltagePct(v)   : 0;

  return (
    <div className="flex flex-col gap-3 px-4 py-4 rounded-2xl"
      style={{ background: 'var(--md-surface-container-low)', border: '1px solid var(--md-outline-variant)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `${mix(color, 9)}`, border: `1px solid ${mix(color, 19)}` }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="3" width="11" height="8" rx="1.5" stroke={color} strokeWidth="1.3"/>
              <path d="M12 5.5v3" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M4.5 7h5M7 4.5v5" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-xs font-semibold" style={{ color: 'var(--md-on-surface-variant)' }}>
            Akü Voltajı
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all active:scale-95 disabled:opacity-40"
          style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)', color: 'var(--md-on-surface-variant)' }}
        >
          {loading ? (
            <svg className="animate-spin w-3 h-3" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="18" strokeDashoffset="6" opacity="0.4"/>
              <path d="M6 1.5a4.5 4.5 0 014.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M8.5 5A3.5 3.5 0 112.2 2.8M1.5 1v2.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {loading ? 'Ölçülüyor' : 'OBD Oku'}
        </button>
      </div>

      {voltage != null ? (
        <>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-semibold tabular-nums leading-none" style={{ color }}>
              {v.toFixed(1)}
            </span>
            <span className="text-lg font-mono mb-1" style={{ color: `${mix(color, 44)}` }}>V</span>
            <span className="ml-auto text-xs font-semibold pb-1" style={{ color: `${mix(color, 56)}` }}>
              {voltageLabel(v)}
            </span>
          </div>

          {/* Bar */}
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--md-surface-container-high)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${mix(color, 50)}, ${color})` }}
            />
          </div>

          {/* Scale ticks */}
          <div className="flex justify-between text-[11px] font-mono" style={{ color: 'var(--md-on-surface-variant)' }}>
            <span>10V</span><span>11V</span><span>12V</span><span>13V</span><span>14V</span><span>15V</span>
          </div>

          {/* Alert banner */}
          {voltageVerdict(v) !== 'VERIFIED' && (() => {
            const critical = voltageVerdict(v) === 'CRITICAL';
            return (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{
                  background: critical ? 'color-mix(in srgb, var(--md-error) 8%, transparent)' : 'color-mix(in srgb, var(--md-warning) 8%, transparent)',
                  border: `1px solid ${critical ? 'color-mix(in srgb, var(--md-error) 30%, transparent)' : 'color-mix(in srgb, var(--md-warning) 30%, transparent)'}`,
                }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1L13 12H1L7 1Z" stroke={critical ? 'var(--md-error)' : 'var(--md-warning)'} strokeWidth="1.3" strokeLinejoin="round"/>
                  <path d="M7 5.5v3M7 10v.5" stroke={critical ? 'var(--md-error)' : 'var(--md-warning)'} strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <p className="text-xs font-semibold" style={{ color: critical ? 'var(--md-error)' : 'var(--md-warning)' }}>
                  {critical
                    ? 'Akü kritik seviyede! Aracı çalıştırın veya acil şarj edin.'
                    : 'Akü düşük. En yakın fırsatta şarj edin.'}
                </p>
              </div>
            );
          })()}
        </>
      ) : (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-center"
          style={{ color: errorMsg ? 'var(--md-error)' : 'var(--md-on-surface-variant)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="4 2"/>
          </svg>
          {/* Ölçüm yoksa SAYI UYDURULMAZ; araç gerekçe bildirdiyse o gösterilir. */}
          {errorMsg || 'OBD bağlantısı için araç motorunu çalıştırın'}
        </div>
      )}
    </div>
  );
});

// ── DTC code card ─────────────────────────────────────────────────────────────

const DtcCard = memo(function DtcCard({ dtc }: { dtc: DtcCode }) {
  const sev  = SEV_CONFIG[dtc.severity];
  const sysColor = DTC_SYSTEM_COLORS[dtc.system] ?? DTC_SYSTEM_COLORS['Bilinmeyen'];

  return (
    <div className="flex items-start gap-3 px-3 py-3 rounded-xl"
      style={{ background: sev.bg, border: `1px solid ${sev.border}` }}>
      <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
        <span className="font-mono font-semibold text-xs tracking-widest leading-none" style={{ color: sev.color }}>
          {dtc.code}
        </span>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
          style={{ background: `${mix(sev.color, 13)}`, color: sev.color }}>
          {sev.label}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold md-on-surface leading-snug">{dtc.desc}</p>
        <span className="inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-md"
          style={{ background: `${mix(sysColor, 14)}`, color: 'var(--md-on-surface-variant)', border: `1px solid ${mix(sysColor, 30)}` }}>
          {dtc.system}
        </span>
      </div>
    </div>
  );
});

// ── DTC Reader ─────────────────────────────────────────────────────────────────

type DtcPhase = 'idle' | 'sending' | 'waiting' | 'done' | 'error' | 'clearing';

/* ── F2.2 · TOMBSTONE BAĞIMLILIĞI KALDIRILDI ───────────────────────────────
   Buradaki `fetchDiagResult`, `/api/pwa/dtc-result` uçuna (410) gidiyordu ve
   ÜÇ akışın da (DTC · voltaj · silme doğrulaması) tek ortak kusuruydu. Üçü de
   artık kanonik RLS yolunu kullanır: `dtcResultReader` + `dtcResultContract`.

   Beraberinde ölü `demo-cmd-` dalları da düştü: repoda hiçbir yer bu ön eke
   sahip bir `commandId` ÜRETMİYORDU (`sendCommand` dâhil), yani dal
   production'dan erişilemezdi ve yalnız kapalı uca bağımlılığı ayakta
   tutuyordu. Demo verisi yüzeyi (`demo` bayrağı) korunur — araçtan gelmeyen
   sonucun etiketlenmesi hâlâ gereklidir. */

function useDtcReader(vehicleId: string | null) {
  const [phase,   setPhase]   = useState<DtcPhase>('idle');
  const [dtcs,    setDtcs]    = useState<DtcCode[]>([]);
  const [readAt,  setReadAt]  = useState<string>('');
  const [errMsg,  setErrMsg]  = useState('');
  /** true → tarama KISMİ; boş liste "arıza yok" diye sunulamaz (fail-closed). */
  const [partial, setPartial] = useState(false);
  /** true → sonuç gerçek araçtan değil, demo verisinden geldi. */
  const [demo,    setDemo]    = useState(false);
  const mounted               = useRef(true);
  const unsubRef              = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      unsubRef.current?.();
    };
  }, []);

  /**
   * Kanonik sonucu ekrana bağlar.
   *
   * `done` fazına YALNIZ gerçek bir ölçüm (RESULT/NO_DTC) geçebilir; diğer
   * her durum gerekçesiyle `error`dır. Böylece zaman aşımı, çevrimdışı,
   * desteklenmeyen ve bozuk gövde hiçbir zaman "Arıza Kodu Yok" olarak
   * sunulmaz.
   */
  const applyOutcome = useCallback((outcome: DtcOutcome) => {
    if (outcome.kind === 'RESULT' || outcome.kind === 'NO_DTC') {
      setDtcs(outcome.kind === 'RESULT' ? outcome.dtcs : []);
      setReadAt(outcome.readAt ?? '');
      setPartial(outcome.partial);
      setDemo(false);
      setErrMsg('');
      setPhase('done');
      return;
    }
    if (outcome.kind === 'WAITING_FOR_VEHICLE' || outcome.kind === 'READING') {
      setPhase('waiting');
      return;
    }
    setErrMsg(describeDtcOutcome(outcome));
    setPhase('error');
  }, []);

  const readDtc = useCallback(async () => {
    if (!vehicleId || phase === 'sending' || phase === 'waiting') return;
    setPhase('sending');
    setErrMsg('');

    const result = await sendCommand(vehicleId, 'read_dtc', {});
    if (!mounted.current) return;

    if (!result.ok) {
      setPhase('error');
      setErrMsg(result.error ?? 'Komut gönderilemedi.');
      return;
    }

    setPhase('waiting');

    unsubRef.current?.();
    const unsub = subscribeCommandStatus(result.commandId!, async (ev) => {
      if (!mounted.current) return;
      /* ── F2.1 · SONUÇ ARAÇTAN OKUNUR ────────────────────────────────
         Eski yol `/api/pwa/dtc-result` idi ve o uç bilinçli 410
         tombstone'du: zincirin kopuk halkası buydu. Artık satır RLS ile
         okunur ("commands: okuyabilir") ve KANONİK sözleşme yorumlar.
         `completed` gelmesi ölçüm başarısı DEĞİLDİR (F0 invariantı) —
         gövde yoksa `FAILED` üretilir, "arıza yok" DENMEZ. */
      if (['completed', 'failed', 'expired', 'rejected'].includes(ev.status)) {
        const outcome = await readDtcOutcome(result.commandId!, vehicleId);
        if (!mounted.current) return;
        applyOutcome(outcome);
      }
    });
    unsubRef.current = unsub;
  }, [vehicleId, phase, applyOutcome]);

  const clearDtc = useCallback(async () => {
    if (!vehicleId || phase === 'clearing') return;
    setPhase('clearing');
    setErrMsg('');

    const result = await sendCommand(vehicleId, 'clear_dtc', {});
    if (!mounted.current) return;

    if (!result.ok) {
      setPhase('done');
      setErrMsg(result.error ?? 'Temizleme komutu gönderilemedi.');
      return;
    }

    /* ÖNCEDEN: komut gönderildikten 2 sn sonra liste körlemesine boşaltılıyor ve
       "temizlendi" izlenimi veriliyordu — araç komutu REDDETSE bile (write-gate:
       araç hareket halinde) kullanıcı kodların silindiğini sanıyordu. Artık
       aracın terminal durumu BEKLENİR ve silme sonrası DOĞRULAMA okuması
       uygulanır: kalan kod varsa dürüstçe listede kalır.

       F2.2: O doğrulama okuması da 410 tombstone'a çarptığı için HİÇ
       çalışmıyordu (fail-closed olduğu için yalan üretmiyordu, ama "temizlendi"
       de kanıtlanamıyordu). Artık kanonik RLS yolu kullanılır. */
    unsubRef.current?.();
    const unsub = subscribeCommandStatus(result.commandId!, async (ev) => {
      if (!mounted.current) return;
      if (!['completed', 'failed', 'expired', 'rejected'].includes(ev.status)) return;

      const outcome = await readDtcOutcomeForType(result.commandId!, vehicleId, 'clear_dtc');
      if (!mounted.current) return;

      if (outcome.kind === 'RESULT' || outcome.kind === 'NO_DTC') {
        /* Silme sonrası DOĞRULAMA okuması: kalan kod varsa listede KALIR. */
        setDtcs(outcome.kind === 'RESULT' ? outcome.dtcs : []);
        setPartial(outcome.partial);
        if (outcome.readAt) setReadAt(outcome.readAt);
        if (outcome.kind === 'RESULT') {
          setErrMsg('Bazı kodlar silinemedi — listede kalanlar araçta hâlâ kayıtlı.');
        }
      } else {
        /* Doğrulanamadı → liste TEMİZLENMEZ (yalancı temizleme yok). */
        setErrMsg(
          ev.status === 'completed'
            ? 'Silme sonucu doğrulanamadı — listeyi yeniden tarayın.'
            : describeDtcOutcome(outcome),
        );
      }
      setPhase('done');
    });
    unsubRef.current = unsub;
  }, [vehicleId, phase]);

  const reset = useCallback(() => {
    setPhase('idle');
    setDtcs([]);
    setReadAt('');
    setErrMsg('');
    setPartial(false);
    setDemo(false);
  }, []);

  return { phase, dtcs, readAt, errMsg, partial, demo, readDtc, clearDtc, reset };
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DiagnosticsPanel({ vehicle }: Props) {
  const [voltage,         setVoltage]         = useState<number | undefined>(vehicle?.batteryVoltage);
  const [voltageLoading,  setVoltageLoading]  = useState(false);
  const [voltageErr,      setVoltageErr]      = useState('');

  const { phase, dtcs, readAt, errMsg, partial, demo, readDtc, clearDtc, reset } =
    useDtcReader(vehicle?.id ?? null);

  const handleReadVoltage = useCallback(async () => {
    if (!vehicle?.id || voltageLoading) return;
    const vid = vehicle.id;
    setVoltageLoading(true);
    setVoltageErr('');

    const result = await sendCommand(vid, 'read_voltage', {});
    if (!result.ok) {
      setVoltageLoading(false);
      setVoltageErr(result.error ?? 'Voltaj komutu gönderilemedi.');
      return;
    }

    /* ÖNCEDEN İKİ UYDURMA VARDI:
       (1) demo modunda `11.8 + Math.random()*1.6` ile RASTGELE voltaj basılıyordu;
       (2) gerçek modda komut tamamlanınca `vehicle.batteryVoltage ?? 12.4` ile
           ölçüm yoksa SAHTE 12,4 V gösteriliyordu — ve komutun kendi sonucu
           hiç okunmuyordu. Artık tek gerçek kaynak aracın yazdığı `result.voltage`;
       ölçüm yoksa sayı BASILMAZ, gerekçe gösterilir. */
    /* ── F2.2 · VOLTAJ DA ARAÇTAN OKUNUR ───────────────────────────────
       ÖLÇÜLEN KUSUR: bu okuma hâlâ `/api/pwa/dtc-result` üzerinden
       yapılıyordu, yani F2.1'de DTC için kapatılan AYNI 410 tombstone'a
       çarpıyordu. Sonuç: komut gidiyor, araç ölçüyor, ekranda DAİMA
       "Voltaj sonucu okunamadı" yazıyordu. Artık satır RLS ile okunur ve
       kanonik sözleşme yorumlar; `completed` gelmesi ölçüm başarısı
       DEĞİLDİR — gövde yoksa gerekçe gösterilir, sayı BASILMAZ. */
    const readVoltage = async () => {
      const outcome = await readVoltageOutcome(result.commandId!, vid);
      if (outcome.kind === 'RESULT') {
        setVoltage(outcome.volts);
      } else if (outcome.kind === 'WAITING_FOR_VEHICLE' || outcome.kind === 'READING') {
        /* Henüz sonuçlanmadı: hata DEME, beklemeye devam et. */
        return;
      } else {
        setVoltageErr(outcome.reason);
      }
      setVoltageLoading(false);
    };

    const unsub = subscribeCommandStatus(result.commandId!, (ev) => {
      if (['completed', 'failed', 'expired', 'rejected'].includes(ev.status)) {
        void readVoltage();
        unsub();
      }
    });
  }, [vehicle, voltageLoading]);

  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="8" stroke="var(--md-outline)" strokeWidth="1.5" strokeDasharray="5 3"/>
          </svg>
        </div>
        <p className="text-sm md-on-surface-variant">Araç bağlı değil</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Battery Voltage */}
      <BatteryGauge
        voltage={voltage}
        loading={voltageLoading}
        errorMsg={voltageErr}
        onRefresh={() => void handleReadVoltage()}
      />

      {/* DTC Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--md-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--md-warning) 25%, transparent)' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 12H1L7 1Z" stroke="#fbbf24" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M7 5v3M7 9.5v.5" stroke="#fbbf24" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-xs font-semibold" style={{ color: 'var(--md-on-surface-variant)' }}>
              Arıza Kodları (DTC)
            </span>
            {dtcs.length > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'color-mix(in srgb, var(--md-error) 12%, transparent)', color: 'var(--md-error)', border: '1px solid color-mix(in srgb, var(--md-error) 25%, transparent)' }}>
                {dtcs.length} KOD
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {phase === 'done' && dtcs.length > 0 && (
              <button
                onClick={() => void clearDtc()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all active:scale-95"
                style={{ background: 'color-mix(in srgb, var(--md-error) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 25%, transparent)', color: 'var(--md-error)' }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Temizle
              </button>
            )}
            {(phase === 'done' || phase === 'error') && (
              <button
                onClick={reset}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all active:scale-95"
                style={{ background: 'var(--md-surface-container-high)', border: '1px solid var(--md-outline-variant)', color: 'var(--md-on-surface-variant)' }}
              >
                Sıfırla
              </button>
            )}
          </div>
        </div>

        {/* Read button — idle state */}
        {phase === 'idle' && (
          <button
            onClick={() => void readDtc()}
            className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--md-warning) 8%, transparent), color-mix(in srgb, var(--md-warning) 8%, transparent))',
              border: '1.5px solid color-mix(in srgb, var(--md-warning) 25%, transparent)',
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'color-mix(in srgb, var(--md-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--md-warning) 25%, transparent)' }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="8" stroke="#fbbf24" strokeWidth="1.5"/>
                <path d="M11 7v4l2.5 2" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-[color:var(--md-warning)] leading-tight">OBD Arıza Kodu Tara</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--md-warning)' }}>
                Araç bilgisayarından DTC kodları okunur
              </p>
            </div>
            <svg className="ml-auto" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="color-mix(in srgb, var(--md-warning) 40%, transparent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}

        {/* Sending */}
        {phase === 'sending' && (
          <div className="flex items-center justify-center gap-3 py-5 rounded-2xl"
            style={{ background: 'color-mix(in srgb, var(--md-warning) 10%, transparent)', border: '1.5px solid color-mix(in srgb, var(--md-warning) 15%, transparent)' }}>
            <svg className="animate-spin w-5 h-5 text-[color:var(--md-warning)]" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"
                strokeDasharray="32" strokeDashoffset="10" opacity="0.4"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="text-sm text-[color:var(--md-warning)] font-medium">Komut gönderiliyor…</span>
          </div>
        )}

        {/* Waiting for car */}
        {phase === 'waiting' && (
          <div className="flex flex-col items-center gap-3 py-6 rounded-2xl"
            style={{ background: 'color-mix(in srgb, var(--md-warning) 10%, transparent)', border: '1.5px solid color-mix(in srgb, var(--md-warning) 12%, transparent)' }}>
            <div className="relative w-10 h-10">
              <svg className="animate-spin absolute inset-0 w-10 h-10 text-[color:var(--md-warning)]" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2"
                  strokeDasharray="72" strokeDashoffset="24" opacity="0.3"/>
                <path d="M20 4a16 16 0 0116 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1L15 13H1L8 1Z" stroke="#fbbf24" strokeWidth="1.3" strokeLinejoin="round"/>
                  <path d="M8 6v3M8 10.5v.5" stroke="#fbbf24" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-[color:var(--md-warning)]">Araç OBD Tarıyor</p>
              <p className="text-xs mt-1" style={{ color: 'var(--md-warning)' }}>
                Araç sistemlerini okumak birkaç saniye alabilir
              </p>
            </div>
          </div>
        )}

        {/* Clearing */}
        {phase === 'clearing' && (
          <div className="flex items-center justify-center gap-3 py-5 rounded-2xl"
            style={{ background: 'color-mix(in srgb, var(--md-error) 8%, transparent)', border: '1.5px solid color-mix(in srgb, var(--md-error) 15%, transparent)' }}>
            <svg className="animate-spin w-5 h-5 text-[color:var(--md-error)]" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"
                strokeDasharray="32" strokeDashoffset="10" opacity="0.4"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="text-sm /70 font-medium">Arıza kodları temizleniyor…</span>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 px-3 py-3 rounded-xl"
              style={{ background: 'color-mix(in srgb, var(--md-error) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 25%, transparent)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="#ef4444" strokeWidth="1.3"/>
                <path d="M6 6l4 4M10 6l-4 4" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <p className="text-xs /80">{errMsg || 'Arıza kodu okuması başarısız.'}</p>
            </div>
            <button
              onClick={() => void readDtc()}
              className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{ background: 'color-mix(in srgb, var(--md-error) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 22%, transparent)', color: 'var(--md-error)' }}
            >
              ↺ Tekrar Tara
            </button>
          </div>
        )}

        {/* Results */}
        {phase === 'done' && (
          <div className="flex flex-col gap-2">
            {/* Timestamp */}
            {readAt && (
              <p className="text-[11px] font-mono md-on-surface-variant px-1">
                Son okuma: {new Date(readAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            )}

            {/* Temizleme/okuma gerekçesi — `done` fazında da görünmeli, yoksa
                reddedilen silme sessizce başarılı sanılır. */}
            {errMsg && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'color-mix(in srgb, var(--md-error) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 25%, transparent)' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
                  <circle cx="7" cy="7" r="5.5" stroke="#ef4444" strokeWidth="1.3"/>
                  <path d="M5.2 5.2l3.6 3.6M8.8 5.2l-3.6 3.6" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <p className="text-xs font-semibold" style={{ color: 'var(--md-error)' }}>{errMsg}</p>
              </div>
            )}

            {/* Demo verisi rozeti — gerçek araç okuması DEĞİL. */}
            {demo && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: 'color-mix(in srgb, var(--md-tertiary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-tertiary) 28%, transparent)' }}>
                <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: 'color-mix(in srgb, var(--md-tertiary) 18%, transparent)', color: 'var(--md-tertiary)' }}>DEMO</span>
                <p className="text-xs" style={{ color: 'var(--md-tertiary)' }}>
                  Bu sonuç örnek veridir — hiçbir araçtan okunmadı.
                </p>
              </div>
            )}

            {/* Kısmi tarama — boş liste "temiz" DEĞİLDİR. */}
            {partial && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: 'color-mix(in srgb, var(--md-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-warning) 30%, transparent)' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
                  <path d="M7 1L13 12H1L7 1Z" stroke="#f59e0b" strokeWidth="1.3" strokeLinejoin="round"/>
                  <path d="M7 5.5v3M7 10v.5" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <p className="text-xs font-semibold" style={{ color: 'var(--md-warning)' }}>
                  Tarama tamamlanamadı — en az bir sistem okunamadı. Bu liste eksik olabilir.
                </p>
              </div>
            )}

            {dtcs.length === 0 ? (
              partial ? (
                /* Kısmi taramada "Arıza Kodu Yok" YAZILAMAZ — okunamayan sistem,
                   arızası olmayan sistemle aynı şey değildir (fail-closed). */
                <div className="flex flex-col items-center gap-2 py-6 rounded-2xl"
                  style={{ background: 'color-mix(in srgb, var(--md-warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-warning) 18%, transparent)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: 'color-mix(in srgb, var(--md-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--md-warning) 22%, transparent)' }}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                      <circle cx="9" cy="9" r="7" stroke="#f59e0b" strokeWidth="1.6" strokeDasharray="4 3"/>
                    </svg>
                  </div>
                  <p className="text-sm font-bold" style={{ color: 'var(--md-warning)' }}>Sonuç Belirsiz</p>
                  <p className="text-xs text-center px-4" style={{ color: 'var(--md-warning)' }}>
                    Okunabilen sistemlerde kod bulunamadı, ancak tarama eksik kaldı.
                    Kontak açıkken tekrar deneyin.
                  </p>
                </div>
              ) : (
              <div className="flex flex-col items-center gap-2 py-6 rounded-2xl"
                style={{ background: 'color-mix(in srgb, var(--md-success) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-success) 18%, transparent)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'color-mix(in srgb, var(--md-success) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--md-success) 22%, transparent)' }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 9l4.5 4.5L15 5" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="text-sm font-bold" style={{ color: 'var(--md-success)' }}>Arıza Kodu Yok</p>
                <p className="text-xs md-on-surface-variant">Sistemler normal çalışıyor</p>
              </div>
              )
            ) : (
              <>
                {/* Summary bar */}
                <div className="flex gap-2 px-1">
                  {(['critical', 'warning', 'info'] as const).map((sev) => {
                    const count = dtcs.filter((d) => d.severity === sev).length;
                    if (!count) return null;
                    const cfg = SEV_CONFIG[sev];
                    return (
                      <div key={sev} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
                        style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                        <span className="text-base font-semibold leading-none" style={{ color: cfg.color }}>{count}</span>
                        <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Code list */}
                <div className="flex flex-col gap-2">
                  {dtcs.map((dtc) => <DtcCard key={dtc.code} dtc={dtc} />)}
                </div>

                {/* Clear all button */}
                <button
                  onClick={() => void clearDtc()}
                  className="w-full py-3 rounded-xl font-semibold text-[11px] transition-all active:scale-95 mt-1"
                  style={{ background: 'color-mix(in srgb, var(--md-error) 8%, transparent)', border: '1.5px solid color-mix(in srgb, var(--md-error) 22%, transparent)', color: 'var(--md-error)' }}
                >
                  Tüm Arıza Kodlarını Temizle
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
