/**
 * wakeDispatch — çok token'lı wake gönderimi (runtime-agnostic, test edilebilir).
 *
 * `pushAuth.ts` ile aynı desen: tüm I/O dependency injection ile gelir, böylece
 * "ölü token silindi mi", "kardeş token korundu mu", "geçici hatada silinmedi
 * mi" soruları gerçek ağ ve gerçek DB olmadan KANITLANABİLİR.
 *
 * ── SORUMLULUK SINIRI ────────────────────────────────────────────────────
 * Bu modül HÜKÜM VERMEZ: sınıflandırma `fcmDelivery.classifyFcmResponse`ın,
 * kimlik `googleAuth`ın, yetkilendirme `pushAuth`ın işidir. Burada yalnız
 * sıralama, izolasyon ve sayım vardır.
 */

import {
  buildWakeMessage,
  classifyFcmResponse,
  networkFailureOutcome,
  shouldDeleteToken,
  type FcmOutcome,
} from './fcmDelivery.ts';

export interface DispatchDeps {
  /** Kısa ömürlü OAuth2 access token — LOGLANMAZ. */
  accessToken: string;
  endpoint:    string;
  now:         () => number;
  fetch:       typeof fetch;
  /** YALNIZ verilen (araç, token) satırını siler. Toplu silme YOK. */
  deleteToken: (fcmToken: string) => Promise<{ ok: boolean }>;
  /** Kategori/sayı logu; cihaz token'ı ve sır GEÇMEZ. */
  warn?:       (msg: string) => void;
}

export interface DispatchSummary {
  /** FCM HTTP v1'in KABUL ETTİĞİ mesaj sayısı — teslim/uyanma İDDİASI DEĞİL. */
  accepted:      number;
  failed:        number;
  /** Kalıcı geçersizliği kanıtlanıp SİLİNEN token sayısı. */
  cleaned:       number;
  /** Silinmesi gerekip silinemeyen — sessizce yutulmaz. */
  cleanupFailed: number;
}

/**
 * Bir aracın TÜM cihaz token'larına wake gönderir.
 *
 * ── İZOLASYON ────────────────────────────────────────────────────────────
 * Her token kendi try/catch'i içinde işlenir ve `Promise.allSettled` ile
 * toplanır: bir token'ın `UNREGISTERED` olması ya da temizliğinin başarısız
 * olması KARDEŞ token'ların gönderimini durdurmaz ve onları SİLDİRMEZ.
 */
export async function dispatchWake(
  tokens:    readonly string[],
  event:     string,
  vehicleId: string,
  payload:   Record<string, unknown>,
  deps:      DispatchDeps,
): Promise<DispatchSummary> {
  const nowMs = deps.now();

  const one = async (fcmToken: string): Promise<{ outcome: FcmOutcome; cleanupFailed: boolean }> => {
    let outcome: FcmOutcome;
    try {
      const res = await deps.fetch(deps.endpoint, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${deps.accessToken}`,
        },
        body: JSON.stringify(buildWakeMessage(fcmToken, event, vehicleId, payload, nowMs)),
      });
      let parsed: unknown = null;
      try { parsed = await res.json(); } catch { /* gövdesiz yanıt olabilir */ }
      outcome = classifyFcmResponse(res.status, parsed);
    } catch {
      /* Ham hata nesnesi istek gövdesini (access token / cihaz token'ı)
         alıntılayabilir — DIŞARI TAŞINMAZ. Yanıt hiç alınmadı: bu, kalıcı
         geçersizlik KANITI DEĞİLDİR. */
      outcome = networkFailureOutcome();
    }

    if (!shouldDeleteToken(outcome)) return { outcome, cleanupFailed: false };

    const del = await deps.deleteToken(fcmToken).catch(() => ({ ok: false }));
    if (!del.ok) {
      deps.warn?.(`ölü token silinemedi (${outcome.code})`);
      return { outcome, cleanupFailed: true };
    }
    return { outcome, cleanupFailed: false };
  };

  const results = await Promise.allSettled(tokens.map(one));

  const sum: DispatchSummary = { accepted: 0, failed: 0, cleaned: 0, cleanupFailed: 0 };
  for (const r of results) {
    if (r.status !== 'fulfilled') { sum.failed++; continue; }
    const { outcome, cleanupFailed } = r.value;
    if (outcome.kind === 'ACCEPTED') { sum.accepted++; continue; }
    sum.failed++;
    if (shouldDeleteToken(outcome)) {
      if (cleanupFailed) sum.cleanupFailed++;
      else sum.cleaned++;
    }
  }
  return sum;
}
