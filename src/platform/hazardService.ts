/**
 * hazardService.ts — Road Hazard Intelligence Engine (Phase H2)
 *
 * Faz H2 ekleri (H1 üzerine):
 *   - Rota uygunluk skoru (RouteRelevance)
 *   - Sürücü Dikkat Bütçesi modeli (DAB)
 *   - FinalIntensity hesabı
 *   - Güven Yeniden Doğrulama (Re-Verification)
 *
 * Bu modül: yalnızca veri/durum mantığı. MapLibre ve UI'ye dokunmaz.
 */

import {
  useHazardStore,
  HazardStatus,
  type Hazard,
  type HazardType,
  type HazardSource,
} from '../store/useHazardStore';
import {
  getRouteState,
  pointToSegmentDist,
  hav,
} from './routingService';
import { getSnappedMarkerPosition } from './navigationService';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { logError } from './crashLogger';
import { runtimeManager } from '../core/runtime/AdaptiveRuntimeManager';

/* ── Sabitler ────────────────────────────────────────────────────────────── */

export const CONFIDENCE_REMOVAL_THRESHOLD = 0.10;
// FAZ 16 — decay döngüsü scheduler'a devredildi (§L.0, periodMs API);
// BALANCED/PERFORMANCE'ta DECAY_INTERVAL_MS AYNEN korunur (mod çarpanı=1).
// _runDecayCycle() PERİYOT-BAĞIMSIZ: calculateCurrentConfidence() güveni her
// zaman `Date.now() - hazard.timestamp` MUTLAK farkından üstel olarak yeniden
// hesaplar (tick-sayımına dayalı sabit-miktar düşüş YOK) → periyot düşük-
// tier'da uzasa da çürüme oranı DOĞRU kalır, yalnız örnekleme sıklığı azalır
// (denetlendi, düzeltme gerekmedi).
const DECAY_INTERVAL_MS   = 10_000;

/** Topluluk verisinin çürüme oranı (saat başına). ~1 saat içinde eşik altına düşer. */
export const COMMUNITY_DECAY_RATE = 2.3;

/** Rota uygunluk aralıkları (metre) */
const RELEVANCE_CLOSE_M   = 50;
const RELEVANCE_FAR_M     = 500;

/** Araç-tehlike ön-filtre yarıçapı (km) — Mali-400 optimizasyonu */
const VEHICLE_PREFILTER_KM = 1.0;

/** Yeniden doğrulama bekleme süresi (ms) */
const VERIFY_COOLDOWN_MS  = 120_000;

/** Tip başına varsayılan etki yarıçapı (metre) */
export const DEFAULT_RADIUS: Record<HazardType, number> = {
  CONSTRUCTION: 500,
  ACCIDENT:     300,
  WEATHER:      1000,
  SPEED_CAM:    200,
  ROAD_DAMAGE:  150,
  TUNNEL:       800,
};

/**
 * Tip başına varsayılan çürüme oranı (saat başına).
 * H5 kalibrasyon: ACCIDENT ve ROAD_DAMAGE artırıldı.
 * Doğrulanmamış kazalar/çukurlar hızla kaybolmalı → sürücü güveni korunur.
 */
export const DEFAULT_DECAY: Record<HazardType, number> = {
  CONSTRUCTION: 0.02,
  ACCIDENT:     0.30,   // H5: 0.15 → 0.30 (doğrulanmadıkça hızla solar)
  WEATHER:      0.05,
  SPEED_CAM:    0.005,
  ROAD_DAMAGE:  0.10,   // H5: 0.03 → 0.10 (çukur: teyit yoksa unutulur)
  TUNNEL:       0.01,
};

/**
 * Araç hızının bu tehlike tipiyle tutarsız olup olmadığını belirleyen eşikler (km/h).
 * Araç bu değerin üzerindeyse "tehlike gözlenmedi" → decay hızlandır.
 */
const NORMAL_SPEED_THRESHOLD: Record<HazardType, number> = {
  ACCIDENT:     45,
  CONSTRUCTION: 35,
  WEATHER:      55,
  ROAD_DAMAGE:  30,
  SPEED_CAM:    999, // hız kamerası her zaman doğrulanır
  TUNNEL:       999, // tünel her zaman doğrulanır
};

/* ── Module state ────────────────────────────────────────────────────────── */

let _decayTimer:  (() => void) | null = null;
let _engineRunning = false;

/* ── EMA Risk Filter (H5) ────────────────────────────────────────────────── */
// GPS ani değişiklikleri ve geçici hesap farklarının görsel "jitter" oluşturmasını önler.
// filteredScore = prevScore × 0.85 + rawScore × 0.15
let _filteredRiskScore = 0;

/* ── Hysteresis State Machine (H5) ──────────────────────────────────────── */
// Basit eşik geçişleri yerine histerezis bantları → durum salınımı engellenir.
// IDLE → AWARENESS:  risk ≥ 0.20,  geri dön < 0.15
// AWARENESS → PREPARE: risk ≥ 0.45, geri dön < 0.40
// PREPARE → ATTENTION: risk ≥ 0.70, geri dön < 0.65
let _hazardStatusInternal: HazardStatus = HazardStatus.IDLE;

/** Hysteresis: son uygulanan DAB değeri */
let _lastAppliedDAB = 1.0;

/** Yeniden doğrulama zaman damgası — her tehlike başına bir kayıt */
const _verifiedAt = new Map<string, number>();

/** Güven override'ları — re-verification sonrası geçici çarpanlar */
const _confidenceMultiplier = new Map<string, number>(); // id → 0.5 veya 1.0 reset

/* ── Güven Çürüme Motoru ─────────────────────────────────────────────────── */

/**
 * Mevcut güveni hesapla (re-verification çarpanı dahil).
 * C = C₀ × e^{−k × t} × multiplier
 */
export function calculateCurrentConfidence(hazard: Hazard): number {
  const elapsedSec = (Date.now() - hazard.timestamp) / 1000;
  const k          = hazard.decayRate / 3600;
  const base       = hazard.initialConfidence * Math.exp(-k * elapsedSec);
  const mult       = _confidenceMultiplier.get(hazard.id) ?? 1.0;
  return Math.max(0, base * mult);
}

/* ── Rota Uygunluk Skoru ─────────────────────────────────────────────────── */

/**
 * Tehlikenin aktif rotaya olan yakınlığını hesapla (0.0 – 1.0).
 * Performans: sadece hazard bbox'ı kesen segmentleri tara (BBox ön-filtre).
 *
 * @param hazard   Değerlendirilecek tehlike
 * @param geometry Rota geometrisi [lon, lat][] formatında
 */
export function calculateRouteRelevance(hazard: Hazard, geometry: [number, number][]): number {
  if (geometry.length < 2) return 0;

  // BBox toleransı: ~1.1km (0.01°)
  const TOL = 0.01;
  let minDist = Infinity;

  for (let i = 0; i < geometry.length - 1; i++) {
    const aLon = geometry[i][0];     const aLat = geometry[i][1];
    const bLon = geometry[i + 1][0]; const bLat = geometry[i + 1][1];

    // Segment BBox ön-filtresi — pointToSegmentDist'i gereksiz çağırma
    const minLat = Math.min(aLat, bLat) - TOL;
    const maxLat = Math.max(aLat, bLat) + TOL;
    const minLon = Math.min(aLon, bLon) - TOL;
    const maxLon = Math.max(aLon, bLon) + TOL;

    if (hazard.lat < minLat || hazard.lat > maxLat ||
        hazard.lng < minLon || hazard.lng > maxLon) continue;

    // routingService: pointToSegmentDist(pLat, pLon, aLat, aLon, bLat, bLon) → metre
    const d = pointToSegmentDist(hazard.lat, hazard.lng, aLat, aLon, bLat, bLon);
    if (d < minDist) minDist = d;
    if (minDist <= RELEVANCE_CLOSE_M) break; // Optimal bulundu — daha iyisi mümkün değil
  }

  if (minDist >= RELEVANCE_FAR_M)  return 0;
  if (minDist <= RELEVANCE_CLOSE_M) return 1;
  return 1 - (minDist - RELEVANCE_CLOSE_M) / (RELEVANCE_FAR_M - RELEVANCE_CLOSE_M);
}

/* ── Sürücü Dikkat Bütçesi (DAB) ────────────────────────────────────────── */

/**
 * Anlık Sürücü Dikkat Bütçesini hesapla (0.1 – 1.0).
 *
 * Bileşenler:
 *   Hız etkisi:     1.0 − (speedKmh / 150), min 0.3
 *   Manevra baskısı: distToTurn < 200m → −0.4
 *   Otoyol bonusu:  otoyol benzeri adım → +0.2
 */
export function calculateDriverAttentionBudget(
  speedKmh:       number,
  distToTurnM:    number,
  isHighwayStep:  boolean,
): number {
  let budget = Math.max(0.3, 1.0 - speedKmh / 150);

  if (distToTurnM < 200) budget -= 0.4;
  if (isHighwayStep)     budget += 0.2;

  return Math.max(0.1, Math.min(1.0, budget));
}

/* ── Final Intensity ─────────────────────────────────────────────────────── */

/**
 * Tehlike nihai yoğunluğunu hesapla (0.0 – 1.0).
 * FinalIntensity = Confidence × Severity × RouteRelevance × (1 / DAB)
 * Düşük DAB (meşgul sürücü) → yoğunluk yükseltilir.
 */
export function calculateFinalIntensity(
  confidence: number,
  severity:   number,
  relevance:  number,
  dab:        number,
): number {
  return Math.min(1.0, (confidence * severity * relevance) / Math.max(0.1, dab));
}

/* ── Güven Yeniden Doğrulama ─────────────────────────────────────────────── */

/**
 * Araç tehlike etki alanından geçerken güveni güncelle.
 *
 * Araç içindeyse + hız tehlikeyle tutarsızsa (yavaşlama gözlenmedi):
 *   → Güven çarpanını 0.5'e düşür (hızlandırılmış decay).
 * Araç içindeyse + hız tehlikeyle tutarlıysa (yavaşlama var):
 *   → Güveni 1.0'a sıfırla (tehlike doğrulandı).
 */
function _checkReVerification(
  hazard:       Hazard,
  vehicleLat:   number,
  vehicleLng:   number,
  vehicleKmh:   number,
): void {
  const distM = hav(vehicleLat, vehicleLng, hazard.lat, hazard.lng);
  if (distM > hazard.influenceRadius) return;

  // Cooldown: aynı tehlike için çok sık tetiklenmesin
  const lastVerify = _verifiedAt.get(hazard.id) ?? 0;
  if (Date.now() - lastVerify < VERIFY_COOLDOWN_MS) return;

  _verifiedAt.set(hazard.id, Date.now());
  const threshold = NORMAL_SPEED_THRESHOLD[hazard.type];

  if (vehicleKmh <= threshold * 0.7) {
    // Hız tehlikeyle tutarlı → güveni sıfırla (tehlike gerçek)
    _confidenceMultiplier.delete(hazard.id); // çarpanı kaldır — taze başlangıç
    // initialConfidence'ı 1.0'a yükselt: mevcut Hazard objesini timestamp ile sıfırla
    const refreshed: Hazard = {
      ...hazard,
      initialConfidence: 1.0,
      timestamp:         Date.now(),
    };
    useHazardStore.getState().upsertHazard(refreshed);
  } else if (vehicleKmh > threshold) {
    // Hız normal → tehlike gözlenmedi, decay'i hızlandır
    _confidenceMultiplier.set(hazard.id, 0.5);
  }
}

/* ── Temizleme & Güncelleme Döngüsü ─────────────────────────────────────── */

function _runDecayCycle(): void {
  const store   = useHazardStore.getState();
  const hazards = store.activeHazards;
  if (hazards.length === 0) {
    store.updateGlobalRisk(0);
    store.setHazardStatus(HazardStatus.IDLE);
    return;
  }

  // ── Araç durumu ──────────────────────────────────────────────────────────
  const vehicle    = useUnifiedVehicleStore.getState();
  const loc        = vehicle.location;
  const vehicleKmh = typeof vehicle.speed === 'number' ? vehicle.speed : 0;
  const vLat = loc && isFinite(loc.latitude)  ? loc.latitude  : null;
  const vLng = loc && isFinite(loc.longitude) ? loc.longitude : null;

  // Snap-based konum: GPS drift / paralel yol sorununu düzeltir (H5).
  // Snapped position mevcutsa vLat/vLng'ye göre önceliği var.
  const snapped = getSnappedMarkerPosition();
  const effLat  = snapped?.lat  ?? vLat;
  const effLng  = snapped?.lon  ?? vLng;

  // ── Rota durumu ──────────────────────────────────────────────────────────
  const routeState  = getRouteState();
  const geometry    = routeState.geometry;
  const distToTurn  = routeState.distanceToNextTurnMeters;
  const currentStep = routeState.steps[routeState.currentStepIndex];

  // Otoyol tespiti: adım hız tahmini > 70 km/h → otoyol benzeri
  const isHighwayStep = !!currentStep &&
    currentStep.duration > 0 &&
    (currentStep.distance / currentStep.duration * 3.6) > 70;

  // ── DAB hesabı + hysteresis ──────────────────────────────────────────────
  const rawDAB = calculateDriverAttentionBudget(vehicleKmh, distToTurn, isHighwayStep);
  if (Math.abs(rawDAB - _lastAppliedDAB) >= 0.1) {
    _lastAppliedDAB = rawDAB;
    store.setDriverAttentionBudget(rawDAB);
  }

  // ── Decay döngüsü ────────────────────────────────────────────────────────
  const surviving:        Hazard[] = [];
  const toRemove:         string[] = [];
  const newRelevance:     Record<string, number> = {};
  const newIntensity:     Record<string, number> = {};

  for (const h of hazards) {
    const conf = calculateCurrentConfidence(h);

    // 1. Eşik altına düştüyse kaldır
    if (conf < CONFIDENCE_REMOVAL_THRESHOLD) {
      toRemove.push(h.id);
      _confidenceMultiplier.delete(h.id);
      _verifiedAt.delete(h.id);
      continue;
    }

    // 2. Yeniden doğrulama kontrolü — snapped konum öncelikli (H5)
    if (effLat !== null && effLng !== null) {
      _checkReVerification(h, effLat, effLng, vehicleKmh);
    }

    // 3. Rota uygunluğu — snapped konum ile GPS drift önlenir (H5)
    let relevance = 0;
    if (geometry && effLat !== null && effLng !== null) {
      const distToVehicleKm = hav(effLat, effLng, h.lat, h.lng) / 1000;
      if (distToVehicleKm <= VEHICLE_PREFILTER_KM) {
        relevance = calculateRouteRelevance(h, geometry);
      }
    }

    newRelevance[h.id] = relevance;
    newIntensity[h.id] = calculateFinalIntensity(conf, h.severity, relevance, _lastAppliedDAB);
    surviving.push(h);
  }

  // ── Toplu kaldırma ───────────────────────────────────────────────────────
  for (const id of toRemove) store.removeHazard(id);

  // ── Store güncellemeleri ─────────────────────────────────────────────────
  store.setRouteRelevance(newRelevance);
  store.setHazardIntensity(newIntensity);

  // Raw global risk skoru
  const rawRisk = _computeGlobalRisk(surviving, newRelevance, newIntensity);

  // EMA filtresi: ani GPS değişimleri / hesap farklarını sönümle (H5)
  // filteredScore = prevScore × 0.85 + rawScore × 0.15
  _filteredRiskScore = _filteredRiskScore * 0.85 + rawRisk * 0.15;
  store.updateGlobalRisk(_filteredRiskScore);

  // Hysteresis durum makinesi — EMA skoru kullanır (H5)
  _updateHazardStatus(surviving, newRelevance, _filteredRiskScore, store.setHazardStatus);
}

/** Rota-ağırlıklı global risk skoru */
function _computeGlobalRisk(
  hazards:    Hazard[],
  relevance:  Record<string, number>,
  intensity:  Record<string, number>,
): number {
  if (hazards.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const h of hazards) {
    const rel = relevance[h.id] ?? 0;
    const int = intensity[h.id] ?? 0;
    weightedSum += int * rel;
    totalWeight += rel;
  }

  if (totalWeight === 0) return 0;
  return Math.min(1, weightedSum / totalWeight);
}

/**
 * Hysteresis durum makinesi geçişi (H5).
 * Basit eşik geçişi yerine "trigger / reset" bantları kullanılır:
 *   IDLE → AWARENESS:   risk ≥ 0.20,  geri dön < 0.15
 *   AWARENESS → PREPARE: risk ≥ 0.45, geri dön < 0.40
 *   PREPARE → ATTENTION: risk ≥ 0.70, geri dön < 0.65
 *
 * Bu tasarım durum salınımını (oscillation) önler: sürücü her 10s'de
 * PREPARE↔ATTENTION arasında geçiş gormez.
 */
function _updateHazardStatus(
  hazards:   Hazard[],
  relevance: Record<string, number>,
  risk:      number,
  setStatus: (s: HazardStatus) => void,
): void {
  const hasActive = hazards.some((h) => (relevance[h.id] ?? 0) >= 0.1);
  let next = _hazardStatusInternal;

  if (!hasActive || risk <= 0) {
    next = HazardStatus.IDLE;
  } else {
    switch (_hazardStatusInternal) {
      case HazardStatus.IDLE:
        if (risk >= 0.20) next = HazardStatus.AWARENESS;
        break;
      case HazardStatus.AWARENESS:
        if      (risk <  0.15) next = HazardStatus.IDLE;
        else if (risk >= 0.45) next = HazardStatus.PREPARE;
        break;
      case HazardStatus.PREPARE:
        if      (risk <  0.40) next = HazardStatus.AWARENESS;
        else if (risk >= 0.70) next = HazardStatus.ATTENTION;
        break;
      case HazardStatus.ATTENTION:
        if (risk < 0.65) next = HazardStatus.PREPARE;
        break;
      default:
        next = HazardStatus.IDLE;
    }
  }

  if (next !== _hazardStatusInternal) {
    _hazardStatusInternal = next;
    setStatus(next);
  }
}

/* ── Motor başlatma / durdurma ───────────────────────────────────────────── */

export function startHazardEngine(): void {
  if (_engineRunning) return;
  _engineRunning = true;

  _runDecayCycle();

  // FAZ 16 — sabit 10s `setInterval` yerine scheduler (§L.0, periodMs API).
  _decayTimer = runtimeManager.scheduleTask({
    id: 'hazard-decay', periodMs: DECAY_INTERVAL_MS, criticality: 'NORMAL',
    fn: () => {
      try { _runDecayCycle(); } catch (e) { logError('HazardEngine:Decay', e); }
    },
  });
}

export function stopHazardEngine(): void {
  _engineRunning = false;
  if (_decayTimer !== null) { _decayTimer(); _decayTimer = null; }
  // EMA ve durum makinesi sıfırla — sonraki oturumda temiz başlat
  _filteredRiskScore    = 0;
  _hazardStatusInternal = HazardStatus.IDLE;
}

/* ── Topluluk Tehlike Enjeksiyonu (Phase C4) ─────────────────────────────── */

/**
 * Buluttan çekilen ve aggregate edilmiş bir topluluk olayını Hazard motoruna enjekte eder.
 *
 * @param lat        Geohash merkezi enlemi
 * @param lng        Geohash merkezi boylamı
 * @param type       Tehlike kategorisi
 * @param confidence Rapor sayısına göre hesaplanan güven skoru [0.0 – 1.0]
 * @param geohash    Kaynak geohash — kararlı ID üretimi için
 */
export function injectCommunityHazard(
  lat:        number,
  lng:        number,
  type:       HazardType,
  confidence: number,
  geohash:    string,
): void {
  // Aynı hücre + tip kombinasyonu için kararlı ID → tekrar çekilince üzerine yazar (upsert)
  const id = `crm_${geohash}_${type}`;

  const hazard: Hazard = {
    id,
    type,
    lat,
    lng,
    severity:          0.65,
    source:            'USER_REPORT',
    timestamp:         Date.now(),
    initialConfidence: Math.max(0, Math.min(1, confidence)),
    decayRate:         COMMUNITY_DECAY_RATE, // ~1 saat içinde rapor gelmezse solar
    influenceRadius:   DEFAULT_RADIUS[type],
    isCommunity:       true,
  };

  useHazardStore.getState().upsertHazard(hazard);
}

/* ── Test enjeksiyonu ────────────────────────────────────────────────────── */

const HAZARD_TYPES: HazardType[]    = ['CONSTRUCTION', 'ACCIDENT', 'WEATHER', 'SPEED_CAM', 'ROAD_DAMAGE', 'TUNNEL'];
const HAZARD_SOURCES: HazardSource[] = ['SYSTEM', 'USER_REPORT'];

export function injectTestHazard(): void {
  const loc = useUnifiedVehicleStore.getState().location;
  const baseLat = (loc && isFinite(loc.latitude)  && Math.abs(loc.latitude)  <= 90)  ? loc.latitude  : 39.9208;
  const baseLng = (loc && isFinite(loc.longitude) && Math.abs(loc.longitude) <= 180) ? loc.longitude : 32.8541;
  const jitter  = () => (Math.random() - 0.5) * 0.01;

  const type   = HAZARD_TYPES[Math.floor(Math.random() * HAZARD_TYPES.length)];
  const source = HAZARD_SOURCES[Math.floor(Math.random() * HAZARD_SOURCES.length)];

  const hazard: Hazard = {
    id:                `test_${type}_${Date.now()}`,
    type,
    lat:               baseLat + jitter(),
    lng:               baseLng + jitter(),
    severity:          Math.round((0.3 + Math.random() * 0.7) * 100) / 100,
    source,
    timestamp:         Date.now(),
    initialConfidence: Math.round((0.5 + Math.random() * 0.5) * 100) / 100,
    decayRate:         DEFAULT_DECAY[type],
    influenceRadius:   DEFAULT_RADIUS[type],
  };

  useHazardStore.getState().upsertHazard(hazard);
}
