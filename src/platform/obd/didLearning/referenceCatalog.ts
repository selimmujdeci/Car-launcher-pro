/**
 * referenceCatalog — DID anlamlandırmasında kullanılan REFERANS sinyaller (SAF).
 *
 * Referans = uygulamanın ZATEN okuduğu, anlamı standartla belli bir değer
 * (SAE J1979 PID'leri + ELM327 ATRV). Bir DID'e ancak bu listedeki bir
 * sinyalle KANITLI eşleşirse ad verilir; listede karşılığı olmayan bir
 * büyüklüğe (DPF doluluğu, turbo hedefi…) otomatik ad VERİLMEZ.
 *
 * Alanlar:
 *  · minSpan  — oturumda referans en az bu kadar değişmeli; aksi hâlde eşleşme
 *               bilgi taşımaz (sabit 94 °C'yi her sabit DID "açıklar").
 *  · absTol   — kabul edilen mutlak sapma (farklı sensör/filtre/zaman kayması payı;
 *               saha: ECU soğutma suyu ile PID 05 arasında ±2 °C görüldü).
 *  · maxAgeMs — DID okuması ile referans arasındaki azami zaman farkı
 *               (hızlı sinyallerde kısa, sıcaklıklarda uzun).
 */

export type ReferenceKey =
  | 'rpm' | 'speed' | 'coolant' | 'oil' | 'intake' | 'ambient' | 'catalyst'
  | 'fuelRail' | 'map' | 'ecuVoltage' | 'pedal' | 'throttle' | 'relThrottle'
  | 'fuelLevel' | 'distSinceClear' | 'distMil' | 'runtime';

export interface ReferenceDef {
  readonly key: ReferenceKey;
  /** Öğrenilen DID'in ekranda görünecek adı. */
  readonly label: string;
  readonly unit: string;
  readonly category: string;
  readonly minSpan: number;
  readonly absTol: number;
  readonly maxAgeMs: number;
  /** Fiziksel gösterim bandı (profil min/max). */
  readonly min: number;
  readonly max: number;
  /** Standart kaynağı (kanıt satırı). */
  readonly source: string;
}

const def = (d: ReferenceDef): ReferenceDef => Object.freeze(d);

export const REFERENCE_DEFS: Readonly<Record<ReferenceKey, ReferenceDef>> = Object.freeze({
  rpm:            def({ key: 'rpm', label: 'Motor devri', unit: 'rpm', category: 'motor', minSpan: 400, absTol: 40, maxAgeMs: 900, min: 0, max: 8000, source: 'PID 0C' }),
  speed:          def({ key: 'speed', label: 'Araç hızı', unit: 'km/h', category: 'motor', minSpan: 20, absTol: 3, maxAgeMs: 900, min: 0, max: 260, source: 'PID 0D' }),
  coolant:        def({ key: 'coolant', label: 'Soğutma suyu sıcaklığı', unit: '°C', category: 'sicaklik', minSpan: 8, absTol: 2.5, maxAgeMs: 20_000, min: -40, max: 150, source: 'PID 05' }),
  oil:            def({ key: 'oil', label: 'Motor yağı sıcaklığı', unit: '°C', category: 'sicaklik', minSpan: 8, absTol: 2.5, maxAgeMs: 30_000, min: -40, max: 160, source: 'PID 5C' }),
  intake:         def({ key: 'intake', label: 'Emme havası sıcaklığı', unit: '°C', category: 'sicaklik', minSpan: 5, absTol: 2, maxAgeMs: 20_000, min: -40, max: 120, source: 'PID 0F' }),
  ambient:        def({ key: 'ambient', label: 'Ortam sıcaklığı', unit: '°C', category: 'sicaklik', minSpan: 3, absTol: 1.5, maxAgeMs: 60_000, min: -40, max: 70, source: 'PID 46' }),
  catalyst:       def({ key: 'catalyst', label: 'Katalizör sıcaklığı', unit: '°C', category: 'sicaklik', minSpan: 40, absTol: 10, maxAgeMs: 20_000, min: -40, max: 1100, source: 'PID 3C' }),
  fuelRail:       def({ key: 'fuelRail', label: 'Yakıt ray basıncı', unit: 'kPa', category: 'basinc', minSpan: 8000, absTol: 1500, maxAgeMs: 1500, min: 0, max: 250_000, source: 'PID 23' }),
  map:            def({ key: 'map', label: 'Emme manifoldu basıncı', unit: 'kPa', category: 'basinc', minSpan: 20, absTol: 5, maxAgeMs: 1200, min: 0, max: 400, source: 'PID 0B' }),
  ecuVoltage:     def({ key: 'ecuVoltage', label: 'Kontrol ünitesi voltajı', unit: 'V', category: 'elektrik', minSpan: 0.8, absTol: 0.15, maxAgeMs: 8000, min: 0, max: 20, source: 'PID 42' }),
  pedal:          def({ key: 'pedal', label: 'Gaz pedalı konumu', unit: '%', category: 'motor', minSpan: 15, absTol: 3, maxAgeMs: 1200, min: 0, max: 100, source: 'PID 49' }),
  throttle:       def({ key: 'throttle', label: 'Gaz kelebeği konumu', unit: '%', category: 'motor', minSpan: 10, absTol: 3, maxAgeMs: 1500, min: 0, max: 100, source: 'PID 11' }),
  relThrottle:    def({ key: 'relThrottle', label: 'Bağıl gaz kelebeği konumu', unit: '%', category: 'motor', minSpan: 10, absTol: 3, maxAgeMs: 1500, min: 0, max: 100, source: 'PID 45' }),
  fuelLevel:      def({ key: 'fuelLevel', label: 'Yakıt seviyesi', unit: '%', category: 'yakit', minSpan: 3, absTol: 2, maxAgeMs: 120_000, min: 0, max: 100, source: 'PID 2F' }),
  distSinceClear: def({ key: 'distSinceClear', label: 'Arıza silindiğinden beri yol', unit: 'km', category: 'mesafe', minSpan: 2, absTol: 1, maxAgeMs: 120_000, min: 0, max: 65_535, source: 'PID 31' }),
  distMil:        def({ key: 'distMil', label: 'MIL yanarken kat edilen yol', unit: 'km', category: 'mesafe', minSpan: 2, absTol: 1, maxAgeMs: 120_000, min: 0, max: 65_535, source: 'PID 21' }),
  runtime:        def({ key: 'runtime', label: 'Motor çalışma süresi', unit: 's', category: 'motor', minSpan: 120, absTol: 15, maxAgeMs: 30_000, min: 0, max: 65_535, source: 'PID 1F' }),
});

export const REFERENCE_KEYS: readonly ReferenceKey[] = Object.freeze(Object.keys(REFERENCE_DEFS) as ReferenceKey[]);

/**
 * Üretici ölçek kütüphanesi — `değer = ham × k + o`. Yalnız bu "yuvarlak"
 * katsayılara OTURAN bir uyum kanıt sayılır; serbest regresyon katsayısı
 * (ör. k=0.3137) tesadüfi korelasyonu anlam sanma riskini taşır.
 */
export const SCALE_FACTORS: readonly number[] = Object.freeze([
  1, 2, 4, 8, 10, 100, 1000,
  0.5, 0.25, 0.125, 0.0625, 1 / 32, 1 / 64, 1 / 128, 1 / 256,
  0.1, 0.01, 0.001, 0.0001, 0.2, 0.05, 0.02, 0.005,
  100 / 255, 100 / 256, 100 / 1024, 100 / 65535,
]);

export const SCALE_OFFSETS: readonly number[] = Object.freeze([0, -40, -50, -60, -100, -273.15, -273, -1000]);
