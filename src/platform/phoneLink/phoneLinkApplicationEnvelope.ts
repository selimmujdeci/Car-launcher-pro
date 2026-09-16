/**
 * phoneLinkApplicationEnvelope.ts — PHONE LINK F2 · uygulama mesajı zarfı (F2.1).
 *
 * ── OPAK NATIVE, DAR TS ──────────────────────────────────────────────────────
 * Native köprü (`PhoneHubLinkController`) uygulama mesajını YORUMLAMAZ — bu
 * katman, `LinkKeyValue`nin kendi dokümantasyonunun ("uygulama mesajları
 * TypeScript'in JSON zarfıdır") tanımladığı yerdir. Şema/versiyon/komut
 * doğrulaması TAMAMEN burada olur.
 *
 * ── PAZARLIKSIZ KURALLAR (F2.1) ──────────────────────────────────────────────
 *  · bounded payload (native zaten 4096 bayt sınırlıyor; burada AYRICA denetlenir)
 *  · versioned (`v` alanı sabit sayı, eşleşmezse REJECTED_UNSUPPORTED)
 *  · strict parser (bilinmeyen/eksik/yanlış-tipte alan → REJECTED_MALFORMED)
 *  · command/type allowlist (yalnız tanınan `type` ve — `MUSIC_COMMAND` için —
 *    `PhoneLinkMusicCommand`'daki 6 değer)
 *  · arbitrary method/function adı YOK · reflection/dynamic invocation YOK ·
 *    executable payload YOK — zarf yalnız SABİT alanlı düz veridir, hiçbir
 *    alan bir kod yolu/method adı TAŞIMAZ.
 *
 * ── F8 EKİ: `NAV_DESTINATION_PUSH` ───────────────────────────────────────────
 * İkinci bir zarf/versiyon sistemi AÇILMADI — aynı `v`/`id` alanları, aynı
 * strict-parse felsefesi. `latitude`/`longitude` bounded sayısal alanlardır
 * (NaN/Infinity/aralık dışı → REJECTED_MALFORMED); `label`/`address` bounded
 * uzunlukta ve kontrol karakterinden ARINDIRILMIŞ olmalıdır — telefondan gelen
 * metin SANITIZE EDİLMEZ, kuralı ihlal ediyorsa REJECTED_MALFORMED (§7: bu
 * katman zaten "sessizce düzelt" değil "reddet" felsefesindedir).
 */

import type { PhoneLinkMusicCommand } from './phoneLinkMusicRemoteAdapter';
import { hasControlChars } from '../ai/controlChars';

export const PHONE_LINK_APP_MESSAGE_VERSION = 1 as const;

/** Native'in kendi tavanından (4096 B) ayrı, TS tarafının kendi savunma katmanı. */
export const MAX_APPLICATION_MESSAGE_CHARS = 2048;

const KNOWN_COMMANDS: readonly PhoneLinkMusicCommand[] = Object.freeze([
  'GET_NOW_PLAYING', 'PLAY', 'PAUSE', 'NEXT', 'PREVIOUS', 'GET_QUEUE',
]);

/** Bounded, güvenli messageId biçimi — rastgele metin/kod DEĞİL. */
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** F8 — insan-okunur alanlar için üst sınır (bounded, telemetriye/loga TAŞINMAZ). */
export const MAX_DESTINATION_TEXT_CHARS = 200;

/** F9 — Mavi'ye giden serbest metin isteği için üst sınır. Prompt injection'a
 * karşı çare DEĞİLDİR (o `phoneLinkAssistantBridgeAdapter`'ın Mavi'nin KENDİ
 * Safety Kernel'ine devrettiği iştir) — yalnız bounded payload sözleşmesidir. */
export const MAX_ASSISTANT_TEXT_CHARS = 500;

export interface PhoneLinkMusicCommandRequest {
  readonly v: typeof PHONE_LINK_APP_MESSAGE_VERSION;
  readonly id: string;
  readonly type: 'MUSIC_COMMAND';
  readonly command: PhoneLinkMusicCommand;
}

/** F8 — koordinat tabanlı navigasyon hedefi isteği. */
export interface PhoneLinkNavDestinationPushRequest {
  readonly v: typeof PHONE_LINK_APP_MESSAGE_VERSION;
  readonly id: string;
  readonly type: 'NAV_DESTINATION_PUSH';
  readonly latitude: number;
  readonly longitude: number;
  readonly label: string | null;
  readonly address: string | null;
}

/** F9 — Mavi'ye giden sınırlı metin isteği. */
export interface PhoneLinkAssistantBridgeRequest {
  readonly v: typeof PHONE_LINK_APP_MESSAGE_VERSION;
  readonly id: string;
  readonly type: 'ASSISTANT_BRIDGE_REQUEST';
  readonly text: string;
}

export type PhoneLinkApplicationRequest =
  | PhoneLinkMusicCommandRequest
  | PhoneLinkNavDestinationPushRequest
  | PhoneLinkAssistantBridgeRequest;

export type PhoneLinkAckStatus =
  | 'ACCEPTED'
  | 'REJECTED_UNAUTHORIZED'
  | 'REJECTED_STALE_SESSION'
  | 'REJECTED_UNSUPPORTED'
  | 'REJECTED_MALFORMED'
  | 'FAILED'
  /** F8 — koordinat aralık dışı/NaN/Infinity veya (0,0) "Null Island". */
  | 'INVALID_DESTINATION'
  /** F8 — kanonik navigasyon kapısı istisna verdi (adapter/handoff ulaşılamadı). */
  | 'NAVIGATION_UNAVAILABLE'
  /** F8 — aynı hedef kısa pencerede zaten kabul edildi (`destinationHandoff` debounce). */
  | 'DUPLICATE'
  /** F8 — dispatch zincirinde beklenmeyen (yakalanmış) hata; oturum/diğer capability ETKİLENMEZ. */
  | 'INTERNAL_ERROR'
  /**
   * F8.1 — `NAV_DESTINATION_PUSH` İKİ AŞAMALI hâle geldi (§2/§3): "yetkili
   * istek alındı" ARTIK "navigasyon değişti" DEMEZ. `REJECTED_UNAUTHORIZED`/
   * `REJECTED_STALE_SESSION` bilinçli olarak YENİDEN KULLANILDI (§10:
   * "yalnız gereken alanları genişlet" — capability/session reddi için
   * ikinci bir "REJECTED_NO_CAPABILITY" değeri İCAT EDİLMEDİ, MUSIC_COMMAND
   * ile AYNI anlamı taşırlar).
   */
  /** İlk senkron ACK: zarf geçerli, ama sonuç HENÜZ bilinmiyor (nadiren kullanılır — bkz. PENDING_USER_APPROVAL). */
  | 'RECEIVED'
  /** İstek yetkilendirildi ve araçta kullanıcı onayı BEKLİYOR — navigasyon HENÜZ değişmedi. */
  | 'PENDING_USER_APPROVAL'
  /** Araç içi kullanıcı öneriyi AÇIKÇA reddetti — mevcut rota (varsa) korunur. */
  | 'REJECTED_BY_USER'
  /** Öneri onay penceresinde karara bağlanmadı — artık geçersiz. */
  | 'EXPIRED'
  /**
   * F9 — Mavi Assistant Bridge terminal sözleşmesi.
   *
   * `ACCEPTED` (yeniden kullanıldı) burada "Mavi bir sohbet cevabı ürettti,
   * `result` alanında metin var" demektir. `RECEIVED` (F8.1'den yeniden
   * kullanıldı) ilk senkron ACK'tir — "istek yetkilendirildi, Mavi'den GERÇEK
   * sonuç HENÜZ gelmedi" (§10: RECEIVED ≠ SUCCESS).
   */
  /** Mavi'nin ürettiği sonuç bir EYLEMDİ (komut/aksiyon) — bridge onu ÇALIŞTIRMADI. */
  | 'ACTION_NOT_PERMITTED'
  /** Ne online ne offline zincir bir cevap üretti. */
  | 'NO_ANSWER'
  /** Sağlayıcı bütçesi aşıldı — Mavi'nin kendi timeout'u. */
  | 'TIMED_OUT'
  /** Sonuç üretilmeden disconnect/revoke oldu — istek terminalize edildi. */
  | 'CANCELLED';

export interface PhoneLinkApplicationResponse {
  readonly v: typeof PHONE_LINK_APP_MESSAGE_VERSION;
  /** İsteğin `id`si — telefon hangi isteğe karşılık geldiğini bunula eşler. */
  readonly id: string;
  readonly status: PhoneLinkAckStatus;
  /** Yalnız ACCEPTED + salt-okuma komutlarında (now playing/queue) dolu. */
  readonly result?: unknown;
}

export type ParsedApplicationMessage =
  | { readonly ok: true; readonly request: PhoneLinkApplicationRequest }
  | {
      readonly ok: false;
      readonly status: 'REJECTED_MALFORMED' | 'REJECTED_UNSUPPORTED';
      readonly reason: string;
      /**
       * Fırsatçı olarak çıkarılan `id` — YALNIZ kendi biçimi (bounded, güvenli
       * karakter kümesi) geçerliyse dolu. Telefona bir ACK dönebilmek için
       * (F2.6: "telefon komutun sonucunu bilmeli") diğer alanlar bozuk olsa
       * bile `id` okunabiliyorsa taşınır. `id`nin KENDİSİ bozuksa/yoksa
       * `null` — bu durumda hangi isteğe yanıt verileceği bilinmediği için
       * ingress yanıt GÖNDEREMEZ (sessizce düşer, bu dürüst bir sınırdır).
       */
      readonly id: string | null;
    };

function isKnownCommand(v: unknown): v is PhoneLinkMusicCommand {
  return typeof v === 'string' && (KNOWN_COMMANDS as readonly string[]).includes(v);
}

/**
 * Zarfı ayrıştırır ve DOĞRULAR. Bilinmeyen alan taşınmaz (yalnız tanınan 4
 * alan okunur); eksik/yanlış-tipte alan, bilinmeyen sürüm/tür/komut hepsi
 * fail-closed REJECTED sonucu üretir — kısmi/tahmini bir istek asla dönmez.
 */
export function parseApplicationRequest(payloadUtf8: string): ParsedApplicationMessage {
  if (typeof payloadUtf8 !== 'string' || payloadUtf8.length === 0) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'empty_payload', id: null };
  }
  if (payloadUtf8.length > MAX_APPLICATION_MESSAGE_CHARS) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'payload_too_large', id: null };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(payloadUtf8);
  } catch {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'invalid_json', id: null };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'not_an_object', id: null };
  }
  const obj = raw as Record<string, unknown>;

  /* `id` en önce, BAĞIMSIZ olarak çıkarılır — diğer alanlar bozuk olsa bile
   * geçerli bir id varsa telefona ANLAMLI bir ACK (REJECTED_*) dönebilelim
   * diye (F2.6). id'nin kendisi bozuksa/yoksa hiçbir yanıt üretilemez. */
  const rawId = obj.id;
  const id = typeof rawId === 'string' && MESSAGE_ID_PATTERN.test(rawId) ? rawId : null;
  if (id === null) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'invalid_id', id: null };
  }

  const v = obj.v;
  if (typeof v !== 'number' || v !== PHONE_LINK_APP_MESSAGE_VERSION) {
    return { ok: false, status: 'REJECTED_UNSUPPORTED', reason: 'unknown_version', id };
  }

  const type = obj.type;
  if (type === 'MUSIC_COMMAND') {
    const command = obj.command;
    if (!isKnownCommand(command)) {
      return { ok: false, status: 'REJECTED_UNSUPPORTED', reason: 'unknown_command', id };
    }
    /* Tanınmayan EK alanlar sessizce yok sayılır (ileri sürüm uyumluluğu) ama
     * ÇIKTIYA taşınmaz — yalnız sabit 4 alan döner, başka hiçbir şey. */
    return {
      ok: true,
      request: Object.freeze({ v: PHONE_LINK_APP_MESSAGE_VERSION, id, type: 'MUSIC_COMMAND', command }),
    };
  }

  if (type === 'NAV_DESTINATION_PUSH') {
    return parseNavDestinationFields(obj, id);
  }

  if (type === 'ASSISTANT_BRIDGE_REQUEST') {
    return parseAssistantBridgeFields(obj, id);
  }

  return { ok: false, status: 'REJECTED_UNSUPPORTED', reason: 'unknown_type', id };
}

/**
 * F9 — `ASSISTANT_BRIDGE_REQUEST` alan doğrulaması. Strict: boş/yalnız
 * boşluk metin, aşırı uzun metin, kontrol karakteri içeren metin hepsi
 * `REJECTED_MALFORMED`dir. `role`/`trust`/`capability` gibi bir İDDİA alanı
 * KABUL EDİLMEZ (§8) — zarf yalnız `text` taşır, başka hiçbir alan okunmaz.
 */
function parseAssistantBridgeFields(
  obj: Record<string, unknown>, id: string,
): ParsedApplicationMessage {
  const rawText = obj.text;
  if (typeof rawText !== 'string') {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'invalid_text_type', id };
  }
  const text = rawText.trim();
  if (text.length === 0) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'empty_text', id };
  }
  if (rawText.length > MAX_ASSISTANT_TEXT_CHARS) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'text_too_long', id };
  }
  if (hasControlChars(rawText)) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'text_control_chars', id };
  }

  return {
    ok: true,
    request: Object.freeze({ v: PHONE_LINK_APP_MESSAGE_VERSION, id, type: 'ASSISTANT_BRIDGE_REQUEST', text }),
  };
}

/**
 * F8 — `NAV_DESTINATION_PUSH` alan doğrulaması. Strict: bilinmeyen/eksik/
 * yanlış-tipte/aralık-dışı her şey `REJECTED_MALFORMED`dir; kısmi bir hedef
 * ASLA dönmez (destinationHandoff'un kendi 0,0 kontrolüyle ÇAKIŞMAZ — burada
 * yalnız ZARF biçimi doğrulanır, hedef ANLAMI `destinationHandoff`un işidir).
 */
function parseNavDestinationFields(
  obj: Record<string, unknown>, id: string,
): ParsedApplicationMessage {
  const rawLat = obj.latitude;
  const rawLng = obj.longitude;
  if (typeof rawLat !== 'number' || !Number.isFinite(rawLat) || rawLat < -90 || rawLat > 90) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'invalid_latitude', id };
  }
  if (typeof rawLng !== 'number' || !Number.isFinite(rawLng) || rawLng < -180 || rawLng > 180) {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'invalid_longitude', id };
  }

  const label = _validateOptionalText(obj.label);
  if (label === 'INVALID') {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'invalid_label', id };
  }
  const address = _validateOptionalText(obj.address);
  if (address === 'INVALID') {
    return { ok: false, status: 'REJECTED_MALFORMED', reason: 'invalid_address', id };
  }

  return {
    ok: true,
    request: Object.freeze({
      v: PHONE_LINK_APP_MESSAGE_VERSION, id, type: 'NAV_DESTINATION_PUSH',
      latitude: rawLat, longitude: rawLng, label, address,
    }),
  };
}

/** Alan yoksa `null` (opsiyonel); varsa bounded + kontrol-karakteri-siz string olmalı; aksi hâlde `'INVALID'`. */
function _validateOptionalText(v: unknown): string | null | 'INVALID' {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return 'INVALID';
  if (v.length === 0 || v.length > MAX_DESTINATION_TEXT_CHARS) return 'INVALID';
  if (hasControlChars(v)) return 'INVALID';
  return v;
}

/** Yanıt zarfını üretir — TS ingress'inin verdiği kararı SABİT biçime döker. */
export function buildApplicationResponse(
  id: string, status: PhoneLinkAckStatus, result?: unknown,
): PhoneLinkApplicationResponse {
  return Object.freeze({
    v: PHONE_LINK_APP_MESSAGE_VERSION, id, status,
    ...(result !== undefined ? { result } : {}),
  });
}

export function serializeApplicationResponse(response: PhoneLinkApplicationResponse): string {
  return JSON.stringify(response);
}
