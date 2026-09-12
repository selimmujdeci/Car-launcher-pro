/**
 * gapRegistry — P0-VDK-F2C2 · YAPISAL BOŞLUK SİCİLİ (kayıt, ÇÖZÜM DEĞİL).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * CarOS'un uzun vadeli hedeflerinden biri **kendi tanı eksiklerini ölçerek
 * tespit eden ve tamamlayan** bir sistemdir. Bir gerçek var: **bugün atılan bir
 * sinyal yarın öğrenilemez.** Bir uygunluk koşusu "burada ölçüm yoktu" ya da
 * "bu ECU'nun sahibi bilinmiyordu" dediğinde, o bilgi bir yere yazılmazsa
 * kaybolur ve gelecekteki çözücü onu yeniden keşfetmek zorunda kalır — ya da
 * hiç keşfedemez. Bu sicil o kaybı önler.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── P0-VDK-F5D · KANIT ZARFI ──────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Her kayıt kendi kanıt zarfını (`gapEvidence.GapEvidence`) taşır: boşluğu
 * DOĞURAN ölçümün künyesi (ECU · servis · alt fonksiyon · NRC · sınıflandırma ·
 * işlem/korelasyon) kaydın İÇİNDEDİR. Zarf bir KOPYA değil bir BAĞDIR: ham
 * gövde taşımaz. Böylece F4-B'nin tavanlı yoklama defteri kırpılsa bile
 * Self-Healing hedefini kaybetmez.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── P0-VDK-F5E · KALICILIK (bu turda eklendi) ─────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5-D raporunda açık borç olarak yazılmıştı: sicil **süreç ömürlüydü** —
 * kanıt probe defteri kırpılsa da yaşıyordu ama uygulama yeniden başlayınca
 * hem boşluk hem kanıt gidiyordu. Artık sicil YEREL olarak kalıcıdır.
 *
 * **YENİ DEPO/OTORİTE KURULMADI:** kalıcılık yolu MEVCUT `safeStorage`
 * sarmalayıcısıdır (atomik `.tmp → rename → verify-read`, kota koruması,
 * LRU kalkanı TEK yerdedir) ve şema/sağlık sözlüğü MEVCUT
 * `capabilityStore.StoreHealth`tir — paralel bir sözlük yazılmadı.
 * Saklama/eviction/kota kararları SAF `gapRetentionPolicy`dedir.
 *
 * Kalıcılık sözleşmesi:
 *  · YALNIZ YEREL — Supabase/FleetKB/ağ TEK BAYT yazmaz.
 *  · SÜRÜMLÜ ŞEMA — bilinmeyen sürüm **fail-closed** reddedilir.
 *  · TEK bozuk kayıt TÜM depoyu güvenilmez yapar (kısmi "öğrendik" YOK).
 *  · YALNIZ `live` kanıtlı kayıt yazılır (replay/sentetik ürünü kirletemez).
 *  · Diske giden alanlar BEYAZ LİSTEDİR (ham gövde/VIN/MAC yapısal olarak giremez).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **SELF-HEALING DEĞİLDİR.** Hiçbir boşluğu kapatmaz, sorgu üretmez.
 * (2) **İKİNCİ SİNYAL SÖZLÜĞÜ DEĞİLDİR.** Sözlük MEVCUT `ReplayGapSignal`dır.
 * (3) **BULUT BELLEĞİ DEĞİLDİR.** Fleet Memory bu fazın DIŞINDADIR.
 * (4) **HÜKÜM VERMEZ.** Yaşam döngüsü otoritesi F5-A `gapModel`dir;
 *     `resolutionState` yalnız "hangi kanıt kapattı" BAĞIDIR.
 *
 * timer YOK · abonelik YOK · ağ YOK · `Date.now` ENJEKTE edilir.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import { logError } from '../crashLogger';
import type { ReplayGapSignal } from './virtualTransport';
import type { ServicePresence } from './ecuCapabilityModel';
import type { CapabilityProvenance } from './capability/capabilityGraph';
import {
  gapRegistryKey, type GapEvidence, type GapEvidenceState,
} from './gapEvidence';
/* Depo sağlığı sözlüğü MEVCUTTUR — F4-C ile AYNI dil kullanılır (paralel
   sözlük yazılmadı); saklama kararları SAF politika modülündedir. */
import { isStoreTrustworthy, type StoreHealth } from './capability/capabilityStore';
import {
  MAX_GAP_ENTRIES, isGapEntryPersistable, planGapInsert,
  projectGapEntryForPersist,
  type GapEvictionReason,
} from './gapRetentionPolicy';
/* P0-VDK-F5F — araç kapsamı SAF politikadan gelir; burada kimlik ÜRETİLMEZ. */
import {
  LEGACY_UNSCOPED_GAP_LEDGER_KEY, UNIDENTIFIED_SCOPE,
  isSameGapLedgerScope, resolveGapLedgerScope,
  type GapLedgerScope, type GapLedgerScopeInput,
} from './gapLedgerScope';
import { getTraceProvenanceMode, type TraceProvenance } from './canonicalTrace';

export { MAX_GAP_ENTRIES };

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

/** Boşluğun ölçüldüğü katman — MEVCUT parite katman sözlüğüyle aynı dil. */
export type GapScope =
  | 'TRANSPORT'
  | 'SESSION'
  | 'PARSER'
  | 'AUTHORITY'
  | 'VERDICT'
  | 'CONFORMANCE'
  | 'UNKNOWN';

/**
 * Kaydın kapanma bağı.
 *
 * ⚠️ Bu bir yaşam döngüsü DEĞİLDİR (o F5-A `GapLifecycle`in işidir).
 * Yalnız üç gerçeği ayırır: hiç kapanmadı · kapandı · kapandıktan sonra
 * TEKRAR ölçüldü.
 */
export type GapResolutionState = 'OPEN' | 'RESOLVED' | 'REOPENED';

export const GAP_RESOLUTION_STATE_LABEL: Readonly<Record<GapResolutionState, string>> = {
  OPEN:     'AÇIK — kapatan kanıt yok',
  RESOLVED: 'KAPANDI — yeni kanıt boşluğu doldurdu',
  REOPENED: 'YENİDEN AÇILDI — kapandıktan sonra tekrar ölçüldü',
} as const;

/**
 * Boşluğu KAPATAN kanıt — DOĞUM kanıtından AYRI tutulur.
 *
 * "Neden açıldı?" (`GapEntry.evidence`) ile "neden kapandı?" (bu kayıt)
 * asla aynı alana yazılmaz; birincisi hiçbir koşulda değiştirilmez.
 */
export interface GapResolution {
  /** Kapatan ölçümün iz korelasyon kimliği; ölçülmediyse `null`. */
  readonly evidenceRef: string | null;
  /** Kapatan ölçümün sınıflandırması (MEVCUT otoritenin çıktısı). */
  readonly classification: ServicePresence | null;
  /** Kapatan kanıtın kökeni — YALNIZ `live` ürün güveni üretir. */
  readonly provenance: CapabilityProvenance | null;
  readonly resolvedAtMs: number | null;
  /** Kapanma gerekçesi (kanıt cümlesi) — sessiz kapanış YASAK. */
  readonly detail: string;
}

/**
 * Sicil kaydı.
 *
 * ⚠️ Ham istek/yanıt gövdesi TAŞINMAZ. Sicil "neyin ölçülemediğini" tutar,
 * "neyin ölçüldüğünü" değil — o zaten kanonik izdedir.
 */
export interface GapEntry {
  /** Deterministik satır anahtarı (`gapEvidence.gapRegistryKey`). */
  readonly key: string;
  readonly signal: ReplayGapSignal;
  readonly scope: GapScope;
  /** Boşluğun ölçüldüğü bağlam (ör. `mode03` · `uds_19:02` · `conformance`). */
  readonly context: string;
  /** Kaç kez ölçüldü — tekrar bir kanıttır, gürültü değil. */
  readonly count: number;
  /** İlk ve son ölçüm damgası (ENJEKTE edilir); ölçülemediyse `null`. */
  readonly firstSeenMs: number | null;
  readonly lastSeenMs: number | null;
  /** İlgili koşu kimliği (varsa) — hangi turda görüldüğü izlenebilsin. */
  readonly runId: string | null;
  /**
   * P0-VDK-F5D — boşluğu DOĞURAN ölçümün kanonik künyesi.
   *
   * **DEĞİŞMEZ**: ilk yazımdan sonra hiçbir dal bu alanı güncellemez; kalıcı
   * depodan geri yüklenirken de olduğu gibi taşınır.
   */
  readonly evidence: GapEvidence | null;
  /** Zarfın durumu — zarf yoksa `UNAVAILABLE` (sahte "tam kanıt" YASAK). */
  readonly evidenceState: GapEvidenceState;
  readonly resolutionState: GapResolutionState;
  /** Kapatan kanıt bağı; kapanmadıysa `null`. */
  readonly resolution: GapResolution | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KALICI ŞEMA
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * P0-VDK-F5F — DEPO ANAHTARI ARTIK SABİT DEĞİL, ARACA BAĞLIDIR.
 *
 * F5-E tek global anahtara yazıyordu; aynı head unit'e iki araç takıldığında
 * sicilleri karışırdı. Anahtar artık aktif kapsamdan gelir
 * (`gapLedgerScope.gapLedgerKeyFor`) ve kimlik kanıtlı değilse **hiç yoktur**.
 */
export function getGapLedgerStorageKey(): string | null {
  return _scope.storageKey;
}

/** F5-E'den kalan kapsamsız depo VAR mı — LAB kanıtı (yüklenmez, taşınmaz). */
export function hasLegacyUnscopedGapLedger(): boolean {
  try {
    const raw = safeGetRaw(LEGACY_UNSCOPED_GAP_LEDGER_KEY);
    return raw !== null && raw.length > 0;
  } catch { return false; }
}

/**
 * Şema sürümü. **Artırıldığında eski depo OKUNMAZ** (geriye dönük tahmin YOK):
 * yanlış yorumlanmış bir boşluk sicili, sicilsiz kalmaktan daha tehlikelidir —
 * çözücü var olmayan bir hedefi ölçmeye çalışırdı.
 */
export const GAP_LEDGER_SCHEMA_VERSION = 1;

interface StoredGapLedger {
  readonly schemaVersion: number;
  /** Yazım damgası (ENJEKTE edilir); ölçülmediyse `null`. */
  readonly savedAt: number | null;
  /** BÜTÜNLÜK: `entries.length` ile birebir eşleşmezse depo YARIM sayılır. */
  readonly entryCount: number;
  readonly entries: readonly GapEntry[];
  readonly droppedCount: number;
  readonly evictedCount: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DEFTER
   ══════════════════════════════════════════════════════════════════════════ */

const _entries = new Map<string, GapEntry>();
let _dropped = 0;
let _evicted = 0;
const _reasonCounts: Record<string, number> = {};
/** Kökeni `live` olmadığı için diske YAZILMAYAN satır sayısı (ölçüm). */
let _notPersisted = 0;

let _health: StoreHealth = 'EMPTY';
let _loaded = false;
let _restored = 0;
let _restoredAtMs: number | null = null;
let _savedAtMs: number | null = null;
let _lastSaveOk: boolean | null = null;

/* ── P0-VDK-F5F · AKTİF ARAÇ KAPSAMI ─────────────────────────────────────
   Sicil artık "hangi araç" sorusunu yanıtlamadan tek bayt okumaz/yazmaz. */
let _scope: GapLedgerScope = UNIDENTIFIED_SCOPE;
let _switchCount = 0;
let _detachedRef: string | null = null;
let _bootAtMs: number | null = null;
let _restoreAttempted = false;
let _blockedWrites = 0;
/** Bellekte YAZILMAMIŞ değişiklik var mı (ayrılma yazımının ön koşulu). */
let _dirty = false;

function _note(reason: GapEvictionReason): void {
  _reasonCounts[reason] = (_reasonCounts[reason] ?? 0) + 1;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) OKUMA — fail-closed
   ══════════════════════════════════════════════════════════════════════════ */

function _validEvidence(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return typeof e.state === 'string'
    && (e.service === null || typeof e.service === 'string')
    && (e.ecuKey === null || typeof e.ecuKey === 'string')
    && (e.observedNrc === null || typeof e.observedNrc === 'number')
    && (e.provenance === null || typeof e.provenance === 'string');
}

/**
 * Bir kaydın ŞEKLİ geçerli mi — tanınmayan kayıt sessizce KABUL EDİLMEZ.
 *
 * Tek bir kayıt bile şekilsizse TÜM depo reddedilir (`loadGapLedger`): kısmen
 * güvenilen bir sicil, hangi satırın uydurma olduğunu bilmediğimiz bir
 * sicildir ve çözücü onun üstüne ölçüm planlar.
 */
function _validEntry(v: unknown): v is GapEntry {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return typeof e.key === 'string' && e.key.length > 0
    && typeof e.signal === 'string' && e.signal.length > 0
    && typeof e.scope === 'string' && e.scope.length > 0
    && typeof e.context === 'string'
    && typeof e.count === 'number' && Number.isFinite(e.count) && e.count > 0
    && (e.firstSeenMs === null || typeof e.firstSeenMs === 'number')
    && (e.lastSeenMs === null || typeof e.lastSeenMs === 'number')
    && (e.runId === null || typeof e.runId === 'string')
    && typeof e.evidenceState === 'string'
    && typeof e.resolutionState === 'string'
    && (e.resolution === null || (typeof e.resolution === 'object'
      && !Array.isArray(e.resolution)))
    && _validEvidence(e.evidence);
}

/**
 * Kalıcı sicili yükler. **ASLA throw etmez** ve bozuk depoda kayıt İDDİA ETMEZ.
 *
 * Geri yüklenen kayıt **yeniden ölçülmüş gibi davranmaz**: `provenance`,
 * `observedAt`, `count` ve damgalar olduğu gibi taşınır; hiçbiri tazelenmez.
 */
export function loadGapLedger(): StoreHealth {
  _entries.clear();
  _restored = 0;
  _loaded = true;

  /* P0-VDK-F5F — KİMLİK YOKSA HİÇBİR SİCİL YÜKLENMEZ.
     "Muhtemelen aynı araçtır" diye eski bölümü yüklemek, bu turun yasakladığı
     TEK ŞEYDİR: yanlış araca ait bir tanı geçmişi, yanlış ECU'da ölçüm
     planlatır. Kapsamsız/zayıf/replay kapsamda sicil BELLEK İÇİDİR. */
  const key = _scope.storageKey;
  if (key === null) { _health = 'EMPTY'; return _health; }

  let raw: string | null;
  try {
    raw = safeGetRaw(key);
  } catch (e) {
    logError('OBD:GapLedgerRead', e);
    _health = 'UNAVAILABLE';
    return _health;
  }
  if (raw === null || raw.length === 0) { _health = 'EMPTY'; return _health; }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { _health = 'CORRUPT'; return _health; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    _health = 'CORRUPT'; return _health;
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.schemaVersion !== 'number') { _health = 'CORRUPT'; return _health; }
  if (env.schemaVersion !== GAP_LEDGER_SCHEMA_VERSION) {
    /* Geriye dönük tahmin YOK. Eski sürüm okunmaz, taşınmaz, yorumlanmaz. */
    _health = 'SCHEMA_MISMATCH'; return _health;
  }
  if (!Array.isArray(env.entries)) { _health = 'CORRUPT'; return _health; }
  /* BÜTÜNLÜK: yarım yazılmış (kesilmiş) bir depo güvenilir SAYILMAZ. */
  if (typeof env.entryCount !== 'number' || env.entryCount !== env.entries.length) {
    _health = 'CORRUPT'; return _health;
  }
  if (!env.entries.every(_validEntry)) { _health = 'CORRUPT'; return _health; }

  for (const e of env.entries as GapEntry[]) {
    if (_entries.size >= MAX_GAP_ENTRIES) { _dropped++; _note('CAPACITY'); continue; }
    _entries.set(e.key, Object.freeze(e));
    _restored++;
  }
  _dropped += typeof env.droppedCount === 'number' && env.droppedCount > 0
    ? env.droppedCount : 0;
  _evicted += typeof env.evictedCount === 'number' && env.evictedCount > 0
    ? env.evictedCount : 0;
  _savedAtMs = typeof env.savedAt === 'number' ? env.savedAt : null;
  _health = 'OK';
  return _health;
}

/** Depoyu yüklemediyse yükler (idempotent) — `capabilityStore` ile AYNI desen. */
function _ensureLoaded(): void {
  if (!_loaded) loadGapLedger();
}

/* ══════════════════════════════════════════════════════════════════════════
   5) YAZMA — atomik, sınırlı, YALNIZ canlı kanıt
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Sicili diske yazar.
 *
 * `safeSetRaw` MEVCUT atomik/kota-korumalı yoldur (`.tmp → rename →
 * verify-read`); ikinci bir kalıcılık yolu AÇILMAZ. Bozuk/uyumsuz depoyla
 * çalışırken yazım YAPILMAZ: güvenilmediğimiz bir siciln üstüne yazmak arızayı
 * kalıcılaştırırdı.
 *
 * Yalnız `isGapEntryPersistable` (kökeni ÖLÇÜLMÜŞ ve `live`) kayıtlar yazılır;
 * yazılmayanlar SESSİZ DEĞİLDİR (`getGapLedgerNotPersisted`).
 */
export function persistGapLedger(atMs: number | null, immediate = false): boolean {
  /* P0-VDK-F5F — KALICILIK KAPISI: kimlik zayıf/yok ya da köken replay ise
     yazım YAPILMAZ. Bu bir hata DEĞİL, bir karardır: engellenen yazım ayrı
     sayılır ve LAB'da gerekçesiyle görünür. */
  const key = _scope.storageKey;
  if (key === null || !_scope.persistenceAllowed) { _blockedWrites++; return false; }
  if (!isStoreTrustworthy(_health)) { _lastSaveOk = false; return false; }
  const all = [..._entries.values()];
  const keep = all.filter(isGapEntryPersistable).map(projectGapEntryForPersist);
  _notPersisted = all.length - keep.length;
  const env: StoredGapLedger = {
    schemaVersion: GAP_LEDGER_SCHEMA_VERSION,
    savedAt: atMs,
    entryCount: keep.length,
    entries: keep,
    droppedCount: _dropped,
    evictedCount: _evicted,
  };
  try {
    safeSetRaw(key, JSON.stringify(env), undefined, immediate);
    _savedAtMs = atMs;
    _lastSaveOk = true;
    _dirty = false;
    return true;
  } catch (e) {
    logError('OBD:GapLedgerWrite', e);
    _lastSaveOk = false;
    return false;
  }
}

export interface RecordGapInput {
  readonly signal: ReplayGapSignal;
  readonly scope: GapScope;
  readonly context: string;
  /** Ölçüm damgası — ENJEKTE edilir. Yoksa `null` (sahte tarih YASAK). */
  readonly atMs: number | null;
  readonly runId?: string | null;
  /**
   * P0-VDK-F5D — boşluğu doğuran ölçümün kanıt zarfı.
   *
   * İSTEĞE BAĞLIDIR: kanıt üretemeyen üretici (uygunluk koşusu, parser
   * paritesi) zarfsız çağırır ve kaydı dürüstçe `UNAVAILABLE` işaretlenir.
   */
  readonly evidence?: GapEvidence | null;
  /** P0-VDK-F5E — kalıcı yazımı bu çağrıda atla (toplu yazım çağıranda). */
  readonly skipPersist?: boolean;
}

/**
 * Boşluk sinyalini sicile yazar. ASLA fırlatmaz.
 *
 * Aynı ölçüm künyesi tekrar gelirse yeni satır AÇILMAZ; sayaç artar ve son
 * damga güncellenir. Böylece sicil bir olay akışı değil, bir DURUM envanteri
 * olur.
 *
 * ⚠️ KİMLİK: anahtar `sinyal|bağlam|künye`dir (künye = ECU · servis · alt
 * fonksiyon · sınıflandırma · NRC). Farklı ECU'da ya da farklı NRC ile ölçülen
 * boşluklar TEK satıra EZİLMEZ; zarfsız çağıranda künye boştur ve eski davranış
 * birebir korunur.
 *
 * ⚠️ KAPASİTE: yeni satır açılırken karar SAF `planGapInsert`tedir — kota ve
 * eviction kuralları burada KOPYALANMAZ.
 */
export function recordGap(input: RecordGapInput): void {
  try {
    _ensureLoaded();
    const ev = input.evidence ?? null;
    const k = gapRegistryKey(input.signal, input.context, ev);
    const prev = _entries.get(k);
    if (prev !== undefined) {
      const next = Object.freeze({
        ...prev,
        count: prev.count + 1,
        lastSeenMs: input.atMs ?? prev.lastSeenMs,
        runId: input.runId ?? prev.runId,
        /* DOĞUM kanıtı DEĞİŞMEZ — kapanmış bir boşluk tekrar ölçüldüyse bu
           yalnız durumu etkiler, kanıtın kendisini DEĞİL. */
        resolutionState: (prev.resolutionState === 'OPEN'
          ? 'OPEN' : 'REOPENED') as GapResolutionState,
      });
      _entries.set(k, next);
      _dirty = true;
      /* Yeniden açılma KALICI bir gerçektir — yazılır. Salt sayaç artışı
         her turda diske gitmez (eMMC ömrü · CLAUDE.md §3). */
      if (input.skipPersist !== true && prev.resolutionState !== next.resolutionState) {
        persistGapLedger(input.atMs);
      }
      return;
    }

    const candidate: GapEntry = Object.freeze({
      key: k,
      signal: input.signal,
      scope: input.scope,
      context: input.context,
      count: 1,
      firstSeenMs: input.atMs,
      lastSeenMs: input.atMs,
      runId: input.runId ?? null,
      evidence: ev,
      evidenceState: ev === null ? 'UNAVAILABLE' : ev.state,
      resolutionState: 'OPEN' as GapResolutionState,
      resolution: null,
    });

    const plan = planGapInsert([..._entries.values()], candidate, input.atMs);
    if (!plan.accept) {
      _dropped++;
      if (plan.reason !== null) _note(plan.reason);
      return;
    }
    if (plan.evictKey !== null) {
      _entries.delete(plan.evictKey);
      _evicted++;
      if (plan.reason !== null) _note(plan.reason);
    }
    _entries.set(k, candidate);
    _dirty = true;
    if (input.skipPersist !== true) persistGapLedger(input.atMs);
  } catch { /* sicil kaydı ASLA taramayı düşürmez */ }
}

/** Birden çok sinyali TEK bağlamda yazar (uygunluk koşusu deseni). */
export function recordGaps(
  signals: readonly ReplayGapSignal[], scope: GapScope,
  context: string, atMs: number | null, runId?: string | null,
): void {
  for (const s of signals) recordGap({ signal: s, scope, context, atMs, runId });
}

export interface ResolveGapInput {
  /** Sicil satır anahtarı (`GapEntry.key`). */
  readonly key: string;
  readonly evidenceRef: string | null;
  readonly classification: ServicePresence | null;
  readonly provenance: CapabilityProvenance | null;
  readonly resolvedAtMs: number | null;
  readonly detail: string;
}

/**
 * Bir boşluğu KAPATAN kanıtı kaydeder ve KALICI hâle getirir. ASLA fırlatmaz.
 *
 * ⚠️ DOĞUM KANITINA DOKUNMAZ: `evidence` ve `evidenceState` aynen kalır.
 * Bilinmeyen anahtar sessizce yok sayılır — sicil, olmayan bir boşluğu
 * "kapandı" diye UYDURMAZ.
 */
export function markGapResolved(input: ResolveGapInput): boolean {
  try {
    _ensureLoaded();
    const prev = _entries.get(input.key);
    if (prev === undefined) return false;
    _entries.set(input.key, Object.freeze({
      ...prev,
      resolutionState: 'RESOLVED' as GapResolutionState,
      resolution: Object.freeze({
        evidenceRef: input.evidenceRef,
        classification: input.classification,
        provenance: input.provenance,
        resolvedAtMs: input.resolvedAtMs,
        detail: input.detail,
      }),
    }));
    _dirty = true;
    persistGapLedger(input.resolvedAtMs);
    return true;
  } catch { return false; }
}

/* ══════════════════════════════════════════════════════════════════════════
   6) OKUMA YÜZEYLERİ — hiçbiri ölçüm/yazım TETİKLEMEZ
   ══════════════════════════════════════════════════════════════════════════ */

/** LAB salt-okuma yüzeyi — hiçbir şey tetiklemez, ASLA fırlatmaz. */
export function getGapRegistry(): readonly GapEntry[] {
  try {
    _ensureLoaded();
    return [..._entries.values()].sort((a, b) =>
      b.count - a.count || a.signal.localeCompare(b.signal)
      || a.key.localeCompare(b.key));
  } catch { return []; }
}

/** Tek satır okuma (çözücünün kapanış yazımı için). */
export function getGapEntry(key: string): GapEntry | null {
  try { _ensureLoaded(); return _entries.get(key) ?? null; } catch { return null; }
}

/** Tavan/kota yüzünden YAZILAMAYAN kayıt adedi — kırpma SESSİZ DEĞİLDİR. */
export function getGapRegistryDropped(): number { return _dropped; }
/** Yer açmak için DÜŞÜRÜLEN mevcut satır adedi. */
export function getGapRegistryEvicted(): number { return _evicted; }
/** Kota/tavan gerekçelerinin dağılımı (LAB kanıtı). */
export function getGapEvictionReasons(): Readonly<Record<string, number>> {
  return { ..._reasonCounts };
}
/** Kökeni `live` olmadığı için diske yazılmayan satır adedi. */
export function getGapLedgerNotPersisted(): number { return _notPersisted; }

export function getGapLedgerHealth(): StoreHealth { return _health; }
export function isGapLedgerLoaded(): boolean { return _loaded; }
export function getGapLedgerRestoredCount(): number { return _restored; }
export function getGapLedgerRestoredAt(): number | null { return _restoredAtMs; }
export function getGapLedgerSavedAt(): number | null { return _savedAtMs; }
/** Son yazım denemesi başarılı mıydı; HİÇ yazılmadıysa `null` (≠ `false`). */
export function getGapLedgerLastSaveOk(): boolean | null { return _lastSaveOk; }

/** Sinyal bazında toplam — "hangi eksik daha yaygın" sorusunun cevabı. */
export function summarizeGapRegistry(): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    for (const e of _entries.values()) out[e.signal] = (out[e.signal] ?? 0) + e.count;
  } catch { /* fail-soft */ }
  return out;
}

/** Kanıt bağı + kalıcılık sayımı — LAB'ın fail-closed hükmü bunun üstüne kurulur. */
export interface GapEvidenceCoverage {
  readonly total: number;
  readonly measured: number;
  readonly incomplete: number;
  readonly unavailable: number;
  readonly resolved: number;
  readonly reopened: number;
  /** Kalıcı depoya YAZILABİLİR (kökeni `live`) satır adedi. */
  readonly persistable: number;
}

export function summarizeGapEvidence(): GapEvidenceCoverage {
  let measured = 0, incomplete = 0, unavailable = 0, resolved = 0, reopened = 0;
  let persistable = 0, total = 0;
  try {
    for (const e of _entries.values()) {
      total++;
      if (e.evidenceState === 'MEASURED') measured++;
      else if (e.evidenceState === 'LEGACY_INCOMPLETE') incomplete++;
      else unavailable++;
      if (e.resolutionState === 'RESOLVED') resolved++;
      else if (e.resolutionState === 'REOPENED') reopened++;
      if (isGapEntryPersistable(e)) persistable++;
    }
  } catch { /* fail-soft */ }
  return Object.freeze({
    total, measured, incomplete, unavailable, resolved, reopened, persistable,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   7) AÇILIŞ GERİ YÜKLEME
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Açılışta kalıcı sicili belleğe alır ve SONUCU KANIT OLARAK döner.
 *
 * ⚠️ "Boşluk yok" ile "depo okunamadı" AYRI gerçeklerdir: bozuk/uyumsuz depoda
 * sicil BOŞ başlar ama sağlık `CORRUPT`/`SCHEMA_MISMATCH` olarak görünür ve
 * LAB bunu `KAYNAK YOK` olarak gösterir — sessizce "temiz" DENMEZ.
 */
export function restoreGapLedger(nowMs: number | null): StoreHealth {
  _restoreAttempted = true;
  const h = loadGapLedger();
  _restoredAtMs = nowMs;
  return h;
}

/* ══════════════════════════════════════════════════════════════════════════
   8) P0-VDK-F5F · AÇILIŞ ve ARAÇ KAPSAMI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * AÇILIŞ ADIMI — `SystemBoot` Wave 1'den, depo hazır olduktan HEMEN SONRA.
 *
 * ⚠️ HİÇBİR ŞEY YÜKLEMEZ ve bu bilinçlidir: açılışta araç kimliği HENÜZ
 * ölçülmemiştir (parmak izi ancak OBD bağlanıp ECU'lar yanıt verdikten sonra
 * kurulabilir). Global bir sicili "şimdilik" yüklemek, bir sonraki araca
 * başka bir aracın tanı geçmişini taşımak olurdu.
 *
 * Bu adımın işi ÖLÇÜM ÜRETMEKTİR: "geri yükleme denendi mi, ne zaman, hangi
 * kapsamda" soruları artık LAB'da `KAYNAK YOK` yerine gerçek bir cevap bulur.
 */
export function beginGapLedgerBoot(nowMs: number | null): GapLedgerScope {
  _bootAtMs = nowMs;
  _restoreAttempted = false;
  _scope = UNIDENTIFIED_SCOPE;
  _entries.clear();
  _restored = 0;
  _health = 'EMPTY';
  _loaded = true;              // yüklenecek bir şey YOK — bu bir ölçümdür
  return _scope;
}

export interface GapLedgerActivationInput
  extends Omit<GapLedgerScopeInput, 'traceMode'> {
  readonly nowMs: number | null;
  /** Verilmezse MEVCUT `canonicalTrace` replay modu okunur (tek otorite). */
  readonly traceMode?: TraceProvenance;
}

export interface GapLedgerActivation {
  readonly scope: GapLedgerScope;
  /** Bu çağrı aktif aracı DEĞİŞTİRDİ mi (araç takası). */
  readonly switched: boolean;
  /** Ayrılan önceki araç referansı; yoksa `null`. */
  readonly detachedRef: string | null;
  readonly health: StoreHealth;
  readonly restored: number;
}

/**
 * AKTİF ARACI BAĞLAR — kimlik ÖLÇÜLDÜKTEN sonra çağrılır (üretim yolu:
 * `productionDiscovery`, parmak izi kurulduktan hemen sonra, İLK yoklamadan
 * ÖNCE).
 *
 * Kapsam kararı SAF `resolveGapLedgerScope`tedir; burada kimlik ÜRETİLMEZ,
 * güç YENİDEN HESAPLANMAZ (F4-C tek otoritedir) ve replay modu MEVCUT
 * `canonicalTrace` anahtarından okunur.
 *
 * ⚠️ ARAÇ TAKASI: kimlik değişirse önce mevcut bölüm YAZILIR, sonra bellek
 * TAMAMEN boşaltılır ve yalnız yeni aracın bölümü yüklenir. İki aracın
 * kaydı hiçbir anda aynı haritada bulunmaz.
 *
 * ⚠️ OTURUM MÜHRÜ DEĞİL: aynı araca yeniden bağlanmak (yeni `sessionEpoch`)
 * aynı kapsamı üretir ve sicil OLDUĞU GİBİ kalır — yeniden yükleme bile YOK.
 */
export function activateGapLedgerVehicle(
  input: GapLedgerActivationInput,
): GapLedgerActivation {
  let next: GapLedgerScope;
  try {
    next = resolveGapLedgerScope({
      vehicleRef: input.vehicleRef,
      fingerprintReusable: input.fingerprintReusable,
      provenance: input.provenance,
      /* Çağıran söylemese bile MEVCUT replay otoritesi ikinci kapıdır. */
      traceMode: input.traceMode ?? getTraceProvenanceMode(),
    });
  } catch (e) {
    logError('OBD:GapLedgerScope', e);
    next = UNIDENTIFIED_SCOPE;
  }

  /* AYNI araç (reconnect / yeni epoch) → hiçbir şey yapma. */
  if (_loaded && isSameGapLedgerScope(_scope, next)) {
    return {
      scope: _scope, switched: false, detachedRef: null,
      health: _health, restored: _restored,
    };
  }

  const prevRef = _scope.vehicleRef;
  const hadVehicle = prevRef !== null || _entries.size > 0;

  /* ── AYIR: önceki bölümü yaz, sonra belleği TAMAMEN boşalt. ─────────── */
  /* ⚠️ YALNIZ yüklenmiş VE kirli bellek yazılır: boş belleği dolu bir bölümün
     üstüne yazmak sessiz veri kaybı, değişmemiş belleği yazmak ise gereksiz
     eMMC aşınması olurdu. */
  try { if (_loaded && _dirty && _scope.persistenceAllowed) {
    persistGapLedger(input.nowMs);
  } } catch (e) { logError('OBD:GapLedgerDetachPersist', e); }

  _entries.clear();
  _dropped = 0;
  _evicted = 0;
  _notPersisted = 0;
  for (const k of Object.keys(_reasonCounts)) delete _reasonCounts[k];
  _restored = 0;
  _savedAtMs = null;
  _lastSaveOk = null;
  _dirty = false;

  _scope = next;
  _loaded = false;
  if (hadVehicle && prevRef !== next.vehicleRef) {
    _switchCount++;
    _detachedRef = prevRef;
  }

  /* ── BAĞLA: yalnız YENİ aracın bölümü yüklenir. ─────────────────────── */
  _restoreAttempted = true;
  const health = loadGapLedger();
  _restoredAtMs = input.nowMs;

  return {
    scope: _scope,
    switched: hadVehicle && prevRef !== next.vehicleRef,
    detachedRef: _detachedRef,
    health,
    restored: _restored,
  };
}

export function getGapLedgerScope(): GapLedgerScope { return _scope; }
export function getGapLedgerSwitchCount(): number { return _switchCount; }
export function getGapLedgerDetachedRef(): string | null { return _detachedRef; }
export function getGapLedgerBootAt(): number | null { return _bootAtMs; }
export function getGapLedgerRestoreAttempted(): boolean { return _restoreAttempted; }
/** Kalıcılık kapısı yüzünden yapılmayan yazım adedi — sessiz engelleme YASAK. */
export function getGapLedgerBlockedWrites(): number { return _blockedWrites; }

/** @internal — testler arası izolasyon. */
export function _resetGapRegistryForTest(): void {
  _entries.clear();
  _dropped = 0;
  _evicted = 0;
  _notPersisted = 0;
  for (const k of Object.keys(_reasonCounts)) delete _reasonCounts[k];
  _health = 'EMPTY';
  _loaded = false;
  _restored = 0;
  _restoredAtMs = null;
  _savedAtMs = null;
  _lastSaveOk = null;
  _switchCount = 0;
  _detachedRef = null;
  _bootAtMs = null;
  _restoreAttempted = false;
  _blockedWrites = 0;
  _dirty = false;
  try {
    if (_scope.storageKey !== null) safeRemoveRaw(_scope.storageKey);
  } catch { /* test temizliği */ }
  _scope = UNIDENTIFIED_SCOPE;
}

/**
 * @internal — SÜREÇ durumunu sıfırlar ama KALICI depoya DOKUNMAZ.
 *
 * "Uygulama yeniden başladı" senaryosunun tek dürüst taklidi budur.
 */
export function _simulateRestartForTest(): void {
  _entries.clear();
  _dropped = 0;
  _evicted = 0;
  _notPersisted = 0;
  for (const k of Object.keys(_reasonCounts)) delete _reasonCounts[k];
  _health = 'EMPTY';
  _loaded = false;
  _restored = 0;
  _restoredAtMs = null;
  _lastSaveOk = null;
  _blockedWrites = 0;
  _dirty = false;
  /* ⚠️ `_scope` KORUNUR: yeniden başlatma aracı değiştirmez — aynı araç
     yeniden bağlandığında kendi bölümünü bulmalıdır. */
}

/** @internal — bozuk/uyumsuz depo yazıp fail-closed davranışı ölçmek için. */
export function _writeRawGapLedgerForTest(raw: string, key?: string): void {
  const target = key ?? _scope.storageKey;
  if (target === null) return;
  safeSetRaw(target, raw, undefined, true);
  _loaded = false;
}

/** @internal — testler arası: kapsamsız eski depoyu temizler. */
export function _clearLegacyUnscopedForTest(): void {
  try { safeRemoveRaw(LEGACY_UNSCOPED_GAP_LEDGER_KEY); } catch { /* yok say */ }
}
