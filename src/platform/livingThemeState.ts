/**
 * livingThemeState — Living Theme System · SAF türetme katmanı (Commit 1)
 *
 * SÖZLEŞME (değişmez):
 *   - SAF fonksiyonlar: aynı girdi → aynı çıktı, yan etki YOK.
 *   - DOM yazımı YOK · CSS YOK · store yazımı YOK · React YOK.
 *   - Yalnızca mevcut kaynaklardan türetilmiş "living state" hesaplar.
 *
 * Bu modül hiçbir şey UYGULAMAZ; yalnızca durumu MODELLER. Token swap /
 * animasyon / component değişimi sonraki commit'lerin işi.
 *
 * Eksenler:
 *   tod   — günün vakti (sabah/gündüz/akşam/gece)   ← useDayNightManager + saat
 *   veh   — araç durumu (normal/yakıt/ısı/obd-yok)   ← OBD verisi
 *   conn  — bağlantı (online/offline)                 ← navigator.onLine
 *   comp  — Yol Arkadaşım (idle/listening/...)        ← voiceService.status
 *   level — animasyon seviyesi (full/reduced/static)  ← tier + runtime + reduced-motion
 *
 * Animasyon seviyesi runtime KONFİGÜRASYONUNDAN kanıtlanır (yeni tespit YOK):
 *   getRuntimeConfig(mode).enableAnimations === false → static
 *   (BASIC_JS / POWER_SAVE / SAFE_MODE hepsi enableAnimations:false → static).
 */

import type { DeviceTier } from './deviceCapabilities';
import { type RuntimeMode } from '../core/runtime/runtimeTypes';
import { getRuntimeConfig } from '../core/runtime/runtimeConfig';

/* ── Tipler ──────────────────────────────────────────────────── */

export type TimeOfDay        = 'morning' | 'day' | 'evening' | 'night';
export type VehicleStatus    = 'normal' | 'fuel-low' | 'temp-high' | 'obd-offline';
export type ConnectionStatus = 'online' | 'offline';
export type CompanionStatus  = 'idle' | 'listening' | 'processing' | 'speaking';
export type AnimationLevel   = 'full' | 'reduced' | 'static';

export interface LivingThemeState {
  tod:   TimeOfDay;
  veh:   VehicleStatus;
  conn:  ConnectionStatus;
  comp:  CompanionStatus;
  level: AnimationLevel;
}

export interface LivingThemeInputs {
  /** useDayNightManager'ın yazdığı store değeri — gün/gece otoritesi (salt okunur). */
  dayNightMode:         'day' | 'night';
  /** 0–23 saat — gündüz bandı içinde sabah/akşam ayrımı için. */
  hour:                 number;
  /** OBD bağlı VE veri taze mi (hook hesaplar; stale → false). */
  obdConnected:         boolean;
  /** Yakıt yüzdesi (%); bilinmiyorsa < 0. */
  fuelLevel:            number;
  /** Motor (soğutma sıvısı) sıcaklığı °C; bilinmiyorsa < 0. */
  engineTemp:           number;
  /** navigator.onLine. */
  online:               boolean;
  /** voiceService VoiceStatus (idle/listening/processing/success/error/throttled). */
  voiceStatus:          string;
  /** Kanonik cihaz sınıfı (deviceCapabilities.getDeviceTier). */
  tier:                 DeviceTier;
  /** Aktif runtime modu (runtimeManager.getMode). */
  runtimeMode:          RuntimeMode;
  /** prefers-reduced-motion: reduce. */
  prefersReducedMotion: boolean;
}

/* ── Eşikler (tek kaynak) ────────────────────────────────────── */

/** Yakıt bu yüzdenin altında → düşük yakıt uyarısı. */
export const FUEL_LOW_PCT = 12;
/** Motor sıcaklığı bu °C'nin üstünde → aşırı ısınma uyarısı. */
export const ENGINE_TEMP_HIGH_C = 105;
/** Gündüz bandı (useDayNightManager DAY_START_H/DAY_END_H ile aynı). */
const DAY_START_H = 7;
const DAY_END_H   = 19;
/** Sabah penceresi (gündüz bandının başı). */
const MORNING_END_H = 9;
/** Akşam penceresi (gündüz bandının sonu). */
const EVENING_START_H = 17;

/* ── Saf türetmeler ──────────────────────────────────────────── */

/**
 * Günün vakti. Gün/gece OTORİTESİ dayNightMode (useDayNightManager ile yarışmaz —
 * onu yalnız OKUR). Gündüz ise saat bandına göre sabah/akşam/gündüz ayrımı yapılır.
 */
export function deriveTimeOfDay(dayNightMode: 'day' | 'night', hour: number): TimeOfDay {
  if (dayNightMode === 'night') return 'night';
  if (hour >= DAY_START_H && hour < MORNING_END_H)   return 'morning';
  if (hour >= EVENING_START_H && hour < DAY_END_H)   return 'evening';
  return 'day';
}

/**
 * Araç durumu. Öncelik: temp-high > fuel-low > obd-offline > normal.
 * temp/fuel yalnız OBD bağlı + geçerli değerde değerlendirilir; bağlı değilse
 * (veya stale) obd-offline. Böylece stale veriyle yanlış uyarı verilmez.
 */
export function deriveVehicleStatus(obdConnected: boolean, fuelLevel: number, engineTemp: number): VehicleStatus {
  if (!obdConnected) return 'obd-offline';
  if (Number.isFinite(engineTemp) && engineTemp >= ENGINE_TEMP_HIGH_C) return 'temp-high';
  if (Number.isFinite(fuelLevel) && fuelLevel >= 0 && fuelLevel <= FUEL_LOW_PCT) return 'fuel-low';
  return 'normal';
}

/** Bağlantı durumu. */
export function deriveConnectionStatus(online: boolean): ConnectionStatus {
  return online ? 'online' : 'offline';
}

/**
 * Yol Arkadaşım durumu — voiceService.status → companion ekseni.
 *   listening → listening · processing → processing · success → speaking (cevap TTS)
 *   idle/error/throttled → idle (geçici/sessiz durumlar tek "idle"a iner).
 */
export function deriveCompanionStatus(voiceStatus: string): CompanionStatus {
  switch (voiceStatus) {
    case 'listening':  return 'listening';
    case 'processing': return 'processing';
    case 'success':    return 'speaking';
    default:           return 'idle';
  }
}

/**
 * Animasyon seviyesi — yeni donanım tespiti YOK; mevcut tek-kaynaklardan türetilir.
 *   1. tier=low (Mali-400/K24)                → static
 *   2. enableAnimations=false (runtime config) → static  ← BASIC_JS/POWER_SAVE/SAFE_MODE
 *   3. prefers-reduced-motion: reduce          → reduced
 *   4. diğer (PERFORMANCE/BALANCED, mid/high)  → full
 *
 * Kural 2, runtimeConfig.ts'ten KANITTIR: BASIC_JS_CONFIG.enableAnimations === false →
 * "animasyon yok" runtime niyeti → static. (Mevcut body.performance-mode / data-compat-mode
 * kill-switch'leriyle çakışmaz, onları pekiştirir.)
 */
export function deriveAnimationLevel(
  tier: DeviceTier,
  runtimeMode: RuntimeMode,
  prefersReducedMotion: boolean,
): AnimationLevel {
  if (tier === 'low') return 'static';
  if (!getRuntimeConfig(runtimeMode).enableAnimations) return 'static';
  if (prefersReducedMotion) return 'reduced';
  return 'full';
}

/* ── Birleşik türetme ────────────────────────────────────────── */

/** Tüm eksenleri tek SAF çağrıda hesaplar. Yan etki yok; yeni nesne döner. */
export function deriveLivingThemeState(i: LivingThemeInputs): LivingThemeState {
  return {
    tod:   deriveTimeOfDay(i.dayNightMode, i.hour),
    veh:   deriveVehicleStatus(i.obdConnected, i.fuelLevel, i.engineTemp),
    conn:  deriveConnectionStatus(i.online),
    comp:  deriveCompanionStatus(i.voiceStatus),
    level: deriveAnimationLevel(i.tier, i.runtimeMode, i.prefersReducedMotion),
  };
}
