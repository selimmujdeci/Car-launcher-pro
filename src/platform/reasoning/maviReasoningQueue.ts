/**
 * maviReasoningQueue.ts — ÜRETİM OLAY KUYRUĞU SÖZLEŞMESİ (SAF).
 *
 * ── NE İŞE YARAR ───────────────────────────────────────────────────────
 * Gerçek araç/filo/sürücü olaylarının karar motoruna açılan **tek kapısını**
 * tarif eder: olay → niyet → resolver eşlemesi, bounded tekilleştirme,
 * durum kümesi ve gecikme ölçümü.
 *
 * ── SUNUCUNUN AYNASIDIR, İKİNCİ SİSTEM DEĞİL ───────────────────────────
 * Üretim yolu migration 058'dedir. Buradaki eşlemeler ve durum kümesi
 * sunucudakiyle **birebir aynı** olmak zorundadır (kilit:
 * `maviReasoningWiring.test.ts` SQL dosyasını okuyup karşılaştırır).
 * Burada paralel bir kuyruk, paralel bir zamanlayıcı veya paralel bir karar
 * mantığı KURULMAZ.
 *
 * ── NE YAPMAZ ──────────────────────────────────────────────────────────
 * · Olay ÜRETMEZ · karar TETİKLEMEZ · kuyruk İŞLETMEZ · LLM ÇAĞIRMAZ.
 * · Karar mantığı (decision/confidence/conflict) TAŞIMAZ — o 057'dedir.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

import { EVIDENCE_CATEGORIES, type EvidenceCategory } from '../fleet/aiEvidence';
import { intentForCategory, type ReasoningIntent } from './maviReasoning';

/**
 * Kanıt kategorisi — dışarıdan gelen değer bozuk/eksik olabilir.
 *
 * ⚠️ Tanınmayan kategori sessizce bir niyete YUVARLANMAZ: `UNKNOWN` olur ve
 * olay Unknown Resolver'a gider.
 */
function intentForCategoryLoose(c: string | null): ReasoningIntent {
  if (c === null) return 'UNKNOWN';
  return (EVIDENCE_CATEGORIES as readonly string[]).includes(c)
    ? intentForCategory(c as EvidenceCategory) : 'UNKNOWN';
}

/* ── Olay tipleri (12 gerçek olay) ─────────────────────────────────────── */

/**
 * Karar motorunu tetikleyen GERÇEK olaylar.
 *
 * ⚠️ Bu liste **kapalıdır**: yeni bir olay eklemek, onu bir niyete ve bir
 * resolver'a eşlemeden mümkün değildir (varsayılan resolver yasaktır).
 */
export const REASONING_EVENT_TYPES = [
  'TRIP_COMPLETED',
  'DRIVER_DNA_UPDATED',
  'FLEET_INSIGHT_CREATED',
  'VEHICLE_IDENTITY_CHANGED',
  'VEHICLE_CONNECTIVITY_CHANGED',
  'LOCATION_STATE_CHANGED',
  'DRIVER_AUTHENTICATION_CHANGED',
  'DRIVER_PRESENCE_CHANGED',
  'HEALTH_SNAPSHOT_UPDATED',
  'EVIDENCE_ADDED',
  'EVIDENCE_EXPIRED',
  'EVIDENCE_RETRACTED',
] as const;
export type ReasoningEventType = (typeof REASONING_EVENT_TYPES)[number];

export function isReasoningEventType(v: unknown): v is ReasoningEventType {
  return typeof v === 'string'
    && (REASONING_EVENT_TYPES as readonly string[]).includes(v);
}

/* ── Resolver'lar ──────────────────────────────────────────────────────── */

/**
 * Niyeti üstlenen resolver.
 *
 * ⚠️ Bir resolver **KARAR ÜRETMEZ**: yalnız kararın hangi özneye
 * bağlanacağını seçer ve motora yönlendirir. Eşik, oran veya güven mantığı
 * bir resolver'a girerse ikinci karar otoritesi doğar — bu yasaktır.
 */
export const REASONING_RESOLVERS = [
  'VEHICLE', 'DRIVER', 'TRIP', 'FLEET', 'DIAGNOSTIC', 'UNKNOWN',
] as const;
export type ReasoningResolver = (typeof REASONING_RESOLVERS)[number];

/**
 * Niyet → resolver — **VARSAYILAN RESOLVER YOKTUR**.
 *
 * Eşlenmemiş bir niyet `null` döner ve olay kuyruğa **giremez**: sessizce
 * "en yakın" resolver'a düşmek, niyeti bilmediğimizi gizlemek olurdu.
 * Sunucudaki `_reasoning_resolver_for_intent` ile BİREBİR aynıdır.
 */
export function resolverForIntent(i: ReasoningIntent): ReasoningResolver | null {
  switch (i) {
    /* Araç gövdesine ait sinyaller. */
    case 'VEHICLE_HEALTH': return 'VEHICLE';
    case 'ENGINE':         return 'VEHICLE';
    case 'TEMPERATURE':    return 'VEHICLE';
    case 'BATTERY':        return 'VEHICLE';
    case 'CONNECTIVITY':   return 'VEHICLE';
    /* Sürücü. */
    case 'DRIVER':         return 'DRIVER';
    /* Yolculuk bağlamı — konum ve yakıt bir yolculuğun içinde anlam kazanır. */
    case 'TRIP_STATUS':    return 'TRIP';
    case 'LOCATION':       return 'TRIP';
    case 'FUEL':           return 'TRIP';
    case 'FLEET':          return 'FLEET';
    case 'DIAGNOSTIC':     return 'DIAGNOSTIC';
    /* Niyeti bilinmeyen olay da bir resolver'a gider — ama o resolver
       "bilmiyorum"u kayda geçirir, karar UYDURMAZ. */
    case 'UNKNOWN':        return 'UNKNOWN';
  }
}

/**
 * Olay → niyet — deterministik.
 *
 * ⚠️ Kanıt olayları niyeti **kanıtın kendi kategorisinden** alır; kategori
 * verilmezse `UNKNOWN` olur. Diğer olaylar sabit eşlemedir.
 * Sunucudaki `_reasoning_intent_for_event` ile BİREBİR aynıdır.
 */
export function intentForEvent(
  e: ReasoningEventType, evidenceCategory?: string | null,
): ReasoningIntent {
  switch (e) {
    case 'TRIP_COMPLETED':                return 'TRIP_STATUS';
    case 'DRIVER_DNA_UPDATED':            return 'DRIVER';
    case 'FLEET_INSIGHT_CREATED':         return 'FLEET';
    case 'VEHICLE_IDENTITY_CHANGED':      return 'VEHICLE_HEALTH';
    case 'VEHICLE_CONNECTIVITY_CHANGED':  return 'CONNECTIVITY';
    case 'LOCATION_STATE_CHANGED':        return 'LOCATION';
    case 'DRIVER_AUTHENTICATION_CHANGED': return 'DRIVER';
    case 'DRIVER_PRESENCE_CHANGED':       return 'DRIVER';
    case 'HEALTH_SNAPSHOT_UPDATED':       return 'FLEET';
    case 'EVIDENCE_ADDED':
    case 'EVIDENCE_EXPIRED':
    case 'EVIDENCE_RETRACTED':
      return intentForCategoryLoose(evidenceCategory ?? null);
  }
}

/* ── Kuyruk durumu ─────────────────────────────────────────────────────── */

/**
 * Bir olayın kuyruktaki durumu — bounded KOD.
 *
 * ⚠️ `SKIPPED` ve `DEDUPED` birer **başarı** değil, birer **bilgi**dir:
 * ilki "özne yoktu, karar uydurmadık", ikincisi "aynı iş zaten bekliyordu".
 * İkisi de sessizce yutulmaz.
 */
export const REASONING_EVENT_STATES = [
  'PENDING', 'RUNNING', 'COMPLETED', 'FAILED',
  'RETRY_PENDING', 'REJECTED', 'SKIPPED', 'DEDUPED',
] as const;
export type ReasoningEventState = (typeof REASONING_EVENT_STATES)[number];

/** İş kuyrukta hâlâ AÇIK mı — dedupe penceresini bu belirler. */
export function isOpenEventState(s: ReasoningEventState): boolean {
  return s === 'PENDING' || s === 'RUNNING' || s === 'RETRY_PENDING';
}

/** Olay neden atlandı — bounded KOD (serbest metin YOK). */
export const EVENT_SKIP_REASONS = [
  'NO_VEHICLE_SUBJECT', 'NO_DRIVER_SUBJECT', 'NO_TRIP_SUBJECT',
  'NO_COMPANY', 'SUBJECT_MISMATCH', 'UNMAPPED_INTENT', 'ATTEMPTS_EXHAUSTED',
] as const;
export type EventSkipReason = (typeof EVENT_SKIP_REASONS)[number];

/** Sınırlı yeniden deneme tavanı — sonsuz kuyruk bir arıza değil, bir sızıntıdır. */
export const REASONING_MAX_ATTEMPTS = 5;

/* ── Bounded dedupe ────────────────────────────────────────────────────── */

/**
 * Tekilleştirme anahtarı: **şirket + niyet + özne**.
 *
 * ⚠️ Olay TİPİ anahtara dâhil DEĞİLDİR ve bu bilinçlidir: aynı aracın
 * sıcaklık kanıtı hem `EVIDENCE_ADDED` hem `TRIP_COMPLETED` yolundan
 * gelebilir; ikisi de aynı kararı sorar. Anahtara olay tipini koysaydık
 * aynı soru iki kez çalışırdı.
 *
 * Sunucudaki `dedupe_key` ile BİREBİR aynı biçimdedir.
 */
export function eventDedupeKey(e: {
  readonly companyId: string;
  readonly intent: ReasoningIntent;
  readonly vehicleId?: string | null;
  readonly driverId?: string | null;
  readonly tripId?: string | null;
}): string {
  return [
    e.companyId, e.intent,
    e.vehicleId ?? '-', e.driverId ?? '-', e.tripId ?? '-',
  ].join('|');
}

/* ── Gecikme ölçümü ────────────────────────────────────────────────────── */

/**
 * Bir olayın kuyrukta bekleme ve karar süreleri.
 *
 * ⚠️ Ölçülemeyen süre **`null`**'dır, `0` DEĞİL: "henüz başlamadı" ile
 * "anında başladı" farklı şeylerdir.
 */
export interface EventTiming {
  readonly queueMs: number | null;
  readonly decisionMs: number | null;
}

export function eventTiming(e: {
  readonly enqueuedAtMs: number;
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
}): EventTiming {
  const queueMs = e.startedAtMs === null
    ? null : Math.max(0, e.startedAtMs - e.enqueuedAtMs);
  const decisionMs = e.startedAtMs === null || e.finishedAtMs === null
    ? null : Math.max(0, e.finishedAtMs - e.startedAtMs);
  return { queueMs, decisionMs };
}

/** Ortalama — ölçüm yoksa `null` (sahte `0` YOK). */
export function averageOrNull(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0) / known.length;
}

/* ── Kuyruk anlık görüntüsü ────────────────────────────────────────────── */

/** Tek bir kuyruk kaydı (sunucudan okunur; head unit ÜRETMEZ). */
export interface ReasoningEvent {
  readonly id: string;
  readonly companyId: string;
  readonly eventType: ReasoningEventType;
  readonly intent: ReasoningIntent;
  readonly resolver: ReasoningResolver;
  readonly state: ReasoningEventState;
  readonly attempts: number;
  /** Bekleyen iş varken kaç kez aynı olay geldi. */
  readonly suppressedCount: number;
  readonly reasoningId: string | null;
  readonly skipReason: EventSkipReason | null;
  readonly queueMs: number | null;
  readonly decisionMs: number | null;
}

export interface ReasoningQueueSnapshot {
  readonly events: readonly ReasoningEvent[];
  readonly pending: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly retryPending: number;
  readonly rejected: number;
  readonly skipped: number;
  readonly deduped: number;
  readonly suppressedTotal: number;
  readonly avgQueueMs: number | null;
  readonly avgDecisionMs: number | null;
  /** Kuyruk sağlıklı mı — düşmüş iş yok ve birikme yok. */
  readonly healthy: boolean;
}

export const EMPTY_QUEUE_SNAPSHOT: ReasoningQueueSnapshot = Object.freeze({
  events: Object.freeze([]) as readonly ReasoningEvent[],
  pending: 0, running: 0, completed: 0, failed: 0, retryPending: 0,
  rejected: 0, skipped: 0, deduped: 0, suppressedTotal: 0,
  avgQueueMs: null, avgDecisionMs: null, healthy: true,
});

/** Kuyruk birikmesi eşiği — üstünde kuyruk sağlıksız sayılır. */
export const QUEUE_BACKLOG_LIMIT = 100;

/**
 * Olay listesinden kuyruk özeti çıkarır (SAF).
 *
 * ⚠️ Sağlık, "hiç iş yok" ile karıştırılmaz: boş kuyruk sağlıklıdır, ama
 * **tek bir `FAILED` iş bile** kuyruğu sağlıksız yapar — düşmüş bir karar
 * sessizce kabullenilmez.
 */
export function summarizeQueue(
  events: readonly ReasoningEvent[],
): ReasoningQueueSnapshot {
  const count = (s: ReasoningEventState): number =>
    events.filter((e) => e.state === s).length;

  const failed = count('FAILED');
  const pending = count('PENDING');
  const retryPending = count('RETRY_PENDING');

  return {
    events,
    pending,
    running: count('RUNNING'),
    completed: count('COMPLETED'),
    failed,
    retryPending,
    rejected: count('REJECTED'),
    skipped: count('SKIPPED'),
    deduped: count('DEDUPED'),
    suppressedTotal: events.reduce((n, e) => n + e.suppressedCount, 0),
    avgQueueMs: averageOrNull(events.map((e) => e.queueMs)),
    avgDecisionMs: averageOrNull(events.map((e) => e.decisionMs)),
    healthy: failed === 0 && (pending + retryPending) < QUEUE_BACKLOG_LIMIT,
  };
}

/* ── Etiketler ─────────────────────────────────────────────────────────── */

export function reasoningEventTypeLabel(e: ReasoningEventType): string {
  switch (e) {
    case 'TRIP_COMPLETED':                return 'Yolculuk tamamlandı';
    case 'DRIVER_DNA_UPDATED':            return 'Sürücü DNA güncellendi';
    case 'FLEET_INSIGHT_CREATED':         return 'Filo içgörüsü oluştu';
    case 'VEHICLE_IDENTITY_CHANGED':      return 'Araç kimliği değişti';
    case 'VEHICLE_CONNECTIVITY_CHANGED':  return 'Araç bağlantısı değişti';
    case 'LOCATION_STATE_CHANGED':        return 'Konum durumu değişti';
    case 'DRIVER_AUTHENTICATION_CHANGED': return 'Sürücü doğrulaması değişti';
    case 'DRIVER_PRESENCE_CHANGED':       return 'Sürücü varlığı değişti';
    case 'HEALTH_SNAPSHOT_UPDATED':       return 'Filo sağlığı güncellendi';
    case 'EVIDENCE_ADDED':                return 'Kanıt eklendi';
    case 'EVIDENCE_EXPIRED':              return 'Kanıtın süresi doldu';
    case 'EVIDENCE_RETRACTED':            return 'Kanıt geri çekildi';
  }
}

export function reasoningResolverLabel(r: ReasoningResolver): string {
  switch (r) {
    case 'VEHICLE':    return 'Araç çözücü';
    case 'DRIVER':     return 'Sürücü çözücü';
    case 'TRIP':       return 'Yolculuk çözücü';
    case 'FLEET':      return 'Filo çözücü';
    case 'DIAGNOSTIC': return 'Tanı çözücü';
    case 'UNKNOWN':    return 'Bilinmeyen çözücü';
  }
}

export function reasoningEventStateLabel(s: ReasoningEventState): string {
  switch (s) {
    case 'PENDING':       return 'Bekliyor';
    case 'RUNNING':       return 'Çalışıyor';
    case 'COMPLETED':     return 'Tamamlandı';
    case 'FAILED':        return 'Düştü';
    case 'RETRY_PENDING': return 'Yeniden denenecek';
    case 'REJECTED':      return 'Reddedildi';
    case 'SKIPPED':       return 'Atlandı';
    case 'DEDUPED':       return 'Tekrar bastırıldı';
  }
}

export function eventSkipReasonLabel(r: EventSkipReason): string {
  switch (r) {
    case 'NO_VEHICLE_SUBJECT': return 'Araç öznesi yok';
    case 'NO_DRIVER_SUBJECT':  return 'Sürücü öznesi yok';
    case 'NO_TRIP_SUBJECT':    return 'Yolculuk öznesi yok';
    case 'NO_COMPANY':         return 'Şirket yok';
    case 'SUBJECT_MISMATCH':   return 'Özne uyuşmadı';
    case 'UNMAPPED_INTENT':    return 'Niyet bir çözücüye eşlenmemiş';
    case 'ATTEMPTS_EXHAUSTED': return 'Deneme hakkı tükendi';
  }
}
