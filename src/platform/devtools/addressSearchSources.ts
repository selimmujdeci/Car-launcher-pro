/**
 * addressSearchSources.ts — CAROS LAB · Adres Arama Kanıtı TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter'lar, her biri kendi try/catch'i
 * içinde. HİÇBİR arama başlatmaz, hiçbir komut göndermez, timer kurmaz.
 *
 * GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6 — PAZARLIKSIZ): adres METNİ,
 * sokak adı, koordinat ve kullanıcının seçtiği yer BU KATMANDAN GEÇMEZ. Defter
 * zaten metni SAKLAMAZ (`AddressQueryShape`); burada yalnız o biçim bayrakları,
 * adetler, sınıflar ve süreler okunur. Adres = ev adresi = PII.
 */

import {
  getAddressSearchLedger, getAddressSearchSummary,
} from '../geo/addressSearchLedgerStore';
import type {
  AddressSearchRecord, AddressSearchSummary,
} from '../geo/addressSearchLedger';
import { getGeocodeProviderStatus } from '../geocodingProviders';

/** Ham okuma — hiçbir alan uydurulmaz; okunamayan alan `null` kalır. */
export interface AddressSearchRawSnapshot {
  readonly readAt: number;
  /** Defter okunabildi mi (false → aşağıdaki alanlar ANLAMSIZ). */
  readonly ledgerReadable: boolean;
  readonly records: readonly AddressSearchRecord[];
  readonly summary: AddressSearchSummary | null;
  /**
   * BYOK premium sağlayıcı adı — anahtar VAR/YOK bilgisi. Anahtarın kendisi
   * ASLA okunmaz (yalnız `hasKey`).
   */
  readonly providerName: string | null;
  readonly providerHasKey: boolean | null;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/**
 * Tek senkron okuma. `providerName`/`providerHasKey` asenkron kaynaktan gelir;
 * bu yüzden burada OKUNMAZ — çağıran ekran ayrıca `readProviderStatus()` çağırır
 * (senkron sözleşme bozulmasın diye ayrıldı).
 */
export function readAddressSearchSnapshot(): AddressSearchRawSnapshot {
  const records = _safe(() => getAddressSearchLedger(), [] as readonly AddressSearchRecord[]);
  const summary = _safe(() => getAddressSearchSummary(), null);
  return {
    readAt:         Date.now(),
    ledgerReadable: summary !== null,
    records,
    summary,
    providerName:   null,
    providerHasKey: null,
  };
}

/**
 * BYOK sağlayıcı durumu — YALNIZ ad + anahtar VAR/YOK. Hata/erişilemezlik
 * hâlinde `null` döner (sahte "anahtar yok" ÜRETİLMEZ: "yok" ile "bilinmiyor"
 * farklı şeylerdir).
 */
export async function readProviderStatus(): Promise<{ name: string; hasKey: boolean } | null> {
  try {
    const st = await getGeocodeProviderStatus();
    if (!st || typeof st.provider !== 'string' || typeof st.hasKey !== 'boolean') return null;
    return { name: st.provider, hasKey: st.hasKey };
  } catch {
    return null;
  }
}
