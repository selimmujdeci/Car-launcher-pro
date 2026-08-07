/**
 * pendingPairingService.ts — ÇEVRİMDIŞI EŞLEŞTİRMENİN ÜRÜN YOLU.
 *
 * `offlinePairing.ts` sözleşmeyi ve şifreli depoyu tanımlar; BU dosya onu
 * gerçek eşleştirme ekranına bağlar. Buradaki tek iş dürüstlüktür:
 *
 *   · Çevrimdışıyken kullanıcıya "araç eşleşti" ASLA denmez — yalnız
 *     `PENDING_SERVER_VERIFICATION` claim'i üretilir.
 *   · Claim gerçek sahiplik ÜRETMEZ; sunucu doğrulamasını bekler.
 *   · TTL'i geçmiş kod GÖNDERİLMEZ, EXPIRED olur (sessizce silinmez).
 *   · Aynı claim iki kez gönderilmez: hem kalıcı `idempotencyKey` dedupe'ı
 *     hem de süreç-içi "uçuşta" kilidi vardır.
 *   · Sunucu reddi conflict koduna çevrilir; TANINMAYAN red fail-closed
 *     REJECTED olur — "belki olmuştur" diye tekrar denenmez.
 *
 * Saat ve taşıyıcı ENJEKTE edilir → testler saat oynatabilir, ağ kurmaz.
 */

import {
  PendingPairingStore,
  WebCryptoCipher,
  isSendable,
  type PendingPairing,
  type SecureCipher,
  DEFAULT_CODE_TTL_MS,
} from './offlinePairing';
import type { ConflictCode } from './types';
import { toConflictCode } from './conflictEngine';
import type { FleetErrorCode } from '../fleet/errors';

/* ── Taşıyıcı sözleşmesi ───────────────────────────────────────────────── */

/**
 * Eşleştirme gönderiminin sonucu.
 *
 * `offline` ile `code` AYRI tutulur: ağ hatası (yeniden denenebilir) ile
 * sunucu reddi (kalıcı) karıştırılırsa kullanıcı ya sonsuza dek bekler ya da
 * geçerli bir claim sessizce çöpe gider.
 */
export interface PairingSubmitOutcome {
  ok:        boolean;
  /** Ağa ulaşılamadı — claim BEKLEMEDE kalır, tekrar denenir. */
  offline:   boolean;
  /** Sunucunun typed reddi (biliniyorsa). */
  code:      FleetErrorCode | null;
  vehicleId: string | null;
}

export type PairingSubmitFn = (code: string) => Promise<PairingSubmitOutcome>;

/* ── Namespace ─────────────────────────────────────────────────────────── */

/**
 * PWA eşleştirme ekranı oturum AÇMADAN da çalışır (kod yetkinin kendisidir).
 * Oturum yoksa cihaz kapsamı kullanılır; oturum varsa kullanıcıya izole edilir
 * → hesap değişiminde başka kullanıcının claim'i OKUNMAZ.
 */
export const DEVICE_NAMESPACE = 'device' as const;

export function pairingNamespace(userId: string | null | undefined): string {
  return userId && userId.length > 0 ? userId : DEVICE_NAMESPACE;
}

/* ── Depo örneği ───────────────────────────────────────────────────────── */

let _namespace: string | null = null;
let _store: PendingPairingStore | null = null;

/** Test için şifreleyici enjekte edilebilir; üretimde WebCrypto kullanılır. */
export function getPendingPairingStore(
  namespace: string,
  cipher?: SecureCipher,
): PendingPairingStore {
  if (_store && _namespace === namespace && !cipher) return _store;
  _namespace = namespace;
  _store = new PendingPairingStore(namespace, cipher ?? new WebCryptoCipher(namespace));
  return _store;
}

/** Çıkış / hesap değişimi — süreç-içi örnek de bırakılır. */
export function resetPendingPairingStore(): void {
  _store = null;
  _namespace = null;
  IN_FLIGHT.clear();
}

/** Cleanup verification; hassas payload döndürmeden süreç-içi authority durumu. */
export function isPendingPairingRuntimeEmpty(): boolean {
  return _store === null && _namespace === null && IN_FLIGHT.size === 0;
}

/* ── Claim üretimi ─────────────────────────────────────────────────────── */

export interface CreatePendingPairingInput {
  namespace:  string;
  userId:     string | null;
  code:       string;
  now:        number;
  codeTtlMs?: number;
  cipher?:    SecureCipher;
  /** Deterministik kimlik üretimi (test edilebilirlik). */
  idFactory?: () => string;
}

function defaultId(now: number): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(now);
  return `pp_${rand}`;
}

/**
 * Koddan ÖZET türetir — idempotency anahtarı olarak kodun KENDİSİ kullanılamaz.
 *
 * NEDEN: `idempotencyKey` şifrelenmeden diske yazılır (dedupe için okunması
 * gerekir). Anahtar kodu içerseydi, `code` alanını AES ile şifrelemek anlamsız
 * olurdu — kod komşu alanda düz metin dururdu.
 *
 * Aynı kod → aynı anahtar (dedupe korunur); anahtardan koda dönülemez.
 */
async function idempotencyKeyFor(code: string): Promise<string> {
  const seed = `caros-pairing-v1:${code}`;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `pair:${hex.slice(0, 32)}`;
  } catch {
    // WebCrypto yoksa bile kod ASLA düz yazılmaz — kararlı FNV-1a özeti.
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `pair:fnv${hash.toString(16)}`;
  }
}

/**
 * Çevrimdışı eşleştirme talebini kaydeder.
 *
 * DÖNEN DEĞER SAHİPLİK DEĞİLDİR — durumu `PENDING_SERVER_VERIFICATION`'dır ve
 * çağıran ekran bunu kullanıcıya AYNEN böyle göstermek zorundadır.
 */
export async function createPendingPairing(
  input: CreatePendingPairingInput,
): Promise<PendingPairing> {
  const id = (input.idFactory ?? (() => defaultId(input.now)))();
  const pairing: PendingPairing = {
    id,
    userId:         input.userId ?? DEVICE_NAMESPACE,
    code:           input.code,
    requestedAt:    input.now,
    codeExpiresAt:  input.now + (input.codeTtlMs ?? DEFAULT_CODE_TTL_MS),
    // Aynı kod için aynı anahtar → sunucuya iki kez uygulanamaz.
    // Kodun KENDİSİ değil, geri döndürülemez özeti kullanılır.
    idempotencyKey: await idempotencyKeyFor(input.code),
    status:         'PENDING_SERVER_VERIFICATION',
    conflictCode:   null,
    attemptCount:   0,
  };
  await getPendingPairingStore(input.namespace, input.cipher).add(pairing);
  return pairing;
}

/* ── Gönderim ──────────────────────────────────────────────────────────── */

/** Süreç-içi "uçuşta" kilidi — aynı claim eşzamanlı iki kez gönderilmez. */
const IN_FLIGHT = new Set<string>();

/**
 * Şifre ÇÖZMEYEN sahte şifreleyici — yalnız `statusCounts()` gibi kod
 * gerektirmeyen salt-okuma yolları için. Çözme daima `null` döner (fail-closed).
 */
const NULL_CIPHER: SecureCipher = {
  async encrypt(): Promise<string> {
    throw new Error('read-only cipher');
  },
  async decrypt(): Promise<string | null> {
    return null;
  },
};

export interface SubmitSummary {
  attempted: number;
  verified:  number;
  rejected:  number;
  expired:   number;
  /** Ağ yok — claim beklemede bırakıldı. */
  deferred:  number;
  skipped:   number;
}

export interface SubmitPendingInput {
  namespace: string;
  submit:    PairingSubmitFn;
  now:       number;
  cipher?:   SecureCipher;
}

/**
 * Bekleyen claim'leri sunucuya gönderir (çevrimiçi olunca çağrılır).
 *
 * Sıra dışı hiçbir şey yapmaz: TTL'i geçeni gönderMEZ, ağ yoksa bekletir,
 * sunucu reddini conflict'e çevirir. Kısmi başarı "başarı" sayılmaz.
 */
export async function submitPendingPairings(
  input: SubmitPendingInput,
): Promise<SubmitSummary> {
  const summary: SubmitSummary = {
    attempted: 0, verified: 0, rejected: 0, expired: 0, deferred: 0, skipped: 0,
  };

  const store = getPendingPairingStore(input.namespace, input.cipher);
  const list  = await store.list();

  for (const pairing of list) {
    if (pairing.status !== 'PENDING_SERVER_VERIFICATION') {
      summary.skipped += 1;
      continue;
    }

    // TTL — süresi geçmiş kod ASLA gönderilmez.
    if (!isSendable(pairing, input.now)) {
      await store.update(pairing.id, { status: 'EXPIRED' });
      summary.expired += 1;
      continue;
    }

    // Aynı claim uçuştaysa ikinci kez gönderilmez.
    if (IN_FLIGHT.has(pairing.idempotencyKey)) {
      summary.skipped += 1;
      continue;
    }

    IN_FLIGHT.add(pairing.idempotencyKey);
    summary.attempted += 1;
    try {
      const outcome = await input.submit(pairing.code);

      if (outcome.ok) {
        await store.update(pairing.id, { status: 'VERIFIED', conflictCode: null });
        summary.verified += 1;
        continue;
      }

      if (outcome.offline) {
        // Ağ yok → BEKLEMEDE kalır, deneme sayısı artar. Red DEĞİLDİR.
        await store.update(pairing.id, { attemptCount: pairing.attemptCount + 1 });
        summary.deferred += 1;
        continue;
      }

      // Sunucu reddi → conflict'e çevrilir. Tanınmayan red fail-closed REJECTED.
      const conflict: ConflictCode | null = outcome.code
        ? toConflictCode(outcome.code, 'VEHICLE_PAIR')
        : null;
      await store.update(pairing.id, {
        status:       'REJECTED',
        conflictCode: conflict,
        attemptCount: pairing.attemptCount + 1,
      });
      summary.rejected += 1;
    } catch {
      // Taşıyıcı istisnası ağ hatası sayılır — claim KAYBEDİLMEZ.
      await store.update(pairing.id, { attemptCount: pairing.attemptCount + 1 });
      summary.deferred += 1;
    } finally {
      IN_FLIGHT.delete(pairing.idempotencyKey);
    }
  }

  return summary;
}

/* ── Okuma / bakım ─────────────────────────────────────────────────────── */

/** Kullanıcıya gösterilecek claim listesi (kod çözülür — LAB bunu KULLANMAZ). */
export async function listPendingPairings(
  namespace: string,
  cipher?: SecureCipher,
): Promise<PendingPairing[]> {
  return getPendingPairingStore(namespace, cipher).list();
}

/** TTL'i geçmiş claim'leri kalıcı olarak EXPIRED yapar (dürüst durum). */
export async function expirePendingPairings(
  namespace: string,
  now: number,
  cipher?: SecureCipher,
): Promise<number> {
  const store = getPendingPairingStore(namespace, cipher);
  let expired = 0;
  for (const pairing of await store.list()) {
    if (pairing.status === 'PENDING_SERVER_VERIFICATION' && !isSendable(pairing, now)) {
      await store.update(pairing.id, { status: 'EXPIRED' });
      expired += 1;
    }
  }
  return expired;
}

/**
 * CAROS LAB için ADET — kod ÇÖZÜLMEZ, hassas materyale dokunulmaz.
 *
 * Tekil depoyu KULLANMAZ: LAB farklı bir namespace okurken eşleştirme
 * ekranının örneğini değiştirmemeli (gözlem, gözlenen sistemi bozmaz).
 * `statusCounts()` şifre çözmediği için sahte şifreleyici yeterlidir.
 */
export function readPairingCounts(namespace: string): {
  pending: number; verified: number; rejected: number; expired: number; total: number;
} | null {
  try {
    const readOnlyStore = new PendingPairingStore(namespace, NULL_CIPHER);
    const counts = readOnlyStore.statusCounts();
    return {
      pending:  counts.PENDING_SERVER_VERIFICATION,
      verified: counts.VERIFIED,
      rejected: counts.REJECTED,
      expired:  counts.EXPIRED,
      total:
        counts.PENDING_SERVER_VERIFICATION + counts.VERIFIED +
        counts.REJECTED + counts.EXPIRED,
    };
  } catch {
    return null; // okunamadı → LAB UNAVAILABLE gösterir, sahte 0 YAZMAZ
  }
}

export async function removePendingPairing(
  namespace: string,
  id: string,
  cipher?: SecureCipher,
): Promise<void> {
  await getPendingPairingStore(namespace, cipher).remove(id);
}
