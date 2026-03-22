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

/** Detected driving context. */
export type DrivingMode = 'driving' | 'parked';

/** A single contextual quick-action suggestion. */
export interface QuickAction {
  id:    string;  // unique key
  label: string;
  icon:  string;
  appId: string;  // target for onLaunch()
}

/** Full computed smart state. */
export interface SmartSnapshot {
  layoutWeights: LayoutWeights;
  quickActions:  QuickAction[];
  drivingMode:   DrivingMode;
  dockIds:       string[];  // up to 4, usage-ranked
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
 * Heuristic: Bluetooth connected AND charging → likely plugged into car.
 *
 * Native upgrade path: query Android CarInfo.getCurrentDrivingState()
 * via CarLauncherPlugin to get authoritative DRIVING / IDLING / PARKED states.
 */
export function detectDrivingMode(
  device: Pick<DeviceStatus, 'btConnected' | 'charging'>,
): DrivingMode {
  return device.btConnected && device.charging ? 'driving' : 'parked';
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
  device:       Pick<DeviceStatus, 'btConnected' | 'charging' | 'ready'>;
  favorites:    string[];
  defaultNav:   NavOptionKey;
  defaultMusic: MusicOptionKey;
};

function buildSnapshot(p: SmartParams): SmartSnapshot {
  const map = pruneIfStale(loadUsage());
  return {
    layoutWeights: computeLayoutWeights(map),
    quickActions:  computeQuickActions(map, p.defaultNav, p.defaultMusic, p.favorites),
    drivingMode:   detectDrivingMode(p.device),
    dockIds:       computeDockIds(map, p.favorites),
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
  device:       Pick<DeviceStatus, 'btConnected' | 'charging' | 'ready'>,
  favorites:    string[],
  defaultNav:   NavOptionKey,
  defaultMusic: MusicOptionKey,
): SmartSnapshot {
  const [snapshot, setSnapshot] = useState<SmartSnapshot>(() =>
    buildSnapshot({ device, favorites, defaultNav, defaultMusic }),
  );

  // Ref always holds latest params — avoids stale closures in the listener below
  const paramsRef = useRef<SmartParams>({ device, favorites, defaultNav, defaultMusic });
  useEffect(() => {
    paramsRef.current = { device, favorites, defaultNav, defaultMusic };
  });

  // Recompute when device signals or user preferences change
  useEffect(() => {
    if (!device.ready) return;
    setSnapshot(buildSnapshot(paramsRef.current));
  // Primitive dep comparisons are intentional (object spread avoids identity check)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.btConnected, device.charging, device.ready, favorites, defaultNav, defaultMusic]);

  // Recompute immediately after each tracked launch
  useEffect(() => {
    const refresh = () => setSnapshot(buildSnapshot(paramsRef.current));
    _listeners.add(refresh);
    return () => { _listeners.delete(refresh); };
  }, []);

  return snapshot;
}
