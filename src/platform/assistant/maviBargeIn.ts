/**
 * maviBargeIn.ts — **MAVİ F12 · KESME ÖNERİSİ HAKEMİ (tek konuşma kontrolü).**
 *
 * ── NE ÇÖZER ────────────────────────────────────────────────────────────────
 * Mavi konuşurken kullanıcının araya girebilmesi için üç ayrı soru vardır ve
 * bunlar BİRBİRİNE KARIŞTIRILAMAZ:
 *
 *   1. **Kesme önerildi mi?**  → bu dosya (hakem)
 *   2. **Kim konuşma sırasını alır?** → `maviTurn` (tek otorite, DEĞİŞMEDİ)
 *   3. **Ses fiilen nasıl durur?** → `ttsService` + `maviResponseStream` (F4 zinciri)
 *
 * Bu dosya YALNIZ 1'i yapar. **Yeni bir ses otoritesi DEĞİLDİR:** tur açmaz,
 * mikrofon açmaz, TTS kesmez, eylem yürütmez, capability kapatmaz. Çıktısı bir
 * HÜKÜMdür; hükmü uygulayan `voiceService.interruptAndListen()`tir.
 *
 * ── NEDEN AYRI KATMAN ───────────────────────────────────────────────────────
 * Kesme kararının kanıt kalitesi, kesmenin YÜRÜTÜLMESİNDEN bağımsız olarak
 * denetlenebilmelidir. "Ses seviyesi yükseldi → sus" bir karar DEĞİL, bir
 * arızadır: yol gürültüsü, müzik transient'i, navigasyon promptu ve **Mavi'nin
 * kendi hoparlör sesi** aynı enerjiyi üretir. Hakem bu ayrımı tek yerde,
 * kanıt tipi üzerinden yapar ve kanıt yoksa **mevcut konuşmayı sürdürür**.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · **VAD/enerji TEK BAŞINA asla kabul edilmez.** (Kural: sahte kesme yasağı.)
 *  · **Korunan ses kesilemez:** güvenlik · tehlike · navigasyon · telefon.
 *    Kullanıcının Mavi'yi kesebilmesi, bu kanalları kesme yetkisi DEĞİLDİR.
 *  · **İş yükü (F8) bu kararın GİRDİSİ DEĞİLDİR.** Workload iletişim bütçesi
 *    koyar; konuşma otoritesi kurmaz. Bu dosya `maviWorkload`u import ETMEZ
 *    (kilit testi denetler).
 *  · **Sahte duplex üretilmez:** akustik kanıt ancak `duplexCapability` o yolu
 *    kanıtladığında kabul edilir.
 *  · **SAF DEĞİL ama İZOLE:** yalnız modül-içi bounded sayaçlar tutulur; I/O ·
 *    timer · `Date.now` · store · React · ağ YOKTUR (zaman DIŞARIDAN gelir).
 */

import {
  classifyMaviDuplex, duplexAllowsAcousticBargeIn, duplexHasSelfEchoRisk,
  MAVI_MEASURED_DUPLEX_EVIDENCE,
  type MaviDuplexClass, type MaviDuplexEvidence,
} from '../voice/duplexCapability';

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme
 * ════════════════════════════════════════════════════════════════════════ */

/** Kesme önerisinin KANIT TÜRÜ — bounded, dört sınıf. */
export type BargeInEvidenceKind =
  /** Kullanıcının açık eylemi (mikrofon/kes düğmesi · donanım tuşu). Akustik DEĞİL. */
  | 'EXPLICIT_USER'
  /** Wake sözü tetiklendi (native grammar). */
  | 'WAKE_TRIGGER'
  /** Streaming ASR kısmi transkripti geldi (F3 oturumu). */
  | 'ASR_PARTIAL'
  /** Yalnız enerji/VAD yükseldi — **tek başına ASLA yeterli değildir**. */
  | 'VAD_ENERGY';

export interface BargeInProposal {
  readonly evidence: BargeInEvidenceKind;
  /** Monotonik damga (ms). Ölçülemiyorsa `-1` verilir — "şimdi" UYDURULMAZ. */
  readonly atMs: number;
  /**
   * Ölçülen kullanıcı konuşma süresi (ms). `undefined`/negatif = **ÖLÇÜLMEDİ**.
   * Ölçülmemiş süre "yeterli" sayılmaz (fail-closed).
   */
  readonly speechMs?: number;
  /**
   * Tanıma güveni ×1000 (0–1000). `undefined`/negatif = **ÖLÇÜLMEDİ**.
   * Vosk küçük TR modeli çoğu yolda güven vermez; o durumda uydurulmaz.
   */
  readonly confidenceMilli?: number;
}

/**
 * Kesme anındaki ses bağlamı. Çağıran bunu **kanonik kaynaklardan** okur
 * (`ttsService`); hakem kendi gerçeğini üretmez.
 */
export interface BargeInContext {
  /** Şu an Mavi'nin bir sözü seslendiriliyor mu (`isTtsSpeaking()`). */
  readonly ttsSpeaking: boolean;
  /** Uçuştaki söz KORUNAN bir kanal mı (güvenlik · tehlike · navigasyon · telefon). */
  readonly protectedSpeech: boolean;
  /**
   * Bu TTS yolu çalarken mikrofon FİİLEN açık mı.
   * Native motor yolunda `false` (wake thread mikrofonu bırakır); WebView ses
   * yollarında (klip · Edge · online · `speechSynthesis`) `true` — orada Mavi
   * kendi sesini duyabilir ve self-echo riski GERÇEKTİR.
   */
  readonly captureOpenOnThisPath: boolean;
}

/** Hükmün gerekçesi — bounded telemetri KODU (serbest metin DEĞİL). */
export type BargeInVerdictReason =
  /** Kullanıcının açık eylemi — akustik kanıt aranmaz. */
  | 'ACCEPTED_EXPLICIT'
  /** Akustik kanıt duplex sınıfının eşiklerini geçti. */
  | 'ACCEPTED_SPEECH_EVIDENCE'
  /** Ortada seslendirilen bir söz yok → kesilecek bir şey yok (hata DEĞİL). */
  | 'REJECTED_NOT_SPEAKING'
  /** Güvenlik/tehlike/navigasyon/telefon sesi kesilemez (öncelik korunur). */
  | 'REJECTED_PROTECTED_AUDIO'
  /** Mikrofon açık ama echo koruması KANITLANMADI → tetik Mavi'nin kendi sesi olabilir. */
  | 'REJECTED_SELF_ECHO_RISK'
  /** Bu ses yolu akustik kesmeyi desteklemiyor (yarım-duplex / iptal zinciri yok). */
  | 'REJECTED_DUPLEX_UNSUPPORTED'
  /** Kanıt tipi tek başına yetersiz (VAD/enerji) ya da ölçüm hiç yok. */
  | 'REJECTED_EVIDENCE_INSUFFICIENT'
  /** Konuşma süresi eşiğin altında (kısa spike). */
  | 'REJECTED_TOO_SHORT'
  /** Az önce kabul edilmiş bir kesme var — tekrar kesme gürültüdür. */
  | 'REJECTED_DEBOUNCE';

export interface BargeInVerdict {
  readonly accepted: boolean;
  readonly reason: BargeInVerdictReason;
  readonly duplexClass: MaviDuplexClass;
}

/* ── Eşikler ──────────────────────────────────────────────────────────────
 * Hepsi FAIL-CLOSED yönde seçildi: ölçüm yoksa eşik geçilmiş SAYILMAZ. */

/** Kısa mikrofon spike'ı konuşma değildir. Türkçe tek hece ~180-250 ms. */
export const BARGE_IN_MIN_SPEECH_MS = 300;
/** İki kabul arası asgari mesafe — kesme sonrası eko kuyruğu tekrar kesmesin. */
export const BARGE_IN_DEBOUNCE_MS = 1_200;
/** `AEC_GATED_DUPLEX`te asgari tanıma güveni (×1000). Referans sinyali yok → yüksek. */
export const BARGE_IN_MIN_CONF_MILLI = 700;

/* ══════════════════════════════════════════════════════════════════════════
 * Duplex kanıtı — TEK yerde tutulur
 * ════════════════════════════════════════════════════════════════════════ */

let _evidence: MaviDuplexEvidence = MAVI_MEASURED_DUPLEX_EVIDENCE;

/**
 * Duplex kanıtını günceller (native yetenek ölçülürse composition root çağırır).
 * Çağrılmazsa **repoda ÖLÇÜLEN** kanıt geçerlidir — iyimser varsayım YOK.
 */
export function setMaviDuplexEvidence(ev: MaviDuplexEvidence | null | undefined): void {
  _evidence = ev && typeof ev === 'object' ? ev : MAVI_MEASURED_DUPLEX_EVIDENCE;
}

export function getMaviDuplexEvidence(): MaviDuplexEvidence {
  return _evidence;
}

/** Geçerli duplex sınıfı — LAB ve hakem aynı tek kaynağı okur. */
export function currentMaviDuplexClass(): MaviDuplexClass {
  try { return classifyMaviDuplex(_evidence); } catch { return 'UNSUPPORTED'; }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded defter — **PII YOK** (transkript · ses · metin TAŞINMAZ)
 * ════════════════════════════════════════════════════════════════════════ */

const MAX_COUNTER = 1_000_000;
const bump = (v: number): number => (v >= MAX_COUNTER ? MAX_COUNTER : v + 1);

let _proposals = 0;
let _accepted = 0;
let _lastReason: BargeInVerdictReason | null = null;
const _reasonCounts: Record<string, number> = {};
const _evidenceCounts: Record<string, number> = {};

/** Kabul edilen son kesmenin damgası (monotonik). `-1` = hiç kabul yok. */
let _lastAcceptedAtMs = -1;
/** TTS durdurma İSTEĞİ gecikmesi (kabul → `ttsCancel()` çağrıldı). */
let _lastTtsStopMs = -1;
let _maxTtsStopMs = -1;
let _ttsStopSamples = 0;
/** Yeni dinlemenin AÇILDIĞI ana kadar geçen süre (kabul → `status:'listening'`). */
let _lastListenMs = -1;
let _maxListenMs = -1;
let _listenSamples = 0;

function _count(map: Record<string, number>, key: string): void {
  map[key] = bump(map[key] ?? 0);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hüküm
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kesme önerisini değerlendirir. **Yan etkisi YALNIZ bounded sayaçlardır** —
 * TTS kesmez, tur açmaz, mikrofon açmaz.
 *
 * Sıra bilinçlidir (ilk eşleşen kazanır):
 *  1. Konuşma yoksa kesilecek bir şey yoktur (`REJECTED_NOT_SPEAKING`).
 *  2. Korunan ses (güvenlik/tehlike/navigasyon/telefon) HİÇBİR kanıtla kesilmez.
 *  3. Açık kullanıcı eylemi akustik kanıt aramaz — kullanıcı daima kazanır.
 *  4. Akustik kanıt için ses yolu duplex'i KANITLAMIŞ olmalı; kanıtlanmadıysa
 *     tetik Mavi'nin kendi sesi olabilir → self-echo reddi.
 *  5. VAD/enerji tek başına ASLA yeterli değildir.
 *  6. Debounce · ölçülmüş süre · (AEC-kapılı yolda) güven eşiği.
 */
export function evaluateBargeIn(
  proposal: BargeInProposal | null | undefined,
  ctx: BargeInContext | null | undefined,
): BargeInVerdict {
  const duplexClass = currentMaviDuplexClass();
  const kind: BargeInEvidenceKind = proposal?.evidence ?? 'VAD_ENERGY';

  const verdict = (accepted: boolean, reason: BargeInVerdictReason): BargeInVerdict => {
    try {
      _proposals = bump(_proposals);
      _lastReason = reason;
      _count(_reasonCounts, reason);
      _count(_evidenceCounts, kind);
      if (accepted) {
        _accepted = bump(_accepted);
        const t = proposal?.atMs;
        _lastAcceptedAtMs = typeof t === 'number' && Number.isFinite(t) && t >= 0 ? t : -1;
      }
    } catch { /* defter hatası hükmü BOZMAZ */ }
    return Object.freeze({ accepted, reason, duplexClass });
  };

  if (!proposal || !ctx) return verdict(false, 'REJECTED_EVIDENCE_INSUFFICIENT');

  /* 1 — Ortada söz yoksa bu bir kesme değildir. Hata DEĞİLDİR: çağıran normal
   *     dinleme yoluna devam eder (davranış bugünküyle aynı). */
  if (ctx.ttsSpeaking !== true) return verdict(false, 'REJECTED_NOT_SPEAKING');

  /* 2 — ÖNCELİK PAZARLIKSIZ. Kullanıcının Mavi'yi kesebilmesi, güvenlik/
   *     navigasyon/telefon kanallarını kesme yetkisi DEĞİLDİR (K1 korunur). */
  if (ctx.protectedSpeech === true) return verdict(false, 'REJECTED_PROTECTED_AUDIO');

  /* 3 — Açık kullanıcı eylemi: kullanıcı ve Mavi aynı anda konuştuysa
   *     KULLANICI KAZANIR (spec §9.8). Akustik kanıt aranmaz, debounce
   *     uygulanmaz (düğmeye basmak yankı olamaz). */
  if (kind === 'EXPLICIT_USER') return verdict(true, 'ACCEPTED_EXPLICIT');

  /* 4 — Akustik yol: duplex KANITLANMIŞ olmalı. */
  if (!duplexAllowsAcousticBargeIn(duplexClass)) {
    if (duplexHasSelfEchoRisk(_evidence, ctx.captureOpenOnThisPath === true)) {
      return verdict(false, 'REJECTED_SELF_ECHO_RISK');
    }
    return verdict(false, 'REJECTED_DUPLEX_UNSUPPORTED');
  }

  /* 5 — Enerji bir kanıt değildir (yol gürültüsü · müzik transient'i · hoparlör). */
  if (kind === 'VAD_ENERGY') return verdict(false, 'REJECTED_EVIDENCE_INSUFFICIENT');

  /* 6a — Debounce: kesmenin hemen ardındaki eko kuyruğu ikinci kez kesmesin. */
  const at = proposal.atMs;
  const atOk = typeof at === 'number' && Number.isFinite(at) && at >= 0;
  if (atOk && _lastAcceptedAtMs >= 0 && at - _lastAcceptedAtMs < BARGE_IN_DEBOUNCE_MS) {
    return verdict(false, 'REJECTED_DEBOUNCE');
  }

  /* 6b — ÖLÇÜLMEMİŞ süre "yeterli" sayılmaz. Olmayan sinyal uydurulmaz. */
  const ms = proposal.speechMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return verdict(false, 'REJECTED_EVIDENCE_INSUFFICIENT');
  }
  if (ms < BARGE_IN_MIN_SPEECH_MS) return verdict(false, 'REJECTED_TOO_SHORT');

  /* 6c — Referans sinyali kanıtı yoksa (AEC_GATED) güven eşiği ZORUNLUDUR. */
  if (duplexClass === 'AEC_GATED_DUPLEX') {
    const c = proposal.confidenceMilli;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0) {
      return verdict(false, 'REJECTED_EVIDENCE_INSUFFICIENT');
    }
    if (c < BARGE_IN_MIN_CONF_MILLI) return verdict(false, 'REJECTED_EVIDENCE_INSUFFICIENT');
  }

  return verdict(true, 'ACCEPTED_SPEECH_EVIDENCE');
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gecikme ölçümü — **DÜRÜST İSİMLENDİRME**
 * ════════════════════════════════════════════════════════════════════════ */

function _observe(deltaMs: number, kind: 'tts' | 'listen'): void {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return;
  if (kind === 'tts') {
    _lastTtsStopMs = deltaMs;
    if (deltaMs > _maxTtsStopMs) _maxTtsStopMs = deltaMs;
    _ttsStopSamples = bump(_ttsStopSamples);
  } else {
    _lastListenMs = deltaMs;
    if (deltaMs > _maxListenMs) _maxListenMs = deltaMs;
    _listenSamples = bump(_listenSamples);
  }
}

/**
 * `ttsCancel()` İSTEĞİ gönderildi.
 *
 * ⚠️ **Bu, sesin fiilen sustuğunun kanıtı DEĞİLDİR.** Native `TextToSpeech.stop()`
 * bir isteği kuyruklar; hoparlörün gerçekte ne zaman sustuğu ancak akustik
 * ölçümle bilinir (bkz. kütük — DEVICE VALIDATION REQUIRED). F0'ın
 * `first_audio_requested` / `first_audio_confirmed` ayrımıyla AYNI dürüstlük.
 */
export function noteBargeInTtsStopRequested(atMs: number): void {
  if (_lastAcceptedAtMs < 0 || !Number.isFinite(atMs)) return;
  _observe(atMs - _lastAcceptedAtMs, 'tts');
}

/** Yeni dinleme penceresi GERÇEKTEN açıldı (`status:'listening'`). */
export function noteBargeInListeningOpened(atMs: number): void {
  if (_lastAcceptedAtMs < 0 || !Number.isFinite(atMs)) return;
  _observe(atMs - _lastAcceptedAtMs, 'listen');
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tanı yüzeyi (CAROS LAB) — salt okunur · bounded · PII YOK
 * ════════════════════════════════════════════════════════════════════════ */

export interface MaviBargeInDiagnostics {
  readonly duplexClass: MaviDuplexClass;
  readonly captureOpenDuringTts: boolean;
  readonly aecCountsForDuplex: boolean;
  readonly echoReferenceWired: boolean;
  readonly proposals: number;
  readonly accepted: number;
  readonly lastReason: BargeInVerdictReason | null;
  readonly reasons: Readonly<Record<string, number>>;
  readonly evidenceKinds: Readonly<Record<string, number>>;
  /** `-1` = hiç ölçüm yok (sahte `0` ÜRETİLMEZ). */
  readonly lastTtsStopRequestMs: number;
  readonly maxTtsStopRequestMs: number;
  readonly ttsStopSamples: number;
  readonly lastListenOpenMs: number;
  readonly maxListenOpenMs: number;
  readonly listenSamples: number;
  readonly countersSaturated: boolean;
}

export function getMaviBargeInDiagnostics(): MaviBargeInDiagnostics {
  const ev = _evidence;
  return Object.freeze({
    duplexClass: currentMaviDuplexClass(),
    captureOpenDuringTts: ev.captureOpenDuringTts === true,
    aecCountsForDuplex: ev.aecEnabled === true && ev.aecEvidencePath === 'DUPLEX_CAPTURE',
    echoReferenceWired: ev.echoReferenceWired === true,
    proposals: _proposals,
    accepted: _accepted,
    lastReason: _lastReason,
    reasons: Object.freeze({ ..._reasonCounts }),
    evidenceKinds: Object.freeze({ ..._evidenceCounts }),
    lastTtsStopRequestMs: _lastTtsStopMs,
    maxTtsStopRequestMs: _maxTtsStopMs,
    ttsStopSamples: _ttsStopSamples,
    lastListenOpenMs: _lastListenMs,
    maxListenOpenMs: _maxListenMs,
    listenSamples: _listenSamples,
    countersSaturated: _proposals >= MAX_COUNTER || _accepted >= MAX_COUNTER,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetMaviBargeInForTest(): void {
  _evidence = MAVI_MEASURED_DUPLEX_EVIDENCE;
  _proposals = 0;
  _accepted = 0;
  _lastReason = null;
  for (const k of Object.keys(_reasonCounts)) delete _reasonCounts[k];
  for (const k of Object.keys(_evidenceCounts)) delete _evidenceCounts[k];
  _lastAcceptedAtMs = -1;
  _lastTtsStopMs = -1; _maxTtsStopMs = -1; _ttsStopSamples = 0;
  _lastListenMs = -1; _maxListenMs = -1; _listenSamples = 0;
}
