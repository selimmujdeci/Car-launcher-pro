/**
 * intentExecutionResult — Yerel komut yolunun YÜRÜTME SONUCU sözleşmesi + dürüst geri bildirim.
 * (MAVI-M3-FAKE-ACK · M1 #146 P0 "sahte onay" bulgusunu kapatır)
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * M1 kanıtladı: yerel yolda `voiceService.dispatch` PARSER'ın hazır metnini
 * (`cmd.feedback`) yürütmeden ÖNCE ve yürütmenin sonucundan BAĞIMSIZ seslendiriyordu.
 * `routeIntent`'te `HARDWARE_*` portları bağlı olmadığı ve `CLEAR_DTC_CODES` /
 * `CHECK_VEHICLE_HEALTH` dalları `break` (no-op) olduğu için kullanıcı
 * "Kapılar kilitleniyor" · "Arıza kayıtları siliniyor" duyuyor, ama HİÇBİR ŞEY
 * OLMUYORDU.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *   Intent seçildi  ≠  Eylem başladı  ≠  Eylem başarıyla tamamlandı
 *
 * Bu modül SAF VERİ üretir: TTS çalıştırmaz · UI açmaz · store yazmaz · I/O yapmaz.
 * Başarı iddiası YALNIZ yürütücünün döndürdüğü kanıttan gelir; `boolean` dönüşü
 * (handled=true) başarı SAYILMAZ.
 *
 * ── SÖZLÜK HİZASI ───────────────────────────────────────────────────────────
 * Durum adları `maviCore/executionEngine.StepStatus` ile bilinçli olarak hizalıdır
 * (`denied` · `needs_confirmation` · `failed`; `succeeded`≈`ok`, `unsupported`≈
 * `no_handler`) → ileride tek sözleşmeye birleştirme mekanik olur. maviCore FROZEN
 * olduğu için (M1 karar matrisi) buradan ORAYA bağımlılık kurulmaz.
 */

import type { IntentType } from './intentEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

export type IntentExecutionStatus =
  /** Bu intent M3 sonuç sözleşmesi kapsamında DEĞİL → eski davranış aynen geçerli. */
  | 'not_handled'
  /** Yıkıcı işlem: açık kullanıcı onayı olmadan BAŞLATILAMAZ. */
  | 'needs_confirmation'
  /** Güvenlik/politika reddi (hareket halinde, durum doğrulanamadı…). */
  | 'denied'
  /** Bu araçta/kurulumda yürütücü YOK — dürüstçe söylenir. */
  | 'unsupported'
  /** Gerçekten başlatıldı ama sonucu HENÜZ belli değil (uzun süren tarama vb.). */
  | 'started'
  /** Yürütücü BAŞARI KANITI döndürdü. */
  | 'succeeded'
  /** Yürütücü hata/ret döndürdü ya da exception attı. */
  | 'failed'
  /** Çağrıldı ama sonuç doğrulanamadı (fire-and-forget, boş dönüş). */
  | 'unknown';

/** Yürütme sonucu — SAF VERİ. */
export interface IntentExecutionResult {
  readonly status: IntentExecutionStatus;
  readonly intent: IntentType;
  /** Makine-okur gerekçe (telemetri/test) — kullanıcıya GÖSTERİLMEZ. */
  readonly reason?: string;
  /** Yürütücüden gelen GERÇEK metin (ör. araç sağlığı özeti). Uydurulmaz. */
  readonly detail?: string;
}

/** Kısa yardımcı — dondurulmuş sonuç üretir. */
export function intentResult(
  intent: IntentType,
  status: IntentExecutionStatus,
  reason?: string,
  detail?: string,
): IntentExecutionResult {
  return Object.freeze({ intent, status, ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Dürüst geri bildirim
 * ════════════════════════════════════════════════════════════════════════ */

export type IntentFeedbackSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * Kullanıcıya dönecek TEK zarf. `message` boş/whitespace ise seslendirme YAPILMAZ
 * (çağıranın sözleşmesi). Zarf başına en fazla BİR mesaj üretilir.
 */
export interface IntentFeedbackEnvelope {
  readonly severity: IntentFeedbackSeverity;
  /** Makine-okur kod (telemetri/test): 'intent_denied', 'intent_unsupported'… */
  readonly code: string;
  /** Kullanıcıya söylenecek KISA Türkçe metin (ISO 15008). */
  readonly message: string;
  readonly intent: IntentType;
  readonly status: IntentExecutionStatus;
}

/**
 * Intent'in kullanıcı diline çevrilmiş KISA adı — "yapamıyorum" cümlelerinde geçer.
 * ⚠️ i18n BORCU: `intentEngine`/`commandParser`/`commandExecutor` katmanlarının tamamı
 * bugün hardcoded Türkçe metin üretir (bkz. `commandExecutor._speak` çağrıları). Bu
 * modül MEVCUT desenle hizalı kalır; i18n taşıması ayrı ve bütün bir borçtur (raporda).
 */
const INTENT_LABEL: Partial<Record<IntentType, string>> = {
  HARDWARE_LOCK:         'kapı kilitleme',
  HARDWARE_UNLOCK:       'kapı açma',
  HARDWARE_HORN:         'korna',
  HARDWARE_FLASH:        'far sinyali',
  HARDWARE_ALARM_ON:     'alarm',
  HARDWARE_ALARM_OFF:    'alarm',
  HARDWARE_REAR_CAMERA:  'arka kamera',
  HARDWARE_LIGHTS_OFF:   'ışık kontrolü',
  HARDWARE_SCREEN_OFF:   'ekran kontrolü',
  CLEAR_DTC_CODES:       'arıza kaydı silme',
  CHECK_VEHICLE_HEALTH:  'araç sağlık taraması',
};

/**
 * Onay sorusu — eylemi ADIYLA sorar (ör. "Kapıları kilitlememi onaylıyor musun?").
 * Bilinmeyen intent için mevcut jenerik cümle KORUNUR (davranış daralması yok).
 */
const CONFIRM_QUESTION: Partial<Record<IntentType, string>> = {
  HARDWARE_LOCK:      'Kapıları kilitlememi onaylıyor musun?',
  HARDWARE_UNLOCK:    'Kapıların kilidini açmamı onaylıyor musun?',
  HARDWARE_HORN:      'Korna çalmamı onaylıyor musun?',
  HARDWARE_FLASH:     'Farları yakmamı onaylıyor musun?',
  HARDWARE_ALARM_ON:  'Alarmı açmamı onaylıyor musun?',
  HARDWARE_ALARM_OFF: 'Alarmı kapatmamı onaylıyor musun?',
  CLEAR_DTC_CODES:    'Arıza kayıtlarını silmek için açık onayın gerekiyor.',
};

function confirmationQuestion(intent: IntentType): string {
  return CONFIRM_QUESTION[intent] ?? 'Bunu yapmam için açık onayın gerekiyor.';
}

/** Yürütücüsü olmayan eylem için DÜRÜST cümle — sahte "yapıldı" yerine. */
function unsupportedMessage(intent: IntentType): string {
  const label = INTENT_LABEL[intent];
  if (intent === 'CHECK_VEHICLE_HEALTH') return 'Araç sağlık taraması şu anda kullanılamıyor.';
  return label
    ? `Bu araçta ${label} bağlantısı henüz hazır değil.`
    : 'Bu özellik bu araçta henüz hazır değil.';
}

/** DENIED gerekçesi → kısa, suçlayıcı olmayan cümle. */
function deniedMessage(intent: IntentType, reason: string | undefined): string {
  if (reason === 'vehicle_moving')      return 'Araç hareketliyken kapıları açamam.';
  if (reason === 'motion_unverified')   return 'Araç durumunu doğrulayamadığım için kapıları açamıyorum.';
  if (intent === 'CLEAR_DTC_CODES')     return 'Arıza kayıtları şu anda silinemez.';
  return 'Bu işlemi şu anda yapamam.';
}

/**
 * Yürütme sonucundan TEK geri bildirim zarfı üretir. SAF · throw ETMEZ.
 *
 * Kurallar (M3):
 *  - `not_handled` → `null` (eski davranış konuşur; buradan İKİNCİ ses ÇIKMAZ).
 *  - "yapılıyor" YALNIZ `started`, "yapıldı" YALNIZ `succeeded` için.
 *  - `unknown` sonuç İDDİA ETMEZ.
 *  - `succeeded` yürütücünün GERÇEK metnini (`detail`) tercih eder; yoksa nötr onay.
 */
export function buildIntentExecutionFeedback(
  result: IntentExecutionResult | null | undefined,
): IntentFeedbackEnvelope | null {
  if (!result || typeof result.status !== 'string') return null;
  const { intent, status, reason } = result;
  const detail = typeof result.detail === 'string' && result.detail.trim().length > 0
    ? result.detail.trim()
    : null;

  const env = (severity: IntentFeedbackSeverity, code: string, message: string): IntentFeedbackEnvelope =>
    Object.freeze({ severity, code, message, intent, status });

  switch (status) {
    case 'not_handled':
      return null;                                   // eski hat konuşur — çift ses YOK

    case 'needs_confirmation':
      /* Soru EYLEMİ ADIYLA sorar: kullanıcı neyi onayladığını bilmeden "evet"
         diyememelidir (donanım eylemleri P0 turunda onaya bağlandı). */
      return env('warning', 'intent_needs_confirmation', confirmationQuestion(intent));

    case 'denied':
      return env('error', 'intent_denied', deniedMessage(intent, reason));

    case 'unsupported':
      return env('error', 'intent_unsupported', unsupportedMessage(intent));

    case 'started':
      // "…yapılıyor" — YALNIZ gerçekten başlatıldıysa.
      return env('info', 'intent_started', detail ?? 'Başlatıyorum.');

    case 'succeeded':
      // "…yapıldı" — YALNIZ yürütücü kanıt döndürdüyse.
      return env('success', 'intent_succeeded', detail ?? 'Tamam, yaptım.');

    case 'failed':
      return env('error', 'intent_failed', detail ?? 'Bunu yapamadım.');

    case 'unknown':
    default:
      // Sonuç doğrulanamadı → BAŞARI İDDİA EDİLMEZ.
      return env('warning', 'intent_unknown', 'İşlemin sonucunu doğrulayamadım.');
  }
}
