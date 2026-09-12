/**
 * maviReasoning.ts — MAVI REASONING ENGINE: KANONİK MODEL VE SÖZLEŞME (P1).
 *
 * ── AMAÇ ───────────────────────────────────────────────────────────────
 * CAROS PRO'nun **TEK KARAR OTORİTESİ**. Bugünden sonra hiçbir modül kendi
 * kararını üretmez: AI Mechanic · Driver Coach · Fleet Advisor · Predictive
 * Maintenance · Trip/Diagnostic/Repair/Service Advisor · AI Negotiator ·
 * Vehicle Health Advisor — hepsi kararı BURADAN alır.
 *
 * ── LLM KARAR VERMEZ (BAĞLAYICI) ───────────────────────────────────────
 * LLM (Claude · GPT · Gemini · Qwen · DeepSeek…) bu katmanda **YOKTUR**.
 * LLM yalnız MAVI'nin VERDİĞİ kararı doğal dile çevirir. Bir karar, LLM
 * kapalıyken de aynı çıkmak zorundadır — bu yüzden motor tamamen
 * deterministiktir: aynı kanıt kümesi → aynı karar, her zaman.
 *
 * ── BU KATMANDA OLMAYAN ŞEYLER ─────────────────────────────────────────
 * · cümle · öneri · tavsiye · tahmin · "bence" · "muhtemelen"
 * · `title`/`message`/`explanation`/`summary`/`answer`/`text` alanı
 * · serbest metin gerekçe — gerekçe daima **bounded KOD**tur
 *
 * ── ALTI SÖZLEŞME KURALI ───────────────────────────────────────────────
 *  1. **Karar kanıtsız üretilemez.** Kanıt yoksa karar `INSUFFICIENT_EVIDENCE`
 *     olur; "veri yok o hâlde sorun yok" bir karar DEĞİLDİR.
 *  2. **Güven istemciden alınamaz.** Kanıtların en zayıf halkasından türetilir
 *     ve formülü burada YENİDEN YAZILMAZ — `aiEvidence`'tan İTHAL EDİLİR.
 *  3. **Çelişkili kanıtta karar üretilmez** — `CONFLICTED_EVIDENCE` döner.
 *     İki kaynağın çeliştiği yerde "birini seçmek" uydurmaktır.
 *  4. **Süresi dolmuş kanıt karara katılmaz**, ama zincirden SİLİNMEZ:
 *     geçmiş bir kararın dayanağı yok edilirse o karar açıklanamaz olur.
 *  5. **Aynı karar iki kez üretilmez.** Kimlik = özne + niyet + kanıt imzası;
 *     replay yeni karar açmaz.
 *  6. **UNKNOWN gerçek bir karardır** ve fail-closed'dır: niyet çözülemezse,
 *     güven türetilemezse, özne uyuşmazsa karar UYDURULMAZ.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK ·
 * `fetch` YOK · depolama YOK.
 */

import {
  weakestEvidenceConfidence,
  type EvidenceCategory, type EvidenceConfidence,
} from '../fleet/aiEvidence';

/* ── Niyet ─────────────────────────────────────────────────────────────── */

/**
 * Kararın HANGİ ALANDA sorulduğu.
 *
 * ⚠️ `UNKNOWN` bir kaçış değil, bir CEVAPTIR: niyet kesin çözülemediğinde
 * motor rastgele en yakınını seçmez — bilmediğini söyler (kural 6).
 */
export const REASONING_INTENTS = [
  'VEHICLE_HEALTH',
  'TRIP_STATUS',
  'LOCATION',
  'CONNECTIVITY',
  'FUEL',
  'ENGINE',
  'TEMPERATURE',
  'BATTERY',
  'DRIVER',
  'FLEET',
  'DIAGNOSTIC',
  'UNKNOWN',
] as const;
export type ReasoningIntent = (typeof REASONING_INTENTS)[number];

export function isReasoningIntent(v: unknown): v is ReasoningIntent {
  return typeof v === 'string' && (REASONING_INTENTS as readonly string[]).includes(v);
}

/**
 * Kanıt kategorisinin işaret ettiği niyet.
 *
 * ⚠️ Eşleme TEK YÖNLÜ ve TAM'dır: her kategori bir niyete düşer. `BLACKBOX`
 * tanısal bir kayıttır → `DIAGNOSTIC`. Kategorisi `UNKNOWN` olan kanıt niyet
 * ÜRETMEZ (bilinmeyenden niyet çıkarmak, bilinmeyeni bilgi saymaktır).
 */
export function intentForCategory(c: EvidenceCategory): ReasoningIntent {
  switch (c) {
    case 'DRIVER':       return 'DRIVER';
    case 'TRIP':         return 'TRIP_STATUS';
    case 'VEHICLE':      return 'VEHICLE_HEALTH';
    case 'ENGINE':       return 'ENGINE';
    case 'TEMPERATURE':  return 'TEMPERATURE';
    case 'FUEL':         return 'FUEL';
    case 'BATTERY':      return 'BATTERY';
    case 'LOCATION':     return 'LOCATION';
    case 'CONNECTIVITY': return 'CONNECTIVITY';
    case 'DIAGNOSTIC':   return 'DIAGNOSTIC';
    case 'BLACKBOX':     return 'DIAGNOSTIC';
    case 'FLEET':        return 'FLEET';
    case 'UNKNOWN':      return 'UNKNOWN';
    /* ── ÇALIŞMA ZAMANI FAIL-CLOSED (kütük #497) ────────────────────────
       TypeScript'in exhaustiveness denetimi DERLEME zamanı bir garantidir;
       union dışı bir değer çalışma zamanında geldiğinde hiçbir şey yapmaz ve
       bu fonksiyon `undefined` dönerdi. Karar otoritesi cihaza indiğinde girdi
       artık yalnız kendi yazdığımız kod değildir: senkronlanan kanıt, eski
       şemayla yazılmış yerel kayıt, JSON'dan okunan alan. `undefined` niyet
       `resolveIntent` aday listesine sızar ve sonuç "muhafazakâr karar" değil
       ÇÖKME olur.
       Dönüş SQL `_reasoning_intent_for_category` ELSE dalıyla BİREBİR aynıdır. */
    default:             return 'UNKNOWN';
  }
}

/**
 * Bir niyetin karara girebilecek kanıt kategorileri.
 *
 * ⚠️ Beklenti SABİTTİR ve gerçeğe göre aşağı çekilmez — "zaten sıcaklık
 * verimiz yok, o hâlde beklemeyelim" demek eksikliği görünmez yapardı
 * (`aiEvidence.expectedCategoriesFor` ile aynı ilke).
 */
export function categoriesForIntent(i: ReasoningIntent): readonly EvidenceCategory[] {
  switch (i) {
    /* Araç sağlığı tek bir sinyalin işi değildir: motor · sıcaklık · akü ·
       tanı birlikte bakılmadan "araç sağlıklı" denemez. */
    case 'VEHICLE_HEALTH': return Object.freeze(
      ['VEHICLE', 'ENGINE', 'TEMPERATURE', 'BATTERY', 'DIAGNOSTIC']);
    case 'TRIP_STATUS':    return Object.freeze(['TRIP', 'LOCATION', 'FUEL']);
    case 'LOCATION':       return Object.freeze(['LOCATION']);
    case 'CONNECTIVITY':   return Object.freeze(['CONNECTIVITY']);
    case 'FUEL':           return Object.freeze(['FUEL']);
    case 'ENGINE':         return Object.freeze(['ENGINE']);
    case 'TEMPERATURE':    return Object.freeze(['TEMPERATURE']);
    case 'BATTERY':        return Object.freeze(['BATTERY']);
    case 'DRIVER':         return Object.freeze(['DRIVER', 'TRIP']);
    case 'FLEET':          return Object.freeze(['FLEET']);
    case 'DIAGNOSTIC':     return Object.freeze(['DIAGNOSTIC', 'BLACKBOX']);
    /* Niyet bilinmiyorsa beklenen kategori de yoktur — boş liste bir
       "hepsi" kısayolu DEĞİLDİR. */
    case 'UNKNOWN':        return Object.freeze([]);
    /* Çalışma zamanı fail-closed (#497): union dışı niyet `undefined` DEĞİL,
       boş liste döndürür. SQL `_reasoning_categories` ELSE dalı da
       `ARRAY[]::text[]` verir — birebir aynı. `undefined` dönseydi çağıran
       `.length` üzerinde patlardı. */
    default:               return Object.freeze([]);
  }
}

/* ── Karar ─────────────────────────────────────────────────────────────── */

/**
 * Kararın kendisi.
 *
 * ── `SUPPORTED` / `UNSUPPORTED` NE DEMEK ───────────────────────────────
 * Motorun cevapladığı iddia her niyet için aynıdır:
 * **"bu niyet alanında öznenin durumu sorunsuz mu?"**
 *   · `SUPPORTED`   → yeterli ve geçerli kanıt var, olumsuz kanıt YOK.
 *   · `UNSUPPORTED` → olumsuz kanıt (WARNING/CRITICAL) VAR.
 * Bu tanım bilinçli olarak dardır: motorun her soruya cevap vermesi değil,
 * verdiği her cevabın kanıtlanabilir olması hedeflenir.
 */
export const REASONING_DECISIONS = [
  'SUPPORTED',
  'UNSUPPORTED',
  'INSUFFICIENT_EVIDENCE',
  'CONFLICTED_EVIDENCE',
  'EXPIRED_EVIDENCE',
  'UNKNOWN',
  'REJECTED',
] as const;
export type ReasoningDecision = (typeof REASONING_DECISIONS)[number];

export function isReasoningDecision(v: unknown): v is ReasoningDecision {
  return typeof v === 'string' && (REASONING_DECISIONS as readonly string[]).includes(v);
}

/**
 * Karar bir AKSİYON emri midir?
 *
 * ⚠️ Yalnız `SUPPORTED`/`UNSUPPORTED` bir bilgi taşır. Diğerleri "karar
 * veremedim"in farklı GEREKÇELERİDİR ve bir tüketici (LLM dâhil) onları
 * olumlu/olumsuz gibi sunamaz.
 */
export function isConclusiveDecision(d: ReasoningDecision): boolean {
  return d === 'SUPPORTED' || d === 'UNSUPPORTED';
}

/* ── Güven ─────────────────────────────────────────────────────────────── */

/**
 * Karar güveni — kanıt güveniyle **AYNI ÖLÇEK**.
 *
 * ⚠️ Ayrı bir güven ölçeği tanımlanmadı: iki ölçek olsaydı "karar güveni
 * HIGH ama kanıt güveni LOW" gibi açıklanamaz bir durum doğardı.
 */
export type ReasoningConfidence = EvidenceConfidence;

/**
 * Güven neden bu seviyede — **bounded KOD** (serbest metin YOK).
 *
 * ⚠️ Gerekçe bir cümle olsaydı, bu katman doğal dil üretmeye başlardı.
 * Cümleyi Mavi kurar; motor yalnız kodu verir.
 */
export const CONFIDENCE_REASONS = [
  'NO_EVIDENCE',                // hiç kanıt yok
  'ALL_EVIDENCE_EXPIRED',       // kanıt var ama hepsinin süresi dolmuş
  'CONFLICTING_EVIDENCE',       // kaynaklar çelişiyor
  'EVIDENCE_UNKNOWN_CONFIDENCE',// kanıtların güveni türetilememiş
  'SINGLE_OBSERVATION',         // tek gözlem — eğilim değil
  'COVERAGE_INCOMPLETE',        // beklenen kategorilerin bir kısmı eksik
  'WEAKEST_EVIDENCE_LINK',      // en zayıf kanıt güveni bağladı
  'INTENT_UNRESOLVED',          // niyet kesin çözülemedi
  'SUBJECT_MISMATCH',           // özne yok / başka şirkete ait
] as const;
export type ConfidenceReason = (typeof CONFIDENCE_REASONS)[number];

/* ── Durum makinesi ────────────────────────────────────────────────────── */

/**
 * Karar yaşam döngüsü.
 *
 * ⚠️ `NEW → SUPPORTED` gibi bir kestirme YOKTUR: analiz edilmeden karar
 * olmaz. Geçersiz geçiş sessizce düzeltilmez, **reddedilir**.
 */
export const REASONING_STATES = [
  'NEW',
  'ANALYZING',
  'SUPPORTED',
  'UNSUPPORTED',
  'UNKNOWN',
  'REJECTED',
  'EXPIRED',
  'CONFLICTED',
] as const;
export type ReasoningState = (typeof REASONING_STATES)[number];

export function isReasoningState(v: unknown): v is ReasoningState {
  return typeof v === 'string' && (REASONING_STATES as readonly string[]).includes(v);
}

/** Terminal durumlar — buradan yalnız süre dolumuna geçilir. */
const CONCLUDED_STATES: readonly ReasoningState[] = Object.freeze(
  ['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN', 'CONFLICTED']);

/**
 * Geçerli durum geçişleri.
 *
 * `REJECTED` ve `EXPIRED` mutlak terminaldir: reddedilmiş bir karar
 * "sonradan doğru" olamaz, süresi dolmuş bir karar diriltilemez — yeni
 * kanıt geldiğinde YENİ bir karar açılır (kural 5'in doğal sonucu).
 */
export function canTransitionReasoning(
  from: ReasoningState, to: ReasoningState,
): boolean {
  if (from === to) return false;                     // no-op geçiş yoktur
  if (from === 'NEW') return to === 'ANALYZING' || to === 'REJECTED';
  if (from === 'ANALYZING') {
    return to === 'REJECTED' || CONCLUDED_STATES.includes(to);
  }
  if (CONCLUDED_STATES.includes(from)) return to === 'EXPIRED';
  return false;                                      // REJECTED · EXPIRED terminal
}

/** Karara karşılık gelen terminal durum — eşleme TEK YÖNLÜ ve TAM. */
export function stateForDecision(d: ReasoningDecision): ReasoningState {
  switch (d) {
    case 'SUPPORTED':             return 'SUPPORTED';
    case 'UNSUPPORTED':           return 'UNSUPPORTED';
    case 'CONFLICTED_EVIDENCE':   return 'CONFLICTED';
    case 'REJECTED':              return 'REJECTED';
    /* Yetersiz · süresi dolmuş · bilinmeyen kanıt → hepsi "bilmiyorum"dur.
       Süre dolumu bir DURUM değil, karar GEREKÇESİDİR: `EXPIRED` durumu
       kararın kendi ömrünü anlatır, kanıtın değil. */
    case 'INSUFFICIENT_EVIDENCE': return 'UNKNOWN';
    case 'EXPIRED_EVIDENCE':      return 'UNKNOWN';
    case 'UNKNOWN':               return 'UNKNOWN';
    /* Çalışma zamanı fail-closed (#497) — SQL `_reasoning_state_for_decision`
       ELSE dalıyla birebir aynı. Tanınmayan karar "bilmiyorum"dur; sonuçlandırıcı
       bir duruma YÜKSELTİLMEZ. */
    default:                      return 'UNKNOWN';
  }
}

/* ── Çelişki ───────────────────────────────────────────────────────────── */

/** Çelişki türü — bounded KOD. */
export const CONFLICT_KINDS = ['VALUE_DIVERGENCE', 'REVISION_DIVERGENCE'] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

/**
 * İki kanıtın çeliştiği tespit.
 *
 * ⚠️ Çelişki bir HATA raporu değil, bir KARAR GİRDİSİDİR: çelişki varken
 * motor karar üretmez (kural 3).
 */
export interface ReasoningConflict {
  readonly kind: ConflictKind;
  readonly metric: string;
  readonly leftEvidenceId: string;
  readonly rightEvidenceId: string;
}

/**
 * İki ölçümün ÇELİŞTİĞİ sayılacağı bağıl fark eşiği.
 *
 * ⚠️ Eşik sıfır DEĞİLDİR: iki kaynağın aynı büyüklüğü birbirine çok yakın
 * ölçmesi çelişki değil, ölçüm gürültüsüdür. %10 bilinçli ve sabittir —
 * çağıran gevşetemez (gevşetilebilir bir eşik, çelişkiyi gizlemenin yolu
 * olurdu).
 */
export const CONFLICT_RELATIVE_TOLERANCE = 0.10;

/**
 * İki ölçüm çelişiyor mu — SAF ve simetrik.
 *
 * Ölçümü olmayan kanıt çelişemez: `null` bir değer değil, bir boşluktur.
 */
export function valuesConflict(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  /* İki değer de 0 ise fark yoktur; bağıl eşik burada tanımsız olurdu. */
  if (scale === 0) return false;
  return Math.abs(a - b) / scale > CONFLICT_RELATIVE_TOLERANCE;
}

/* ── Kanonik karar ─────────────────────────────────────────────────────── */

/** Güncel şema sürümü — anlam değişirse ARTAR, eski karar yanlış yorumlanmaz. */
export const REASONING_VERSION = 1;

/** VARSAYILAN KARAR ÖMRÜ — süresiz karar, bayat bilgiyi karar gibi sunar. */
export const REASONING_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;   // 24 saat

/**
 * Tek bir karar kaydı.
 *
 * ⚠️ Kişisel veri TAŞIMAZ: ad, plaka, VIN, koordinat, rota, ham transkript
 * YOKTUR — yalnız kimlik referansları ve bounded kodlar.
 *
 * ⚠️ Doğal dil alanı **BİLİNÇLİ OLARAK YOKTUR**: cümleyi LLM kurar, kararı
 * bu katman verir.
 */
export interface MaviReasoning {
  readonly reasoningId: string;
  readonly intent: ReasoningIntent;
  readonly decision: ReasoningDecision;
  /** TÜRETİLİR — asla dışarıdan yazılmaz (kural 2). */
  readonly confidence: ReasoningConfidence;
  readonly confidenceReason: ConfidenceReason;
  readonly reasoningVersion: number;
  readonly vehicleId: string | null;
  readonly driverId: string | null;
  readonly tripId: string | null;
  readonly companyId: string;
  /** Karara GİREN kanıtlar — boşsa karar sonuçlandırıcı OLAMAZ. */
  readonly evidenceIds: readonly string[];
  /** Zincirin Fleet Intelligence ucu (kanıt zincirinden ÇÖZÜLÜR). */
  readonly insightIds: readonly string[];
  /** Zincirin Driver DNA ucu. */
  readonly dnaIds: readonly string[];
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly state: ReasoningState;
}

/**
 * KARAR KİMLİĞİ — tekilleştirmenin çekirdeği (kural 5).
 *
 * Kimlik = şirket + niyet + özneler + **kanıt imzası**. Zaman kimliğe DAHİL
 * DEĞİLDİR: aynı kanıtla ikinci kez düşünmek yeni bir karar üretmez (replay
 * güvenliği). Kanıt kümesi değişirse imza değişir → bu artık BAŞKA bir
 * karardır, çünkü dayanağı başkadır.
 */
export function reasoningKey(r: Pick<MaviReasoning,
  'companyId' | 'intent' | 'vehicleId' | 'driverId' | 'tripId' | 'evidenceIds'>): string {
  return [
    r.companyId, r.intent,
    r.vehicleId ?? '-', r.driverId ?? '-', r.tripId ?? '-',
    evidenceSignature(r.evidenceIds),
  ].join('|');
}

/**
 * Kanıt kümesinin SIRADAN BAĞIMSIZ imzası.
 *
 * ⚠️ Sıralama ve tekrar temizliği şart: aynı kanıtlar farklı sırada gelirse
 * aynı imza çıkmalı, yoksa replay her seferinde "yeni" karar üretirdi.
 */
export function evidenceSignature(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join(',');
}

/** Karar verilen anda hâlâ geçerli mi. */
export function isReasoningValid(r: MaviReasoning, nowMs: number): boolean {
  return CONCLUDED_STATES.includes(r.state) && nowMs < r.expiresAt;
}

/**
 * İki güvenin daha zayıfı — **formül burada YENİDEN YAZILMAZ**.
 *
 * `aiEvidence.weakestEvidenceConfidence` yeniden dışa vurulur: ikinci bir
 * güven otoritesi kurulması yasaktır (kural 2).
 */
export const weakestReasoningConfidence = weakestEvidenceConfidence;

/* ── Kanıt zinciri katmanları ──────────────────────────────────────────── */

/**
 * Zincir katmanı — kararın geriye doğru okunma sırası:
 * `DECISION → EVIDENCE → FLEET_INSIGHT → DRIVER_DNA → TRIP → VEHICLE`
 */
export const REASONING_CHAIN_LAYERS = [
  'DECISION', 'EVIDENCE', 'FLEET_INSIGHT', 'DRIVER_DNA', 'TRIP', 'VEHICLE',
] as const;
export type ReasoningChainLayer = (typeof REASONING_CHAIN_LAYERS)[number];

/** Zincirin tek bir düğümü. */
export interface ReasoningChainNode {
  readonly layer: ReasoningChainLayer;
  readonly refId: string;
  /** Bu düğümü DOĞURAN üst düğüm; kökte `null`. */
  readonly parentRefId: string | null;
  /** Düğüm gerçekten okunabildi mi — okunamayan düğüm UYDURULMAZ. */
  readonly resolved: boolean;
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function reasoningIntentLabel(i: ReasoningIntent): string {
  switch (i) {
    case 'VEHICLE_HEALTH': return 'Araç sağlığı';
    case 'TRIP_STATUS':    return 'Yolculuk durumu';
    case 'LOCATION':       return 'Konum';
    case 'CONNECTIVITY':   return 'Bağlantı';
    case 'FUEL':           return 'Yakıt';
    case 'ENGINE':         return 'Motor';
    case 'TEMPERATURE':    return 'Sıcaklık';
    case 'BATTERY':        return 'Akü';
    case 'DRIVER':         return 'Sürücü';
    case 'FLEET':          return 'Filo';
    case 'DIAGNOSTIC':     return 'Tanı';
    case 'UNKNOWN':        return 'Niyet bilinmiyor';
  }
}

export function reasoningDecisionLabel(d: ReasoningDecision): string {
  switch (d) {
    case 'SUPPORTED':             return 'Kanıtlandı';
    case 'UNSUPPORTED':           return 'Olumsuz kanıt var';
    case 'INSUFFICIENT_EVIDENCE': return 'Kanıt yetersiz';
    case 'CONFLICTED_EVIDENCE':   return 'Kanıtlar çelişiyor';
    case 'EXPIRED_EVIDENCE':      return 'Kanıtın süresi dolmuş';
    case 'UNKNOWN':               return 'Bilinmiyor';
    case 'REJECTED':              return 'Karar üretilemez';
  }
}

export function reasoningStateLabel(s: ReasoningState): string {
  switch (s) {
    case 'NEW':         return 'Yeni';
    case 'ANALYZING':   return 'İnceleniyor';
    case 'SUPPORTED':   return 'Kanıtlandı';
    case 'UNSUPPORTED': return 'Olumsuz';
    case 'UNKNOWN':     return 'Bilinmiyor';
    case 'REJECTED':    return 'Reddedildi';
    case 'EXPIRED':     return 'Süresi doldu';
    case 'CONFLICTED':  return 'Çelişkili';
  }
}

export function confidenceReasonLabel(r: ConfidenceReason): string {
  switch (r) {
    case 'NO_EVIDENCE':                 return 'Hiç kanıt yok';
    case 'ALL_EVIDENCE_EXPIRED':        return 'Kanıtların tamamının süresi dolmuş';
    case 'CONFLICTING_EVIDENCE':        return 'Kaynaklar çelişiyor';
    case 'EVIDENCE_UNKNOWN_CONFIDENCE': return 'Kanıt güveni türetilemedi';
    case 'SINGLE_OBSERVATION':          return 'Tek gözlem — eğilim değil';
    case 'COVERAGE_INCOMPLETE':         return 'Beklenen kanıtların bir kısmı eksik';
    case 'WEAKEST_EVIDENCE_LINK':       return 'En zayıf kanıt güveni bağladı';
    case 'INTENT_UNRESOLVED':           return 'Niyet kesin çözülemedi';
    case 'SUBJECT_MISMATCH':            return 'Özne yok veya başka şirkete ait';
  }
}

export function conflictKindLabel(k: ConflictKind): string {
  switch (k) {
    case 'VALUE_DIVERGENCE':    return 'Değerler uyuşmuyor';
    case 'REVISION_DIVERGENCE': return 'İki farklı revizyon birden geçerli';
  }
}

export function reasoningChainLayerLabel(l: ReasoningChainLayer): string {
  switch (l) {
    case 'DECISION':      return 'Karar';
    case 'EVIDENCE':      return 'Kanıt';
    case 'FLEET_INSIGHT': return 'Filo içgörüsü';
    case 'DRIVER_DNA':    return 'Sürücü DNA';
    case 'TRIP':          return 'Yolculuk';
    case 'VEHICLE':       return 'Araç';
  }
}
