/**
 * useDisplaySpeed — SÜRÜCÜYE GÖSTERİLEN HIZIN TEK OTORİTESİ (saha 2026-08-05 · kütük #417).
 *
 * SAHADA ÖLÇÜLDÜ: tek ekran görüntüsünde eş zamanlı ÜÇ farklı hız vardı —
 * araç durumu kartı 99 km/h · harita rozeti 103 KM/H · `UnifiedVehicleStore` 104 km/h,
 * hiçbiri hangi kaynağa ait olduğunu söylemeden. Sürücü hangisinin doğru olduğunu
 * bilemez; hız aynı zamanda ETA ve hız-limiti uyarısının girdisidir.
 *
 * KÖK: iki ayrı füzyon motoru + bir de ham GPS aynı anda ekrana basıyordu:
 *   1. `UnifiedVehicleStore.speed`  — worker füzyonu (CAN/OBD/GPS), yaşlandırmalı, güvenlik kapılı
 *   2. `speedFusion.useFusedSpeed()` — ayrı ikinci motor, RAF lerp'li görsel değer
 *   3. `location.speed * 3.6`        — HAM GPS (fix bayatken saatlerce yanlış kalabilir)
 *
 * KARAR: GÖSTERİM otoritesi (1)'dir. Gerekçe: yaşlanan veriyi `null`'a düşürür
 * (`SPEED_EXPIRY_MS`), fiziksel sınır kapısı vardır ve tüketicilerin çoğunluğu
 * zaten onu okur. (2) ve (3) motor olarak KALDIRILMADI — yalnız ekrana basma
 * yetkileri alındı.
 *
 * `null` = hız BİLİNMİYOR → arayüz `—` gösterir. Sahte `0` YASAK: duran araç ile
 * verisi olmayan araç aynı şey değildir.
 */
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';

/** Ekranda hız yerine gösterilecek "bilinmiyor" işareti. */
export const SPEED_UNKNOWN_TEXT = '—';

/**
 * Gösterilecek hız (km/h) veya `null` (veri yok / bayat).
 * Tüm hız gösterimleri BU hook'tan beslenir — ikinci bir kaynak okumak yasaktır.
 */
export function useDisplaySpeed(): number | null {
  return useUnifiedVehicleStore((s) => s.speed);
}

/** Yuvarlanmış metin gösterimi — `null` → `—`. Sahte 0 üretmez. */
export function formatDisplaySpeed(kmh: number | null | undefined): string {
  return kmh == null || !Number.isFinite(kmh) ? SPEED_UNKNOWN_TEXT : String(Math.round(kmh));
}
