'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { sendCommand, subscribeCommandStatus } from '@/lib/commandService';
import { describeDtcOutcome, type DtcCode, type DtcOutcome } from '@/lib/diagnostics/dtcResultContract';
import { judge, BATTERY_RULE, type Verdict } from '@/lib/console/evidenceModel';
import { Icon } from '@/components/pwa/ui/Icon';
import { IconBadge, StatusPill, type Tone } from '@/components/pwa/ui/primitives';
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

  const verdict = voltage != null ? voltageVerdict(v) : null;
  const tone: Tone = verdict === 'CRITICAL' ? 'error' : verdict === 'WARNING' ? 'warning' : verdict ? 'success' : 'neutral';

  return (
    <section className="md-card-elevated px-4 py-4 flex flex-col gap-3" aria-label="Akü voltajı">
      <div className="flex items-center gap-4">
        <IconBadge name="battery_full" tone={tone === 'neutral' ? 'neutral' : tone} />
        <p className="flex-1 md-title-m md-on-surface">Akü Voltajı</p>
        <button onClick={onRefresh} disabled={loading} className="md-btn-tonal md-state disabled:opacity-50" style={{ minHeight: 40, padding: '0 16px' }}>
          {loading ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" strokeDasharray="18" strokeDashoffset="6" opacity="0.4"/>
              <path d="M6 1.5a4.5 4.5 0 014.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          ) : <Icon name="refresh" size={18} />}
          {loading ? 'Ölçülüyor' : 'OBD Oku'}
        </button>
      </div>

      {voltage != null ? (
        <>
          <div className="flex items-end gap-2 flex-wrap">
            <span className="md-display-s md-on-surface tabular-nums" style={{ fontWeight: 500 }}>{v.toFixed(1)}</span>
            <span className="md-title-l md-on-surface-variant mb-1">V</span>
            <span className="ml-auto mb-1.5"><StatusPill tone={tone}>{voltageLabel(v)}</StatusPill></span>
          </div>

          {/* Ölçek çubuğu — değer 10–15 V aralığına yerleştirilir */}
          <div aria-hidden="true">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--md-surface-container-highest)' }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width var(--md-dur-long) var(--md-ease-emphasized-decel)' }} />
            </div>
            <div className="flex justify-between md-label-m md-on-surface-variant mt-1 tabular-nums">
              <span>10</span><span>11</span><span>12</span><span>13</span><span>14</span><span>15 V</span>
            </div>
          </div>

          {verdict !== 'VERIFIED' && (() => {
            const critical = verdict === 'CRITICAL';
            return (
              <div className="flex items-start gap-3 px-4 py-3"
                style={{ borderRadius: 'var(--md-shape-md)',
                  background: critical ? 'var(--md-error-container)' : 'var(--md-warning-container)',
                  color: critical ? 'var(--md-on-error-container)' : 'var(--md-on-warning-container)' }}>
                <Icon name={critical ? 'error' : 'warning'} size={20} className="flex-shrink-0" />
                <p className="md-body-m">
                  {critical
                    ? 'Akü kritik seviyede! Aracı çalıştırın veya acil şarj edin.'
                    : 'Akü düşük. En yakın fırsatta şarj edin.'}
                </p>
              </div>
            );
          })()}
        </>
      ) : (
        <p className="flex items-center gap-2 md-body-m" style={{ color: errorMsg ? 'var(--md-error)' : 'var(--md-on-surface-variant)' }}>
          <Icon name={errorMsg ? 'error' : 'info'} size={20} className="flex-shrink-0" />
          {/* Ölçüm yoksa SAYI UYDURULMAZ; araç gerekçe bildirdiyse o gösterilir. */}
          {errorMsg || 'OBD bağlantısı için araç motorunu çalıştırın'}
        </p>
      )}
    </section>
  );
});

// ── DTC code card ─────────────────────────────────────────────────────────────

const SEV_TONE: Record<keyof typeof SEV_CONFIG, Tone> = { critical: 'error', warning: 'warning', info: 'primary' };

const DtcCard = memo(function DtcCard({ dtc, first }: { dtc: DtcCode; first?: boolean }) {
  const sev  = SEV_CONFIG[dtc.severity];
  const sysColor = DTC_SYSTEM_COLORS[dtc.system] ?? DTC_SYSTEM_COLORS['Bilinmeyen'];

  return (
    <li className="flex items-start gap-3 px-4 py-3"
      style={first ? undefined : { borderTop: '1px solid var(--md-outline-variant)' }}>
      <span className="md-title-m tabular-nums flex-shrink-0 pt-px" style={{ color: sev.color, minWidth: 64 }}>
        {dtc.code}
      </span>
      <div className="flex-1 min-w-0">
        <p className="md-body-m md-on-surface">{dtc.desc}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusPill tone={SEV_TONE[dtc.severity]}>{sev.label}</StatusPill>
          <span className="md-label-m md-on-surface-variant inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="w-2 h-2 rounded-full" style={{ background: sysColor }} />
            {dtc.system}
          </span>
        </div>
      </div>
    </li>
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
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <span aria-hidden="true" className="flex items-center justify-center"
          style={{ width: 88, height: 88, borderRadius: 'var(--md-shape-xl)', background: 'var(--md-surface-container-high)', color: 'var(--md-on-surface-variant)' }}>
          <Icon name="directions_car" size={44} />
        </span>
        <p className="md-body-l md-on-surface">Araç bağlı değil</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="md-title-m md-on-surface px-1 pt-3">Araçtan oku</h2>

      {/* Battery Voltage */}
      <BatteryGauge
        voltage={voltage}
        loading={voltageLoading}
        errorMsg={voltageErr}
        onRefresh={() => void handleReadVoltage()}
      />

      {/* DTC Section — tek kart; faz içeriği kartın gövdesidir */}
      <section className="md-card-elevated overflow-hidden" aria-label="Arıza kodları">
        <div className="flex items-center gap-4 px-4 pt-4 pb-3">
          <IconBadge name="car_repair" tone={dtcs.length > 0 ? 'error' : 'neutral'} />
          <div className="flex-1 min-w-0">
            <p className="md-title-m md-on-surface">Arıza Kodları (DTC)</p>
            {readAt && phase === 'done' ? (
              <p className="md-body-s md-on-surface-variant tabular-nums">
                Son okuma: {new Date(readAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            ) : (
              <p className="md-body-s md-on-surface-variant">Araç bilgisayarından DTC kodları okunur</p>
            )}
          </div>
          {dtcs.length > 0 && <StatusPill tone="error">{dtcs.length} kod</StatusPill>}
        </div>

        <div className="px-4 pb-4 flex flex-col gap-3">
          {/* Read button — idle state */}
          {phase === 'idle' && (
            <button onClick={() => void readDtc()} className="md-btn-filled md-state w-full" style={{ minHeight: 48 }}>
              <Icon name="search" size={20} />
              OBD Arıza Kodu Tara
            </button>
          )}

          {/* Sending */}
          {phase === 'sending' && (
            <div className="flex items-center gap-3 py-2 md-on-surface" role="status">
              <span style={{ color: 'var(--md-primary)' }}><svg className="animate-spin w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10" opacity="0.3"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg></span>
              <span className="md-body-m">Komut gönderiliyor…</span>
            </div>
          )}

          {/* Waiting for car */}
          {phase === 'waiting' && (
            <div className="flex items-start gap-3 py-2 md-on-surface" role="status">
              <span className="mt-0.5" style={{ color: 'var(--md-primary)' }}><svg className="animate-spin w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10" opacity="0.3"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg></span>
              <div>
                <p className="md-body-l">Araç OBD Tarıyor</p>
                <p className="md-body-s md-on-surface-variant">Araç sistemlerini okumak birkaç saniye alabilir</p>
              </div>
            </div>
          )}

          {/* Clearing */}
          {phase === 'clearing' && (
            <div className="flex items-center gap-3 py-2 md-on-surface" role="status">
              <span style={{ color: 'var(--md-error)' }}><svg className="animate-spin w-5 h-5 flex-shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="10" opacity="0.3"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg></span>
              <span className="md-body-m">Arıza kodları temizleniyor…</span>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <>
              <div className="flex items-start gap-3 px-4 py-3"
                style={{ borderRadius: 'var(--md-shape-md)', background: 'var(--md-error-container)', color: 'var(--md-on-error-container)' }}>
                <Icon name="error" size={20} className="flex-shrink-0" />
                <p className="md-body-m">{errMsg || 'Arıza kodu okuması başarısız.'}</p>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={reset} className="md-btn-text md-state min-h-12">Sıfırla</button>
                <button onClick={() => void readDtc()} className="md-btn-tonal md-state min-h-12">
                  <Icon name="refresh" size={18} />
                  Tekrar Tara
                </button>
              </div>
            </>
          )}

          {/* Results */}
          {phase === 'done' && (
            <>
              {/* Temizleme/okuma gerekçesi — `done` fazında da görünmeli, yoksa
                  reddedilen silme sessizce başarılı sanılır. */}
              {errMsg && (
                <div className="flex items-start gap-3 px-4 py-3"
                  style={{ borderRadius: 'var(--md-shape-md)', background: 'var(--md-error-container)', color: 'var(--md-on-error-container)' }}>
                  <Icon name="error" size={20} className="flex-shrink-0" />
                  <p className="md-body-m">{errMsg}</p>
                </div>
              )}

              {/* Demo verisi rozeti — gerçek araç okuması DEĞİL. */}
              {demo && (
                <div className="flex items-center gap-3 px-4 py-3"
                  style={{ borderRadius: 'var(--md-shape-md)', background: 'var(--md-tertiary-container)', color: 'var(--md-on-tertiary-container)' }}>
                  <span className="md-label-m px-2 py-0.5" style={{ borderRadius: 'var(--md-shape-xs)', border: '1px solid currentColor' }}>DEMO</span>
                  <p className="md-body-m">Bu sonuç örnek veridir — hiçbir araçtan okunmadı.</p>
                </div>
              )}

              {/* Kısmi tarama — boş liste "temiz" DEĞİLDİR. */}
              {partial && (
                <div className="flex items-start gap-3 px-4 py-3"
                  style={{ borderRadius: 'var(--md-shape-md)', background: 'var(--md-warning-container)', color: 'var(--md-on-warning-container)' }}>
                  <Icon name="warning" size={20} className="flex-shrink-0" />
                  <p className="md-body-m">Tarama tamamlanamadı — en az bir sistem okunamadı. Bu liste eksik olabilir.</p>
                </div>
              )}

              {dtcs.length === 0 ? (
                partial ? (
                  /* Kısmi taramada "Arıza Kodu Yok" YAZILAMAZ — okunamayan sistem,
                     arızası olmayan sistemle aynı şey değildir (fail-closed). */
                  <div className="flex flex-col items-center text-center gap-2 py-4">
                    <IconBadge name="info" tone="warning" size={56} />
                    <p className="md-title-m md-on-surface mt-1">Sonuç Belirsiz</p>
                    <p className="md-body-m md-on-surface-variant max-w-xs">
                      Okunabilen sistemlerde kod bulunamadı, ancak tarama eksik kaldı.
                      Kontak açıkken tekrar deneyin.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center gap-2 py-4">
                    <IconBadge name="check_circle" tone="success" size={56} />
                    <p className="md-title-m md-on-surface mt-1">Arıza Kodu Yok</p>
                    <p className="md-body-m md-on-surface-variant">Sistemler normal çalışıyor</p>
                  </div>
                )
              ) : (
                <>
                  {/* Summary bar */}
                  <div className="flex flex-wrap gap-2">
                    {(['critical', 'warning', 'info'] as const).map((sev) => {
                      const count = dtcs.filter((d) => d.severity === sev).length;
                      if (!count) return null;
                      return <StatusPill key={sev} tone={SEV_TONE[sev]}>{count} {SEV_CONFIG[sev].label}</StatusPill>;
                    })}
                  </div>

                  {/* Code list */}
                  <ul className="-mx-4" style={{ borderTop: '1px solid var(--md-outline-variant)', borderBottom: '1px solid var(--md-outline-variant)' }}>
                    {dtcs.map((dtc, i) => <DtcCard key={dtc.code} dtc={dtc} first={i === 0} />)}
                  </ul>
                </>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <button onClick={reset} className="md-btn-text md-state min-h-12">Sıfırla</button>
                {dtcs.length > 0 && (
                  /* Clear all button */
                  <button onClick={() => void clearDtc()} className="md-btn-outlined md-state min-h-12"
                    style={{ color: 'var(--md-error)', borderColor: 'var(--md-error)' }}>
                    <Icon name="delete" size={18} />
                    Tüm Arıza Kodlarını Temizle
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
