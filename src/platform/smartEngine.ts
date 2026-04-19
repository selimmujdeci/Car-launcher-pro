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

/* ── Accelerometer motion detection ─────────────────────────
 *
 * DeviceMotionEvent'in yatay bileşeni (yerçekimi hariç) araç hareketini
 * GPS/OBD olmadan tespit eder: fren, ivme, viraj → DrivingMode='normal'.
 *
 * Güvenlik: sadece pasif dinleyici (passive:true), UI thread'i bloklamaz.
 * Hassasiyet: 2.5 m/s² ≈ 0.25g — rahat sürüş değişimlerini yakalar.
 */

let _accelMagnitude  = 0;    // yerçekimsiz yatay ivme büyüklüğü (m/s²)
let _accelAttached   = false;

function _handleDeviceMotion(e: DeviceMotionEvent): void {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const raw = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);
  // Yerçekimini (~9.81 m/s²) çıkar — yalnızca dinamik ivme kalmak için
  _accelMagnitude = Math.abs(raw - 9.81);
}

/** Accelerometer'ı bir kez global olarak bağla. Hook mount edildiğinde çağrılır. */
export function attachAccelerometer(): void {
  if (_accelAttached || typeof window === 'undefined' || !window.DeviceMotionEvent) return;
  _accelAttached = true;
  window.addEventListener('devicemotion', _handleDeviceMotion, { passive: true });
}

/* ── Hız kademesi tahmini (Speed decay) ──────────────────────
 *
 * OBD veya GPS bağlantısı kesildiğinde son bilinen hız zamanla azaltılır.
 * Araç durdu mu yoksa yalnızca bağlantı mı kesildi bilgisini ayrıştırır.
 *
 * Bozulma katsayısı: saniyede %8 — 20 sn sonra hız 0'a inmiş sayılır.
 * (Trafik ışığı bekleme süresi ~45 sn → bu aralıkta 'idle' geçişi beklenir.)
 */
const DECAY_RATE_PER_S   = 0.92;   // saniyede %8 düşüş
const DECAY_MAX_SEC      = 20;     // bu süreden sonra hız=0 kabul edilir
const ACCEL_MOTION_MS2   = 2.5;    // m/s² — hareket eşiği

interface _SpeedEstimate {
  kmh:  number;
  tsMs: number;
}

let _lastSpeedEstimate: _SpeedEstimate | null = null;

function _recordSpeed(kmh: number): void {
  _lastSpeedEstimate = { kmh, tsMs: Date.now() };
}

function _decayedSpeed(): number | undefined {
  if (!_lastSpeedEstimate) return undefined;
  const ageSec = (Date.now() - _lastSpeedEstimate.tsMs) / 1000;
  if (ageSec > DECAY_MAX_SEC) return 0;
  return Math.round(_lastSpeedEstimate.kmh * Math.pow(DECAY_RATE_PER_S, ageSec));
}

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

const MAX_USAGE_ENTRIES = 200;

function saveUsage(map: UsageMap): void {
  let toSave = map;
  const keys = Object.keys(map);
  if (keys.length > MAX_USAGE_ENTRIES) {
    // Keep the 200 most recently used entries
    const sorted = keys.sort((a, b) => (map[b]?.lastUsed ?? 0) - (map[a]?.lastUsed ?? 0));
    toSave = Object.fromEntries(sorted.slice(0, MAX_USAGE_ENTRIES).map((k) => [k, map[k]])) as UsageMap;
  }
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(toSave)); } catch { /* quota full */ }
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

/* ── Usage cache — avoids repeated localStorage.getItem + JSON.parse ── */

let _usageCache: UsageMap | null = null;

function getCachedUsage(): UsageMap {
  if (!_usageCache) {
    _usageCache = pruneIfStale(loadUsage());
  }
  return _usageCache;
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
  _usageCache = null; // invalidate cache so next buildSnapshot re-reads
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

  // ── Driving mode: minimal UI ─────────────────────────────────────────
  // Sürüş güvenliği: karmaşık glassmorphism efektleri sürücü dikkatini
  // dağıtır. Minimal tema → daha az görsel gürültü, daha hızlı bilgi işleme.
  // autoApply: true — güvenlik-kritik, kullanıcı onayı beklenmez.
  // confidence: 0.97 — neredeyse kesin; sürüş modu tespit edildi.
  if (drivingMode === 'driving') {
    candidates.push({
      rec: {
        type: 'theme-style',
        reason: 'driving_safety_minimal_ui',
        value: 'minimal',
        confidence: 0.97,
        autoApply: true,
      },
      score: 0.97,
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
 * 5-kademeli sensör hiyerarşisi ile sürüş modu tespiti.
 *
 * Hiyerarşi (güvenilirlik sırası):
 *   1. OBD hızı    — CAN bus / tekerlek enkoderi, gecikme: 3 s, hata: ±0 km/h
 *   2. GPS hızı    — Doppler ölçümü, bağımsız, EMA filtreli, hata: ±2 km/h
 *   3. Decay hızı  — Son bilinen hız üstel bozulma ile (20 s'de sıfıra iner)
 *   4. İvmeölçer   — GPS/OBD tamamen yoksa hareket tespiti
 *   5. BT + şarj   — Yalnızca hiçbir hız sinyali yoksa; güvenilirlik: düşük
 *
 * ISO 26262 "fail towards safety" prensibi:
 *   Herhangi bir kaynaktan hız > 5 km/h geliyorsa araç hareket halindedir.
 *   Bu durumda alt kademeler bile 'idle' dönemez ("isDefinitelyMoving" guard).
 *
 * Mod eşikleri (km/h):
 *   idle:    speed <  1  (park, zengin animasyonlar)
 *   normal:  1 ≤ speed < 20  (şehir/trafik, orta animasyon)
 *   driving: speed ≥ 20  (yol/otoyol, minimal UI — sürücü güvenliği)
 *
 * @param device    BT bağlantısı ve şarj durumu (Kademe 5 sezgiseli için)
 * @param obdSpeed  OBD hızı km/h — undefined ise bu kademe atlanır
 * @param gpsSpeed  GPS hızı km/h — undefined ise bu kademe atlanır
 */
export function detectDrivingMode(
  device:    Pick<DeviceStatus, 'btConnected' | 'charging'>,
  obdSpeed?: number,
  gpsSpeed?: number,
): DrivingMode {
  // ── ISO 26262 Güvenlik Prensibi: Hız > 5 km/h → kesinlikle hareket ──
  // OBD veya GPS ayrı ayrı > 5 bildirebilir; ikisi çakışsa bile hareket
  // kabul edilir (sensör arızasında "güvenli taraf" = hareket).
  const decayed = _decayedSpeed();
  const isDefinitelyMoving =
    (obdSpeed !== undefined && obdSpeed > 5) ||
    (gpsSpeed !== undefined && gpsSpeed > 5) ||
    (decayed  !== undefined && decayed  > 5);

  // En güvenilir mevcut hızı decay kaydına al
  const speedToRecord = obdSpeed ?? gpsSpeed;
  if (speedToRecord !== undefined) _recordSpeed(speedToRecord);

  // ── Kademe 1: OBD hızı (CAN bus / tekerlek enkoderi — en güvenilir) ─
  if (obdSpeed !== undefined) {
    if (obdSpeed < 1 && !isDefinitelyMoving) return 'idle';
    if (obdSpeed < 20) return 'normal';
    return 'driving';
  }

  // ── Kademe 2: GPS hızı (Doppler — bağımsız kaynak, EMA filtreli) ────
  if (gpsSpeed !== undefined) {
    if (gpsSpeed < 1 && !isDefinitelyMoving) return 'idle';
    if (gpsSpeed < 20) return 'normal';
    return 'driving';
  }

  // ── Kademe 3: Zaman-kademeli son bilinen hız ─────────────────────────
  // Bağlantı geçici kesildi ama araç hâlâ hareket ediyor olabilir.
  if (decayed !== undefined) {
    if (decayed < 1 && !isDefinitelyMoving) return 'idle';
    if (decayed < 20) return 'normal';
    return 'driving';
  }

  // ── Kademe 4: İvmeölçer büyüklüğü ───────────────────────────────────
  // 2.5 m/s² ≈ hafif fren/ivme — GPS/OBD yokken hareket kanıtı.
  if (_accelMagnitude > ACCEL_MOTION_MS2) return 'normal';

  // ── Kademe 5: BT + şarj sezgiseli (son çare, güvenilirlik: düşük) ───
  // Yalnızca hiçbir hız sinyali gelmediğinde çalışır.
  // GÜVENLIK: isDefinitelyMoving true ise bu kademe bile 'idle' dönemez.
  if (isDefinitelyMoving) return 'normal';
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

/**
 * Issue 3 — Priority Matrix
 *
 * Aynı anda hem navigasyon hem müzik aktif olabilir. Öncelik tablosu:
 *
 * ┌─────────────────┬──────────────┬──────────────────────────────────┐
 * │ isNavigating    │ isPlaying    │ Sonuç                            │
 * ├─────────────────┼──────────────┼──────────────────────────────────┤
 * │ true            │ true         │ mapPriority=true, media=false *  │
 * │ true            │ false        │ mapPriority=true, media=false    │
 * │ false           │ true         │ mapPriority=false, media=true    │
 * │ false           │ false        │ mapPriority=false, media=false   │
 * └─────────────────┴──────────────┴──────────────────────────────────┘
 * * driving/normal modda navigasyon kazanır. idle'da (park) ikisi de true olabilir.
 *
 * Sürüş güvenliği önceliği (Android Automotive OS UX Guidelines §4.2):
 * "Navigation UI must not be replaced by entertainment content while vehicle is moving."
 */
function buildSnapshot(p: SmartParams, shouldGenerateRec: boolean = true): SmartSnapshot {
  const map         = getCachedUsage();
  // OBD ve GPS ayrı ayrı iletilir — detectDrivingMode kendi hiyerarşisini uygular
  const drivingMode = detectDrivingMode(p.device, p.obdSpeed, p.gpsSpeedKmh);
  const timeContext = getTimeContext();
  const isMoving    = drivingMode === 'driving' || drivingMode === 'normal';

  /**
   * Safety Priority Matrix — Android Automotive OS UX Guidelines §4.2:
   * "Navigation UI must not be replaced by entertainment content while
   *  vehicle is moving."
   *
   * mapPriority koşulları:
   *   - Aktif navigasyon rotası var (isNavigating)
   *   - VEYA araç hareket halinde (isMoving) — müzik haritayı kapatamasın
   *
   * mediaProminent: Müzik çalıyorsa görsel belirginlik — harita öncelikliyse kapalı.
   */
  const mapPriority    = p.isNavigating === true || isMoving;
  const mediaProminent = p.isPlaying === true && !mapPriority;

  return {
    layoutWeights:  computeLayoutWeights(map),
    quickActions:   computeQuickActions(map, p.defaultNav, p.defaultMusic, p.favorites),
    drivingMode,
    dockIds:        computeDockIds(map, p.favorites),
    recommendation: shouldGenerateRec ? generateRecommendation(map, timeContext, drivingMode) : undefined,
    mediaProminent,
    mapPriority,
  };
}

/* ── React hook ──────────────────────────────────────────── */

/**
 * Subscribes to smart state. Recomputes when:
 *   - Device signals change (btConnected, charging, ready)
 *   - User preferences change (favorites, defaultNav, defaultMusic)
 *   - Any app is launched via trackLaunch()
 */
/**
 * Issue 3 — Layout Flip Debounce
 *
 * isPlaying geçici duraklamalarda (parçalar arası, duraklarda) hızla
 * true→false→true geçer. Bu, mediaProminent'ı tetikler ve layout'u
 * sürekli yeniden hesaplar — "Layout Flipping" denilen sürüş ergonomisi sorunu.
 *
 * Çözüm: Sadece mediaProminent değişimi olan snapshot güncellemelerini
 * 2 saniye debounce et. Diğer tüm değişiklikler (drivingMode, mapPriority
 * gibi güvenlik-kritik sinyaller) anında geçer.
 *
 * 2 saniyelik eşik: parçalar arası boşluk genellikle <500 ms,
 * trafik durağı genellikle >5 s → eşik her iki durumu da doğru ayırt eder.
 */
const LAYOUT_DEBOUNCE_MS = 2_000;

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

  // Debounce wrapper — sadece mediaProminent değişimi geciktirilir
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSnapRef    = useRef<SmartSnapshot | null>(null);

  const setStableSnapshot = useRef((next: SmartSnapshot) => {
    const prev = prevSnapRef.current;
    const onlyMediaChanged = prev !== null
      && next.mediaProminent !== prev.mediaProminent
      && next.mapPriority    === prev.mapPriority
      && next.drivingMode    === prev.drivingMode;

    if (onlyMediaChanged) {
      // Geçici müzik duraklaması — debounce ile bekle
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        prevSnapRef.current = next;
        setSnapshot(next);
      }, LAYOUT_DEBOUNCE_MS);
      return;
    }

    // Güvenlik-kritik veya çok-boyutlu değişim — anında uygula
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    prevSnapRef.current = next;
    setSnapshot(next);
  }).current;

  // Ref always holds latest params — avoids stale closures in the listener below.
  // Spread paramsRef.current FIRST so OBD-callback-written obdSpeed is preserved
  // across re-renders (obdSpeed is never a prop — only the OBD callback sets it).
  const paramsRef = useRef<SmartParams>({ device, favorites, defaultNav, defaultMusic, gpsSpeedKmh, isPlaying, isNavigating });
  useEffect(() => {
    paramsRef.current = {
      ...paramsRef.current, // preserve obdSpeed (set by OBD callback, not a prop)
      device, favorites, defaultNav, defaultMusic, gpsSpeedKmh, isPlaying, isNavigating,
    };
  });

  // Recompute when device signals, user preferences, or live context changes
  useEffect(() => {
    if (!device.ready) return;
    setStableSnapshot(buildSnapshot(paramsRef.current, true));
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
      // Gürültü filtresi: ≥3 km/h değişim yoksa snapshot yeniden hesaplanmaz
      const speedChange = Math.abs(d.speed - lastNotifiedSpeed);
      if (speedChange < 3) {
        paramsRef.current = { ...paramsRef.current, obdSpeed: d.speed };
        return;
      }
      lastNotifiedSpeed = d.speed;
      const newMode: DrivingMode = detectDrivingMode({ btConnected: false, charging: false }, d.speed);
      const modeChanged = newMode !== prevModeRef.current;
      if (modeChanged) {
        /**
         * Histerezis Tampon Bölgesi (OBD) — stop-and-go trafikte layout çalkalanmasını önler.
         *
         * idle ↔ normal:
         *   • idle→normal  : 3 km/h altında geçiş yapma (kısa ilerleme = hâlâ park)
         *   • normal→idle  : 1 km/h üstündeyken idle'a geçme (tam duraksana kadar bekle)
         *
         * normal ↔ driving — ISO 26262 §5.4.5 "Hysteresis band" prensibi:
         *   20 km/h eşiğinde ±3 km/h tampon bölge → titreşimsiz mod geçişi.
         *   • normal→driving : hız 23 km/h'i GEÇMEDENCEdriving'e girme
         *   • driving→normal : hız 17 km/h'in ALTINAdüşmedencenormal'e çıkma
         */
        if (prevModeRef.current === 'idle'    && newMode === 'normal'  && d.speed < 3)   return;
        if (prevModeRef.current === 'normal'  && newMode === 'idle'    && d.speed > 1)   return;
        if (prevModeRef.current === 'normal'  && newMode === 'driving' && d.speed < 23)  return;
        if (prevModeRef.current === 'driving' && newMode === 'normal'  && d.speed >= 17) return;
        prevModeRef.current = newMode;
        paramsRef.current = { ...paramsRef.current, obdSpeed: d.speed };
        // Mod değişti — güvenlik-kritik, anında snapshot ve öneri tetikle
        setStableSnapshot(buildSnapshot(paramsRef.current, true));
      } else {
        // Hız değişti ama mod aynı — sessizce güncelle, öneri tetikleme
        paramsRef.current = { ...paramsRef.current, obdSpeed: d.speed };
      }
    });
  }, []);

  // GPS speed effect — OBD bağlı değilken mod tespiti GPS'e devredilir
  useEffect(() => {
    if (gpsSpeedKmh === undefined) return;
    if (paramsRef.current.obdSpeed !== undefined) return; // Kademe 1 önceliği: OBD

    const prev    = paramsRef.current;
    // detectDrivingMode'a OBD=undefined, GPS=gpsSpeedKmh iletilir (hiyerarşi korunur)
    const oldMode = detectDrivingMode(prev.device, undefined, prev.gpsSpeedKmh);
    const newMode = detectDrivingMode(prev.device, undefined, gpsSpeedKmh);
    paramsRef.current = { ...prev, gpsSpeedKmh };

    if (newMode !== oldMode) {
      /**
       * GPS Histerezis Tampon Bölgesi — GPS daha geniş bantlar kullanır çünkü
       * Doppler ±2 km/h hata payı OBD'den daha yüksektir.
       *
       * idle ↔ normal:
       *   • idle→normal  : 8 km/h altında geçiş yapma (GPS jitter marjı)
       *   • normal→idle  : 3 km/h üstündeyken idle'a geçme
       *
       * normal ↔ driving — OBD ile aynı ±3 km/h tampon bölge:
       *   • normal→driving : 23 km/h'i GEÇMEDENCEdriving'e girme
       *   • driving→normal : 17 km/h'in ALTINAdüşmedencenormal'e çıkma
       */
      if (oldMode === 'idle'    && newMode === 'normal'  && gpsSpeedKmh < 8)   return;
      if (oldMode === 'normal'  && newMode === 'idle'    && gpsSpeedKmh > 3)   return;
      if (oldMode === 'normal'  && newMode === 'driving' && gpsSpeedKmh < 23)  return;
      if (oldMode === 'driving' && newMode === 'normal'  && gpsSpeedKmh >= 17) return;
      setStableSnapshot(buildSnapshot(paramsRef.current, true));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsSpeedKmh]);

  // İvmeölçeri bir kez bağla — GPS/OBD yokken hareket tespiti için
  useEffect(() => { attachAccelerometer(); }, []);

  // Debounce timer temizle — unmount
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Recompute after each tracked launch — WITH recommendation (usage changed)
  useEffect(() => {
    const refresh = () => setStableSnapshot(buildSnapshot(paramsRef.current, true));
    _listeners.add(refresh);
    return () => { _listeners.delete(refresh); };
  }, [setStableSnapshot]);

  return snapshot;
}
