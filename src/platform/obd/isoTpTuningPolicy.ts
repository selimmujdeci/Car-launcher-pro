/**
 * isoTpTuningPolicy — P0-VDK-F1C · ISO-TP TUNING KARARI + KANITI (SAF ÇEKİRDEK).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen transport borcu) ───────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Ürün parser'ı, dedup'ı, otoriteyi ve UI'yi düzeltti — ama **hattın kendisini
 * hiç ayarlamadı**. UDS 0x19-02 yanıtı 20 DTC'de ≈ 83 bayt ≈ **13 ISO-TP
 * çerçevesidir**. ELM327 varsayılan (otomatik) flow control modunda bu akışı
 * kendi seçtiği blok boyutu/STmin ile yönetir; yavaş ya da bloklu bir akış
 * `BUFFER FULL` ya da kesilmiş (truncated) yanıt üretebilir — ve ürün bunu
 * bugüne kadar `malformed` sanıyordu.
 *
 * `ATFCSH`/`ATFCSD`/`ATFCSM` ile flow control çerçevesi AÇIKÇA kurulur:
 * FS=0x30 (ContinueToSend) · BS=0x00 (blok sınırı yok) · STmin=0x00 (bekleme yok).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPSAM SINIRI (kod kanıtına dayalı — varsayım değil) ──────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * · **`ATCAF` DOKUNULMAZ.** `ElmProtocol.splitResponseBodies` ELM327'nin
 *   ISO-TP BİRLEŞTİRMESİNE dayanır ("1:" / "2:" önekli segmentleri birleştirir).
 *   `ATCAF0` ISO-TP'yi tamamen bize devreder → ham CAN çerçeveleri gelir →
 *   mevcut çözücülerin TAMAMI bozulur. Kazanç yok, risk büyük.
 * · **`ATCRA` DOKUNULMAZ.** ZATEN `ElmProtocol.setEcuHeader` ayarlıyor ve
 *   `restoreDefaultHeader()` geri alıyor. İkinci otorite o atomikliği bozardı.
 * · **KWP/ISO 9141'de HİÇ ÇALIŞMAZ.** Flow control bir CAN (ISO 15765-2)
 *   kavramıdır; K-line'da karşılığı YOKTUR. CAN mantığını oraya kopyalamak
 *   anlamsız komut trafiği üretir ve klonlarda "?" döner.
 * · **PID polling'e DOKUNULMAZ.** Yalnız çok-frame beklenen UDS 0x19 okumaları.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

import type { AdapterCapabilities } from './adapterCapability';

/* ══════════════════════════════════════════════════════════════════════════
   1) KARAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Tuning neden uygulanmadı/uygulandı — sessiz atlama YASAK. */
export type TuningDecision =
  /** Uygulanır: CAN + adaptör flow-control yeteneği KANITLI + çok-frame yol. */
  | 'APPLY'
  /** Adaptör kimliği okunamadı → yetenek VARSAYILMAZ (fail-closed). */
  | 'SKIP_ADAPTER_UNKNOWN'
  /** Klon/yeteneksiz adaptör → komutlar "?" döner, zorlamak anlamsız. */
  | 'SKIP_ADAPTER_INCAPABLE'
  /** Yavaş seri hat (KWP/ISO9141) — flow control CAN kavramıdır. */
  | 'SKIP_NOT_CAN'
  /** Bu okuma çok-frame beklemiyor (kısa yanıt) — gereksiz komut trafiği. */
  | 'SKIP_NOT_MULTIFRAME'
  /** Aynı işlemde bu ECU için tuning ZATEN uygulandı (çift tuning yok). */
  | 'SKIP_ALREADY_TUNED'
  /** Native köprü bu yeteneği taşımıyor (eski APK). */
  | 'SKIP_NO_BRIDGE';

export const TUNING_DECISION_LABEL: Readonly<Record<TuningDecision, string>> = {
  APPLY:                   'uygulanır',
  SKIP_ADAPTER_UNKNOWN:    'adaptör kimliği BİLİNMİYOR — yetenek varsayılmaz',
  SKIP_ADAPTER_INCAPABLE:  'adaptör flow-control desteklemiyor (klon)',
  SKIP_NOT_CAN:            'CAN değil — flow control K-line’da yoktur',
  SKIP_NOT_MULTIFRAME:     'çok-frame beklenmiyor',
  SKIP_ALREADY_TUNED:      'bu işlemde ZATEN uygulandı',
  SKIP_NO_BRIDGE:          'native köprü taşımıyor (eski APK)',
} as const;

/**
 * Çok-frame BEKLENEN UDS 0x19 alt fonksiyonları.
 *
 * `02` (reportDTCByStatusMask) ve `0A` (reportSupportedDTC) DTC LİSTESİ
 * döndürür ve liste uzunsa kesinlikle çok-frame olur. `01` (sayı), `03`
 * (snapshot kimliği) ve `06` (tek DTC extended data) kısa yanıtlardır —
 * onlarda tuning gereksiz hat trafiğidir.
 */
export const MULTIFRAME_UDS_SUBFUNCTIONS: readonly string[] = ['02', '0A'] as const;

export function isMultiFrameExpected(service: string, subFunction: string): boolean {
  return service === '19' && MULTIFRAME_UDS_SUBFUNCTIONS.includes(subFunction.toUpperCase());
}

export interface TuningDecisionInput {
  readonly service: string;
  readonly subFunction: string;
  /** ATDPN protokol hanesi; `null` = ölçülemedi → fail-closed. */
  readonly protocol: string | null;
  /** Mevcut adaptör yetenek otoritesi; `null` = kimlik okunamadı. */
  readonly adapter: AdapterCapabilities | null;
  /** Yavaş seri (KWP/ISO9141) mi — `protocolProfile` otoritesinden gelir. */
  readonly slowSerial: boolean;
  /** Bu (işlem × ECU) için tuning zaten uygulandı mı. */
  readonly alreadyTuned: boolean;
  /** Native köprü `isoTpTuning` parametresini taşıyor mu. */
  readonly bridgeAvailable: boolean;
}

/**
 * Tuning kararı (SAF, FAIL-CLOSED).
 *
 * SIRA ÖNEMLİ: en ucuz ve en kesin eleme önce. Adaptör yeteneği ETİKETTEN
 * değil, mevcut `adapterCapability` otoritesinin KANITA dayalı sınıfından
 * okunur — ikinci bir yetenek otoritesi KURULMAZ.
 */
export function decideIsoTpTuning(i: TuningDecisionInput): TuningDecision {
  if (!i.bridgeAvailable) return 'SKIP_NO_BRIDGE';
  if (!isMultiFrameExpected(i.service, i.subFunction)) return 'SKIP_NOT_MULTIFRAME';
  if (i.alreadyTuned) return 'SKIP_ALREADY_TUNED';
  /* Protokol ölçülemediyse CAN olduğunu VARSAYMAYIZ. */
  if (i.protocol === null || i.slowSerial) return 'SKIP_NOT_CAN';
  if (i.adapter === null || i.adapter.kind === 'unknown') return 'SKIP_ADAPTER_UNKNOWN';
  if (!i.adapter.flowControl) return 'SKIP_ADAPTER_INCAPABLE';
  return 'APPLY';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SONUÇ SINIFLANDIRMASI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Çok-frame okumasının TRANSPORT sonucu — dördü AYRI kalır.
 *
 * ÖLÇÜLEN KUSUR: `BUFFER FULL` ve kesilmiş yanıt bugüne kadar `malformed`
 * kutusuna düşüyordu. İkisi FARKLI kök nedendir: birincisi adaptör tamponu
 * taştı (tuning yardım EDEBİLİR), ikincisi akış yarıda kesildi.
 */
export type TransportOutcome =
  /** Yanıt tam geldi ve çözüldü. */
  | 'COMPLETE'
  /** Adaptör tamponu taştı — ELM327 "BUFFER FULL". */
  | 'BUFFER_FULL'
  /** Yanıt geldi ama kayıt sınırına oturmuyor — akış YARIDA kesilmiş. */
  | 'TRUNCATED'
  /** Zaman aşımı — akış hiç tamamlanmadı. */
  | 'TIMEOUT'
  /** Yanıt tanınmadı (BUFFER_FULL/TRUNCATED DIŞI bozukluk). */
  | 'MALFORMED'
  /** Ölçülemedi — FAIL-CLOSED, asla "tamam" sayılmaz. */
  | 'UNKNOWN';

export const TRANSPORT_OUTCOME_LABEL: Readonly<Record<TransportOutcome, string>> = {
  COMPLETE:    'yanıt tam',
  BUFFER_FULL: 'ADAPTÖR TAMPONU TAŞTI (BUFFER FULL)',
  TRUNCATED:   'YANIT KESİLDİ (çok-frame yarıda)',
  TIMEOUT:     'zaman aşımı',
  MALFORMED:   'yanıt tanınmadı',
  UNKNOWN:     'ÖLÇÜLEMEDİ',
} as const;

/**
 * Ham yanıttan transport sonucunu sınıflar (SAF).
 *
 * `expectedRecordBytes` verilirse gövdenin kayıt sınırına oturup oturmadığı
 * ölçülür: oturmuyorsa `TRUNCATED` (akış yarıda kesildi) — `MALFORMED`
 * DEĞİL, çünkü kök neden farklıdır ve tuning bunu düzeltebilir.
 */
export function classifyTransportOutcome(
  nativeOutcome: string,
  rawBody: string | null,
  errorText: string | null,
  expectedRecordBytes: number | null = null,
): TransportOutcome {
  const err = (errorText ?? '').toUpperCase().replace(/\s+/g, '');
  if (err.includes('BUFFERFULL')) return 'BUFFER_FULL';
  if (nativeOutcome === 'timeout') return 'TIMEOUT';
  if (nativeOutcome === 'ok') {
    const hex = (rawBody ?? '').replace(/[^0-9A-Fa-f]/g, '');
    if (hex.length === 0) return 'UNKNOWN';
    if (expectedRecordBytes !== null && expectedRecordBytes > 0) {
      /* Gövde: 1 bayt availability + N × kayıt. Oturmuyorsa akış kesilmiştir. */
      const bodyBytes = hex.length / 2;
      if (bodyBytes < 1) return 'TRUNCATED';
      if (((bodyBytes - 1) % expectedRecordBytes) !== 0) return 'TRUNCATED';
    }
    return 'COMPLETE';
  }
  if (nativeOutcome === 'malformed') {
    return 'MALFORMED';
  }
  return 'UNKNOWN';
}

/** Transport sonucu bir KAPSAM KAYBI mı — `COMPLETE` dışında hepsi. */
export function isTransportCoverageLoss(o: TransportOutcome): boolean {
  return o !== 'COMPLETE';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KANIT
   ══════════════════════════════════════════════════════════════════════════ */

export interface IsoTpTuningEvidenceEntry {
  readonly atMs: number;
  readonly transactionId: string;
  readonly evidenceCorrelationId: string;
  readonly txHeader: string | null;
  readonly rxHeader: string | null;
  readonly protocol: string | null;
  readonly service: string;
  readonly subFunction: string;
  readonly decision: TuningDecision;
  /** Adaptör sınıfı — kararın DAYANAĞI. */
  readonly adapterKind: string;
  /** Tuning GERÇEKTEN uygulandı mı (native ölçümü). */
  readonly applied: boolean;
  /** Denenen AT komutları ve ham yanıtları. */
  readonly commands: string | null;
  readonly previousMode: string | null;
  readonly newMode: string | null;
  /** Restore ÇALIŞTI mı — `false` ise adaptör kirli kalmış OLABİLİR. */
  readonly restored: boolean | null;
  readonly restoreDetail: string | null;
  readonly transportOutcome: TransportOutcome;
  /** Ölçülemedi ise `null` — sahte 0 YASAK. */
  readonly byteCount: number | null;
  readonly frameCount: number | null;
  /** Çözülen kayıt sayısı (tuning öncesi/sonrası karşılaştırması için). */
  readonly recordCount: number | null;
}

const MAX_TUNING_ENTRIES = 48;
let _entries: IsoTpTuningEvidenceEntry[] = [];

/** Kanıt yazar. ASLA throw etmez. */
export function recordIsoTpTuningEvidence(e: IsoTpTuningEvidenceEntry): void {
  try {
    _entries.push(e);
    if (_entries.length > MAX_TUNING_ENTRIES) _entries = _entries.slice(-MAX_TUNING_ENTRIES);
  } catch { /* kanıt kaydı taramayı DÜŞÜRMEZ */ }
}

export function getIsoTpTuningEvidence(): readonly IsoTpTuningEvidenceEntry[] {
  return [..._entries];
}

/** Test kancası — üretim yolunda ÇAĞRILMAZ. */
export function _resetIsoTpTuningForTest(): void { _entries = []; }

export interface IsoTpTuningSummary {
  readonly total: number;
  readonly applied: number;
  readonly skipped: number;
  /** Restore ÇALIŞMAYAN denemeler — 0 DIŞINDAKİ her değer bir KUSURDUR. */
  readonly restoreFailures: number;
  readonly bufferFull: number;
  readonly truncated: number;
  /** En sık atlama nedeni (teşhis); hiç atlama yoksa `null`. */
  readonly topSkipReason: TuningDecision | null;
}

export function summarizeIsoTpTuning(
  entries: readonly IsoTpTuningEvidenceEntry[],
): IsoTpTuningSummary {
  const skips = entries.filter((e) => e.decision !== 'APPLY');
  const counts = new Map<TuningDecision, number>();
  for (const s of skips) counts.set(s.decision, (counts.get(s.decision) ?? 0) + 1);
  let top: TuningDecision | null = null;
  let best = 0;
  for (const [k, v] of counts) if (v > best) { best = v; top = k; }
  return {
    total: entries.length,
    applied: entries.filter((e) => e.applied).length,
    skipped: skips.length,
    restoreFailures: entries.filter((e) => e.applied && e.restored === false).length,
    bufferFull: entries.filter((e) => e.transportOutcome === 'BUFFER_FULL').length,
    truncated: entries.filter((e) => e.transportOutcome === 'TRUNCATED').length,
    topSkipReason: top,
  };
}
