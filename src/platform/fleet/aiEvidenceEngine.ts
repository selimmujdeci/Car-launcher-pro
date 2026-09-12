/**
 * aiEvidenceEngine.ts — KANIT BİRLEŞTİRME · SÜRE · DEĞİŞMEZLİK · ZİNCİR · KAPSAM (SAF).
 *
 * ── NE YAPAR ───────────────────────────────────────────────────────────
 * Kanıt kaydeder (aynı kanıtı BİRLEŞTİRİR), süresi dolanı `EXPIRED` yapar
 * (silmez), değişmezliği korur, kanıt zincirini kurar ve kapsamı ölçer.
 *
 * ── NE YAPMAZ (BAĞLAYICI) ──────────────────────────────────────────────
 * · **LLM ÇAĞIRMAZ**, cevap üretmez, cümle kurmaz, öneri vermez.
 * · Güveni DIŞARIDAN ALMAZ — daima `deriveEvidenceConfidence` ile türetir.
 * · Driver DNA · Fleet Intelligence · Trip Engine · Deep Scan katmanlarını
 *   ÇAĞIRMAZ ve DEĞİŞTİRMEZ; onların ÇIKTISI çağıran tarafından kanıt
 *   olarak SUNULUR.
 * · Kanıt SİLMEZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

import {
  EVIDENCE_DEFAULT_TTL_MS, EVIDENCE_VERSION,
  canActivate, chainKey, deriveEvidenceConfidence, evidenceKey,
  expectedCategoriesFor, isEvidenceValid,
  type AiEvidence, type CoverageScope, type EvidenceCategory,
  type EvidenceChainLink, type EvidenceConfidence, type EvidenceConsumer,
  type EvidenceCoverage, type EvidenceProvenance, type EvidenceSeverity,
  type EvidenceSource,
} from './aiEvidence';

/* ── Kanıt girdisi ─────────────────────────────────────────────────────── */

/**
 * Kanıt SUNMA girdisi.
 *
 * ⚠️ `confidence` alanı **YOKTUR** ve bu bilinçlidir: güven bir girdi
 * değildir. Çağıran güvenini yazamaz; motor onu kaynak · ölçüm kalitesi ·
 * örnek sayısından TÜRETİR (sözleşme kuralı 2).
 */
export interface EvidenceInput {
  readonly companyId: string;
  readonly vehicleId?: string | null;
  readonly driverId?: string | null;
  readonly tripId?: string | null;
  readonly source: EvidenceSource;
  readonly category: EvidenceCategory;
  readonly severity: EvidenceSeverity;
  readonly provenance: EvidenceProvenance;
  readonly metric: string;
  readonly value: number | null;
  readonly sampleCount: number;
  readonly observedAt: number;
  readonly ttlMs?: number;
}

/** Kanıt defteri — kimlik başına TEK kayıt (birleştirme). */
export interface EvidenceLedger {
  readonly entries: readonly AiEvidence[];
  /** Adaptör durumları (sunucudan okunur; head unit ÜRETMEZ). */
  readonly adapters?: readonly AdapterState[];
  /** Birleştirme ile yutulan tekrar sayısı (yeni kayıt AÇILMADI). */
  readonly mergeCount: number;
  /** Kapıya takılan ve `REJECTED` yazılan kanıt sayısı. */
  readonly rejectedCount: number;
  readonly chain: readonly EvidenceChainLink[];
}

export const EMPTY_EVIDENCE_LEDGER: EvidenceLedger = Object.freeze({
  entries: Object.freeze([]) as readonly AiEvidence[],
  mergeCount: 0, rejectedCount: 0,
  chain: Object.freeze([]) as readonly EvidenceChainLink[],
});

/** Defter tavanı — sınırsız büyüyen dizi bellek sızıntısıdır. */
export const EVIDENCE_LEDGER_MAX = 2000;

function makeId(input: EvidenceInput): string {
  /* Kimlik = birleştirme anahtarı: aynı kanıt aynı id'yi alır (deterministik). */
  return evidenceKey({
    companyId: input.companyId, source: input.source, category: input.category,
    metric: input.metric,
    vehicleId: input.vehicleId ?? null,
    driverId: input.driverId ?? null,
    tripId: input.tripId ?? null,
  });
}

/**
 * Kanıt sunar — **BİRLEŞTİRİR, çoğaltmaz**.
 *
 * ── SIRA ────────────────────────────────────────────────────────────────
 *  1. Güven TÜRETİLİR (çağıranın iddiası dikkate ALINMAZ).
 *  2. Kapılar: kaynaksız · öznesiz · ölçümsüz · güvensiz kanıt `REJECTED`.
 *  3. Aynı kimlikte kanıt varsa **TAZELENİR**: `refreshCount` artar,
 *     `createdAt` **DEĞİŞMEZ**, süre uzar, güven yeniden türetilir.
 *  4. Yoksa yeni `ACTIVE` kanıt açılır.
 */
export function recordEvidence(
  ledger: EvidenceLedger, input: EvidenceInput,
): EvidenceLedger {
  const id = makeId(input);
  const ttl = input.ttlMs ?? EVIDENCE_DEFAULT_TTL_MS;
  const confidence = deriveEvidenceConfidence({
    source: input.source, provenance: input.provenance,
    sampleCount: input.sampleCount,
  });

  const candidate: AiEvidence = {
    id,
    companyId: input.companyId,
    vehicleId: input.vehicleId ?? null,
    driverId: input.driverId ?? null,
    tripId: input.tripId ?? null,
    source: input.source,
    category: input.category,
    severity: input.severity,
    confidence,
    provenance: input.provenance,
    metric: input.metric,
    value: input.value,
    sampleCount: input.sampleCount,
    createdAt: input.observedAt,
    lastSeenAt: input.observedAt,
    expiresAt: input.observedAt + ttl,
    state: 'ACTIVE',
    refreshCount: 0,
    evidenceVersion: EVIDENCE_VERSION,
    rejectReason: null,
  };

  const gate = canActivate(candidate);
  const existingIdx = ledger.entries.findIndex((e) => e.id === id);

  if (!gate.ok) {
    /* REDDEDİLEN kanıt da KAYDEDİLİR: neden reddedildiği görünmezse
       "kanıt üretmeyen modül" ile "kanıtı reddedilen modül" ayırt edilemez. */
    const rejected: AiEvidence = {
      ...candidate, state: 'REJECTED', rejectReason: gate.reason,
    };
    if (existingIdx >= 0) {
      /* Mevcut geçerli kanıt REDDEDİLMİŞ bir tekrarla BOZULMAZ. */
      return { ...ledger, rejectedCount: ledger.rejectedCount + 1 };
    }
    return {
      ...ledger,
      entries: bounded([...ledger.entries, rejected]),
      rejectedCount: ledger.rejectedCount + 1,
    };
  }

  if (existingIdx >= 0) {
    const prev = ledger.entries[existingIdx]!;
    /* Değişmezlik: `createdAt`, `source`, `category`, özneler KORUNUR. */
    const merged: AiEvidence = {
      ...prev,
      severity: input.severity,
      provenance: input.provenance,
      value: input.value,
      sampleCount: Math.max(prev.sampleCount, input.sampleCount),
      confidence: deriveEvidenceConfidence({
        source: prev.source, provenance: input.provenance,
        sampleCount: Math.max(prev.sampleCount, input.sampleCount),
      }),
      lastSeenAt: Math.max(prev.lastSeenAt, input.observedAt),
      expiresAt: Math.max(prev.expiresAt, input.observedAt + ttl),
      /* Süresi dolmuş kanıt yeni gözlemle YENİDEN canlanır — ama ilk
         görülme anı ve kimliği aynı kalır (geçmiş silinmez). */
      state: 'ACTIVE',
      refreshCount: prev.refreshCount + 1,
      rejectReason: null,
    };
    const next = [...ledger.entries];
    next[existingIdx] = merged;
    return { ...ledger, entries: next, mergeCount: ledger.mergeCount + 1 };
  }

  return { ...ledger, entries: bounded([...ledger.entries, candidate]) };
}

function bounded(entries: readonly AiEvidence[]): readonly AiEvidence[] {
  return entries.length <= EVIDENCE_LEDGER_MAX
    ? entries : entries.slice(entries.length - EVIDENCE_LEDGER_MAX);
}

/* ── Süre dolumu ───────────────────────────────────────────────────────── */

/**
 * Süresi dolan kanıtları `EXPIRED` yapar — **SİLMEZ** ve **İDEMPOTENTTİR**.
 *
 * Geçmiş bir iddianın dayanağı yok edilirse o iddia açıklanamaz hâle gelir;
 * bu yüzden kanıt hiçbir koşulda silinmez.
 */
export function expireEvidence(ledger: EvidenceLedger, nowMs: number): EvidenceLedger {
  let changed = false;
  const entries = ledger.entries.map((e) => {
    if (e.state !== 'ACTIVE' || nowMs < e.expiresAt) return e;
    changed = true;
    return { ...e, state: 'EXPIRED' as const };
  });
  return changed ? { ...ledger, entries } : ledger;
}

/* ── Değişmezlik ───────────────────────────────────────────────────────── */

/** Değişmez alanlar — hiçbir koşulda güncellenemez. */
export const IMMUTABLE_EVIDENCE_FIELDS = Object.freeze([
  'id', 'companyId', 'vehicleId', 'driverId', 'tripId',
  'source', 'category', 'metric', 'createdAt', 'evidenceVersion',
] as const);

/**
 * Bir güncellemenin değişmezliği ihlal edip etmediğini SÖYLER.
 *
 * ⚠️ Ayrıca **kaynak modül kilidi**: bir kanıt yalnız onu ÜRETEN modül
 * tarafından tazelenebilir. Başka bir modülün başkasının kanıtını
 * değiştirmesi, kanıt zincirini anlamsız yapardı.
 */
export function validateEvidenceMutation(
  prev: AiEvidence, next: AiEvidence, bySource: EvidenceSource,
): { ok: true } | { ok: false; reason: 'IMMUTABLE_VIOLATION' | 'FOREIGN_SOURCE' } {
  if (bySource !== prev.source) return { ok: false, reason: 'FOREIGN_SOURCE' };
  for (const f of IMMUTABLE_EVIDENCE_FIELDS) {
    if (prev[f] !== next[f]) return { ok: false, reason: 'IMMUTABLE_VIOLATION' };
  }
  return { ok: true };
}

/* ── Kanıt zinciri ─────────────────────────────────────────────────────── */

/**
 * Bir çıktıyı kanıta bağlar (SAF · İDEMPOTENT).
 *
 * Aynı bağ iki kez yazılmaz. **Var olmayan kanıta bağ kurulamaz**: bağ
 * kurulabiliyorsa kanıt gerçekten vardır — zincirin anlamı budur.
 */
export function linkEvidence(
  ledger: EvidenceLedger, link: EvidenceChainLink,
): EvidenceLedger {
  if (!ledger.entries.some((e) => e.id === link.evidenceId)) return ledger;
  const key = chainKey(link);
  if (ledger.chain.some((l) => chainKey(l) === key)) return ledger;
  return { ...ledger, chain: [...ledger.chain, link] };
}

/** Bir çıktının dayandığı kanıtlar — "tek tıkla kanıt zinciri". */
export function evidenceChainFor(
  ledger: EvidenceLedger, consumer: EvidenceConsumer, consumerId: string,
): readonly AiEvidence[] {
  const ids = new Set(
    ledger.chain.filter((l) => l.consumer === consumer && l.consumerId === consumerId)
      .map((l) => l.evidenceId));
  return ledger.entries.filter((e) => ids.has(e.id));
}

/** Bir kanıtın beslediği çıktılar — ters yön (etki analizi). */
export function consumersOfEvidence(
  ledger: EvidenceLedger, evidenceId: string,
): readonly EvidenceChainLink[] {
  return ledger.chain.filter((l) => l.evidenceId === evidenceId);
}

/* ── Kapsam ────────────────────────────────────────────────────────────── */

function subjectIdOf(e: AiEvidence, scope: CoverageScope): string | null {
  switch (scope) {
    case 'COMPANY': return e.companyId;
    case 'VEHICLE': return e.vehicleId;
    case 'DRIVER':  return e.driverId;
    case 'TRIP':    return e.tripId;
  }
}

/**
 * Bir özne için kanıt kapsamı.
 *
 * **Eksik veri UNKNOWN'dır:** hiç aktif kanıt yoksa `ratio` `null` döner ve
 * güven `UNKNOWN` olur — `0` yazmak "kapsam sıfır ölçüldü" demek olurdu,
 * oysa gerçek "hiç bakmadık"tır. Eksik kategoriler tek tek listelenir.
 */
export function computeEvidenceCoverage(
  ledger: EvidenceLedger, scope: CoverageScope, subjectId: string, nowMs: number,
): EvidenceCoverage {
  const expected = expectedCategoriesFor(scope);
  const mine = ledger.entries.filter((e) => subjectIdOf(e, scope) === subjectId);
  const active = mine.filter((e) => isEvidenceValid(e, nowMs));
  const expired = mine.filter((e) => e.state === 'EXPIRED'
    || (e.state === 'ACTIVE' && nowMs >= e.expiresAt));

  const present: EvidenceCategory[] = [];
  for (const c of expected) {
    if (active.some((e) => e.category === c)) present.push(c);
  }
  const missing = expected.filter((c) => !present.includes(c));

  const ratio = active.length === 0 || expected.length === 0
    ? null : present.length / expected.length;

  /* Kapsam güveni de TÜRETİLİR: kanıtların en zayıf halkası kapsamı da bağlar. */
  let confidence: EvidenceConfidence = 'UNKNOWN';
  if (ratio !== null) {
    confidence = active.reduce<EvidenceConfidence>(
      (acc, e) => (acc === 'UNKNOWN' ? e.confidence
        : weakest(acc, e.confidence)), 'UNKNOWN');
    if (ratio < 0.5) confidence = weakest(confidence, 'LOW');
    else if (ratio < 0.8) confidence = weakest(confidence, 'MEDIUM');
  }

  return {
    scope, subjectId,
    expectedCategories: expected,
    presentCategories: present,
    missingCategories: missing,
    ratio,
    activeEvidenceCount: active.length,
    expiredEvidenceCount: expired.length,
    confidence,
  };
}

function weakest(a: EvidenceConfidence, b: EvidenceConfidence): EvidenceConfidence {
  const order: readonly EvidenceConfidence[] =
    ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

/* ── Üretim adaptörleri (P1 wiring) ────────────────────────────────────── */

/**
 * Bu pakette kanıt üreten ÜÇ kanonik adaptör.
 *
 * ⚠️ Deep Scan · BlackBox · DTC · bakım tahmini · LLM çıktıları **KAPSAM
 * DIŞIDIR** ve bu listede YOKTUR — kapsam dışı bir kaynağın sessizce
 * eklenmesi, kanıt omurgasının sözleşmesini genişletmek olurdu.
 */
export const EVIDENCE_ADAPTERS = [
  'TRIP_METRICS_ADAPTER',
  'DRIVER_DNA_ADAPTER',
  'FLEET_INTELLIGENCE_ADAPTER',
] as const;
export type EvidenceAdapter = (typeof EVIDENCE_ADAPTERS)[number];

/**
 * KAYNAK SAHİPLİĞİ eşlemesi — bir adaptör YALNIZ kendi kaynağıyla yazabilir.
 * Sunucudaki `_evidence_adapter_source` ile BİREBİR aynı olmak zorundadır
 * (kilit: `aiEvidenceWiring.test.ts`).
 */
export function adapterSource(a: EvidenceAdapter): EvidenceSource {
  switch (a) {
    case 'TRIP_METRICS_ADAPTER':       return 'TRIP_ENGINE';
    case 'DRIVER_DNA_ADAPTER':         return 'DRIVER_DNA';
    case 'FLEET_INTELLIGENCE_ADAPTER': return 'FLEET_INTELLIGENCE';
  }
}

/** Adaptörün son işleminin sonucu — bounded DURUM (sessiz yutma YOK). */
export const ADAPTER_RESULTS = [
  'REPORTED', 'DEDUPED', 'REJECTED', 'DEGRADED', 'RETRY_PENDING',
] as const;
export type AdapterResult = (typeof ADAPTER_RESULTS)[number];

/** Bir adaptörün gözlemlenebilir durumu (LAB okur). */
export interface AdapterState {
  readonly source: EvidenceSource;
  readonly lastEventAtMs: number | null;
  readonly lastResult: AdapterResult;
  readonly reportedCount: number;
  readonly dedupedCount: number;
  readonly rejectedCount: number;
  readonly degradedCount: number;
  readonly retryPendingCount: number;
  readonly evidenceCount: number;
  readonly orphanChainCount: number;
}

/**
 * Bir adaptörün YAZABİLECEĞİ kaynağı doğrular.
 *
 * ⚠️ Bu, sunucudaki kapının TS aynasıdır: istemci tarafında da bir modülün
 * başkasının kanıtını yazması ENGELLENİR (tek gerçek yine sunucudadır).
 */
export function canAdapterWrite(a: EvidenceAdapter, source: EvidenceSource): boolean {
  return adapterSource(a) === source;
}

/* ── Cihaz tarafı gözlem yüzeyi (LAB) ──────────────────────────────────── */

/**
 * Kanıt deposu — **head unit'te BİLİNÇLİ OLARAK BOŞTUR.**
 *
 * Kanıt omurgası sunucuda yaşar (migration 055): kanıt uzun ömürlüdür,
 * şirket geneli sorgulanır ve tek bir cihazın belleğinde tutulamaz. Head
 * unit'te kanıt ÜRETEN bir yol YOKTUR; bu depo yalnız gelecekte bir okuma
 * köprüsü bağlandığında dolacak sözleşmeyi ve LAB'ın dürüst "henüz yok"
 * cevabını sağlar.
 */
class AiEvidenceStore {
  private _ledger: EvidenceLedger = EMPTY_EVIDENCE_LEDGER;
  private _source: 'NONE' | 'SERVER' = 'NONE';

  setFromServer(ledger: EvidenceLedger): void {
    this._ledger = ledger;
    this._source = 'SERVER';
  }

  clear(): void {
    this._ledger = EMPTY_EVIDENCE_LEDGER;
    this._source = 'NONE';
  }

  /** LAB salt-okur — ASLA fırlatmaz, hiçbir şey tetiklemez. */
  read(nowMs: number): {
    readonly ledger: EvidenceLedger;
    readonly source: 'NONE' | 'SERVER';
    readonly evidenceCount: number;
    readonly activeCount: number;
    readonly expiredCount: number;
    readonly rejectedCount: number;
    readonly unknownConfidenceCount: number;
    readonly mergeCount: number;
    readonly refreshTotal: number;
    readonly chainLinkCount: number;
    readonly sourceBreakdown: readonly { source: EvidenceSource; count: number }[];
    readonly integrityOk: boolean;
    readonly adapters: readonly AdapterState[];
    /** Kaç adaptör GERÇEKTEN kanıt üretmiş — kaynak kapsamı. */
    readonly sourceCoverage: number | null;
    readonly orphanChainCount: number;
    readonly retryPendingTotal: number;
  } {
    try {
      const l = this._ledger;
      const bySource = new Map<EvidenceSource, number>();
      for (const e of l.entries) {
        bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
      }
      /* BÜTÜNLÜK: kaynağı bilinmeyen bir kanıt ACTIVE ise omurga bozulmuştur. */
      const integrityOk = !l.entries.some(
        (e) => e.state === 'ACTIVE'
          && (e.source === 'SOURCE_UNKNOWN' || e.confidence === 'UNKNOWN'));
      return {
        ledger: l,
        source: this._source,
        evidenceCount: l.entries.length,
        activeCount: l.entries.filter((e) => isEvidenceValid(e, nowMs)).length,
        expiredCount: l.entries.filter((e) => e.state === 'EXPIRED').length,
        rejectedCount: l.rejectedCount,
        unknownConfidenceCount: l.entries.filter((e) => e.confidence === 'UNKNOWN').length,
        mergeCount: l.mergeCount,
        refreshTotal: l.entries.reduce((n, e) => n + e.refreshCount, 0),
        chainLinkCount: l.chain.length,
        sourceBreakdown: [...bySource.entries()]
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count),
        integrityOk,
        adapters: l.adapters ?? [],
        /* Adaptör durumu yoksa kapsam BİLİNMEZ (0 DEĞİL — hiç bakmadık). */
        sourceCoverage: (l.adapters ?? []).length === 0 ? null
          : (l.adapters ?? []).filter((a) => a.evidenceCount > 0).length
            / (l.adapters ?? []).length,
        orphanChainCount: (l.adapters ?? []).reduce((n, a) => n + a.orphanChainCount, 0),
        retryPendingTotal: (l.adapters ?? []).reduce((n, a) => n + a.retryPendingCount, 0),
      };
    } catch {
      return {
        ledger: EMPTY_EVIDENCE_LEDGER, source: 'NONE',
        evidenceCount: 0, activeCount: 0, expiredCount: 0, rejectedCount: 0,
        unknownConfidenceCount: 0, mergeCount: 0, refreshTotal: 0,
        chainLinkCount: 0, sourceBreakdown: [], integrityOk: false,
        adapters: [], sourceCoverage: null, orphanChainCount: 0,
        retryPendingTotal: 0,
      };
    }
  }

  /** @internal — testler arası izolasyon. */
  _resetForTest(): void { this.clear(); }
}

export const aiEvidenceStore = new AiEvidenceStore();

/** LAB salt-okuma yüzeyi — kanıt ÜRETMEZ, yalnız okur. */
export function readAiEvidence(nowMs: number) {
  return aiEvidenceStore.read(nowMs);
}

/** @internal — testler arası izolasyon. */
export function _resetAiEvidenceStoreForTest(): void {
  aiEvidenceStore._resetForTest();
}
