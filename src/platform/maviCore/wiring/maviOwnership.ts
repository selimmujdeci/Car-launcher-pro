/**
 * maviCore/wiring/maviOwnership.ts — MAVİ ÇEKİRDEĞİ Faz-3 · MAVI3-4c ORTAK SAHİPLİK SORGUSU.
 *
 * AMAÇ: Eski hat (useVoiceCommandHandler) ile Mavi köprüsünün AYNI mantıksal sahiplik anahtarını
 * üretmesini garanti eder. İki taraf da bu modülün SAF key-builder'ını kullanır → paralel/ikinci
 * bir kimlik mantığı YOKTUR; anahtar sapması yapısal olarak imkânsızdır.
 *
 * ESKİ HATTIN TEK SORUSU: `isCommandOwnedByMavi(cmd)`. Cevap `true` ise eski hat o komut için
 * HİÇBİR ŞEY yapmaz (Mavi devraldı); `false` ise bugünkü davranış BİREBİR sürer.
 *
 * FAIL-OPEN (anayasal): resolver kayıtlı değilse, eşleme yoksa, anahtar geçersizse, hakem pasifse
 * veya HERHANGİ bir katman throw ederse cevap DAİMA `false` → ESKİ HAT ÇALIŞIR. Bu modül hiçbir
 * koşulda bir komutu "kimse yapmasın" durumuna düşüremez.
 *
 * SIRA-BAĞIMSIZ: cevap yalnız (politika, aktiflik, kuşak tazeliği) fonksiyonudur — eski hattın
 * Mavi köprüsünden önce mi sonra mı çağrıldığı sonucu DEĞİŞTİRMEZ.
 *
 * ALLOWLIST SINIRI: `arbiter.isMaviOwned` yalnız takeoverPolicy'nin gerçekten devraldığı eylemler
 * için true döner → guard pratikte YALNIZ `media.next` üzerinde etkilidir; diğer tüm komutlar
 * (tema, navigasyon, medya oynat/duraklat, araç sağlığı…) eski hatta dokunulmadan akar.
 *
 * SAF: platform servisi import EDİLMEZ; import yan etkisi YOKTUR (resolver başlangıçta boş →
 * bu modülü import etmek davranışı DEĞİŞTİRMEZ).
 */

import {
  buildOwnershipKey, commandIdentityOf,
  type ParsedCommandLike, type PilotMapping, type VoiceIdentity,
} from './maviVoiceBridge';
import type { TakeoverArbiter, TakeoverOwnershipKey } from './takeoverArbiter';

export interface MaviOwnershipResolver {
  /** ParsedCommand → pilot eylem eşlemesi (köprüyle AYNI eşleyici verilir). */
  readonly mapCommand: (cmd: ParsedCommandLike) => PilotMapping | null;
  /** Anlık kuşak/oturum kimliği (köprünün izlediği kimliğin TA KENDİSİ). */
  readonly identity: () => VoiceIdentity;
  /** Karar mercii. */
  readonly arbiter: TakeoverArbiter;
}

let _resolver: MaviOwnershipResolver | null = null;

/** Wiring başlarken kaydedilir (idempotent — son kayıt geçerlidir). */
export function setMaviOwnershipResolver(resolver: MaviOwnershipResolver): void {
  try {
    if (!resolver || typeof resolver.mapCommand !== 'function' || typeof resolver.identity !== 'function') return;
    _resolver = resolver;
  } catch { /* fail-soft */ }
}

/** Wiring söküldüğünde temizlenir → eski hat davranışı OTOMATİK geri gelir. */
export function clearMaviOwnershipResolver(): void {
  _resolver = null;
}

/** Kayıtlı mı (tanı). */
export function hasMaviOwnershipResolver(): boolean {
  return _resolver !== null;
}

/**
 * Komutun sahiplik anahtarını üretir — İKİ HATTIN DA kullandığı TEK builder. Eşlemesi olmayan
 * komut için `null` (pilot değil → eski hat halleder).
 */
export function resolveOwnershipKey(cmd: ParsedCommandLike): TakeoverOwnershipKey | null {
  try {
    if (!_resolver || !cmd || typeof cmd.type !== 'string') return null;
    const mapped = _resolver.mapCommand(cmd);
    if (!mapped || typeof mapped.actionId !== 'string') return null;
    return buildOwnershipKey(_resolver.identity(), commandIdentityOf(cmd), mapped.actionId);
  } catch {
    return null; // fail-open
  }
}

/**
 * ESKİ HATTIN TEK KARAR SORUSU. `true` → eski hat bu komut için hiçbir şey yapmaz.
 * Her hata/eksiklik yolu `false` üretir (fail-open) — eski hat ASLA yanlışlıkla susturulmaz.
 */
export function isCommandOwnedByMavi(cmd: ParsedCommandLike): boolean {
  try {
    const resolver = _resolver;
    if (!resolver) return false;              // Mavi wiring yok/söküldü → bugünkü davranış
    const key = resolveOwnershipKey(cmd);
    if (!key) return false;                   // pilot değil / geçersiz anahtar
    return resolver.arbiter.isMaviOwned(key) === true;
  } catch {
    return false;                             // hakem/eşleyici hatası → ESKİ HAT ÇALIŞIR
  }
}

/** @internal — testler arası izolasyon. */
export function _resetMaviOwnershipForTest(): void {
  _resolver = null;
}
