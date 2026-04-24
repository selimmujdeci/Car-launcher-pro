/**
 * OBD Alert Engine — rule-based smart alerts for driving safety.
 *
 * Architecture:
 *  - Module-level, auto-subscribes to OBD data on first import (no manual init)
 *  - Pure rule evaluation: active() / resolved() with hysteresis per alert type
 *  - Cooldown after each alert clears (prevents flicker)
 *  - No timers inside React; useOBDAlerts() only subscribes to push state
 */

import { useState, useEffect } from 'react';
import { onOBDData } from './obdService';
import type { OBDData } from './obdService';

/* ── Types ───────────────────────────────────────────────── */

export type AlertSeverity = 'warning' | 'critical';

export interface OBDAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  suggestion: string;
}

/* ── Alert rules ─────────────────────────────────────────── */

interface AlertRule {
  id: string;
  severity: AlertSeverity;
  title: string;
  suggestion: string;
  /** Threshold to trigger the alert */
  active: (d: OBDData) => boolean;
  /** Threshold to clear it (hysteresis prevents oscillation) */
  resolved: (d: OBDData) => boolean;
}

const RULES: AlertRule[] = [
  // ── Speed ──────────────────────────────────────────────
  {
    id: 'speed_critical',
    severity: 'critical',
    title: 'Hız çok yüksek',
    suggestion: 'Hemen yavaşlayın.',
    active:   (d) => d.speed > 150,
    resolved: (d) => d.speed < 140,
  },
  {
    id: 'speed_warning',
    severity: 'warning',
    title: 'Yüksek hız',
    suggestion: 'Hız sınırına dikkat edin.',
    active:   (d) => d.speed > 120 && d.speed <= 150,
    resolved: (d) => d.speed < 115,
  },

  // ── Engine temperature ─────────────────────────────────
  {
    id: 'temp_critical',
    severity: 'critical',
    title: 'Motor aşırı ısındı',
    suggestion: 'Durarak motoru soğutun.',
    active:   (d) => d.engineTemp > 105,
    resolved: (d) => d.engineTemp < 100,
  },
  {
    id: 'temp_warning',
    severity: 'warning',
    title: 'Motor sıcaklığı yüksek',
    suggestion: 'Soğutma sistemini kontrol edin.',
    active:   (d) => d.engineTemp > 98 && d.engineTemp <= 105,
    resolved: (d) => d.engineTemp < 95,
  },

  // ── Fuel ───────────────────────────────────────────────
  {
    id: 'fuel_critical',
    severity: 'critical',
    title: 'Yakıt kritik seviyede',
    suggestion: 'En yakın istasyona yönelin.',
    active:   (d) => d.fuelLevel < 5,
    resolved: (d) => d.fuelLevel > 8,
  },
  {
    id: 'fuel_warning',
    severity: 'warning',
    title: 'Yakıt azaldı',
    suggestion: 'Yakıt ikmali yapmanız önerilir.',
    active:   (d) => d.fuelLevel >= 5 && d.fuelLevel < 15,
    resolved: (d) => d.fuelLevel > 18,
  },
];

/* ── Module state ────────────────────────────────────────── */

let _alerts: OBDAlert[]       = [];
const _alertListeners         = new Set<(a: OBDAlert[]) => void>();
/** Timestamp of when each alert last *cleared* — used for cooldown. */
const _clearedAt              = new Map<string, number>();
const COOLDOWN_MS             = 30_000; // 30 s before same alert can re-appear

function _notify(): void {
  const snap = [..._alerts];
  _alertListeners.forEach((fn) => fn(snap));
}

/* ── Evaluation ──────────────────────────────────────────── */

function _evaluate(data: OBDData): void {
  // No alerts while not connected
  if (data.connectionState !== 'connected') {
    if (_alerts.length > 0) {
      _alerts = [];
      _notify();
    }
    return;
  }

  const activeIds = new Set(_alerts.map((a) => a.id));
  let changed     = false;

  for (const rule of RULES) {
    const isActive = activeIds.has(rule.id);

    if (isActive) {
      // Condition cleared?
      if (rule.resolved(data)) {
        _alerts  = _alerts.filter((a) => a.id !== rule.id);
        _clearedAt.set(rule.id, performance.now());
        changed  = true;
      }
    } else {
      // Condition newly met?
      if (rule.active(data)) {
        const lastCleared = _clearedAt.get(rule.id) ?? 0;
        const offCooldown = performance.now() - lastCleared > COOLDOWN_MS;
        if (offCooldown) {
          _alerts = [
            ..._alerts,
            { id: rule.id, severity: rule.severity, title: rule.title, suggestion: rule.suggestion },
          ];
          changed = true;
        }
      }
    }
  }

  if (changed) _notify();
}

/* ── Auto-subscribe on module load ───────────────────────── */

onOBDData(_evaluate);

/* ── React hook ──────────────────────────────────────────── */

export function useOBDAlerts(): OBDAlert[] {
  const [alerts, setAlerts] = useState<OBDAlert[]>(() => [..._alerts]);

  useEffect(() => {
    setAlerts([..._alerts]);
    _alertListeners.add(setAlerts);
    return () => { _alertListeners.delete(setAlerts); };
  }, []);

  return alerts;
}
