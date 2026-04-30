'use client';

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { LiveVehicle } from '@/types/realtime';
import { sendCommand, subscribeCommandStatus } from '@/lib/commandService';
import { getStoredApiKey } from '@/lib/pairingService';
import type { DtcCode, DtcResult } from '@/app/api/pwa/dtc-result/route';

interface Props { vehicle: LiveVehicle | null }

// ── Türkçe DTC kod sistemi arayüzü ───────────────────────────────────────────

const DTC_SYSTEM_COLORS: Record<string, string> = {
  'Yakıt':      '#fbbf24',
  'Egzoz':      '#f97316',
  'Elektrik':   '#ef4444',
  'İgnisyon':   '#a78bfa',
  'Emisyon':    '#60a5fa',
  'Şanzıman':   '#34d399',
  'ABS/Fren':   '#fb923c',
  'Bilinmeyen': '#6b7280',
};

const SEV_CONFIG = {
  critical: { label: 'KRİTİK',  color: '#ef4444', bg: 'rgba(239,68,68,0.10)',    border: 'rgba(239,68,68,0.30)' },
  warning:  { label: 'UYARI',   color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',   border: 'rgba(245,158,11,0.30)' },
  info:     { label: 'BİLGİ',   color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',   border: 'rgba(96,165,250,0.30)' },
};

// ── Battery voltage gauge ─────────────────────────────────────────────────────

function voltageColor(v: number): string {
  if (v < 11.5) return '#ef4444';
  if (v < 12.0) return '#f59e0b';
  if (v < 12.7) return '#34d399';
  return '#60a5fa';
}

function voltageLabel(v: number): string {
  if (v < 11.5) return 'Kritik — Araç Çalışmayabilir';
  if (v < 12.0) return 'Düşük — Şarj Önerili';
  if (v < 12.7) return 'Normal';
  if (v < 13.5) return 'Şarj Edilmiş';
  return 'Motor Çalışıyor (Alternatör)';
}

function voltagePct(v: number): number {
  // 10V = 0%, 15V = 100%
  return Math.max(0, Math.min(100, ((v - 10) / 5) * 100));
}

const BatteryGauge = memo(function BatteryGauge({
  voltage,
  loading,
  onRefresh,
}: {
  voltage: number | undefined;
  loading: boolean;
  onRefresh: () => void;
}) {
  const v     = voltage ?? 0;
  const color = voltage != null ? voltageColor(v) : '#6b7280';
  const pct   = voltage != null ? voltagePct(v)   : 0;

  return (
    <div className="flex flex-col gap-3 px-4 py-4 rounded-2xl"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="3" width="11" height="8" rx="1.5" stroke={color} strokeWidth="1.3"/>
              <path d="M12 5.5v3" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M4.5 7h5M7 4.5v5" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Akü Voltajı
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all active:scale-95 disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }}
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
            <span className="text-4xl font-black tabular-nums leading-none" style={{ color }}>
              {v.toFixed(1)}
            </span>
            <span className="text-lg font-mono mb-1" style={{ color: `${color}70` }}>V</span>
            <span className="ml-auto text-[10px] font-semibold pb-1" style={{ color: `${color}90` }}>
              {voltageLabel(v)}
            </span>
          </div>

          {/* Bar */}
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}80, ${color})` }}
            />
          </div>

          {/* Scale ticks */}
          <div className="flex justify-between text-[8px] font-mono" style={{ color: 'rgba(255,255,255,0.18)' }}>
            <span>10V</span><span>11V</span><span>12V</span><span>13V</span><span>14V</span><span>15V</span>
          </div>

          {/* Alert banner */}
          {v < 12.0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{
                background: v < 11.5 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                border: `1px solid ${v < 11.5 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
              }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 12H1L7 1Z" stroke={v < 11.5 ? '#ef4444' : '#f59e0b'} strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M7 5.5v3M7 10v.5" stroke={v < 11.5 ? '#ef4444' : '#f59e0b'} strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <p className="text-[10px] font-semibold" style={{ color: v < 11.5 ? '#f87171' : '#fbbf24' }}>
                {v < 11.5
                  ? 'Akü kritik seviyede! Aracı çalıştırın veya acil şarj edin.'
                  : 'Akü düşük. En yakın fırsatta şarj edin.'}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center gap-2 py-4 text-sm" style={{ color: 'rgba(255,255,255,0.2)' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" strokeDasharray="4 2"/>
          </svg>
          OBD bağlantısı için araç motorunu çalıştırın
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
        <span className="font-mono font-black text-xs tracking-widest leading-none" style={{ color: sev.color }}>
          {dtc.code}
        </span>
        <span className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md"
          style={{ background: `${sev.color}20`, color: sev.color }}>
          {sev.label}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white/80 leading-snug">{dtc.desc}</p>
        <span className="inline-block mt-1 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md"
          style={{ background: `${sysColor}15`, color: sysColor, border: `1px solid ${sysColor}25` }}>
          {dtc.system}
        </span>
      </div>
    </div>
  );
});

// ── DTC Reader ─────────────────────────────────────────────────────────────────

type DtcPhase = 'idle' | 'sending' | 'waiting' | 'done' | 'error' | 'clearing';

function useDtcReader(vehicleId: string | null) {
  const [phase,   setPhase]   = useState<DtcPhase>('idle');
  const [dtcs,    setDtcs]    = useState<DtcCode[]>([]);
  const [readAt,  setReadAt]  = useState<string>('');
  const [errMsg,  setErrMsg]  = useState('');
  const mounted               = useRef(true);
  const unsubRef              = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      unsubRef.current?.();
    };
  }, []);

  const fetchResult = useCallback(async (commandId: string, vid: string) => {
    const apiKey = getStoredApiKey(vid);
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(
      `/api/pwa/dtc-result?commandId=${encodeURIComponent(commandId)}&vehicleId=${encodeURIComponent(vid)}`,
      { headers },
    );
    if (!res.ok) throw new Error('Sonuç alınamadı');
    return (await res.json()) as DtcResult;
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

    // Demo mode (commandId starts with 'demo-')
    if (result.commandId?.startsWith('demo-cmd-')) {
      setPhase('waiting');
      try {
        const data = await fetchResult(result.commandId, vehicleId);
        if (!mounted.current) return;
        setDtcs(data.dtcs);
        setReadAt(data.readAt);
        setPhase('done');
      } catch {
        if (mounted.current) { setPhase('error'); setErrMsg('Demo sonuç alınamadı.'); }
      }
      return;
    }

    setPhase('waiting');

    unsubRef.current?.();
    const unsub = subscribeCommandStatus(result.commandId!, async (ev) => {
      if (!mounted.current) return;
      if (ev.status === 'completed') {
        try {
          const data = await fetchResult(result.commandId!, vehicleId);
          if (!mounted.current) return;
          setDtcs(data.dtcs);
          setReadAt(data.readAt);
          setPhase('done');
        } catch {
          if (mounted.current) { setPhase('error'); setErrMsg('Araç verileri alınamadı.'); }
        }
      } else if (['failed', 'expired', 'rejected'].includes(ev.status)) {
        if (mounted.current) { setPhase('error'); setErrMsg('Araç DTC okumasını tamamlayamadı.'); }
      }
    });
    unsubRef.current = unsub;
  }, [vehicleId, phase, fetchResult]);

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

    // After clearing wait a moment then reset
    setTimeout(() => {
      if (!mounted.current) return;
      setDtcs([]);
      setReadAt(new Date().toISOString());
      setPhase('idle');
    }, 2_000);
  }, [vehicleId, phase]);

  const reset = useCallback(() => {
    setPhase('idle');
    setDtcs([]);
    setReadAt('');
    setErrMsg('');
  }, []);

  return { phase, dtcs, readAt, errMsg, readDtc, clearDtc, reset };
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DiagnosticsPanel({ vehicle }: Props) {
  const [voltage,         setVoltage]         = useState<number | undefined>(vehicle?.batteryVoltage);
  const [voltageLoading,  setVoltageLoading]  = useState(false);

  const { phase, dtcs, readAt, errMsg, readDtc, clearDtc, reset } = useDtcReader(vehicle?.id ?? null);

  const handleReadVoltage = useCallback(async () => {
    if (!vehicle?.id || voltageLoading) return;
    setVoltageLoading(true);

    const result = await sendCommand(vehicle.id, 'read_voltage', {});
    if (!result.ok) { setVoltageLoading(false); return; }

    // Demo: simulate a returned value after short delay
    if (result.commandId?.startsWith('demo-cmd-')) {
      setTimeout(() => {
        setVoltage(11.8 + Math.random() * 1.6); // 11.8–13.4V
        setVoltageLoading(false);
      }, 1_200);
      return;
    }

    // Real: subscribe and wait for result via vehicle telemetry update
    // The car pushes updated batteryVoltage into the telemetry stream;
    // we just poll once after command completes.
    const unsub = subscribeCommandStatus(result.commandId!, (ev) => {
      if (ev.status === 'completed') {
        setVoltage(vehicle.batteryVoltage ?? 12.4);
        setVoltageLoading(false);
        unsub();
      } else if (['failed', 'expired', 'rejected'].includes(ev.status)) {
        setVoltageLoading(false);
        unsub();
      }
    });
  }, [vehicle, voltageLoading]);

  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10">
        <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="8" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeDasharray="5 3"/>
          </svg>
        </div>
        <p className="text-sm text-white/25">Araç bağlı değil</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Battery Voltage */}
      <BatteryGauge
        voltage={voltage}
        loading={voltageLoading}
        onRefresh={() => void handleReadVoltage()}
      />

      {/* DTC Section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1L13 12H1L7 1Z" stroke="#fbbf24" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M7 5v3M7 9.5v.5" stroke="#fbbf24" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Arıza Kodları (DTC)
            </span>
            {dtcs.length > 0 && (
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
                {dtcs.length} KOD
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {phase === 'done' && dtcs.length > 0 && (
              <button
                onClick={() => void clearDtc()}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all active:scale-95"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
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
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all active:scale-95"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.35)' }}
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
              background: 'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(245,158,11,0.04))',
              border: '1.5px solid rgba(251,191,36,0.25)',
            }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)' }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="8" stroke="#fbbf24" strokeWidth="1.5"/>
                <path d="M11 7v4l2.5 2" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-yellow-300 leading-tight">OBD Arıza Kodu Tara</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'rgba(251,191,36,0.45)' }}>
                Araç bilgisayarından DTC kodları okunur
              </p>
            </div>
            <svg className="ml-auto" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l4 4-4 4" stroke="rgba(251,191,36,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}

        {/* Sending */}
        {phase === 'sending' && (
          <div className="flex items-center justify-center gap-3 py-5 rounded-2xl"
            style={{ background: 'rgba(251,191,36,0.05)', border: '1.5px solid rgba(251,191,36,0.15)' }}>
            <svg className="animate-spin w-5 h-5 text-yellow-400" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"
                strokeDasharray="32" strokeDashoffset="10" opacity="0.4"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="text-sm text-yellow-300/70 font-medium">Komut gönderiliyor…</span>
          </div>
        )}

        {/* Waiting for car */}
        {phase === 'waiting' && (
          <div className="flex flex-col items-center gap-3 py-6 rounded-2xl"
            style={{ background: 'rgba(251,191,36,0.04)', border: '1.5px solid rgba(251,191,36,0.12)' }}>
            <div className="relative w-10 h-10">
              <svg className="animate-spin absolute inset-0 w-10 h-10 text-yellow-400" viewBox="0 0 40 40" fill="none">
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
              <p className="text-sm font-bold text-yellow-300/80">Araç OBD Tarıyor</p>
              <p className="text-[10px] mt-1" style={{ color: 'rgba(251,191,36,0.35)' }}>
                Araç sistemlerini okumak birkaç saniye alabilir
              </p>
            </div>
          </div>
        )}

        {/* Clearing */}
        {phase === 'clearing' && (
          <div className="flex items-center justify-center gap-3 py-5 rounded-2xl"
            style={{ background: 'rgba(239,68,68,0.05)', border: '1.5px solid rgba(239,68,68,0.15)' }}>
            <svg className="animate-spin w-5 h-5 text-red-400" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"
                strokeDasharray="32" strokeDashoffset="10" opacity="0.4"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="text-sm text-red-300/70 font-medium">Arıza kodları temizleniyor…</span>
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 px-3 py-3 rounded-xl"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="#ef4444" strokeWidth="1.3"/>
                <path d="M6 6l4 4M10 6l-4 4" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <p className="text-xs text-red-300/80">{errMsg || 'Arıza kodu okuması başarısız.'}</p>
            </div>
            <button
              onClick={() => void readDtc()}
              className="w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)', color: '#f87171' }}
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
              <p className="text-[9px] font-mono text-white/20 px-1">
                Son okuma: {new Date(readAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            )}

            {dtcs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 rounded-2xl"
                style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.22)' }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 9l4.5 4.5L15 5" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <p className="text-sm font-bold text-emerald-300">Arıza Kodu Yok</p>
                <p className="text-[10px] text-emerald-400/40">Sistemler normal çalışıyor</p>
              </div>
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
                        <span className="text-base font-black leading-none" style={{ color: cfg.color }}>{count}</span>
                        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: cfg.color }}>{cfg.label}</span>
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
                  className="w-full py-3 rounded-xl font-black text-[11px] uppercase tracking-widest text-red-300 transition-all active:scale-95 mt-1"
                  style={{ background: 'rgba(239,68,68,0.07)', border: '1.5px solid rgba(239,68,68,0.22)' }}
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
