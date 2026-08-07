/**
 * driverPresenceHistory.ts — SÜRÜCÜ VARLIĞI GEÇMİŞİ (PRESENCE HISTORY).
 *
 * ── CEVAPLANAN SORU ────────────────────────────────────────────────────
 * `driverPresence.ts` "ŞU AN kim araçta?" sorusunu cevaplar ve yalnız TEK
 * bir gözlem tutar. Bu modül farklı bir soruyu cevaplar:
 *
 *     "Bu araçta sürücü varlığı ZAMAN İÇİNDE nasıl değişti?"
 *
 * Yani: kim, ne zaman geldi, ne kadar kaldı, yerine kim geçti, kaç kez
 * el değiştirdi.
 *
 * ── RESOLVER'A DOKUNULMADI (BAĞLAYICI) ─────────────────────────────────
 * `resolveDriverPresence` **TEK OTORİTEDİR ve DEĞİŞMEMİŞTİR**. Geçmiş bir
 * KARAR katmanı değil, bir DEFTERDİR: attribution kararını ne besler ne de
 * değiştirir. Bu modülün ürettiği hiçbir şey bir sürücüyü "kanıtlanmış"
 * yapmaz — kanıt kapısı hâlâ yalnız resolver'dır.
 *
 * ── SEGMENT MODELİ ─────────────────────────────────────────────────────
 * Geçmiş, gözlem YIĞINI değil **SEGMENT** defteridir. Bir segment,
 * kesintisiz tek bir varlık dönemidir:
 *
 *   segment kimliği = (vehicleId, driverId, source)
 *
 * Aynı sürücü kartını 10 kez okutursa bu 10 kayıt DEĞİL, süresi uzayan
 * TEK segmenttir (dedupe). Yeni segment ancak sürücü veya kaynak
 * değişince açılır.
 *
 * ── KAPANIŞ (SÜRESİ DOLAN PRESENCE) ────────────────────────────────────
 * Bir segment üç sebepten kapanır:
 *   · `SUPERSEDED`   — yerine başka bir presence geçti
 *   · `TTL_EXPIRED`  — gözlemin süresi doldu (sabah okutulan kart akşamki
 *                      yolculuğa BAĞLANMAZ)
 *   · `CLEARED`      — oturum/araç değişimi ile temizlendi
 *
 * **Açık segmentin `durationMs` değeri `null`'dır — sahte `0` YASAK.**
 * Süre ancak kapanış anı bilindiğinde HESAPLANIR, uydurulmaz.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · abonelik YOK · React YOK.
 * Zaman DIŞARIDAN verilir.
 */

import type {
  DriverPresence, PresenceSource, PresenceConfidence,
} from './driverPresence';

/* ── Kapanış gerekçesi ─────────────────────────────────────────────────── */

export const PRESENCE_CLOSE_REASONS = ['SUPERSEDED', 'TTL_EXPIRED', 'CLEARED'] as const;
export type PresenceCloseReason = (typeof PRESENCE_CLOSE_REASONS)[number];

/** Segmentin okunabilir durumu — açık segment "kapanmış" GÖSTERİLMEZ. */
export const PRESENCE_SEGMENT_STATUSES =
  ['OPEN', 'SUPERSEDED', 'TTL_EXPIRED', 'CLEARED'] as const;
export type PresenceSegmentStatus = (typeof PRESENCE_SEGMENT_STATUSES)[number];

/* ── Kanonik kayıt ─────────────────────────────────────────────────────── */

/**
 * Bir varlık segmenti.
 *
 * ⚠️ Kişisel veri TAŞIMAZ: ad, ehliyet, telefon, e-posta yoktur —
 * yalnız kimlik referansları, kaynak, güven ve zaman.
 */
export interface PresenceHistoryEntry {
  /** Gözlemin ait olduğu araç; bilinmiyorsa `null` (UYDURULMAZ). */
  readonly vehicleId: string | null;
  readonly driverId: string;
  readonly source: PresenceSource;
  readonly confidence: PresenceConfidence;
  /** Segmentin başladığı an (epoch ms). */
  readonly detectedAt: number;
  /** Gözlemin PLANLANAN son geçerlilik anı (TTL). `null` = bilinmiyor. */
  readonly expiresAt: number | null;
  /** Segmentin GERÇEKTEN kapandığı an. `null` = hâlâ açık. */
  readonly expiredAt: number | null;
  /** `expiredAt - detectedAt`. **Açık segmentte `null`** — sahte 0 YOK. */
  readonly durationMs: number | null;
  /** Kapanış gerekçesi; açık segmentte `null` (sessiz kapanış YOK). */
  readonly closeReason: PresenceCloseReason | null;
  /** Aynı segmenti tazeleyen tekrar gözlem sayısı (dedupe kanıtı). */
  readonly refreshCount: number;
  /**
   * Bu segmente DOKUNAN en son gözlemin anı (epoch ms).
   *
   * NEDEN AYRI ALAN (P2): `detectedAt` segmentin BAŞLANGICIDIR ve asla
   * değişmez. Tekrar oynatılan (replay) bir gözlemi ayırt etmek için
   * "en son hangi gözlem işlendi" bilgisi gerekir: çevrimdışı kuyruk veya
   * yeniden başlatma sonrası AYNI gözlem tekrar gelirse segment
   * TAZELENMEMELİ (sayaçlar şişmemeli) — idempotens buradan gelir.
   */
  readonly lastDetectedAt: number;
}

/**
 * Defterin tuttuğu segment SAYISI ÜST SINIRI.
 *
 * Head unit'te sınırsız büyüyen bir dizi bellek sızıntısıdır. 50 segment
 * bir vardiyanın çok ötesini kapsar; taşan EN ESKİ segment düşer ve
 * düştüğü `droppedCount` ile GÖRÜNÜR olur (sessiz kayıp YOK).
 */
export const PRESENCE_HISTORY_MAX_ENTRIES = 50;

export interface PresenceHistoryState {
  /** Eskiden yeniye sıralı. Son eleman en yeni segmenttir. */
  readonly entries: readonly PresenceHistoryEntry[];
  /** SÜRÜCÜ değişimi sayısı — aynı sürücünün kartı yeniden okunması DEĞİL. */
  readonly switchCount: number;
  /** Dedupe ile yutulan tekrar gözlem sayısı. */
  readonly duplicateCount: number;
  /** Sınır aşımında düşen en eski segment sayısı. */
  readonly droppedCount: number;
  /**
   * İDEMPOTENS sayacı: hiçbir şeyi DEĞİŞTİRMEDEN yutulan tekrar gözlemler.
   *
   * `duplicateCount` "aynı segmenti TAZELEYEN yeni gözlem" sayar (segment
   * gerçekten uzadı). `replayCount` ise "zaten işlenmiş gözlemin yeniden
   * gelmesi"dir: çevrimdışı kuyruk tekrarı veya yeniden başlatma sonrası
   * aynı gözlem. Bunlar defteri DEĞİŞTİRMEZ — ayrı sayılır ki "sessiz
   * yutma" olmasın.
   */
  readonly replayCount: number;
}

export const EMPTY_PRESENCE_HISTORY: PresenceHistoryState = Object.freeze({
  entries: Object.freeze([]) as readonly PresenceHistoryEntry[],
  switchCount: 0,
  duplicateCount: 0,
  droppedCount: 0,
  replayCount: 0,
});

/* ── Yardımcılar (saf) ─────────────────────────────────────────────────── */

/**
 * Segment kimliği — DEDUPE'un çekirdeği.
 *
 * Aynı kimliğe sahip yeni gözlem yeni segment AÇMAZ; açık segmenti tazeler.
 */
export function presenceSegmentKey(
  vehicleId: string | null, driverId: string, source: PresenceSource,
): string {
  return `${vehicleId ?? '-'}|${driverId}|${source}`;
}

export function entrySegmentKey(e: PresenceHistoryEntry): string {
  return presenceSegmentKey(e.vehicleId, e.driverId, e.source);
}

/**
 * Segment açık mı (defterde kapanış yazılmamış).
 *
 * ⚠️ İKİ koşul da gerekir (P2): kapanış anı BİLİNMEDEN kapatılmış bir
 * segmentin (`closeReason='CLEARED'`, `expiredAt=null`) yeniden açık
 * sayılması, onun ikinci kez kapatılmasına ve gerekçesinin sessizce
 * değişmesine yol açardı.
 */
export function isOpenSegment(e: PresenceHistoryEntry): boolean {
  return e.expiredAt === null && e.closeReason === null;
}

/**
 * Segmentin VERİLEN ANDAKİ gerçek durumu.
 *
 * Defterde henüz kapatılmamış ama süresi geçmiş bir segment `OPEN`
 * GÖSTERİLMEZ: sunucuda timer yoktur, kapanış tembeldir — okuma anında
 * gerçeği söylemek zorundayız.
 */
export function segmentStatus(e: PresenceHistoryEntry, nowMs: number): PresenceSegmentStatus {
  if (e.closeReason !== null) return e.closeReason;
  if (e.expiresAt !== null && nowMs >= e.expiresAt) return 'TTL_EXPIRED';
  return 'OPEN';
}

/** Segmentin verilen andaki süresi; kapanmışsa kesin, açıksa "şimdiye kadar". */
export function segmentDurationMs(e: PresenceHistoryEntry, nowMs: number): number | null {
  if (e.durationMs !== null) return e.durationMs;
  /* Süresi dolmuş ama defterde kapanmamış segment: gerçek süre TTL'e kadardır. */
  if (e.expiresAt !== null && nowMs >= e.expiresAt) {
    return Math.max(0, e.expiresAt - e.detectedAt);
  }
  if (nowMs < e.detectedAt) return null;   // saat kayması — uydurma süre YOK
  return nowMs - e.detectedAt;
}

function closeEntry(
  e: PresenceHistoryEntry, atMs: number | null, reason: PresenceCloseReason,
): PresenceHistoryEntry {
  /* ── AYNI SEGMENT İKİ KEZ KAPANMAZ (P2 — DB ile aynı sözleşme) ────────
     Kapanmış bir segmentin kapanış anı/süresi/gerekçesi SONRADAN
     değiştirilemez; ilk kapanış kazanır. Bir defterin kapanmış satırının
     sessizce değişmesi onu kanıt olmaktan çıkarır. Çağıran zaten
     `isOpenSegment` ile korur; bu, mantık bozulursa devreye giren son
     savunmadır (PG karşılığı: `trg_presence_history_closure_immutable`). */
  if (e.closeReason !== null || e.expiredAt !== null) return e;

  /* Kapanış anı bilinmiyorsa UYDURULMAZ: gerekçe yazılır, süre `null` kalır. */
  if (atMs === null) {
    return { ...e, expiredAt: null, durationMs: null, closeReason: reason };
  }
  /* Kapanış başlangıçtan önce olamaz (saat kayması / bozuk veri). */
  const at = Math.max(atMs, e.detectedAt);
  return { ...e, expiredAt: at, durationMs: at - e.detectedAt, closeReason: reason };
}

function pushBounded(
  entries: readonly PresenceHistoryEntry[], next: PresenceHistoryEntry,
): { readonly entries: readonly PresenceHistoryEntry[]; readonly dropped: number } {
  const merged = [...entries, next];
  if (merged.length <= PRESENCE_HISTORY_MAX_ENTRIES) {
    return { entries: merged, dropped: 0 };
  }
  const drop = merged.length - PRESENCE_HISTORY_MAX_ENTRIES;
  return { entries: merged.slice(drop), dropped: drop };
}

/* ── TTL uzlaştırma (tembel kapanış) ───────────────────────────────────── */

/**
 * Süresi dolmuş AÇIK segmenti kapatır.
 *
 * Head unit'te presence'ı kapatacak bir timer YOKTUR (ve olmamalıdır —
 * `zero-leak` kuralı). Bu yüzden kapanış tembeldir: yeni bir gözlem
 * geldiğinde veya defter okunduğunda uygulanır. Saf ve idempotenttir.
 */
export function settlePresenceHistory(
  state: PresenceHistoryState, nowMs: number,
): PresenceHistoryState {
  const last = state.entries[state.entries.length - 1];
  if (last === undefined || !isOpenSegment(last)) return state;
  if (last.expiresAt === null || nowMs < last.expiresAt) return state;

  const closed = closeEntry(last, last.expiresAt, 'TTL_EXPIRED');
  return { ...state, entries: [...state.entries.slice(0, -1), closed] };
}

/* ── Defter yazımı ─────────────────────────────────────────────────────── */

export interface PresenceHistoryRecordInput {
  readonly presence: DriverPresence;
  readonly vehicleId: string | null;
  readonly nowMs: number;
}

/**
 * Yeni gözlemi deftere işler (SAF — girdi durumu değişmez).
 *
 * ── SIRA ────────────────────────────────────────────────────────────────
 *  1. Süresi dolmuş açık segmenti kapat (`TTL_EXPIRED`)
 *  2. Gözlem geçersizse (sürücüsüz/kaynaksız) hiçbir şey yazma
 *  3. Açık segment AYNI kimlikte ise → **TAZELE** (yeni satır YOK = dedupe)
 *  4. Açık segment farklı kimlikte ise → `SUPERSEDED` ile kapat
 *  5. Yeni segment aç; sürücü değiştiyse `switchCount` artır
 */
export function recordPresenceHistory(
  state: PresenceHistoryState, input: PresenceHistoryRecordInput,
): PresenceHistoryState {
  const { presence: p, vehicleId, nowMs } = input;

  /* Sürücüsüz veya kaynağı tanınmayan gözlem bir presence DEĞİLDİR —
     defter de onu bir varlık dönemi saymaz. */
  if (p.source === 'UNKNOWN' || p.driverId === null || p.detectedAt === null) {
    return settlePresenceHistory(state, nowMs);
  }

  const settled = settlePresenceHistory(state, nowMs);
  const entries = settled.entries;
  const last = entries[entries.length - 1];
  const key = presenceSegmentKey(vehicleId, p.driverId, p.source);

  /* (3) TAZELEME — aynı sürücü + aynı kaynak: TEK segment kalır.
         Kartı 10 kez okutmak 10 satır ÜRETMEZ; süresi uzar. */
  if (last !== undefined && isOpenSegment(last) && entrySegmentKey(last) === key) {
    /* ── REPLAY İDEMPOTENSİ (P2) ────────────────────────────────────────
       ZATEN İŞLENMİŞ bir gözlem yeniden geldiyse (çevrimdışı kuyruk
       tekrarı veya yeniden başlatma sonrası kalıcı defterin üstüne aynı
       gözlemin düşmesi) defter DEĞİŞMEZ: segment uzamaz, sayaç şişmez.
       "Tekrar" ile "yeni ama aynı kimlikte gözlem" ayrı şeylerdir ve ayrı
       sayılır — sessiz yutma YOK. PG karşılığı:
       `vdph_observation_unique (vehicle_id, driver_id, source, detected_at)`. */
    const notNewer = p.detectedAt <= last.lastDetectedAt;
    const noLongerTtl = p.expiresAt === null
      || (last.expiresAt !== null && p.expiresAt <= last.expiresAt);
    if (notNewer && noLongerTtl) {
      return { ...settled, replayCount: settled.replayCount + 1 };
    }

    const refreshed: PresenceHistoryEntry = {
      ...last,
      /* Segmentin BAŞLANGICI değişmez; yalnız "en son işlenen gözlem" ilerler. */
      lastDetectedAt: Math.max(last.lastDetectedAt, p.detectedAt),
      /* Yeni gözlemin güveni geçerlidir (kaynak tavanı zaten uygulanmıştır). */
      confidence: p.confidence,
      /* Süre YALNIZ uzar — geç gelen bayat gözlem segmenti KISALTMAZ. */
      expiresAt: last.expiresAt === null ? p.expiresAt
        : p.expiresAt === null ? last.expiresAt
        : Math.max(last.expiresAt, p.expiresAt),
      refreshCount: last.refreshCount + 1,
    };
    return {
      ...settled,
      entries: [...entries.slice(0, -1), refreshed],
      duplicateCount: settled.duplicateCount + 1,
    };
  }

  /* (4) DEVİR — açık segment başka bir presence tarafından kapatılır.
         Kapanış anı, yeni gözlemin başlangıcını AŞAMAZ ve eski segmentin
         kendi TTL'ini de aşamaz (ölmüş segment "devredildi" sayılmaz). */
  let base = entries;
  let switches = settled.switchCount;
  if (last !== undefined && isOpenSegment(last)) {
    const at = last.expiresAt === null
      ? p.detectedAt : Math.min(p.detectedAt, last.expiresAt);
    base = [...entries.slice(0, -1), closeEntry(last, at, 'SUPERSEDED')];
    /* SÜRÜCÜ değişimi sayılır; aynı sürücünün kaynak değiştirmesi
       (kart → telefon) bir "el değiştirme" DEĞİLDİR. */
    if (last.driverId !== p.driverId) switches += 1;
  } else if (last !== undefined && last.driverId !== p.driverId) {
    switches += 1;
  }

  const opened: PresenceHistoryEntry = {
    vehicleId,
    driverId: p.driverId,
    source: p.source,
    confidence: p.confidence,
    detectedAt: p.detectedAt,
    expiresAt: p.expiresAt,
    expiredAt: null,
    durationMs: null,
    closeReason: null,
    refreshCount: 0,
    lastDetectedAt: p.detectedAt,
  };

  const { entries: nextEntries, dropped } = pushBounded(base, opened);
  return {
    entries: nextEntries,
    switchCount: switches,
    duplicateCount: settled.duplicateCount,
    droppedCount: settled.droppedCount + dropped,
    replayCount: settled.replayCount,
  };
}

/**
 * Açık segmenti elle kapatır (oturum sonu / araç değişimi).
 *
 * `atMs` verilmezse kapanış anı **UYDURULMAZ**: gerekçe yazılır, süre
 * `null` kalır. Yanlış bir zaman damgası, süresi yok olan bir segmentten
 * daha zararlıdır.
 */
export function closePresenceHistory(
  state: PresenceHistoryState, atMs: number | null,
): PresenceHistoryState {
  const settled = atMs === null ? state : settlePresenceHistory(state, atMs);
  const last = settled.entries[settled.entries.length - 1];
  if (last === undefined || !isOpenSegment(last)) return settled;
  return {
    ...settled,
    entries: [...settled.entries.slice(0, -1), closeEntry(last, atMs, 'CLEARED')],
  };
}

/* ── Özet (LAB gözlem yüzeyi) ──────────────────────────────────────────── */

export interface PresenceHistorySummary {
  /** ŞU AN açık ve süresi geçmemiş segment; yoksa `null`. */
  readonly current: PresenceHistoryEntry | null;
  /** Ondan bir öncekinin segmenti; yoksa `null`. */
  readonly previous: PresenceHistoryEntry | null;
  /** Açık segmentin şimdiye kadarki süresi; segment yoksa `null`. */
  readonly currentDurationMs: number | null;
  /** Kapanmış önceki segmentin KESİN süresi; yoksa `null`. */
  readonly previousDurationMs: number | null;
  readonly currentStatus: PresenceSegmentStatus | null;
  readonly switchCount: number;
  readonly segmentCount: number;
  readonly duplicateCount: number;
  readonly droppedCount: number;
  /** Hiçbir şeyi değiştirmeden yutulan tekrar gözlem sayısı (idempotens kanıtı). */
  readonly replayCount: number;
  /**
   * Süresi DOLMUŞ segment sayısı (verilen ana göre).
   *
   * Defterde henüz kapatılmamış ama TTL'i geçmiş segmentler de sayılır —
   * kapanış tembeldir, gerçeği okuma anında söylemek zorundayız.
   */
  readonly expiredSegmentCount: number;
  /** Yeniden eskiye sıralı defter (LAB listesi için). */
  readonly entries: readonly PresenceHistoryEntry[];
}

export const EMPTY_PRESENCE_HISTORY_SUMMARY: PresenceHistorySummary = Object.freeze({
  current: null, previous: null,
  currentDurationMs: null, previousDurationMs: null, currentStatus: null,
  switchCount: 0, segmentCount: 0, duplicateCount: 0, droppedCount: 0,
  replayCount: 0, expiredSegmentCount: 0,
  entries: Object.freeze([]) as readonly PresenceHistoryEntry[],
});

/**
 * Defteri gözlem yüzeyine çevirir (SAF — durumu DEĞİŞTİRMEZ).
 *
 * TTL uzlaştırması burada da uygulanır: süresi geçmiş bir segment "şu anki
 * sürücü" olarak SUNULMAZ, `previous` tarafına düşer.
 */
export function summarizePresenceHistory(
  state: PresenceHistoryState, nowMs: number,
): PresenceHistorySummary {
  const settled = settlePresenceHistory(state, nowMs);
  const list = settled.entries;
  const last = list[list.length - 1] ?? null;

  const lastIsCurrent = last !== null && segmentStatus(last, nowMs) === 'OPEN';
  const current = lastIsCurrent ? last : null;
  const previous = lastIsCurrent
    ? (list[list.length - 2] ?? null)
    : last;

  return {
    current,
    previous,
    currentDurationMs: current === null ? null : segmentDurationMs(current, nowMs),
    previousDurationMs: previous === null ? null : segmentDurationMs(previous, nowMs),
    currentStatus: last === null ? null : segmentStatus(last, nowMs),
    switchCount: settled.switchCount,
    segmentCount: list.length,
    duplicateCount: settled.duplicateCount,
    droppedCount: settled.droppedCount,
    replayCount: settled.replayCount,
    expiredSegmentCount: list.reduce(
      (n, e) => (segmentStatus(e, nowMs) === 'TTL_EXPIRED' ? n + 1 : n), 0),
    entries: [...list].reverse(),
  };
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function presenceCloseReasonLabel(r: PresenceCloseReason | null): string {
  switch (r) {
    case 'SUPERSEDED':  return 'Yerine başka sürücü geçti';
    case 'TTL_EXPIRED': return 'Gözlemin süresi doldu';
    case 'CLEARED':     return 'Oturum temizlendi';
    case null:          return 'Açık';
  }
}

export function presenceSegmentStatusLabel(s: PresenceSegmentStatus): string {
  switch (s) {
    case 'OPEN':        return 'Açık';
    case 'SUPERSEDED':  return 'Devredildi';
    case 'TTL_EXPIRED': return 'Süresi doldu';
    case 'CLEARED':     return 'Temizlendi';
  }
}
