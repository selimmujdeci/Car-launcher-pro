/**
 * fcmDelivery — FCM HTTP v1 yanıtının SINIFLANDIRILMASI (saf, test edilebilir).
 *
 * ── TEMEL İLKE ───────────────────────────────────────────────────────────
 *   OAuth token alındı  ≠  FCM mesajı KABUL ETTİ  ≠  cihaz aldı
 *   ≠ araç uyandı ≠ komut alındı ≠ fiziksel işlem gerçekleşti.
 *
 * Bu modülün verebileceği EN GÜÇLÜ hüküm `ACCEPTED`tır: "FCM isteği kabul
 * etti". Teslimat, uyanma ve icra AYRI kanıt seviyeleridir ve buradan
 * ÜRETİLEMEZ.
 *
 * ── TOKEN SİLME YETKİSİ DAR TUTULUR ──────────────────────────────────────
 * PROD-1A1'de kayıt sırasında tahminle silme reddedildi; silmenin yetkili
 * tanığı gönderim yanıtıdır. Ama o tanık da DAR okunur: yalnız kayıt
 * token'ına ÖZGÜ kalıcı geçersizlik kanıtı (`UNREGISTERED`, ya da 404
 * `NOT_FOUND`) silme gerekçesidir.
 *
 * 401/403/429/5xx/ağ hatası/OAuth hatası GEÇİCİDİR: bunlarda silmek, tek bir
 * kota aşımının ya da süresi dolmuş bir access token'ın TÜM filonun
 * Push-to-Wake yeteneğini kalıcı olarak silmesi demek olurdu.
 *
 * 400 `INVALID_ARGUMENT` bilinçli olarak silme sebebi SAYILMAZ: bozuk bir
 * payload da aynı kodu üretir ve bir gönderici hatası tüm token'ları silerdi.
 */

export const FCM_SEND_ENDPOINT = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

export type FcmOutcomeKind =
  /** FCM isteği KABUL ETTİ (teslim/uyanma İDDİASI DEĞİL). */
  | 'ACCEPTED'
  /** Kayıt token'ı KALICI olarak geçersiz — yalnız bu satır silinebilir. */
  | 'PERMANENT_INVALID_TOKEN'
  /** Sonradan düzelebilir (kota, sunucu, yetki, ağ) — token SİLİNMEZ. */
  | 'TRANSIENT'
  /** Kalıcı ama token'ın suçu değil (bozuk payload vb.) — token SİLİNMEZ. */
  | 'REJECTED';

export interface FcmOutcome {
  kind:   FcmOutcomeKind;
  /** HTTP durumu; ağ hatasında 0. */
  status: number;
  /** FCM `errorCode` ya da türetilmiş kısa kategori — ASLA yanıt gövdesinin tamamı. */
  code:   string;
}

/** FCM v1 hata gövdesinden `errorCode`u çıkarır (`details[]` içinde `FcmError`). */
function fcmErrorCode(body: unknown): string {
  const err = (body as { error?: Record<string, unknown> } | null)?.error;
  if (!err || typeof err !== 'object') return '';

  const details = Array.isArray(err.details) ? err.details : [];
  for (const d of details) {
    const rec = d as Record<string, unknown>;
    const type = typeof rec['@type'] === 'string' ? rec['@type'] : '';
    if (type.includes('FcmError') && typeof rec.errorCode === 'string') return rec.errorCode;
  }
  return typeof err.status === 'string' ? err.status : '';
}

/**
 * Bir gönderim yanıtını sınıflandırır.
 *
 * Başarı iki şartı BİRLİKTE ister: HTTP ok **ve** beklenen mesaj yanıtı
 * (`name: "projects/…/messages/…"`). 200 dönen ama mesaj adı taşımayan bir
 * yanıt "gönderildi" SAYILMAZ — "hata atmadı" kabul kanıtı değildir.
 */
export function classifyFcmResponse(status: number, body: unknown): FcmOutcome {
  if (status >= 200 && status < 300) {
    const name = (body as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.length > 0) {
      return { kind: 'ACCEPTED', status, code: 'OK' };
    }
    return { kind: 'REJECTED', status, code: 'NO_MESSAGE_NAME' };
  }

  const code = fcmErrorCode(body);

  /* DAR KAPI: yalnız kayıt token'ına özgü kalıcı geçersizlik. */
  if (code === 'UNREGISTERED' || (status === 404 && (code === 'NOT_FOUND' || code === ''))) {
    return { kind: 'PERMANENT_INVALID_TOKEN', status, code: code || 'NOT_FOUND' };
  }

  /* Yetki/kota/sunucu → GEÇİCİ. Bunlarda silmek felaket olurdu. */
  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return { kind: 'TRANSIENT', status, code: code || 'TRANSIENT' };
  }

  return { kind: 'REJECTED', status, code: code || 'REJECTED' };
}

/** Ağ/istemci hatası — yanıt HİÇ alınamadı. Kalıcı geçersizlik KANITI DEĞİLDİR. */
export function networkFailureOutcome(): FcmOutcome {
  return { kind: 'TRANSIENT', status: 0, code: 'NETWORK_ERROR' };
}

/** Yalnız kalıcı token geçersizliği silme yetkisi verir. */
export function shouldDeleteToken(outcome: FcmOutcome): boolean {
  return outcome.kind === 'PERMANENT_INVALID_TOKEN';
}

/* ── Wake mesajı ─────────────────────────────────────────────────────────── */

/**
 * Data-only wake mesajı — PROD-1A'da doğrulanan değişmez korunur.
 *
 * `title`/`body` YOKTUR (kullanıcıya görünen bildirim değildir) ve
 * `cmd_type`/`cmd_id`/`e2e_payload` YOKTUR: bunlar olmadan Android tarafındaki
 * `CommandService.handleEncryptedCommand` dalına YAPISAL olarak girilemez.
 * Yani bu mesaj tanım gereği yalnız bir UYANMA İPUCUDUR; fiziksel komut
 * otoritesi `vehicle_commands` + kanonik `CommandListener`da kalır.
 *
 * Sır taşımaz: PIN, JWT, api_key, service-account, access token, kullanıcı
 * PII'si ve ham teşhis verisi buraya GİRMEZ.
 */
export function buildWakeMessage(
  token:     string,
  event:     string,
  vehicleId: string,
  payload:   Record<string, unknown>,
  nowMs:     number,
): { message: Record<string, unknown> } {
  return {
    message: {
      token,
      data: {
        event,
        vehicle_id: vehicleId,
        payload:    JSON.stringify(payload ?? {}),
        ts:         String(nowMs),
      },
      android: {
        priority:       'high',      // Doze'u atla
        direct_boot_ok: true,
      },
    },
  };
}
