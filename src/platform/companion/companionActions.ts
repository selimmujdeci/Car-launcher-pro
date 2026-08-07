/**
 * companionActions.ts — Mavi Action Registry için Companion eylem SÖZLEŞMESİ (P1-PREP).
 *
 * ── HİÇBİRİ UYGULANMADI (PAZARLIKSIZ) ───────────────────────────────────────
 * Bu dosya YALNIZ eylem TANIMLARINI (metadata + payload sözleşmesi) üretir.
 * Hiçbir eylemin yürütücüsü (handler) YOKTUR ve `executionEngine`'e BAĞLANMAZ.
 * Medya komutu · çağrı · SMS · bildirim okuma — hiçbiri çağrılmaz; bu katmanda
 * `dispatchMediaKeyEvent` · `ACTION_CALL` · `placeCall` · SMS API'si GEÇMEZ.
 *
 * ── PARALEL SİSTEM KURULMAZ ─────────────────────────────────────────────────
 * Mevcut `maviCore/actionRegistry` sözleşmesi (`ActionDefinition`) AYNEN yeniden
 * kullanılır; yeni bir eylem defteri tipi İCAT EDİLMEZ. Kayıt, çağıranın verdiği
 * `MaviActionRegistry` örneğine yapılır — modül seviyesinde global defter YOK
 * (import yan etkisiz).
 *
 * ── GÜVENLİK SINIFLANDIRMASI ────────────────────────────────────────────────
 * Companion eylemleri araç ECU'suna DOKUNMAZ → `vehicleScope` VERİLMEZ.
 * Risk sınıfı yalnızca UX/gizlilik riskini yansıtır; SMS/bildirim/kişi gibi
 * hassas yüzeyler `high` risktir ve `reversible:false` taşır.
 */

import {
  makeOptionalStringValidator, makeRequiredStringValidator, validateEmpty,
  type ActionDefinition, type MaviActionRegistry,
} from '../maviCore/actionRegistry';
import { CAPABILITY_PRIVACY, type CompanionCapability } from './companionDomain';

/* ══════════════════════════════════════════════════════════════════════════
 * Eylem kimlikleri
 * ════════════════════════════════════════════════════════════════════════ */

export const COMPANION_ACTION_IDS = Object.freeze({
  OPEN_PHONE:       'companion.phone.open',
  PLAY_MEDIA:       'companion.media.play',
  PAUSE_MEDIA:      'companion.media.pause',
  ANSWER_CALL:      'companion.call.answer',
  REJECT_CALL:      'companion.call.reject',
  READ_NOTIFICATION:'companion.notification.read',
  REPLY_MESSAGE:    'companion.message.reply',
  OPEN_PHOTO:       'companion.photo.open',
  OPEN_FILES:       'companion.files.open',
} as const);

export type CompanionActionId =
  (typeof COMPANION_ACTION_IDS)[keyof typeof COMPANION_ACTION_IDS];

/**
 * Her eylemin GEREKTİRDİĞİ yetenek. Yürütme fazında (P1-A+) bu eşleme kapı
 * olacaktır: yetenek `GRANTED` değilse eylem ÇALIŞTIRILMAZ. Bugün yerel destek
 * listesi boş olduğu için hiçbiri çalıştırılabilir DEĞİLDİR.
 */
export const COMPANION_ACTION_CAPABILITY:
  Readonly<Record<CompanionActionId, CompanionCapability>> = Object.freeze({
  [COMPANION_ACTION_IDS.OPEN_PHONE]:        'CALLS',
  [COMPANION_ACTION_IDS.PLAY_MEDIA]:        'MEDIA',
  [COMPANION_ACTION_IDS.PAUSE_MEDIA]:       'MEDIA',
  [COMPANION_ACTION_IDS.ANSWER_CALL]:       'CALLS',
  [COMPANION_ACTION_IDS.REJECT_CALL]:       'CALLS',
  [COMPANION_ACTION_IDS.READ_NOTIFICATION]: 'NOTIFICATIONS',
  [COMPANION_ACTION_IDS.REPLY_MESSAGE]:     'TEXT_REPLY',
  [COMPANION_ACTION_IDS.OPEN_PHOTO]:        'PHOTOS',
  [COMPANION_ACTION_IDS.OPEN_FILES]:        'FILES',
});

/* ══════════════════════════════════════════════════════════════════════════
 * Eylem tanımları — YER TUTUCU (yürütücü YOK)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Companion eylem seti. Tümü YER TUTUCUDUR: kayıt edilmeleri yalnız defterde
 * GÖRÜNMELERİNİ sağlar; `executionEngine` handler map'inde karşılığı OLMADIĞI
 * için çağrıldıklarında yürütülemezler (fail-closed). Bu bilinçlidir — eylem
 * sözleşmesini önce dondurup yürütmeyi sonra bağlamak, yarım yürütme yolundan
 * güvenlidir.
 */
export const COMPANION_ACTIONS: readonly ActionDefinition[] = Object.freeze([
  {
    id: COMPANION_ACTION_IDS.OPEN_PHONE,
    title: 'Telefon ekranını aç',
    risk: 'low',
    reversible: true,
    timeoutMs: 3_000,
    resultContract: 'ack',
    validate: validateEmpty,
  },
  {
    id: COMPANION_ACTION_IDS.PLAY_MEDIA,
    title: 'Telefon medyasını başlat',
    risk: 'low',
    reversible: true,
    timeoutMs: 3_000,
    resultContract: 'ack',
    validate: validateEmpty,
  },
  {
    id: COMPANION_ACTION_IDS.PAUSE_MEDIA,
    title: 'Telefon medyasını duraklat',
    risk: 'low',
    reversible: true,
    timeoutMs: 3_000,
    resultContract: 'ack',
    validate: validateEmpty,
  },
  {
    id: COMPANION_ACTION_IDS.ANSWER_CALL,
    /* Çağrı yanıtlama GERİ ALINAMAZ: yanıtlanmış çağrı "geri alınamaz",
       kapatmak farklı bir eylemdir. */
    title: 'Gelen çağrıyı yanıtla',
    risk: 'high',
    reversible: false,
    timeoutMs: 5_000,
    resultContract: 'ack',
    validate: validateEmpty,
  },
  {
    id: COMPANION_ACTION_IDS.REJECT_CALL,
    title: 'Gelen çağrıyı reddet',
    risk: 'high',
    reversible: false,
    timeoutMs: 5_000,
    resultContract: 'ack',
    validate: validateEmpty,
  },
  {
    id: COMPANION_ACTION_IDS.READ_NOTIFICATION,
    /* Bildirim OKUMA hassas veriye erişir → high risk. Bu faz bildirim
       dinleyicisi EKLEMEZ ve izin İSTEMEZ. */
    title: 'Bildirimi oku',
    risk: 'high',
    reversible: true,
    timeoutMs: 4_000,
    resultContract: 'value',
    validate: makeOptionalStringValidator('notificationKey'),
  },
  {
    id: COMPANION_ACTION_IDS.REPLY_MESSAGE,
    /* Mesaj gönderimi GERİ ALINAMAZ ve dışa dönüktür → en yüksek dikkat. */
    title: 'Mesajı yanıtla',
    risk: 'high',
    reversible: false,
    timeoutMs: 6_000,
    resultContract: 'ack',
    validate: makeRequiredStringValidator('text'),
  },
  {
    id: COMPANION_ACTION_IDS.OPEN_PHOTO,
    title: 'Fotoğrafı aç',
    risk: 'medium',
    reversible: true,
    timeoutMs: 4_000,
    resultContract: 'ack',
    validate: makeOptionalStringValidator('itemKey'),
  },
  {
    id: COMPANION_ACTION_IDS.OPEN_FILES,
    title: 'Dosyaları aç',
    risk: 'medium',
    reversible: true,
    timeoutMs: 4_000,
    resultContract: 'ack',
    validate: validateEmpty,
  },
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Kayıt köprüsü
 * ════════════════════════════════════════════════════════════════════════ */

export interface CompanionActionRegistrationResult {
  readonly registered: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Companion eylemlerini VERİLEN deftere kaydeder.
 *
 * Mevcut defter çift kayıtta `throw` eder (kurulum-zamanı programlama hatası
 * sözleşmesi). Bu köprü aynı eylem setinin iki kez kaydedilmesini SESSİZCE
 * atlar — birden fazla LAB ekranı/oturum aynı deftere yazabilir ve bu bir
 * programlama hatası değildir. Diğer tüm hatalar YUKARI VERİLİR (yutulmaz).
 */
export function registerCompanionActions(
  registry: MaviActionRegistry,
): CompanionActionRegistrationResult {
  const registered: string[] = [];
  const skipped: string[] = [];
  if (!registry) return { registered, skipped };

  for (const def of COMPANION_ACTIONS) {
    if (registry.has(def.id)) { skipped.push(def.id); continue; }
    registry.register(def);
    registered.push(def.id);
  }
  return { registered: Object.freeze(registered), skipped: Object.freeze(skipped) };
}

/** Bir eylemin bugün yürütülebilir olup olmadığı — DAİMA false (yürütücü yok). */
export function isCompanionActionExecutable(_id: string): boolean {
  return false;
}

/** Eylemin gerektirdiği yeteneğin gizlilik sınıfı (onay kapısı tasarımı için). */
export function companionActionPrivacy(id: string): string | null {
  const cap = (COMPANION_ACTION_CAPABILITY as Record<string, CompanionCapability>)[id];
  return cap ? CAPABILITY_PRIVACY[cap] : null;
}
