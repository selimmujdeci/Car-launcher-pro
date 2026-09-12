/**
 * mapSource — GUARDIAN-AI-G12 (Provider Source Contracts).
 *
 * Harita/rota kaynağı sözleşmesi — rota geometrisinden türeyen segment/nokta
 * verisini SAĞLAR (viraj, hız-limiti, iniş profili, yol tehlikesi, hız denetim
 * noktası). GERÇEK IO YOK — yalnız interface + raw tip. Gerçek HERE/TomTom/OSM
 * implementasyonu KAPSAM DIŞI. Kaynak Guardian KARARI ÜRETMEZ.
 *
 * Not: curve/speedLimit/roadProfile dilimleri `currentSpeedKph` TAŞIMAYABİLİR —
 * o değer GPS kaynağından gelir ve provider registry tarafından enjekte edilir.
 */
import type { RawCurveData } from '../adapters/curveAdapter';
import type { RawSpeedLimitData } from '../adapters/speedLimitAdapter';
import type { RawRoadProfileData } from '../adapters/roadProfileAdapter';
import type { RawRoadHazardData } from '../adapters/roadHazardAdapter';
import type { RawSpeedCameraData } from '../adapters/speedCameraAdapter';

/** Harita/rota kaynağından gelen raw okuma — her segment/nokta dilimi opsiyonel. */
export interface RawMapData {
  curve?:        RawCurveData;
  speedLimit?:   RawSpeedLimitData;
  roadProfile?:  RawRoadProfileData;
  roadHazard?:   RawRoadHazardData;
  speedCamera?:  RawSpeedCameraData;
}

/** Harita/rota kaynak sözleşmesi. `read()` raw okuma döndürür; veri yok/hata →
 *  `undefined` veya throw (registry fail-soft). */
export interface MapSource {
  read(): RawMapData | undefined;
}
