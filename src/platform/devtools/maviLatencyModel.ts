/**
 * maviLatencyModel — CAROS LAB · Mavi Gecikme SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK ·
 * React importu YOK. Girdi YAPISALDIR (`maviLatencyTrace` çıktısının şekli) →
 * servis importu olmadan test edilir.
 *
 * ── DÜRÜSTLÜK (F0'ın asıl amacı) ────────────────────────────────────────────
 *  · Ölçüm yoksa sayı UYDURULMAZ (`null` → ekranda "KAYNAK YOK").
 *  · `first_audio_requested` bir PROXY'dir (`play()` çağrıldı). Gerçek duyulabilir
 *    başlangıç yalnız platform geri bildirimiyle (`playing` / `onstart`) KANITLANIR.
 *    İki metrik AYRI hesaplanır ve ekranda AYRI gösterilir — proxy asla
 *    "doğrulanmış" diye etiketlenmez.
 *  · TÜRETİLMİŞ damga (native VAD deltasından gelen `speech_end`) ölçülmüş
 *    damgadan ayrılır: segment `derived` sınıfıyla işaretlenir.
 *  · Negatif süre (saat anomalisi / sıra dışı marker) → `null` (atılır, sunulmaz).
 */

import {
  observed, derived, unavailable,
  type InspectorField,
} from './sessionInspectorModel';

const SRC_TRACE = 'assistant/maviLatencyTrace.getMaviLatencyEvidence';

/* ══════════════════════════════════════════════════════════════════════════
 * Girdi şekli (maviLatencyTrace ile birebir — modül İMPORT EDİLMEZ)
 * ════════════════════════════════════════════════════════════════════════ */

export type MarkOriginShape = 'observed' | 'derived';

export interface MarkShape {
  readonly at: number;
  readonly origin: MarkOriginShape;
}

export interface TraceShape {
  readonly traceId: number;
  readonly turnId: number | null;
  readonly marks: Readonly<Record<string, MarkShape | undefined>>;
  readonly route: string | null;
  readonly provider: string | null;
  /** MAVI-F1 · presence kipi (bounded enum) — yetenek farkı DEĞİL, ton farkı. */
  readonly presence: 'companion' | 'assistant' | null;
  readonly outcome: string;
  readonly failureCode: string | null;
  readonly fillerCount: number;
  /** MAVI-F2: seslendirilen semantik ACK adedi (filler DEĞİL). */
  readonly ackCount: number;
  /** MAVI-F3: işlenen kısmi transkript adedi (METİN TAŞINMAZ). */
  readonly partialCount?: number;
  /** MAVI-F3: konuşmanın neden bittiği — bounded enum. */
  readonly endpointReason?: string | null;
  /** MAVI-F3: kısmi metnin anlam sınıfı (karar anında) — bounded enum. */
  readonly endpointCompleteness?: string | null;
  /** MAVI-F3: sağlayıcıya "şimdi bitir" komutu GERÇEKTEN gönderildi mi. */
  readonly endpointCommanded?: boolean;
  /** MAVI-F3: dinleme yolunun bildirdiği akış yeteneği — bounded enum. */
  readonly sttCapability?: string | null;
  /** MAVI-F4: seslendirilen konuşma parçası adedi (METİN TAŞINMAZ). */
  readonly speechChunkCount?: number;
  /** MAVI-F4: LLM akış yeteneği — bounded enum. */
  readonly llmCapability?: string | null;
  /** MAVI-F4: TTS akış yeteneği — bounded enum. */
  readonly ttsCapability?: string | null;
  /** MAVI-F4: akışın nasıl bittiği — bounded enum. */
  readonly streamEndReason?: string | null;
  readonly bargeIn: boolean;
  readonly duplicateMarks: number;
  readonly closedAt: number | null;
}

export interface MaviLatencyInput {
  readonly enabled: boolean;
  readonly traces: readonly TraceShape[];
  readonly capacity: number;
  readonly openTraceId: number | null;
  readonly tracesOpened: number;
  readonly tracesClosed: number;
  readonly orphanMarks: number;
  readonly invalidMarks: number;
  readonly duplicateMarks: number;
  /** Mavi'nin cevabı dışında (navigasyon/güvenlik/bildirim) gelen ses damgası. */
  readonly foreignAudioMarks: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Segment türetme
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir izin türetilmiş süreleri (ms). Gerekli damga yoksa alan `null` kalır. */
export interface TraceSegments {
  /** Mikrofon ısınma: dinleme açıldı → native STT isteği köprüden geçti. */
  readonly warmupMs: number | null;
  /** Native yakalama: STT isteği → sonuç JS'e ulaştı. */
  readonly sttCaptureMs: number | null;
  /** **Endpoint gecikmesi:** konuşma bitti → metin JS'te. */
  readonly endpointToTextMs: number | null;
  /** Bulut STT round-trip (yalnız hibrit yolda). */
  readonly cloudSttMs: number | null;
  /** Metin → karar üretimi başladı. */
  readonly textToRouteMs: number | null;
  /** Karar → sağlayıcı isteği (yerel kapılar + anahtar çözümü). */
  readonly routeToBrainMs: number | null;
  /** Sağlayıcı (beyin) süresi. */
  readonly brainMs: number | null;
  /** Beyin bitti → nihai cevap seslendirme otoritesine verildi. */
  readonly brainToTtsMs: number | null;
  /** TTS sentezi (yalnız Edge/online yolunda ölçülebilir). */
  readonly ttsSynthesisMs: number | null;
  /** TTS isteği → oynatma İSTENDİ. */
  readonly ttsToFirstAudioMs: number | null;
  /** Oynatma istendi → gerçekten başladığı KANITLANDI. */
  readonly requestedToConfirmedMs: number | null;
  /** **ANA METRİK (proxy):** konuşma bitti → oynatma istendi. */
  readonly speechEndToFirstAudioRequestedMs: number | null;
  /** **ANA METRİK (kanıtlı):** konuşma bitti → ses gerçekten başladı. */
  readonly speechEndToFirstAudioConfirmedMs: number | null;
  /** Konuşma bitti → cevap tamamen okundu. */
  readonly speechEndToResponseCompleteMs: number | null;
  /** Konuşma bitti → yapay ara söz YAKALANDI (F2 sonrası: konuşulmadan düşürüldü). */
  readonly speechEndToFillerMs: number | null;
  /** Konuşma bitti → semantik ACK seslendirildi. */
  readonly speechEndToAckMs: number | null;
  /** MAVI-F3: konuşma başladı → İLK kısmi transkript JS'e ulaştı. */
  readonly speechStartToFirstPartialMs: number | null;
  /** MAVI-F3: konuşma bitti → cümle-sonu KARARI verildi. */
  readonly speechEndToEndpointMs: number | null;
  /** MAVI-F3: karar → nihai transkript hazır. */
  readonly endpointToFinalMs: number | null;
  /** MAVI-F4: beyin isteği → İLK token (akış desteklemeyen yolda `null`). */
  readonly brainToFirstTokenMs: number | null;
  /** MAVI-F4: ilk token → ilk GÜVENLİ konuşma parçası. */
  readonly firstTokenToChunkMs: number | null;
  /** MAVI-F4: ilk parça → sentez istendi. */
  readonly chunkToTtsMs: number | null;
  /** MAVI-F4: ilk ses → akış tamamlandı. */
  readonly firstAudioToStreamCompleteMs: number | null;
  /** Ses istendi → kullanıcı kesti (barge-in tepkisi). */
  readonly firstAudioToBargeInMs: number | null;
}

export type FirstAudioEvidenceLevel = 'NONE' | 'REQUESTED' | 'CONFIRMED';

export const FIRST_AUDIO_EVIDENCE_LABEL: Readonly<Record<FirstAudioEvidenceLevel, string>> = {
  NONE:      'SES İSTENMEDİ',
  REQUESTED: 'İSTENDİ — duyulduğu KANITLANMADI',
  CONFIRMED: 'DOĞRULANDI — platform başlangıç bildirdi',
} as const;

function at(t: TraceShape, key: string): number | null {
  const m = t.marks[key];
  return m && typeof m.at === 'number' && Number.isFinite(m.at) ? m.at : null;
}

/** a→b süresi. Damga eksik veya süre negatifse `null` (sahte/negatif süre YOK). */
function span(t: TraceShape, a: string, b: string): number | null {
  const ta = at(t, a);
  const tb = at(t, b);
  if (ta === null || tb === null) return null;
  const d = tb - ta;
  return d >= 0 ? Math.round(d) : null;
}

export function deriveTraceSegments(t: TraceShape): TraceSegments {
  return Object.freeze({
    warmupMs:              span(t, 'listen_start', 'stt_request_start'),
    sttCaptureMs:          span(t, 'stt_request_start', 'stt_result'),
    endpointToTextMs:      span(t, 'speech_end', 'stt_result'),
    cloudSttMs:            span(t, 'cloud_stt_start', 'cloud_stt_end'),
    textToRouteMs:         span(t, 'stt_result', 'route_start'),
    routeToBrainMs:        span(t, 'route_start', 'brain_request_start'),
    brainMs:               span(t, 'brain_request_start', 'brain_complete'),
    brainToTtsMs:          span(t, 'brain_complete', 'tts_request'),
    ttsSynthesisMs:        span(t, 'tts_request', 'tts_audio_ready'),
    ttsToFirstAudioMs:     span(t, 'tts_request', 'first_audio_requested'),
    requestedToConfirmedMs: span(t, 'first_audio_requested', 'first_audio_confirmed'),
    speechEndToFirstAudioRequestedMs: span(t, 'speech_end', 'first_audio_requested'),
    speechEndToFirstAudioConfirmedMs: span(t, 'speech_end', 'first_audio_confirmed'),
    speechEndToResponseCompleteMs:    span(t, 'speech_end', 'response_complete'),
    speechEndToFillerMs:   span(t, 'speech_end', 'filler_trigger'),
    speechEndToAckMs:      span(t, 'speech_end', 'ack_emitted'),
    speechStartToFirstPartialMs: span(t, 'speech_start', 'first_partial'),
    speechEndToEndpointMs:       span(t, 'speech_end', 'endpoint_decision'),
    endpointToFinalMs:           span(t, 'endpoint_decision', 'stt_result'),
    brainToFirstTokenMs:         span(t, 'brain_request_start', 'brain_first_token'),
    firstTokenToChunkMs:         span(t, 'brain_first_token', 'first_speech_chunk_ready'),
    chunkToTtsMs:                span(t, 'first_speech_chunk_ready', 'first_tts_chunk_request'),
    firstAudioToStreamCompleteMs: span(t, 'first_audio_requested', 'tts_stream_complete'),
    firstAudioToBargeInMs: span(t, 'first_audio_requested', 'barge_in'),
  });
}

/** İlk sesin kanıt düzeyi — proxy ile doğrulanmış AYRI tutulur. */
export function firstAudioEvidenceOf(t: TraceShape): FirstAudioEvidenceLevel {
  if (at(t, 'first_audio_confirmed') !== null) return 'CONFIRMED';
  if (at(t, 'first_audio_requested') !== null) return 'REQUESTED';
  return 'NONE';
}

/**
 * `speech_end` damgası TÜRETİLMİŞ mi (native VAD deltasından) — ekranda
 * bu ayrım gösterilir, çünkü türetilmiş taban ölçüm güvenini değiştirir.
 */
export function speechEndIsDerived(t: TraceShape): boolean {
  const m = t.marks['speech_end'];
  return !!m && m.origin === 'derived';
}

/** İz tamamlanmış bir kullanıcı turu mu (istatistiğe girer mi). */
export function isCompletedTrace(t: TraceShape): boolean {
  return t.outcome === 'completed';
}

/* ══════════════════════════════════════════════════════════════════════════
 * İstatistik
 * ════════════════════════════════════════════════════════════════════════ */

export interface LatencyStat {
  readonly count: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly worst: number | null;
}

const EMPTY_STAT: LatencyStat = Object.freeze({ count: 0, p50: null, p95: null, worst: null });

/**
 * Yüzdelik — **örnek yoksa `null`** (tek örnekte p50=p95=o örnek; bu dürüsttür,
 * uydurma değildir: mevcut tek ölçüm hem ortancadır hem en kötüsüdür).
 * `nearest-rank` yöntemi kullanılır (interpolasyon yok → ölçülmemiş ara değer üretilmez).
 */
export function computeStat(samples: readonly (number | null)[]): LatencyStat {
  const xs: number[] = [];
  for (const s of samples) {
    if (typeof s === 'number' && Number.isFinite(s) && s >= 0) xs.push(s);
  }
  if (xs.length === 0) return EMPTY_STAT;
  xs.sort((a, b) => a - b);
  const rank = (p: number): number => {
    const idx = Math.ceil(p * xs.length) - 1;
    return xs[Math.min(xs.length - 1, Math.max(0, idx))];
  };
  return Object.freeze({
    count: xs.length,
    p50: rank(0.5),
    p95: rank(0.95),
    worst: xs[xs.length - 1],
  });
}

export interface MaviLatencySummary {
  /** İstatistiğe giren (tamamlanmış) iz sayısı. */
  readonly completed: number;
  readonly requestedStat: LatencyStat;
  readonly confirmedStat: LatencyStat;
  readonly brainStat: LatencyStat;
  readonly endpointStat: LatencyStat;
  readonly sttCaptureStat: LatencyStat;
  readonly ttsToAudioStat: LatencyStat;
  /** Yapay ara söz YAKALANAN tur sayısı (F2 sonrası hedef: 0). */
  readonly tracesWithFiller: number;
  /** Toplam yakalanan (konuşulmayan) ara söz adedi. */
  readonly fillerTotal: number;
  /** Semantik ACK seslendirilen tur sayısı — filler DEĞİL, kusur DEĞİL. */
  readonly tracesWithAck: number;
  /** Toplam seslendirilen semantik ACK adedi. */
  readonly ackTotal: number;
  /** MAVI-F3: kısmi transkript GÖRÜLEN tur sayısı (streaming gerçekten aktif mi). */
  readonly tracesWithPartial: number;
  /** MAVI-F3: endpoint sebebine göre tur adedi — bounded enum dağılımı. */
  readonly byEndpointReason: Readonly<Record<string, number>>;
  /** MAVI-F3: STT akış yeteneğine göre tur adedi. */
  readonly bySttCapability: Readonly<Record<string, number>>;
  /** MAVI-F3: erken bitirme komutunun GERÇEKTEN gönderildiği tur adedi. */
  readonly endpointCommandedCount: number;
  /** MAVI-F4: akış cevabı KONUŞULAN tur sayısı. */
  readonly tracesWithSpeechStream: number;
  /** MAVI-F4: toplam seslendirilen konuşma parçası. */
  readonly speechChunkTotal: number;
  /** MAVI-F4: LLM akış yeteneğine göre tur adedi. */
  readonly byLlmCapability: Readonly<Record<string, number>>;
  /** MAVI-F4: akış bitiş sebebine göre tur adedi. */
  readonly byStreamEnd: Readonly<Record<string, number>>;
  readonly bargeInCount: number;
  /** Sonuç sınıfına göre iz adedi. */
  readonly byOutcome: Readonly<Record<string, number>>;
  /** İlk-ses kanıt düzeyine göre iz adedi. */
  readonly byFirstAudio: Readonly<Record<FirstAudioEvidenceLevel, number>>;
}

export function summarize(traces: readonly TraceShape[]): MaviLatencySummary {
  const byOutcome: Record<string, number> = {};
  const byFirstAudio: Record<FirstAudioEvidenceLevel, number> = {
    NONE: 0, REQUESTED: 0, CONFIRMED: 0,
  };
  const reqS: (number | null)[] = [];
  const confS: (number | null)[] = [];
  const brainS: (number | null)[] = [];
  const endS: (number | null)[] = [];
  const sttS: (number | null)[] = [];
  const ttsS: (number | null)[] = [];
  let completed = 0;
  let tracesWithFiller = 0;
  let fillerTotal = 0;
  let tracesWithAck = 0;
  let ackTotal = 0;
  let bargeInCount = 0;
  let tracesWithPartial = 0;
  let endpointCommandedCount = 0;
  const byEndpointReason: Record<string, number> = {};
  const bySttCapability: Record<string, number> = {};
  let tracesWithSpeechStream = 0;
  let speechChunkTotal = 0;
  const byLlmCapability: Record<string, number> = {};
  const byStreamEnd: Record<string, number> = {};

  for (const t of traces) {
    byOutcome[t.outcome] = (byOutcome[t.outcome] ?? 0) + 1;
    byFirstAudio[firstAudioEvidenceOf(t)] += 1;
    if (t.fillerCount > 0) tracesWithFiller += 1;
    fillerTotal += typeof t.fillerCount === 'number' && t.fillerCount > 0 ? t.fillerCount : 0;
    if (typeof t.ackCount === 'number' && t.ackCount > 0) { tracesWithAck += 1; ackTotal += t.ackCount; }
    if (t.bargeIn) bargeInCount += 1;
    // MAVI-F3 — bounded enum dağılımları (serbest metin bu katmana GİRMEZ).
    if (typeof t.partialCount === 'number' && t.partialCount > 0) tracesWithPartial += 1;
    if (t.endpointReason) byEndpointReason[t.endpointReason] = (byEndpointReason[t.endpointReason] ?? 0) + 1;
    if (t.sttCapability) bySttCapability[t.sttCapability] = (bySttCapability[t.sttCapability] ?? 0) + 1;
    if (t.endpointCommanded === true) endpointCommandedCount += 1;
    // MAVI-F4 — bounded akış dağılımları (token/metin bu katmana GİRMEZ).
    if (typeof t.speechChunkCount === 'number' && t.speechChunkCount > 0) {
      tracesWithSpeechStream += 1;
      speechChunkTotal += t.speechChunkCount;
    }
    if (t.llmCapability) byLlmCapability[t.llmCapability] = (byLlmCapability[t.llmCapability] ?? 0) + 1;
    if (t.streamEndReason) byStreamEnd[t.streamEndReason] = (byStreamEnd[t.streamEndReason] ?? 0) + 1;

    // İstatistik YALNIZ tamamlanmış turlardan: iptal/devralınan tur "hızlı"
    // görünüp ortancayı YANLIŞ İYİLEŞTİRİR (kullanıcı cevabı hiç duymadı).
    if (!isCompletedTrace(t)) continue;
    completed += 1;
    const s = deriveTraceSegments(t);
    reqS.push(s.speechEndToFirstAudioRequestedMs);
    confS.push(s.speechEndToFirstAudioConfirmedMs);
    brainS.push(s.brainMs);
    endS.push(s.endpointToTextMs);
    sttS.push(s.sttCaptureMs);
    ttsS.push(s.ttsToFirstAudioMs);
  }

  return Object.freeze({
    completed,
    requestedStat:  computeStat(reqS),
    confirmedStat:  computeStat(confS),
    brainStat:      computeStat(brainS),
    endpointStat:   computeStat(endS),
    sttCaptureStat: computeStat(sttS),
    ttsToAudioStat: computeStat(ttsS),
    tracesWithFiller,
    fillerTotal,
    tracesWithAck,
    ackTotal,
    bargeInCount,
    tracesWithPartial,
    byEndpointReason: Object.freeze(byEndpointReason),
    bySttCapability: Object.freeze(bySttCapability),
    endpointCommandedCount,
    tracesWithSpeechStream,
    speechChunkTotal,
    byLlmCapability: Object.freeze(byLlmCapability),
    byStreamEnd: Object.freeze(byStreamEnd),
    byOutcome: Object.freeze(byOutcome),
    byFirstAudio: Object.freeze(byFirstAudio),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hüküm
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviLatencyVerdict =
  /** Telemetri kapalı — ölçüm YOK, hüküm YOK. */
  | 'DISABLED'
  /** Telemetri açık ama hiç iz yok. */
  | 'NO_TRACES'
  /** İzler var ama ana metrik hiçbirinde türetilemedi (enstrümantasyon boşluğu). */
  | 'NO_METRIC'
  /** Ölçüm var ama ilk ses hiçbir turda DOĞRULANMADI — yalnız proxy. */
  | 'PROXY_ONLY'
  /** En az bir turda ilk ses platformca doğrulandı. */
  | 'CONFIRMED';

export const MAVI_LATENCY_VERDICT_LABEL: Readonly<Record<MaviLatencyVerdict, string>> = {
  DISABLED:   'TELEMETRİ KAPALI — ölçüm yok',
  NO_TRACES:  'İZ YOK — henüz sesli tur ölçülmedi',
  NO_METRIC:  'METRİK TÜRETİLEMEDİ — damga zinciri eksik',
  PROXY_ONLY: 'YALNIZ PROXY — ses başlangıcı DOĞRULANMADI',
  CONFIRMED:  'DOĞRULANMIŞ ÖLÇÜM VAR',
} as const;

export type MaviLatencyTone = 'ok' | 'muted' | 'warn' | 'bad';

export function maviLatencyVerdictTone(v: MaviLatencyVerdict): MaviLatencyTone {
  switch (v) {
    case 'CONFIRMED':  return 'ok';
    case 'PROXY_ONLY': return 'warn';
    case 'NO_METRIC':  return 'bad';
    default:           return 'muted';
  }
}

export function deriveMaviLatencyVerdict(
  input: { enabled: boolean; traceCount: number; summary: MaviLatencySummary },
): MaviLatencyVerdict {
  if (!input.enabled) return 'DISABLED';
  if (input.traceCount === 0) return 'NO_TRACES';
  if (input.summary.confirmedStat.count > 0) return 'CONFIRMED';
  if (input.summary.requestedStat.count > 0) return 'PROXY_ONLY';
  return 'NO_METRIC';
}

/* ══════════════════════════════════════════════════════════════════════════
 * DARBOĞAZ (BOTTLENECK) — P0-MAVI-FORENSIC-DEVICE-1
 * ════════════════════════════════════════════════════════════════════════
 * SAHA (2026-09-11): gerçek cihazda `speech_end→ilk ses` SLA sınıfları hep
 * `evidence:NONE` çıktı — bu bir KUSUR DEĞİL: `speech_end` yalnız native STT
 * VAD telemetrisi (`speechEndDetectedAtMs`) geldiğinde damgalanır (bkz.
 * `voiceService` — sahte taban ÜRETİLMEZ) ve bu cihaz/yol o telemetriyi
 * vermiyordu. Ama STT yakalama · sağlayıcı (beyin) · TTS kuyruğu segmentleri
 * `speech_end`e bağlı DEĞİLDİR — `summarize()` bunları ZATEN üretiyordu, yalnız
 * dışa hiç TAŞINMIYORDU. Bu fonksiyon YENİ ölçüm YAPMAZ: var olan üç istatistiği
 * (p50) karşılaştırıp en büyüğünü adlandırır — ikinci bir hesap KURMAZ.
 */
export type MaviLatencyBottleneck = 'STT' | 'PROVIDER' | 'TTS_QUEUE' | 'UNKNOWN';

export interface MaviLatencyBottleneckVerdict {
  readonly bottleneck: MaviLatencyBottleneck;
  /** Native STT yakalama (p50, ms). Ölçüm yoksa `null`. */
  readonly sttMs: number | null;
  /** Sağlayıcı/beyin çağrısı (p50, ms). Ağ + üretim ayrıştırılmaz — tek damga çifti. */
  readonly providerMs: number | null;
  /** TTS isteği → oynatma istendi (p50, ms). */
  readonly ttsQueueMs: number | null;
}

export function deriveLatencyBottleneck(summary: MaviLatencySummary): MaviLatencyBottleneckVerdict {
  const sttMs      = summary.sttCaptureStat.count > 0 ? summary.sttCaptureStat.p50 : null;
  const providerMs = summary.brainStat.count > 0 ? summary.brainStat.p50 : null;
  const ttsQueueMs = summary.ttsToAudioStat.count > 0 ? summary.ttsToAudioStat.p50 : null;

  const candidates: ReadonlyArray<[MaviLatencyBottleneck, number]> = [
    ['STT', sttMs], ['PROVIDER', providerMs], ['TTS_QUEUE', ttsQueueMs],
  ].filter((c): c is [MaviLatencyBottleneck, number] => c[1] !== null);

  if (candidates.length === 0) return { bottleneck: 'UNKNOWN', sttMs, providerMs, ttsQueueMs };
  const winner = candidates.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { bottleneck: winner[0], sttMs, providerMs, ttsQueueMs };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Alan (InspectorField) üretimi
 * ════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
 * SLA SINIFLARI (MAVI-P0-LATENCY) — SAF TÜRETME, YENİ OTORİTE DEĞİL
 * ════════════════════════════════════════════════════════════════════════
 * Tek bir ortalama, "yerel komut" ile "bulut sohbeti"ni aynı kovaya atıp
 * gerçek sorunu GİZLER. Bu blok yeni bir ölçüm kaynağı KURMAZ: mevcut
 * `route` alanını (zaten `setMaviLatencyRoute` ile yazılıyor) ve mevcut
 * `computeStat`/`deriveTraceSegments`i kullanarak izleri sınıflara ayırır.
 *
 * Sınıflandırılamayan rota `UNCLASSIFIED`tır — uydurma sınıf ATANMAZ.
 */

export type MaviSlaClass =
  /** A — yerel/deterministik komut (sağlayıcı kritik yolda DEĞİL). */
  | 'LOCAL'
  /** B — bulut sohbeti/eylemi (sağlayıcı kritik yolda). */
  | 'CLOUD'
  /** D — bekleyen onaya verilen "evet"/"hayır" cevabı. */
  | 'CONFIRMATION'
  /** Rotası olmayan/bilinmeyen iz — sayılır ama hedefe SOKULMAZ. */
  | 'UNCLASSIFIED';

/**
 * Rota → SLA sınıfı. Rota adları `voiceService`de üretilir; buradaki eşleme
 * SALT OKUMA'dır ve hiçbir davranışı etkilemez.
 *
 * ⚠️ C sınıfı (takip turu) rota adından TÜRETİLEMEZ: takip turu da yerel ya da
 * bulut olabilir. Ayrı bir "followUp" damgası bulunmadığı sürece bu model
 * takip turunu KENDİ sınıfına ayırmaz — uydurmak yerine eksik olduğunu söyler.
 */
export function slaClassOfRoute(route: string | null | undefined): MaviSlaClass {
  if (typeof route !== 'string' || route.length === 0) return 'UNCLASSIFIED';
  if (route === 'confirmation_ack') return 'CONFIRMATION';
  if (
    route === 'critical_bypass'
    || route === 'local_fast_path'
    || route === 'weather_local_bypass'
    || route === 'sensor_local_bypass'
    || route === 'saved_location_local_bypass'
    || route === 'music_intent_local_bypass'
    || route === 'offline_chat'
  ) return 'LOCAL';
  return 'CLOUD';
}

/** Bir SLA sınıfının hedefi (ms) — `null` = tanımlı hedef yok. */
export const MAVI_SLA_TARGET_P95_MS: Readonly<Record<MaviSlaClass, number | null>> = Object.freeze({
  LOCAL:        1_000,
  CLOUD:        2_000,
  CONFIRMATION:   750,
  UNCLASSIFIED:  null,
});

export interface MaviSlaClassStat {
  readonly slaClass: MaviSlaClass;
  /** `speech_end → first_audio_requested` (PROXY — `play()` çağrıldı). */
  readonly requestedStat: LatencyStat;
  /** `speech_end → first_audio_confirmed` (DOĞRULANMIŞ ilk ses). */
  readonly confirmedStat: LatencyStat;
  readonly targetP95Ms: number | null;
  /**
   * Hedef tutuyor mu. Kanıt DOĞRULANMIŞ ses varsa ONDAN, yoksa PROXY'den
   * okunur; hiç örnek yoksa `null` (PASS de FAIL de DENMEZ).
   */
  readonly meetsTarget: boolean | null;
  /** Hükmün hangi kanıta dayandığı — proxy ile doğrulanmış KARIŞTIRILMAZ. */
  readonly evidence: 'CONFIRMED' | 'PROXY_ONLY' | 'NONE';
}

/**
 * İzleri SLA sınıflarına ayırıp her sınıf için p50/p95/en kötü üretir.
 * İstatistiğe YALNIZ tamamlanmış izler girer (`summarize` ile aynı kural —
 * iptal/devralınan tur "hızlı" görünüp ortancayı yanlış iyileştiremez).
 */
export function summarizeSlaClasses(
  traces: readonly TraceShape[],
): readonly MaviSlaClassStat[] {
  const order: readonly MaviSlaClass[] = ['LOCAL', 'CLOUD', 'CONFIRMATION', 'UNCLASSIFIED'];
  const req = new Map<MaviSlaClass, (number | null)[]>();
  const conf = new Map<MaviSlaClass, (number | null)[]>();
  for (const c of order) { req.set(c, []); conf.set(c, []); }

  for (const t of traces) {
    if (!isCompletedTrace(t)) continue;
    const cls = slaClassOfRoute(t.route);
    const s = deriveTraceSegments(t);
    req.get(cls)!.push(s.speechEndToFirstAudioRequestedMs);
    conf.get(cls)!.push(s.speechEndToFirstAudioConfirmedMs);
  }

  return Object.freeze(order.map((cls) => {
    const requestedStat = computeStat(req.get(cls) ?? []);
    const confirmedStat = computeStat(conf.get(cls) ?? []);
    const target = MAVI_SLA_TARGET_P95_MS[cls];
    const evidence: MaviSlaClassStat['evidence'] =
      confirmedStat.count > 0 ? 'CONFIRMED'
        : requestedStat.count > 0 ? 'PROXY_ONLY'
          : 'NONE';
    const observed = confirmedStat.count > 0 ? confirmedStat.p95 : requestedStat.p95;
    const meetsTarget = (target === null || observed === null) ? null : observed <= target;
    return Object.freeze({
      slaClass: cls, requestedStat, confirmedStat,
      targetP95Ms: target, meetsTarget, evidence,
    });
  }));
}

function statText(s: LatencyStat): string | null {
  if (s.count === 0) return null;
  return `p50 ${s.p50} ms · p95 ${s.p95} ms · en kötü ${s.worst} ms (${s.count} örnek)`;
}

/** Üst özet alanları — ölçüm yoksa UNAVAILABLE (uydurma sayı YOK). */
export function buildMaviLatencyFields(input: MaviLatencyInput): InspectorField[] {
  const summary = summarize(input.traces);
  const out: InspectorField[] = [];

  out.push(observed(
    { id: 'enabled', label: 'Telemetri', source: SRC_TRACE,
      note: 'Varsayılan KAPALI. Şalter: localStorage["mavi.latencyTrace.enabled"]="true" veya uzak bayrak mavi_latency_trace. Değer İZ BAŞINA okunur.' },
    input.enabled ? 'AÇIK' : 'KAPALI',
  ));

  out.push(observed(
    { id: 'traces', label: 'Kayıtlı iz', source: SRC_TRACE,
      note: 'Sabit tavanlı halka; süreç ömürlü (uygulama yeniden başlayınca boşalır).' },
    `${input.traces.length} / ${input.capacity}`,
  ));

  out.push(observed(
    { id: 'completed', label: 'Tamamlanmış tur (istatistiğe giren)', source: SRC_TRACE,
      note: 'İptal/devralınan/timeout turlar istatistiğe GİRMEZ — "hızlı" görünüp ortancayı yanlış iyileştirirlerdi.' },
    summary.completed,
  ));

  /* P0-MAVI-FORENSIC-DEVICE-1 (SAHA 2026-09-11): bu üç segment `speech_end`e
     BAĞLI DEĞİLDİR — native STT VAD telemetrisi yokken (yukarıdaki DOĞRULANMIŞ/
     PROXY alanları boş kalsa) BİLE ölçülür. "en yavaş adım hangisi" sorusunu
     ince damga zinciri boşken de cevaplar. */
  const bn = deriveLatencyBottleneck(summary);
  out.push(observed(
    { id: 'bottleneck', label: 'Darboğaz (STT/sağlayıcı/TTS kuyruğu — p50 kıyası)', source: SRC_TRACE,
      note: 'STT = native yakalama süresi · PROVIDER = sağlayıcı/beyin çağrısı (ağ+üretim ayrıştırılmaz) · '
          + 'TTS_QUEUE = TTS isteği → oynatma istendi. Segmentlerden hiçbiri ölçülmediyse UNKNOWN.' },
    `${bn.bottleneck} (stt=${bn.sttMs ?? '-'}ms · provider=${bn.providerMs ?? '-'}ms · ttsQueue=${bn.ttsQueueMs ?? '-'}ms)`,
  ));

  const confText = statText(summary.confirmedStat);
  out.push(confText === null
    ? unavailable(
        { id: 'confirmed', label: 'speech-end → ilk ses (DOĞRULANMIŞ)', source: SRC_TRACE, note: '' },
        'Hiçbir turda platform gerçek ses başlangıcı bildirmedi. Android native TextToSpeech bu derlemede başlangıç geri bildirimi VERMEZ; doğrulama yalnız klip/Edge/online (HTMLAudioElement) ve web SpeechSynthesis yolunda mümkündür.')
    : derived(
        { id: 'confirmed', label: 'speech-end → ilk ses (DOĞRULANMIŞ)', source: SRC_TRACE,
          note: 'Platform gerçek başlangıç bildirimi (playing / onstart) ile kanıtlanmış ölçüm.' },
        confText));

  const reqText = statText(summary.requestedStat);
  out.push(reqText === null
    ? unavailable(
        { id: 'requested', label: 'speech-end → ilk ses (PROXY)', source: SRC_TRACE, note: '' },
        'Ölçüm yok. Bu satır KANIT DEĞİLDİR: yalnız play()/speak() çağrıldığı anı ölçer.')
    : derived(
        { id: 'requested', label: 'speech-end → ilk ses (PROXY)', source: SRC_TRACE,
          note: 'PROXY: oynatma İSTENDİ anı. Sesin gerçekten duyulduğu KANITLANMADI.' },
        reqText));

  const segs: Array<[string, string, LatencyStat, string]> = [
    ['stt', 'Native STT yakalama', summary.sttCaptureStat, 'stt_request_start → stt_result'],
    ['endpoint', 'Endpoint → metin', summary.endpointStat, 'speech_end → stt_result (speech_end TÜRETİLMİŞ)'],
    ['brain', 'Sağlayıcı (beyin)', summary.brainStat, 'brain_request_start → brain_complete'],
    ['tts', 'TTS isteği → ses istendi', summary.ttsToAudioStat, 'tts_request → first_audio_requested'],
  ];
  for (const [id, label, stat, note] of segs) {
    const txt = statText(stat);
    out.push(txt === null
      ? unavailable({ id: `seg_${id}`, label, source: SRC_TRACE, note: '' }, `Ölçüm yok (${note}).`)
      : derived({ id: `seg_${id}`, label, source: SRC_TRACE, note }, txt));
  }

  out.push(observed(
    { id: 'filler', label: 'Yapay ara söz (engellendi)', source: SRC_TRACE,
      note: 'MAVI-F2: içeriksiz bekletme cümlesi ("Bakıyorum…", "Bir saniye…") üretim '
          + 'yollarından KALDIRILDI ve `maviSpeech` I11 kapısı kalanı KONUŞMADAN düşürür. '
          + 'Bu sayaç seslendirilen ara sözü DEĞİL, yakalanan ihlali gösterir → beklenen '
          + 'değer 0; sıfırdan büyükse bir çağrı yeri ya da modelin ürettiği `feedback` '
          + 'filleri geri getirmiş demektir (REGRESYON).' },
    `${summary.tracesWithFiller} turda · toplam ${summary.fillerTotal}`,
  ));

  out.push(observed(
    { id: 'ack', label: 'Semantik ACK', source: SRC_TRACE,
      note: 'Gerçek ve süren bir işin BAŞLADIĞINI bildiren kısa ara bilgi ("Araç sistemleri '
          + 'taranıyor"). Filler DEĞİLDİR ve bir kusur DEĞİLDİR; bittiğini İDDİA ETMEZ '
          + '(ACK ≠ BAŞARI). Hedefi YOKTUR — yalnız filler ile karışmasın diye ayrı sayılır.' },
    `${summary.tracesWithAck} turda · toplam ${summary.ackTotal}`,
  ));

  out.push(observed(
    { id: 'bargein', label: 'Barge-in', source: SRC_TRACE, note: 'Kullanıcının Mavi\'nin sözünü kestiği tur adedi.' },
    `${summary.bargeInCount} tur`,
  ));

  /* ── MAVI-F3 · STREAMING ASR + SEMANTİK ENDPOINT ───────────────────────── */
  out.push(observed(
    { id: 'partial', label: 'Kısmi transkript görülen tur', source: SRC_TRACE,
      note: 'MAVI-F3: Mavi kullanıcı KONUŞURKEN anlamaya başladı mı. 0 ise streaming hiç '
          + 'akmıyor demektir (eski plugin sürümü · yol FINAL_ONLY · kısmi olay yayınlanmıyor). '
          + 'GİZLİLİK: yalnız ADET tutulur, kısmi METİN bu katmana HİÇ GİRMEZ.' },
    `${summary.tracesWithPartial} tur`,
  ));

  const capText = Object.keys(summary.bySttCapability).length > 0
    ? Object.entries(summary.bySttCapability).map(([k, v]) => `${k}:${v}`).join(' · ')
    : null;
  out.push(capText === null
    ? unavailable({ id: 'stt_capability', label: 'STT akış yeteneği', source: SRC_TRACE,
        note: 'Yetenek VARSAYILMAZ, BİLDİRİLİR.' }, 'Henüz bildirilmedi.')
    : observed({ id: 'stt_capability', label: 'STT akış yeteneği', source: SRC_TRACE,
        note: 'STREAMING_WITH_VAD = kısmi metin + akustik sessizlik (semantik endpoint MÜMKÜN) · '
            + 'STREAMING_TEXT_ONLY = kısmi metin var, sessizlik kanıtı YOK (sahte VAD kurulmaz, '
            + 'endpoint platforma bırakılır) · FINAL_ONLY = yalnız nihai sonuç (bugünkü davranış '
            + 'aynen sürer). Sahte streaming ÜRETİLMEZ.' }, capText));

  const reasonText = Object.keys(summary.byEndpointReason).length > 0
    ? Object.entries(summary.byEndpointReason).map(([k, v]) => `${k}:${v}`).join(' · ')
    : null;
  out.push(reasonText === null
    ? unavailable({ id: 'endpoint_reason', label: 'Cümle-sonu sebebi', source: SRC_TRACE,
        note: 'Karar damgalanmadı.' }, 'Ölçüm yok (endpoint kararı üretilmedi).')
    : observed({ id: 'endpoint_reason', label: 'Cümle-sonu sebebi', source: SRC_TRACE,
        note: 'FINAL_PROVIDER = sağlayıcı kendi bitirdi · ACOUSTIC_TIMEOUT = yalnız sessizlik '
            + 'eşiği (bugünkü davranış) · SEMANTIC_CONFIDENT = anlam + kararlılık + sessizlik '
            + 'birlikte · MAX_DURATION_FAILSAFE = azami söz süresi · CANCELLED = barge-in/iptal.' },
        reasonText));

  out.push(observed(
    { id: 'endpoint_commanded', label: 'Erken bitirme KOMUTU gönderildi', source: SRC_TRACE,
      note: 'MAVI-F3 · GÖLGE KİP AYRIMI: semantik karar VARSAYILAN OLARAK yalnız ÖLÇÜLÜR, '
          + 'sağlayıcıya gönderilmez → cihaz davranışı bugünküyle BİREBİR aynıdır ve erken kesme '
          + 'oranı gerçek kullanıcıyı KESMEDEN ölçülebilir. Bu sayaç 0 iken SEMANTIC_CONFIDENT '
          + 'satırı "karar verilseydi burada biterdi" demektir — konuşmanın gerçekten erken '
          + 'kesildiği anlamına GELMEZ. Komut kipi: uzak bayrak mavi_semantic_endpoint veya '
          + 'localStorage anahtarı mavi.semanticEndpoint.command = "true".' },
    `${summary.endpointCommandedCount} tur`,
  ));

  /* ── MAVI-F4 · AKIŞ CEVABI (streaming LLM → chunked TTS) ───────────────── */
  out.push(observed(
    { id: 'speech_stream', label: 'Akış cevabı konuşulan tur', source: SRC_TRACE,
      note: 'MAVI-F4: Mavi cevabın TAMAMINI beklemeden konuşmaya başladı mı. 0 ise akış hiç '
          + 'kurulmamıştır (şalter KAPALI — varsayılan · sürüş hâli · sağlayıcı FINAL_ONLY) '
          + 've bu bir KUSUR DEĞİLDİR: o hâlde davranış bugünküyle birebir aynıdır. '
          + 'GİZLİLİK: yalnız ADET tutulur; token/metin bu katmana HİÇ GİRMEZ.' },
    `${summary.tracesWithSpeechStream} turda · toplam ${summary.speechChunkTotal} parça`,
  ));

  const llmCapText = Object.keys(summary.byLlmCapability).length > 0
    ? Object.entries(summary.byLlmCapability).map(([k, v]) => `${k}:${v}`).join(' · ')
    : null;
  out.push(llmCapText === null
    ? unavailable({ id: 'llm_capability', label: 'LLM akış yeteneği', source: SRC_TRACE,
        note: 'Yetenek VARSAYILMAZ, BİLDİRİLİR.' }, 'Henüz bildirilmedi.')
    : observed({ id: 'llm_capability', label: 'LLM akış yeteneği', source: SRC_TRACE,
        note: 'TOKEN_STREAM = gerçek SSE token akışı (gateway → OpenRouter · Gemini '
            + 'streamGenerateContent) · FINAL_ONLY = yalnız tam cevap (doğrudan Gemini '
            + 'generateContent · Groq · Haiku · offline). Sahte streaming ÜRETİLMEZ.' },
        llmCapText));

  const endText = Object.keys(summary.byStreamEnd).length > 0
    ? Object.entries(summary.byStreamEnd).map(([k, v]) => `${k}:${v}`).join(' · ')
    : null;
  out.push(endText === null
    ? unavailable({ id: 'stream_end', label: 'Akış bitiş sebebi', source: SRC_TRACE,
        note: 'Akış kurulmadı.' }, 'Ölçüm yok (akış cevabı çalışmadı).')
    : observed({ id: 'stream_end', label: 'Akış bitiş sebebi', source: SRC_TRACE,
        note: 'COMPLETED = tüm parçalar seslendirildi · CANCELLED = barge-in/yeni tur · '
            + 'UPSTREAM_STALLED = sağlayıcı yarıda öldü (söylenen kadarı korundu, yarım cevap '
            + '"tamamlandı" SAYILMADI) · SPEECH_STALLED = seslendirme motoru parçayı aldı ama '
            + 'bitiş bildirimi HİÇ gelmedi (native TTS/audio focus düştü; akış asılı kalmadan '
            + 'dürüstçe kapatıldı) · EMPTY = konuşulacak metin çıkmadı (yapısal çıktı — '
            + 'action/web — akıştan HİÇBİR ŞEY konuşulmaz).' },
        endText));


  const outcomes = Object.keys(summary.byOutcome).sort();
  out.push(outcomes.length === 0
    ? unavailable({ id: 'outcomes', label: 'Sonuç dağılımı', source: SRC_TRACE, note: '' }, 'İz yok.')
    : observed({ id: 'outcomes', label: 'Sonuç dağılımı', source: SRC_TRACE,
        note: 'İstatistiğe YALNIZ `completed` girer.' },
        outcomes.map((k) => `${k}:${summary.byOutcome[k]}`).join(' · ')));

  out.push(observed(
    { id: 'audioclass', label: 'İlk ses kanıt dağılımı', source: SRC_TRACE,
      note: 'REQUESTED bir kanıt DEĞİLDİR — yalnız oynatmanın istendiğini gösterir.' },
    `doğrulandı:${summary.byFirstAudio.CONFIRMED} · istendi:${summary.byFirstAudio.REQUESTED} · yok:${summary.byFirstAudio.NONE}`,
  ));

  out.push(input.orphanMarks === 0
    ? observed({ id: 'orphan', label: 'Sahipsiz damga', source: SRC_TRACE,
        note: 'Açık iz yokken gelen marker — enstrümantasyon boşluğu göstergesi.' }, 0)
    : derived({ id: 'orphan', label: 'Sahipsiz damga', source: SRC_TRACE,
        note: 'Açık iz yokken marker geldi: ölçüm zinciri bir noktada kopuyor.' }, input.orphanMarks));

  out.push(observed(
    { id: 'integrity', label: 'Damga bütünlüğü', source: SRC_TRACE,
      note: 'Tekrar eden damgada İLK gerçekleşme korunur; geçersiz marker sessizce reddedilir.' },
    `tekrar:${input.duplicateMarks} · geçersiz:${input.invalidMarks}`,
  ));

  out.push(observed(
    { id: 'foreignaudio', label: 'Yabancı ses damgası', source: SRC_TRACE,
      note: 'Mavi cevabı seslendirmeye VERİLMEDEN gelen ses damgası (navigasyon talimatı · güvenlik uyarısı · bildirim okuma). Ana metriği bozmasın diye DÜŞÜRÜLÜR — sessizce yutulmaz, burada sayılır.' },
    input.foreignAudioMarks,
  ));

  return out;
}

/** Tek iz için satır özeti (drill-down tablosu). */
export interface TraceRow {
  readonly traceId: number;
  readonly turnId: number | null;
  readonly outcome: string;
  readonly route: string | null;
  readonly provider: string | null;
  readonly presence: 'companion' | 'assistant' | null;
  readonly failureCode: string | null;
  readonly firstAudio: FirstAudioEvidenceLevel;
  readonly speechEndDerived: boolean;
  readonly fillerCount: number;
  readonly ackCount: number;
  readonly partialCount: number;
  readonly endpointReason: string | null;
  readonly sttCapability: string | null;
  readonly endpointCommanded: boolean;
  readonly speechChunkCount: number;
  readonly llmCapability: string | null;
  readonly streamEndReason: string | null;
  readonly bargeIn: boolean;
  readonly segments: TraceSegments;
  /** Ana metrik metni — kanıtlı varsa o, yoksa proxy, hiçbiri yoksa null. */
  readonly headlineMs: number | null;
  readonly headlineIsProxy: boolean;
}

export function buildTraceRows(traces: readonly TraceShape[]): TraceRow[] {
  const rows: TraceRow[] = [];
  // En yeni başta — saha teşhisinde son tur en çok bakılandır.
  for (let i = traces.length - 1; i >= 0; i--) {
    const t = traces[i];
    const segments = deriveTraceSegments(t);
    const conf = segments.speechEndToFirstAudioConfirmedMs;
    const req = segments.speechEndToFirstAudioRequestedMs;
    rows.push(Object.freeze({
      traceId: t.traceId,
      turnId: t.turnId,
      outcome: t.outcome,
      route: t.route,
      provider: t.provider,
      presence: t.presence,
      failureCode: t.failureCode,
      firstAudio: firstAudioEvidenceOf(t),
      speechEndDerived: speechEndIsDerived(t),
      fillerCount: t.fillerCount,
      ackCount: typeof t.ackCount === 'number' ? t.ackCount : 0,
      partialCount: typeof t.partialCount === 'number' ? t.partialCount : 0,
      endpointReason: t.endpointReason ?? null,
      sttCapability: t.sttCapability ?? null,
      endpointCommanded: t.endpointCommanded === true,
      speechChunkCount: typeof t.speechChunkCount === 'number' ? t.speechChunkCount : 0,
      llmCapability: t.llmCapability ?? null,
      streamEndReason: t.streamEndReason ?? null,
      bargeIn: t.bargeIn,
      segments,
      headlineMs: conf !== null ? conf : req,
      headlineIsProxy: conf === null && req !== null,
    }));
  }
  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAHA KAYDI (MAVI-FIELD-1) — SAF BİÇİMLENDİRİCİ, YENİ OTORİTE DEĞİL
 * ════════════════════════════════════════════════════════════════════════
 * Gerçek head-unit turunda her Mavi turu tek okunabilir satıra iner. Bu blok
 * HİÇBİR yeni ölçüm yapmaz: yalnız `deriveTraceSegments` + `slaClassOfRoute` +
 * `firstAudioEvidenceOf` çıktısını kopyalanabilir metne çevirir.
 *
 * DÜRÜSTLÜK KURALLARI:
 *  · Ölçülmeyen alan `-` yazılır; sıfır UYDURULMAZ.
 *  · Sağlayıcı kritik yolda değilse `provider=BYPASSED_LOCAL` AÇIKÇA görünür.
 *  · `total` kanıtlı süredir; yalnız proxy varsa `~` öneki ve `PROXY` etiketi
 *    taşır — proxy, kanıtlanmış ilk ses gibi SUNULMAZ.
 *  · `speech_end` türetilmişse (native VAD deltası) `speechEnd=derived` yazar.
 */

/** Sağlayıcı kritik yolda mıydı — rota bunu zaten söyler. */
function providerCellOf(t: TraceShape, seg: TraceSegments): string {
  if (seg.brainMs !== null) return `${t.provider ?? 'provider'}:${seg.brainMs}ms`;
  return slaClassOfRoute(t.route) === 'CLOUD' ? 'NO_PROVIDER_MARK' : 'BYPASSED_LOCAL';
}

const cell = (v: number | null): string => (v === null ? '-' : `${v}`);

/**
 * Tek turun saha satırı. Sıra saha raporundaki sütun sırasıyla BİREBİRDİR.
 * En yeni tur BAŞTA döner (`buildTraceRows` ile aynı kural).
 */
export function buildFieldTraceLines(traces: readonly TraceShape[]): string[] {
  const out: string[] = [];
  for (let i = traces.length - 1; i >= 0; i--) {
    const t = traces[i];
    const s = deriveTraceSegments(t);
    const ev = firstAudioEvidenceOf(t);
    const conf = s.speechEndToFirstAudioConfirmedMs;
    const req = s.speechEndToFirstAudioRequestedMs;
    const total = conf !== null ? `${conf}` : req !== null ? `~${req}` : '-';
    const ttsMs = conf !== null
      ? (s.ttsToFirstAudioMs !== null && s.requestedToConfirmedMs !== null
        ? s.ttsToFirstAudioMs + s.requestedToConfirmedMs : null)
      : s.ttsToFirstAudioMs;
    const routing = s.textToRouteMs !== null && s.routeToBrainMs !== null
      ? s.textToRouteMs + s.routeToBrainMs
      : s.textToRouteMs;
    out.push([
      `turn=${t.turnId ?? '-'}`,
      `trace=${t.traceId}`,
      `sla=${slaClassOfRoute(t.route)}`,
      `route=${t.route ?? '-'}`,
      `outcome=${t.outcome}`,
      `endpoint=${cell(s.speechEndToEndpointMs)}`,
      `asr=${cell(s.endpointToFinalMs)}`,
      `routing=${cell(routing)}`,
      `provider=${providerCellOf(t, s)}`,
      `tts=${cell(ttsMs)}`,
      `total=${total}`,
      `evidence=${ev}`,
      `speechEnd=${speechEndIsDerived(t) ? 'derived' : 'observed'}`,
      `endpointReason=${t.endpointReason ?? '-'}`,
      `endpointCommanded=${t.endpointCommanded === true}`,
      `filler=${t.fillerCount}`,
      `bargeIn=${t.bargeIn}`,
      `fail=${t.failureCode ?? '-'}`,
    ].join(' '));
  }
  return out;
}

/** Ham damga listesi (drill-down) — sıralı, TÜRETİLMİŞ olanlar işaretli. */
export interface MarkRow {
  readonly marker: string;
  readonly offsetMs: number | null;
  readonly origin: MarkOriginShape;
}

const MARK_ORDER: readonly string[] = [
  'listen_start', 'stt_request_start', 'speech_start', 'speech_end', 'stt_result',
  'cloud_stt_start', 'cloud_stt_end', 'route_start', 'brain_request_start',
  'first_partial', 'stable_partial', 'semantic_complete_candidate',
  'endpoint_decision', 'final_transcript_ready',
  'first_speech_chunk_ready', 'first_tts_chunk_request', 'first_tts_chunk_ready',
  'llm_stream_complete', 'tts_stream_complete', 'stream_cancelled',
  'brain_first_token', 'brain_complete', 'filler_trigger', 'ack_emitted', 'tts_request',
  'tts_audio_ready', 'first_audio_requested', 'first_audio_confirmed',
  'response_complete', 'barge_in',
];

/** Damgaları `listen_start` ankoruna göre göreli ms olarak listeler. */
export function buildMarkRows(t: TraceShape): MarkRow[] {
  const anchor = at(t, 'listen_start');
  const rows: MarkRow[] = [];
  for (const marker of MARK_ORDER) {
    const m = t.marks[marker];
    if (!m) continue;
    const off = anchor === null ? null : Math.round(m.at - anchor);
    rows.push(Object.freeze({
      marker,
      offsetMs: off !== null && off >= 0 ? off : null,
      origin: m.origin === 'derived' ? 'derived' : 'observed',
    }));
  }
  return rows;
}

export { MARK_ORDER as MAVI_LATENCY_MARK_ORDER };
