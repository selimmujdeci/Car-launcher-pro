/**
 * Türkiye il merkezleri (yaklaşık, il merkezi ilçenin koordinatı).
 *
 * YALNIZ canlı yakıt fiyatının hangi il için isteneceğini seçmek içindir: GPS
 * konumuna EN YAKIN il merkezi. İl sınırı değildir — sınıra yakın noktada komşu
 * il seçilebilir; yakıt fiyatı komşu illerde kuruş düzeyinde farklıdır ve seçilen
 * il cevapta (`province`) açıkça görünür.
 */
export const TR_PROVINCE_CENTERS: ReadonlyArray<readonly [name: string, lat: number, lng: number]> = [
  ['Adana', 37.00, 35.32], ['Adıyaman', 37.76, 38.28], ['Afyonkarahisar', 38.76, 30.54],
  ['Ağrı', 39.72, 43.05], ['Amasya', 40.65, 35.83], ['Ankara', 39.93, 32.86],
  ['Antalya', 36.90, 30.70], ['Artvin', 41.18, 41.82], ['Aydın', 37.85, 27.84],
  ['Balıkesir', 39.65, 27.88], ['Bilecik', 40.14, 29.98], ['Bingöl', 38.88, 40.50],
  ['Bitlis', 38.40, 42.11], ['Bolu', 40.74, 31.61], ['Burdur', 37.72, 30.29],
  ['Bursa', 40.19, 29.06], ['Çanakkale', 40.15, 26.41], ['Çankırı', 40.60, 33.62],
  ['Çorum', 40.55, 34.95], ['Denizli', 37.78, 29.09], ['Diyarbakır', 37.91, 40.24],
  ['Edirne', 41.68, 26.56], ['Elazığ', 38.68, 39.22], ['Erzincan', 39.75, 39.49],
  ['Erzurum', 39.90, 41.27], ['Eskişehir', 39.78, 30.52], ['Gaziantep', 37.07, 37.38],
  ['Giresun', 40.91, 38.39], ['Gümüşhane', 40.46, 39.48], ['Hakkari', 37.58, 43.74],
  ['Hatay', 36.20, 36.16], ['Isparta', 37.76, 30.55], ['Mersin', 36.80, 34.63],
  ['İstanbul', 41.01, 28.98], ['İzmir', 38.42, 27.14], ['Kars', 40.60, 43.10],
  ['Kastamonu', 41.38, 33.78], ['Kayseri', 38.73, 35.49], ['Kırklareli', 41.73, 27.22],
  ['Kırşehir', 39.15, 34.16], ['Kocaeli', 40.77, 29.92], ['Konya', 37.87, 32.48],
  ['Kütahya', 39.42, 29.98], ['Malatya', 38.35, 38.31], ['Manisa', 38.61, 27.43],
  ['Kahramanmaraş', 37.58, 36.94], ['Mardin', 37.31, 40.74], ['Muğla', 37.22, 28.36],
  ['Muş', 38.75, 41.51], ['Nevşehir', 38.62, 34.71], ['Niğde', 37.97, 34.68],
  ['Ordu', 40.98, 37.88], ['Rize', 41.02, 40.52], ['Sakarya', 40.78, 30.40],
  ['Samsun', 41.29, 36.33], ['Siirt', 37.93, 41.94], ['Sinop', 42.03, 35.15],
  ['Sivas', 39.75, 37.02], ['Tekirdağ', 40.98, 27.51], ['Tokat', 40.31, 36.55],
  ['Trabzon', 41.00, 39.72], ['Tunceli', 39.11, 39.55], ['Şanlıurfa', 37.16, 38.79],
  ['Uşak', 38.68, 29.41], ['Van', 38.50, 43.38], ['Yozgat', 39.82, 34.81],
  ['Zonguldak', 41.45, 31.79], ['Aksaray', 38.37, 34.03], ['Bayburt', 40.26, 40.23],
  ['Karaman', 37.18, 33.22], ['Kırıkkale', 39.85, 33.51], ['Batman', 37.89, 41.13],
  ['Şırnak', 37.52, 42.46], ['Bartın', 41.63, 32.34], ['Ardahan', 41.11, 42.70],
  ['Iğdır', 39.92, 44.04], ['Yalova', 40.65, 29.27], ['Karabük', 41.20, 32.62],
  ['Kilis', 36.72, 37.12], ['Osmaniye', 37.07, 36.25], ['Düzce', 40.84, 31.16],
];

/** Türkiye'nin kaba sınır kutusu — dışındaki konum için il seçilmez. */
const TR_BBOX = { minLat: 35.8, maxLat: 42.2, minLng: 25.6, maxLng: 44.9 } as const;

/** Konuma en yakın il merkezi; Türkiye dışı/geçersiz konumda `null`. */
export function nearestProvince(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < TR_BBOX.minLat || lat > TR_BBOX.maxLat || lng < TR_BBOX.minLng || lng > TR_BBOX.maxLng) {
    return null;
  }
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best: string | null = null;
  let bestD = Infinity;
  for (const [name, pLat, pLng] of TR_PROVINCE_CENTERS) {
    const dLat = pLat - lat;
    const dLng = (pLng - lng) * cosLat;
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}
