/**
 * useCanonicalVehicleSignal — ÜRÜN ARAYÜZÜNÜN TEK ARAÇ-VERİSİ KAPISI (P0-OBD-03).
 *
 * ── NEDEN VAR (ölçülen kusur) ─────────────────────────────────────────────
 * Üç tema başlığı (Expedition · Horizon · Tesla) ortam sıcaklığını
 * `useUnifiedVehicleStore(s => s.canAmbientTemp)` ile **DOĞRUDAN CAN alanından**
 * okuyordu. CAN'ı olmayan (aftermarket ELM327'li) araçta bu alan kalıcı `null`dır
 * → başlıkta sonsuza dek `—` görünüyordu, oysa PID 0x46 o sırada okunuyor ve
 * kanonik mağazaya yazılıyordu. Aynı kusur `useEngineReadout` (motor ısısı),
 * `voiceInfoService` (Mavi "motor sıcaklığı verisi yok" diyordu) ve
 * `vehicleIntelligenceService` (soğutma/gaz kelebeği makullük denetimi) için de
 * geçerliydi.
 *
 * Üstelik her tüketici **kendi** öncelik/tazelik mantığını yazıyordu
 * (`useEngineReadout` OBD canlılık kapısı + CAN yedeği; `useBatteryVoltage` CAN
 * sonra ATRV). Aynı fiziksel veri için ikinci bir otorite, kütükte defalarca
 * kaydedilmiş bir hata desenidir.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · Otorite TEK yerde: `canonicalVehicleSignal` (CAN → OBD → yok).
 *  · Arayüz YALNIZ `LIVE` okumayı sayı olarak gösterir. `STALE`/`UNAVAILABLE`
 *    → `null` → bileşen `—` basar. Bayat değer canlı gibi GÖSTERİLMEZ.
 *  · Sahte 0 / varsayılan ÜRETİLMEZ.
 *  · Bu hook kendi tazelik ya da öncelik mantığını KURMAZ; yalnız politikayı
 *    çağırır ve React'e bağlar.
 *
 * ── PERFORMANS (K24 / Mali-400) ───────────────────────────────────────────
 * Seçiciler DAR ve İLKEL/kararlı-referans döndürür:
 *   · `obdSignals[key]` → yalnız O sinyal yazıldığında referans değişir
 *     (tüm harita DEĞİL — aksi hâlde her OBD yazımı tüm başlıkları uyandırırdı),
 *   · CAN alanı → sayı,
 *   · `obdSessionEpoch` → sayı.
 * Seçici İÇİNDE nesne ÜRETİLMEZ (Zustand varsayılan `Object.is` kıyası her
 * store değişiminde yeniden çizerdi — hız 3 Hz'de akarken bu bir regresyon
 * olurdu). Hüküm `useMemo` ile seçici DIŞINDA hesaplanır.
 *
 * ── ÇÜRÜME ────────────────────────────────────────────────────────────────
 * Bu hook zamanlayıcı KURMAZ. Süresi dolan ölçümleri mağazadan düşüren şey
 * `obdSignalBridge`in çürüme tikidir (`obdService`in ZATEN çalışan bayatlık
 * gözcüsüne iliştirilmiştir) — düşünce referans değişir ve arayüz kendiliğinden
 * yeniden değerlendirir.
 */

import { useMemo } from 'react';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import {
  resolveLiveCanonicalSignal, resolveCanonicalSignal,
  type CanonicalSharedSignal, type CanonicalSignalReading,
} from '../platform/vehicleDataLayer/canonicalVehicleSignal';
import type { UnifiedVehicleState } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { CanonicalObdKey } from '../platform/obd/canonicalObdSignals';

/** Paylaşılan büyüklük → (CAN mağaza alanı · OBD kanonik anahtarı). */
const FIELDS: Readonly<Record<CanonicalSharedSignal, {
  can: keyof UnifiedVehicleState; obd: CanonicalObdKey;
}>> = {
  coolantTemp: { can: 'canCoolantTemp', obd: 'coolantTemp' },
  oilTemp:     { can: 'canOilTemp',     obd: 'oilTemp' },
  throttle:    { can: 'canThrottle',    obd: 'throttle' },
  batteryVolt: { can: 'canBatteryVolt', obd: 'moduleVoltage' },
  ambientTemp: { can: 'canAmbientTemp', obd: 'ambientTemp' },
};

/**
 * Bir paylaşılan sinyalin TAM otoriter okuması (durum dahil).
 *
 * `reading.state === 'STALE'` iken `value` DOLUDUR — çağıran bayat olduğunu
 * belirterek göstermek isterse kullanabilir. Sayıyı düz gösterecekse
 * {@link useLiveVehicleSignal} kullanılmalıdır.
 */
export function useCanonicalVehicleSignal(
  signal: CanonicalSharedSignal,
): CanonicalSignalReading {
  const f = FIELDS[signal];
  // DAR seçiciler — nesne ÜRETMEZ (bkz. başlıktaki performans notu).
  const canVal = useUnifiedVehicleStore((s) => s[f.can] as number | null);
  const entry  = useUnifiedVehicleStore((s) => s.obdSignals[f.obd]);
  const epoch  = useUnifiedVehicleStore((s) => s.obdSessionEpoch);

  return useMemo(() => {
    /* Politikaya YALNIZ ihtiyaç duyduğu alanlar verilir; tüm store'u geçirmek
       bu hook'u ilgisiz alan değişimlerine bağımlı kılardı (kıyas maliyeti). */
    const slice = {
      [f.can]: canVal,
      obdSignals: entry === undefined ? {} : { [f.obd]: entry },
      obdSessionEpoch: epoch,
    } as unknown as Parameters<typeof resolveCanonicalSignal>[0];
    return resolveCanonicalSignal(slice, signal, Date.now());
  }, [f.can, f.obd, canVal, entry, epoch, signal]);
}

/**
 * Yalnız GÖSTERİLEBİLİR (LIVE) değer — bayat/eksik ölçümde `null`.
 *
 * Arayüzün varsayılan kapısı budur: `—` göstermek, donmuş bir sayıyı canlı
 * göstermekten HER ZAMAN dürüsttür.
 */
export function useLiveVehicleSignal(signal: CanonicalSharedSignal): number | null {
  const f = FIELDS[signal];
  const canVal = useUnifiedVehicleStore((s) => s[f.can] as number | null);
  const entry  = useUnifiedVehicleStore((s) => s.obdSignals[f.obd]);
  const epoch  = useUnifiedVehicleStore((s) => s.obdSessionEpoch);

  return useMemo(() => {
    const slice = {
      [f.can]: canVal,
      obdSignals: entry === undefined ? {} : { [f.obd]: entry },
      obdSessionEpoch: epoch,
    } as unknown as Parameters<typeof resolveLiveCanonicalSignal>[0];
    return resolveLiveCanonicalSignal(slice, signal, Date.now()).value;
  }, [f.can, f.obd, canVal, entry, epoch, signal]);
}

/**
 * Dış ortam sıcaklığı (°C) — tema başlıklarının TEK kaynağı.
 *
 * `null` → arayüz `—` gösterir. CAN varsa CAN, yoksa OBD PID 0x46; ikisi de
 * yoksa ya da ölçüm bayatsa `null`.
 */
export function useAmbientTemp(): number | null {
  return useLiveVehicleSignal('ambientTemp');
}
