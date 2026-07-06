/**
 * communityService — Collective Road Memory (CRM) Olay Mantığı
 *
 * Görevler:
 *  1. Koordinatı DERHAL geohash'e dönüştür — lat/lng heap'te bırakma
 *  2. Kuyruğu safeStorage'a throttled olarak kaydet (10s debounce)
 *  3. Başlangıçta kalıcı kuyruğu yükle (auto-hydrate)
 *  4. 24 saat geçmiş olayları temizle
 *  5. syncCommunityBatch: ağ + termal farkındalıklı toplu Supabase yüklemesi
 *
 * Gizlilik garantisi: addEvent() çağrısı sonrası lat/lng'ye hiçbir referans
 * kalmaz — yalnızca Level 6 geohash (~1.2km) kalır.
 * Senkronizasyonda user_id / device_id GÖNDERİLMEZ.
 * Spam koruması: epifemeral session_token (hafızada, diske yazılmaz).
 */

import {
  useCommunityStore,
  type CommunityEvent,
  type CommunityEventType,
} from '../store/useCommunityStore';
import { encodeGeohash, decodeGeohash } from '../utils/geohashHelper';
import { safeGetRaw, safeSetRaw }       from '../utils/safeStorage';
import { getSupabaseClient }             from './supabaseClient';
import { useVehicleIntelligenceStore }   from '../store/useVehicleIntelligenceStore';
import { useUnifiedVehicleStore }        from './vehicleDataLayer/UnifiedVehicleStore';
import { injectCommunityHazard }         from './hazardService';
import type { HazardType }               from '../store/useHazardStore';
import { runtimeManager }                from '../core/runtime/AdaptiveRuntimeManager';

/* ── Sabitler ────────────────────────────────────────────────────────────── */

const QUEUE_KEY          = 'community_queue';
const TTL_MS             = 24 * 60 * 60 * 1000; // 24 saat
const SAVE_DELAY_MS      = 10_000;               // 10s throttle — eMMC ömrü (CLAUDE.md §3)
// FAZ 16 — periyodik sync scheduler'a devredildi (§L.0, periodMs API);
// BALANCED/PERFORMANCE'ta bu değer AYNEN korunur (mod çarpanı=1).
const SYNC_INTERVAL_MS   = 5 * 60 * 1000;        // 5 dakika periyodik sync
const BATCH_TRIGGER_SIZE = 10;                   // kuyruk > 10 → anında sync
const PULL_INTERVAL_MS   = 7 * 60 * 1000;        // 7 dakika cloud pull döngüsü
const PULL_WINDOW_MS     = 12 * 60 * 60 * 1000;  // 12 saatlik veri penceresi

/** Anti-spam eşikleri */
const RATE_LIMIT_PER_MIN = 3;    // aynı session'dan dakikada maks rapor
const RATE_LIMIT_PER_DAY = 50;   // günde maks rapor
const GEOFENCE_MAX_KM    = 5.0;  // araçtan maks uzaklık (km) — hileli uzak raporları engeller

/** Precision-6 geohash hücre boyutları — komşu hücre ofseti için */
const GH6_LAT_STEP = 0.0055;   // ~0.61 km
const GH6_LNG_STEP = 0.011;    // ~1.22 km

const VALID_HAZARD_TYPES = new Set<string>(
  ['CONSTRUCTION', 'ACCIDENT', 'WEATHER', 'SPEED_CAM', 'ROAD_DAMAGE', 'TUNNEL'],
);

/* ── Epifemeral session token (gizlilik) ────────────────────────────────── */

// Her uygulama oturumunda yeni token. Asla diske yazılmaz.
// Sunucu tarafında aynı cihazdan gelen spam'i ayırt etmeye yarar (user takip edilemez).
const _SESSION_TOKEN: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/* ── Throttled kayıt ─────────────────────────────────────────────────────── */

let _saveTimer:  ReturnType<typeof setTimeout>  | null = null;
/** FAZ 16 — scheduler'ın IDLE sınıfına taşındı (§L.0); cleanup thunk tutar. */
let _syncTimer:  (() => void) | null = null;
// _pullTimer (cloud pull) BİLİNÇLİ OLARAK taşınmadı — FAZ 16 grup-1 kapsamı
// yalnız _syncTimer'ı kapsıyor (atomik migrasyon, AI.md "big-bang YASAK").
let _pullTimer:  ReturnType<typeof setInterval> | null = null;

/** Rate limit sayaçları — yalnızca bellekte, diske yazılmaz */
let _rateLimitMin = { count: 0, windowStart: 0 };
let _rateLimitDay = { count: 0, windowStart: 0 };

/** Son başarılı cloud pull zaman damgası — Inspector için */
let _lastPullSyncMs = 0;

/** Anlık termal kısıtlama seviyesi — SystemOrchestrator tarafından yazılır. */
let _thermalLevel: 0|1|2|3 = 0;

/** Bilişsel Pause: true iken sync/pull işlemleri atlanır, timerlar canlı kalır. */
let _cogPaused = false;

export function setCommunityPaused(paused: boolean): void {
  _cogPaused = paused;
}

/**
 * Topluluk servisi termal seviyesini günceller.
 * SystemOrchestrator tarafından onThermalLevelChange callback'inde çağrılır.
 */
export function setCommunityThermalLevel(level: 0|1|2|3): void {
  _thermalLevel = level;
}

function _scheduleSave(): void {
  if (_saveTimer) return; // zaten bekliyor — kuyruğa ekleme
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    _flushQueue();
  }, SAVE_DELAY_MS);
}

function _flushQueue(): void {
  const { pendingEvents } = useCommunityStore.getState();
  safeSetRaw(QUEUE_KEY, JSON.stringify(pendingEvents));
}

/* ── Başlangıç yükleme ───────────────────────────────────────────────────── */

/**
 * SafeStorage'dan kalıcı kuyruğu yükler.
 * SystemBoot Wave 1 sonunda çağrılmalı (idempotent).
 */
export function initCommunityService(): void {
  const raw = safeGetRaw(QUEUE_KEY);
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // bozuk JSON — sessizce atla
  }

  if (!Array.isArray(parsed)) return;

  const events: CommunityEvent[] = [];

  for (const item of parsed) {
    if (
      item !== null &&
      typeof item === 'object' &&
      typeof item.id        === 'string' &&
      typeof item.type      === 'string' &&
      typeof item.geohash   === 'string' &&
      typeof item.confidence === 'number' &&
      typeof item.timestamp  === 'number' &&
      typeof item.metadata   === 'object'
    ) {
      events.push(item as CommunityEvent);
    }
  }

  if (events.length > 0) {
    const store = useCommunityStore.getState();
    // Mevcut kuyrukla birleştir (ID çakışması önlemi)
    const existingIds = new Set(store.pendingEvents.map((e) => e.id));
    events
      .filter((e) => !existingIds.has(e.id))
      .forEach((e) => store.pushEvent(e));
  }

  // FAZ 16 — sabit 5dk `setInterval` yerine scheduler (§L.0, periodMs API).
  // BALANCED/PERFORMANCE'ta SYNC_INTERVAL_MS (5dk) AYNEN korunur — düzeltme
  // öncesi (freqClass='IDLE') taban ~15s'e yuvarlanmıştı = 20× fazla ağ
  // senkronu; artık gerçek periyot birebir taşınıyor. _idleSync() zaten
  // idempotent bir "kuyruğu boşaltmayı dene" tetikleyicisi — tick-sayımına
  // dayalı biriktirme yok, periyot düşük-tier'da uzasa da davranış bozulmaz.
  if (_syncTimer) { _syncTimer(); _syncTimer = null; }
  _syncTimer = runtimeManager.scheduleTask({
    id: 'community-sync', periodMs: SYNC_INTERVAL_MS, criticality: 'NORMAL', fn: _idleSync, deferIdle: true,
  });

  // Cloud pull — 7 dakikada bir topluluk verisini çek ve Hazard motoruna besle
  if (_pullTimer) clearInterval(_pullTimer);
  _idlePull(); // ilk çekim hemen
  _pullTimer = setInterval(() => {
    _idlePull();
  }, PULL_INTERVAL_MS);
}

/**
 * Topluluk servisini durdurur.
 * Tüm aktif zamanlayıcılar temizlenir ve bekleyen kuyruk diske yazılır.
 */
export function stopCommunityService(): void {
  // Kuyruk önce mühürlenir — eMMC ömrü koruması (timer'lardan önce)
  _flushQueue();
  if (_syncTimer) { _syncTimer(); _syncTimer = null; }
  if (_pullTimer) { clearInterval(_pullTimer); _pullTimer = null; }
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  console.info('[CRM] Shutdown complete - All timers cleared');
}

/* ── Anti-spam koruması ──────────────────────────────────────────────────── */

/** Dakika ve gün penceresine göre rate limit kontrolü. false → rapor reddedildi. */
function _checkRateLimit(): boolean {
  const now = Date.now();

  if (now - _rateLimitMin.windowStart > 60_000) {
    _rateLimitMin = { count: 0, windowStart: now };
  }
  if (_rateLimitMin.count >= RATE_LIMIT_PER_MIN) {
    console.warn('[CRM] Dakika limiti aşıldı — rapor reddedildi');
    return false;
  }

  if (now - _rateLimitDay.windowStart > 86_400_000) {
    _rateLimitDay = { count: 0, windowStart: now };
  }
  if (_rateLimitDay.count >= RATE_LIMIT_PER_DAY) {
    console.warn('[CRM] Günlük limit aşıldı — rapor reddedildi');
    return false;
  }

  return true;
}

/** Araçtan çok uzak rapor girişimini engeller. false → reddedildi. */
function _checkGeofence(lat: number, lng: number): boolean {
  const loc = useUnifiedVehicleStore.getState().location;
  if (!loc || !isFinite(loc.latitude) || !isFinite(loc.longitude)) return true; // konum bilinmiyorsa geç

  const dLat = (lat - loc.latitude)  * 111_320;
  const cosL = Math.cos(lat * Math.PI / 180);
  const dLng = (lng - loc.longitude) * 111_320 * cosL;
  const distKm = Math.sqrt(dLat * dLat + dLng * dLng) / 1000;

  if (distKm > GEOFENCE_MAX_KM) {
    console.warn(`[CRM] Geofence ihlali (${distKm.toFixed(1)} km > ${GEOFENCE_MAX_KM} km) — rapor reddedildi`);
    return false;
  }
  return true;
}

/* ── Olay ekleme ─────────────────────────────────────────────────────────── */

/**
 * Yeni bir topluluk olayı oluşturur ve kuyruğa ekler.
 *
 * GİZLİLİK: lat/lng bu fonksiyon bittiğinde çağıran kapsamındaki yerel
 * değişkenlere hapsedilmiş durumdadır — event nesnesine ASLA yazılmaz.
 *
 * @param type       Olay kategorisi
 * @param lat        Enlem (yalnızca geohash üretiminde kullanılır)
 * @param lng        Boylam (yalnızca geohash üretiminde kullanılır)
 * @param confidence Yerel sensör güven skoru [0.0 – 1.0]
 * @param metadata   Olay tipine özgü ek veri (lat/lng içermemeli)
 */
export function addEvent(
  type:       CommunityEventType,
  lat:        number,
  lng:        number,
  confidence: number,
  metadata:   Record<string, unknown> = {},
): CommunityEvent {
  // ── Anti-spam: rate limit + geofence kontrolleri ──────────────────────────
  const geohash = encodeGeohash(lat, lng, 6);
  if (!_checkRateLimit() || !_checkGeofence(lat, lng)) {
    // Store'a EKLEMEZ — sessizce minimal event döndür
    return { id: `rejected-${Date.now()}`, type, geohash, confidence: 0, timestamp: Date.now(), metadata: {} };
  }
  // Rate limit sayaçlarını güncelle
  _rateLimitMin.count++;
  _rateLimitDay.count++;

  // ② lat/lng artık kullanılmıyor — garbage collector'a bırak
  //    (JS'de explicit silme mümkün değil; referansı kesmek yeterli)

  const event: CommunityEvent = {
    id:         `crm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    geohash,   // kesin koordinat yok
    confidence: Math.max(0, Math.min(1, confidence)),
    timestamp:  Date.now(),
    metadata,  // caller'ın lat/lng içermediğinden emin olması gerekir
  };

  useCommunityStore.getState().pushEvent(event);
  _scheduleSave();

  // Kuyruk eşiği aşıldıysa düşük öncelikli sync tetikle (MALI-400 güvenli)
  if (useCommunityStore.getState().pendingEvents.length >= BATCH_TRIGGER_SIZE) {
    _idleSync();
  }

  return event;
}

/* ── TTL temizleme ───────────────────────────────────────────────────────── */

/**
 * 24 saatten eski olayları kuyruktan ve kalıcı depodan kaldırır.
 * Periyodik olarak çağrılmalı (örn. her uygulama açılışında veya saatlik).
 */
export function clearExpiredEvents(): void {
  const cutoff = Date.now() - TTL_MS;
  const { pendingEvents } = useCommunityStore.getState();

  const expiredIds = pendingEvents
    .filter((e) => e.timestamp < cutoff)
    .map((e) => e.id);

  if (expiredIds.length === 0) return;

  useCommunityStore.getState().removeEvents(expiredIds);
  _scheduleSave();
}

/* ── Batch okuma & Inspector API ─────────────────────────────────────────── */

/**
 * Senkronizasyon için bekleyen olayların kopyasını döner.
 * Store mutasyonu yapmaz — yalnızca okuma.
 */
export function getPendingBatch(): CommunityEvent[] {
  return [...useCommunityStore.getState().pendingEvents];
}

/** Son başarılı cloud pull zamanı (ms). 0 = henüz pull yapılmadı. */
export function getLastPullSync(): number { return _lastPullSyncMs; }

/* ── Termal watchdog ─────────────────────────────────────────────────────── */

/** Termal durum tehlikeli ise sync atlama (CPU/GPU/pil ısısı). */
function _isThermalSafe(): boolean {
  const { thermalStatus } = useVehicleIntelligenceStore.getState();
  return thermalStatus !== 'HEAT_SOAK' && thermalStatus !== 'OVERHEAT_RISK';
}

/* ── Ana Senkronizasyon Motoru ───────────────────────────────────────────── */

/** Supabase'e gönderilecek satır şekli (kişisel veri yok) */
interface CrmRow {
  geohash:    string;
  type:       string;
  confidence: number;
  metadata:   Record<string, unknown>;
}

let _isSyncRunning = false;

/**
 * Yerel kuyruğu Supabase'e toplu (batch) olarak yükler.
 *
 * Koşullar:
 *  - navigator.onLine: çevrimdışıysa atla
 *  - thermalWatchdog: tehlikeli ısıysa atla
 *  - Supabase yapılandırılmamışsa atla (demo/offline mod)
 *  - Eş zamanlı çalışma yok (singleton guard)
 *
 * Gizlilik: user_id / device_id ASLA gönderilmez.
 * session_token → metadata içinde epifemeral (diske yazılmaz).
 */
export async function syncCommunityBatch(): Promise<void> {
  if (_isSyncRunning)        return;
  if (_cogPaused)            return; // Bilişsel Pause: PROTECTION/CRITICAL modda bekle
  if (!navigator.onLine)     return;
  if (_thermalLevel >= 2)    return; // L2+: sync yasak — CPU/GPU baskısı
  if (!_isThermalSafe())     return;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  const batch = getPendingBatch();
  if (batch.length === 0) return;

  _isSyncRunning = true;
  useCommunityStore.getState().setSyncing(true);

  try {
    const rows: CrmRow[] = batch.map((e) => ({
      geohash:    e.geohash,
      type:       e.type,
      confidence: e.confidence,
      // session_token → sunucu tarafı spam tespiti için (kullanıcı takip edilemez)
      metadata: { ...e.metadata, session_token: _SESSION_TOKEN },
    }));

    const { error } = await supabase
      .from('raw_community_events')
      .insert(rows);

    if (error) {
      // Geçici hata: kuyrukta bırak, bir sonraki periyodik sync dener
      console.warn('[CRM] Sync başarısız:', error.message);
      return;
    }

    // Başarılı — yerel kuyruğu temizle
    const sentIds = batch.map((e) => e.id);
    useCommunityStore.getState().removeEvents(sentIds);
    useCommunityStore.getState().markSynced();
    _scheduleSave(); // boşalan kuyruğu diske yaz
  } catch (err) {
    console.warn('[CRM] Sync hatası:', err);
  } finally {
    _isSyncRunning = false;
    useCommunityStore.getState().setSyncing(false);
  }
}

/* ── Düşük öncelikli (idle) sync sarmalayıcı ────────────────────────────── */

/** MALI-400 güvenli: UI thread boştayken sync başlatır. */
function _idleSync(): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(
      () => { void syncCommunityBatch(); },
      { timeout: 8_000 }, // en geç 8s içinde — sync kritik değil
    );
  } else {
    setTimeout(() => { void syncCommunityBatch(); }, 0);
  }
}

/* ── Cloud Pull (Phase C4) ───────────────────────────────────────────────── */

/** Araç geohash'inin 8 komşu hücresini + merkezini döner (9 benzersiz hücre). */
function _getNeighborGeohashes(hash: string): string[] {
  const center = decodeGeohash(hash);
  const cells  = new Set<string>([hash]);

  for (const dlat of [-GH6_LAT_STEP, 0, GH6_LAT_STEP]) {
    for (const dlng of [-GH6_LNG_STEP, 0, GH6_LNG_STEP]) {
      if (dlat === 0 && dlng === 0) continue;
      const nLat = Math.max(-90,  Math.min(90,  center.lat + dlat));
      const nLng = ((center.lng + dlng + 180) % 360 + 360) % 360 - 180;
      cells.add(encodeGeohash(nLat, nLng, 6));
    }
  }

  return [...cells];
}

/** Rapor sayısına göre dinamik güven skoru (2 rapor → 0.60, 5+ → 0.95). */
function _calcConfidence(count: number): number {
  if (count >= 5) return 0.95;
  if (count >= 3) return 0.75;
  if (count >= 2) return 0.60;
  return 0.40;
}

/** Supabase ham tip string'ini HazardType'a dönüştürür; geçersizse null. */
function _toHazardType(raw: string): HazardType | null {
  const upper = raw.toUpperCase();
  return VALID_HAZARD_TYPES.has(upper) ? (upper as HazardType) : null;
}

/** Supabase'den dönen ham topluluk satırı şekli. */
interface RawCommunityRow {
  geohash:    string;
  type:       string;
  confidence: number;
  created_at: string;
}

let _isPullRunning = false;

/**
 * Araç konumunu merkez alarak 9 geohash hücresindeki son 12 saatlik topluluk
 * olaylarını Supabase'den çeker, aynı hücre+tip kombinasyonlarını kümelere
 * (aggregate) ve Hazard motoruna enjekte eder.
 *
 * PERFORMANCE: requestIdleCallback ile çağrılır — navigasyon akıcılığını bozmaz.
 * PRIVACY: Hiçbir kullanıcı tanımlayıcısı sorguya eklenmez.
 */
export async function fetchNearbyCommunityEvents(): Promise<void> {
  if (_isPullRunning)     return;
  if (!navigator.onLine)  return;
  if (_thermalLevel >= 2) return; // L2+: pull tamamen engel
  // L1: 2× interval (14 dk) — son başarılı pull'dan bu yana yeterli süre geçmeli
  if (_thermalLevel === 1 && Date.now() - _lastPullSyncMs < PULL_INTERVAL_MS * 2) return;
  if (!_isThermalSafe())  return;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  const loc = useUnifiedVehicleStore.getState().location;
  if (!loc || !isFinite(loc.latitude) || !isFinite(loc.longitude)) return;

  _isPullRunning = true;

  try {
    const currentHash  = encodeGeohash(loc.latitude, loc.longitude, 6);
    const searchHashes = _getNeighborGeohashes(currentHash);
    const cutoffISO    = new Date(Date.now() - PULL_WINDOW_MS).toISOString();

    const { data, error } = await supabase
      .from('raw_community_events')
      .select('geohash, type, confidence, created_at')
      .in('geohash', searchHashes)
      .gte('created_at', cutoffISO);

    if (error || !data || data.length === 0) return;
    _lastPullSyncMs = Date.now(); // başarılı fetch — Inspector zaman damgasını güncelle

    // Aynı geohash + tip → tek "Kolektif Tehlike" (aggregate)
    const grouped = new Map<string, RawCommunityRow[]>();
    for (const row of data as RawCommunityRow[]) {
      if (!row.geohash || !row.type) continue;
      const key = `${row.geohash}::${row.type}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }

    for (const [key, rows] of grouped) {
      const [geohash, rawType] = key.split('::');
      const hazardType = _toHazardType(rawType);
      if (!hazardType) continue;

      const confidence = _calcConfidence(rows.length);
      const center     = decodeGeohash(geohash);

      injectCommunityHazard(center.lat, center.lng, hazardType, confidence, geohash);
    }
  } catch (err) {
    console.warn('[CRM:Pull] Fetch hatası:', err);
  } finally {
    _isPullRunning = false;
  }
}

/** MALI-400 güvenli: UI thread boştayken cloud pull başlatır. */
function _idlePull(): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(
      () => { void fetchNearbyCommunityEvents(); },
      { timeout: 10_000 },
    );
  } else {
    setTimeout(() => { void fetchNearbyCommunityEvents(); }, 0);
  }
}

/* ── HMR cleanup ─────────────────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_syncTimer) { _syncTimer(); _syncTimer = null; }
    if (_pullTimer) { clearInterval(_pullTimer); _pullTimer = null; }
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
      _flushQueue();
    }
  });
}
