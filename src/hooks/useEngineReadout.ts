import { useOBDField } from '../platform/obdService';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import { isObdReadingLive } from '../platform/vehicleStatusModel';
import { useLiveVehicleSignal } from './useCanonicalVehicleSignal';

/**
 * useEngineReadout — motor göstergesi (RPM / motor ısısı / yakıt) için TEK kaynak.
 *
 * İki yolu birleştirir:
 *   1. Doğrudan OBD servisi (obdService → useOBDState) — app kendi BT ELM327'sine
 *      bağlanırsa. K24'te standart Android BT KİLİTLİ olduğundan bu yol genelde boş.
 *   2. OEM CarInfo akışı (NwdCanClient → UnifiedVehicleStore.canRpm/canCoolantTemp).
 *      K24'te OBD, OEM "OBD match" (Classic SPP ELM327) ile bağlanınca OEM RPM'i
 *      setCarEngineSpeedFromObd ile CarInfo'ya yazar → buraya akar.
 *
 * Öncelik: doğrudan OBD (taze) → yoksa CarInfo. Her ikisi de yoksa null ("—").
 * Bu sayede tema bileşenleri kaynaktan bağımsız tek hook ile motor verisini gösterir.
 *
 * ── P0-OBD-03 · MOTOR ISISI ARTIK KANONİK OTORİTEDEN ──────────────────────
 * `engineTemp` bu hook'un İÇİNDE kendi öncelik + tazelik mantığını yazıyordu
 * (OBD canlılık kapısı, sonra ham `canCoolantTemp` yedeği, sonra elle bant
 * denetimi `> -40 && < 200`). Aynı fiziksel veri için ikinci bir otoriteydi ve
 * kanonik yoldan AYRIŞABİLİRDİ: Guardian bir değeri "bayat" sayıp kuralı
 * susturabilirken gösterge aynı değeri canlı gösterebiliyordu. Artık tek
 * kaynak `canonicalVehicleSignal` (CAN → OBD → yok) ve YALNIZ `LIVE` okuma
 * sayıya dönüşür.
 *
 * `rpm` ve `fuel` BİLİNÇLİ OLARAK ESKİ YOLDA: ikisi de kanonik paylaşılan
 * sinyal kümesinde DEĞİLDİR (devir SAB hot-path'inden `store.rpm` olarak akar,
 * yakıt worker füzyonundan gelir). Onları bu tura dahil etmek hot-path'e
 * dokunmak olurdu — açık borç olarak vizyon belgesine yazıldı.
 */
export interface EngineReadout {
  rpm: number | null;          // devir/dak
  engineTemp: number | null;   // soğutma suyu °C
  fuel: number | null;         // 0–100 %
}

export function useEngineReadout(): EngineReadout {
  // DAR ALAN ABONELİĞİ (SAHA 2026-07-19): eskiden useOBDState() TÜM objeye abone olup her
  // OBD alanı değişince (5Hz sıcak-sinyal bildirimiyle) tema layout'unu KOMPLE re-render
  // ediyordu. Artık yalnız gösterdiğimiz 3 alan (rpm/engineTemp/fuel) izlenir → RPM hızlı
  // AMA hafif; tüm temalar (Expedition/Horizon/…) bu tek hook'tan faydalanır.
  const obdRpm     = useOBDField('rpm');
  const obdFuel    = useOBDField('fuelLevel');
  const canRpm     = useUnifiedVehicleStore(s => s.canRpm);
  const storeFuel  = useUnifiedVehicleStore(s => s.fuel);
  // Motor ısısı: TEK OTORİTE (CAN → OBD → yok) + tazelik kapısı politikada.
  const engineTemp = useLiveVehicleSignal('coolantTemp');

  /* CANLILIK KAPISI (SAHA 2026-08-06, Adana-Şanlıurfa Otoyolu):
     Ekranda "675 km MENZİL" ve "%92 yakıt" DONUK duruyordu — araç 1 dakikada
     1,5 km ilerlerken menzil hiç değişmedi. OBD o sırada BAĞLI DEĞİLDİ
     (V-LINK `STATE_DISCONNECTED`, `car-can-snapshot` 85 saat bayat).

     KÖK: `useOBDField` ham `_current[field]` döndürür — TAZELİK KAPISI YOKTUR.
     Adaptör 10:27'de bir kez bağlanıp yakıtı okuduktan sonra koptu; değer
     sonsuza dek canlı sanıldı. Tema bileşenleri `isObdReadingLive` kapısını
     kendileri kuruyordu, ama `eng.fuel` YEDEĞİNE düştüklerinde kapı BAYPAS
     oluyordu (Horizon'da birebir bu olur) — Expedition'da ise kapı hiç yoktu.

     DÜZELTME: kapı TEK NOKTAYA, kaynağa konur → tüm temalar devralır.
     CarInfo/CAN yolu (canRpm/store.fuel) AYRI ve meşru bir canlı kaynaktır;
     ona DOKUNULMAZ — yalnız bayat OBD okuması elenir.

     P0-OBD-03: bu kapı artık YALNIZ `rpm` ve `fuel` içindir. Motor ısısının
     tazeliği kanonik politikada (sinyal başına eşik) hesaplanır — burada
     ikinci bir kapı BIRAKILMADI. */
  const obdSource     = useOBDField('source');
  const obdDataFresh  = useOBDField('dataFresh');
  const obdLastSeenMs = useOBDField('lastSeenMs');
  const obdLive = isObdReadingLive({
    source:     obdSource,
    dataFresh:  obdDataFresh,
    lastSeenMs: obdLastSeenMs,
  });

  const rpm =
    obdLive && obdRpm != null && obdRpm >= 0 ? obdRpm
    : canRpm != null && canRpm >= 0 ? canRpm
    : null;

  const fuel =
    obdLive && obdFuel != null && obdFuel >= 0 ? obdFuel
    : storeFuel != null && storeFuel >= 0 ? storeFuel
    : null;

  return { rpm, engineTemp, fuel };
}
