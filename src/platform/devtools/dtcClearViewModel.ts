/**
 * dtcClearViewModel — DTC SİLME KANITININ SAF EKRAN MODELİ (P0-OBD-10).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 * Tüm girdi çağırandan gelir; aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── MODELİN TEK İŞİ ───────────────────────────────────────────────────────
 * "Ne gönderildi, ECU ne cevapladı, sonra 03/07/0A ne döndü, hüküm ne oldu"
 * sorusunu ekrana çevirmek. YENİ HÜKÜM ÜRETMEZ — hüküm `dtcClearModel` içinde,
 * silme anında verilmiştir; bu katman onu yalnız GÖSTERİR (ikinci otorite yok).
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────────
 *  · Ham yanıt taşınmıyorsa `UNAVAILABLE` yazılır — boş string "ham geldi ama
 *    boştu" demek olurdu (sahte kanıt).
 *  · Kapı reddi bir BAŞARISIZLIK DEĞİLDİR ama BAŞARI da değildir; ayrı tonda.
 *  · KALICI (Mode 0A) kodun durması kırmızı gösterilmez — Mode 04 onu silemez.
 *  · Yalnız gerçekten ölçülmüş alanlar gösterilir; eksik alan `UNAVAILABLE`.
 */

import {
  DTC_CLEAR_OUTCOME_LABEL, DTC_CLEAR_VERDICT_LABEL, DTC_CLEAR_VERDICT_MESSAGE,
  describeClearNrc, isClearSuccessVerdict,
  type DtcClearCommandOutcome, type DtcClearVerdict,
} from '../obd/dtcClearModel';
import type {
  DtcClearAttempt, DtcClearEvidenceSummary, DtcClearRereadOutcome,
} from '../obd/dtcClearEvidence';

export type ClearTone = 'ok' | 'warn' | 'bad' | 'muted';

/** Ölçülmemiş alanın TEK gösterimi — sahte 0/boş string YASAK. */
export const UNAVAILABLE = 'UNAVAILABLE' as const;

/** Hüküm → ton. Kapı reddi `muted`: bir arıza değil, bilinçli engellemedir. */
export function verdictTone(v: DtcClearVerdict): ClearTone {
  if (isClearSuccessVerdict(v)) return 'ok';
  switch (v) {
    case 'DENIED':                     return 'muted';
    case 'CLEARED_BUT_RETURNED':       return 'warn';
    case 'UNVERIFIED':                 return 'warn';
    case 'INDETERMINATE_CODES_REMAIN': return 'warn';
    default:                           return 'bad';   // COMMAND_FAILED
  }
}

/** Komut sonucu → ton. `POSITIVE` tek başına yeşil DEĞİLDİR — yalnız nötr-iyi. */
export function commandTone(o: DtcClearCommandOutcome | null): ClearTone {
  if (o === null) return 'muted';
  switch (o) {
    case 'POSITIVE': return 'ok';
    case 'UNKNOWN':  return 'warn';
    default:         return 'bad';
  }
}

/**
 * Silme sonrası sınıf okuması → ton. `unsupported` hata DEĞİLDİR (araçta o servis
 * yok — ölçülmüş gerçek). `no_response` ise KAPSAM KAYBIDIR: ECU sustuğu için
 * silmenin doğrulanması yapılamadı — asla yeşil/nötr gösterilmez.
 */
export function rereadTone(outcome: DtcClearRereadOutcome): ClearTone {
  switch (outcome) {
    case 'ok':          return 'ok';
    case 'unsupported': return 'muted';
    case 'not_run':     return 'muted';
    // P0-OBD-CORE-05: admisyon kapısı bloke etti — bir ARIZA değil, bilinçli erteleme.
    case 'deferred':    return 'muted';
    default:            return 'bad';   // failed · no_response
  }
}

const REREAD_OUTCOME_LABEL: Readonly<Record<DtcClearRereadOutcome, string>> = {
  ok:          'okundu',
  unsupported: 'araç bu servisi desteklemiyor',
  failed:      'okuma DÜŞTÜ — doğrulama kısmi',
  no_response: 'ECU YANIT VERMEDİ — silme doğrulanamadı',
  not_run:     'HİÇ SORULMADI',
  deferred:    'ERTELENDİ — oturum hazır değildi, doğrulama yapılamadı',
} as const;

/* ── Satır modeli ───────────────────────────────────────────────────────── */

export interface ClearRereadRow {
  readonly id: string;
  /** "Mode 07 — BEKLEYEN" */
  readonly title: string;
  readonly outcomeLabel: string;
  readonly tone: ClearTone;
  /** Kod listesi metni; kod yoksa "0 kod" (bu "arıza yok" DEMEK DEĞİLDİR). */
  readonly codesText: string;
}

export interface ClearAttemptRow {
  readonly id: string;
  readonly atMs: number;
  readonly sessionEpoch: number;

  /* Komut */
  readonly txText: string;
  readonly rawText: string;
  readonly scopeText: string;
  readonly protocolText: string;
  readonly elapsedText: string;
  readonly commandLabel: string;
  readonly commandTone: ClearTone;
  /** Negatif yanıt açıklaması; yoksa `null` (satır hiç çizilmez). */
  readonly nrcText: string | null;

  /* Kapı */
  readonly gateText: string;

  /* Ölçüm */
  readonly beforeText: string;
  readonly rereadRows: readonly ClearRereadRow[];

  /* Hüküm */
  readonly verdict: DtcClearVerdict;
  readonly verdictLabel: string;
  readonly verdictMessage: string;
  readonly verdictTone: ClearTone;
  readonly removedText: string;
  readonly remainingText: string;
  readonly returnedText: string;
  readonly permanentText: string;
}

const CLASS_TITLE: Readonly<Record<'03' | '07' | '0A', string>> = {
  '03': 'Mode 03 — ONAYLANMIŞ',
  '07': 'Mode 07 — BEKLEYEN',
  '0A': 'Mode 0A — KALICI',
} as const;

const GATE_DENY_TEXT: Readonly<Record<string, string>> = {
  not_connected:  'REDDEDİLDİ — araç bağlı değil',
  stale_data:     'REDDEDİLDİ — telemetri bayat (hız doğrulanamıyor)',
  speed_unknown:  'REDDEDİLDİ — araç hız vermiyor',
  vehicle_moving: 'REDDEDİLDİ — araç hareket halinde',
  not_confirmed:  'REDDEDİLDİ — kullanıcı onayı yok',
} as const;

function listText(items: readonly string[]): string {
  return items.length === 0 ? '—' : items.join(' · ');
}

/** Tek denemeyi ekran satırına çevirir. Saf. */
export function buildClearAttemptRow(a: DtcClearAttempt, index: number): ClearAttemptRow {
  const rereadRows: ClearRereadRow[] = a.reread.map((r) => ({
    id:           `${index}-${r.service}`,
    title:        CLASS_TITLE[r.service],
    outcomeLabel: REREAD_OUTCOME_LABEL[r.outcome],
    tone:         rereadTone(r.outcome),
    codesText:    r.outcome === 'ok'
      ? (r.codes.length === 0 ? '0 kod' : r.codes.join(' · '))
      : UNAVAILABLE,
  }));

  return {
    id:           `clear-${index}-${a.atMs}`,
    atMs:         a.atMs,
    sessionEpoch: a.sessionEpoch,

    /* Komut gönderilmediyse "04" YAZILMAZ — gitmemiş bir komutu yazmak yalandır. */
    txText:       a.tx ?? UNAVAILABLE,
    /* Ham yanıt yoksa UNAVAILABLE: boş string "ham geldi ama boştu" demek olurdu. */
    rawText:      a.raw === null || a.raw.length === 0 ? UNAVAILABLE : a.raw,
    /* Ürün Mode 04'ü FONKSİYONEL adresle yayınlar; belirli bir ECU seçilmez. */
    scopeText:    a.scope === 'functional_7DF' ? 'FONKSİYONEL (7DF) — tüm emisyon ECU’ları' : UNAVAILABLE,
    protocolText: a.protocol === null ? UNAVAILABLE : `ATDPN ${a.protocol}`,
    elapsedText:  a.elapsedMs === null ? UNAVAILABLE : `${a.elapsedMs} ms`,
    commandLabel: a.commandOutcome === null
      ? 'GÖNDERİLMEDİ'
      : DTC_CLEAR_OUTCOME_LABEL[a.commandOutcome],
    commandTone:  commandTone(a.commandOutcome),
    nrcText:      a.commandOutcome === 'NEGATIVE'
      ? `7F 04 ${a.nrc ?? '??'} — ${describeClearNrc(a.nrc) ?? 'açıklama yok'}`
      : null,

    gateText: a.gateAllowed
      ? 'GEÇTİ — komut ECU’ya gönderildi'
      : (GATE_DENY_TEXT[a.gateDenyReason ?? ''] ?? 'REDDEDİLDİ'),

    beforeText: listText(a.before),
    rereadRows,

    verdict:        a.verdict,
    verdictLabel:   DTC_CLEAR_VERDICT_LABEL[a.verdict],
    verdictMessage: DTC_CLEAR_VERDICT_MESSAGE[a.verdict],
    verdictTone:    verdictTone(a.verdict),
    removedText:    listText(a.removed),
    remainingText:  listText(a.remaining),
    returnedText:   listText(a.returned),
    permanentText:  listText(a.permanentRemaining),
  };
}

/* ── Üst özet ───────────────────────────────────────────────────────────── */

export interface ClearHeaderStat {
  readonly label: string;
  readonly value: string;
  readonly tone: ClearTone;
}

/**
 * Üst özet satırları. "Doğrulanmış silme" ile "ECU onayı" AYRI sayılır —
 * bu turun tüm meselesi ikisinin AYNI ŞEY OLMADIĞIDIR.
 */
export function buildClearHeaderStats(
  s: DtcClearEvidenceSummary,
  sessionEpoch: number | null,
  detailedBridgeAvailable: boolean,
): readonly ClearHeaderStat[] {
  return [
    { label: 'Deneme',            value: String(s.total),  tone: s.total === 0 ? 'muted' : 'ok' },
    { label: 'ECU’ya gönderildi', value: String(s.sent),   tone: s.sent === 0 ? 'muted' : 'ok' },
    { label: 'Kapı reddetti',     value: String(s.denied), tone: s.denied === 0 ? 'muted' : 'warn' },
    { label: 'ECU onayı (44)',    value: String(s.ecuPositive), tone: s.ecuPositive === 0 ? 'muted' : 'ok' },
    {
      label: 'DOĞRULANMIŞ silme',
      value: String(s.verifiedCleared),
      // ECU onay verdiği hâlde doğrulanmış silme yoksa bu bir UYARIDIR:
      // tam olarak sahadaki kusurun imzası budur.
      tone: s.verifiedCleared === 0 ? (s.ecuPositive > 0 ? 'bad' : 'muted') : 'ok',
    },
    {
      label: 'Oturum',
      value: sessionEpoch === null ? UNAVAILABLE : `#${sessionEpoch}`,
      tone:  sessionEpoch === null ? 'muted' : 'ok',
    },
    {
      label: 'Kanıt köprüsü',
      value: detailedBridgeAvailable ? 'VAR (ham TX/RX)' : 'YOK (eski plugin)',
      tone:  detailedBridgeAvailable ? 'ok' : 'warn',
    },
    {
      label: 'Karışık oturum',
      value: s.mixedEpochs ? 'EVET — defter karışık' : 'hayır',
      tone:  s.mixedEpochs ? 'bad' : 'ok',
    },
  ];
}
