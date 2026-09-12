/**
 * maviWorkloadSource — **MAVİ F8 · workload'ın TEK canlı okuma adaptörü.**
 *
 * ── NEDEN AYRI DOSYA ────────────────────────────────────────────────────────
 * `maviWorkload` SAF kalmalıdır: `voiceService` ve `maviResponseStream` onu
 * statik import eder. O grafiğe `navigationService` (zustand store + rota
 * motoru) veya `assistantSafetyKernel`in canlı OBD/DTC okumaları girerse hem
 * test grafiği hem boot maliyeti kirlenir. `maviVehicleSnapshotSource` ile
 * BİREBİR aynı desen: **saf çözümleyici bir dosyada, canlı okuma ayrı dosyada,
 * bağlama yalnız composition root'ta.**
 *
 * ── SINIRLAR ────────────────────────────────────────────────────────────────
 *  · YENİ state/poll/timer/abonelik ÜRETMEZ — yalnız senkron okuma.
 *  · Her kaynak AYRI try/catch → biri düşerse alan `null` olur (sahte değer YOK).
 *  · Hiçbir otoriteye YAZMAZ; navigasyonu, sesi, aracı ETKİLEMEZ.
 *  · **Telefon görüşmesi OKUNMAZ** — repoda böyle bir üretim sinyali YOK
 *    (`DuckReason 'PHONE'` tanımlı ama üretimde çağıranı yok). Uydurulmaz.
 */

import { getNavigationState } from '../navigationService';
import { getRouteState } from '../routingService';
import { useSystemStore } from '../../store/useSystemStore';
import { useCognitiveStore, MODE_RANK } from '../../store/useCognitiveStore';
import { buildSafetyContext, evaluatePreGate } from './assistantSafetyKernel';
import { currentMaviVehicleContext } from './maviVehicleContext';
import type { MaviCognitiveLoad, MaviWorkloadSnapshot } from './maviWorkload';

/** Bilişsel mod rütbesi → bounded workload özeti (store sabiti SIZDIRILMAZ). */
function _cognitiveLoad(): MaviCognitiveLoad | null {
  try {
    const rank = MODE_RANK[useCognitiveStore.getState().currentMode];
    if (typeof rank !== 'number' || !Number.isFinite(rank)) return null;
    if (rank >= MODE_RANK.CRITICAL) return 'critical';
    if (rank >= MODE_RANK.PROTECTION) return 'protection';
    return 'normal';
  } catch { return null; }
}

/**
 * Canlı kaynaklardan tek seferlik, dondurulmuş workload snapshot'ı toplar.
 * Karar VERMEZ — yorumlama `resolveMaviWorkload` içindedir.
 */
export function captureMaviWorkloadSnapshot(): MaviWorkloadSnapshot {
  let motionState: MaviWorkloadSnapshot['motionState'] = 'unknown';
  let speedKmh: number | null = null;
  let reverseActive: boolean | null = null;
  let guidanceActive: boolean | null = null;
  let maneuverDistanceM: number | null = null;
  let maneuverDistanceSource: MaviWorkloadSnapshot['maneuverDistanceSource'] = null;
  let safetyCritical: boolean | null = null;

  /* Hareket — Mavi'nin KANONİK araç bağlamı (yeni paralel hız okuması YOK). */
  try {
    const ctx = currentMaviVehicleContext();
    motionState = ctx.motionState ?? (ctx.isDriving ? 'moving' : 'unknown');
    speedKmh = typeof ctx.speedKmh === 'number' && Number.isFinite(ctx.speedKmh)
      ? ctx.speedKmh : null;
    /* `reverseActive` bağlamda `undefined` ise BİLİNMİYOR demektir — `false`a
     * indirgenmez (M2 anayasası). */
    reverseActive = ctx.reverseActive === true ? true
      : ctx.reverseActive === false ? false : null;
  } catch { /* kanıt yok → unknown */ }

  /* Geri vites — bağlam vermediyse sistem deposundaki POZİTİF sinyale bakılır. */
  if (reverseActive === null) {
    try { reverseActive = useSystemStore.getState().isReverseActive === true ? true : null; }
    catch { /* kanıt yok */ }
  }

  /* Rehberlik — `isNavigating` DEĞİL `isGuidanceActive` (önizleme rehberlik
   * değildir; kütük #416/#418). */
  try { guidanceActive = getNavigationState().isGuidanceActive === true; }
  catch { guidanceActive = null; }

  /* Manevra yakınlığı — mesafe ve KAYNAĞI birlikte taşınır; kaynağı `UNKNOWN`
   * olan mesafe kanıt sayılmaz (çözümleyici reddeder). */
  try {
    const rs = getRouteState();
    const d = rs.distanceToNextTurnMeters;
    maneuverDistanceM = typeof d === 'number' && Number.isFinite(d) ? d : null;
    const src = rs.distanceToNextTurnSource;
    maneuverDistanceSource = src === 'ALONG_ROUTE' || src === 'STRAIGHT_LINE' || src === 'UNKNOWN'
      ? src : null;
  } catch { /* rota yok → kanıt yok */ }

  /* Kritik güvenlik — kanonik çekirdekten OKUNUR; burada eşik YENİDEN
   * hesaplanmaz (ikinci güvenlik otoritesi kurulmaz). */
  try { safetyCritical = evaluatePreGate(buildSafetyContext()).severity === 'critical'; }
  catch { safetyCritical = null; }

  return Object.freeze({
    motionState,
    speedKmh,
    reverseActive,
    guidanceActive,
    maneuverDistanceM,
    maneuverDistanceSource,
    safetyCritical,
    cognitiveLoad: _cognitiveLoad(),
  });
}
