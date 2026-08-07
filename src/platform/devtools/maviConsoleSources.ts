/**
 * maviConsoleSources.ts — Mavi Konsolu'nun TEK okuma noktası (Faz A7).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON getter. `await` YOK.
 *  · Mikrofona, ağa, AI sağlayıcısına veya araca YENİ İSTEK ATILMAZ.
 *  · startListening / stopListening / retry / provider çağrısı / komut dispatch YOK.
 *  · Abonelik, timer, listener AÇILMAZ.
 *  · Her kaynak AYRI try/catch — biri patlarsa diğerleri okunur, alan KAYNAK YOK olur.
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 *  `getVoiceSnapshot()` CANLI `VoiceState` nesnesinin KENDİSİNİ döndürür (kopya
 *  değil) ve içinde `transcript`, `lastCommand`, `history`, `suggestions` ve hata
 *  MESAJI vardır. Bu katman o referansı SAKLAMAZ ve DIŞARI VERMEZ: anında bayrak
 *  ve adede indirger. Dışarı çıkan tipte (`MaviRawSnapshot`) metin taşıyan hiçbir
 *  kullanıcı-içeriği alanı YOKTUR — sızıntı tip olarak imkânsızdır.
 *
 * ── DÜRÜSTÇE BEYAN EDİLEN İKİ SINIR (gizlenmez) ─────────────────────────────
 *  1) `getAiHealthSnapshot()` TAM SAF DEĞİLDİR: içeride `_settle(performance.now())`
 *     çağırır ve SÜRESİ ZATEN DOLMUŞ bir devre kesici penceresini kapatıp sayaçları
 *     sıfırlar (yarı-açık geçiş). Bu geçiş zaten VADESİ GELMİŞTİR ve repodaki her
 *     okuma yolu (`isAiNetHealthy`) aynı şeyi yapar; konsol yeni bir devre AÇAMAZ,
 *     ağ çağrısı yapamaz ve başka türlü olmayacak bir sonucu üretemez. Yine de
 *     "yan etkisiz" DİYE SUNULMAZ.
 *  2) `voiceService` modülü İLK KEZ burada yükleniyorsa, modül seviyesinde bir
 *     TTS-bitiş dinleyicisi kaydeder (`registerTtsEndListener`). Bu dinleyici
 *     PASİFTİR (yalnız TTS bittiğinde tetiklenir), mikrofon/ağ başlatmaz ve ES
 *     modül init'i idempotent olduğu için tekrar tetiklenmez. Bu katmanın KENDİSİ
 *     hiçbir abonelik açmaz.
 */

import { getVoiceSnapshot } from '../voiceService';
import { getRecentVoiceDiag } from '../voiceDiagService';
import { getAiHealthSnapshot } from '../aiHealth';
import { getProviderQuotaSnapshot, getProactiveAlertDiagnostics } from '../companion/companionChatProvider';
import { getProactiveSuppressionHistory } from '../ai/aiOfflineReason';
/* GERÇEK olay izi kaynağı — ayrı/paralel kayıt deposu KURULMAZ.
   ⚠️ `diagnosticTrail` (ağır taraf) DEĞİL, `diagnosticTrailCore` (YAZMA çekirdeği)
   okunur: Mavi karar satırları `pushTrail` ile TAM BURAYA yazılır, dolayısıyla
   aynı gerçek kaynaktır. Ağır taraf `UnifiedVehicleStore`+`obdService`+`crashLogger`
   +`uiActivityRecorder` zincirini modül grafiğine sokar; o zincirin bu salt-okunur
   konsol için hiçbir katkısı yok (kaynak dosyanın kendi uyarısı da bunu söyler). */
import { getOwnTrail } from '../diagnosticTrailCore';
/* MAVI-M6-LAB-SPEECH-COUNTERS: M6 konuşma defteri + M5 tur kapısı sayaçları.
   Her iki getter de SAF ve PII'sizdir (metin taşımaz) — yalnız bayrak/adet/kimlik. */
import { getMaviSpeechDiagnostics } from '../assistant/maviSpeech';
import { getMaviTurnDiagnostics } from '../assistant/maviTurn';
import type { MaviRawSnapshot, MaviDiagRaw } from './maviConsoleModel';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

function _count(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function _num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Duvar-saati damgası; 0/negatif/NaN → null ("şimdi" UYDURULMAZ). */
function _wallTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Tanımlayıcı sınıfı dize (stage/route/intent/errorCode). Boş → null. */
function _ident(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Tüm kaynakların TEK seferlik senkron okuması.
 *
 * `diag`: `null` = halka OKUNAMADI · `[]` = halka GERÇEKTEN BOŞ. Sıra burada
 * EN YENİDEN ESKİYE çevrilir — repo halkası en eski→en yeni döner.
 */
export function readMaviConsoleSnapshot(): MaviRawSnapshot {
  const readAt = Date.now();

  const voice = _safe(() => getVoiceSnapshot());
  const diag  = _safe(() => getRecentVoiceDiag());
  const ai    = _safe(() => getAiHealthSnapshot());
  const quota = _safe(() => getProviderQuotaSnapshot());
  const pa    = _safe(() => getProactiveAlertDiagnostics());
  // Susturma halkası AYRI kaynaktır (offline halkasını kirletmez) — yalnız EN SON
  // kaydın makine-okur gerekçesi alınır; uyarı metni/verdict içeriği taşınmaz.
  const paHist = _safe(() => getProactiveSuppressionHistory());
  // Karar satırları GERÇEK olay izinden sayılır (kopya depo yok). null = okunamadı.
  const trail = _safe(() => getOwnTrail());
  const speech = _safe(() => getMaviSpeechDiagnostics());
  const turn   = _safe(() => getMaviTurnDiagnostics());

  let diagRows: MaviDiagRaw[] | null = null;
  if (Array.isArray(diag)) {
    diagRows = [];
    // En yeniden eskiye: repo halkası en eski→en yeni sıralıdır.
    for (let i = diag.length - 1; i >= 0; i--) {
      const e = diag[i];
      if (!e) continue;
      diagRows.push({
        at:               _wallTs(e.at),
        stage:            typeof e.stage === 'string' ? e.stage : '',
        // Transcript UZUNLUĞU (sayı) — metin DEĞİL. Geçersizse null.
        transcriptLength: typeof e.transcriptLength === 'number' && Number.isFinite(e.transcriptLength)
          ? e.transcriptLength
          : null,
        errorCode:        _ident(e.errorCode),
        route:            _ident(e.route),
        intent:           _ident(e.intent),
      });
    }
  }

  return {
    readAt,

    /* GİZLİLİK: transcript / lastCommand / history / suggestions METNİ TAŞINMAZ. */
    voice: voice ? {
      status:          typeof voice.status === 'string' ? voice.status : '',
      micAvailable:    voice.micAvailable === true,
      volumeLevel:     _num(voice.volumeLevel),
      followUp:        voice.followUp === true,
      suggestionCount: _count(voice.suggestions),
      historyCount:    _count(voice.history),
      hasLastCommand:  voice.lastCommand !== null && voice.lastCommand !== undefined,
      hasTranscript:   typeof voice.transcript === 'string' && voice.transcript.length > 0,
      hasError:        typeof voice.error === 'string' && voice.error.length > 0,
    } : null,

    diag: diagRows,

    aiHealth: ai ? {
      healthy:        ai.healthy === true,
      consecFails:    _num(ai.consecFails),
      consecTimeouts: _num(ai.consecTimeouts),
      blockedForMs:   _num(ai.blockedForMs),
    } : null,

    /* Sağlayıcılar AYRI TUTULUR — tek toplama indirgenmez (çapraz kirlenme dersi). */
    quota: quota ? {
      geminiCooldownMs: _num(quota.geminiCooldownMs),
      groqCooldownMs:   _num(quota.groqCooldownMs),
      haikuCooldownMs:  _num(quota.haikuCooldownMs),
    } : null,

    /* GİZLİLİK: uyarı METNİ, arıza açıklaması ve verdict içeriği TAŞINMAZ —
       yalnız adet, makine-okur kök-neden ANAHTARI ve süre. */
    proactive: pa ? {
      spokenCount:         _num(pa.spokenCount),
      suppressedCount:     _num(pa.suppressedCount),
      lastAlertKey:        _ident(pa.lastAlertKey),
      debounceRemainingMs: _num(pa.debounceRemainingMs),
      lastSuppressReason:  Array.isArray(paHist) && paHist.length > 0
        ? _ident(paHist[paHist.length - 1]?.detail)
        : null,
      lastReasonCode:      _ident(pa.lastReasonCode),
      // Sahte 0 YASAK: değer yoksa null taşınır (_num kullanılmaz).
      lastConfidence:      typeof pa.lastConfidence === 'number' && Number.isFinite(pa.lastConfidence)
        ? pa.lastConfidence : null,
      lastConfidenceScale: _ident(pa.lastConfidenceScale),
      lastReasonSummary:   _ident(pa.lastReasonSummary),
      lastDecisionSource:  _ident(pa.lastDecisionSource),
      trailRowCount:       Array.isArray(trail)
        ? trail.filter((e) => e && typeof e.label === 'string' && e.label.startsWith('mavi proaktif:')).length
        : null,
    } : null,

    /* GİZLİLİK: seslendirilen metin · transcript · kullanıcı içeriği TAŞINMAZ —
       bu iki sözleşmede zaten yalnız bayrak, adet ve tur kimliği vardır. */
    speech: speech ? {
      turnId:                    _num(speech.turnId),
      answeredThisTurn:          speech.answeredThisTurn === true,
      progressedThisTurn:        speech.progressedThisTurn === true,
      spoken:                    _num(speech.spoken),
      suppressedDuplicate:       _num(speech.suppressedDuplicate),
      staleLateSpeechSuppressed: _num(speech.staleLateSpeechSuppressed),
    } : null,

    turn: turn ? {
      activeTurnId:                _num(turn.activeTurnId),
      activeState:                 typeof turn.activeState === 'string' ? turn.activeState : '',
      turnsStarted:                _num(turn.turnsStarted),
      turnsCompleted:              _num(turn.turnsCompleted),
      turnsSuperseded:             _num(turn.turnsSuperseded),
      staleProviderResultsDropped: _num(turn.staleProviderResultsDropped),
      staleActionsPrevented:       _num(turn.staleActionsPrevented),
      staleFeedbackSuppressed:     _num(turn.staleFeedbackSuppressed),
      countersSaturated:           turn.countersSaturated === true,
    } : null,
  };
}
