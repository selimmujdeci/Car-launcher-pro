/**
 * virtualTransport — P0-VDK-F2B · SANAL TAŞIMA (doğrulanmış izden deterministik replay).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen borç) ──────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F2-A sahadan gelen bir taramanın TAM kronolojisini (`caros.vdk.trace.v1`)
 * checksum'lı bir pakete koyabiliyor. Ama o paket masaya geldiğinde ürün
 * ONUNLA HİÇBİR ŞEY YAPAMIYORDU: iz yalnız OKUNABİLİYORDU. Sonuç, ürünün
 * defalarca ödediği kusur sınıfı:
 *
 *  · Bir saha kusuru ancak ARAÇ elde varken tekrar üretilebiliyordu. Renault
 *    Clio paritesi (20 kayıt) haftalarca "araç bulunca bakarız" idi.
 *  · Regresyon testleri parser'a DOĞRUDAN veri veriyordu → zincirin
 *    transport→parser→authority kısmı test edilmiyordu; kusur tam ORADAYDI.
 *  · "Düzelttik" demenin kanıtı yoktu: aynı ham baytların aynı ürün sonucunu
 *    ürettiği gösterilemiyordu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR (İKİNCİ MOTOR KURMAZ) ────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **TRACE VIEWER DEĞİLDİR.** Hiçbir şey göstermez; ürünün NORMAL tanı
 *     yolu bu taşımanın üstünde GERÇEKTEN çalışır.
 * (2) **DTC ÜRETMEZ.** `readDtcs() → ['P0380', …]` gibi bir yüzeyi YOKTUR ve
 *     olmayacaktır. Yalnız HAM yanıt döndürür; kodu mevcut parser çözer,
 *     hükmü mevcut authority verir. Replay parser'ı BYPASS EDEMEZ.
 * (3) **İKİNCİ OTURUM MOTORU DEĞİLDİR.** F1-B otoritesi (lease · TesterPresent
 *     · expiry) NORMAL ürün kodunda kalır; bu modül yalnız `3E00`'ın izdeki
 *     ÖLÇÜLMÜŞ karşılığını verir.
 * (4) **İKİNCİ TUNING OTORİTESİ DEĞİLDİR.** F1-C kararı yine
 *     `isoTpTuningPolicy`nindir; burada flow-control sonucu UYDURULMAZ,
 *     yalnız izde ölçülmüşse döndürülür.
 * (5) **ÖĞRENMEZ.** Discovery · Capability Graph · Fleet Memory yazımı bu
 *     fazın DIŞINDADIR. Yalnız ileride sınıflandırılabilecek yapısal boşluk
 *     sinyalleri KAYBEDİLMEZ (`ReplayGapSignal`).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ SÖZLEŞME: YANIT UYDURULMAZ ──────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bir istek izde ÖLÇÜLMEMİŞSE cevap ÜRETİLMEZ. "Sıradaki yanıtı ver"
 * yaklaşımı YASAKTIR: künye (ECU · protokol · servis · alt fonksiyon · HAM
 * istek) doğrulanmadan hiçbir yanıt teslim edilmez. Aksi hâlde replay,
 * gerçekte hiç sorulmamış bir soruya cevap uydurur ve regresyon kasası
 * YALAN söyler — bu, korumasız olmaktan KÖTÜDÜR.
 *
 * SAF DEĞİL (koşu durumu tutar) ama I/O YAPMAZ · timer YOKTUR ·
 * `Date.now`/`Math.random` YOKTUR (saat ve kimlik ENJEKTE EDİLİR).
 */

import type { TraceEvent, TraceOperation } from './canonicalTrace';

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Replay zamanlama modu.
 *
 * `FAST`  — gerçek bekleme YOK. Regresyon/unit içindir; sanal saat izdeki
 *           monotonik farklar kadar ilerler ama hiç kimse beklemez.
 * `TIMED` — izdeki `monotonicTime`/`latencyMs` semantiği yeniden üretilir.
 *           Bekleme fonksiyonu ENJEKTE edilir → testte gerçek `sleep` GEREKMEZ.
 */
export type ReplayMode = 'FAST' | 'TIMED';

/**
 * Bir replay isteğinin KANONİK sonucu. `UNKNOWN` **fail-closed**tir:
 * tanınmayan hiçbir durum "yanıt geldi" sayılmaz.
 */
export type ReplayOutcome =
  /** Künye doğrulandı ve izdeki ÖLÇÜLMÜŞ karşılık teslim edildi. */
  | 'MATCHED'
  /** Olay izde var ama ne yanıt ne de taşıma sonucu ölçülmüş — cevap YOK. */
  | 'NO_RECORDED_RESPONSE'
  /** Bu istek izde HİÇ geçmiyor — ürün izin ötesinde bir soru sordu. */
  | 'REQUEST_MISMATCH'
  /** İstek izde vardı ama kayıtlı yanıtlarının TAMAMI tüketildi. */
  | 'TRACE_EXHAUSTED'
  /** Koşu iptal edildi (üst katman iptali · epoch değişimi). */
  | 'CANCELLED'
  /** İzin zaman ekseni tutarsız (monotonik zaman geri gitti). */
  | 'TIMING_INVALID'
  /** Sınıflandırılamadı — fail-closed. */
  | 'UNKNOWN';

export const REPLAY_OUTCOME_LABEL: Readonly<Record<ReplayOutcome, string>> = {
  MATCHED:              'izdeki ölçülmüş yanıt teslim edildi',
  NO_RECORDED_RESPONSE: 'olay izde var ama yanıt ÖLÇÜLMEMİŞ',
  REQUEST_MISMATCH:     'bu istek izde HİÇ yok — beklenmeyen soru',
  TRACE_EXHAUSTED:      'bu isteğin kayıtlı yanıtları TÜKENDİ',
  CANCELLED:            'koşu iptal edildi',
  TIMING_INVALID:       'iz zaman ekseni tutarsız',
  UNKNOWN:              'sınıflandırılamadı — fail-closed',
} as const;

/**
 * İleride **Self-Completing VDK**'nın okuyacağı yapısal boşluk sinyalleri.
 *
 * ⚠️ BU FAZDA HİÇBİRİ ÇÖZÜLMEZ. Amaç yalnız kanıtın, ileride bu
 * sınıflandırmayı yapabilecek kadar KAYBOLMADIĞINI garanti etmektir —
 * bugün atılan bir sinyal yarın öğrenilemez.
 */
export type ReplayGapSignal =
  | 'UNKNOWN_SERVICE'
  | 'UNKNOWN_SUBFUNCTION'
  | 'UNKNOWN_RESPONSE_SHAPE'
  | 'UNKNOWN_ECU_VARIANT'
  | 'TRANSPORT_LIMITATION'
  | 'PARSER_GAP'
  | 'CAPABILITY_GAP'
  /* ── P0-VDK-F2C1 eklemeleri (fonksiyonel çözümleyici) ─────────────────── */
  /** Yanıtta beklenen pozitif SID yok — gövde tanınmadı. */
  | 'UNEXPECTED_SID'
  /** Gövde çözüldü ama yapısı bozuk (kısmi sayaç · artık bayt). */
  | 'MALFORMED_DTC_BODY'
  /** Kanonik çözüm YAPILAMADI; sonuç yalnız native listesinden geldi. */
  | 'LEGACY_NATIVE_ONLY'
  /** Kanonik çözüm ile native tanık ÇELİŞTİ. */
  | 'PARSER_PARITY_MISMATCH'
  /** Çok-ECU yanıtta kodların sahibi ölçülemedi (uydurulmadı). */
  | 'UNKNOWN_ECU_ATTRIBUTION';

/** Ürünün SORDUĞU şeyin künyesi — replay eşleşmesi BUNUNLA doğrulanır. */
export interface ReplayRequest {
  readonly operation: TraceOperation;
  readonly subFunction: string | null;
  /** HAM istek (servis + alt fonksiyon + gövde). Boşluk/harf duyarsız eşleşir. */
  readonly rawRequest: string | null;
  readonly ecuTxHeader: string | null;
  readonly ecuRxHeader: string | null;
}

/** Replay teslimi — ham ölçüm + kaynak künyesi. Yorum İÇERMEZ. */
export interface ReplayDelivery {
  readonly outcome: ReplayOutcome;
  /** Eşleşen izdeki olay; eşleşme yoksa `null` (uydurma zarf ÜRETİLMEZ). */
  readonly event: TraceEvent | null;
  readonly detail: string;
  /* ── PROVENANCE: canlı ölçümle KARIŞMASIN ─────────────────────────────── */
  readonly replayRunId: string;
  readonly sourceTraceId: string | null;
  readonly sourceEventId: string | null;
  /** Bu teslimden doğan yapısal boşluk sinyali (varsa). */
  readonly gapSignal: ReplayGapSignal | null;
  /** `TIMED` modda bu istek için beklenmesi gereken süre (ms). */
  readonly waitMs: number;
}

/** Koşu muhasebesi — LAB ve parity bunu okur. */
export interface ReplayRunStats {
  readonly requested: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly exhausted: number;
  readonly noRecordedResponse: number;
  readonly cancelled: number;
  readonly timingInvalid: number;
  readonly unknown: number;
  /** İzde HİÇ tüketilmemiş olay sayısı — ürün izin tamamını çalıştırdı mı. */
  readonly unconsumed: number;
  readonly gapSignals: readonly ReplayGapSignal[];
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KÜNYE (REQUEST IDENTITY)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ham hex'i karşılaştırılabilir biçime indirger: boşluk/CR/LF atılır, büyük
 * harfe çevrilir. ELM327 çıktısı boşluklu gelir, ürün isteği boşluksuz
 * kurar — ikisi AYNI isteği ifade eder ve künye bunu ayırt etmemelidir.
 */
function normalizeHex(v: string | null | undefined): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\s\r\n>]+/g, '').toUpperCase();
}

/**
 * Künye: **ECU · işlem · alt fonksiyon · HAM istek**.
 *
 * Protokol künyeye KATILMAZ ve bu bilinçlidir: aynı iz içinde protokol
 * değişirse (ATSP arama) ürünün NE SORDUĞU değişmez. Protokol farkı
 * `verifyProtocol` ile AYRICA denetlenir ve uyuşmazlık `REQUEST_MISMATCH`
 * yapar — yani gevşetilmez, sadece künyeden ayrılır.
 */
export function replayKey(r: ReplayRequest): string {
  return [
    r.operation,
    (r.subFunction ?? '').toUpperCase(),
    normalizeHex(r.rawRequest),
    normalizeHex(r.ecuTxHeader),
    normalizeHex(r.ecuRxHeader),
  ].join('|');
}

function keyOfEvent(e: TraceEvent): string {
  return replayKey({
    operation: e.operation,
    subFunction: e.subFunction,
    rawRequest: e.rawRequest,
    ecuTxHeader: e.ecuTxHeader,
    ecuRxHeader: e.ecuRxHeader,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KOŞU
   ══════════════════════════════════════════════════════════════════════════ */

export interface ReplayRunInput {
  /** **İÇE AKTARILMIŞ** olaylar (`provenance: 'imported'`). */
  readonly events: readonly TraceEvent[];
  readonly mode: ReplayMode;
  /** Koşu kimliği — ENJEKTE edilir (`Math.random` YOK → deterministik). */
  readonly replayRunId: string;
}

/** Koşu reddi — bozuk/uygunsuz girdi SESSİZCE kabul edilmez. */
export type ReplayRunRejection =
  | 'EMPTY_TRACE'
  | 'NOT_IMPORTED'
  | 'SEQUENCE_UNSORTED'
  | 'TIMING_INVALID';

export const REPLAY_RUN_REJECTION_LABEL: Readonly<Record<ReplayRunRejection, string>> = {
  EMPTY_TRACE:       'iz BOŞ — çalıştırılacak ölçüm yok',
  NOT_IMPORTED:      'olaylar `imported` değil — CANLI defter replay girdisi OLAMAZ',
  SEQUENCE_UNSORTED: 'sıra numaraları monotonik değil',
  TIMING_INVALID:    'monotonik zaman GERİ gidiyor — iz zaman ekseni bozuk',
} as const;

/**
 * Aktif replay koşusu.
 *
 * ⚠️ `events` KAYNAK izin KOPYASIDIR ve hiçbir yol onu değiştirmez —
 * `readonly` yalnız tip düzeyinde koruma verirdi, burada dondurulur da.
 */
export interface ReplayRun {
  readonly replayRunId: string;
  readonly sourceTraceId: string;
  readonly mode: ReplayMode;
  readonly events: readonly TraceEvent[];
  /* ── içsel durum (dışarıdan YAZILMAZ; yalnız bu modül ilerletir) ─────── */
  /** Künye → o künyeye ait olay indeksleri (FIFO). */
  readonly queues: ReadonlyMap<string, number[]>;
  /** Künye → kuyruktaki bir sonraki konum. */
  readonly cursors: Map<string, number>;
  /** Tüketilmiş olay indeksleri. */
  readonly consumed: Set<number>;
  /** Sanal monotonik saat (ms) — FAST modda da ilerler, kimse BEKLEMEZ. */
  virtualMonotonicMs: number;
  cancelled: boolean;
  /* ── muhasebe ────────────────────────────────────────────────────────── */
  requested: number;
  matched: number;
  mismatched: number;
  exhausted: number;
  noRecordedResponse: number;
  cancelledCount: number;
  timingInvalid: number;
  unknown: number;
  readonly gapSignals: ReplayGapSignal[];
}

export type ReplayRunResult =
  | { readonly ok: true; readonly run: ReplayRun }
  | { readonly ok: false; readonly rejection: ReplayRunRejection; readonly detail: string };

/**
 * Koşu açar — **FAIL-CLOSED**.
 *
 * `NOT_IMPORTED` reddi ürünün en sert izolasyon kuralıdır: canlı defterin
 * olayları replay girdisi OLAMAZ. Aksi hâlde bir replay, o an araçtan gelen
 * ölçümleri "yeniden oynatıyormuş" gibi tüketir ve canlı ile geçmiş
 * birbirine karışırdı — teşhiste bundan daha tehlikeli bir karışım yoktur.
 */
export function openReplayRun(input: ReplayRunInput): ReplayRunResult {
  const { events, mode, replayRunId } = input;
  if (events.length === 0) {
    return { ok: false, rejection: 'EMPTY_TRACE', detail: REPLAY_RUN_REJECTION_LABEL.EMPTY_TRACE };
  }
  const live = events.filter((e) => e.provenance !== 'imported');
  if (live.length > 0) {
    return {
      ok: false, rejection: 'NOT_IMPORTED',
      detail: `${live.length} olay 'imported' değil (ilk sıra: ${live[0]!.sequence})`,
    };
  }
  for (let i = 1; i < events.length; i++) {
    if (events[i]!.sequence <= events[i - 1]!.sequence) {
      return {
        ok: false, rejection: 'SEQUENCE_UNSORTED',
        detail: `sıra ${events[i - 1]!.sequence} → ${events[i]!.sequence}`,
      };
    }
    if (events[i]!.monotonicTime < events[i - 1]!.monotonicTime) {
      return {
        ok: false, rejection: 'TIMING_INVALID',
        detail: `monotonik ${events[i - 1]!.monotonicTime} → ${events[i]!.monotonicTime}`,
      };
    }
  }

  /* KAYNAK İZ DEĞİŞMEZ: olaylar dondurularak kopyalanır. Bir replay koşusu
     kaynağını kirletirse ikinci koşu ARTIK AYNI ŞEYİ oynatmaz — determinizm
     tam olarak burada ölürdü. */
  const frozen: readonly TraceEvent[] = Object.freeze(events.map((e) => Object.freeze({ ...e })));

  const queues = new Map<string, number[]>();
  frozen.forEach((e, i) => {
    const k = keyOfEvent(e);
    const q = queues.get(k);
    if (q) q.push(i); else queues.set(k, [i]);
  });

  return {
    ok: true,
    run: {
      replayRunId,
      sourceTraceId: frozen[0]!.traceId,
      mode,
      events: frozen,
      queues,
      cursors: new Map<string, number>(),
      consumed: new Set<number>(),
      virtualMonotonicMs: frozen[0]!.monotonicTime,
      cancelled: false,
      requested: 0, matched: 0, mismatched: 0, exhausted: 0,
      noRecordedResponse: 0, cancelledCount: 0, timingInvalid: 0, unknown: 0,
      gapSignals: [],
    },
  };
}

/** Koşuyu iptal eder — sonraki her istek `CANCELLED` döner (fail-closed). */
export function cancelReplayRun(run: ReplayRun): void { run.cancelled = true; }

/* ══════════════════════════════════════════════════════════════════════════
   4) TESLİM — tek giriş noktası
   ══════════════════════════════════════════════════════════════════════════ */

function _delivery(
  run: ReplayRun, outcome: ReplayOutcome, event: TraceEvent | null,
  detail: string, gapSignal: ReplayGapSignal | null, waitMs: number,
): ReplayDelivery {
  return {
    outcome, event, detail,
    replayRunId: run.replayRunId,
    sourceTraceId: run.sourceTraceId,
    sourceEventId: event?.eventId ?? null,
    gapSignal, waitMs,
  };
}

function _signal(run: ReplayRun, s: ReplayGapSignal): ReplayGapSignal {
  if (!run.gapSignals.includes(s)) run.gapSignals.push(s);
  return s;
}

/**
 * Dışarıdan yapısal boşluk sinyali kaydeder.
 *
 * Taşıma katmanının GÖREMEYECEĞİ boşluklar için: örn. ham yanıt ÖLÇÜLMÜŞTÜR
 * ama onu çözecek bir TS çözümleyicisi YOKTUR (fonksiyonel Mode 03/07/0A
 * çözücüsü native taraftadır). Bu bir replay kusuru DEĞİL, ürünün gerçek
 * katman haritasıdır ve kaydedilmezse yarın öğrenilemez.
 */
export function signalReplayGap(run: ReplayRun, s: ReplayGapSignal): void {
  _signal(run, s);
}

/**
 * Beklenmeyen bir isteğin YAPISAL sınıfını ölçer.
 *
 * ⚠️ Bu bir TAHMİN DEĞİL, bir SORU'dur: "izde bu ECU var mıydı · bu servis
 * var mıydı · yalnız alt fonksiyon mu farklıydı". Cevabı bugün kimse
 * kullanmıyor; ileride Discovery/Capability katmanı kullanacak. Bugün
 * kaybedilirse yarın öğrenilemez.
 */
function _classifyMismatch(run: ReplayRun, r: ReplayRequest): ReplayGapSignal {
  const tx = normalizeHex(r.ecuTxHeader);
  const sameEcu = run.events.filter((e) => normalizeHex(e.ecuTxHeader) === tx);
  if (sameEcu.length === 0) return _signal(run, 'UNKNOWN_ECU_VARIANT');
  const sameOp = sameEcu.filter((e) => e.operation === r.operation);
  if (sameOp.length === 0) return _signal(run, 'UNKNOWN_SERVICE');
  const sameSub = sameOp.filter((e) => (e.subFunction ?? '') === (r.subFunction ?? ''));
  if (sameSub.length === 0) return _signal(run, 'UNKNOWN_SUBFUNCTION');
  /* ECU · servis · alt fonksiyon aynı, yalnız GÖVDE farklı → ürün izin
     kapsamadığı bir yetenek sorusu sordu. */
  return _signal(run, 'CAPABILITY_GAP');
}

/**
 * Bir isteğin izdeki ÖLÇÜLMÜŞ karşılığını teslim eder.
 *
 * ── SIRA ÖNEMLİ (en kesin eleme önce) ─────────────────────────────────────
 *  1. iptal          → `CANCELLED`   (kapanmış koşu yanıt veremez)
 *  2. künye YOK      → `REQUEST_MISMATCH` + yapısal boşluk sinyali
 *  3. kuyruk bitti   → `TRACE_EXHAUSTED`
 *  4. protokol/epoch → `REQUEST_MISMATCH` (sessiz tolerans YOK)
 *  5. ölçüm yok      → `NO_RECORDED_RESPONSE`
 *  6. aksi           → `MATCHED`
 *
 * Hiçbir dalda yanıt ÜRETİLMEZ; yalnız izdeki olay teslim edilir.
 */
export function replayRequest(run: ReplayRun, r: ReplayRequest): ReplayDelivery {
  run.requested++;

  if (run.cancelled) {
    run.cancelledCount++;
    return _delivery(run, 'CANCELLED', null, 'koşu iptal edilmiş', null, 0);
  }

  const key = replayKey(r);
  const q = run.queues.get(key);
  if (!q || q.length === 0) {
    run.mismatched++;
    const gap = _classifyMismatch(run, r);
    return _delivery(run, 'REQUEST_MISMATCH', null,
      `izde YOK: ${key}`, gap, 0);
  }

  const cursor = run.cursors.get(key) ?? 0;
  if (cursor >= q.length) {
    run.exhausted++;
    return _delivery(run, 'TRACE_EXHAUSTED', null,
      `${key} için ${q.length} kayıtlı yanıtın tamamı tüketildi`, null, 0);
  }

  const idx = q[cursor]!;
  const ev = run.events[idx]!;
  run.cursors.set(key, cursor + 1);
  run.consumed.add(idx);

  /* ── ZAMAN: sanal saat izdeki farkı kadar ilerler ────────────────────────
     `FAST` de `TIMED` de AYNI sanal saati kullanır; fark yalnız BEKLEMEDİR.
     Böylece iki modun gözlemlenebilir zaman değerleri BİREBİR aynıdır ve
     "hızlı koşuda zaman farklı çıktı" sınıfı bir sapma imkânsızdır. */
  const delta = ev.monotonicTime - run.virtualMonotonicMs;
  if (delta < 0) {
    run.timingInvalid++;
    return _delivery(run, 'TIMING_INVALID', null,
      `monotonik zaman geri gitti: ${run.virtualMonotonicMs} → ${ev.monotonicTime}`, null, 0);
  }
  run.virtualMonotonicMs = ev.monotonicTime;
  const waitMs = run.mode === 'TIMED' ? delta : 0;

  /* Yanıt DA taşıma sonucu DA ölçülmemişse teslim edilecek bir gerçek yok.
     Bu "yanıt gelmedi" DEĞİLDİR — "ölçülmedi"dir; ikisi karıştırılamaz. */
  if (ev.rawResponse === null && ev.transportOutcome === null) {
    run.noRecordedResponse++;
    return _delivery(run, 'NO_RECORDED_RESPONSE', ev,
      `sıra ${ev.sequence}: ne yanıt ne taşıma sonucu ölçülmüş`,
      _signal(run, 'UNKNOWN_RESPONSE_SHAPE'), waitMs);
  }

  run.matched++;
  return _delivery(run, 'MATCHED', ev, `sıra ${ev.sequence}`, null, waitMs);
}

/* ══════════════════════════════════════════════════════════════════════════
   5) MUHASEBE
   ══════════════════════════════════════════════════════════════════════════ */

export function replayRunStats(run: ReplayRun): ReplayRunStats {
  return {
    requested: run.requested,
    matched: run.matched,
    mismatched: run.mismatched,
    exhausted: run.exhausted,
    noRecordedResponse: run.noRecordedResponse,
    cancelled: run.cancelledCount,
    timingInvalid: run.timingInvalid,
    unknown: run.unknown,
    unconsumed: run.events.length - run.consumed.size,
    gapSignals: [...run.gapSignals],
  };
}

/**
 * Tüketilmemiş olaylar — "ürün izin tamamını çalıştırdı mı" sorusunun cevabı.
 *
 * Sıfırdan farklı olması bir HATA DEĞİLDİR (iz keepalive/gözlem olayları da
 * taşır) ama parity muhasebesinde AÇIKÇA görünür; sessizce yutulmaz.
 */
export function unconsumedEvents(run: ReplayRun): readonly TraceEvent[] {
  return run.events.filter((_, i) => !run.consumed.has(i));
}
