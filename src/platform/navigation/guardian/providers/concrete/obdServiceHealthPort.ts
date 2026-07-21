/**
 * obdServiceHealthPort — GUARDIAN-AI-G15 (Concrete OBD binding).
 *
 * `obdServiceSource.ts`in pure factory'sini GERÇEK OBD servisine bağlayan tek
 * yer. Bu dosya `obdService`'i import eder — ve `obdService` MODÜL SEVİYESİNDE
 * `runtimeManager.subscribe(...)` çalıştırır (import-time yan etki). Bu yüzden
 * binding, pure factory'den AYRI tutulur: pure factory (`obdServiceSource.ts`)
 * ve testleri obdService'i HİÇ import etmez → import-time yan etkisiz kalır;
 * yalnız burası (ve onu import eden wiring) obdService'e dokunur.
 *
 * ⚠️ `obdService.ts` DOSYASINA DOKUNULMAZ — yalnız READ-ONLY `getOBDDataSnapshot()`
 * (pull/snapshot) çağrılır. Bu getter'ın şekli `obdService` WIP'inden (hot-notify)
 * ETKİLENMEZ. OBDData sentinel'leri (`-1`/`undefined`) aynen geçirilir; pure
 * factory sentinel'i "yok" sayıp DROP eder.
 */
import { getOBDDataSnapshot } from '../../../../obdService';
import type { ObdHealthPort, ObdHealthSnapshot } from './obdServiceSource';

/**
 * Gerçek OBD servisinin son snapshot'ından (`getOBDDataSnapshot`) okuyan
 * `ObdHealthPort`. Yalnız desteklenen 2 alanı (engineTemp=coolant, batteryVoltage)
 * Guardian normalize snapshot'ına eşler; ham sentinel değerler AYNEN taşınır
 * (DROP kararı pure factory'de). Yeni DTO üretilir (snapshot mutate edilmez).
 * PULL — timer/listener EKLEMEZ.
 */
export function createObdServiceHealthPort(): ObdHealthPort {
  return {
    getLatestHealth(): ObdHealthSnapshot | undefined {
      const d = getOBDDataSnapshot();
      if (d === null || typeof d !== 'object') return undefined;
      return {
        engineTempC:     d.engineTemp,
        batteryVoltageV: d.batteryVoltage,
      };
    },
  };
}
