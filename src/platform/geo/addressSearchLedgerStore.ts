/**
 * addressSearchLedgerStore.ts — adres arama defterinin ÇALIŞMA ZAMANI SAHİBİ.
 *
 * Saf defter `addressSearchLedger.ts`tedir; burada YALNIZ bounded halka + zaman
 * damgası vardır. Bu ayrım kasıtlı: sınıflandırma cihazsız test edilir, sahiplik
 * ise tek yerde toplanır (obdService / linkLossLedger deseniyle birebir aynı).
 *
 * SÖZLEŞME (çağıranlar buna güvenir):
 *  · THROW ETMEZ — kayıt yolu arama akışını ASLA bozamaz. Her giriş try/catch.
 *  · TIMER YOK · abonelik YOK · I/O YOK → Zero-Leak. LAB açılışta tek okuma yapar.
 *  · KALICI DEĞİL — defter yalnız RAM'de yaşar. Adres biçimi bile diske
 *    yazılmaz; oturum bitince kanıt gider (gizlilik lehine bilinçli seçim).
 *  · SORGU METNİ BURAYA GİRMEZ. API yalnız `AddressQueryShape` kabul eder;
 *    ham metin parametresi YOKTUR ki yanlışlıkla PII sızmasın.
 */

import {
  appendAddressSearch,
  classifyAddressSearch,
  noteUserChoice,
  summarizeAddressSearches,
  supersedePending,
  type AddressSearchRecord,
  type AddressSearchSample,
  type AddressSearchSummary,
} from './addressSearchLedger';

/** Kaydı üreten çağıranın adresi — kanıt zinciri için. */
export type AddressSearchSourceRef =
  | 'geocodingService.geocodeAddress'
  | 'mapService.searchPlaces'
  | 'addressNavigationEngine.resolveAndNavigate';

/** `atMs` dışarıdan gelmez — sahiplik burada, saf katman zamandan bağımsız kalır. */
export type AddressSearchInput = Omit<AddressSearchSample, 'atMs'>;

let _ledger: readonly AddressSearchRecord[] = [];

/**
 * Bir arama denemesini deftere yazar. Hata yutulur — kayıt yolu arama akışını
 * bozamaz (fail-soft; bir teşhis aracı ürünü düşüremez).
 */
export function recordAddressSearch(
  input: AddressSearchInput,
  sourceRef: AddressSearchSourceRef,
): void {
  try {
    const rec = classifyAddressSearch({ ...input, atMs: Date.now() }, sourceRef);
    /* Aynı yüzeyde seçim bekleyen eski deneme YARGILANMAMIŞTIR (debounce'lu
       yazımda tek niyet için 6-8 deneme olur) → başarısızlık sayılmasın. */
    const base = rec.surface !== 'UNKNOWN' ? supersedePending(_ledger, rec.surface) : _ledger;
    _ledger = appendAddressSearch(base, rec);
  } catch { /* teşhis kaydı ürünü ASLA düşürmez */ }
}

/**
 * Kullanıcı seçimi kanıtını seçim BEKLEYEN en yeni kayda işler.
 * Bekleyen kayıt yoksa defter değişmez (sahipsiz kanıt yazılmaz).
 */
export function noteAddressSearchChoice(picked: boolean): void {
  try {
    _ledger = noteUserChoice(_ledger, { atMs: Date.now(), picked });
  } catch { /* fail-soft */ }
}

/** Salt-okunur anlık görüntü (en yeni sonda). */
export function getAddressSearchLedger(): readonly AddressSearchRecord[] {
  return _ledger;
}

export function getAddressSearchSummary(): AddressSearchSummary {
  return summarizeAddressSearches(_ledger);
}

/** Test izolasyonu — defter testler arasında sızmasın. */
export function _resetAddressSearchLedgerForTest(): void {
  _ledger = [];
}
