/**
 * phoneLinkAssistantBridgeAdapter.ts — PHONE LINK F9 · Mavi Assistant Bridge.
 *
 * ── İKİNCİ MAVİ MOTORU DEĞİL ─────────────────────────────────────────────────
 * Bu dosya yeni bir konuşma/komut otoritesi YAZMAZ. Mavi'nin GERÇEK "birleşik
 * beyin" karar vericisini (`tryCompanionBrain`) ve GERÇEK çevrimdışı sohbet
 * motorunu (`tryOfflineConversation`) DOĞRUDAN çağırır — voiceService.ts'in
 * kendisinin kullandığı AYNI fonksiyonlar, AYNI sağlayıcı zinciri, AYNI
 * `AiSafetyGate`/Safety Kernel PRE/POST kapıları, AYNI F7 `ConnectivityAuthority`
 * (`_resolveAiKeys` → `allowsConnectivity('CLOUD_INTERACTIVE')`).
 *
 * ── BİLİNÇLİ OLARAK `processTextCommand`/`maviTurn` KULLANILMADI ───────────
 * Denetim (F9 audit) ölçtü: `processTextCommand`'ın tam hattı (yerel parser →
 * hızlı yol → `tryCompanionBrain`) `kind:'action'` sonuçları GERÇEKTEN
 * yürütücüye (`maviActionAuthority`/`commandExecutor`) TAŞIR — `SEARCH_POI`,
 * `FIND_NEARBY_GAS`, `NAVIGATE_ADDRESS` gibi onay GEREKTİRMEYEN intent'ler
 * navigasyonu ANINDA değiştirir (F8.1'in tam da kapattığı riskle AYNI sınıf:
 * TEK sinyalle (burada: TRUSTED grant) navigasyon/araç durumu değişimi).
 * `maviTurn`/follow-up state machine'i de araç-içi TEK aktif tur varsayımı
 * üzerine kuruludur (§11/§12 riskleri: deadlock, orphan turn, "son gelen
 * kazanır").
 *
 * Bu adaptör bu riskleri YAMAYLA kapatmak yerine YAPISAL OLARAK ORTADAN
 * KALDIRIR: yalnız `tryCompanionBrain`in `kind:'chat'` dalını KABUL eder;
 * `kind:'action'` dalı YÜRÜTÜLMEDEN reddedilir (§6 — "Serbest metni doğrudan
 * command executor'a bağlama"). `maviTurn`a HİÇ dokunulmadığı için araç içi
 * konuşma/follow-up ile YAPISAL OLARAK çakışma OLAMAZ (§11/§12 — BUSY kapısı
 * bile GEREKMEZ, paylaşılan bir tur kaynağı yok).
 *
 * ── SES/TTS YOK (§16) ────────────────────────────────────────────────────────
 * `tryCompanionBrain`/`tryOfflineConversation` TTS ÇAĞIRMAZ, audio focus
 * İSTEMEZ, mikrofon AÇMAZ — saf metin→metin. Bu adaptör de aynısını korur.
 */

import {
  authorizeAssistantBridge, canExecuteAssistantBridge,
  isAssistantBridgeDispatchStillLive, type PhoneLinkSessionRef,
} from './phoneLinkCapabilityGrant';

export type PhoneLinkAssistantDenialCode =
  | 'NOT_ATTACHED' | 'NO_GRANT' | 'STALE'
  /** Mavi'nin ürettiği sonuç bir EYLEMDİ — bridge onu ÇALIŞTIRMADI (§6). */
  | 'ACTION_NOT_PERMITTED'
  /** Ne online ne offline zincir bir cevap üretti (dürüst "bilmiyorum" bile). */
  | 'NO_ANSWER'
  /** Sağlayıcı bütçesi (F9 kendi bütçesi, Mavi'nin kendi timeout'undan AYRI değil — aynı yol) aşıldı. */
  | 'TIMED_OUT'
  | 'INTERNAL_ERROR';

/** Kabul (senkron) kapısı sonucu — yalnız "istek işlenmeye BAŞLAYABİLİR mi" sorusu. */
export type PhoneLinkAssistantAcceptResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly denialCode: PhoneLinkAssistantDenialCode };

/** Terminal (asenkron) sonuç — telefona GİDECEK gerçek cevap. */
export type PhoneLinkAssistantTerminalResult =
  | { readonly ok: true; readonly response: string }
  | { readonly ok: false; readonly denialCode: PhoneLinkAssistantDenialCode };

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded, event-driven telemetri (§19) — prompt/cevap/fingerprint TAŞIMAZ
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneLinkAssistantBridgeTelemetry {
  readonly receivedCount: number;
  readonly authorizedCount: number;
  readonly rejectedCount: number;
  readonly activeRequestCount: number;
  readonly successCount: number;
  readonly failedCount: number;
  readonly actionRejectedCount: number;
  readonly timedOutCount: number;
  readonly cancelledCount: number;
  readonly duplicateCount: number;
  readonly resultDroppedStaleSessionCount: number;
  readonly lastDenialCode: PhoneLinkAssistantDenialCode | null;
  readonly lastAtMs: number | null;
}

const _telemetry = {
  receivedCount: 0,
  authorizedCount: 0,
  rejectedCount: 0,
  successCount: 0,
  failedCount: 0,
  actionRejectedCount: 0,
  timedOutCount: 0,
  cancelledCount: 0,
  duplicateCount: 0,
  resultDroppedStaleSessionCount: 0,
  lastDenialCode: null as PhoneLinkAssistantDenialCode | null,
  lastAtMs: null as number | null,
};

/** Şu an yanıt bekleyen (RECEIVED → terminal arası) istek sayısı — bounded, sızıntı yok. */
let _activeRequestCount = 0;

export function getPhoneLinkAssistantBridgeTelemetry(): PhoneLinkAssistantBridgeTelemetry {
  return Object.freeze({ ..._telemetry, activeRequestCount: _activeRequestCount });
}

/** @internal — yalnız testler. */
export function _resetPhoneLinkAssistantBridgeTelemetryForTest(): void {
  _telemetry.receivedCount = 0;
  _telemetry.authorizedCount = 0;
  _telemetry.rejectedCount = 0;
  _telemetry.successCount = 0;
  _telemetry.failedCount = 0;
  _telemetry.actionRejectedCount = 0;
  _telemetry.timedOutCount = 0;
  _telemetry.cancelledCount = 0;
  _telemetry.duplicateCount = 0;
  _telemetry.resultDroppedStaleSessionCount = 0;
  _telemetry.lastDenialCode = null;
  _telemetry.lastAtMs = null;
  _activeRequestCount = 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * AŞAMA 1 — Kabul kapısı: hızlı, senkron-benzer (§10: RECEIVED için)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * İsteği kabul eder mi — yetkilendirme/canlılık kontrolü. `ok:true` ⇒ çağıran
 * hemen `RECEIVED` ACK'i dönebilir ve arka planda `processAssistantBridgeRequest`
 * çağırabilir. Bu fonksiyon Mavi'ye HİÇ dokunmaz (yalnız Phone Link kapısı).
 */
export function authorizeAssistantBridgeRequest(
  requestId: string, session: PhoneLinkSessionRef | null = null,
): PhoneLinkAssistantAcceptResult {
  _telemetry.receivedCount += 1;
  _telemetry.lastAtMs = Date.now();
  const operationId = `phone-link-assistant:${requestId}`;

  const evidence = authorizeAssistantBridge(operationId, Date.now(), session);
  if (evidence.decision !== 'ALLOW') {
    const denialCode: PhoneLinkAssistantDenialCode =
      evidence.decision === 'CAPABILITY_NOT_GRANTED' ? 'NO_GRANT'
        : evidence.decision === 'STALE' ? 'STALE'
          : 'NOT_ATTACHED';
    return _reject(denialCode);
  }
  if (!canExecuteAssistantBridge(evidence, Date.now(), session)) return _reject('STALE');
  if (!isAssistantBridgeDispatchStillLive(Date.now(), session)) return _reject('STALE');

  _telemetry.authorizedCount += 1;
  _activeRequestCount += 1;
  return { ok: true };
}

/* ══════════════════════════════════════════════════════════════════════════
 * AŞAMA 2 — Gerçek işlem: Mavi'nin GERÇEK beyni (async, uzun sürebilir)
 * ════════════════════════════════════════════════════════════════════════ */

/** Bilgi/sohbet dışı her şeyi (donanım/ayar/hafıza/uygulama açma…) reddetmek için — bkz. dosya üstü not. */
async function _askMaviBrain(text: string): Promise<PhoneLinkAssistantTerminalResult> {
  const { _resolveAiKeys } = await import('../voiceService');
  const keys = await _resolveAiKeys();
  const aiUsable = keys.chain.length > 0 && keys.hasNet;

  if (aiUsable) {
    const { tryCompanionBrain } = await import('../companion/companionChatProvider');
    const brain = await tryCompanionBrain(text, {
      /* Telefon ekranı okunuyor, TTS/sürüş-modu kısaltması İSTENMEZ — tam bilgilendirici cevap. */
      isDriving: false,
      provider: keys.provider,
      apiKey: keys.apiKey,
      hasNet: keys.hasNet,
      tavilyKey: keys.tavilyKey,
      searchKey: keys.searchKey,
      chain: keys.chain,
    });
    if (brain?.kind === 'action') { _telemetry.actionRejectedCount += 1; return _rejectTerminal('ACTION_NOT_PERMITTED'); }
    if (brain?.kind === 'chat' && brain.response) return { ok: true, response: brain.response };
    // brain === null → online zincir bir şey üretmedi; offline'a düş (aşağıya devam).
  }

  const { tryOfflineConversation } = await import('../offlineConversationEngine');
  const offline = tryOfflineConversation(text, false, undefined);
  if (offline.handled && offline.response) return { ok: true, response: offline.response };

  return _rejectTerminal('NO_ANSWER');
}

/**
 * Gerçek Mavi işlemi. YALNIZ `authorizeAssistantBridgeRequest` `ok:true`
 * DÖNDÜKTEN SONRA çağrılmalıdır. Hiçbir adım throw ETMEZ.
 */
export async function processAssistantBridgeRequest(
  text: string,
): Promise<PhoneLinkAssistantTerminalResult> {
  try {
    const result = await _askMaviBrain(text);
    if (result.ok) _telemetry.successCount += 1;
    else if (result.denialCode !== 'ACTION_NOT_PERMITTED') _telemetry.failedCount += 1;
    return result;
  } catch {
    return _rejectTerminal('INTERNAL_ERROR');
  } finally {
    _activeRequestCount = Math.max(0, _activeRequestCount - 1);
  }
}

/**
 * Sonuç GÖNDERİLMEDEN hemen önce yeniden doğrulama (§13). `false` ⇒ sonuç
 * BAŞKA/eski bir oturuma SIZDIRILMAZ, sessizce düşürülür (çağıran gönderimi atlar).
 */
export function isAssistantBridgeResultDeliverable(
  fingerprint: string, sessionEpoch: number, now: number = Date.now(),
): boolean {
  const session: PhoneLinkSessionRef = { deviceFingerprint: fingerprint, sessionEpoch };
  const live = isAssistantBridgeDispatchStillLive(now, session);
  if (!live) _telemetry.resultDroppedStaleSessionCount += 1;
  return live;
}

/** İptal/disconnect gözlemi (§18/§23) — yalnız sayaç, karar ÜRETMEZ. */
export function recordAssistantBridgeCancelled(): void {
  _telemetry.cancelledCount += 1;
  _activeRequestCount = Math.max(0, _activeRequestCount - 1);
}

/** İngress dedupe zaten bu requestId'yi ikinci kez dispatch'e SOKMAZ — bu yalnız gözlem sayacıdır. */
export function recordAssistantBridgeDuplicate(): void {
  _telemetry.duplicateCount += 1;
}

function _reject(denialCode: PhoneLinkAssistantDenialCode): PhoneLinkAssistantAcceptResult {
  _telemetry.rejectedCount += 1;
  _telemetry.lastDenialCode = denialCode;
  return { ok: false, denialCode };
}

function _rejectTerminal(denialCode: PhoneLinkAssistantDenialCode): PhoneLinkAssistantTerminalResult {
  _telemetry.lastDenialCode = denialCode;
  return { ok: false, denialCode };
}
