/**
 * maviMemory.ts — **MAVİ F10 · HAFIZANIN TEK KANONİK CEPHESİ (facade).**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Denetim BEŞ paralel hafıza yığını ölçtü (bkz. `maviMemoryModel` başlığı) ve
 * hiçbiri diğerini bilmiyordu. F10 **altıncısını kurmaz**: bu dosya mevcut
 * otoritelerin ÜSTÜNDE tek giriş/çıkış kapısıdır.
 *
 *   · **LONG_TERM (EXPLICIT)** — burada sahiplenilir (`mavi_memory_v2`).
 *     Eski `companion_memory_v1` fact'leri ilk okumada **bir kez** içe aktarılır
 *     ve o andan sonra eski anahtar bir daha OKUNMAZ/YAZILMAZ. Aktarımda
 *     `sensitiveMemoryGuard` uygulanır → geçmişte sızmış hassas bir kayıt
 *     TAŞINMAZ (ölçülen kusur A'nın geriye dönük kapatılması).
 *   · **LONG_TERM (INFERRED)** — aynı depoda AYRI listede; explicit ile ASLA
 *     karışmaz, ayrı tavanı ve decay'i vardır.
 *   · **TRIP** — `tripMemory` (RAM, yolculuk anahtarlı).
 *   · **TURN** — `companionChatProvider._history`nin sahibidir; burada KOPYASI
 *     TUTULMAZ (ikinci konuşma deposu kurmak yasak). Bu cephe ona yalnız
 *     **temizleme portu** üzerinden dokunur (FORGET yolu).
 *   · **Araç-teknik hafıza** (`aiCore/vehicleMemory`) AYRI gizlilik sınıfıdır ve
 *     bu cepheye TAŞINMAZ — fingerprint anahtarlı, kişisel değil.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · **Hassas-veri kapısı HEM YAZMA HEM OKUMA yolunda.** F10 öncesi canlı yolda
 *    (REMEMBER → `addFact`, prompt → `buildMemoryPromptSection`) kapı **hiç
 *    yoktu**; kapı yalnız bayrağı KAPALI motorun üzerindeydi.
 *  · **Ham transkript kalıcı hafızaya YAZILMAZ.** Bu dosyada konuşma metnini
 *    depoya taşıyan hiçbir yol yoktur.
 *  · **LLM uzun dönem hafıza ÜRETEMEZ.** `rememberExplicit` yalnız kullanıcının
 *    AÇIK talebini (`REMEMBER` intent'i) taşır. `observeInferred` ayrı bir
 *    porttur ve **üretimde çağıranı YOKTUR** (açık borç — uydurma öğrenme yok).
 *  · **Silinen hafıza prompt'a DÖNMEZ:** FORGET hem depoyu hem TRIP kayıtlarını
 *    hem de konuşma geçmişini temizler ve **mühür** bırakır (aynı çıkarım 30 gün
 *    yeniden üretilemez).
 *  · **Depo düşerse "hatırladım" DENMEZ:** her yazma `persisted` bayrağı döner;
 *    çağıran dürüst cevabı ondan kurar.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../../utils/safeStorage';
import { guardMemoryText, type SensitiveReason } from '../ai/memory/sensitiveMemoryGuard';
import {
  MAVI_MEMORY_INFERRED_HALF_LIFE_MS,
  MAVI_MEMORY_MAX_EXPLICIT,
  MAVI_MEMORY_MAX_INFERRED,
  MAVI_MEMORY_MIN_EVIDENCE,
  MAVI_MEMORY_SCHEMA_VERSION,
  MAVI_MEMORY_SUPPRESSION_MS,
  classifyMemoryDomain,
  contentWords,
  contradicts,
  decayedConfidence,
  memoryRejectReason,
  normalizeMemoryValue,
  projectMemory,
  type MaviMemoryDomain,
  type MaviMemoryKind,
  type MaviMemoryProjection,
  type MaviMemoryRecord,
} from './maviMemoryModel';
import { forgetTripRecords, getTripRecords, currentTripKey } from './tripMemory';

/* ══════════════════════════════════════════════════════════════════════════
 * Depolama
 * ════════════════════════════════════════════════════════════════════════ */

export const MAVI_MEMORY_STORAGE_KEY = 'mavi_memory_v2';
/** Eski depo — YALNIZ bir kez, içe aktarma için OKUNUR. Asla yazılmaz. */
export const LEGACY_MEMORY_STORAGE_KEY = 'companion_memory_v1';

/** Mühür: bu normalize değer için çıkarım/otomatik kayıt geçici olarak YASAK. */
interface MemorySuppression {
  readonly key: string;
  readonly untilMs: number;
}

interface MemoryStoreShape {
  readonly version: number;
  readonly explicit: MaviMemoryRecord[];
  readonly inferred: MaviMemoryRecord[];
  readonly suppressions: MemorySuppression[];
  readonly legacyImported: boolean;
}

let _store: MemoryStoreShape | null = null;
/** Son kalıcılaştırma sonucu — "hatırladım" iddiası BUNA bağlıdır. */
let _lastPersistOk = true;

/* Bounded sayaçlar (PII YOK). */
const MAX_COUNTER = 1_000_000;
function _bump(v: number): number { return v >= MAX_COUNTER ? MAX_COUNTER : v + 1; }
let _explicitWrites = 0;
let _inferredWrites = 0;
let _rejectedSensitive = 0;
let _corrections = 0;
let _contradictionsMarked = 0;
let _forgets = 0;
let _forgottenRecords = 0;
let _historyPurges = 0;
let _projections = 0;
let _persistFailures = 0;
let _legacyImported = 0;
let _legacyRejected = 0;
let _schemaDropped = 0;

let _seq = 0;
function _newId(nowMs: number): string {
  _seq = (_seq + 1) % 100000;
  return `m${Math.trunc(nowMs).toString(36)}${_seq.toString(36)}`;
}

const EMPTY_STORE = (): MemoryStoreShape => ({
  version: MAVI_MEMORY_SCHEMA_VERSION,
  explicit: [], inferred: [], suppressions: [], legacyImported: false,
});

/* ══════════════════════════════════════════════════════════════════════════
 * Konuşma geçmişi temizleme portu (TURN scope — sahibi BU DOSYA DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Konuşma turlarından eşleşen içerikleri düşüren port. Sahibi
 * `companionChatProvider`dır (`_history`); bu cephe orada bir KOPYA tutmaz.
 * Bağlı değilse FORGET dürüstçe `historyPurged: false` döner —
 * "sildim" denmez.
 */
export type ConversationPurgePort = (normalizedNeedle: string) => number;

let _purgePort: ConversationPurgePort | null = null;

export function setConversationPurgePort(port: ConversationPurgePort | null): void {
  _purgePort = typeof port === 'function' ? port : null;
}

export function isConversationPurgeBound(): boolean {
  return _purgePort !== null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yükleme · kalıcılaştırma · eski depodan içe aktarma
 * ════════════════════════════════════════════════════════════════════════ */

function _validRecord(v: unknown): v is MaviMemoryRecord {
  const r = v as MaviMemoryRecord | null;
  return !!r && typeof r === 'object'
    && typeof r.id === 'string' && r.id.length > 0
    && typeof r.value === 'string' && r.value.length > 0
    && typeof r.schemaVersion === 'number'
    && (r.origin === 'EXPLICIT' || r.origin === 'INFERRED')
    && !!r.correction && typeof r.correction === 'object';
}

/** Şeması tanınmayan kayıt OKUNMAZ — sessizce yanlış yorumlanmasındansa DÜŞER. */
function _acceptRecords(raw: unknown): MaviMemoryRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: MaviMemoryRecord[] = [];
  for (const item of raw) {
    if (!_validRecord(item)) { _schemaDropped = _bump(_schemaDropped); continue; }
    if (item.schemaVersion !== MAVI_MEMORY_SCHEMA_VERSION) {
      _schemaDropped = _bump(_schemaDropped);
      continue;
    }
    out.push(Object.freeze({ ...item }));
  }
  return out;
}

/** Eski `companion_memory_v1` fact'lerini BİR KEZ içe aktarır (kapı uygulanır). */
function _importLegacy(nowMs: number): MaviMemoryRecord[] {
  const out: MaviMemoryRecord[] = [];
  try {
    const raw = safeGetRaw(LEGACY_MEMORY_STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Array<{ text?: unknown }>;
    if (!Array.isArray(parsed)) return out;
    for (const f of parsed) {
      const guard = guardMemoryText(f?.text);
      if (!guard.allowed) { _legacyRejected = _bump(_legacyRejected); continue; }
      out.push(_buildExplicit(guard.text, 'fact', 'legacy_import', 'legacy_v1', nowMs));
      _legacyImported = _bump(_legacyImported);
      if (out.length >= MAVI_MEMORY_MAX_EXPLICIT) break;
    }
  } catch { /* bozuk eski kayıt → içe aktarma YOK, fail-soft */ }
  return out;
}

function _load(nowMs: number): MemoryStoreShape {
  if (_store !== null) return _store;
  let store = EMPTY_STORE();
  try {
    const raw = safeGetRaw(MAVI_MEMORY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MemoryStoreShape>;
      if (parsed && typeof parsed === 'object') {
        store = {
          version: MAVI_MEMORY_SCHEMA_VERSION,
          explicit: _acceptRecords(parsed.explicit),
          inferred: _acceptRecords(parsed.inferred),
          suppressions: Array.isArray(parsed.suppressions)
            ? parsed.suppressions.filter(
              (s): s is MemorySuppression => !!s && typeof s.key === 'string'
                && typeof s.untilMs === 'number' && Number.isFinite(s.untilMs))
            : [],
          legacyImported: parsed.legacyImported === true,
        };
      }
    }
  } catch { store = EMPTY_STORE(); }   // bozuk depo → boş başla (fail-soft)

  if (!store.legacyImported) {
    const imported = _importLegacy(nowMs);
    store = { ...store, explicit: [...imported, ...store.explicit], legacyImported: true };
    _store = store;
    _persist();
    return store;
  }

  _store = store;
  return store;
}

/**
 * Depoya yazar ve **GERİ OKUYARAK DOĞRULAR.**
 *
 * ⚠️ Ölçülen gerçek: `safeStorage.safeSetRaw` `void` döner ve kota hatasını
 * KENDİ İÇİNDE yutar (`catch { /* quota *\/ }`) — yani "yazdım" iddiası tek
 * başına HİÇBİR ŞEY KANITLAMAZ. Bu yüzden yazım `immediate` yapılır (debounce
 * tamponunda beklemez; hafıza yazımı seyrektir, eMMC bütçesi etkilenmez) ve
 * hemen ardından `safeGetRaw` ile geri okunup karşılaştırılır.
 *
 * DÜRÜST SINIR: bu doğrulama WEB/jsdom yolunda gerçek bir dayanıklılık
 * kanıtıdır; NATIVE yolda `safeSetRaw` dosya yazımından ÖNCE `_fsCache`e
 * koyduğu için geri okuma önbellekten döner → orada kanıt ZAYIFTIR. Bu sınır
 * gizlenmez, LAB notunda ve kütükte yazılıdır.
 */
function _persist(): boolean {
  try {
    const payload = JSON.stringify(_store ?? EMPTY_STORE());
    safeSetRaw(MAVI_MEMORY_STORAGE_KEY, payload, 0, true);
    const readBack = safeGetRaw(MAVI_MEMORY_STORAGE_KEY);
    const ok = readBack === payload;
    _lastPersistOk = ok;
    if (!ok) _persistFailures = _bump(_persistFailures);
    return ok;                           // false → "hatırladım" DENMEZ
  } catch {
    _lastPersistOk = false;
    _persistFailures = _bump(_persistFailures);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kayıt kurucular
 * ════════════════════════════════════════════════════════════════════════ */

function _buildExplicit(
  value: string, kind: MaviMemoryKind,
  source: MaviMemoryRecord['source'], provenance: string, nowMs: number,
): MaviMemoryRecord {
  return Object.freeze({
    id: _newId(nowMs),
    schemaVersion: MAVI_MEMORY_SCHEMA_VERSION,
    scope: 'LONG_TERM' as const,
    kind,
    domain: classifyMemoryDomain(value),
    origin: 'EXPLICIT' as const,
    source,
    provenance,
    value,
    /* AÇIK beyan: güven 1 ve DECAY YOK. Kullanıcı söylediyse öyledir; zamanla
       "daha az doğru" olmaz — yalnız DÜZELTİLEBİLİR. */
    confidence: 1,
    evidenceCount: 1,
    createdAtMs: nowMs,
    lastConfirmedAtMs: nowMs,
    decayHalfLifeMs: null,
    expiresAtMs: null,
    correction: Object.freeze({ state: 'NONE' as const, atMs: null, supersededById: null }),
    privacyClass: 'SAFE' as const,
    tripKey: null,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * YAZMA — AÇIK beyan
 * ════════════════════════════════════════════════════════════════════════ */

export interface MemoryWriteResult {
  readonly stored: boolean;
  /** Bounded sonuç kodu — çağıran DÜRÜST cümleyi bundan kurar. */
  readonly outcome: 'stored' | 'duplicate' | 'rejected_sensitive' | 'empty' | 'not_persisted';
  /** Reddedildiyse gizlilik gerekçesi (bounded). */
  readonly privacyReason: SensitiveReason | null;
  readonly id: string | null;
  /** Kalıcı depoya GERÇEKTEN yazıldı mı. `false` → "hatırladım" DENMEZ. */
  readonly persisted: boolean;
  /** Bu kayıt mevcut bir kayıtla çelişiyor mu (kör silme YOK, işaretlenir). */
  readonly contradicts: boolean;
}

/**
 * Kullanıcının **AÇIKÇA** hatırlanmasını istediği kısa ifadeyi kalıcılaştırır.
 *
 * Sıra: hassas-veri kapısı → mühür kaldırma (kullanıcı fikrini değiştirebilir)
 * → dedup → çelişki işaretleme → bütçe → kalıcılaştırma.
 */
export function rememberExplicit(
  rawText: string,
  nowMs: number,
  kind: MaviMemoryKind = 'fact',
): MemoryWriteResult {
  const fail = (
    outcome: MemoryWriteResult['outcome'], privacyReason: SensitiveReason | null = null,
  ): MemoryWriteResult => Object.freeze({
    stored: false, outcome, privacyReason, id: null, persisted: false, contradicts: false,
  });

  try {
    const guard = guardMemoryText(rawText);
    if (!guard.allowed) {
      if (guard.reason === 'empty') return fail('empty', null);
      _rejectedSensitive = _bump(_rejectedSensitive);
      return fail('rejected_sensitive', guard.reason);
    }

    const store = _load(nowMs);
    const norm = normalizeMemoryValue(guard.text);

    /* AÇIK beyan mührü KALDIRIR: "bunu unut" demiş olsa bile kullanıcı aynı şeyi
       yeniden söylüyorsa fikrini değiştirmiştir. Mühür yalnız ÇIKARIMI durdurur. */
    const suppressions = store.suppressions.filter((s) => s.key !== norm);

    const existing = store.explicit.find((r) => normalizeMemoryValue(r.value) === norm);
    if (existing) {
      const refreshed = Object.freeze({
        ...existing,
        lastConfirmedAtMs: nowMs,
        evidenceCount: existing.evidenceCount + 1,
        /* Yeniden beyan bir DÜZELTMEYİ geri alır. */
        correction: Object.freeze({ state: 'NONE' as const, atMs: null, supersededById: null }),
      });
      _store = {
        ...store, suppressions,
        explicit: store.explicit.map((r) => (r.id === existing.id ? refreshed : r)),
      };
      const ok = _persist();
      return Object.freeze({
        stored: true, outcome: 'duplicate' as const, privacyReason: null,
        id: existing.id, persisted: ok, contradicts: false,
      });
    }

    const record = _buildExplicit(guard.text, kind, 'user_statement', 'remember_intent', nowMs);

    /* ÇELİŞKİ: eski kayıt SİLİNMEZ — `CONTRADICTED` işaretlenir ve projeksiyonda
       görünür kalır. Hangisinin geçerli olduğunu Mavi KULLANICIYA SORAR. */
    let conflicted = false;
    const marked = store.explicit.map((r) => {
      if (!contradicts(r, record)) return r;
      conflicted = true;
      _contradictionsMarked = _bump(_contradictionsMarked);
      return Object.freeze({
        ...r,
        correction: Object.freeze({
          state: 'CONTRADICTED' as const, atMs: nowMs, supersededById: record.id,
        }),
      });
    });

    let explicit = [...marked, record];
    if (explicit.length > MAVI_MEMORY_MAX_EXPLICIT) {
      explicit = explicit.slice(-MAVI_MEMORY_MAX_EXPLICIT);   // en eski düşer
    }

    _store = { ...store, explicit, suppressions };
    const ok = _persist();
    _explicitWrites = _bump(_explicitWrites);
    return Object.freeze({
      stored: true,
      outcome: (ok ? 'stored' : 'not_persisted') as MemoryWriteResult['outcome'],
      privacyReason: null, id: record.id, persisted: ok, contradicts: conflicted,
    });
  } catch {
    return fail('not_persisted', null);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * YAZMA — ÇIKARIM (kanıta dayalı) · **üretimde çağıranı YOKTUR**
 * ════════════════════════════════════════════════════════════════════════ */

export interface InferredObservation {
  /** Çıkarılan tercih ifadesi (kısa, PII'siz). */
  readonly value: string;
  readonly domain?: MaviMemoryDomain;
  /** Gözlemin makine-okur kaynağı — serbest metin DEĞİL. */
  readonly provenance: string;
}

export interface InferredWriteResult {
  readonly accepted: boolean;
  readonly outcome:
    | 'observed'            // kanıt sayıldı ama HENÜZ eşiğin altında (kalıcı DEĞİL)
    | 'promoted'            // eşik aşıldı → projeksiyona girebilir
    | 'suppressed'          // düzeltilmiş/unutulmuş — 30 gün yeniden üretilemez
    | 'rejected_sensitive'
    | 'empty';
  readonly evidenceCount: number;
  readonly confidence: number;
}

/**
 * Davranıştan çıkarılmış bir tercihi GÖZLEM olarak kaydeder.
 *
 * **Tek gözlem bir tercih DEĞİLDİR:** kayıt `MAVI_MEMORY_MIN_EVIDENCE` kanıta
 * ulaşana kadar projeksiyona GİREMEZ (`insufficient_evidence`). Güven kanıttan
 * TÜRETİLİR ve zamanla DECAY olur.
 *
 * ⚠️ **Bu portun üretimde çağıranı YOKTUR.** Denetim ölçtü: repoda bir tercihi
 * davranıştan çıkaracak güvenilir, gizlilik-temiz bir üretim sinyali bulunmuyor.
 * Olmayan sinyalden öğrenme UYDURULMADI — bu bir açık borçtur, sahte özellik
 * değil. LLM bu porta ERİŞEMEZ (yapısal kilit: çağıran zinciri testte kilitli).
 */
export function observeInferred(obs: InferredObservation, nowMs: number): InferredWriteResult {
  const fail = (outcome: InferredWriteResult['outcome']): InferredWriteResult =>
    Object.freeze({ accepted: false, outcome, evidenceCount: 0, confidence: 0 });

  try {
    const guard = guardMemoryText(obs?.value);
    if (!guard.allowed) {
      if (guard.reason === 'empty') return fail('empty');
      _rejectedSensitive = _bump(_rejectedSensitive);
      return fail('rejected_sensitive');
    }

    const store = _load(nowMs);
    const norm = normalizeMemoryValue(guard.text);

    /* Düzeltilmiş/unutulmuş çıkarım 30 gün boyunca YENİDEN ÜRETİLEMEZ. */
    const seal = store.suppressions.find((s) => s.key === norm);
    if (seal && nowMs < seal.untilMs) return fail('suppressed');

    const existing = store.inferred.find((r) => normalizeMemoryValue(r.value) === norm);
    const evidenceCount = (existing?.evidenceCount ?? 0) + 1;
    /* Güven KANITTAN türetilir ve 1'e ULAŞMAZ (zero-trust — `vehicleMemory`
       pekiştirme felsefesiyle aynı hat). */
    const confidence = Math.min(0.9, evidenceCount / (evidenceCount + 2));

    const record: MaviMemoryRecord = Object.freeze({
      id: existing?.id ?? _newId(nowMs),
      schemaVersion: MAVI_MEMORY_SCHEMA_VERSION,
      scope: 'LONG_TERM' as const,
      kind: 'preference' as const,
      domain: obs.domain ?? classifyMemoryDomain(guard.text),
      origin: 'INFERRED' as const,
      source: 'observed_behavior' as const,
      provenance: typeof obs.provenance === 'string' && obs.provenance
        ? obs.provenance.slice(0, 48) : 'unknown',
      value: guard.text,
      confidence,
      evidenceCount,
      createdAtMs: existing?.createdAtMs ?? nowMs,
      lastConfirmedAtMs: nowMs,
      decayHalfLifeMs: MAVI_MEMORY_INFERRED_HALF_LIFE_MS,
      expiresAtMs: null,
      correction: Object.freeze({ state: 'NONE' as const, atMs: null, supersededById: null }),
      privacyClass: 'SAFE' as const,
      tripKey: null,
    });

    let inferred = existing
      ? store.inferred.map((r) => (r.id === existing.id ? record : r))
      : [...store.inferred, record];
    if (inferred.length > MAVI_MEMORY_MAX_INFERRED) {
      inferred = inferred.slice(-MAVI_MEMORY_MAX_INFERRED);
    }

    _store = { ...store, inferred };
    _persist();
    _inferredWrites = _bump(_inferredWrites);
    return Object.freeze({
      accepted: true,
      outcome: (evidenceCount >= MAVI_MEMORY_MIN_EVIDENCE ? 'promoted' : 'observed') as
        InferredWriteResult['outcome'],
      evidenceCount, confidence,
    });
  } catch {
    return fail('empty');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * DÜZELTME
 * ════════════════════════════════════════════════════════════════════════ */

export interface CorrectionResult {
  readonly corrected: number;
  readonly persisted: boolean;
}

/**
 * Kullanıcı bir çıkarımı/beyanı DÜZELTTİ.
 *
 * Kural (spec §14.2/3): güven **0'a iner**, `CORRECTED` işaretlenir ve aynı
 * çıkarım **30 gün** yeniden üretilemez. Kayıt SİLİNMEZ — düzeltmenin kendisi
 * bir bilgidir ve LAB'da görünür kalır.
 */
export function correctMemory(query: string, nowMs: number): CorrectionResult {
  try {
    const store = _load(nowMs);
    const needle = normalizeMemoryValue(query);
    if (!needle) return Object.freeze({ corrected: 0, persisted: _lastPersistOk });

    let count = 0;
    const apply = (list: readonly MaviMemoryRecord[]): MaviMemoryRecord[] =>
      list.map((r) => {
        if (!_matches(r, needle)) return r;
        count++;
        return Object.freeze({
          ...r,
          confidence: 0,
          correction: Object.freeze({
            state: 'CORRECTED' as const, atMs: nowMs, supersededById: null,
          }),
        });
      });

    const suppressions = [...store.suppressions];
    const seal = (list: readonly MaviMemoryRecord[]): void => {
      for (const r of list) {
        if (!_matches(r, needle)) continue;
        const key = normalizeMemoryValue(r.value);
        if (!suppressions.some((s) => s.key === key)) {
          suppressions.push({ key, untilMs: nowMs + MAVI_MEMORY_SUPPRESSION_MS });
        }
      }
    };
    seal(store.explicit); seal(store.inferred);

    _store = {
      ...store,
      explicit: apply(store.explicit),
      inferred: apply(store.inferred),
      suppressions,
    };
    if (count > 0) _corrections = _bump(_corrections);
    return Object.freeze({ corrected: count, persisted: _persist() });
  } catch {
    return Object.freeze({ corrected: 0, persisted: false });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * UNUTMA (FORGET) — gerçekten siler
 * ════════════════════════════════════════════════════════════════════════ */

/** Bulanık eşleşme: tam içerme ya da en az bir ortak anlam kelimesi. */
function _matches(record: MaviMemoryRecord, needle: string): boolean {
  const value = normalizeMemoryValue(record.value);
  if (!needle || !value) return false;
  if (value.includes(needle) || needle.includes(value)) return true;
  const words = new Set(contentWords(needle));
  if (words.size === 0) return false;
  return contentWords(value).some((w) => words.has(w));
}

export interface ForgetResult {
  /** Silinen kalıcı kayıt adedi. */
  readonly removed: number;
  /** Silinen yolculuk kaydı adedi. */
  readonly tripRemoved: number;
  /** Konuşma geçmişinden düşürülen tur adedi. */
  readonly historyRemoved: number;
  /** Geçmiş temizleme portu bağlı MIYDI — bağlı değilse "sildim" DENMEZ. */
  readonly historyPurged: boolean;
  /** Depoya GERÇEKTEN yazıldı mı. */
  readonly persisted: boolean;
  readonly all: boolean;
}

const FORGET_ALL_RE = /\b(hepsi|hepsini|her ?şey|her ?şeyi|tümü|tümünü|tamamını|tamamı)\b/;

/**
 * Kullanıcının unutma talebini uygular.
 *
 * **Silinen hafıza prompt'a DÖNMEZ:** kalıcı kayıt, yolculuk kaydı VE konuşma
 * geçmişindeki ilgili turlar birlikte temizlenir; ayrıca 30 günlük **mühür**
 * bırakılır → aynı ifade ÇIKARIMLA geri gelemez (açık beyanla gelebilir).
 */
export function forgetMemory(query: string, nowMs: number): ForgetResult {
  try {
    const store = _load(nowMs);
    const needle = normalizeMemoryValue(query);
    if (!needle) {
      return Object.freeze({
        removed: 0, tripRemoved: 0, historyRemoved: 0,
        historyPurged: _purgePort !== null, persisted: _lastPersistOk, all: false,
      });
    }

    _forgets = _bump(_forgets);
    const all = FORGET_ALL_RE.test(needle);

    const doomed = all
      ? [...store.explicit, ...store.inferred]
      : [...store.explicit, ...store.inferred].filter((r) => _matches(r, needle));

    const suppressions = [...store.suppressions];
    for (const r of doomed) {
      const key = normalizeMemoryValue(r.value);
      if (!suppressions.some((s) => s.key === key)) {
        suppressions.push({ key, untilMs: nowMs + MAVI_MEMORY_SUPPRESSION_MS });
      }
    }

    const doomedIds = new Set(doomed.map((r) => r.id));
    _store = {
      ...store,
      explicit: store.explicit.filter((r) => !doomedIds.has(r.id)),
      inferred: store.inferred.filter((r) => !doomedIds.has(r.id)),
      suppressions,
    };
    const persisted = _persist();
    _forgottenRecords = Math.min(MAX_COUNTER, _forgottenRecords + doomed.length);

    const tripRemoved = forgetTripRecords((r) => all || _matches(r, needle));

    let historyRemoved = 0;
    if (_purgePort) {
      try {
        historyRemoved = _purgePort(all ? '' : needle) || 0;
        _historyPurges = _bump(_historyPurges);
      } catch { historyRemoved = 0; }
    }

    return Object.freeze({
      removed: doomed.length, tripRemoved, historyRemoved,
      historyPurged: _purgePort !== null, persisted, all,
    });
  } catch {
    return Object.freeze({
      removed: 0, tripRemoved: 0, historyRemoved: 0,
      historyPurged: false, persisted: false, all: false,
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * OKUMA — bağlama göre DARALTILMIŞ projeksiyon
 * ════════════════════════════════════════════════════════════════════════ */

/** Tüm kanonik kayıtlar (LONG_TERM + aktif TRIP). Okuma yolunda kapı UYGULANIR. */
function _allRecords(nowMs: number): MaviMemoryRecord[] {
  const store = _load(nowMs);
  const out: MaviMemoryRecord[] = [];
  /* OKUMA YOLU KAPISI: geçmişte (eski sürümde ya da bozuk kayıtla) sızmış bir
     değer sonradan AI'ya TAŞINMAZ — kapı yazma tarafına GÜVENMEZ. */
  const push = (list: readonly MaviMemoryRecord[]): void => {
    for (const r of list) {
      const guard = guardMemoryText(r.value);
      if (!guard.allowed) { _rejectedSensitive = _bump(_rejectedSensitive); continue; }
      out.push(r);
    }
  };
  push(store.explicit);
  push(store.inferred);
  try { push(getTripRecords()); } catch { /* yolculuk yoksa boş */ }
  return out;
}

/**
 * Prompt'a girecek BOUNDED izdüşüm.
 *
 * **Her turda tüm hafıza dökülmez:** alan süzgeci + kayıt tavanı + karakter
 * tavanı uygulanır. Sonuç `source` · `confidence` · `scope` bilgisiyle taşınır.
 */
export function projectMaviMemory(domain: MaviMemoryDomain, nowMs: number): MaviMemoryProjection {
  try {
    _projections = _bump(_projections);
    return projectMemory({
      records: _allRecords(nowMs),
      domain,
      nowMs,
      tripKey: currentTripKey(),
    });
  } catch {
    return projectMemory({ records: [], domain, nowMs, tripKey: null });
  }
}

/**
 * Serbest metinden bağlam alanını çıkarır — projeksiyonu daraltmak için.
 * Eşleşme yoksa `general` (süzgeç YOK, bilgi kaybı YOK).
 */
export function inferPromptDomain(text: string): MaviMemoryDomain {
  return classifyMemoryDomain(text);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded tanı — CAROS LAB · **METİN TAŞINMAZ**
 * ════════════════════════════════════════════════════════════════════════ */

export interface MaviMemoryDiagnostics {
  readonly explicitCount: number;
  readonly inferredCount: number;
  /** Kanıt eşiğini AŞMIŞ (projeksiyona girebilen) çıkarım adedi. */
  readonly inferredPromoted: number;
  readonly correctedCount: number;
  readonly contradictedCount: number;
  readonly suppressionCount: number;
  readonly explicitWrites: number;
  readonly inferredWrites: number;
  readonly rejectedSensitive: number;
  readonly corrections: number;
  readonly contradictionsMarked: number;
  readonly forgets: number;
  readonly forgottenRecords: number;
  readonly historyPurges: number;
  readonly projections: number;
  readonly persistFailures: number;
  readonly lastPersistOk: boolean;
  readonly legacyImported: number;
  readonly legacyRejected: number;
  readonly schemaDropped: number;
  readonly conversationPurgeBound: boolean;
  /**
   * Üretimde çıkarım ÜRETEN bir kaynak var mı. Bugün **hayır** — port açık ama
   * çağıranı yok (açık borç). Sahte "öğreniyor" iddiası ÜRETİLMEZ.
   */
  readonly inferredProducerWired: false;
}

export function getMaviMemoryDiagnostics(nowMs = 0): MaviMemoryDiagnostics {
  let explicit: readonly MaviMemoryRecord[] = [];
  let inferred: readonly MaviMemoryRecord[] = [];
  let suppressions = 0;
  try {
    const store = _load(nowMs);
    explicit = store.explicit; inferred = store.inferred;
    suppressions = store.suppressions.filter((s) => nowMs < s.untilMs).length;
  } catch { /* fail-soft */ }

  const all = [...explicit, ...inferred];
  return Object.freeze({
    explicitCount: explicit.length,
    inferredCount: inferred.length,
    inferredPromoted: inferred.filter((r) => memoryRejectReason(r, nowMs) === null).length,
    correctedCount: all.filter((r) => r.correction.state === 'CORRECTED').length,
    contradictedCount: all.filter((r) => r.correction.state === 'CONTRADICTED').length,
    suppressionCount: suppressions,
    explicitWrites: _explicitWrites,
    inferredWrites: _inferredWrites,
    rejectedSensitive: _rejectedSensitive,
    corrections: _corrections,
    contradictionsMarked: _contradictionsMarked,
    forgets: _forgets,
    forgottenRecords: _forgottenRecords,
    historyPurges: _historyPurges,
    projections: _projections,
    persistFailures: _persistFailures,
    lastPersistOk: _lastPersistOk,
    legacyImported: _legacyImported,
    legacyRejected: _legacyRejected,
    schemaDropped: _schemaDropped,
    conversationPurgeBound: _purgePort !== null,
    inferredProducerWired: false as const,
  });
}

/**
 * `memoryEngine` / LAB için AÇIK tercihlerin düz metin listesi.
 * **Tek gerçeklik kaynağı budur** — `companionMemory.getFacts()` artık üretim
 * okuma yolunda KULLANILMAZ (yalnız bir kerelik içe aktarma kaynağıydı).
 */
export function readExplicitPreferenceTexts(nowMs = 0): readonly string[] {
  try {
    return _load(nowMs).explicit
      .filter((r) => memoryRejectReason(r, nowMs) === null)
      .map((r) => r.value);
  } catch { return []; }
}

/** Çıkarımların düz metin listesi — AÇIK listeyle ASLA birleştirilmez. */
export function readInferredPreferenceTexts(nowMs = 0): readonly string[] {
  try {
    return _load(nowMs).inferred
      .filter((r) => memoryRejectReason(r, nowMs) === null)
      .map((r) => `${r.value} (çıkarım, güven ${decayedConfidence(r, nowMs).toFixed(2)})`);
  } catch { return []; }
}

/** @internal — testler arası izolasyon. */
export function _resetMaviMemoryForTest(): void {
  try { safeRemoveRaw(MAVI_MEMORY_STORAGE_KEY); } catch { /* jsdom */ }
  _store = null;
  _purgePort = null;
  _lastPersistOk = true;
  _explicitWrites = 0; _inferredWrites = 0; _rejectedSensitive = 0;
  _corrections = 0; _contradictionsMarked = 0; _forgets = 0; _forgottenRecords = 0;
  _historyPurges = 0; _projections = 0; _persistFailures = 0;
  _legacyImported = 0; _legacyRejected = 0; _schemaDropped = 0;
  _seq = 0;
}
