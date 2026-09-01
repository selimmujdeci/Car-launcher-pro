/**
 * ecuRoleStore — P0-VDK-F6A · ARAÇ KAPSAMLI ECU ROL ÖĞRENMESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN AYRI BİR BÖLÜM ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Rol öğrenmesi F4-C yetenek kenarlarından FARKLI bir şeydir: kenar "bu ECU
 * 0x19'u destekliyor" der, rol "bu ECU ABS'tir" der. İkisini aynı dosyaya
 * koymak, birinin şema sürümü değiştiğinde diğerini de okunamaz yapardı.
 *
 * Ama kapsam politikası AYNIDIR: bölüm anahtarı MEVCUT
 * `gapLedgerScope.ecuRoleKeyFor` ile üretilir, kapsam kararı
 * `resolveGapLedgerScope`ten gelir ve bağlama TEK noktadan
 * (`vehicleDiagnosticContext`) yapılır. Üçüncü bir kapsam politikası YOKTUR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── PAZARLIKSIZ KURALLAR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **YALNIZ CANLI KANIT YAZILIR.** Replay/sentetik/içe aktarılmış çözüm
 *     ürün rolünü doğrulamaz (F4-C `isProductTrusted` ile AYNI kural).
 * (2) **YALNIZ EYLEME GEÇİRİLEBİLİR ROL YAZILIR** (`PROVEN`/`STRONG`).
 *     `CANDIDATE` bir benzerliktir; kalıcılaştırmak onu gerçeğe çevirirdi.
 * (3) **ÇELİŞKİ YAZILMAZ ve VARSA SİLER.** `CONFLICT`, öğrenilenin artık
 *     güvenilmez olduğunun kanıtıdır.
 * (4) **YABANCI KAYIT YAZILMAZ.** Dosyaya yalnız o aracın satırları girer;
 *     yükleme sırasında sahibi uyuşmayan dosya TÜMÜYLE bozuk sayılır.
 * (5) **ECU PARMAK İZİ ANAHTARIN PARÇASIDIR** (görev §16): aynı CAN kimliği
 *     başka bir araçta başka bir modüldür; adres tek başına anahtar OLAMAZ.
 *
 * timer YOK · ağ YOK · `Date.now` ENJEKTE edilir. ASLA throw etmez.
 */

import { safeGetRaw, safeSetRaw } from '../../../utils/safeStorage';
import { logError } from '../../crashLogger';
import {
  ecuRoleKeyFor, UNIDENTIFIED_SCOPE, type GapLedgerScope,
} from '../gapLedgerScope';
import {
  isStoreTrustworthy, type StoreHealth,
} from '../capability/capabilityStore';
import { isProductTrusted, type CapabilityProvenance } from '../capability/capabilityGraph';
import type { EcuRole } from '../ecuRoleModel';
import {
  isRoleActionable, type EcuRoleConfidence, type EcuRoleEvidenceItem,
  type EcuRoleResolution,
} from './ecuRoleEvidenceModel';

/**
 * Şema sürümü. **Artırıldığında eski depo OKUNMAZ** (geriye dönük tahmin YOK):
 * yanlış yorumlanmış bir rol, rolsüzlükten tehlikelidir.
 */
export const ECU_ROLE_SCHEMA_VERSION = 1;

/** Bir araçta saklanacak azami rol kaydı — sınırsız birikme YASAK. */
export const MAX_STORED_ROLES = 32;

/* ══════════════════════════════════════════════════════════════════════════
   1) KAYIT
   ══════════════════════════════════════════════════════════════════════════ */

export interface StoredEcuRole {
  /** F4-C ECU parmak izi kimliği — adres DEĞİL (görev §16). */
  readonly ecuFingerprint: string;
  /** Sahibi araç referansı (F4-C araç parmak izi). */
  readonly vehicleRef: string;
  readonly role: EcuRole;
  readonly confidence: EcuRoleConfidence;
  /** Kararı üreten kanıt türleri — ham değer TAŞINMAZ. */
  readonly evidenceKinds: readonly string[];
  readonly reason: string;
  readonly observedAtMs: number | null;
  readonly provenance: CapabilityProvenance;
  /** Teşhis kolaylığı — kimlik DEĞİL, yalnız insan okunur ipucu. */
  readonly rxHeader: string;
}

interface StoredEnvelope {
  readonly schemaVersion: number;
  readonly vehicleRef: string | null;
  readonly savedAt: number | null;
  readonly roleCount: number;
  readonly roles: readonly StoredEcuRole[];
}

/* ══════════════════════════════════════════════════════════════════════════
   2) DURUM
   ══════════════════════════════════════════════════════════════════════════ */

let _roles = new Map<string, StoredEcuRole>();
let _scope: GapLedgerScope = UNIDENTIFIED_SCOPE;
let _health: StoreHealth = 'EMPTY';
let _loaded = false;
let _dirty = false;
let _blockedWrites = 0;
let _foreignSkipped = 0;
let _switchCount = 0;

export function getEcuRoleStorageKey(): string | null {
  return _scope.persistenceAllowed ? ecuRoleKeyFor(_scope.vehicleRef) : null;
}
export function getEcuRoleHealth(): StoreHealth { return _health; }
export function getEcuRoleScope(): GapLedgerScope { return _scope; }
export function getStoredEcuRoles(): readonly StoredEcuRole[] { return [..._roles.values()]; }
export function getEcuRoleBlockedWrites(): number { return _blockedWrites; }
export function getEcuRoleForeignSkipped(): number { return _foreignSkipped; }
export function getEcuRoleSwitchCount(): number { return _switchCount; }
export function isEcuRoleStoreLoaded(): boolean { return _loaded; }

/** @internal — testler arası izolasyon (kalıcı depoyu da temizler). */
export function _resetEcuRoleStoreForTest(): void {
  try {
    const k = getEcuRoleStorageKey();
    if (k !== null) safeSetRaw(k, '', undefined, true);
  } catch { /* test temizliği */ }
  _roles = new Map(); _scope = UNIDENTIFIED_SCOPE; _health = 'EMPTY';
  _loaded = false; _dirty = false; _blockedWrites = 0;
  _foreignSkipped = 0; _switchCount = 0;
}

/** @internal — SÜREÇ durumunu sıfırlar, KALICI depoya DOKUNMAZ (restart taklidi). */
export function _simulateEcuRoleRestartForTest(): void {
  _roles = new Map(); _scope = UNIDENTIFIED_SCOPE; _health = 'EMPTY';
  _loaded = false; _dirty = false;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) YÜKLEME — FAIL-CLOSED
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Aktif aracın rol bölümünü yükler.
 *
 * Bozuk · şeması uyuşmayan · SAHİBİ BAŞKA olan dosya **yok sayılır**: yanlış
 * araca ait bir rol geçmişini ürün gerçeği gibi sunmak, hiç öğrenmemekten
 * tehlikelidir.
 */
export function loadEcuRoleStore(): StoreHealth {
  _loaded = true;
  _roles = new Map();
  const key = getEcuRoleStorageKey();
  if (key === null) { _health = 'EMPTY'; return _health; }

  let raw: string | null = null;
  try { raw = safeGetRaw(key); }
  catch (e) { logError('OBD:EcuRoleStoreRead', e); _health = 'UNAVAILABLE'; return _health; }
  if (raw === null || raw.length === 0) { _health = 'EMPTY'; return _health; }

  let env: StoredEnvelope | null = null;
  try { env = JSON.parse(raw) as StoredEnvelope; }
  catch { _health = 'CORRUPT'; return _health; }

  if (env === null || typeof env !== 'object' || !Array.isArray(env.roles)) {
    _health = 'CORRUPT'; return _health;
  }
  if (env.schemaVersion !== ECU_ROLE_SCHEMA_VERSION) {
    _health = 'SCHEMA_MISMATCH'; return _health;
  }
  const owner = _scope.vehicleRef;
  if (owner !== null && env.vehicleRef !== null && env.vehicleRef !== owner) {
    /* Dosya BAŞKA aracın sahipliğini taşıyor → fiziksel izolasyon ihlali. */
    _health = 'CORRUPT'; return _health;
  }
  if (env.roles.some((r) => owner !== null && r.vehicleRef !== owner)) {
    _health = 'CORRUPT'; return _health;
  }

  for (const r of env.roles.slice(0, MAX_STORED_ROLES)) {
    if (typeof r?.ecuFingerprint !== 'string' || r.ecuFingerprint.length === 0) continue;
    _roles.set(r.ecuFingerprint, r);
  }
  /* ⚠️ Sözlük MEVCUT `StoreHealth`tir; `'VALID'` gibi paralel bir değer
     uydurulursa `isStoreTrustworthy` onu TANIMAZ ve depo sessizce güvenilmez
     sayılırdı (bu tur ölçülen gerçek kusur). */
  _health = 'OK';
  _dirty = false;
  return _health;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) BAĞLAMA — kapsam DIŞARIDAN gelir
   ══════════════════════════════════════════════════════════════════════════ */

export interface EcuRoleActivation {
  readonly scope: GapLedgerScope;
  readonly switched: boolean;
  readonly detachedRef: string | null;
  readonly health: StoreHealth;
  readonly roles: number;
}

/**
 * Aktif aracın rol bölümünü bağlar.
 *
 * Kapsam BURADA HESAPLANMAZ: boşluk sicili ve yetenek deposuyla AYNI karardan
 * (tek çağrı, `vehicleDiagnosticContext`) gelir.
 */
export function activateEcuRoleVehicle(
  scope: GapLedgerScope, nowMs: number | null,
): EcuRoleActivation {
  const prevRef = _scope.vehicleRef;
  const same = _loaded && prevRef === scope.vehicleRef
    && _scope.persistenceAllowed === scope.persistenceAllowed;
  if (same) {
    return { scope: _scope, switched: false, detachedRef: null,
      health: _health, roles: _roles.size };
  }
  const hadVehicle = prevRef !== null || _roles.size > 0;

  /* YALNIZ yüklenmiş VE kirli bellek yazılır (F5-G'de ölçülen kusur). */
  try {
    if (_loaded && _dirty && _scope.persistenceAllowed) persistEcuRoleStore(nowMs, true);
  } catch (e) { logError('OBD:EcuRoleDetachPersist', e); }

  _roles = new Map();
  _dirty = false;
  _blockedWrites = 0;
  _foreignSkipped = 0;
  _scope = scope;
  _loaded = false;
  const switched = hadVehicle && prevRef !== scope.vehicleRef;
  if (switched) _switchCount++;

  const health = loadEcuRoleStore();
  return { scope: _scope, switched, detachedRef: switched ? prevRef : null,
    health, roles: _roles.size };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) YAZMA
   ══════════════════════════════════════════════════════════════════════════ */

export function persistEcuRoleStore(atMs: number | null, immediate = false): boolean {
  const key = getEcuRoleStorageKey();
  if (key === null) { _blockedWrites++; return false; }
  if (!isStoreTrustworthy(_health)) return false;

  const owner = _scope.vehicleRef;
  const all = [..._roles.values()];
  const mine = owner === null ? all : all.filter((r) => r.vehicleRef === owner);
  _foreignSkipped = all.length - mine.length;

  const env: StoredEnvelope = {
    schemaVersion: ECU_ROLE_SCHEMA_VERSION,
    vehicleRef: owner,
    savedAt: atMs,
    roleCount: mine.length,
    roles: mine.slice(0, MAX_STORED_ROLES),
  };
  try {
    safeSetRaw(key, JSON.stringify(env), undefined, immediate);
    _dirty = false;
    return true;
  } catch (e) {
    logError('OBD:EcuRoleStoreWrite', e);
    return false;
  }
}

export interface RecordEcuRoleInput {
  readonly ecuFingerprint: string;
  readonly vehicleRef: string | null;
  readonly rxHeader: string;
  readonly resolution: EcuRoleResolution;
  readonly provenance: CapabilityProvenance;
  readonly atMs: number | null;
}

export type EcuRoleWriteOutcome =
  | 'STORED' | 'BLOCKED_SCOPE' | 'BLOCKED_UNTRUSTED'
  | 'BLOCKED_WEAK' | 'CLEARED_CONFLICT';

/**
 * Çözülmüş rolü öğrenmeye yazar — **dört kapıdan geçerek**.
 *
 * `CONFLICT` gelirse mevcut öğrenilmiş kayıt SİLİNİR: çelişki, o kaydın artık
 * güvenilmez olduğunun ölçülmüş kanıtıdır.
 */
export function recordEcuRole(i: RecordEcuRoleInput): EcuRoleWriteOutcome {
  try {
    if (!_loaded) loadEcuRoleStore();
    const owner = _scope.vehicleRef;

    if (i.resolution.confidence === 'CONFLICT') {
      if (_roles.delete(i.ecuFingerprint)) {
        _dirty = true;
        persistEcuRoleStore(i.atMs, true);
      }
      return 'CLEARED_CONFLICT';
    }
    if (owner === null || i.vehicleRef === null || i.vehicleRef !== owner
        || !_scope.persistenceAllowed) {
      _blockedWrites++;
      return 'BLOCKED_SCOPE';
    }
    if (!isProductTrusted(i.provenance)) return 'BLOCKED_UNTRUSTED';
    if (!isRoleActionable(i.resolution.confidence)) return 'BLOCKED_WEAK';

    /* Tavan: en eski kayıt düşer. Sessiz DEĞİL — sayaç `roleCount`ta görünür. */
    if (!_roles.has(i.ecuFingerprint) && _roles.size >= MAX_STORED_ROLES) {
      const oldest = [..._roles.entries()]
        .sort((a, b) => (a[1].observedAtMs ?? 0) - (b[1].observedAtMs ?? 0))[0];
      if (oldest !== undefined) _roles.delete(oldest[0]);
    }

    _roles.set(i.ecuFingerprint, {
      ecuFingerprint: i.ecuFingerprint,
      vehicleRef: owner,
      role: i.resolution.role,
      confidence: i.resolution.confidence,
      evidenceKinds: Object.freeze(
        [...new Set(i.resolution.evidence.map((e) => e.kind))].sort()),
      reason: i.resolution.reason,
      observedAtMs: i.atMs,
      provenance: i.provenance,
      rxHeader: i.rxHeader,
    });
    _dirty = true;
    /* ANINDA yazım bilinçlidir: rol öğrenmesi tur başına en çok birkaç satırdır
       (eMMC baskısı yok) ve geciktirilirse bir sonraki AÇILIŞ onu bulamaz —
       yani "öğrenme" iddiası kanıtsız kalırdı. */
    persistEcuRoleStore(i.atMs, true);
    return 'STORED';
  } catch (e) {
    logError('OBD:EcuRoleRecord', e);
    return 'BLOCKED_SCOPE';
  }
}

/**
 * ÖĞRENİLMİŞ rolü kanıt olarak okur.
 *
 * ⚠️ Yalnız AYNI araç bölümünden ve AYNI ECU parmak iziyle okunur; adres
 * eşleşmesi TEK BAŞINA yeterli DEĞİLDİR (görev §16). Bölüm zaten araca göre
 * ayrıldığı için çapraz araç sızıntısı iki bağımsız kapıyla engellenir.
 */
export function learnedRoleEvidence(
  ecuFingerprint: string,
): EcuRoleEvidenceItem | null {
  try {
    if (!_loaded) loadEcuRoleStore();
    if (!isStoreTrustworthy(_health)) return null;
    const hit = _roles.get(ecuFingerprint);
    if (hit === undefined || hit.role === 'unknown') return null;
    if (!isProductTrusted(hit.provenance)) return null;
    return {
      kind: 'LEARNED_CONFIRMED',
      role: hit.role as Exclude<EcuRole, 'unknown'>,
      detail: `Aynı araç+ECU parmak iziyle daha önce CANLI kanıtla doğrulandı `
        + `(${hit.confidence}).`,
      source: `learned:${hit.ecuFingerprint}`,
      observedAt: hit.observedAtMs,
      provenance: hit.provenance,
    };
  } catch (e) {
    logError('OBD:EcuRoleRead', e);
    return null;
  }
}
