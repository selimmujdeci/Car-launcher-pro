/**
 * weatherSource — GUARDIAN-AI-G12 (Provider Source Contracts).
 *
 * Hava/yüzey kaynağı sözleşmesi — yol yüzey koşulu/görüş verisini SAĞLAR.
 * GERÇEK IO YOK — yalnız interface. Gerçek OpenMeteo/HTTP implementasyonu
 * KAPSAM DIŞI. Kaynak Guardian KARARI ÜRETMEZ, severity HESAPLAMAZ.
 *
 * Çıktı doğrudan G11 `RawWeatherData` tipidir.
 */
import type { RawWeatherData } from '../adapters/weatherAdapter';

/** Hava kaynak sözleşmesi. `read()` raw hava/yüzey okuması döndürür; veri yok/
 *  servis hatası → `undefined` veya throw (registry fail-soft). */
export interface WeatherSource {
  read(): RawWeatherData | undefined;
}
