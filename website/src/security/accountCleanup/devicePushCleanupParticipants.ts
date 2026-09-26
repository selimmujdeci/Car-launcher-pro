/**
 * DEVICE_AND_PUSH_REVOKE fazının katılımcısı.
 *
 * ── ÖLÇÜLEN KUSUR (production, 2026-09-17) ───────────────────────────────
 * `CLEANUP_PHASES` altı faz tanımlar, ama `DEVICE_AND_PUSH_REVOKE` için
 * HİÇBİR katılımcı kayıtlı değildi. Koordinatör her fazı sırayla yürütür ve
 * katılımcısı olmayan faza gelince koşulsuz durur:
 *
 *   AccountCleanupCoordinator.ts
 *     if (!this.registry.hasParticipantForPhase(phase))
 *       return this.persistFailure(entry, 'FAILED_BLOCKING',
 *                                  'MISSING_PHASE_PARTICIPANT');
 *
 * Sonuç: ÇIKIŞ HİÇBİR ZAMAN TAMAMLANAMIYORDU — hem Arabam Cebimde hem filo
 * panelinde. Kullanıcı telefonda tam olarak bu kodu gördü:
 *   "Çıkış tamamlanamadı (FAILED_BLOCKING · MISSING_PHASE_PARTICIPANT)"
 * Fail-closed olduğu için oturum açık kalıyordu (veri kaybı yoktu), ama
 * yarıda kalan temizlik `caros-account-cleanup` işaret çerezini bırakıyor ve
 * o çerez 24 saat boyunca auth yazımını kilitliyordu.
 *
 * ── BU DOSYA NE YAPAR ────────────────────────────────────────────────────
 * Fazın işi ZATEN yazılmıştı (`lib/pushEngine.unsubscribe()`: tarayıcı push
 * aboneliğini iptal eder ve `push_subscriptions` kaydını siler); yalnız
 * kanonik faza BAĞLANMAMIŞTI. Burada yeni bir temizlik otoritesi KURULMAZ,
 * mevcut yetenek fazın sözleşmesine bağlanır.
 *
 * Doğrulama gerçektir: iptal sonrası abonelik hâlâ duruyorsa katılımcı
 * BAŞARISIZ döner (sessiz "temizlendi" iddiası üretilmez).
 */

import { getCleanupGeneration, isAccountAccessLocked } from './cleanupLockdown';
import type {
  AccountCleanupParticipant,
  CleanupContext,
  CleanupParticipantResult,
} from './cleanupTypes';

export type DevicePushAdapter = Readonly<{
  /** Aboneliği iptal eder (tarayıcı + sunucu kaydı). */
  revoke: () => Promise<void>;
  /** Hâlâ aktif bir abonelik var mı? */
  hasSubscription: () => Promise<boolean>;
}>;

export class DevicePushRevokeParticipant implements AccountCleanupParticipant {
  readonly id = 'device-push-revoke';
  readonly phase = 'DEVICE_AND_PUSH_REVOKE' as const;
  readonly priority = 10;

  constructor(private readonly adapter: DevicePushAdapter) {}

  async clear(context: CleanupContext): Promise<CleanupParticipantResult> {
    /* Diğer katılımcılarla aynı bağlam kapısı: temizlik kilidi açıkken ve
       yalnız kendi kuşağı içinde çalışır. */
    if (!isAccountAccessLocked() ||
        getCleanupGeneration() !== context.generation) {
      return { ok: false, retryable: true, failureCode: 'DEVICE_PUSH_CONTEXT_INVALID' };
    }

    try {
      if (!(await this.adapter.hasSubscription())) {
        return { ok: true, code: 'ALREADY_EMPTY' };
      }
      await this.adapter.revoke();
      /* `unsubscribe()` best-effort'tur (hatayı yutar) → "temizlendi" demeden
         ÖNCE gerçekten gittiğini doğrularız. */
      if (await this.adapter.hasSubscription()) {
        return { ok: false, retryable: true, failureCode: 'DEVICE_PUSH_STILL_PRESENT' };
      }
      return { ok: true, code: 'CLEARED' };
    } catch {
      return { ok: false, retryable: true, failureCode: 'DEVICE_PUSH_REVOKE_FAILED' };
    }
  }
}

/** Üretim adaptörü — tarayıcı push yüzeyi yoksa faz uygulanamaz sayılır. */
export const productionDevicePushAdapter: DevicePushAdapter = Object.freeze({
  revoke: async () => {
    const { unsubscribe } = await import('@/lib/pushEngine');
    await unsubscribe();
  },
  hasSubscription: async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return false;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    return (await registration.pushManager.getSubscription()) !== null;
  },
});
