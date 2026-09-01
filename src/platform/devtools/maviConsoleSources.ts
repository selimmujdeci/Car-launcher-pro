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
/* MAVI-F8: sürüş iş yükü tanısı. SAF sayaç okuması — YENİ EKRAN AÇILMADI,
   mevcut Mavi Konsolu genişletildi (LAB ekran enflasyonu yasağı). */
import { getMaviWorkloadDiagnostics } from '../assistant/maviWorkload';
/* MAVI-F9: proaktif politika defteri. SAF sayaç okuması (PII YOK) — YENİ EKRAN
   AÇILMADI, mevcut Mavi Konsolu H bölümüyle genişletildi. */
import { getProactivePolicyDiagnostics } from '../assistant/proactivePolicyEngine';
/* MAVI-F11: kullanıcıya görünen yüzey durumu. SAF sayaç okuması (PII YOK) —
   YENİ EKRAN AÇILMADI, mevcut Mavi Konsolu I bölümüyle genişletildi. Ayar
   okuması `useStore.getState()` ile SENKRONdur (abonelik AÇILMAZ). */
import { getMaviSurfaceDiagnostics } from '../assistant/maviSurfaceState';
/* MAVI-F12: barge-in / konuşma kontrolü defteri. SAF sayaç okuması (PII YOK) —
   YENİ EKRAN AÇILMADI, mevcut Mavi Konsolu J bölümüyle genişletildi. */
import { getMaviBargeInDiagnostics } from '../assistant/maviBargeIn';
/* MAVI-F13: kanonik runtime konsolidasyon tanısı. SAF SAYIM — yeni defter/telemetri
   AÇILMAZ, `maviEvidence`in ZATEN tuttuğu bounded kayıtlar sayılır. */
import { getMaviRuntimeConsolidationDiagnostics } from '../maviCore/wiring/maviEvidence';
/* MAVI-F13 · bayrak envanteri. Yalnız BOOLEAN okunur; anahtar/değer TAŞINMAZ. */
import {
  isAiGatewayEnabled, isMaviOrchestratorEnabled, isMaviContextEnabled,
  isMaviMemoryEnabled, isMaviToolsEnabled, isMaviPlannerEnabled,
  isMaviMechanicEnabled, isMaviMechanicHistoryEnabled, isMaviMechanicKnowledgeEnabled,
  isMaviOperatorEnabled, isMaviOperatorChatEnabled,
} from '../ai/gateway/aiGatewayFlag';
import { isCapabilityFabricEnforcing } from '../capability/fabric/capabilityFabric';
import { useStore } from '../../store/useStore';
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

/**
 * MAVI-F12 · "ölçüm yok" (`-1`) DEĞERİNİ KORUYAN sayı okuması.
 * `_num` burada KULLANILAMAZ: `-1`i olduğu gibi geçirir ama okunamayan değeri
 * `0`a çevirirdi ve `0 ms` **gerçek bir ölçüm gibi** görünürdü (sahte sıfır).
 */
function _signedMs(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : -1;
}

/** Duvar-saati damgası; 0/negatif/NaN → null ("şimdi" UYDURULMAZ). */
function _wallTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Tanımlayıcı sınıfı dize (stage/route/intent/errorCode). Boş → null. */
/** Bounded sayaç sözlüğü — anahtar ve ADET; başka hiçbir şey. */
function _counts(v: unknown): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k === 'string' && k.length > 0 && typeof n === 'number' && Number.isFinite(n)) {
        out[k] = n;
      }
    }
  }
  return Object.freeze(out);
}

function _ident(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Bounded tanımlayıcı listesi. Yalnız `[a-z0-9._-]` ve ≤ 48 karakter geçer —
 * kaynak kimlikleri kodda SABİTTİR, ama bu süzgeç serbest metnin bu katmana
 * yapısal olarak GİREMEMESİNİ garanti eder (gizlilik savunması).
 */
function _idents(v: unknown): readonly string[] {
  if (!Array.isArray(v)) return Object.freeze([]);
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const clean = item.slice(0, 48);
    if (/^[a-z0-9._-]+$/i.test(clean)) out.push(clean);
    if (out.length >= 16) break;
  }
  return Object.freeze(out);
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
  const workload = _safe(() => getMaviWorkloadDiagnostics());
  /* Saatlik pencere MONOTONİK saatle hesaplanır — `Date.now` verilirse pencere
     yanlış boşalır. `performance` yoksa 0 geçilir (sayaçlar yine dürüst). */
  let surface: MaviRawSnapshot['surface'] = null;
  try {
    const d = getMaviSurfaceDiagnostics();
    const st = useStore.getState().settings;
    surface = {
      transitions: _num(d.transitions),
      lastState: _ident(d.lastState),
      lastReason: _ident(d.lastReason),
      lastMode: _ident(d.lastMode),
      lastDegraded: typeof d.lastDegraded === 'string' ? d.lastDegraded : 'NONE',
      states: _counts(d.states),
      fullScreenBlocked: _num(d.fullScreenBlocked),
      /* İki ayar BAĞIMSIZ okunur — F11 sonrası aralarında hiçbir bağ YOKTUR. */
      wakeWordEnabled: st.companionWakeWordEnabled === true,
      companionPresence: st.companionEnabled === true,
    };
  } catch { surface = null; }

  const policy = _safe(() => getProactivePolicyDiagnostics(
    typeof performance !== 'undefined' ? performance.now() : 0));

  /* MAVI-F12: SAF sayaç okuması — hakem çağrılmaz, hüküm ÜRETİLMEZ, mikrofon
     ve TTS'e DOKUNULMAZ. Yalnız defter okunur. */
  const barge = _safe(() => getMaviBargeInDiagnostics());
  const rt    = _safe(() => getMaviRuntimeConsolidationDiagnostics());
  /* Bayraklar TEK try/catch altında okunur: biri patlarsa "hepsi kapalı"
     UYDURULMAZ — liste `null` kalır ve LAB "okunamadı" yazar. */
  const flags = _safe<readonly string[]>(() => {
    const on: string[] = [];
    if (isAiGatewayEnabled())              on.push('mavi_ai_gateway');
    if (isMaviOrchestratorEnabled())       on.push('mavi_ai_orchestrator');
    if (isMaviContextEnabled())            on.push('mavi_ai_context');
    if (isMaviMemoryEnabled())             on.push('mavi_ai_memory');
    if (isMaviToolsEnabled())              on.push('mavi_ai_tools');
    if (isMaviPlannerEnabled())            on.push('mavi_ai_planner');
    if (isMaviMechanicEnabled())           on.push('mavi_ai_mechanic');
    if (isMaviMechanicHistoryEnabled())    on.push('mavi_ai_mechanic_history');
    if (isMaviMechanicKnowledgeEnabled())  on.push('mavi_ai_mechanic_knowledge');
    if (isMaviOperatorEnabled())           on.push('mavi_ai_operator');
    if (isMaviOperatorChatEnabled())       on.push('mavi_ai_operator_chat');
    if (isCapabilityFabricEnforcing())     on.push('mavi_capability_fabric_enforce');
    return on;
  });

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

    /* MAVI-F8 · GİZLİLİK: hız · mesafe · konum · manevra adı TAŞINMAZ —
       yalnız bounded seviye/kanıt KODU ve ADET geçer. */
    workload: workload ? {
      lastLevel:           _ident(workload.lastLevel),
      resolutions:         _num(workload.resolutions),
      sourceBound:         workload.sourceBound === true,
      levels:              _counts(workload.levels),
      evidence:            _counts(workload.evidence),
      proactiveSuppressed: _num(workload.proactiveSuppressed),
      responsesShortened:  _num(workload.responsesShortened),
      streamsShortened:    _num(workload.streamsShortened),
      followUpSuppressed:  _num(workload.followUpSuppressed),
      deferrals:           _num(workload.deferrals),
      deferralsExpired:    _num(workload.deferralsExpired),
    } : null,

    /* MAVI-F9 · GİZLİLİK: seslendirilen METİN, transcript, prompt, konum ve
       kullanıcı içeriği TAŞINMAZ. Kaynak kimlikleri SABİTTİR (kodda tanımlı,
       çeviriye ve kullanıcı girdisine TABİ DEĞİL) ve sanitize edilerek geçer. */
    proactivePolicy: policy ? {
      decisions:            _num(policy.decisions),
      admitted:             _num(policy.admitted),
      externalObserved:     _num(policy.externalObserved),
      interruptions:        _num(policy.interruptions),
      lastAdmittedSourceId: _ident(policy.lastAdmittedSourceId),
      lastDropReason:       _ident(policy.lastDropReason),
      drops:                _counts(policy.drops),
      admittedBySource:     _counts(policy.admittedBySource),
      kinds:                _counts(policy.kinds),
      hourlyVoiceUsed:      _num(policy.hourlyVoiceUsed),
      hourlyVoiceCeiling:   _num(policy.hourlyVoiceCeiling),
      userSuppressed:       _idents(policy.userSuppressed),
      learnedSuppressed:    _idents(policy.learnedSuppressed),
      /* Sahte "ölçülüyor" YASAK: kaynak ne diyorsa o taşınır. Tip bugün
         literal `false`tur (motor yapısal olarak beyan eder) — `=== true`
         karşılaştırması derleyici tarafından ölü kod sayılırdı. */
      acceptRateMeasurable: policy.acceptRateMeasurable,
    } : null,

    /* MAVI-F11 · GİZLİLİK: etiket metni, cevap içeriği, transkript ve kullanıcı
       verisi TAŞINMAZ — yalnız bounded durum/sebep kodları, adet ve iki bayrak. */
    surface,

    /* MAVI-F12 · GİZLİLİK: transkript, ham ses, cevap metni ve wake sözcüğü
       TAŞINMAZ — yalnız bounded sınıf/gerekçe KODLARI, adet ve milisaniye.
       `-1` (ölçüm yok) DEĞERİ KORUNUR: `_num` sıfıra çevirirdi ve "ölçüm yok"
       sahte bir `0 ms` gibi görünürdü. */
    bargeIn: barge ? {
      duplexClass:          typeof barge.duplexClass === 'string' ? barge.duplexClass : '',
      captureOpenDuringTts: barge.captureOpenDuringTts === true,
      aecCountsForDuplex:   barge.aecCountsForDuplex === true,
      echoReferenceWired:   barge.echoReferenceWired === true,
      proposals:            _num(barge.proposals),
      accepted:             _num(barge.accepted),
      lastReason:           _ident(barge.lastReason),
      reasons:              _counts(barge.reasons),
      evidenceKinds:        _counts(barge.evidenceKinds),
      lastTtsStopRequestMs: _signedMs(barge.lastTtsStopRequestMs),
      maxTtsStopRequestMs:  _signedMs(barge.maxTtsStopRequestMs),
      ttsStopSamples:       _num(barge.ttsStopSamples),
      lastListenOpenMs:     _signedMs(barge.lastListenOpenMs),
      maxListenOpenMs:      _signedMs(barge.maxListenOpenMs),
      listenSamples:        _num(barge.listenSamples),
      countersSaturated:    barge.countersSaturated === true,
    } : null,

    /* MAVI-F13 · GİZLİLİK: komut metni, parametre, correlationId ve eylem
       argümanı TAŞINMAZ — yalnız ADET, bayrak ADI ve bounded uyarı. */
    runtime: rt ? {
      shadowDecisions:       _num(rt.shadowDecisions),
      maviExecutedDecisions: _num(rt.maviExecutedDecisions),
      noExecutionDecisions:  _num(rt.noExecutionDecisions),
      takeoverFlagDecisions: _num(rt.takeoverFlagDecisions),
      legacyExecutionKeys:   _num(rt.legacyExecutionKeys),
      legacyExecutionTotal:  _num(rt.legacyExecutionTotal),
      doubleExecutionKeys:   _num(rt.doubleExecutionKeys),
      bridgeStarts:          _num(rt.bridgeStarts),
      bridgeDisposes:        _num(rt.bridgeDisposes),
      bounded:               rt.bounded === true,
      openFlags:             Array.isArray(flags) ? flags : [],
      flagsReadable:         Array.isArray(flags),
    } : null,
  };
}
