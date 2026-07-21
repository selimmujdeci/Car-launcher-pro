/**
 * obdSource — GUARDIAN-AI-G12 (Provider Source Contracts).
 *
 * OBD/araç kaynağı sözleşmesi — araç sağlık sinyallerini (soğutma/yağ/akü/
 * uyarı lambaları) SAĞLAR. GERÇEK IO YOK — yalnız interface. Gerçek ELM327/
 * Bluetooth/CAN implementasyonu KAPSAM DIŞI. Kaynak Guardian KARARI ÜRETMEZ,
 * severity HESAPLAMAZ.
 *
 * Çıktı doğrudan G11 `RawVehicleHealthData` tipidir (ayrı bir raw tip icat
 * edilmez — provider yalnız o sözleşmeyi doldurur).
 */
import type { RawVehicleHealthData } from '../adapters/vehicleHealthAdapter';

/** OBD kaynak sözleşmesi. `read()` raw araç sağlığı okuması döndürür; veri yok/
 *  bağlantı hatası → `undefined` veya throw (registry fail-soft). */
export interface ObdSource {
  read(): RawVehicleHealthData | undefined;
}
