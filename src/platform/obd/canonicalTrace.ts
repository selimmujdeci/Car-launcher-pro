/**
 * canonicalTrace — P0-VDK-F2A · KANONİK TANI İZİ (append-only omurga).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen kanıt borcu) ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Ürünün YEDİ ayrı kanıt defteri var ve hiçbiri diğerinin zamanını bilmiyor:
 *
 *   `dtcScanEvidence` · `advancedDtcEvidence` · `dtcPipelineAccounting` ·
 *   `ecuAddressability` · `diagnosticSessionEvidence` · `isoTpTuningPolicy` ·
 *   ham `obdTraffic` olayı
 *
 * Her biri kendi sorusunu doğru yanıtlıyor ama **"bu taramada sırayla ne
 * oldu"** sorusunu HİÇBİRİ yanıtlayamıyor. Somut bedelleri:
 *
 *  · Ham `obdTraffic` olayı native'de TAM OLARAK `{cmd, resp, ms, ts}` taşır —
 *    **yön · protokol · oturum · transport · korelasyon YOK** (bkz.
 *    `rawTrafficModel` başlığı, ölçülmüş gerçek). Bir komutun hangi taramaya
 *    ait olduğu kayıttan ÇIKARILAMAZ.
 *  · `rawTrafficExport` (`caros.obd.rawtraffic.v1`) VAR ama **checksum yok,
 *    import yok, doğrulama yok, korelasyon yok** → dışarı çıkan bir dosyanın
 *    bozulmadığı ya da tahrif edilmediği KANITLANAMAZ.
 *  · Sıra/boşluk/tekrar hiçbir yerde ölçülmüyor: bir olay düşerse SESSİZCE
 *    kaybolur.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ YAKALAMA MOTORU DEĞİLDİR.** Hattan tek bayt istemez, hiçbir
 *     native olaya abone olmaz. Mevcut kanıt yazma NOKTALARI onu ÇAĞIRIR.
 * (2) **PARSER/VERDICT/AUTHORITY YERİNE GEÇMEZ.** Kod çözmez, hüküm vermez,
 *     "temiz/arızalı" DEMEZ. Yalnız ÖLÇÜM omurgasıdır.
 * (3) **`diagnosticTrail` DEĞİLDİR.** O bir UI breadcrumb izidir (boot/mode/
 *     screen, kısa etiket, PII'siz) ve BAŞKA bir soruyu yanıtlar. İkisi
 *     birbirini EZMEZ; bu dosya protokol granülerliğindedir.
 * (4) **REPLAY MOTORU DEĞİLDİR.** Bu fazda yürütme YOKTUR — yalnız replay'in
 *     ihtiyaç duyacağı her şey KAYDEDİLİR (F2-B).
 *
 * SAF DEĞİL (append-only defter tutar) ama I/O YAPMAZ; saat ve kimlik üreteci
 * ENJEKTE EDİLEBİLİR → testler deterministiktir.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

/** Şema sürümü — import'ta BİLİNMEYEN sürüm fail-closed REDDEDİLİR. */
export const TRACE_SCHEMA_VERSION = 'caros.vdk.trace.v1';

/** Olayın hangi katmandan geldiği. */
export type TraceTransport = 'elm327_classic' | 'elm327_ble' | 'unknown';

/** Olayın yönü. Bir istek/yanıt çifti TEK olayda taşınır (ikisi de ham). */
export type TraceDirection =
  /** İstek gönderildi ve yanıt (ya da yanıtsızlık) ölçüldü. */
  | 'request_response'
  /** Yalnız gözlem — istek yok (ör. tarama turu sınırı). */
  | 'observation';

/**
 * Olayın işlemi. Ürünün GERÇEKTEN gönderdiği servislerle birebir.
 * Yeni değer eklemek bir sözleşme değişikliğidir (serbest string YASAK).
 */
export type TraceOperation =
  | 'at_command'          // ELM327 AT kurulum/kontrol komutu
  | 'mode01'              // canlı PID
  | 'mode03' | 'mode07' | 'mode0A'
  | 'uds_19'              // UDS ReadDTCInformation (alt fonksiyon ayrı alanda)
  | 'kwp_18' | 'kwp_13'
  | 'tester_present'      // 0x3E
  | 'session_open'        // 0x10 xx
  | 'isotp_tuning_apply'
  | 'isotp_tuning_restore'
  | 'ecu_probe'
  /**
   * P0-VDK-F5H — erken araç kimliği DID yoklaması (UDS 0x22 salt-okunur).
   *
   * ⚠️ Bu olayın `rawResponse` alanı BİLİNÇLİ olarak `null`dur ve
   * `redactionState` `REDACTED`tir: kimlik DID'inin ham gövdesi (seri/parça
   * numarası) bir izde taşınırsa dışa aktarılan paket o değeri de taşır.
   * Kimlik kanıtı ize KARMA olarak girer, ham değer HİÇ girmez.
   */
  | 'vehicle_identity_probe'
  /**
   * P0-VDK-F6A — kimlik/veri tanımlayıcı okuması (UDS `0x22` · KWP `0x21`).
   *
   * ⚠️ `vehicle_identity_probe`ten AYRIDIR ve karıştırılamaz: o, F5-H'nin
   * ARAÇ kimliği turudur (tek ECU, kalibrasyon karması); bu ise herhangi bir
   * uç noktada yapılan genel DID okumasıdır. Replay eşleşmesi ham isteği
   * (`22F197`) ve tx/rx'i künyeye aldığı için tek operasyon adı DID başına
   * ve ECU başına KESİN attribution verir.
   */
  | 'did_read'
  | 'transaction_boundary';

/**
 * Kaydın kaynağı — içe aktarılan veri CANLI ARAÇ VERİSİ SAYILMAZ.
 *
 * `replay` (P0-VDK-F2B): olay ürünün NORMAL yolundan geçti ama hattın ucunda
 * araç DEĞİL, doğrulanmış bir iz vardı. Canlı ölçümle karıştırılamaz:
 * bir replay koşusunun ürettiği satırlar defterde ayrı DAMGA taşır, aksi
 * hâlde masa başında oynatılan bir arıza "bu araçta şu an var" gibi görünürdü.
 */
export type TraceProvenance = 'live' | 'imported' | 'replay';

/** Maskeleme durumu — export öncesi fail-closed doğrulanır. */
export type RedactionState =
  /** Maskeleme uygulandı ve hassas alan bulunmadı. */
  | 'CLEAN'
  /** Maskeleme uygulandı ve en az bir alan gizlendi. */
  | 'REDACTED'
  /** Maskeleme HİÇ uygulanmadı — export EDİLEMEZ (fail-closed). */
  | 'NOT_APPLIED';

/**
 * KANONİK OLAY.
 *
 * Ölçülmeyen her alan `null`. Sahte `0`, sahte tarih, uydurma protokol YASAK —
 * bu ürünün defalarca ödediği kusur sınıfı tam olarak budur.
 */
export interface TraceEvent {
  readonly schemaVersion: string;
  readonly traceId: string;
  readonly eventId: string;
  /** 1'den başlayan MONOTONİK sıra — boşluk/tekrar bununla ölçülür. */
  readonly sequence: number;
  /** Duvar saati (epoch ms); ölçülemediyse `null`. */
  readonly wallTime: number | null;
  /**
   * MONOTONİK zaman (ms). Duvar saati geri atlayabilir (NTP, kullanıcı, araç
   * aküsü) — süre farkları YALNIZ bununla hesaplanır. Replay'in zamanlamayı
   * yeniden üretebilmesi buna bağlıdır.
   */
  readonly monotonicTime: number;
  readonly transactionId: string | null;
  readonly evidenceCorrelationId: string | null;
  readonly sessionEpoch: number | null;
  readonly ecuTxHeader: string | null;
  readonly ecuRxHeader: string | null;
  readonly ecuLabel: string | null;
  readonly protocol: string | null;
  readonly transport: TraceTransport;
  readonly direction: TraceDirection;
  readonly operation: TraceOperation;
  /** UDS/KWP alt fonksiyonu ('02'/'0A'/'18'); yoksa `null`. */
  readonly subFunction: string | null;
  /** HAM istek (maskelenmiş). Ölçülmediyse `null` — boş string YAZILMAZ. */
  readonly rawRequest: string | null;
  /** HAM yanıt (maskelenmiş). */
  readonly rawResponse: string | null;
  /** `isoTpTuningPolicy.TransportOutcome` sözlüğüyle AYNI dil. */
  readonly transportOutcome: string | null;
  readonly nrc: number | null;
  readonly latencyMs: number | null;
  readonly byteCount: number | null;
  readonly frameCount: number | null;
  /** İlgili oturum kirası (`diagnosticSessionScheduler`); yoksa `null`. */
  readonly sessionLeaseRef: string | null;
  /** Ölçüm anındaki adaptör sınıfı (`adapterCapability.kind`). */
  readonly adapterKind: string | null;
  /** İlgili ISO-TP tuning kararı (`isoTpTuningPolicy.TuningDecision`). */
  readonly isoTpTuningRef: string | null;
  readonly provenance: TraceProvenance;
  readonly redactionState: RedactionState;
}

/** Kaydedenin doldurması gereken alanlar — sıra/kimlik/zaman defter üretir. */
export type TraceEventInput = Omit<
  TraceEvent,
  'schemaVersion' | 'traceId' | 'eventId' | 'sequence' | 'wallTime' | 'monotonicTime' | 'provenance'
> & { readonly provenance?: TraceProvenance };

/* ══════════════════════════════════════════════════════════════════════════
   2) APPEND-ONLY DEFTER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tavan. Aşılırsa EN ESKİ olaylar düşer — ama **SESSİZCE DEĞİL**:
 * `droppedCount` + `firstRetainedSequence` kanıt olarak durur ve export
 * manifestine yazılır. "Kayıt tam" ile "kayıt kırpıldı" ASLA karışmaz.
 */
export const MAX_TRACE_EVENTS = 600;

let _events: TraceEvent[] = [];
let _sequence = 0;
let _dropped = 0;
let _traceId = 'trace-0';
let _wallClock: () => number = () => Date.now();
let _monoClock: () => number = () =>
  (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now() : Date.now();
let _idCounter = 0;
/**
 * Yazılacak olayların varsayılan kaynağı. Replay koşusu bunu `replay` yapar
 * ve bitince `live`a döner (`vdkTransport` tek yetkilidir).
 *
 * ⚠️ Bu bir "mod anahtarı" DEĞİLDİR: hiçbir davranışı değiştirmez, yalnız
 * damgayı belirler. Karar (`isReplayActive`) tek yerde, `vdkTransport`ta kalır.
 */
let _provenanceMode: TraceProvenance = 'live';

/* ── Test kancaları — üretim yolunda ÇAĞRILMAZ ─────────────────────────── */
export function _setTraceClocksForTest(wall: () => number, mono: () => number): void {
  _wallClock = wall; _monoClock = mono;
}
export function _resetTraceForTest(traceId = 'trace-0'): void {
  _events = []; _sequence = 0; _dropped = 0; _idCounter = 0; _traceId = traceId;
  _provenanceMode = 'live';
  _wallClock = () => Date.now();
  _monoClock = () =>
    (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now() : Date.now();
}

/** Yeni bir iz oturumu başlatır (ör. yeni OBD bağlantısı). */
export function beginTrace(traceId: string): void {
  _traceId = traceId;
}

/**
 * Yazım damgasını değiştirir — YALNIZ `vdkTransport` çağırır.
 *
 * Ürün kodu bu fonksiyonu ÇAĞIRMAZ ve replay'in varlığını bilmez; damga
 * taşıma sınırında bir kez ayarlanır.
 */
export function setTraceProvenanceMode(mode: TraceProvenance): void {
  _provenanceMode = mode;
}
export function getTraceProvenanceMode(): TraceProvenance { return _provenanceMode; }

export function getTraceId(): string { return _traceId; }
export function getTraceEvents(): readonly TraceEvent[] { return [..._events]; }
export function getDroppedEventCount(): number { return _dropped; }

/**
 * Olay YAZAR — **append-only**.
 *
 * Var olan hiçbir olay DEĞİŞTİRİLMEZ ya da ÜZERİNE YAZILMAZ; yalnız sona
 * eklenir. `sequence` monotonik artar ve tavan aşımında bile ASLA yeniden
 * kullanılmaz — böylece kırpma bir "boşluk" olarak GÖRÜNÜR, sessiz kayıp
 * olarak değil.
 *
 * ASLA throw etmez: kanıt kaydı ürünü düşüremez.
 */
export function recordTraceEvent(input: TraceEventInput): TraceEvent | null {
  try {
    const seq = ++_sequence;
    const e: TraceEvent = {
      ...input,
      schemaVersion: TRACE_SCHEMA_VERSION,
      traceId: _traceId,
      eventId: `${_traceId}-e${seq}-${++_idCounter}`,
      sequence: seq,
      wallTime: _safeNumber(_wallClock),
      monotonicTime: _safeNumber(_monoClock) ?? seq,
      provenance: input.provenance ?? _provenanceMode,
    };
    _events.push(e);
    if (_events.length > MAX_TRACE_EVENTS) {
      const drop = _events.length - MAX_TRACE_EVENTS;
      _events = _events.slice(drop);
      _dropped += drop;
    }
    return e;
  } catch {
    return null;   // kanıt kaydı taramayı DÜŞÜRMEZ
  }
}

function _safeNumber(fn: () => number): number | null {
  try {
    const v = fn();
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

/** Bir işlemin TAM kronolojisi — sıraya göre. */
export function getTransactionTrace(transactionId: string): readonly TraceEvent[] {
  return _events
    .filter((e) => e.transactionId === transactionId)
    .sort((a, b) => a.sequence - b.sequence);
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BÜTÜNLÜK — boşluk / tekrar / kırpma
   ══════════════════════════════════════════════════════════════════════════ */

export interface TraceIntegrity {
  readonly eventCount: number;
  readonly firstSequence: number | null;
  readonly lastSequence: number | null;
  /** Eksik sıra numaraları (kırpma DIŞINDA) — 0 DIŞINDAKİ her değer KUSURDUR. */
  readonly gaps: readonly number[];
  /** Aynı sıra numarasının tekrarı — 0 DIŞINDAKİ her değer KUSURDUR. */
  readonly duplicates: readonly number[];
  /** Tavan nedeniyle düşen olay adedi — kırpma SESSİZ DEĞİLDİR. */
  readonly droppedCount: number;
  /** Kırpma oldu mu (kayıt TAM DEĞİL). */
  readonly truncated: boolean;
  /** Ham istek/yanıtı ÖLÇÜLEMEMİŞ olay adedi. */
  readonly missingRawCount: number;
}

/**
 * Bütünlük denetimi (SAF).
 *
 * KIRPMA ≠ BOŞLUK: tavan aşımında baştan düşen olaylar `droppedCount` ile
 * raporlanır ve `gaps`e YAZILMAZ. `gaps` yalnız defterin İÇİNDEKİ gerçek
 * eksikliği gösterir — ikisini karıştırmak, normal bir kırpmayı veri
 * bozulması gibi gösterirdi.
 */
export function checkTraceIntegrity(
  events: readonly TraceEvent[], droppedCount = 0,
): TraceIntegrity {
  if (events.length === 0) {
    return {
      eventCount: 0, firstSequence: null, lastSequence: null,
      gaps: [], duplicates: [], droppedCount,
      truncated: droppedCount > 0, missingRawCount: 0,
    };
  }
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const e of sorted) {
    if (seen.has(e.sequence)) duplicates.push(e.sequence);
    seen.add(e.sequence);
  }
  const first = sorted[0]!.sequence;
  const last = sorted[sorted.length - 1]!.sequence;
  const gaps: number[] = [];
  for (let s = first; s <= last; s++) if (!seen.has(s)) gaps.push(s);

  return {
    eventCount: events.length,
    firstSequence: first,
    lastSequence: last,
    gaps,
    duplicates,
    droppedCount,
    truncated: droppedCount > 0,
    missingRawCount: events.filter((e) =>
      e.direction === 'request_response' && e.rawRequest === null && e.rawResponse === null).length,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ÖZET (LAB)
   ══════════════════════════════════════════════════════════════════════════ */

export interface TraceSummary {
  readonly traceId: string;
  readonly integrity: TraceIntegrity;
  readonly transactionCount: number;
  /** Ham istek VE yanıt taşıyan olayların oranı; olay yoksa `null`. */
  readonly rawCoverage: number | null;
  readonly redactedCount: number;
  /** Maskeleme HİÇ uygulanmamış olay — export'u BLOKLAR. */
  readonly notRedactedCount: number;
  /** Export edilebilir mi — fail-closed. */
  readonly exportReady: boolean;
  readonly exportBlockReason: string | null;
}

export function summarizeTrace(
  events: readonly TraceEvent[], droppedCount = 0, traceId = _traceId,
): TraceSummary {
  const integrity = checkTraceIntegrity(events, droppedCount);
  const txns = new Set(events.map((e) => e.transactionId).filter((t) => t !== null));
  const withRaw = events.filter((e) => e.rawRequest !== null || e.rawResponse !== null).length;
  const notRedacted = events.filter((e) => e.redactionState === 'NOT_APPLIED').length;

  /* EXPORT FAIL-CLOSED: maskelenmemiş tek olay bile varsa dışa aktarılamaz;
     bütünlük ihlali (boşluk/tekrar) varsa da aktarılamaz — bozuk bir paket
     analizde yanlış sonuç üretir. */
  let block: string | null = null;
  if (events.length === 0) block = 'iz BOŞ — kaydedilecek olay yok';
  else if (notRedacted > 0) block = `${notRedacted} olayda maskeleme UYGULANMADI`;
  else if (integrity.duplicates.length > 0) block = `${integrity.duplicates.length} tekrarlı sıra`;
  else if (integrity.gaps.length > 0) block = `${integrity.gaps.length} sıra boşluğu`;

  return {
    traceId,
    integrity,
    transactionCount: txns.size,
    rawCoverage: events.length === 0 ? null : withRaw / events.length,
    redactedCount: events.filter((e) => e.redactionState === 'REDACTED').length,
    notRedactedCount: notRedacted,
    exportReady: block === null,
    exportBlockReason: block,
  };
}
