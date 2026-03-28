/**
 * Smart Engine — local AI-like intelligence for Car Launcher Pro.
 *
 * 100 % local — no external services or network calls.
 *
 * Capabilities:
 *   1. Tracks per-app usage (count, recency, recent-24h count)
 *   2. Derives NavHero / MediaPanel layout flex weights from usage patterns
 *   3. Generates contextual quick-action recommendations
 *   4. Detects driving vs parked mode from device signals
 *   5. Ranks dock candidates by usage score
 *
 * Native migration notes:
 *   - detectDrivingMode(): replace heuristic with Android
 *     CarInfo.getCurrentDrivingState() via CarLauncherPlugin
 *   - trackLaunch(): supplement with Android app-usage stats
 *     (UsageStatsManager) for cross-session accuracy
 */
import { useState, useEffect, useRef } from 'react';
import type { DeviceStatus } from './deviceApi';
import type { NavOptionKey, MusicOptionKey } from '../data/apps';
import { onOBDData } from './obdService';
import { getConfig } from './performanceMode';

/* ── Types ───────────────────────────────────────────────── */

export interface UsageRecord {
  count:       number;   // total lifetime launches
  recentCount: number;   // launches in current 24-h window
  lastUsed:    number;   // epoch ms; 0 = never
}

export type UsageMap = Record<string, UsageRecord>;

/** Flex weights for the hero row — drives NavHero / MediaPanel sizing. */
export interface LayoutWeights {
  navFlex:   2 | 3 | 4;
  mediaFlex: 1 | 2 | 3;
}

/** Detected driving context — 3-level mode system based on vehicle speed. */
export type DrivingMode = 'idle' | 'normal' | 'driving';

/** A single contextual quick-action suggestion. */
export interface QuickAction {
  id:    string;  // unique key
  label: string;
  icon:  string;
  appId: string;  // target for onLaunch()
}

/** AI-powered recommendation. */
export interface SmartRecommendation {
  type: 'app' | 'theme-pack' | 'sleep-mode' | 'theme-style';
  reason: string;  // "morning_high_nav" | "driving_mode_active" | "idle_rich_theme" etc.
  value: string;   // app ID, 'tesla'/'big-cards'/'ai-center', 'true', 'glass'/'neon'/'minimal'
  confidence: number;  // 0.0–1.0
  autoApply: boolean;  // true only for safe recommendations (driving mode)
}

/** Full computed smart state. */
export interface SmartSnapshot {
  layoutWeights:  LayoutWeights;
  quickActions:   QuickAction[];
  drivingMode:    DrivingMode;
  dockIds:        string[];  // up to 4, usage-ranked
  recommendation?: SmartRecommendation;  // single highest-confidence recommendation
  /** True when music is actively playing — media panel should be visually prominent. */
  mediaProminent: boolean;
  /** True when an active navigation route exists — map/nav section takes priority. */
  mapPriority:    boolean;
}

/* ── Persistence ─────────────────────────────────────────── */

const USAGE_KEY = 'cl_usageMap';
const PRUNE_KEY = 'cl_usagePruneTs';
const DAY_MS    = 86_400_000;

function loadUsage(): UsageMap {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    return raw ? (JSON.parse(raw) as UsageMap) : {};
  } catch {
    return {};
  }
}

function saveUsage(map: UsageMap): void {
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(map)); } catch { /* quota full */ }
}

/** Reset recentCount for all apps once per 24-h window. */
function pruneIfStale(map: UsageMap): UsageMap {
  const lastPrune = Number(localStorage.getItem(PRUNE_KEY) ?? 0);
  if (Date.now() - lastPrune < DAY_MS) return map;
  const pruned: UsageMap = {};
  for (const [id, rec] of Object.entries(map)) {
    pruned[id] = { ...rec, recentCount: 0 };
  }
  try { localStorage.setItem(PRUNE_KEY, String(Date.now())); } catch { /* ignore */ }
  return pruned;
}

/* ── Usage change bus ────────────────────────────────────── */

const _listeners = new Set<() => void>();

function notifyListeners(): void {
  _listeners.forEach((fn) => fn());
}

/* ── Public: record a launch ─────────────────────────────── */

/**
 * Call this every time the user opens an app.
 * Updates localStorage and immediately notifies all `useSmartEngine` hooks.
 */
export function trackLaunch(appId: string): void {
  const map  = pruneIfStale(loadUsage());
  const prev = map[appId] ?? { count: 0, recentCount: 0, lastUsed: 0 };
  saveUsage({
    ...map,
    [appId]: {
      count:       prev.count + 1,
      recentCount: prev.recentCount + 1,
      lastUsed:    Date.now(),
    },
  });
  notifyListeners();
}

/* ── Scoring ─────────────────────────────────────────────── */

/**
 * Composite score: lifetime count (30 %) + 24-h count (50 %) + recency decay (20 %).
 * Recency bonus fades linearly to 0 over 24 h.
 */
function score(rec: UsageRecord | undefined): number {
  if (!rec) return 0;
  const recency = rec.lastUsed > 0
    ? Math.max(0, 1 - (Date.now() - rec.lastUsed) / DAY_MS)
    : 0;
  return rec.count * 0.3 + rec.recentCount * 0.5 + recency * 0.2;
}

/* ── Layout weights ──────────────────────────────────────── */

const NAV_IDS   = ['maps', 'waze'];
const MEDIA_IDS = ['spotify', 'youtube'];

function computeLayoutWeights(map: UsageMap): LayoutWeights {
  const nav   = NAV_IDS.reduce((s, id)   => s + score(map[id]), 0);
  const media = MEDIA_IDS.reduce((s, id) => s + score(map[id]), 0);
  // 60 % dominance threshold for asymmetric layout
  if (nav   > media * 1.6) return { navFlex: 4, mediaFlex: 1 };
  if (media > nav   * 1.6) return { navFlex: 2, mediaFlex: 3 };
  return { navFlex: 3, mediaFlex: 2 };
}

/* ── Time context ────────────────────────────────────────── */

type TimeContext = 'morning' | 'afternoon' | 'evening' | 'night';

function getTimeContext(): TimeContext {
  const h = new Date().getHours();
  if (h >= 6  && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

/**
 * Time-of-day bias added on top of the usage score.
 * Kept small (≤ 0.4) so real usage history always wins over time heuristics.
 *
 * morning   → commute: boost nav
 * afternoon → casual: mild media boost
 * evening   → relaxation: boost media, softer nav
 * night     → checking in: boost phone / messages
 */
const TIME_BIAS: Record<TimeContext, Partial<Record<string, number>>> = {
  morning:   { maps: 0.4, waze: 0.4, phone: 0.15 },
  afternoon: { spotify: 0.2, youtube: 0.15 },
  evening:   { spotify: 0.35, youtube: 0.25, maps: 0.15 },
  night:     { phone: 0.3, messages: 0.3, spotify: 0.15 },
};

function timedScore(id: string, map: UsageMap, ctx: TimeContext): number {
  return score(map[id]) + (TIME_BIAS[ctx][id] ?? 0);
}

/* ── AI Recommendations Engine ────────────────────────────────── */

interface RecommendationCandidate {
  rec: SmartRecommendation;
  score: number;
}

let _lastRecommendationTime = 0;

function shouldGenerateNow(): boolean {
  const cfg = getConfig();
  if (!cfg.enableRecommendations) return false;
  const elapsed = Date.now() - _lastRecommendationTime;
  return elapsed >= cfg.recCooldownMs;
}

/**
 * Generate a single high-confidence recommendation based on:
 *   - Time of day + usage patterns
 *   - Current driving mode
 *   - Respects performance mode cooldown
 * Returns undefined if cooldown not met or recommendations disabled.
 */
function generateRecommendation(
  map: UsageMap,
  timeContext: TimeContext,
  drivingMode: DrivingMode,
): SmartRecommendation | undefined {
  if (!shouldGenerateNow()) return;

  const candidates: RecommendationCandidate[] = [];

  // ── Driving mode: minimal UI
  if (drivingMode === 'driving') {
    candidates.push({
      rec: {
        type: 'theme-style',
        reason: 'driving_mode_minimal_ui',
        value: 'minimal',
        confidence: 0.95,
        autoApply: true,
      },
      score: 0.95,
    });
  }

  // ── Idle mode: rich theme based on usage
  if (drivingMode === 'idle') {
    const navScore = score(map.maps) + score(map.waze);
    const musicScore = score(map.spotify) + score(map.youtube);

    if (navScore > musicScore + 0.5) {
      candidates.push({
        rec: {
          type: 'theme-pack',
          reason: 'idle_high_nav_usage',
          value: 'big-cards',
          confidence: 0.7,
          autoApply: false,
        },
        score: 0.7,
      });
    } else if (musicScore > navScore + 0.5) {
      candidates.push({
        rec: {
          type: 'theme-pack',
          reason: 'idle_high_music_usage',
          value: 'ai-center',
          confidence: 0.65,
          autoApply: false,
        },
        score: 0.65,
      });
    }
  }

  // ── Time context: Morning → commute
  if (timeContext === 'morning') {
    const navScore = timedScore('maps', map, timeContext) + timedScore('waze', map, timeContext);
    if (navScore > 0.8) {
      candidates.push({
        rec: {
          type: 'app',
          reason: 'morning_commute_pattern',
          value: timedScore('maps', map, timeContext) > timedScore('waze', map, timeContext) ? 'maps' : 'waze',
          confidence: 0.75,
          autoApply: false,
        },
        score: 0.75,
      });
    }
  }

  // ── Time context: Evening → entertainment
  if (timeContext === 'evening') {
    const musicScore = timedScore('spotify', map, timeContext) + timedScore('youtube', map, timeContext);
    if (musicScore > 0.7) {
      candidates.push({
        rec: {
          type: 'app',
          reason: 'evening_entertainment_pattern',
          value: timedScore('spotify', map, timeContext) > timedScore('youtube', map, timeContext) ? 'spotify' : 'youtube',
          confidence: 0.7,
          autoApply: false,
        },
        score: 0.7,
      });
    }
  }

  // ── Low activity + idle: sleep mode
  const totalRecentUsage = Object.values(map).reduce((sum, rec) => sum + rec.recentCount, 0);
  if (totalRecentUsage === 0 && drivingMode === 'idle') {
    candidates.push({
      rec: {
        type: 'sleep-mode',
        reason: 'low_activity_idle',
        value: 'true',
        confidence: 0.35,
        autoApply: false,
      },
      score: 0.35,
    });
  }

  // Pick best candidate
  if (candidates.length === 0) return;
  const best = candidates.reduce((a, b) => b.score - a.score > 0 ? b : a);

  // Only return if confidence high enough
  if (best.rec.confidence < 0.4) return;

  _lastRecommendationTime = Date.now();
  return best.rec;
}

/* ── Quick actions ───────────────────────────────────────── */

function computeQuickActions(
  map:          UsageMap,
  defaultNav:   NavOptionKey,
  defaultMusic: MusicOptionKey,
  favorites:    string[],
): QuickAction[] {
  const actions: QuickAction[] = [];
  const exclude = new Set([...NAV_IDS, ...MEDIA_IDS]);
  const ctx     = getTimeContext();

  // 1. Lead action: nav in morning/afternoon, music otherwise
  const navFirst = ctx === 'morning' || ctx === 'afternoon'
    ? timedScore(defaultNav, map, ctx) >= timedScore(defaultMusic, map, ctx)
    : timedScore(defaultMusic, map, ctx) < timedScore(defaultNav, map, ctx);

  if (navFirst) {
    actions.push({ id: 'go-home', label: 'Eve Git', icon: '🏠', appId: defaultNav });
    const musicRec    = map[defaultMusic];
    const recentMusic = musicRec && Date.now() - musicRec.lastUsed < 1_800_000;
    if (!recentMusic) {
      actions.push({ id: 'open-music', label: 'Müziği Aç', icon: '🎵', appId: defaultMusic });
    }
  } else {
    const musicRec    = map[defaultMusic];
    const recentMusic = musicRec && Date.now() - musicRec.lastUsed < 1_800_000;
    if (!recentMusic) {
      actions.push({ id: 'open-music', label: 'Müziği Aç', icon: '🎵', appId: defaultMusic });
    }
    actions.push({ id: 'go-home', label: 'Eve Git', icon: '🏠', appId: defaultNav });
  }

  // 2. Most recently used non-nav / non-media app
  const lastEntry = Object.entries(map)
    .filter(([id]) => !exclude.has(id) && (map[id]?.lastUsed ?? 0) > 0)
    .sort(([, a], [, b]) => b.lastUsed - a.lastUsed)[0];
  if (lastEntry) {
    actions.push({ id: `last-${lastEntry[0]}`, label: 'Son Uygulama', icon: '🕐', appId: lastEntry[0] });
  }

  // 3. Top-scored favorite (non-nav / non-media, not already shown)
  const shown  = new Set(actions.map((a) => a.appId));
  const topFav = favorites
    .filter((id) => !exclude.has(id) && !shown.has(id))
    .sort((a, b) => timedScore(b, map, ctx) - timedScore(a, map, ctx))[0];
  if (topFav) {
    actions.push({ id: `fav-${topFav}`, label: 'Favori', icon: '⭐', appId: topFav });
  }

  return actions.slice(0, 4);
}

/* ── Driving mode ────────────────────────────────────────── */

/**
 * OBD speed takes priority (speed > 5 km/h → driving, ≤ 3 km/h → parked).
 * Falls back to Bluetooth + charging heuristic when OBD data is unavailable.
 */
export function detectDrivingMode(
  device:    Pick<DeviceStatus, 'btConnected' | 'charging'>,
  obdSpeed?: number,
): DrivingMode {
  if (obdSpeed !== undefined) {
    // 3-level speed-based mode detection:
    // idle: 0 km/h (parked, premium animations)
    // normal: 0 < speed < 20 km/h (light traffic, moderate animations)
    // driving: >= 20 km/h (highway/city, minimal UI)
    if (obdSpeed === 0) return 'idle';
    if (obdSpeed < 20) return 'normal';
    return 'driving';
  }
  // Fallback heuristic: if BT connected + charging → likely parked (idle)
  return device.btConnected && device.charging ? 'idle' : 'normal';
}

/* ── Smart dock ──────────────────────────────────────────── */

const DOCK_POOL  = ['phone', 'maps', 'waze', 'spotify', 'youtube', 'browser', 'messages', 'weather'];
const DOCK_SLOTS = 4;

function computeDockIds(map: UsageMap, favorites: string[]): string[] {
  const seen       = new Set<string>();
  const candidates = [...favorites, ...DOCK_POOL].filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return candidates
    .sort((a, b) => score(map[b]) - score(map[a]))
    .slice(0, DOCK_SLOTS);
}

/* ── Snapshot builder ────────────────────────────────────── */

type SmartParams = {
  device:        Pick<DeviceStatus, 'btConnected' | 'charging' | 'ready'>;
  favorites:     string[];
  defaultNav:    NavOptionKey;
  defaultMusic:  MusicOptionKey;
  obdSpeed?:     number;
  /** GPS-derived speed (km/h). Used as fallback when OBD is not connected. */
  gpsSpeedKmh?:  number;
  /** Whether music is currently playing. */
  isPlaying?:    boolean;
  /** Whether an active navigation route exists. */
  isNavigating?: boolean;
};

function buildSnapshot(p: SmartParams, shouldGenerateRec: boolean = true): SmartSnapshot {
  const map = pruneIfStale(loadUsage());
  // OBD speed takes priority; GPS speed is the fallback.
  const effectiveSpeed = p.obdSpeed ?? (p.gpsSpeedKmh !== undefined ? p.gpsSpeedKmh : undefined);
  const drivingMode = detectDrivingMode(p.device, effectiveSpeed);
  const timeContext = getTimeContext();
  return {
    layoutWeights:  computeLayoutWeights(map),
    quickActions:   computeQuickActions(map, p.defaultNav, p.defaultMusic, p.favorites),
    drivingMode,
    dockIds:        computeDockIds(map, p.favorites),
    recommendation: shouldGenerateRec ? generateRecommendation(map, timeContext, drivingMode) : undefined,
    mediaProminent: p.isPlaying  === true,
    mapPriority:    p.isNavigating === true,
  };
}

/* ── React hook ──────────────────────────────────────────── */

/**
 * Subscribes to smart state. Recomputes when:
 *   - Device signals change (btConnected, charging, ready)
 *   - User preferences change (favorites, defaultNav, defaultMusic)
 *   - Any app is launched via trackLaunch()
 */
export function useSmartEngine(
  device:        Pick<DeviceStatus, 'btConnected' | 'charging' | 'ready'>,
  favorites:     string[],
  defaultNav:    NavOptionKey,
  defaultMusic:  MusicOptionKey,
  gpsSpeedKmh?:  number,
  isPlaying?:    boolean,
  isNavigating?: boolean,
): SmartSnapshot {
  const [snapshot, setSnapshot] = useState<SmartSnapshot>(() =>
    buildSnapshot({ device, favorites, defaultNav, defaultMusic, gpsSpeedKmh, isPlaying, isNavigating }),
  );

  // Ref always holds latest params — avoids stale closures in the listener below
  const paramsRef = useRef<SmartParams>({ device, favorites, defaultNav, defaultMusic, gpsSpeedKmh, isPlaying, isNavigating });
  useEffect(() => {
    paramsRef.current = { device, favorites, defaultNav, defaultMusic, gpsSpeedKmh, isPlaying, isNavigating };
  });

  // Recompute when device signals, user preferences, or live context changes
  useEffect(() => {
    if (!device.ready) return;
    setSnapshot(buildSnapshot(paramsRef.current, true));
  // Primitive dep comparisons are intentional (object spread avoids identity check)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.btConnected, device.charging, device.ready, favorites, defaultNav, defaultMusic, isPlaying, isNavigating]);

  // Recompute on OBD speed changes — heavily optimized, only on mode change
  useEffect(() => {
    const prevModeRef = { current: paramsRef.current.obdSpeed !== undefined
      ? detectDrivingMode({ btConnected: false, charging: false }, paramsRef.current.obdSpeed)
      : 'idle' as DrivingMode,
    };
    let lastNotifiedSpeed = paramsRef.current.obdSpeed ?? 0;
    return onOBDData((d) => {
      if (d.connectionState !== 'connected') return;
      // Filter noise: only rebuild if speed changes significantly (≥3 km/h)
      const speedChange = Math.abs(d.speed - lastNotifiedSpeed);
      if (speedChange < 3) {
        paramsRef.current = { ...paramsRef.current, obdSpeed: d.speed };
        return;
      }
      lastNotifiedSpeed = d.speed;
      const newMode: DrivingMode = detectDrivingMode({ btConnected: false, charging: false }, d.speed);
      const modeChanged = newMode !== prevModeRef.current;
      if (modeChanged) {
        // Hysteresis: slow down transitions to avoid jitter
        if (prevModeRef.current === 'idle' && newMode === 'normal' && d.speed < 3) return;
        if (prevModeRef.current === 'normal' && newMode === 'idle' && d.speed > 1) return;
        if (prevModeRef.current === 'normal' && newMode === 'driving' && d.speed < 15) return;
        if (prevModeRef.current === 'driving' && newMode === 'normal' && d.speed > 22) return;
        prevModeRef.current = newMode;
        paramsRef.current = { ...paramsRef.current, obdSpeed: d.speed };
        // Mode changed: rebuild snapshot WITH recommendation
        setSnapshot(buildSnapshot(paramsRef.current, true));
      } else {
        // Speed changed but mode unchanged: update obdSpeed WITHOUT recommendation
        paramsRef.current = { ...paramsRef.current, obdSpeed: d.speed };
      }
    });
  }, []);

  // GPS speed effect — drives mode when OBD is not connected
  useEffect(() => {
    if (gpsSpeedKmh === undefined) return;
    if (paramsRef.current.obdSpeed !== undefined) return; // OBD has priority
    const prev = paramsRef.current;
    const newMode = detectDrivingMode(prev.device, gpsSpeedKmh);
    const oldMode = detectDrivingMode(prev.device, prev.gpsSpeedKmh ?? 0);
    paramsRef.current = { ...prev, gpsSpeedKmh };
    if (newMode !== oldMode) {
      setSnapshot(buildSnapshot(paramsRef.current, true));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsSpeedKmh]);

  // Recompute after each tracked launch — WITH recommendation (usage changed)
  useEffect(() => {
    const refresh = () => setSnapshot(buildSnapshot(paramsRef.current, true));
    _listeners.add(refresh);
    return () => { _listeners.delete(refresh); };
  }, []);

  return snapshot;
}
