/**
 * wakeForensics — wake karar defterinin RUNTIME tutamağı.
 *
 * Saf modeli (`core/wakeDecisionModel`) modül durumuna bağlar. Bu dosya
 * HİÇBİR ŞEY ÖLÇMEZ, HİÇBİR KARAR VERMEZ ve HİÇBİR ŞEYE YAZMAZ — yalnız
 * `wakeWordService`'in ZATEN aldığı kararları kaydeder.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · Yeni timer YOK · yeni abonelik YOK · ağ YOK.
 *  · Transcript, ham ses, n-best, konum, kullanıcı kimliği, wake sözcüğünün
 *    kendisi BU DOSYADAN GEÇMEZ (kilit testi denetler).
 *  · Kayıt sıcak yolda DEĞİL, wake KARARINDA olur (saniyede birkaç çağrı).
 *  · Tüm genel fonksiyonlar fail-soft: kayıt hatası wake akışını ASLA bozmaz.
 *
 * ── NEDEN AYRI BİR DOSYA ──────────────────────────────────────────────────
 * `wakeWordService` ağır bir modüldür (TTS · nativePlugin · store). Tüketiciler
 * (LAB kaynakları, tanı bölümleri) defteri okumak için onu import etmek
 * ZORUNDA kalmasın diye okuma buradan yapılır. Bu dosyanın çalışma zamanı
 * bağımlılığı YALNIZ saf modeldir (o da hiçbir şey import etmez).
 */

import {
  emptyWakeForensics, recordWakeDecision, noteIntentReached, projectWakeForensics,
  WAKE_INTENT_TIMEOUT_MS,
  type WakeForensicsState, type WakeDecisionInput, type WakeForensicsProjection,
} from './core/wakeDecisionModel';

export type {
  WakeDecisionReason, WakePath, WakeDecisionRecord, WakeForensicsProjection,
} from './core/wakeDecisionModel';

let _state: WakeForensicsState = emptyWakeForensics();

/** Duvar saati — kayıtlar UI'da yaş olarak gösterilir. */
function _now(): number {
  return Date.now();
}

/**
 * Wake kararını kaydet. `atMs` verilmezse şimdi alınır.
 *
 * ⚠️ ÇAĞIRAN SÖZLEŞMESİ: bu fonksiyona **transcript GEÇİLMEZ**. Girdi yalnız
 * gerekçe + yol + türetilmiş sayılardır.
 */
export function recordWake(input: Omit<WakeDecisionInput, 'atMs'> & { atMs?: number }): void {
  try {
    _state = recordWakeDecision(_state, { ...input, atMs: input.atMs ?? _now() });
  } catch { /* defter hatası wake akışını ASLA bozmaz */ }
}

/**
 * Kabul edilen tetik komuta dönüştü — bekleyişi kapat.
 * `voiceService` yaşam döngüsünden (`execution_result`) beslenir.
 */
export function markWakeIntentReached(sessionId?: number | null): void {
  try {
    _state = noteIntentReached(_state, sessionId);
  } catch { /* fail-soft */ }
}

/** Senkron okuma — ASLA throw etmez. Bekleyen kabulün yaşı OKUMA ANINDA türetilir. */
export function getWakeForensics(limit = 10): WakeForensicsProjection {
  try {
    return projectWakeForensics(_state, _now(), limit, WAKE_INTENT_TIMEOUT_MS);
  } catch {
    return projectWakeForensics(emptyWakeForensics(), 0, limit, WAKE_INTENT_TIMEOUT_MS);
  }
}

/** @internal testler için — defteri sıfırlar. */
export function _resetWakeForensicsForTest(): void {
  _state = emptyWakeForensics();
}
