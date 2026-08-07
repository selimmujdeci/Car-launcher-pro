/**
 * homeWorkNavigation.ts — Ev/İş hızlı hedef çözümleme + navigasyon dispatch.
 *
 * NAVIGATION-P0-1: NAVIGATION-AUDIT-1'de doğrulanan kök nedeni kapatır:
 *   1. `intentEngine.ts` OPEN_NAVIGATION case'i `payload.destination`'ı hiç
 *      okumadan yalnız ekran açıyordu (navigate_home/work → OPEN_NAVIGATION).
 *   2. `addressBookService.ts`'teki Ev/İş verisinin hiçbir tüketicisi yoktu;
 *      varsayılan (0,0) "kayıtlı" gibi kullanılabiliyordu.
 *
 * Bu modül TEK merkezi giriş noktasıdır: hem `intentEngine.ts` (routeIntent,
 * yerel commandParser hattı) hem `commandExecutor.ts` (dispatchIntent, AI/Mavi
 * beyin hattı) BURAYA delege eder — iki ayrı navigasyon-başlatma kopyası YOK.
 * Yeni routing motoru / yeni depolama YOK: mevcut `navigationService.startNavigation()`
 * ve mevcut `addressBookService` hızlı-hedef API'si (bkz. NAVIGATION-P0-1) kullanılır.
 */
import {
  getAddress,
  isValidDestination,
  type Address,
  type QuickAddressCategory,
} from './addressBookService';
import { startNavigation } from './navigationService';
import { speakNavigation } from './ttsService';
import i18n from '../i18n/config';

export type { QuickAddressCategory } from './addressBookService';

/** OPEN_NAVIGATION payload.destination değeri Ev/İş kısayolu mu? (saf tip guard'ı) */
export function isHomeWorkDestination(value: string | undefined | null): value is QuickAddressCategory {
  return value === 'home' || value === 'work';
}

export type HomeWorkFailReason =
  | 'missing'  // hiç kaydedilmemiş (varsayılan placeholder, kullanıcı hiç düzenlememiş)
  | 'invalid'; // kayıt var ama koordinat geçersiz (bozuk veri / sınır dışı / 0,0)

export type HomeWorkResolveResult =
  | { ok: true;  category: QuickAddressCategory; address: Address }
  | { ok: false; category: QuickAddressCategory; reason: HomeWorkFailReason };

/**
 * Saf çözümleme — YAN ETKİSİZ (TTS/navigasyon başlatma YOK). Test edilebilir.
 *
 * "missing" / "invalid" ayrımı `updatedAt` alanına dayanır: kullanıcı hiç
 * kaydetmediyse (initializeAddressBook varsayılanı) `updatedAt` yoktur → missing.
 * Bir kayıt VARDI ama koordinatı geçersizse (bozuk veri) → invalid.
 */
export function resolveHomeWorkDestination(category: QuickAddressCategory): HomeWorkResolveResult {
  const raw = getAddress(category);
  if (!raw) return { ok: false, category, reason: 'missing' };
  if (!isValidDestination(raw)) {
    return { ok: false, category, reason: raw.updatedAt ? 'invalid' : 'missing' };
  }
  return { ok: true, category, address: raw };
}

export type HomeWorkDispatchReason = HomeWorkFailReason | 'debounced';

export interface HomeWorkDispatchResult {
  ok: boolean;
  reason?: HomeWorkDispatchReason;
}

// Çift-tetik koruması: aynı kategori için kısa pencerede ikinci dispatch sessizce
// yutulur (ör. hem yerel komut hem AI beyni aynı "eve git" için tetiklenirse, veya
// çift dokunma/çift ses tetikleyicisi). TEK merkezi handler'ın idempotency sözleşmesi.
const DISPATCH_DEDUPE_MS = 1200;
let _lastDispatchAt: Partial<Record<QuickAddressCategory, number>> = {};

/** Test-only: dedupe penceresini sıfırlar (testler arası sızıntıyı önler). */
export function _resetHomeWorkDispatchGuardForTests(): void {
  _lastDispatchAt = {};
}

/**
 * TEK merkezi navigasyon-başlatma yolu — Ev/İş için.
 *
 * Başarılı: mevcut `navigationService.startNavigation()` gerçek koordinatlarla
 * çağrılır (yeni routing YOK) + kısa sesli onay.
 * Başarısız (fail-closed): `startNavigation` HİÇ çağrılmaz; anlaşılır, bounded
 * sesli/metinsel hata verilir. 0,0 veya geçersiz koordinat ASLA rotaya girmez.
 */
export function dispatchHomeWorkNavigation(
  category: QuickAddressCategory,
  now: number = Date.now(),
): HomeWorkDispatchResult {
  const last = _lastDispatchAt[category];
  if (last !== undefined && now - last < DISPATCH_DEDUPE_MS) {
    return { ok: false, reason: 'debounced' };
  }
  _lastDispatchAt = { ..._lastDispatchAt, [category]: now };

  const result = resolveHomeWorkDestination(category);
  if (!result.ok) {
    const key = result.reason === 'invalid'
      ? 'navigation.destination_invalid'
      : (category === 'home' ? 'navigation.home_missing' : 'navigation.work_missing');
    speakNavigation(i18n.t(key));
    return { ok: false, reason: result.reason };
  }

  startNavigation(result.address, false, 'USER_QUICK');   // kütük #429: ev/iş komutu
  speakNavigation(i18n.t(category === 'home' ? 'navigation.home_starting' : 'navigation.work_starting'));
  return { ok: true };
}
