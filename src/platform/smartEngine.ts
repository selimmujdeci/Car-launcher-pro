/**
 * Smart Engine — local AI-like intelligence for CockpitOS.
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
export type {
  UsageRecord, UsageMap, LayoutWeights, DrivingMode, QuickAction,
  SmartRecommendation, SmartSnapshot, MarkovPrediction,
} from './smartTypes';
export { detectDrivingMode } from './smartDrivingEngine';
import type {
  UsageMap, LayoutWeights, DrivingMode, QuickAction,
  SmartSnapshot, TimeContext, SmartParams,
} from './smartTypes';
import {
  NAV_IDS, MEDIA_IDS, LAYOUT_DEBOUNCE_MS,
  DOCK_POOL, DOCK_SLOTS,
} from './smartConstants';
import {
  saveUsage, getCachedUsage, setUsageCache, clearUsageCache,
  score, timedScore, getTimeContext,
} from './smartUsageUtils';
import {
  attachAccelerometer, detachAccelerometer,
  recordSpeed, detectDrivingMode,
} from './smartDrivingEngine';
import {
  getLastLaunchedApp, setLastLaunchedApp, updateMarkov,
  computeMarkovPredictions, blendedScore, clearMarkovState,
} from './smartMarkovEngine';
import { generateRecommendation } from './smartRecommendationEngine';

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
  // getCachedUsage() ile cache warm tutulur — her launch'da localStorage re-read olmaz
  const map    = getCachedUsage();
  const prev   = map[appId] ?? { count: 0, recentCount: 0, lastUsed: 0 };
  const updated: UsageMap = {
    ...map,
    [appId]: {
      count:       prev.count + 1,
      recentCount: prev.recentCount + 1,
      lastUsed:    Date.now(),
    },
  };
  saveUsage(updated);
  setUsageCache(updated);  // cache'i güncel tut — sonraki buildSnapshot localStorage okumaz

  // Markov: önceki uygulama → bu uygulama geçişini kaydet
  // Aynı uygulamayı art arda açmak anlamlı geçiş değildir — atla
  const prev_ = getLastLaunchedApp();
  if (prev_ && prev_ !== appId) {
    updateMarkov(prev_, appId);
  }
  setLastLaunchedApp(appId);

  notifyListeners();
}

/* ── Layout weights ──────────────────────────────────────── */

function computeLayoutWeights(map: UsageMap): LayoutWeights {
  const nav   = NAV_IDS.reduce((s, id)   => s + score(map[id]), 0);
  const media = MEDIA_IDS.reduce((s, id) => s + score(map[id]), 0);
  // 60 % dominance threshold for asymmetric layout
  if (nav   > media * 1.6) return { navFlex: 4, mediaFlex: 1 };
  if (media > nav   * 1.6) return { navFlex: 2, mediaFlex: 3 };
  return { navFlex: 3, mediaFlex: 2 };
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

/* ── Smart dock ──────────────────────────────────────────── */

function computeDockIds(map: UsageMap, favorites: string[], timeCtx: TimeContext): string[] {
  const seen       = new Set<string>();
  const candidates = [...favorites, ...DOCK_POOL].filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return candidates
    .sort((a, b) => blendedScore(b, map, timeCtx) - blendedScore(a, map, timeCtx))
    .slice(0, DOCK_SLOTS);
}

/* ── Snapshot builder ────────────────────────────────────── */

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
  const map = getCachedUsage();
  // Hız kaydı: buildSnapshot gerçek sensör verisiyle çağrılır — decay için kaydet.
  // detectDrivingMode artık recordSpeed çağırmaz (pure function); kayıt buradan yapılır.
  const speedForRecord = p.obdSpeed ?? p.gpsSpeedKmh;
  if (speedForRecord !== undefined) recordSpeed(speedForRecord);
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
    dockIds:        computeDockIds(map, p.favorites, timeContext),
    recommendation: shouldGenerateRec ? generateRecommendation(map, timeContext, drivingMode) : undefined,
    mediaProminent,
    mapPriority,
    predictions:    computeMarkovPredictions(getLastLaunchedApp(), timeContext),
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
      recordSpeed(d.speed); // decay için gerçek OBD hızını kaydet
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
    recordSpeed(gpsSpeedKmh); // decay için gerçek GPS hızını kaydet
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
  // B29: cleanup ile unmount'ta listener sızdırma
  useEffect(() => { attachAccelerometer(); return detachAccelerometer; }, []);

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

/* ── HMR cleanup — dev'de tüm sub-engine state'lerini sıfırla ── */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    detachAccelerometer();
    _listeners.clear();
    clearUsageCache();
    clearMarkovState();
  });
}
