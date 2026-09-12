/**
 * pendingActionConfirmation — AÇIK KULLANICI ONAYI bekleyen eylem (tek slot).
 * (MAVI-M4-ACTION-AUTHORITY)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Telefon araması ve DTC silme gibi GERİ ALINAMAZ eylemler, kullanıcı açıkça
 * "evet" demeden BAŞLAYAMAZ. Kişi/numara çözülmüş olması onay DEĞİLDİR.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · TEK slot: yeni bir onay isteği öncekini ezer (eski istek düşer, yan etki yok).
 *  · TTL: `PENDING_ACTION_TTL_MS` sonrası istek kendiliğinden geçersizdir.
 *  · TEK KULLANIM: `consumePendingAction()` çağrıldığında slot boşalır → "evet"
 *    iki kez yorumlanıp eylem İKİ KEZ başlatılamaz.
 *  · **M5 STALE KORUMASI:** istek, kendisini ÜRETEN turun kimliğini taşır. Onayı
 *    veren tur, istek turundan sonra gelen İLK tur olmalıdır; araya başka bir
 *    kullanıcı turu girdiyse onay GEÇERSİZDİR (eski niyet yeni komutla karışamaz).
 *  · SAF DEPO: konuşmaz, UI açmaz, servis çağırmaz, store/localStorage yazmaz.
 */

import type { IntentType } from '../intentEngine';
import type { AppIntent } from '../intentEngine';

/** Onay penceresi — `voiceService.PENDING_TTL_MS` ile aynı kullanıcı beklentisi. */
export const PENDING_ACTION_TTL_MS = 15_000;

export interface PendingActionRequest {
  readonly intent: AppIntent;
  readonly actionId: string;
  /** İsteği üreten kullanıcı turunun kimliği (M5). */
  readonly turnId: number;
  readonly atMs: number;
}

let _pending: PendingActionRequest | null = null;

/** Onay bekleyen eylemi kaydeder (tek slot — öncekini ezer). */
export function setPendingAction(req: PendingActionRequest): void {
  if (!req || !req.intent || typeof req.actionId !== 'string') return;
  _pending = Object.freeze({ ...req });
}

/** Bekleyen istek var mı (tanı/UI ipucu için — TÜKETMEZ). */
export function peekPendingAction(nowMs: number = Date.now()): PendingActionRequest | null {
  if (!_pending) return null;
  if (nowMs - _pending.atMs > PENDING_ACTION_TTL_MS) { _pending = null; return null; }
  return _pending;
}

/**
 * Bekleyen isteği TÜKETİR (tek kullanım). `answeringTurnId` onayı veren turun
 * kimliğidir; istek turundan sonra gelen İLK tur değilse istek DÜŞER ve `null`
 * döner — araya giren üçüncü bir komut eski niyeti canlandıramaz.
 */
export function consumePendingAction(
  answeringTurnId: number,
  nowMs: number = Date.now(),
): PendingActionRequest | null {
  const p = peekPendingAction(nowMs);
  _pending = null;                        // her koşulda slot boşalır (tek kullanım)
  if (!p) return null;
  if (!Number.isFinite(answeringTurnId) || answeringTurnId !== p.turnId + 1) return null;
  return p;
}

/** Kullanıcı reddetti / iptal → yan etki YOK, slot boşalır. */
export function clearPendingAction(): void {
  _pending = null;
}

/** Bu intent şu an onay bekliyor mu? */
export function isPendingActionFor(type: IntentType, nowMs: number = Date.now()): boolean {
  return peekPendingAction(nowMs)?.intent.type === type;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Onaylı yürütücü kaydı (DI — `setMaviVehicleSnapshotSource` deseniyle birebir)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Onaylanmış eylemi TEK OTORİTE üzerinden çalıştıran geri-çağrı. `useVoiceCommandHandler`
 * kaydeder (orada `CommandContext` ve `executeIntent` vardır); `voiceService` yalnız
 * "evet" duyduğunda ÇAĞIRIR. Bu sayede `voiceService` → `commandExecutor` bağımlılığı
 * KURULMAZ ve tek otorite sözleşmesi bozulmaz.
 */
export type ConfirmedActionExecutor = (intent: AppIntent) => void;

let _executor: ConfirmedActionExecutor | null = null;

export function setConfirmedActionExecutor(fn: ConfirmedActionExecutor | null): void {
  _executor = typeof fn === 'function' ? fn : null;
}

/** Kayıtlı yürütücü (yoksa null → onay çözülemez, eylem BAŞLAMAZ — fail-closed). */
export function getConfirmedActionExecutor(): ConfirmedActionExecutor | null {
  return _executor;
}

/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-M4-LAB · gözlem yüzeyi (salt-okunur, PII YOK, MUTASYONSUZ)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bekleyen onayın **VAR/YOK** durumu ve PII'siz üst verisi.
 *
 * ── NEDEN AYRI BİR FONKSİYON ────────────────────────────────────────────
 * `peekPendingAction` gözlem için KULLANILAMAZ, iki nedenle:
 *  1) **MUTASYON:** süresi dolmuş isteği SİLER. Salt-okunur bir ekranın
 *     üretim durumunu değiştirmesi kabul edilemez.
 *  2) **PII:** `PendingActionRequest.intent.payload` içinde `contactName`
 *     (kişi adı) ve `sourceText` (HAM KULLANICI KOMUTU) vardır. O nesne
 *     gözlem katmanına ÇIKAMAZ.
 *
 * Bu fonksiyon yalnız bayrak · sabit `actionId` · yaş/kalan süre döndürür;
 * dönüş tipinde metin taşıyan hiçbir kullanıcı-içeriği alanı YOKTUR →
 * sızıntı TİP OLARAK imkânsızdır.
 */
export function getPendingActionDiagnostics(nowMs: number = Date.now()): {
  readonly pending: boolean;
  readonly actionId: string | null;
  readonly ageMs: number | null;
  readonly expiresInMs: number | null;
} {
  const p = _pending;   // `peekPendingAction` DEĞİL — silme YOK
  if (!p) return Object.freeze({ pending: false, actionId: null, ageMs: null, expiresInMs: null });
  const age = nowMs - p.atMs;
  if (age > PENDING_ACTION_TTL_MS) {
    // Süresi dolmuş = artık bekleyen YOK. Slot BURADA temizlenmez (mutasyonsuz);
    // gerçek temizlik ilk `peek`/`consume` çağrısında üretim yolunda olur.
    return Object.freeze({ pending: false, actionId: null, ageMs: null, expiresInMs: null });
  }
  return Object.freeze({
    pending: true,
    actionId: p.actionId,
    ageMs: age >= 0 ? age : null,
    expiresInMs: PENDING_ACTION_TTL_MS - age,
  });
}

/** @internal — testler arası izolasyon. */
export function _resetPendingActionForTest(): void {
  _pending = null;
  _executor = null;
}
