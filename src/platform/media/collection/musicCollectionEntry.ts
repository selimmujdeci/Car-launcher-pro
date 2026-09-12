/**
 * musicCollectionEntry.ts — MUSIC F13 · Favori kimliği + kayıt şeması (SAF).
 *
 * ── ÖLÇÜLEN GERÇEK (F13 denetimi) ──────────────────────────────────────────
 * Repo'da bir favori/koleksiyon otoritesi YOKTU. Var olan tek iz, F11'de
 * KALDIRILAN `onClick`siz kalp düğmesiydi (süs, hiçbir state'e bağlı değildi)
 * ve `commandParser`nin ölü `ADD_MUSIC_FAVORITE` dalıydı ("bu özellik şu an
 * desteklenmiyor"). Kimlik modeli UYDURULMADI: burada kullanılan
 * `CanonicalMediaIdentity` F3'ün ZATEN var olan, `ListeningSession.currentItem`
 * ve `SearchResult.identity`de KULLANILAN tek kimlik tipidir.
 *
 * KİMLİK KURALI: başlık/sanatçı ASLA anahtarın parçası değildir.
 *   · LOCAL   → F2 MusicIndex kimliği (`libraryId`).
 *   · PROVIDER → `providerNamespace + providerId` (F7.6 ile AYNI ad alanı
 *     kuralı: farklı sağlayıcıların kimlikleri KARŞILAŞTIRILMAZ).
 * İkisi de yoksa favori KURULMAZ — kanıtsız kimlik uydurulmaz.
 *
 * DEPOLAMA ASİMETRİSİ (bilinçli, §4'ün "tekrar çözülebiliyorsa kopyalama
 * yapma" koşuluna uyar):
 *   · LOCAL kayıtlar YALNIZ `libraryId` taşır — başlık/sanatçı/kapak HER ZAMAN
 *     MusicIndex'ten CANLI çözülür (F2 zaten bunu yapabilir).
 *   · PROVIDER kayıtlar bounded görüntü metadata'sı (title/artist/artwork/
 *     contentUri) taşır — CarOS'ta providerId'den geriye "bu neydi" sorusunu
 *     cevaplayacak kanonik bir dizin YOKTUR (F7.6'nın kendi kararı budur);
 *     bu, F7.6'nın kuyruk girdilerinde ZATEN yaptığı şeyin AYNISIDIR.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import type { CanonicalMediaIdentity } from '../session/mediaIdentityMatching';
import type { SourceClass } from '../authority/sourceCapabilities';
import type { ProviderId } from '../providers';

export const COLLECTION_SCHEMA_VERSION = 1;
/** Sınırsız büyüme YOK — kullanıcı bunu AŞARSA ekleme dürüstçe REDDEDİLİR. */
export const MAX_FAVORITES = 2000;

export type FavoriteKind = 'LOCAL' | 'PROVIDER';

/**
 * Kalıcı kayıt. Alan seti KASITLI OLARAK dardır (§4 gizlilik):
 * sorgu · sesli komut metni · konum · rota · sürüş geçmişi ASLA YOKTUR.
 */
export interface FavoriteEntry {
  readonly schemaVersion: typeof COLLECTION_SCHEMA_VERSION;
  /** Kararlı anahtar — bkz. `favoriteKeyFor`. */
  readonly key: string;
  readonly kind: FavoriteKind;
  readonly sourceClass: SourceClass;
  /** Yalnız LOCAL: F2 MusicIndex kimliği. */
  readonly libraryId: string | null;
  /** Yalnız PROVIDER: kararlı sağlayıcı kimliği + ad alanı. */
  readonly providerId: string | null;
  readonly providerNamespace: string | null;
  /** Yalnız PROVIDER — çalınabilir URI (F7.6 `contentUri` ile AYNI alan). */
  readonly contentUri: string | null;
  /** Yalnız PROVIDER — kanonik `ProviderId` (yürütme zamanı dispatch için). */
  readonly provider: ProviderId | null;
  /** Yalnız PROVIDER — bounded görüntü metadata'sı. */
  readonly displayTitle: string | null;
  readonly displayArtist: string | null;
  readonly displayArtwork: string | null;
  readonly addedAtMs: number;
}

export type FavoriteMutationStatus =
  | 'ADDED' | 'REMOVED'
  /** Zaten favoriydi — yeniden eklemek DUPLICATE üretmez, sessizce başarı sayılır. */
  | 'ALREADY_PRESENT'
  /** Zaten favori DEĞİLDİ — kaldırma isteği anlamsız ama hata da değildir. */
  | 'ALREADY_ABSENT'
  | 'REJECTED_NO_IDENTITY'
  | 'REJECTED_COLLECTION_FULL';

export interface FavoriteMutationResult {
  readonly status: FavoriteMutationStatus;
  readonly key: string | null;
  readonly entry: FavoriteEntry | null;
}

/* ── Kimlik → anahtar (kanonik, provider-safe, deterministik) ────────────── */

/**
 * LOCAL kimlik: F2 kütüphane kaydı. `providerNamespace === 'MEDIASTORE'`
 * olması F7.6'nın kendi kuralıdır (`libraryQueueContext.MEDIASTORE_NAMESPACE`);
 * burada TEKRARLANMAZ, yalnız `libraryId`nin dolu olup olmadığına bakılır —
 * MusicIndex zaten yalnız LOCAL kayıtlara `libraryId` verir.
 */
export function favoriteKeyFor(identity: CanonicalMediaIdentity): string | null {
  const lib = identity.libraryId?.trim();
  if (lib) return `local:${lib}`;

  const ns = identity.providerNamespace?.trim();
  const pid = identity.providerId?.trim();
  /* Kanıt yetersiz: yalnız biri varsa ya da ikisi de boşsa favori KURULMAZ.
     Başlık/sanatçı ANANHTARA HİÇ GİRMEZ. */
  if (!ns || !pid) return null;
  return `provider:${ns.toLowerCase()}:${pid}`;
}

/* ── SourceClass ↔ ProviderId (F7.6'nın TERS yönü, burada İLK KEZ gerekiyor) ─
 * `providerQueueContext.providerSourceClassFor` yalnız providerId→SourceClass
 * yönünü taşır. Favori kaydını YÜRÜTME zamanında hangi sağlayıcı adaptörüne
 * vereceğimizi bilmek için TERS yön gerekir — burada yeni bir sağlayıcı
 * KAVRAMI icat EDİLMEZ, yalnız var olan eşleme TERS OKUNUR. */
const SOURCE_TO_PROVIDER: Readonly<Partial<Record<SourceClass, ProviderId>>> = Object.freeze({
  YOUTUBE: 'youtube',
  SPOTIFY_CONNECT: 'spotify',
  INTERNET_RADIO: 'radio',
  STREAM: 'stream',
  LOCAL: 'local',
});

export function providerIdFromSourceClass(source: SourceClass): ProviderId | null {
  return SOURCE_TO_PROVIDER[source] ?? null;
}

/**
 * Kimlikten kalıcı kayıt üretir.
 *
 * `null` döner: kimlik kanıtsızsa (`favoriteKeyFor` `null`) VEYA PROVIDER
 * kaydı için çalınabilir bir `contentUri`/desteklenen `ProviderId` yoksa —
 * oynatılamayacak bir favori KAYDEDİLMEZ.
 */
export function makeFavoriteEntry(
  identity: CanonicalMediaIdentity, sourceClass: SourceClass, nowMs: number,
): FavoriteEntry | null {
  const key = favoriteKeyFor(identity);
  if (key === null) return null;

  if (key.startsWith('local:')) {
    return Object.freeze({
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      key, kind: 'LOCAL' as const, sourceClass,
      libraryId: identity.libraryId,
      providerId: null, providerNamespace: null, contentUri: null, provider: null,
      displayTitle: null, displayArtist: null, displayArtwork: null,
      addedAtMs: nowMs,
    });
  }

  const provider = providerIdFromSourceClass(sourceClass);
  const contentUri = identity.contentUri?.trim() || null;
  /* Yürütülemeyecek bir sağlayıcı kaydı KAYDEDİLMEZ — "favorilendi ama hiçbir
     zaman çalınamayacak" sahte bir vaattir. */
  if (provider === null || provider === 'local' || contentUri === null) return null;

  return Object.freeze({
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    key, kind: 'PROVIDER' as const, sourceClass,
    libraryId: null,
    providerId: identity.providerId, providerNamespace: identity.providerNamespace,
    contentUri, provider,
    displayTitle: identity.title?.trim() || null,
    displayArtist: identity.artist?.trim() || null,
    displayArtwork: null,
    addedAtMs: nowMs,
  });
}

/**
 * Kalıcı JSON'dan tek bir kaydı ayrıştırır. Şema uyuşmazlığı veya eksik
 * ZORUNLU alan → `null` (fail-closed; bozuk kayıt sessizce UYDURULMAZ).
 */
export function parseFavoriteEntry(raw: unknown): FavoriteEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== COLLECTION_SCHEMA_VERSION) return null;
  if (typeof r.key !== 'string' || r.key.length === 0) return null;
  if (r.kind !== 'LOCAL' && r.kind !== 'PROVIDER') return null;
  if (typeof r.sourceClass !== 'string') return null;
  if (typeof r.addedAtMs !== 'number' || !Number.isFinite(r.addedAtMs)) return null;

  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

  if (r.kind === 'LOCAL') {
    const libraryId = str(r.libraryId);
    if (!libraryId) return null;
    return Object.freeze({
      schemaVersion: COLLECTION_SCHEMA_VERSION, key: r.key, kind: 'LOCAL' as const,
      sourceClass: r.sourceClass as SourceClass,
      libraryId, providerId: null, providerNamespace: null, contentUri: null, provider: null,
      displayTitle: null, displayArtist: null, displayArtwork: null,
      addedAtMs: r.addedAtMs,
    });
  }

  const providerId = str(r.providerId);
  const providerNamespace = str(r.providerNamespace);
  const contentUri = str(r.contentUri);
  const provider = str(r.provider) as ProviderId | null;
  if (!providerId || !providerNamespace || !contentUri || !provider) return null;

  return Object.freeze({
    schemaVersion: COLLECTION_SCHEMA_VERSION, key: r.key, kind: 'PROVIDER' as const,
    sourceClass: r.sourceClass as SourceClass,
    libraryId: null, providerId, providerNamespace, contentUri, provider,
    displayTitle: str(r.displayTitle), displayArtist: str(r.displayArtist),
    displayArtwork: str(r.displayArtwork),
    addedAtMs: r.addedAtMs,
  });
}
