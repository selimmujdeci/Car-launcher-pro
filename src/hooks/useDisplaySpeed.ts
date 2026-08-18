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

/**
 * Gösterimde kabul edilen FİZİKSEL üst sınır (km/h).
 *
 * `UnifiedVehicleStore`daki güvenlik kapısıyla AYNI değerdir ve bu tekrar
 * bilinçlidir: burası SON savunma hattıdır. Store'a başka bir yoldan yazılan
 * ya da ileride eklenecek bir kaynaktan gelen absürt değer, kapıyı atlarsa
 * bile ekrana ÇIKAMAZ.
 */
export const SPEED_PHYSICAL_MAX_KMH = 300;

/* ── Gözlem: sınır kaç kez ihlal edildi (#634) ─────────────────────────────
 * Sahada ölçülemeyen aralıklı bir kusur var: araç dururken hız göstergesinde
 * beş haneli değerler görüldü (kullanıcı ekran görüntüsü, 2026-08-18 18:33).
 * Kusur cihazda tekrarlatılamadı ve WebView console logları logcat'e
 * düşmediği için iz de bırakmıyordu. Sayaç, bir dahaki ihlalde EN AZINDAN
 * "oldu ve şu değerle oldu" bilgisini saklar — sahte bir kök ilan etmeden.
 * Bounded: yalnız sayaç + son değer; geçmiş TUTULMAZ. */
let _rejectedCount = 0;
let _lastRejected: number | null = null;

/** Gözlem okuması — CAROS LAB / tanı için. Hiçbir şey yazmaz. */
export function getSpeedDisplayRejections(): { count: number; last: number | null } {
  return { count: _rejectedCount, last: _lastRejected };
}

/** Test yalıtımı — üretim yolunda ÇAĞRILMAZ. */
export function _resetSpeedDisplayRejectionsForTest(): void {
  _rejectedCount = 0;
  _lastRejected = null;
}

/**
 * Yuvarlanmış metin gösterimi — `null` → `—`. Sahte 0 üretmez.
 *
 * Fiziksel olarak imkânsız bir değer de `—` gösterir: sürücüye "1.203 km/h"
 * yazmak, hiçbir şey yazmamaktan DAHA KÖTÜDÜR — hız aynı zamanda ETA ve
 * hız-limiti uyarısının girdisidir, güveni kırar.
 */
export function formatDisplaySpeed(kmh: number | null | undefined): string {
  if (kmh == null || !Number.isFinite(kmh)) return SPEED_UNKNOWN_TEXT;
  if (kmh < 0 || kmh > SPEED_PHYSICAL_MAX_KMH) {
    _rejectedCount++;
    _lastRejected = kmh;
    return SPEED_UNKNOWN_TEXT;
  }
  return String(Math.round(kmh));
}
