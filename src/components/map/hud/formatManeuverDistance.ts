/**
 * formatManeuverDistance — P0-NAV-04 · manevra mesafesinin sürüş biçimi (SAF).
 *
 * Bileşen dosyasından AYRI tutulur: bir modül hem bileşen hem yardımcı
 * export ederse Vite fast-refresh o dosyayı yeniden yükleyemez (lint uyarısı).
 * Tanım `NavigationHUD.fmtTurn`ten TAŞINDI; eşikler ve yuvarlama BİREBİR aynı
 * (20 m altı "ŞİMDİ", 100 m altı 10'a, 1 km altı 50'ye yuvarlanır).
 *
 * ── 2026-09-07 · SAYI ve BİRİM AYRILDI (Adım 5) ────────────────────────────
 * Canonical hedef (`field-runs/carto-2026-09-06/f-Maneuver.png`) mesafeyi
 * **büyük değer + küçük birim** olarak dizer ("120" güçlü, "m" ikincil).
 * Eski hâlde bu fonksiyon TEK STRING döndürüyordu ve kart onu tek punto ile
 * basıyordu — birim, değerle aynı görsel ağırlıktaydı.
 *
 * **İKİNCİ BİR MESAFE OTORİTESİ KURULMADI.** Parçalama `splitManeuverDistance`
 * içinde YAPILIR ve `formatManeuverDistance` artık onun `fullText` alanını
 * döndüren İNCE BİR SARMALAYICIDIR — eşikler, yuvarlama ve metinler tek
 * yerde kalır. Navigasyon GERÇEĞİ (`distanceToNextTurnMeters`) DEĞİŞMEZ;
 * burada yapılan yalnız SUNUM yuvarlamasıdır.
 *
 * Gereksiz ondalık BASILMAZ: `1.0 km` yerine `1 km`. Ondalık AYIRICI ürün
 * genelindeki sözleşmeye uyar (nokta — `toFixed(1)` deseni her yerde böyle);
 * Türkçe virgüle geçiş ürün ÇAPINDA bir karardır ve bu turun kapsamı dışıdır.
 */

/** Mesafenin sunum parçaları. `unit === null` → değer kendi başına anlamlı. */
export interface ManeuverDistanceParts {
  /** Büyük punto ile basılan ana değer ("120" · "1.2" · "ŞİMDİ" · "—"). */
  readonly value: string;
  /** Küçük punto ile basılan birim ("m" · "km") ya da birim yoksa `null`. */
  readonly unit: 'm' | 'km' | null;
  /** Ekran okuyucu ve tek satırlık kullanımlar için tam metin ("120 m"). */
  readonly fullText: string;
}

const parts = (value: string, unit: 'm' | 'km' | null): ManeuverDistanceParts => ({
  value, unit, fullText: unit === null ? value : `${value} ${unit}`,
});

/**
 * Manevra mesafesini sunum parçalarına ayırır. **SAF** — eşikler
 * `formatManeuverDistance`ın tarihsel sözleşmesiyle BİREBİR aynıdır.
 */
export function splitManeuverDistance(m: number): ManeuverDistanceParts {
  if (!Number.isFinite(m) || m < 0) return parts('—', null);
  if (m <  20)   return parts('ŞİMDİ', null);
  if (m < 100)   return parts(String(Math.round(m / 10) * 10), 'm');
  if (m < 1000)  return parts(String(Math.round(m / 50) * 50), 'm');
  /* `Math.round(m/100)/10` = `toFixed(1)` ile aynı yuvarlama, ama gereksiz
     `.0` üretmez: 1000 → "1", 1234 → "1.2". */
  return parts(String(Math.round(m / 100) / 10), 'km');
}

/** Tek satırlık tam metin. `splitManeuverDistance`ın ince sarmalayıcısıdır. */
export function formatManeuverDistance(m: number): string {
  return splitManeuverDistance(m).fullText;
}
