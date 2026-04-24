'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sendAndTrack } from '@/lib/commandService';
import { verifyCriticalCommand } from '@/lib/criticalAuth';
import type { CommandType, CommandPayload } from '@/lib/commandService';

export type CmdPhase = 'idle' | 'pending' | 'accepted' | 'executing' | 'ok' | 'err';

export interface CommandResult {
  type:       CommandType;
  ok:         boolean;
  label:      string;
  durationMs: number;
}

const CMD_LABELS: Record<CommandType, string> = {
  lock:              'Kapılar Kilitlendi',
  unlock:            'Kapılar Açıldı',
  horn:              'Korna Çalındı',
  alarm_on:          'Alarm Aktifleştirildi',
  alarm_off:         'Alarm Durduruldu',
  lights_on:         'Işıklar Açıldı',
  route_send:        'Rota Araca İletildi',
  navigation_start:  'Navigasyon Başlatıldı',
  theme_change:      'Tema Değiştirildi',
};

const CRITICAL_CMDS: CommandType[] = ['unlock'];

function haptic(pattern: number | number[]) {
  try { navigator?.vibrate?.(pattern); } catch {}
}

function playSuccessSound() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as Record<string, typeof AudioContext>)['webkitAudioContext'];
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 600);
  } catch {}
}

const BUSY: CmdPhase[] = ['pending', 'accepted', 'executing'];

export function useCommandTracker(vehicleId: string | null) {
  const [phases, setPhases]   = useState<Partial<Record<CommandType, CmdPhase>>>({});
  const [result, setResult]   = useState<CommandResult | null>(null);
  const mounted               = useRef(true);
  const cleanups              = useRef(new Set<() => void>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cleanups.current.forEach((fn) => fn());
    };
  }, []);

  const setPhase = useCallback((type: CommandType, phase: CmdPhase) => {
    if (mounted.current) setPhases((p) => ({ ...p, [type]: phase }));
  }, []);

  const dispatch = useCallback(async (type: CommandType, payload: CommandPayload = {}) => {
    if (!vehicleId) return;
    if (BUSY.includes(phases[type] ?? 'idle')) return;

    // Critical auth gate
    if (CRITICAL_CMDS.includes(type)) {
      const verified = await verifyCriticalCommand();
      if (!verified) return;
    }

    const startMs = Date.now();
    haptic(40);
    setPhase(type, 'pending');
    if (mounted.current) setResult(null);

    const { unsubscribe, result: sendResult } = await sendAndTrack(
      vehicleId, type, payload,
      (ev) => {
        if (!mounted.current) return;
        switch (ev.status) {
          case 'accepted':
            setPhase(type, 'accepted');
            break;
          case 'executing':
            setPhase(type, 'executing');
            break;
          case 'completed': {
            const ms = Date.now() - startMs;
            setPhase(type, 'ok');
            if (mounted.current) setResult({ type, ok: true, label: CMD_LABELS[type], durationMs: ms });
            haptic(50);
            playSuccessSound();
            setTimeout(() => setPhase(type, 'idle'), 2500);
            setTimeout(() => { if (mounted.current) setResult(null); }, 4500);
            break;
          }
          case 'failed':
          case 'expired':
          case 'rejected': {
            const ms = Date.now() - startMs;
            setPhase(type, 'err');
            if (mounted.current) setResult({ type, ok: false, label: CMD_LABELS[type], durationMs: ms });
            haptic([100, 50, 100]);
            setTimeout(() => setPhase(type, 'idle'), 2500);
            setTimeout(() => { if (mounted.current) setResult(null); }, 4500);
            break;
          }
        }
      },
      { requireCriticalAuth: CRITICAL_CMDS.includes(type) },
    );

    cleanups.current.add(unsubscribe);

    if (!sendResult.ok) {
      const ms = Date.now() - startMs;
      setPhase(type, 'err');
      if (mounted.current) setResult({ type, ok: false, label: CMD_LABELS[type], durationMs: ms });
      haptic([100, 50, 100]);
      setTimeout(() => setPhase(type, 'idle'), 2500);
      setTimeout(() => { if (mounted.current) setResult(null); }, 4500);
    }
  }, [vehicleId, phases, setPhase]);

  return { phases, result, dispatch };
}
