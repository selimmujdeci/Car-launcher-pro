/**
 * vdkTransport — P0-VDK-F2B · KANONİK TANI TAŞIMA SINIRI (Real ↔ Virtual).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN TAŞIMA SAHİPLİĞİ (kod denetimi, varsayım DEĞİL) ───────────────
 * ══════════════════════════════════════════════════════════════════════════
 * TypeScript tarafında HAM bir hat YOKTUR. Ürün hiçbir yerde `ATZ`/`0100`
 * yazmaz; ELM327 sürücüsü NATIVE'dedir (`ElmProtocol` · `OBDManager` ·
 * `BleObdManager`, Java). TS ile araç arasındaki TEK sınır, `CarLauncher`
 * Capacitor köprüsünün TANI metotlarıdır:
 *
 *   readAdvancedDtcs · readDtcClass · readDTC/readPendingDTC/readPermanentDTC
 *   readDtcFromEcu · readUdsDtcs · readKwpDtcs · probeEcus
 *   probeKwpSession · probeKwpAddressingRow · sendTesterPresent
 *
 * Bu yüzden **Real/Virtual ayrımının EN DAR doğru sınırı burasıdır**: daha
 * aşağısı (Java) araç olmadan çalışamaz, daha yukarısı (parser · authority ·
 * verdict) ise TAM OLARAK test etmek istediğimiz şeydir ve replay onu
 * BYPASS EDEMEZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ OBDService DEĞİLDİR.** Bağlanmaz · kopmaz · recovery
 *     başlatmaz · poll döngüsüne dokunmaz. Yalnız TANI çağrılarını yönlendirir.
 * (2) **KARAR VERMEZ.** Admission · lease · tuning kararı · geç yanıt kapısı
 *     hepsi ÇAĞIRANDA (F1-A/B/C) kalır; burada tek bir kural bile KOPYALANMAZ.
 * (3) **YANIT ÜRETMEZ.** Replay dalında zarf yalnız izdeki ÖLÇÜMLERDEN kurulur;
 *     ölçülmemiş alan `undefined` kalır (sahte `0` / sahte `true` YASAK).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── İZOLASYON (pazarlıksız) ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Replay AKTİFKEN bu modül `CarLauncher`a **TEK BİR ÇAĞRI BİLE** yapmaz.
 * Anahtar tek yerdedir (`_run !== null`) ve her kapı fonksiyonu onu ÖNCE
 * sorar — yani "replay sırasında Bluetooth'a gitti" kusuru için tek bir
 * unutulmuş dal bile yeterli olamaz.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import {
  setTraceProvenanceMode,
  type TraceEvent, type TraceOperation,
} from './canonicalTrace';
import {
  advancedOutcomeFromPdu, encodePduRequest, makePdu, pduTarget,
  type DiagnosticPdu, type PduResponse,
} from './pdu';
import {
  ElmPduTransport, VirtualPduTransport,
  type PduSendOptions, type PduTransport,
} from './pduTransport';
import { HybridPduTransport } from './pduRouting';
import {
  openReplayRun, replayRequest, cancelReplayRun, replayRunStats,
  type ReplayDelivery, type ReplayMode, type ReplayRun,
  type ReplayRunRejection, type ReplayRunStats,
} from './virtualTransport';

/* ══════════════════════════════════════════════════════════════════════════
   1) KOŞU ANAHTARI — tek yer
   ══════════════════════════════════════════════════════════════════════════ */

let _run: ReplayRun | null = null;
/** Enjekte edilebilir bekleme — `TIMED` modda bile testte gerçek `sleep` YOK. */
let _sleep: (ms: number) => Promise<void> = (ms) =>
  new Promise((r) => { setTimeout(r, ms); });

/** Replay şu an aktif mi. Ürün kodunun tek bilmesi gereken budur (ve bilmez). */
export function isReplayActive(): boolean { return _run !== null; }

export function getActiveReplayRun(): ReplayRun | null { return _run; }

export function _setReplaySleepForTest(fn: (ms: number) => Promise<void>): void { _sleep = fn; }

export type StartReplayResult =
  | { readonly ok: true; readonly replayRunId: string }
  | { readonly ok: false; readonly rejection: ReplayRunRejection | 'ALREADY_RUNNING'; readonly detail: string };

/**
 * Replay koşusunu başlatır.
 *
 * `ALREADY_RUNNING`: ikinci bir koşu SESSİZCE öncekini ezemez — iki koşu aynı
 * ürün yolunu paylaşırsa hangi yanıtın hangi koşuya ait olduğu ölçülemez hâle
 * gelir ve determinizm biter. Paralel koşu için `openReplayRun` doğrudan
 * kullanılır (izole `ReplayRun` nesnesi; küresel anahtara DOKUNMAZ).
 */
export function startReplay(
  events: readonly TraceEvent[], mode: ReplayMode, replayRunId: string,
): StartReplayResult {
  if (_run !== null) {
    return { ok: false, rejection: 'ALREADY_RUNNING', detail: `zaten koşuyor: ${_run.replayRunId}` };
  }
  const r = openReplayRun({ events, mode, replayRunId });
  if (!r.ok) return { ok: false, rejection: r.rejection, detail: r.detail };
  _run = r.run;
  /* ── CANLI DEFTER KİRLENMEZ ────────────────────────────────────────────
     Replay ürünün NORMAL yolundan geçtiği için o yol iz de yazar. Damga
     ayarlanmazsa masa başında oynatılan bir arıza, defterde CANLI ölçüm gibi
     görünürdü — teşhiste bundan daha tehlikeli bir karışım yoktur. */
  setTraceProvenanceMode('replay');
  return { ok: true, replayRunId };
}

/** Koşuyu bitirir ve muhasebeyi döner. Aktif koşu yoksa `null`. */
export function stopReplay(): ReplayRunStats | null {
  if (_run === null) return null;
  const stats = replayRunStats(_run);
  _run = null;
  setTraceProvenanceMode('live');
  return stats;
}

/** Koşuyu iptal eder — sonraki her istek `CANCELLED` (fail-closed). */
export function cancelReplay(): void { if (_run !== null) cancelReplayRun(_run); }

export function _resetVdkTransportForTest(): void {
  _run = null;
  setTraceProvenanceMode('live');
  _sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
  _deliveries.length = 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) TESLİM DEFTERİ — parity muhasebesi bunu okur
   ══════════════════════════════════════════════════════════════════════════ */

const _deliveries: ReplayDelivery[] = [];
export function getReplayDeliveries(): readonly ReplayDelivery[] { return [..._deliveries]; }

async function _deliver(
  operation: TraceOperation, subFunction: string | null, rawRequest: string,
  tx: string | null, rx: string | null,
): Promise<ReplayDelivery> {
  const run = _run!;
  const d = replayRequest(run, { operation, subFunction, rawRequest, ecuTxHeader: tx, ecuRxHeader: rx });
  _deliveries.push(d);
  /* `TIMED` modda izdeki gecikme YENİDEN ÜRETİLİR; `FAST`ta `waitMs` zaten 0
     olduğu için bu satır hiç beklemez (dal ayrımı GEREKMEZ → tek yol, tek kusur yüzeyi). */
  if (d.waitMs > 0) await _sleep(d.waitMs);
  return d;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) YARDIMCI OLAY TOPLAMA (session / tuning)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bir tanı okumasının YAN kanıtlarını izden toplar.
 *
 * ── NEDEN GEREKLİ ─────────────────────────────────────────────────────────
 * `readAdvancedDtcs` zarfı üç AYRI gerçeği taşır: DTC yanıtı · oturumun
 * açılıp açılmadığı (F1-B) · ISO-TP tuning sonucu (F1-C). İz bunları AYRI
 * olaylara yazar (`session_open` · `isotp_tuning_apply` · `_restore`) ve
 * kayıt sırası ürün kodunun ölçülmüş sırasıdır: tuning → restore →
 * session_open → asıl okuma.
 *
 * Bu yüzden asıl olaydan **GERİYE** doğru, aynı ECU'da, başka bir
 * istek/yanıt olayına çarpana kadar gözlem olayları toplanır. Sınır kuralı
 * KATIDIR: farklı ECU ya da `request_response` görülünce DURULUR — komşu bir
 * okumanın tuning kanıtı bu okumaya YAPIŞTIRILAMAZ.
 */
function _collectSideEvidence(ev: TraceEvent): {
  session: TraceEvent | null; tuningApply: TraceEvent | null; tuningRestore: TraceEvent | null;
} {
  const run = _run;
  const out = { session: null as TraceEvent | null, tuningApply: null as TraceEvent | null, tuningRestore: null as TraceEvent | null };
  if (run === null) return out;
  const idx = run.events.findIndex((e) => e.eventId === ev.eventId);
  if (idx < 0) return out;
  for (let i = idx - 1; i >= 0; i--) {
    const p = run.events[i]!;
    if (p.direction === 'request_response') break;
    if (p.ecuTxHeader !== ev.ecuTxHeader) break;
    if (p.operation === 'session_open' && out.session === null) out.session = p;
    else if (p.operation === 'isotp_tuning_apply' && out.tuningApply === null) out.tuningApply = p;
    else if (p.operation === 'isotp_tuning_restore' && out.tuningRestore === null) out.tuningRestore = p;
    else if (p.operation !== 'session_open' && p.operation !== 'isotp_tuning_apply'
      && p.operation !== 'isotp_tuning_restore') break;
    run.consumed.add(i);   // gözlem olayı da TÜKETİLDİ — muhasebe eksik kalmasın
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   3b) PDU TAŞIMA — P0-VDK-F3A
   ══════════════════════════════════════════════════════════════════════════ */

/** PDU işlemini kanonik iz operasyonuna eşler. İkinci sözlük TANIMLANMAZ. */
function _operationOf(pdu: DiagnosticPdu): TraceOperation | null {
  switch (pdu.service) {
    case '03': return 'mode03';
    case '07': return 'mode07';
    case '0A': return 'mode0A';
    case '19': return 'uds_19';
    case '18': return 'kwp_18';
    case '13': return 'kwp_13';
    case '3E': return 'tester_present';
    /* P0-VDK-F6A — DID okumaları replay edilebilir olmalı (görev §22): aksi
       hâlde kimlik çözümü sanal taşımada `NOT_SUPPORTED_BY_TRANSPORT` alır ve
       çok-ECU korpusu HİÇ oynatılamazdı. Attribution kaybolmaz: `replayKey`
       ham isteği (DID dâhil) ve tx/rx'i künyeye alır. */
    case '22': case '21': return 'did_read';
    default:   return null;
  }
}

/**
 * İZ SÖZLEŞMESİNDEKİ alt fonksiyon biçimi.
 *
 * ── NEDEN AYRI FONKSİYON ──────────────────────────────────────────────────
 * Kanonik iz F1-B'de kuruldu, PDU sözleşmesi F3-A'da geldi ve ikisi TEK bir
 * yerde ayrışıyor: `tester_present` olayı ize `subFunction: null` ile yazılır
 * (tek biçimli servis; alt fonksiyon ham istekte `3E00` olarak zaten var),
 * PDU ise onu açıkça `00` olarak taşır.
 *
 * Bu eşleme burada TEK yerde yapılır. Alternatifi mevcut izleri ve F1-B/F2-B
 * kilitlerini değiştirmekti — çalışan bir sözleşmeyi yeni bir katman uğruna
 * kırmak, bu ürünün kaçındığı hata sınıfıdır.
 */
function _traceSubFunctionOf(pdu: DiagnosticPdu): string | null {
  return pdu.service === '3E' ? null : pdu.subFunction;
}

/** İzin taşıma sözlüğünü PDU sözlüğüne çevirir — çeviri TEK yerde. */
function _pduOutcomeFromTrace(v: string | null): PduResponse['outcome'] {
  switch (v) {
    case 'ok': case 'POSITIVE':               return 'POSITIVE';
    case 'negative_nrc': case 'NEGATIVE':     return 'NEGATIVE';
    case 'unsupported':                       return 'NEGATIVE';
    case 'no_response': case 'NO_RESPONSE':   return 'NO_RESPONSE';
    case 'timeout':                           return 'TIMEOUT';
    case 'malformed':                         return 'MALFORMED';
    case 'not_addressable':                   return 'NOT_ADDRESSABLE';
    case null:                                return 'UNKNOWN';
    default:                                  return 'TRANSPORT_ERROR';
  }
}

/**
 * Sanal taşımanın teslim fonksiyonu — izdeki ÖLÇÜLMÜŞ yanıtı PDU diline çevirir.
 *
 * `pduTransport` doğrudan `virtualTransport`a bağlanmaz; teslim buradan
 * ENJEKTE edilir. Böylece Real/Virtual anahtarı TEK yerde (bu dosya) kalır.
 */
async function _virtualDeliver(pdu: DiagnosticPdu, _opts: PduSendOptions): Promise<PduResponse> {
  const op = _operationOf(pdu);
  if (op === null) {
    return {
      outcome: 'NOT_SUPPORTED_BY_TRANSPORT', raw: null, nrc: null, latencyMs: null,
      byteCount: null, frameCount: null, protocol: null, transportKind: null,
      session: null, tuning: null,
      detail: `iz servis ${pdu.service} icin operasyon tanimi tasimiyor`,
    };
  }
  const d = await _deliver(
    op, _traceSubFunctionOf(pdu), encodePduRequest(pdu),
    pdu.target.txHeader, pdu.target.rxHeader,
  );
  if (d.outcome !== 'MATCHED' || d.event === null) {
    return {
      outcome: 'TRANSPORT_ERROR', raw: null, nrc: null, latencyMs: null,
      byteCount: null, frameCount: null, protocol: null, transportKind: d.outcome,
      session: null, tuning: null, detail: `${d.outcome}: ${d.detail}`,
    };
  }
  const ev = d.event;
  const side = _collectSideEvidence(ev);
  return {
    outcome: _pduOutcomeFromTrace(ev.transportOutcome),
    raw: ev.rawResponse,
    nrc: ev.nrc,
    latencyMs: ev.latencyMs,
    byteCount: ev.byteCount,
    frameCount: ev.frameCount,
    protocol: ev.protocol,
    transportKind: ev.transportOutcome,
    /* Yan kanıt ÖLÇÜLMEDİYSE `null` KALIR — sahte oturum/tuning YAZILMAZ. */
    session: side.session === null ? null : {
      opened: side.session.transportOutcome === 'opened',
      command: side.session.rawRequest,
    },
    tuning: side.tuningApply === null ? null : {
      applied: side.tuningApply.transportOutcome === 'APPLIED',
      commands: side.tuningApply.rawRequest,
      previousMode: side.tuningRestore === null ? null
        : (side.tuningRestore.rawRequest ?? '').replace(/^ATFCSM/, '') || null,
      newMode: side.tuningApply.rawResponse,
      restored: side.tuningRestore === null ? null
        : side.tuningRestore.transportOutcome === 'RESTORED' ? true
          : side.tuningRestore.transportOutcome === 'RESTORE_FAILED' ? false : null,
      restoreDetail: side.tuningRestore === null ? null : side.tuningRestore.rawResponse,
    },
    detail: null,
  };
}

const _elmPdu: PduTransport = new ElmPduTransport();
/* P0-VDK-F4A — legacy tanığı KORUNUR (`_elmPdu`), hibrit onu SARAR.
   Legacy yol silinmedi: `pduParity` onu karşılaştırma tanığı olarak kullanır. */
const _hybridPdu: PduTransport = new HybridPduTransport(_elmPdu);
const _virtualPdu: PduTransport = new VirtualPduTransport(_virtualDeliver);

/**
 * Aktif PDU taşıması — **Real/Virtual anahtarı TEK YERDE**.
 *
 * Üst katman bu yüzeyi kullandığında hangi taşımanın altta olduğunu BİLMEZ:
 * bugün ELM327 ya da doğrulanmış iz; yarın DoIP/J2534 aynı yerden girer.
 */
export function vdkPduTransport(): PduTransport {
  /* ── P0-VDK-F4A ────────────────────────────────────────────────────────
     GERÇEK dalda artık HİBRİT taşıma döner: legacy köprünün taşıyabildiği
     PDU'lar AYNEN legacy'den gider (davranış değişmez), taşıyamadığı her şey
     GENEL köprüden gider. Yeni bir salt-okunur servis eklemek için bu dosyaya
     ya da native'e DOKUNMAK GEREKMEZ.

     REPLAY DALI DEĞİŞMEDİ: replay aktifken hâlâ TEK bir sanal taşıma döner ve
     `CarLauncher`a tek çağrı bile yapılmaz (izolasyon invaryantı korunur). */
  return _run !== null ? _virtualPdu : _hybridPdu;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KAPILAR — ürün kodu YALNIZ bunları çağırır
   ══════════════════════════════════════════════════════════════════════════ */

type AdvancedFn = NonNullable<typeof CarLauncher.readAdvancedDtcs>;
type AdvancedResult = Awaited<ReturnType<AdvancedFn>>;
type DtcClassFn = NonNullable<typeof CarLauncher.readDtcClass>;
type TesterPresentFn = NonNullable<typeof CarLauncher.sendTesterPresent>;
type DtcFromEcuFn = NonNullable<typeof CarLauncher.readDtcFromEcu>;
type ProbeEcusFn = NonNullable<typeof CarLauncher.probeEcus>;

/** Native taşıma kullanılabilir mi — replay AKTİFSE araç GEREKMEZ. */
export function vdkTransportAvailable(): boolean {
  if (_run !== null) return true;
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * `readAdvancedDtcs` kapısı (UDS 0x19 · KWP 0x18/0x13).
 *
 * Bu ürünün EN ZENGİN tanı sınırıdır: DTC gövdesi · NRC · oturum kanıtı ·
 * ISO-TP tuning kanıtı · bayt/çerçeve sayısı hepsi buradan geçer. Replay
 * paritesinin ana yolu da budur.
 */
export function vdkAdvancedDtcsFn(): AdvancedFn | null {
  if (_run !== null) return _replayAdvancedDtcs;
  if (!vdkTransportAvailable()) return null;
  return CarLauncher.readAdvancedDtcs ?? null;
}

const _replayAdvancedDtcs: AdvancedFn = async (opts) => {
  const { service, subFunction, payload, tx, rx } = opts;
  const operation: TraceOperation = service === '19' ? 'uds_19' : service === '18' ? 'kwp_18' : 'kwp_13';
  /* P0-VDK-F3A — KÜNYE TEK YERDEN. Bu biçim eskiden ÜÇ yerde elle
     kuruluyordu (`_recordAdvanced` · bu kapı · künye eşleştirme); biri
     değişirse replay SESSİZCE eşleşmezdi. Artık `encodePduRequest` tekeli. */
  const rawRequest = encodePduRequest(makePdu({ service, subFunction, payload }));
  const d = await _deliver(operation, subFunction, rawRequest, tx || null, rx || null);

  if (d.outcome !== 'MATCHED' || d.event === null) {
    /* ÖLÇÜM YOK → TAŞIMA HATASI. "NO DATA" ya da "desteklenmiyor" DEMEK
       KESİNLİKLE YASAK: ikisi de araç hakkında bir İDDİAdır ve replay'in
       böyle bir iddiada bulunacak kanıtı yoktur. `transport_error`,
       `normalizeAdvancedOutcome` sözlüğünde kapsam KAYBI sayılır → hiçbir
       fail "araç temiz" sonucuna dönüşemez. */
    return {
      raw: '', kind: 'REPLAY_UNAVAILABLE', outcome: 'transport_error',
      error: `${d.outcome}: ${d.detail}`,
    };
  }

  const ev = d.event;
  const side = _collectSideEvidence(ev);
  const out: Record<string, unknown> = {
    raw: ev.rawResponse ?? '',
    kind: ev.transportOutcome === 'ok' ? 'OK' : String(ev.transportOutcome ?? 'UNKNOWN'),
    outcome: (ev.transportOutcome ?? 'transport_error') as AdvancedResult['outcome'],
  };
  /* ── ÖLÇÜLMEYEN ALAN YAZILMAZ ────────────────────────────────────────────
     `nrc: 0` bir NRC'dir; `byteCount: 0` "gövde boş" demektir. Ölçülmemiş
     bir alanı sıfırla doldurmak, çağıranın gördüğü GERÇEĞİ değiştirir. */
  if (ev.nrc !== null) out.nrc = ev.nrc;
  if (ev.byteCount !== null) out.byteCount = ev.byteCount;
  if (ev.frameCount !== null) out.frameCount = ev.frameCount;

  /* ── F1-B PARİTESİ: oturum kanıtı UYDURULMAZ ────────────────────────────
     `sessionOpened` yalnız izde `session_open` olayı ÖLÇÜLMÜŞSE taşınır.
     Yoksa alan HİÇ yazılmaz → ürün kodu eski-APK dalındaki gibi fail-closed
     davranır ve tek bir kör `3E` bile göndermez. */
  if (side.session !== null) {
    out.sessionOpened = side.session.transportOutcome === 'opened';
    if (side.session.rawRequest !== null) out.sessionCommand = side.session.rawRequest;
  }

  /* ── F1-C PARİTESİ: flow-control sonucu UYDURULMAZ ──────────────────────— */
  if (side.tuningApply !== null) {
    const t = side.tuningApply;
    out.tuningApplied = t.transportOutcome === 'APPLIED';
    if (t.rawRequest !== null) out.tuningCommands = t.rawRequest;
    if (t.rawResponse !== null) out.tuningNewMode = t.rawResponse;
  }
  if (side.tuningRestore !== null) {
    const t = side.tuningRestore;
    /* `UNKNOWN` → alan YAZILMAZ: adaptörün temiz kaldığı KANITLANMAMIŞTIR ve
       `false` yazmak da "geri alma DÜŞTÜ" demek olurdu — ikisi de yalan. */
    if (t.transportOutcome === 'RESTORED') out.tuningRestored = true;
    else if (t.transportOutcome === 'RESTORE_FAILED') out.tuningRestored = false;
    if (t.rawResponse !== null) out.tuningRestoreDetail = t.rawResponse;
    if (t.rawRequest !== null) out.tuningPreviousMode = t.rawRequest.replace(/^ATFCSM/, '');
  }
  return out as unknown as AdvancedResult;
};

/** `readDtcClass` kapısı (fonksiyonel Mode 03/07/0A, ham yanıtla). */
export function vdkDtcClassFn(): DtcClassFn | null {
  if (_run !== null) return _replayDtcClass;
  if (!vdkTransportAvailable()) return null;
  return CarLauncher.readDtcClass ?? null;
}

const _replayDtcClass: DtcClassFn = async ({ mode }) => {
  const operation: TraceOperation = mode === '03' ? 'mode03' : mode === '07' ? 'mode07' : 'mode0A';
  const d = await _deliver(operation, null, mode, null, null);
  if (d.outcome !== 'MATCHED' || d.event === null) {
    /* `supported: false` DEMEK YASAK — o, araç hakkında bir iddiadır.
       `NO_RESPONSE` ise ÖLÇÜM YOKLUĞUdur ve `dtcOutcomeSemantics` onu
       kapsam kaybı sayar (asla "temiz"). */
    return { codes: [], raw: '', supported: true, outcome: 'NO_RESPONSE' };
  }
  const ev = d.event;

  /* ══════════════════════════════════════════════════════════════════════
     P0-VDK-F2C1 — PARSER_GAP KAPANDI
     ══════════════════════════════════════════════════════════════════════
     F2-B'de bu yol fail-closed `PARSER_UNAVAILABLE` dönüyordu: kodları yalnız
     native (`ElmProtocol.parseDtcResponse`) çözüyordu ve TS'te karşılığı
     YOKTU. Artık kanonik çözümleyici (`functionalDtc`) ÜRÜN yolundadır
     (`dtcService` → `functionalDtcSource`), yani ham gövde teslim etmek
     yeterlidir: kodu ÜRÜN çözer.

     Replay yine **kod ÜRETMEZ** — `codes: []` döner ve çözümü ürün katmanı
     yapar. Bu, "replay özel DTC listesi üretemez" kuralının tam karşılığıdır. */
  const out: Record<string, unknown> = {
    codes: [],                       // replay ASLA kod ÜRETMEZ — çözüm ÜRÜNÜN
    raw: ev.rawResponse ?? '',
    supported: ev.transportOutcome !== 'unsupported',
    outcome: ev.transportOutcome === 'ok' ? 'OK'
      : ev.transportOutcome === 'unsupported' ? 'UNSUPPORTED'
        : String(ev.transportOutcome ?? 'NO_RESPONSE').toUpperCase(),
  };
  if (ev.latencyMs !== null) out.elapsedMs = ev.latencyMs;
  if (ev.protocol !== null) out.protocol = ev.protocol;
  return out as unknown as Awaited<ReturnType<DtcClassFn>>;
};

/** `sendTesterPresent` kapısı (F1-B keepalive). */
export function vdkTesterPresentFn(): TesterPresentFn | null {
  /* P0-VDK-F3A — İLK GERÇEK PDU ENTEGRASYONU.
     TesterPresent en dar ve en izole tanı yoludur: tek servis (`3E 00`), tek
     hedef, yan kanıt yok. Bu yüzden PDU sınırının ürün üzerinde GERÇEKTEN
     çalıştığının ilk kanıtı burada verilir.

     ⚠️ KAPI KOŞULU DEĞİŞMEDİ: köprüde `sendTesterPresent` yoksa kapı yine
     `null` döner ve F1-B tek bir `3E` bile göndermez. PDU'ya taşımak bu
     fail-closed kuralı GEVŞETMEZ — yalnız isteğin nasıl ifade edildiğini
     değiştirir. */
  if (_run !== null) return _pduTesterPresent;
  if (!vdkTransportAvailable()) return null;
  if (!CarLauncher.sendTesterPresent) return null;
  return _pduTesterPresent;
}

const _pduTesterPresent: TesterPresentFn = async ({ tx, rx }) => {
  const r = await vdkPduTransport().send(makePdu({
    service: '3E', subFunction: '00',
    target: pduTarget(tx || null, rx || null),
  }));
  const out: Record<string, unknown> = {
    raw: r.raw ?? '',
    kind: r.transportKind ?? r.outcome,
    outcome: advancedOutcomeFromPdu(r.outcome),
  };
  if (r.nrc !== null) out.nrc = r.nrc;
  if (r.detail !== null) out.error = r.detail;
  return out as unknown as Awaited<ReturnType<TesterPresentFn>>;
};

/* P0-VDK-F3A: eski `_replayTesterPresent` KALDIRILDI. Replay yolu artik
   `_pduTesterPresent` -> `vdkPduTransport()` -> sanal PDU tasimasi
   uzerinden ayni izi okur; iki ayri replay dali tutmak, birinin
   sessizce eskimesi demekti. */

/** `readDtcFromEcu` kapısı (fiziksel adresli Mode 03/07/0A). */
export function vdkDtcFromEcuFn(): DtcFromEcuFn | null {
  if (_run !== null) return _replayDtcFromEcu;
  if (!vdkTransportAvailable()) return null;
  return CarLauncher.readDtcFromEcu ?? null;
}

const _replayDtcFromEcu: DtcFromEcuFn = async ({ tx, rx, mode }) => {
  const operation: TraceOperation = mode === '03' ? 'mode03' : mode === '07' ? 'mode07' : 'mode0A';
  const d = await _deliver(operation, null, mode, tx || null, rx || null);
  if (d.outcome !== 'MATCHED' || d.event === null) {
    return { codes: [], supported: true, raw: '', outcome: 'NO_RESPONSE' } as unknown as Awaited<ReturnType<DtcFromEcuFn>>;
  }
  const ev = d.event;
  /* P0-VDK-F2C1: fiziksel adresli Mode 03/07/0A da kanonik TS çözümleyicisine
     bağlandı (`multiEcuScan` → `functionalDtcSource`) → `PARSER_GAP` KAPANDI. */
  const out: Record<string, unknown> = {
    codes: [], supported: ev.transportOutcome !== 'unsupported',
    raw: ev.rawResponse ?? '',
    outcome: ev.transportOutcome === 'ok' ? 'OK'
      : ev.transportOutcome === 'unsupported' ? 'UNSUPPORTED'
        : String(ev.transportOutcome ?? 'NO_RESPONSE').toUpperCase(),
  };
  if (ev.latencyMs !== null) out.elapsedMs = ev.latencyMs;
  return out as unknown as Awaited<ReturnType<DtcFromEcuFn>>;
};

/** `probeEcus` kapısı (topoloji ham yanıtı). */
export function vdkProbeEcusFn(): ProbeEcusFn | null {
  if (_run !== null) return _replayProbeEcus;
  if (!vdkTransportAvailable()) return null;
  return CarLauncher.probeEcus ?? null;
}

const _replayProbeEcus: ProbeEcusFn = async () => {
  const d = await _deliver('ecu_probe', null, '0100', null, null);
  /* Eşleşme yoksa BOŞ ham yanıt döner → `buildTopology` hiçbir ECU BULMAZ.
     "ECU yok" bir topoloji İDDİASI değil, ölçüm yokluğudur ve üst katman
     zaten boş topolojiyi keşif başarısızlığı sayar. */
  return { raw: d.event?.rawResponse ?? '' };
};
