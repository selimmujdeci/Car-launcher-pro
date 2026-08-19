/**
 * mapViewBus.ts — Tam ekran harita görünümünü açıp kapatmak için global veri yolu.
 *
 * `drawerBus` deseninin BİREBİR aynısı; ikinci bir mekanizma kurulmaz.
 * MainLayout mount olduğunda `registerMapViewHandler` ile kendini kaydeder.
 *
 * NEDEN VAR (#652): Tema Stüdyo önizlemesi seçilen ekrana gidebiliyor, ama
 * harita bir ÇEKMECE DEĞİLDİR — tam ekran bir görünümdür ve `drawerBus`
 * üzerinden açılamaz. Bu yol olmadan "Navigasyon / Harita" yüzeyi seçilince
 * önizleme ana ekranda kalır ve kullanıcı manevra kartını, hız kümesini
 * KÖRLEMESİNE düzenler — kapatmaya çalıştığımız kusurun aynısı.
 *
 * Kayıt yoksa çağrı SESSİZCE düşer (fail-soft): bu yol yalnız kolaylıktır,
 * hiçbir güvenlik kararı buna bağlı DEĞİLDİR.
 */

let _handler: ((open: boolean) => void) | null = null;

export function registerMapViewHandler(fn: (open: boolean) => void): void {
  _handler = fn;
}

export function unregisterMapViewHandler(): void {
  _handler = null;
}

/** Tam ekran haritayı aç/kapat. Kayıtlı sahip yoksa hiçbir şey olmaz. */
export function setFullMapView(open: boolean): void {
  _handler?.(open);
}

/** Sahip kayıtlı mı — gözlem/tanı için (karar bu değere BAĞLANMAZ). */
export function isMapViewBusBound(): boolean {
  return _handler !== null;
}
