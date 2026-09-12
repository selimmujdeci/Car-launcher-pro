/**
 * multiEcuCorpus — P0-VDK-F6A · GOLDEN ÇOK-ECU KORPUSU (LİTERAL).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN LİTERAL ─────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bir çözümleyiciyi KENDİ kodlayıcısıyla test etmek hiçbir şey kanıtlamaz:
 * ikisi de aynı yanlışı yaparsa test yeşil kalır. Bu yüzden burada
 * `ascii()` gibi bir yardımcı YOKTUR — her hex dizisi ELLE yazılmıştır ve
 * yanında okunabilir karşılığı durur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPSAM (görev §23) ────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   7E8  ECM   — standart garanti (SAE J1979) + kendi beyanı
 *   7E9  TCM   — YALNIZ kendi beyanı (adresten TÜRETİLMEDİ)
 *   7EA  ABS   — YALNIZ kendi beyanı
 *   7EB  SRS   — YALNIZ kendi beyanı
 *   7EC  BCM   — YALNIZ kendi beyanı
 *   7ED  UNKNOWN — uç nokta VAR, kimlik DID'i YOK (7F-11) → rol BİLİNMİYOR
 *
 * ⚠️ Golden Clio korpusu bu dosyadan ETKİLENMEZ ve DEĞİŞTİRİLMEZ.
 */

import type { TraceEvent } from '../../platform/obd/canonicalTrace';
import { TRACE_SCHEMA_VERSION } from '../../platform/obd/canonicalTrace';
import type { EcuRole } from '../../platform/obd/ecuRoleModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) FONKSİYONEL KEŞİF — ham `ATH1 + 0100` yanıtı (çok satırlı)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Altı ECU'nun fonksiyonel `0100` yanıtı.
 *
 * Biçim ELM327'nin `ATH1` (header açık) çıktısıdır; her satır KENDİ yanıt
 * header'ını taşır ve attribution BUNDAN doğar (ISO 15765-4).
 */
export const MULTI_ECU_PROBE_RAW = [
  '7E8 06 41 00 BE 3F A8 13',
  '7E9 06 41 00 80 00 00 00',
  '7EA 06 41 00 80 00 00 00',
  '7EB 06 41 00 80 00 00 00',
  '7EC 06 41 00 80 00 00 00',
  '7ED 06 41 00 80 00 00 00',
].join('\r\n');

/* ══════════════════════════════════════════════════════════════════════════
   2) KİMLİK YANITLARI — LİTERAL HEX (kodlayıcı YOK)
   ══════════════════════════════════════════════════════════════════════════ */

/** `22 F197` gövdesi — ECU'nun BEYAN ETTİĞİ sistem adı (ASCII hex, elle). */
export const F197_BODY: Readonly<Record<string, string>> = Object.freeze({
  /* "ENGINE CONTROL" = 45 4E 47 49 4E 45 20 43 4F 4E 54 52 4F 4C */
  '7E8': '454E47494E4520434F4E54524F4C',
  /* "TRANSMISSION"   = 54 52 41 4E 53 4D 49 53 53 49 4F 4E */
  '7E9': '5452414E534D495353494F4E',
  /* "ABS ESP"        = 41 42 53 20 45 53 50 */
  '7EA': '41425320455350',
  /* "AIRBAG SRS"     = 41 49 52 42 41 47 20 53 52 53 */
  '7EB': '41495242414720535253',
  /* "BODY CONTROL"   = 42 4F 44 59 20 43 4F 4E 54 52 4F 4C */
  '7EC': '424F445920434F4E54524F4C',
  /* 7ED: F197 YOK — ECU `7F 22 11` döndürür (aşağıda `F197_ABSENT`). */
});

/** `22 F18C` gövdesi — ECU seri numarası (ASCII hex, elle; araç örneğine özel). */
export const F18C_BODY: Readonly<Record<string, string>> = Object.freeze({
  /* "SN0001" = 53 4E 30 30 30 31 */
  '7E8': '534E30303031',
  /* "SN0002" = 53 4E 30 30 30 32 */
  '7E9': '534E30303032',
  /* "SN0003" = 53 4E 30 30 30 33 */
  '7EA': '534E30303033',
  /* "SN0004" = 53 4E 30 30 30 34 */
  '7EB': '534E30303034',
  /* "SN0005" = 53 4E 30 30 30 35 */
  '7EC': '534E30303035',
  /* "SN0006" = 53 4E 30 30 30 36 */
  '7ED': '534E30303036',
});

/** Bu ECU'da `F197` YOKTUR — ECU açıkça `7F 22 11` der (deterministik gerçek). */
export const F197_ABSENT: readonly string[] = Object.freeze(['7ED']);

/* ══════════════════════════════════════════════════════════════════════════
   3) SERVİS YETENEK İMZASI — taramanın ÖLÇTÜĞÜ sonuçlar
   ══════════════════════════════════════════════════════════════════════════ */

export const SERVICE_STATUSES:
Readonly<Record<string, Readonly<Record<string, string | null>>>> = Object.freeze({
  '7E8': { '03': 'ok', '07': 'ok', '0A': 'ok', '19': 'ok', '18': null, '13': null },
  '7E9': { '03': null, '07': null, '0A': null, '19': 'ok', '18': null, '13': null },
  '7EA': { '03': null, '07': null, '0A': null, '19': 'ok', '18': null, '13': null },
  '7EB': { '03': null, '07': null, '0A': null, '19': 'unsupported', '18': null, '13': null },
  '7EC': { '03': null, '07': null, '0A': null, '19': 'ok', '18': null, '13': null },
  '7ED': { '03': null, '07': null, '0A': null, '19': 'no_data', '18': null, '13': null },
});

/* ══════════════════════════════════════════════════════════════════════════
   4) BEKLENEN SONUÇ — kanıt tabanlı, adresten TÜRETİLMEMİŞ
   ══════════════════════════════════════════════════════════════════════════ */

export interface ExpectedEcu {
  readonly rx: string;
  readonly tx: string;
  readonly role: EcuRole;
  /** Beklenen güven sınıfı. */
  readonly confidence: 'PROVEN' | 'STRONG' | 'CANDIDATE' | 'UNKNOWN' | 'CONFLICT';
  /** Beklenen kanıt türleri (sıra önemsiz). */
  readonly evidenceKinds: readonly string[];
}

export const EXPECTED_ECUS: readonly ExpectedEcu[] = Object.freeze([
  {
    rx: '7E8', tx: '7E0', role: 'engine', confidence: 'PROVEN',
    /* Standart garanti TEK BAŞINA `PROVEN` üretir; beyan onu DESTEKLER. */
    evidenceKinds: ['STANDARD_ADDRESS_ROLE', 'IDENTITY_DID'],
  },
  {
    rx: '7E9', tx: '7E1', role: 'transmission', confidence: 'STRONG',
    /* ⚠️ `7E1 = şanzıman` GENELLEMESİ DEĞİL: ECU kendini öyle TANITTI. */
    evidenceKinds: ['IDENTITY_DID'],
  },
  {
    rx: '7EA', tx: '7E2', role: 'abs_esp', confidence: 'STRONG',
    evidenceKinds: ['IDENTITY_DID'],
  },
  {
    rx: '7EB', tx: '7E3', role: 'airbag_srs', confidence: 'STRONG',
    evidenceKinds: ['IDENTITY_DID'],
  },
  {
    rx: '7EC', tx: '7E4', role: 'body_bcm', confidence: 'STRONG',
    evidenceKinds: ['IDENTITY_DID'],
  },
  {
    /* Uç nokta ÖLÇÜLDÜ, kimlik DID'i YOK → rol UYDURULMADI. */
    rx: '7ED', tx: '7E5', role: 'unknown', confidence: 'UNKNOWN',
    evidenceKinds: [],
  },
] as const);

/* ══════════════════════════════════════════════════════════════════════════
   5) REPLAY İZİ — LİTERAL OLAYLAR (`imported`)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Korpusu kanonik ize çevirir — **yanıt UYDURULMAZ**, yukarıdaki literal
 * gövdeler taşınır. `provenance: 'imported'` zorunludur: canlı defter replay
 * girdisi OLAMAZ (`openReplayRun` bunu reddeder).
 */
export function multiEcuTraceEvents(): readonly TraceEvent[] {
  const out: TraceEvent[] = [];
  let seq = 0;
  const push = (
    tx: string, rx: string, request: string,
    response: string | null, outcome: string, nrc: number | null,
  ): void => {
    seq++;
    out.push({
      schemaVersion: TRACE_SCHEMA_VERSION,
      traceId: 'golden-multi-ecu',
      eventId: `golden-e${seq}`,
      sequence: seq,
      wallTime: 1_700_000_000_000 + seq,
      monotonicTime: seq * 10,
      transactionId: 'golden-txn',
      evidenceCorrelationId: `golden:${rx}:${request}`,
      sessionEpoch: 1,
      ecuTxHeader: tx,
      ecuRxHeader: rx,
      ecuLabel: `ECU ${rx}`,
      protocol: '6',
      transport: 'unknown',
      direction: 'request_response',
      operation: 'did_read',
      subFunction: null,
      rawRequest: request,
      rawResponse: response,
      transportOutcome: outcome,
      nrc,
      latencyMs: 8,
      byteCount: response === null ? null : response.length / 2,
      frameCount: 1,
      sessionLeaseRef: null,
      adapterKind: null,
      isoTpTuningRef: null,
      provenance: 'imported',
      redactionState: 'CLEAN',
    });
  };

  for (const e of EXPECTED_ECUS) {
    const name = F197_BODY[e.rx];
    if (name === undefined) push(e.tx, e.rx, '22F197', null, 'negative_nrc', 0x11);
    else push(e.tx, e.rx, '22F197', name, 'ok', null);

    const serial = F18C_BODY[e.rx];
    if (serial !== undefined) push(e.tx, e.rx, '22F18C', serial, 'ok', null);

    /* F191 / F187: bu araçta YOK — ECU açıkça `7F 22 11` der. */
    push(e.tx, e.rx, '22F191', null, 'negative_nrc', 0x11);
    push(e.tx, e.rx, '22F187', null, 'negative_nrc', 0x11);
  }
  return Object.freeze(out);
}

/* ══════════════════════════════════════════════════════════════════════════
   6) CANLI TEZGÂH — native köprü yanıtlayıcısı
   ══════════════════════════════════════════════════════════════════════════ */

export interface CorpusPduCall {
  readonly service: string;
  readonly subFunction: string;
  readonly payload: string;
  readonly tx: string;
  readonly rx: string;
}

/**
 * `CarLauncher.sendDiagnosticPdu` tezgâh yanıtlayıcısı — korpusun LİTERAL
 * gövdelerini döndürür ve **başka hiçbir şey uydurmaz**.
 */
export function corpusResponder(c: CorpusPduCall): Record<string, unknown> {
  const rx = (c.rx || '').toUpperCase();
  if (c.service !== '22') {
    return { outcome: 'negative_nrc', raw: '', kind: 'NEG_7F', gate: 'OK', nrc: 0x11 };
  }
  const did = (c.payload || '').toUpperCase();
  const body = did === 'F197' ? F197_BODY[rx]
    : did === 'F18C' ? F18C_BODY[rx]
      : undefined;
  if (body === undefined) {
    return { outcome: 'negative_nrc', raw: '', kind: 'NEG_7F', gate: 'OK', nrc: 0x11, latencyMs: 8 };
  }
  return {
    outcome: 'ok', raw: body, kind: 'OK', gate: 'OK',
    latencyMs: 8, byteCount: body.length / 2, frameCount: 1,
  };
}
