/**
 * Native Core Service — startup orchestration for Car Launcher Pro.
 *
 * Responsibilities:
 *   1. Read device hardware profile from native layer (getDeviceProfile)
 *   2. Auto-set performance mode based on device class (low/mid/high)
 *   3. Cache real screen metrics (more reliable than JS window.screen on head units)
 *   4. Provide React hooks for downstream consumers
 *
 * Call init() once at app startup (before React mounts, or in main.tsx).
 * All methods are safe to call on web/demo mode — they fall back gracefully.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from './nativePlugin';
import type { NativeDeviceProfile, NativeScreenMetrics } from './nativePlugin';
import { initFromDeviceProfile } from './performanceMode';
import { useState, useEffect } from 'react';

/* ── Module state ─────────────────────────────────────────── */

let _profile:       NativeDeviceProfile | null = null;
let _screenMetrics: NativeScreenMetrics | null = null;
let _ready          = false;

const _profileListeners = new Set<(p: NativeDeviceProfile | null) => void>();
const _metricsListeners = new Set<(m: NativeScreenMetrics | null) => void>();

/* ── Helpers ──────────────────────────────────────────────── */

function notifyProfile(): void  { _profileListeners.forEach(fn => fn(_profile)); }
function notifyMetrics(): void  { _metricsListeners.forEach(fn => fn(_screenMetrics)); }

/* ── Public: init ─────────────────────────────────────────── */

/**
 * Call once at app startup (non-blocking — fire and forget).
 * Safe to call multiple times; runs only once.
 */
export async function initNativeCore(): Promise<void> {
  if (_ready) return;
  _ready = true;

  if (!Capacitor.isNativePlatform()) return; // web/demo mode — skip

  // ── Device profile ────────────────────────────────────────
  try {
    const profile = await CarLauncher.getDeviceProfile();
    _profile = profile;
    notifyProfile();

    // Auto-set performance mode unless user has a manual override
    initFromDeviceProfile(profile.deviceClass);

    // Lite mode: disable heavy CSS effects immediately
    if (profile.deviceClass === 'low') {
      document.documentElement.classList.add('perf-lite');
    }
  } catch {
    // Native call failed — continue with defaults, no crash
  }

  // ── Screen metrics ────────────────────────────────────────
  try {
    const metrics = await CarLauncher.getScreenMetrics();
    _screenMetrics = metrics;
    notifyMetrics();

    // Inject as CSS variables so components can use them
    const root = document.documentElement;
    root.style.setProperty('--native-vw', `${metrics.widthPx}px`);
    root.style.setProperty('--native-vh', `${metrics.heightPx}px`);
    root.style.setProperty('--native-density', String(metrics.density));
  } catch {
    // Fallback — keep JS window dimensions
  }
}

/* ── Public: getters ──────────────────────────────────────── */

export function getDeviceProfile(): NativeDeviceProfile | null {
  return _profile;
}

export function getScreenMetrics(): NativeScreenMetrics | null {
  return _screenMetrics;
}

/* ── React hooks ──────────────────────────────────────────── */

export function useDeviceProfile(): NativeDeviceProfile | null {
  const [profile, setProfile] = useState<NativeDeviceProfile | null>(_profile);
  useEffect(() => {
    setProfile(_profile);
    _profileListeners.add(setProfile);
    return () => { _profileListeners.delete(setProfile); };
  }, []);
  return profile;
}

export function useScreenMetrics(): NativeScreenMetrics | null {
  const [metrics, setMetrics] = useState<NativeScreenMetrics | null>(_screenMetrics);
  useEffect(() => {
    setMetrics(_screenMetrics);
    _metricsListeners.add(setMetrics);
    return () => { _metricsListeners.delete(setMetrics); };
  }, []);
  return metrics;
}
