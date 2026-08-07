/**
 * sttMicSources.ts — Mavi STT / Mikrofon ekranının TEK okuma noktası (MAVI-STT-LAB-1).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ getter. `await` YOK.
 *  · Native gözlem ÖNBELLEKTEN okunur (pull, ekranın tek atışlık YENİLE'siyle yapılır).
 *  · Mikrofon açma/kapama · STT veya wake motoru başlatma/durdurma · eşik değiştirme ·
 *    AudioSource seçme · AEC/NS/AGC aç-kapa · izin isteği — HİÇBİRİ YOK.
 *  · Abonelik, timer, listener AÇILMAZ. Yeni telemetri servisi/kalıcı depo KURULMAZ.
 *  · Her kaynak AYRI try/catch → biri patlarsa diğerleri okunur, alan KAYNAK YOK olur.
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 *  `getWakeWordState()` CANLI durumu döndürür ve içinde `wakeWords` (asistan adı /
 *  özel wake cümlesi) ile `lastHeard` (pasif döngünün duyduğu TRANSCRIPT'ler) vardır.
 *  Bu katman o referansı SAKLAMAZ ve DIŞARI VERMEZ: anında bayrak ve ADEDE indirger.
 *  Aynı şekilde `getVoiceSnapshot()` içindeki transcript/lastCommand/history METNİ
 *  hiçbir alana yazılmaz. Dışarı çıkan tipte (`SttMicRaw`) metin taşıyan kullanıcı-
 *  içeriği alanı YOKTUR — sızıntı tip olarak imkânsızdır.
 *
 * ── EŞ-ZAMANLI ÖRNEKLEME ────────────────────────────────────────────────────
 *  Araç hızı ile gürültü tabanı KARŞILAŞTIRILABİLİR olsun diye araç bağlamı, native
 *  önbellek okumasıyla AYNI senkron turda ve AYNI `readAt` damgasıyla alınır. Native
 *  snapshot'ın kendi damgası ayrıca taşınır; model ikisi arasındaki sapmayı gösterir.
 */

import { getVoiceMicDiagnostics } from '../voice/voiceMicDiagnosticsProbe';
import { getWakeWordState, getWakeWatchdogStats } from '../wakeWordService';
import { getVoiceSnapshot } from '../voiceService';
import { buildCommandGrammar } from '../commandParser';
import { currentMaviVehicleContext } from '../assistant/maviVehicleContext';
import { getGrammarDiagnostics } from '../voice/contextGrammarApplier';
import { grammarProvidersWired } from '../voice/contextGrammarProviders';
import type {
  SttMicRaw, SttSourceRaw, SttEffectsRaw, SttVadRaw, SttEngineRaw,
  SttVehicleRaw, SttJsRaw, SttSourceAttemptRaw, SttGrammarRaw,
} from './sttMicModel';
import { MAX_RMS_SAMPLES, MAX_SOURCE_ATTEMPTS } from './sttMicModel';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

function _str(v: unknown, fallback = 'UNKNOWN'): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** Sayı; geçersizse sentinel (-1 = ölçüm yok · 0 UYDURULMAZ). */
function _num(v: unknown, fallback = -1): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function _count(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** Duvar-saati damgası; 0/negatif/NaN → null ("şimdi" UYDURULMAZ). */
function _wallTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function readSttMicSnapshot(): SttMicRaw {
  const readAt = Date.now();

  const native = _safe(() => getVoiceMicDiagnostics());
  const present = !!(native && native.present === true);

  let source:  SttSourceRaw  | null = null;
  let effects: SttEffectsRaw | null = null;
  let vad:     SttVadRaw     | null = null;
  let stt:     SttEngineRaw  | null = null;

  if (present && native) {
    const s = native.source;
    if (s) {
      const attempts: SttSourceAttemptRaw[] = [];
      if (Array.isArray(s.attempts)) {
        for (const a of s.attempts) {
          if (!a || attempts.length >= MAX_SOURCE_ATTEMPTS) break;
          attempts.push({
            source:     _num(a.source),
            sourceName: _str(a.sourceName),
            outcome:    _str(a.outcome, 'EXCEPTION'),
          });
        }
      }
      source = {
        // -1 sentinel AYNEN korunur — "seçilmedi" ile "kaynak 0 (DEFAULT)" AYRIDIR.
        selectedSource:     _num(s.selectedSource),
        selectedSourceName: _str(s.selectedSourceName),
        sampleRate:         _num(s.sampleRate, 0),
        channelCount:       _num(s.channelCount, 0),
        bufferBytes:        _num(s.bufferBytes, 0),
        frameSamples:       _num(s.frameSamples, 0),
        attempts,
      };
    }

    const fx = native.effects;
    if (fx) {
      const errors: string[] = [];
      if (Array.isArray(fx.errors)) {
        for (const e of fx.errors) {
          if (typeof e === 'string' && e.length > 0 && errors.length < 4) errors.push(e);
        }
      }
      effects = {
        probed:       fx.probed === true,
        aecAvailable: fx.aecAvailable === true, aecCreated: fx.aecCreated === true, aecEnabled: fx.aecEnabled === true,
        nsAvailable:  fx.nsAvailable  === true, nsCreated:  fx.nsCreated  === true, nsEnabled:  fx.nsEnabled  === true,
        agcAvailable: fx.agcAvailable === true, agcCreated: fx.agcCreated === true, agcEnabled: fx.agcEnabled === true,
        errors,
      };
    }

    const v = native.vad;
    if (v) {
      const samples: number[] = [];
      if (Array.isArray(v.samples)) {
        for (const n of v.samples) {
          if (typeof n === 'number' && Number.isFinite(n) && samples.length < MAX_RMS_SAMPLES) samples.push(n);
        }
      }
      vad = {
        present:            v.present === true,
        lastRms:            _num(v.lastRms),
        noiseFloor:         _num(v.noiseFloor),
        effectiveThreshold: _num(v.effectiveThreshold),
        staticMinThreshold: _num(v.staticMinThreshold),
        floorFactor:        _num(v.floorFactor),
        speechDetected:     v.speechDetected === true,
        lastAudioAtMs:      _num(v.lastAudioAtMs, 0),
        monotonicNowMs:     _num(v.monotonicNowMs, 0),
        sampleCount:        _num(v.sampleCount, 0),
        samples,
      };
    }

    const e = native.stt;
    if (e) {
      stt = {
        wakeEngineActive:       e.wakeEngineActive === true,
        activeRecognizerActive: e.activeRecognizerActive === true,
        grammarType:            _str(e.grammarType, 'free'),
        grammarWordCount:       _num(e.grammarWordCount),
        lastResultCategory:     typeof e.lastResultCategory === 'string' && e.lastResultCategory.length > 0
          ? e.lastResultCategory : null,
        lastResultAt:           _num(e.lastResultAt, 0),
      };
    }
  }

  /* ── Araç bağlamı — AYNI okuma turu, AYNI damga ──────────────────────────
     Mevcut getter okunur; yeni sağlayıcı KURULMAZ. Kanıt yoksa `speedKmh: null`
     gelir (resolver sözleşmesi) → model BİLİNMİYOR gösterir, 0 YAZMAZ. */
  const ctx = _safe(() => currentMaviVehicleContext(readAt));
  const vehicle: SttVehicleRaw | null = ctx ? {
    speedKmh: typeof ctx.speedKmh === 'number' && Number.isFinite(ctx.speedKmh) ? ctx.speedKmh : null,
    motionState: _str(ctx.motionState, 'unknown'),
    /* Repoda fan/HVAC seviyesi okuyan sağlayıcı YOKTUR — sahte 0 veya "kapalı"
       ÜRETİLMEZ. Yeni sağlayıcı kurmak bu salt-okunur turun KAPSAMI DIŞINDADIR. */
    hvacFanLevel: null,
    sampledAt: readAt,
  } : null;

  /* ── JS ses servisi bayrakları — YALNIZ bayrak ve ADET ──────────────────── */
  const wake  = _safe(() => getWakeWordState());
  const wdog  = _safe(() => getWakeWatchdogStats());
  const voice = _safe(() => getVoiceSnapshot());
  const grammarWords = _safe(() => buildCommandGrammar());

  const js: SttJsRaw | null = (wake || voice) ? {
    wakeEnabled:     wake ? wake.enabled === true : false,
    wakeStatus:      wake ? _str(wake.status, 'disabled') : 'UNKNOWN',
    // GİZLİLİK: wake sözcüklerinin KENDİSİ değil, yalnız adedi.
    wakePhraseCount: wake ? _count(wake.wakeWords) : 0,
    voiceStatus:     voice ? _str(voice.status, 'UNKNOWN') : 'UNKNOWN',
    micAvailable:    voice ? voice.micAvailable === true : false,
    commandGrammarWordCount: Array.isArray(grammarWords) ? grammarWords.length : -1,
    wakeRearmCount:          wdog ? wdog.rearmCount : 0,
    wakeWakesInPrevWindow:   wdog ? wdog.wakesInPrevWindow : 0,
    wakeRearmIntervalMs:     wdog ? wdog.rearmIntervalMs : 0,
  } : null;

  /* MAVI-STT-CONTEXT-GRAMMAR: bağlam grameri gözlemi — SÖZCÜK TAŞIMAZ.
     Bu getter gramer ÇÖZMEZ, yalnız en son çözümün sayaçlarını okur. */
  const gd = _safe(() => getGrammarDiagnostics());
  const grammar: SttGrammarRaw | null = gd ? {
    grammarClass:      _str(gd.grammarClass, 'general_command'),
    grammarEntryCount: _num(gd.grammarEntryCount, 0),
    lastReason:        _str(gd.lastReason, 'INITIAL'),
    transitionCount:          _num(gd.transitionCount, 0),
    fallbackGeneralCount:     _num(gd.fallbackGeneralCount, 0),
    grammarApplyFailureCount: _num(gd.grammarApplyFailureCount, 0),
    // Üç durumlu KORUNUR: null "bekleyen yok" DEĞİLDİR.
    pendingConfirmation: typeof gd.pendingConfirmation === 'boolean' ? gd.pendingConfirmation : null,
    countersSaturated:   gd.countersSaturated === true,
    // Bağlam sağlayıcıları boot'ta bağlandı mı — bağlanmamışlık GİZLENMEZ.
    providersWired:      _safe(() => grammarProvidersWired()) === true,
  } : null;

  return {
    readAt,
    present,
    schemaVersion:    present && native && _num(native.schemaVersion) >= 0 ? _num(native.schemaVersion) : null,
    capturedAt:       present && native ? _wallTs(native.capturedAt) : null,
    path:             present && native ? _str(native.path, 'NONE') : 'NONE',
    sessionActive:    present && native ? native.sessionActive === true : false,
    sessionStartedAt: present && native ? _wallTs(native.sessionStartedAt) : null,
    source,
    effects,
    vad,
    stt,
    vehicle,
    js,
    grammar,
  };
}
