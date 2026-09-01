/**
 * useBatteryVoltage — 12 V akü voltajının TEK OKUMA OTORİTESİ (saha 2026-08-05 · kütük #427).
 *
 * SAHADA ÖLÇÜLDÜ: konsolda `[Battery] NORMAL → WARN @ N V` — sistem voltajı ölçtü,
 * WARN eşiğine düştüğünü tespit etti, güç tavanını kıstı. Buna karşılık ana ekran
 * araç durumu kartı aynı oturum boyunca **`Akü —`** gösterdi.
 *
 * KÖK: iki ayrı yol vardı ve BULUŞMUYORLARDI.
 *   • Karar yolu : `BatteryProtectionService` → OBD `batteryVoltage` (ELM327 ATRV / PID 0x42)
 *   • Gösterim   : `UnifiedVehicleStore.canBatteryVolt` → YALNIZ CAN adaptöründen dolar
 * CAN'ı olmayan (aftermarket ELM327'li) araçta gösterim kalıcı olarak `—` kalıyordu,
 * oysa karar üretecek kadar veri VARDI. Vizyon anayasasının 3. kapısı (*kullanıcı
 * bilmeli mi?*) burada kopuktu: düşük akü, yolda kalmanın en yaygın nedenlerinden.
 *
 * ÖNCELİK: CAN → OBD → yok. CAN varsa o otoriterdir (doğrudan araç şebekesi);
 * yoksa OBD adaptörünün ölçtüğü değer kullanılır. Hiçbiri yoksa `null` döner ve
 * arayüz `—` gösterir — sahte 0 / sahte "sağlıklı" YASAK.
 *
 * ── P0-OBD-01 · OTORİTE TEK YERE TAŞINDI ──────────────────────────────────
 * Bu hook önceliği KENDİ İÇİNDE yazıyordu; aynı karar `safetyStateMapper`da
 * ayrıca (ve eksik: yalnız CAN) yazılıydı → ikinci otorite. Karar artık
 * `canonicalVehicleSignal.resolveCanonicalSignal`de TEK yerdedir.
 *
 * OBD ucu GENİŞLEDİ (davranış GERİLEMEDİ): kanonik köprü PID 0x42 (kontrol
 * ünitesi voltajı — ECU'nun kendi ölçümü) okunuyorsa onu kullanır; yoksa eski
 * yol olan ELM327 `ATRV` okuması (`OBDData.batteryVoltage`) YEDEK olarak
 * KALIR. Yani zincir: CAN → OBD PID 0x42 → ATRV → yok.
 */
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { resolveBatteryVoltage } from '../platform/vehicleDataLayer/canonicalVehicleSignal';
import { useOBDState } from '../platform/obdService';
import { useEffect, useState } from 'react';
import { onBatteryLevel, getBatteryLevel, type BatteryLevel } from '../platform/power/BatteryProtectionService';

export interface BatteryVoltageReading {
  /** Volt, veya `null` = ölçülemiyor (arayüz `—` gösterir). */
  volt: number | null;
  /** Değerin nereden geldiği — kanıtsız bilgi üretmemek için. */
  source: 'CAN' | 'OBD' | 'NONE';
  /** Akü koruma servisinin güncel kararı. Değer varken uyarı gizlenmez. */
  level: BatteryLevel;
  /** `NORMAL` dışı her seviye sürücüye görünür olmalıdır. */
  isWarning: boolean;
}

/** 12 V akü hattı için fiziksel/adaptör-hata bandı — obdSanitizer ile aynı sözleşme. */
const MIN_V = 8;
const MAX_V = 16;

function _valid(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= MIN_V && v <= MAX_V;
}

export function useBatteryVoltage(): BatteryVoltageReading {
  const canVolt    = useUnifiedVehicleStore((s) => s.canBatteryVolt);
  const obdSignals = useUnifiedVehicleStore((s) => s.obdSignals);
  const obdSessionEpoch = useUnifiedVehicleStore((s) => s.obdSessionEpoch);
  const obd        = useOBDState();
  const [level, setLevel] = useState<BatteryLevel>(() => getBatteryLevel());

  useEffect(() => {
    // Akü koruma servisi kararını YAYINLAR; burada yalnız dinlenir (salt-okunur).
    const off = onBatteryLevel((next) => setLevel(next));
    return off;
  }, []);

  /* TEK ZİNCİR (P0-OBD-03): CAN → OBD PID 0x42 → adaptör ATRV → yok.
     Zincir artık BU DOSYADA YAZILI DEĞİL — `resolveBatteryVoltage` tek yerdir;
     eskiden aynı öncelik `diagnosticSections.buildPowerSnapshot` içinde de
     AYRICA yazılıydı ve ikisi ayrışabiliyordu. `resolveLive…` bayat ölçümü de
     eler: akü uyarısını dakikalar önce ölçülmüş bir voltajla göstermek, donmuş
     bir sayıyı canlı sanmaktır. */
  const r = resolveBatteryVoltage(
    { canBatteryVolt: canVolt, obdSignals, obdSessionEpoch },
    _valid(obd.batteryVoltage) ? obd.batteryVoltage : null,
    Date.now(),
  );
  return { volt: r.value, source: r.source, level, isWarning: level !== 'NORMAL' };
}

/** `12.4` → `"12.4"`, ölçülemiyorsa `"—"`. Sahte 0 üretmez. */
export function formatVoltage(v: number | null): string {
  return v == null ? '—' : v.toFixed(1);
}
