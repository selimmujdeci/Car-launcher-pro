/**
 * capabilityStore — P0-VDK-F4C · ÖĞRENME BELLEĞİ (YEREL, SÜRÜMLÜ, FAIL-CLOSED).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **YALNIZ YEREL.** Supabase/FleetKB/ağ TEK BAYT yazmaz — Cloud FleetMemory
 *     bu turun DIŞINDADIR.
 * (2) **SÜRÜMLÜ ŞEMA.** Bilinmeyen/eksik sürüm **fail-closed** reddedilir:
 *     depo yok sayılır ve ürün TEMİZ KEŞFE döner. "Öğrendik" DENMEZ.
 * (3) **BOZUK DEPO ÖĞRENME SAYILMAZ.** JSON çözülemezse, kök tip tutmazsa ya da
 *     kayıtlar şekilsizse depo boş kabul edilir ve bu durum **kanıt olarak
 *     görünür** (`health`), sessizce yutulmaz.
 * (4) **ATOMİK YAZIM.** `safeStorage` sarmalayıcısı kullanılır (kota + bozulma
 *     koruması TEK yerdedir; ikinci bir kalıcılık yolu açılmaz).
 * (5) **GİZLİLİK.** Ham VIN/MAC bu depoya GİRMEZ — kimlikler `capabilityFingerprint`
 *     karmalarıdır ve geri döndürülemez.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── P0-VDK-F5G · FİZİKSEL ARAÇ BÖLÜMLENMESİ (bu turda eklendi) ────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5-F raporunda açık borç olarak yazılmıştı: öğrenme MANTIKSAL olarak
 * `vehicleId` ile ayrılıyordu (`edgeKey`) ama FİZİKSEL olarak **tek dosyada**
 * duruyordu. Sonuç: bir aracın dosyası bozulursa TÜM araçların öğrenmesi
 * birlikte giderdi ve `getVehicleCapabilities` süzgeci bunu engelleyemezdi —
 * süzgeç bir dosya değildir.
 *
 * Artık her aracın kendi dosyası vardır: `caros-capability-graph-v1:<karma>`.
 * Kapsam kararı boşluk siciliyle **AYNI** politikadan gelir
 * (`gapLedgerScope.resolveGapLedgerScope`) ve **AYNI** F4-C parmak izini
 * kullanır — "boşluk sicili Araç A'da, öğrenme Araç B'de" durumu yapısal
 * olarak imkânsızdır.
 *
 * ⚠️ ÖĞRENME SEMANTİĞİ DEĞİŞMEDİ: birleştirme, kota, çelişki, bayatlık ve
 * yeniden kullanım kuralları AYNEN `capabilityGraph`tadır. Bu tur yalnız
 * DEPOLAMA ve İZOLASYON turudur.
 *
 * SAF DEĞİL (depo okur/yazar) ama: timer YOK · abonelik YOK · ağ YOK ·
 * `Date.now` ENJEKTE edilir (kayıt damgaları çağırandan gelir).
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../../utils/safeStorage';
import { logError } from '../../crashLogger';
/* P0-VDK-F5G — kapsam politikası BOŞLUK SİCİLİYLE ORTAKTIR (ikinci politika YOK). */
import {
  capabilityKeyFor, UNIDENTIFIED_SCOPE, type GapLedgerScope,
} from '../gapLedgerScope';
import {
  edgeKey, summarizeGraph, mergeCapabilityObservation,
  type CapabilityEdge, type CapabilityGraphSummary, type CapabilityObservationInput,
} from './capabilityGraph';

/* ══════════════════════════════════════════════════════════════════════════
   1) ŞEMA
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * P0-VDK-F5G — DEPO ANAHTARI ARTIK SABİT DEĞİL, ARACA BAĞLIDIR.
 *
 * Eski global anahtar (`caros-capability-graph-v1`) artık YAZILMAZ ve hiçbir
 * araca YÜKLENMEZ: hangi araçta öğrenildiğini kanıtlayamaz (kenarların
 * `vehicleId` alanı kaydın kendi iddiasıdır, sahiplik kanıtı değil).
 */
export function getCapabilityStorageKey(): string | null {
  return _scope.persistenceAllowed ? capabilityKeyFor(_scope.vehicleRef) : null;
}

/**
 * Şema sürümü. **Artırıldığında eski depo OKUNMAZ** (geriye dönük tahmin YOK):
 * yanlış yorumlanmış bir öğrenme, öğrenmemekten daha tehlikelidir.
 */
export const CAPABILITY_SCHEMA_VERSION = 2;

/** Depo tavanı — sınırsız öğrenme cihazda bellek/disk sorunudur. */
export const MAX_STORED_EDGES = 400;

interface StoredEnvelope {
  readonly schemaVersion: number;
  /** Bölümün SAHİBİ araç — dosyanın kime ait olduğunun kanıtı (F5-G). */
  readonly vehicleRef: string | null;
  /** BÜTÜNLÜK: `edges.length` ile eşleşmezse depo YARIM sayılır. */
  readonly edgeCount: number;
  readonly savedAt: number | null;
  readonly edges: readonly CapabilityEdge[];
}

/* ══════════════════════════════════════════════════════════════════════════
   2) DEPO SAĞLIĞI — kanıt, sessiz yutma YOK
   ══════════════════════════════════════════════════════════════════════════ */

export type StoreHealth =
  /** Depo yok — ilk çalıştırma. Bir arıza DEĞİLDİR. */
  | 'EMPTY'
  /** Okundu ve geçerli. */
  | 'OK'
  /** JSON/şekil bozuk → yok sayıldı, temiz keşfe dönüldü. */
  | 'CORRUPT'
  /** Şema sürümü tanınmadı → fail-closed reddedildi. */
  | 'SCHEMA_MISMATCH'
  /** Depoya erişilemedi (kota/izin). */
  | 'UNAVAILABLE';

export const STORE_HEALTH_LABEL: Readonly<Record<StoreHealth, string>> = {
  EMPTY:           'depo boş (ilk çalıştırma)',
  OK:              'okundu ve geçerli',
  CORRUPT:         'BOZUK — yok sayıldı, temiz keşfe dönüldü',
  SCHEMA_MISMATCH: 'ŞEMA UYUŞMADI — fail-closed reddedildi',
  UNAVAILABLE:     'depoya erişilemedi',
} as const;

/** Öğrenme sağlıklı mı — bozuk/uyumsuz depo "öğrendik" SAYILMAZ. */
export function isStoreTrustworthy(h: StoreHealth): boolean {
  return h === 'OK' || h === 'EMPTY';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BELLEK İÇİ ÇİZGE
   ══════════════════════════════════════════════════════════════════════════ */

const _edges = new Map<string, CapabilityEdge>();
/* ── P0-VDK-F5G · AKTİF ARAÇ KAPSAMI (boşluk sicili ile ORTAK karar) ────── */
let _scope: GapLedgerScope = UNIDENTIFIED_SCOPE;
let _switchCount = 0;
/** Kalıcılık kapısı yüzünden yapılmayan yazım adedi — sessiz engelleme YASAK. */
let _blockedWrites = 0;
/** Aktif araca AİT OLMADIĞI için diske yazılmayan kenar adedi. */
let _foreignSkipped = 0;
/**
 * Bellekte YAZILMAMIŞ değişiklik var mı.
 *
 * ⚠️ ÖLÇÜLEN KUSUR (bu turda testle yakalandı): araç ayrılırken koşulsuz
 * yazım yapılıyordu. İki sonucu vardı — (a) süreç yeniden başlayıp bellek
 * boşken aynı araca bağlanmak, DOLU bir bölümün üstüne BOŞ dosya yazabilirdi;
 * (b) hiçbir şey değişmediği hâlde her bağlanmada eMMC'ye yazılırdı. Artık
 * ayrılma yazımı yalnız GERÇEKTEN kirli ve YÜKLENMİŞ bir bellek için yapılır.
 */
let _dirty = false;
let _health: StoreHealth = 'EMPTY';
let _loaded = false;
let _dropped = 0;
/** Yeniden kullanım sayesinde GÖNDERİLMEYEN istek sayısı (ölçüm). */
let _savedRequests = 0;
let _reusedProbes = 0;

export function getCapabilityHealth(): StoreHealth { return _health; }
export function getCapabilityEdges(): readonly CapabilityEdge[] { return [..._edges.values()]; }
export function getCapabilityDropped(): number { return _dropped; }
export function getSavedRequestCount(): number { return _savedRequests; }
export function getReusedProbeCount(): number { return _reusedProbes; }
export function isCapabilityLoaded(): boolean { return _loaded; }

export function getCapabilitySummary(nowMs: number | null): CapabilityGraphSummary {
  return summarizeGraph(getCapabilityEdges(), nowMs);
}

export function noteProbeReused(savedRequests = 1): void {
  _reusedProbes++;
  _savedRequests += savedRequests;
}

export function getCapabilityScope(): GapLedgerScope { return _scope; }
export function getCapabilitySwitchCount(): number { return _switchCount; }
export function getCapabilityBlockedWrites(): number { return _blockedWrites; }
export function getCapabilityForeignSkipped(): number { return _foreignSkipped; }

export function _resetCapabilityStoreForTest(): void {
  _edges.clear();
  _health = 'EMPTY';
  _loaded = false;
  _dropped = 0;
  _savedRequests = 0;
  _reusedProbes = 0;
  _switchCount = 0;
  _blockedWrites = 0;
  _foreignSkipped = 0;
  _dirty = false;
  try {
    const k = getCapabilityStorageKey();
    if (k !== null) safeRemoveRaw(k);
  } catch { /* test temizliği */ }
  _scope = UNIDENTIFIED_SCOPE;
}

/**
 * @internal — SÜREÇ durumunu sıfırlar ama KALICI bölüme DOKUNMAZ.
 * "Uygulama yeniden başladı" senaryosunun tek dürüst taklidi budur.
 */
export function _simulateCapabilityRestartForTest(): void {
  _edges.clear();
  _health = 'EMPTY';
  _loaded = false;
  _dropped = 0;
  _blockedWrites = 0;
  _foreignSkipped = 0;
  _dirty = false;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) OKUMA — fail-closed
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir kaydın ŞEKLİ geçerli mi — tanınmayan kayıt sessizce KABUL EDİLMEZ. */
function _validEdge(v: unknown): v is CapabilityEdge {
  if (v === null || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.vehicleId === 'string' && e.vehicleId.length > 0
    && typeof e.ecuId === 'string' && e.ecuId.length > 0
    && typeof e.service === 'string' && e.service.length > 0
    && typeof e.presence === 'string'
    && typeof e.provenance === 'string'
    && typeof e.productTrusted === 'boolean'
    && typeof e.observationCount === 'number'
    && Array.isArray(e.evidenceRefs);
}

/**
 * Depoyu yükler. **ASLA throw etmez** ve bozuk depoda ÖĞRENME İDDİA ETMEZ.
 *
 * Bir kayıt bile şekilsizse TÜM depo reddedilir: kısmi güvenilen bir öğrenme
 * belleği, hangi satırın uydurma olduğunu bilmediğimiz bir bellektir.
 *
 * ⚠️ P0-VDK-F5G — YALNIZ AKTİF BÖLÜM okunur. Kimlik kanıtlı değilse hiçbir
 * dosya açılmaz: "muhtemelen aynı araçtır" diye başka bir aracın öğrenmesini
 * yüklemek, yanlış araca yetenek atamaktır.
 */
export function loadCapabilityStore(): StoreHealth {
  _edges.clear();
  _loaded = true;
  const key = getCapabilityStorageKey();
  if (key === null) { _health = 'EMPTY'; return _health; }

  let raw: string | null;
  try {
    raw = safeGetRaw(key);
  } catch (e) {
    logError('OBD:CapabilityStoreRead', e);
    _health = 'UNAVAILABLE';
    return _health;
  }
  if (raw === null || raw.length === 0) { _health = 'EMPTY'; return _health; }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    _health = 'CORRUPT';
    return _health;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    _health = 'CORRUPT';
    return _health;
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.schemaVersion !== 'number') { _health = 'CORRUPT'; return _health; }
  if (env.schemaVersion !== CAPABILITY_SCHEMA_VERSION) {
    /* Geriye dönük tahmin YOK. Eski sürüm okunmaz, taşınmaz, yorumlanmaz. */
    _health = 'SCHEMA_MISMATCH';
    return _health;
  }
  if (!Array.isArray(env.edges)) { _health = 'CORRUPT'; return _health; }
  /* BÜTÜNLÜK: yarım yazılmış (kesilmiş) bir bölüm güvenilir SAYILMAZ. */
  if (typeof env.edgeCount !== 'number' || env.edgeCount !== env.edges.length) {
    _health = 'CORRUPT'; return _health;
  }
  if (!env.edges.every(_validEdge)) { _health = 'CORRUPT'; return _health; }
  /* ⚠️ SAHİPLİK: bölüm dosyası BAŞKA bir aracın kenarını taşıyorsa TÜM dosya
     güvenilmezdir. Bu, "fiziksel izolasyon" iddiasının kanıtıdır: süzgeç
     değil, dosyanın kendisi tek araca aittir. */
  const owner = _scope.vehicleRef;
  if (owner !== null && typeof env.vehicleRef === 'string'
      && env.vehicleRef !== owner) {
    _health = 'CORRUPT'; return _health;
  }
  if (owner !== null
      && !(env.edges as CapabilityEdge[]).every((e) => e.vehicleId === owner)) {
    _health = 'CORRUPT'; return _health;
  }

  for (const e of env.edges as CapabilityEdge[]) {
    if (_edges.size >= MAX_STORED_EDGES) { _dropped++; continue; }
    _edges.set(edgeKey(e), e);
  }
  _health = 'OK';
  return _health;
}

/* ══════════════════════════════════════════════════════════════════════════
   4b) P0-VDK-F5G · ARAÇ BÖLÜMÜNÜ BAĞLA
   ══════════════════════════════════════════════════════════════════════════ */

export interface CapabilityActivation {
  readonly scope: GapLedgerScope;
  readonly switched: boolean;
  readonly detachedRef: string | null;
  readonly health: StoreHealth;
  readonly edges: number;
}

/**
 * Aktif aracın öğrenme bölümünü bağlar.
 *
 * Kapsam BURADA HESAPLANMAZ: boşluk siciliyle AYNI karardan (tek çağrı,
 * `vehicleDiagnosticContext`) gelir. İki deponun farklı araca bakması bu
 * yüzden yapısal olarak imkânsızdır.
 *
 * Araç değişirse önce mevcut bölüm YAZILIR, sonra bellek TAMAMEN boşaltılır
 * ve yalnız yeni aracın dosyası yüklenir.
 */
export function activateCapabilityVehicle(
  scope: GapLedgerScope, nowMs: number | null,
): CapabilityActivation {
  const prevRef = _scope.vehicleRef;
  const sameVehicle = _loaded && prevRef === scope.vehicleRef
    && _scope.persistenceAllowed === scope.persistenceAllowed;
  if (sameVehicle) {
    return {
      scope: _scope, switched: false, detachedRef: null,
      health: _health, edges: _edges.size,
    };
  }
  const hadVehicle = prevRef !== null || _edges.size > 0;

  /* ⚠️ YALNIZ yüklenmiş VE kirli bellek yazılır: boş belleği dolu bir bölümün
     üstüne yazmak, sessiz veri kaybı olurdu. */
  try { if (_loaded && _dirty && _scope.persistenceAllowed) {
    persistCapabilityStore(true, nowMs);
  } } catch (e) { logError('OBD:CapabilityDetachPersist', e); }

  _edges.clear();
  _dropped = 0;
  _blockedWrites = 0;
  _foreignSkipped = 0;
  _dirty = false;
  _scope = scope;
  _loaded = false;
  const switched = hadVehicle && prevRef !== scope.vehicleRef;
  if (switched) _switchCount++;

  const health = loadCapabilityStore();
  return { scope: _scope, switched, detachedRef: switched ? prevRef : null,
    health, edges: _edges.size };
}

/** Depoyu yüklemediyse yükler (idempotent). */
function _ensureLoaded(): void {
  if (!_loaded) loadCapabilityStore();
}

/* ══════════════════════════════════════════════════════════════════════════
   5) YAZMA — atomik, sınırlı
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Belleği diske yazar.
 *
 * `safeSetRaw(..., immediate)` mevcut atomik/kota-korumalı yoldur; ikinci bir
 * kalıcılık yolu AÇILMAZ. Bozuk/uyumsuz depoyla çalışırken yazım YAPILMAZ:
 * güvenilmediğimiz bir belleğin üstüne yazmak, arızayı kalıcılaştırır.
 */
export function persistCapabilityStore(
  immediate = false, atMs: number | null = null,
): boolean {
  /* P0-VDK-F5G — KALICILIK KAPISI: kimlik zayıf/yok ya da köken replay ise
     yazım YAPILMAZ. Engellenen yazım bir hata değil bir KARARDIR ve sayılır. */
  const key = getCapabilityStorageKey();
  if (key === null) { _blockedWrites++; return false; }
  if (!isStoreTrustworthy(_health)) return false;
  const owner = _scope.vehicleRef;
  const all = getCapabilityEdges();
  /* ⚠️ Bölüm dosyasına YALNIZ o aracın kenarları yazılır. Yabancı kenar bir
     yazım hatasıdır; sessizce taşınırsa fiziksel izolasyon iddiası çürürdü. */
  const mine = owner === null ? all : all.filter((e) => e.vehicleId === owner);
  _foreignSkipped = all.length - mine.length;
  const env: StoredEnvelope = {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    vehicleRef: owner,
    edgeCount: mine.length,
    savedAt: atMs,
    edges: mine,
  };
  try {
    safeSetRaw(key, JSON.stringify(env), undefined, immediate);
    _dirty = false;
    return true;
  } catch (e) {
    logError('OBD:CapabilityStoreWrite', e);
    return false;
  }
}

/**
 * Bir ölçümü öğrenme belleğine işler ve güncel kenarı döner.
 *
 * Birleştirme politikası `capabilityGraph.mergeCapabilityObservation`tadır —
 * burada TEK BİR KURAL BİLE kopyalanmaz.
 */
export function recordCapabilityObservation(
  o: CapabilityObservationInput, persist = false,
): CapabilityEdge | null {
  _ensureLoaded();
  try {
    const k = edgeKey(o);
    const prev = _edges.get(k) ?? null;
    if (prev === null && _edges.size >= MAX_STORED_EDGES) { _dropped++; return null; }
    const next = mergeCapabilityObservation(prev, o);
    _edges.set(k, next);
    _dirty = true;
    if (persist) persistCapabilityStore();
    return next;
  } catch (e) {
    logError('OBD:CapabilityRecord', e);
    return null;
  }
}

/** Tek bir kenarı okur (yeniden kullanım kararı için). */
export function getCapabilityEdge(
  vehicleId: string, ecuId: string, service: string, subFunction: string | null,
): CapabilityEdge | null {
  _ensureLoaded();
  return _edges.get(edgeKey({ vehicleId, ecuId, service, subFunction })) ?? null;
}

/** Bir aracın öğrenilmiş tüm kenarları. */
export function getVehicleCapabilities(vehicleId: string): readonly CapabilityEdge[] {
  _ensureLoaded();
  return getCapabilityEdges().filter((e) => e.vehicleId === vehicleId);
}

/** Test/teşhis: bozuk bir depo yazıp fail-closed davranışı ölçmek için. */
export function _writeRawStoreForTest(raw: string, key?: string): void {
  const target = key ?? getCapabilityStorageKey();
  if (target === null) return;
  safeSetRaw(target, raw, undefined, true);
  _loaded = false;
}
