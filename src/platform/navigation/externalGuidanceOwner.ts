/**
 * externalGuidanceOwner — sesli yol tarifini şu an HARİCİ bir uygulama mı veriyor?
 *
 * "Hey Mavi, Yandex'ten Mersin'e rota kur": rota Yandex'te açılır, bizim rotamız
 * da mini haritada görünsün diye aynı hedefe kurulur. İki uygulama birden
 * "300 metre sonra sağa dön" demesin diye, harici uygulama yönlendirirken
 * BİZİM yol tarifi anonslarımız susar. Tehlike/güvenlik uyarıları bu bayrağa
 * BAKMAZ (susturulmaz).
 *
 * YAPRAK MODÜL: hiçbir şey import etmez (döngü riski yok). Rota/konum gerçeği
 * TUTMAZ — yalnız "anonsu kim veriyor" bilgisidir.
 *
 * Yaşam döngüsü: harici uygulama açıldığında kurulur; HERHANGİ bir yeni
 * navigasyon başlangıcında veya navigasyon bitince temizlenir (bayat kalıp
 * bizim sesimizi sonsuza dek susturamaz).
 */

export type ExternalNavProvider = 'yandex' | 'waze' | 'google_maps';

let _owner: ExternalNavProvider | null = null;

export function setExternalGuidanceOwner(p: ExternalNavProvider): void {
  _owner = p;
}

export function clearExternalGuidanceOwner(): void {
  _owner = null;
}

export function getExternalGuidanceOwner(): ExternalNavProvider | null {
  return _owner;
}

/** true → bizim yol tarifi anonslarımız söylenmez. */
export function isExternalGuidanceActive(): boolean {
  return _owner !== null;
}
