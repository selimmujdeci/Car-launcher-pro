/**
 * SafetyRuleEngine — Saf kural motoru (FAZ 1, 10 kural)
 *
 * SÖZLEŞME:
 *   - Saf fonksiyon: (state, now) → SafetyAlert[]
 *   - Yan etki YOK: IO yok, Date.now() kullanılmaz, modül-seviye mutable state yok.
 *   - Aynı (state, now) çağrısı → her zaman aynı çıktı (deterministik).
 *   - V8 hidden-class stabilitesi: alert objeleri tek şablondan üretilir.
 *
 * Tüm eşik/sabitler SAFETY_CONFIG altında toplanmıştır.
 */

import type {
  SafetyAlert,
  SafetyLevel,
  SafetyScreen,
  SafetyVehicleState,
  SafetyUpdatedAt,
} from './types';

// ── Sabitler / konfigürasyon ─────────────────────────────────────────────────

/** Tüm eşikler ve stale süreler tek yerde. Değiştirmek için buraya bak. */
const SAFETY_CONFIG = {
  // Hız histerezisi (km/h)
  MOVING_THRESHOLD: 5,      // speed > bu değer → MOVING
  STOPPED_THRESHOLD: 3,     // speed < bu değer → STOPPED (3–5 arası: ölü bant)

  // Kural bazında hız eşikleri (km/h)
  SPEED_SEATBELT: 10,       // seatbelt kuralı için minimum hız
  SPEED_HEADLIGHTS: 20,     // far kuralı için minimum hız
  SPEED_PARKBRAKE: 7,       // el freni kuralı için minimum hız

  // Motor sıcaklığı
  COOLANT_OVERHEAT: 118,    // °C — bu değer ve üstü → overheat
  COOLANT_VALID_MIN: 40,    // °C — geçerli aralık alt sınır
  COOLANT_VALID_MAX: 130,   // °C — geçerli aralık üst sınır

  // Yakıt
  FUEL_LOW: 8,              // % — bu değer ve altı → low_fuel

  // Akü
  BATTERY_LOW: 11.8,        // V — bu değerin altı → uyarı

  // Stale süreler (ms)
  STALE_GENERAL: 2000,      // genel sinyal stale süresi
  STALE_COOLANT: 10000,     // coolantTemp için uzatılmış stale süresi (SAFETY_STANDARD §1, #7)
} as const;

// ── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

/**
 * Bir sinyalin bayat (stale) olup olmadığını kontrol eder.
 * updatedAt[key] yoksa "taze" sayılır (stale değil).
 */
function isStale(
  key: keyof SafetyVehicleState,
  updatedAt: SafetyUpdatedAt | undefined,
  now: number,
  maxAgeMs: number,
): boolean {
  if (!updatedAt) return false;
  const ts = updatedAt[key];
  if (ts === undefined) return false;
  return now - ts > maxAgeMs;
}

/**
 * Araç hareket halinde mi?
 * speed > MOVING_THRESHOLD (km/h). speed null/undefined → false.
 */
function isMoving(speed: number | null | undefined): boolean {
  return speed != null && speed > SAFETY_CONFIG.MOVING_THRESHOLD;
}

/**
 * Araç duruyor mu?
 * speed < STOPPED_THRESHOLD (km/h). speed null/undefined → false.
 */
function isStopped(speed: number | null | undefined): boolean {
  return speed != null && speed < SAFETY_CONFIG.STOPPED_THRESHOLD;
}

/**
 * V8 hidden-class stabilitesi için tek şablon: alert oluşturma.
 * Her zaman aynı alan sırası ile oluşturulur.
 */
function makeAlert(
  ruleId: string,
  level: SafetyLevel,
  message: string,
  icon: string,
  screen: SafetyScreen,
  priority: number,
  ts: number,
): SafetyAlert {
  return {
    ruleId,
    level,
    message,
    icon,
    screen,
    priority,
    ts,
  };
}

// ── Ana fonksiyon ─────────────────────────────────────────────────────────────

/**
 * Güvenlik kurallarını değerlendirir ve aktif uyarıları döner.
 *
 * @param state   - Normalleştirilmiş araç durumu (tüm alanlar opsiyonel)
 * @param updatedAt - Her sinyalin son güncelleme zaman damgası (ms)
 * @param now     - Mevcut zaman (ms) — Date.now() DEĞİL, dışarıdan gelir
 * @returns       - Priority azalan sıralı SafetyAlert dizisi
 */
export function evaluateSafetyRules(
  state: SafetyVehicleState,
  now: number,
  updatedAt?: SafetyUpdatedAt,
): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];

  // Kolaylık için hız durumu (bir kez hesapla)
  const moving = isMoving(state.speed);
  const stopped = isStopped(state.speed);
  const speedKnown = state.speed != null;

  // ── Kural 1: reverse.active ─────────────────────────────────────────────
  // Geri viteste hız bağımsız uyarı (overlay).
  if (
    state.reverse === true &&
    !isStale('reverse', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL)
  ) {
    alerts.push(makeAlert(
      'reverse.active',
      'info',
      'Geri vites — kamera görünümü.',
      'reverse',
      'overlay',
      10,
      now,
    ));
  }

  // ── Kural 2: door.open.moving ────────────────────────────────────────────
  // Hareket halinde kapı açık → critical. speed bilinmeli ve MOVING olmalı.
  if (
    state.doorOpen === true &&
    speedKnown &&
    moving &&
    !isStale('doorOpen', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL) &&
    !isStale('speed', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL)
  ) {
    alerts.push(makeAlert(
      'door.open.moving',
      'critical',
      'Kapı açık, lütfen kapıyı hemen kapatın.',
      'door',
      'banner',
      95,
      now,
    ));
  }

  // ── Kural 3: parking_brake.moving ────────────────────────────────────────
  // El freni çekili ve hız > SPEED_PARKBRAKE → critical.
  if (
    state.parkingBrake === true &&
    speedKnown &&
    state.speed != null &&
    state.speed > SAFETY_CONFIG.SPEED_PARKBRAKE &&
    !isStale('parkingBrake', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL) &&
    !isStale('speed', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL)
  ) {
    alerts.push(makeAlert(
      'parking_brake.moving',
      'critical',
      'El freni çekili, lütfen el frenini indirin.',
      'parkingBrake',
      'banner',
      90,
      now,
    ));
  }

  // ── Kural 4: engine.overheat ─────────────────────────────────────────────
  // coolantTemp >= 118 ve geçerli aralıkta (40–130) → critical.
  // Stale istisnası: 10000 ms'e kadar geçerli, sonra pasif.
  if (
    state.coolantTemp != null &&
    state.coolantTemp >= SAFETY_CONFIG.COOLANT_OVERHEAT &&
    state.coolantTemp >= SAFETY_CONFIG.COOLANT_VALID_MIN &&
    state.coolantTemp <= SAFETY_CONFIG.COOLANT_VALID_MAX &&
    !isStale('coolantTemp', updatedAt, now, SAFETY_CONFIG.STALE_COOLANT)
  ) {
    alerts.push(makeAlert(
      'engine.overheat',
      'critical',
      'Motor sıcaklığı yüksek, lütfen güvenli yerde durun.',
      'temp',
      'banner',
      100,
      now,
    ));
  }

  // ── Kural 5: seatbelt.unfastened.moving ──────────────────────────────────
  // Kemer takılı değil ve hız > SPEED_SEATBELT → warning.
  if (
    state.seatbelt === false &&
    speedKnown &&
    state.speed != null &&
    state.speed > SAFETY_CONFIG.SPEED_SEATBELT &&
    !isStale('seatbelt', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL) &&
    !isStale('speed', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL)
  ) {
    alerts.push(makeAlert(
      'seatbelt.unfastened.moving',
      'warning',
      'Emniyet kemeri takılı değil.',
      'seatbelt',
      'banner',
      70,
      now,
    ));
  }

  // ── Kural 6: hood_or_trunk.open.moving ───────────────────────────────────
  // Kaput veya bagaj açık ve MOVING → critical.
  if (
    (state.hoodOpen === true || state.trunkOpen === true) &&
    speedKnown &&
    moving &&
    !isStale('hoodOpen', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL) &&
    !isStale('trunkOpen', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL) &&
    !isStale('speed', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL)
  ) {
    alerts.push(makeAlert(
      'hood_or_trunk.open.moving',
      'critical',
      'Kaput veya bagaj açık, lütfen durup kontrol edin.',
      'hood',
      'banner',
      97,
      now,
    ));
  }

  // ── Kural 7: headlights.off.dark ─────────────────────────────────────────
  // Farlar kapalı, karanlık ve hız > SPEED_HEADLIGHTS → warning.
  if (
    state.headlightsOn === false &&
    state.isDark === true &&
    speedKnown &&
    state.speed != null &&
    state.speed > SAFETY_CONFIG.SPEED_HEADLIGHTS &&
    !isStale('headlightsOn', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL) &&
    !isStale('isDark', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL) &&
    !isStale('speed', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL)
  ) {
    alerts.push(makeAlert(
      'headlights.off.dark',
      'warning',
      'Farlar kapalı görünüyor.',
      'headlights',
      'banner',
      60,
      now,
    ));
  }

  // ── Kural 8: low_fuel ────────────────────────────────────────────────────
  // Yakıt <= %8 → warning (ikon seviyesi — ses yok zorunlu değil, UI kararı).
  if (
    state.fuel != null &&
    state.fuel <= SAFETY_CONFIG.FUEL_LOW &&
    !isStale('fuel', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL)
  ) {
    alerts.push(makeAlert(
      'low_fuel',
      'warning',
      'Yakıt seviyesi düşük.',
      'fuel',
      'icon',
      40,
      now,
    ));
  }

  // ── Kural 9: battery_or_oil.warning ──────────────────────────────────────
  // Yağ uyarısı VEYA akü < 11.8V → critical.
  const oilFault = state.oilWarning === true &&
    !isStale('oilWarning', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL);
  const battFault = state.batteryVolt != null &&
    state.batteryVolt < SAFETY_CONFIG.BATTERY_LOW &&
    !isStale('batteryVolt', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL);

  if (oilFault || battFault) {
    alerts.push(makeAlert(
      'battery_or_oil.warning',
      'critical',
      'Araçta bir arıza göstergesi var, kontrol önerilir.',
      'battery',
      'banner',
      80,
      now,
    ));
  }

  // ── Kural 10: park.door.open ─────────────────────────────────────────────
  // Kapı açık ve araç DURUYORSA → sessiz info ikonu.
  // door.open.moving ile çakışma yok: ölü bantta (3–5 km/h) ikisi de tetiklenmez.
  if (
    state.doorOpen === true &&
    speedKnown &&
    stopped &&
    !isStale('doorOpen', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL) &&
    !isStale('speed', updatedAt, now, SAFETY_CONFIG.STALE_GENERAL)
  ) {
    alerts.push(makeAlert(
      'park.door.open',
      'info',
      'Kapı açık.',
      'door',
      'icon',
      20,
      now,
    ));
  }

  // ── Çıktı sıralaması ─────────────────────────────────────────────────────
  // Priority azalan sıralı. Eşitlikte ruleId'ye göre alfabetik (deterministik).
  alerts.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });

  return alerts;
}
