'use client';

/**
 * RemoteCommandPanel — Araç uzaktan komut merkezi.
 *
 * Supabase vehicle_commands tablosuna INSERT atar (status: 'pending').
 * Araç Realtime ile alır ve yürütür.
 *
 * Özellikler:
 *   - Lock state tracking: Kilitli/Açık durumu optimistik olarak takip edilir
 *   - Neon glow: aktif komut butonlarında neon border animasyonu
 *   - Zero-Leak: _mounted ref ile unmount sonrası state güncelleme önlenir
 *   - Mock mod: Supabase yoksa demo simülasyonu
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/* ── Types ──────────────────────────────────────────────── */

type CommandType = 'lock' | 'unlock' | 'navigate' | 'honk' | 'alarm';
type LockStatus  = 'unknown' | 'locked' | 'unlocked';
type AckStatus   = 'pending' | 'executed' | 'failed' | 'timeout';
interface CommandResult { ok: boolean; msg: string; commandId?: string }

interface Props { vehicleId: string }

/* ── Send command — returns commandId for ACK ────────────── */

async function sendCommand(
  vehicleId: string,
  type: CommandType,
  payload: Record<string, unknown> = {},
): Promise<CommandResult> {
  if (!supabaseBrowser) {
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, msg: `${type} komutu gönderildi (demo)` };
  }
  const { data, error } = await supabaseBrowser
    .from('vehicle_commands')
    .insert({ vehicle_id: vehicleId, type, payload, status: 'pending' })
    .select('id')
    .single();
  if (error) return { ok: false, msg: error.message };
  return { ok: true, msg: 'Komut sıraya alındı', commandId: (data as { id: string } | null)?.id };
}

/* ── Realtime ACK subscription ───────────────────────────── */

function subscribeACK(
  commandId: string,
  onAck: (status: 'executed' | 'failed' | 'timeout', reason?: string) => void,
): () => void {
  if (!supabaseBrowser) return () => {};

  const timeoutId = setTimeout(() => onAck('timeout'), 15_000);
  let resolved = false;

  const channel: RealtimeChannel = supabaseBrowser
    .channel(`cmd-ack:${commandId}`)
    .on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'vehicle_commands',
        filter: `id=eq.${commandId}`,
      },
      (evt) => {
        if (resolved) return;
        const row = evt.new as Record<string, unknown>;
        const s   = row['status'] as string;
        if (s === 'executed' || s === 'failed') {
          resolved = true;
          clearTimeout(timeoutId);
          onAck(s as 'executed' | 'failed', s === 'failed' ? (row['error_msg'] as string | undefined) : undefined);
          void channel.unsubscribe();
        }
      },
    )
    .subscribe();

  return () => {
    if (!resolved) { resolved = true; clearTimeout(timeoutId); }
    void channel.unsubscribe();
  };
}

/* ── SVG icons (inline, no dep) ──────────────────────────── */

const LockIcon    = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="8" cy="11" r="1" fill="currentColor"/></svg>;
const UnlockIcon  = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 7V5a2.5 2.5 0 015 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 1.5"/></svg>;
const NavIcon     = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 8l-8 4 2-4-2-4 8 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const HornIcon    = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6H2a1 1 0 000 2h2m0-2v2m0-2l4-3v8L4 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 5a4 4 0 010 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
const SpinIcon    = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-spin"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" strokeDasharray="28" strokeDashoffset="10" opacity="0.4"/><path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>;
const OkIcon      = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const ErrIcon     = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="#ef4444" strokeWidth="1.4"/><path d="M5 5l4 4M9 5l-4 4" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round"/></svg>;

/* ── Memoized command button ─────────────────────────────── */

const CommandButton = memo(function CommandButton({
  type, label, Icon, accent, isPending, borderColor, bgColor, boxShadow, disabled, onClick,
}: {
  type: CommandType; label: string; Icon: () => React.ReactElement;
  accent: string; isPending: boolean; borderColor: string; bgColor: string;
  boxShadow: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      key={type}
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-2 py-4 rounded-2xl transition-all duration-200 active:scale-95 disabled:opacity-60 group"
      style={{ background: bgColor, border: `1px solid ${borderColor}`, boxShadow }}
    >
      {isPending
        ? <SpinIcon />
        : <span style={{ color: accent }} className="group-hover:scale-110 transition-transform duration-150"><Icon /></span>
      }
      <span className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: accent }}>
        {label}
      </span>
    </button>
  );
});

/* ── Component ───────────────────────────────────────────── */

export function RemoteCommandPanel({ vehicleId }: Props) {
  const [cmdState,   setCmdState]   = useState<Partial<Record<CommandType, AckStatus>>>({});
  const [result,     setResult]     = useState<CommandResult | null>(null);
  const [lockStatus, setLockStatus] = useState<LockStatus>('unknown');
  const [navDest,    setNavDest]    = useState('');
  const [showNav,    setShowNav]    = useState(false);
  const mountedRef   = useRef(true);
  const cleanupSet   = useRef(new Set<() => void>());

  // Zero-Leak: cancel all pending ACK subscriptions on unmount
  useEffect(() => () => {
    mountedRef.current = false;
    cleanupSet.current.forEach((fn) => fn());
  }, []);

  const clearCmdState = useCallback((type: CommandType) => {
    setTimeout(() => {
      if (mountedRef.current) setCmdState((prev) => { const n = { ...prev }; delete n[type]; return n; });
    }, 2500);
  }, []);

  const dispatch = useCallback(async (type: CommandType, payload: Record<string, unknown> = {}) => {
    if (cmdState[type] === 'pending') return;
    if (!mountedRef.current) return;

    setCmdState((prev) => ({ ...prev, [type]: 'pending' }));
    setResult(null);

    const res = await sendCommand(vehicleId, type, payload);
    if (!mountedRef.current) return;

    if (!res.ok) {
      setCmdState((prev) => ({ ...prev, [type]: 'failed' }));
      setResult(res);
      clearCmdState(type);
      return;
    }

    // Optimistic lock state
    if (type === 'lock')   setLockStatus('locked');
    if (type === 'unlock') setLockStatus('unlocked');

    if (!res.commandId || !supabaseBrowser) {
      // Demo mode — no real ACK
      setCmdState((prev) => ({ ...prev, [type]: 'executed' }));
      setResult(res);
      clearCmdState(type);
      return;
    }

    // Real ACK: wait for vehicle UPDATE event
    let cleanupFn: (() => void) | null = null;
    cleanupFn = subscribeACK(res.commandId, (ackStatus, reason) => {
      if (cleanupFn) { cleanupSet.current.delete(cleanupFn); cleanupFn = null; }
      if (!mountedRef.current) return;
      if (ackStatus !== 'executed') {
        // Revert optimistic lock on failure/timeout
        if (type === 'lock' || type === 'unlock') setLockStatus('unknown');
      }
      const ackMsg = ackStatus === 'executed'
        ? `${type} komutu başarıyla uygulandı`
        : ackStatus === 'timeout'
        ? 'Araç yanıt vermedi (15s zaman aşımı)'
        : `Komut başarısız: ${reason ?? 'bilinmeyen hata'}`;
      setCmdState((prev) => ({ ...prev, [type]: ackStatus }));
      setResult({ ok: ackStatus === 'executed', msg: ackMsg });
      clearCmdState(type);
    });
    cleanupSet.current.add(cleanupFn);
  }, [vehicleId, cmdState, clearCmdState]);

  const handleNav = useCallback(() => {
    if (!navDest.trim()) return;
    void dispatch('navigate', { destination: navDest.trim() });
    setNavDest('');
    setShowNav(false);
  }, [navDest, dispatch]);

  /* ── Lock state header ─────────────────────────────────── */
  const lockColor = lockStatus === 'locked' ? '#ef4444' : lockStatus === 'unlocked' ? '#34d399' : '#ffffff30';
  const lockLabel = lockStatus === 'locked' ? 'KİLİTLİ' : lockStatus === 'unlocked' ? 'AÇIK' : 'BİLİNMİYOR';

  return (
    <div className="flex flex-col gap-4">

      {/* Lock state display */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
        style={{
          background: `${lockColor}08`,
          border:     `1px solid ${lockColor}22`,
        }}
      >
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{
            background: lockColor,
            boxShadow:  lockStatus !== 'unknown' ? `0 0 6px ${lockColor}, 0 0 14px ${lockColor}50` : 'none',
          }}
        />
        <span className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: lockColor }}>
          Araç Durumu: {lockLabel}
        </span>
      </div>

      {/* Kilitle / Aç / Korna */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { type: 'lock'   as CommandType, label: 'Kilitle', Icon: LockIcon,   accent: '#ef4444' },
          { type: 'unlock' as CommandType, label: 'Aç',      Icon: UnlockIcon, accent: '#34d399' },
          { type: 'honk'   as CommandType, label: 'Korna',   Icon: HornIcon,   accent: '#fbbf24' },
        ]).map(({ type, label, Icon, accent }) => {
          const ack          = cmdState[type];
          const isPending    = ack === 'pending';
          const isExecuted   = ack === 'executed';
          const isFailed     = ack === 'failed' || ack === 'timeout';
          const isLockActive = !ack && ((type === 'lock' && lockStatus === 'locked') || (type === 'unlock' && lockStatus === 'unlocked'));

          const borderColor = isExecuted ? '#34d399' : isFailed ? '#ef4444' : isLockActive ? accent : accent;
          const borderAlpha = isExecuted || isFailed ? '80' : isLockActive ? '50' : '22';
          const bgAlpha     = isExecuted || isFailed ? '12' : isLockActive ? '15' : '08';
          const glowColor   = isExecuted ? '#34d399' : isFailed ? '#ef4444' : accent;

          return (
            <CommandButton
              key={type}
              type={type}
              label={label}
              Icon={Icon}
              accent={accent}
              isPending={isPending}
              borderColor={`${borderColor}${borderAlpha}`}
              bgColor={`${isExecuted ? '#34d399' : isFailed ? '#ef4444' : accent}${bgAlpha}`}
              boxShadow={(isLockActive || isExecuted || isFailed) ? `0 0 16px ${glowColor}30, 0 0 6px ${glowColor}15 inset` : 'none'}
              disabled={isPending}
              onClick={() => void dispatch(type)}
            />
          );
        })}
      </div>

      {/* Send-to-Car navigasyon */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => setShowNav((v) => !v)}
          disabled={cmdState['navigate'] === 'pending'}
          className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 active:scale-[0.98] disabled:opacity-40 group"
          style={{
            background: showNav ? 'rgba(96,165,250,0.12)' : 'rgba(96,165,250,0.07)',
            border:     `1px solid rgba(96,165,250,${showNav ? '0.35' : '0.18'})`,
            boxShadow:  showNav ? '0 0 20px rgba(96,165,250,0.12)' : 'none',
          }}
        >
          {cmdState['navigate'] === 'pending' ? <SpinIcon /> : <NavIcon />}
          <span className="text-[11px] font-black uppercase tracking-[0.28em] text-blue-400">
            Navigasyon Gönder
          </span>
          <span
            className="ml-auto text-[10px] font-mono text-blue-400/50 transition-transform duration-200"
            style={{ transform: showNav ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ›
          </span>
        </button>

        {showNav && (
          <div
            className="flex gap-2"
            style={{ animation: 'slideUp 0.2s ease-out' }}
          >
            <input
              type="text"
              value={navDest}
              onChange={(e) => setNavDest(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNav()}
              placeholder="Hedef adres veya yer adı…"
              className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white/80 placeholder:text-white/20 bg-white/[0.04] border border-white/[0.08] focus:border-blue-500/40 focus:outline-none transition-colors"
            />
            <button
              onClick={handleNav}
              disabled={!navDest.trim() || cmdState['navigate'] === 'pending'}
              className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-400 disabled:opacity-40 transition-all active:scale-95"
              style={{
                background: 'rgba(96,165,250,0.1)',
                border:     '1px solid rgba(96,165,250,0.22)',
              }}
            >
              Gönder
            </button>
          </div>
        )}
      </div>

      {/* Sonuç banner */}
      {result && (
        <div
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
          style={{
            background: result.ok ? 'rgba(52,211,153,0.07)' : 'rgba(239,68,68,0.07)',
            border:     `1px solid ${result.ok ? 'rgba(52,211,153,0.22)' : 'rgba(239,68,68,0.22)'}`,
            animation:  'slideUp 0.2s ease-out',
          }}
        >
          {result.ok ? <OkIcon /> : <ErrIcon />}
          <span className="text-xs" style={{ color: result.ok ? '#34d399' : '#f87171' }}>
            {result.msg}
          </span>
        </div>
      )}
    </div>
  );
}
