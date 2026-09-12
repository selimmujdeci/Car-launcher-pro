/**
 * pidDiscoveryModel — PID KEŞİF KANITININ SAF EKRAN MODELİ (P0-OBD-CORE-01B).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ── MODELİN TEK İŞİ ───────────────────────────────────────────────────────
 * "Hangi bitmap bloğu soruldu, kaç kez denendi, ne geldi, süreklilik biti ne
 * dedi, zincir NEREDE ve NEDEN durdu" sorusunu ekrana çevirmek.
 * YENİ HÜKÜM ÜRETMEZ — `buildHandshakeResult` / `buildDiscoveryEvidence`
 * içinde verilmiş hükmü yalnız GÖSTERİR (ikinci otorite YOK).
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────────
 *  · `supportedCount` TEK BAŞINA gösterilmez; her zaman `completeness` ile
 *    birlikte durur. Keşif kırıldıysa o sayı bir TAVAN değil ALT SINIRDIR.
 *  · "hiç sorulmadı" ile "soruldu ama cevap gelmedi" AYRI gösterilir.
 *  · Ölçülmemiş alan `UNAVAILABLE` — sahte 0 YASAK.
 */

import type { DiscoveryBlockEvidence, DiscoveryBlockOutcome } from '../../core/val/OBDHandshake';

export type DiscoveryTone = 'ok' | 'warn' | 'bad' | 'muted';

/** Ölçülemeyen alanın TEK gösterimi. */
export const DISCOVERY_NA = 'UNAVAILABLE' as const;

/** Blok sonucu → Türkçe etiket. UI bunu ELLE yazmaz. */
export const BLOCK_OUTCOME_LABEL: Readonly<Record<DiscoveryBlockOutcome, string>> = {
  OK:                'okundu',
  NO_DATA:           'ECU SUSTU (NO DATA)',
  TIMEOUT_NO_BYTES:  'ZAMAN AŞIMI — hiç bayt yok',
  TIMEOUT_PARTIAL:   'YARIM YANIT',
  NEGATIVE_RESPONSE: 'araç bu bloğu bilmiyor (7F 01)',
  ERROR:             'hat/protokol hatası',
  PARSE_ERROR:       'BOZUK bitmap (4 bayt yok)',
  NOT_ATTEMPTED:     'HİÇ SORULMADI',
} as const;

/**
 * Sonuç → ton.
 * `NEGATIVE_RESPONSE` **muted**: bu bir HATA DEĞİL, aracın açık cevabıdır.
 * `NOT_ATTEMPTED` **muted**: zincir meşru bittiyse sorulmaması normaldir.
 * Cevapsızlık sınıfları ASLA yeşil gösterilmez.
 */
export function blockOutcomeTone(o: DiscoveryBlockOutcome): DiscoveryTone {
  switch (o) {
    case 'OK':                return 'ok';
    case 'NEGATIVE_RESPONSE': return 'muted';
    case 'NOT_ATTEMPTED':     return 'muted';
    default:                  return 'bad';
  }
}

export type Completeness = 'complete' | 'incomplete' | 'not_run';

export const COMPLETENESS_LABEL: Readonly<Record<Completeness, string>> = {
  complete:   'KEŞİF TAM',
  incomplete: 'KEŞİF EKSİK',
  not_run:    'KEŞİF ÇALIŞMADI',
} as const;

/** Kullanıcıya söylenecek dürüst cümle — tek metin kaynağı. */
export const COMPLETENESS_MESSAGE: Readonly<Record<Completeness, string>> = {
  complete:
    'Süreklilik zinciri kesin bir sonla bitti. Okunmayan bloklar için '
    + '"araç desteklemiyor" demek GÜVENLİDİR.',
  incomplete:
    'Zincir cevapsızlık/hata yüzünden KIRILDI. Okunmayan blokların PID’leri '
    + 'BİLİNMİYOR — "araç desteklemiyor" DEMEK DEĞİLDİR. Desteklenen PID sayısı '
    + 'bir TAVAN değil, ALT SINIRDIR.',
  not_run:
    'Hiç bitmap bloğu okunmadı. "0 PID" bir ölçüm DEĞİLDİR.',
} as const;

export function completenessTone(c: Completeness): DiscoveryTone {
  switch (c) {
    case 'complete':   return 'ok';
    case 'incomplete': return 'bad';
    default:           return 'muted';
  }
}

/* ── Satır modeli ───────────────────────────────────────────────────────── */

export interface DiscoveryBlockRow {
  readonly id: string;
  /** "0100" · "0120" … */
  readonly command: string;
  readonly outcomeLabel: string;
  readonly tone: DiscoveryTone;
  /** Ham yanıt önizlemesi (bounded hex) ya da `UNAVAILABLE`. */
  readonly raw: string;
  /** 4 bitmap baytı ya da `UNAVAILABLE`. */
  readonly bitmapBytes: string;
  /** "SET (sonraki blok sorulmalı)" · "CLEAR (zincir biter)" · "BİLİNMİYOR". */
  readonly continuation: string;
  /** "1 deneme" · "2 deneme (RETRY)" · `UNAVAILABLE`. */
  readonly attempts: string;
  /** Bu blokta retry koştu mu (native ölçtüyse). */
  readonly retried: boolean;
}

const CONTINUATION_LABEL: Readonly<Record<string, string>> = {
  SET:     'SET — sonraki blok sorulmalı',
  CLEAR:   'CLEAR — zincir burada biter',
  UNKNOWN: 'BİLİNMİYOR — karar verilemedi',
} as const;

/**
 * Blok kanıtlarını + deneme sayaçlarını ekran satırlarına çevirir. Saf.
 *
 * @param blocks  `buildDiscoveryEvidence(...).blocks` (≤6, bounded)
 * @param attempts native `blockAttempts` (blok sırasıyla); boş = ölçülmedi
 */
export function buildDiscoveryRows(
  blocks: readonly DiscoveryBlockEvidence[],
  attempts: readonly number[],
): DiscoveryBlockRow[] {
  return blocks.map((b, i) => {
    const n = attempts[i];
    const measured = typeof n === 'number';
    return {
      id:           `blk-${b.block}`,
      command:      b.command,
      outcomeLabel: BLOCK_OUTCOME_LABEL[b.outcome] ?? String(b.outcome),
      tone:         blockOutcomeTone(b.outcome),
      /* Boş önizleme "ham geldi ama boştu" demek olurdu → UNAVAILABLE. */
      raw:          b.normalizedResponsePreview.length > 0 ? b.normalizedResponsePreview : DISCOVERY_NA,
      bitmapBytes:  b.bitmapBytes ?? DISCOVERY_NA,
      continuation: CONTINUATION_LABEL[b.continuation] ?? DISCOVERY_NA,
      attempts:     !measured ? DISCOVERY_NA
                  : n === 0   ? 'sorulmadı'
                  : n === 1   ? '1 deneme'
                  : `${n} deneme (RETRY)`,
      retried:      measured && n > 1,
    };
  });
}

/* ── Üst özet ───────────────────────────────────────────────────────────── */

export interface DiscoveryStat {
  readonly label: string;
  readonly value: string;
  readonly tone: DiscoveryTone;
}

/**
 * Üst özet. **`supportedCount` ASLA yalnız başına gösterilmez** — etiketi
 * completeness'e göre değişir; bu turun tüm meselesi budur.
 */
export function buildDiscoveryStats(input: {
  readonly completeness: Completeness;
  readonly supportedCount: number;
  readonly readBlocks: readonly string[];
  readonly attemptedBlocks: readonly string[];
  readonly failedBlock: string | null;
  readonly retryTotal: number | null;
}): DiscoveryStat[] {
  const incomplete = input.completeness === 'incomplete';
  return [
    {
      label: COMPLETENESS_LABEL[input.completeness],
      value: input.failedBlock !== null ? `kırıldı → 01${input.failedBlock}` : '—',
      tone:  completenessTone(input.completeness),
    },
    {
      // Etiket hükmü taşır: eksik keşifte sayı bir ALT SINIRDIR.
      label: incomplete ? 'Desteklenen PID (EN AZ)' : 'Desteklenen PID',
      value: input.completeness === 'not_run' ? DISCOVERY_NA : String(input.supportedCount),
      tone:  input.completeness === 'not_run' ? 'muted' : incomplete ? 'warn' : 'ok',
    },
    {
      label: 'Okunan blok',
      value: input.readBlocks.length === 0 ? DISCOVERY_NA : input.readBlocks.map((b) => `01${b}`).join(' '),
      tone:  input.readBlocks.length === 0 ? 'muted' : 'ok',
    },
    {
      label: 'Denenen blok',
      value: input.attemptedBlocks.length === 0 ? DISCOVERY_NA : input.attemptedBlocks.map((b) => `01${b}`).join(' '),
      tone:  input.attemptedBlocks.length === 0 ? 'muted' : 'ok',
    },
    {
      label: 'Toplam yeniden deneme',
      value: input.retryTotal === null ? DISCOVERY_NA : String(input.retryTotal),
      tone:  input.retryTotal === null ? 'muted' : input.retryTotal > 0 ? 'warn' : 'ok',
    },
  ];
}

/** `blockAttempts` toplamından retry adedi (deneme−1 toplamı). `null` = ölçülmedi. */
export function totalRetries(attempts: readonly number[]): number | null {
  if (attempts.length === 0) return null;
  let r = 0;
  for (const n of attempts) if (n > 1) r += n - 1;
  return r;
}
