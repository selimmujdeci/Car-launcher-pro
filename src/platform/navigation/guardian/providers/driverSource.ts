/**
 * driverSource — GUARDIAN-AI-G12 (Provider Source Contracts).
 *
 * Sürücü durumu kaynağı sözleşmesi — yorgunluk/dikkat göstergelerini (sürüş
 * süresi, mola yaşı, yerel saat, dikkat/şerit/mikro-uyku sinyalleri) SAĞLAR.
 * GERÇEK IO YOK — yalnız interface. Kamera/göz-takibi/yüz-tanıma/sensör
 * implementasyonu KAPSAM DIŞI. Kaynak Guardian KARARI ÜRETMEZ, kesin teşhis
 * KOYMAZ.
 *
 * Çıktı doğrudan G11 `RawDriverFatigueData` tipidir.
 */
import type { RawDriverFatigueData } from '../adapters/driverFatigueAdapter';

/** Sürücü durumu kaynak sözleşmesi. `read()` raw sürücü okuması döndürür; veri
 *  yok → `undefined` veya throw (registry fail-soft). */
export interface DriverSource {
  read(): RawDriverFatigueData | undefined;
}
