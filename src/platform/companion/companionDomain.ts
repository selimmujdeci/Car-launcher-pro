/**
 * companionDomain.ts — Companion Foundation ortak sözlüğü (P1-PREP · SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React importu YOK.
 * Import YAN ETKİSİZDİR.
 *
 * ── TRANSPORT-BAĞIMSIZLIK (PAZARLIKSIZ) ─────────────────────────────────────
 * Bu katman bağlantının NASIL kurulacağı hakkında HİÇBİR VARSAYIM YAPMAZ.
 * Bluetooth otoritesi · A2DP · HFP · vendor servisi · MCU köprüsü — hiçbiri
 * "olacak" kabul edilmez. Saha kanıtı (P0.7/P0.8) henüz gerçek head unit'te
 * toplanmadığı için taşıma türü varsayılan olarak `UNKNOWN`'dır ve mimari
 * ADAPTER üzerinden çalışır. Hiçbir taşıma bu fazda UYGULANMAZ.
 *
 * ── BİLİNMEYEN DEĞER SÖZLEŞMESİ ─────────────────────────────────────────────
 * Karşı taraf bizim bilmediğimiz bir yetenek/sürüm/alan gönderebilir. Bilinmeyen
 * değer DÜŞÜRÜLMEZ ve HATA sayılmaz — ayrı bir listede TAŞINIR. "Tanımadım"
 * ile "yok" AYRI şeylerdir (P0.7'nin ana dersi).
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sürümler ve sınırlar
 * ════════════════════════════════════════════════════════════════════════ */

/** Kalıcı kayıt şeması — alan eklendiğinde/anlamı değiştiğinde ARTIRILIR. */
export const COMPANION_SCHEMA_VERSION = 1;

/** Bu derlemenin konuştuğu wire protokol sürümü. */
export const COMPANION_PROTOCOL_VERSION = 1;
/** Kabul edilebilir EN ESKİ karşı taraf protokolü. */
export const COMPANION_MIN_PROTOCOL_VERSION = 1;

/** Envelope şema sürümü (protokol sürümünden AYRI eksen). */
export const COMPANION_ENVELOPE_SCHEMA_VERSION = 1;

export const MAX_CAPABILITIES = 64;
export const MAX_UNKNOWN_CAPABILITIES = 32;
export const MAX_TEXT_CHARS = 120;
export const MAX_PAYLOAD_CHARS = 8 * 1024;
export const MAX_TELEMETRY_SAMPLES = 32;
export const MAX_KNOWN_DEVICES = 8;

/* ══════════════════════════════════════════════════════════════════════════
 * Taşıma türleri — HİÇBİRİ UYGULANMADI
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Desteklenmesi PLANLANAN adapter tipleri. Bu fazda YALNIZ `MOCK` çalışır;
 * diğerleri için yalnızca sözleşme vardır — tek satır bağlantı kodu YOKTUR.
 */
export type CompanionTransportType =
  | 'UNKNOWN' | 'BLE' | 'RFCOMM' | 'USB' | 'WIFI_DIRECT' | 'TCP'
  | 'VENDOR_SERVICE' | 'MCU_BRIDGE' | 'MOCK';

export const COMPANION_TRANSPORT_TYPES: readonly CompanionTransportType[] = Object.freeze([
  'UNKNOWN', 'BLE', 'RFCOMM', 'USB', 'WIFI_DIRECT', 'TCP',
  'VENDOR_SERVICE', 'MCU_BRIDGE', 'MOCK',
]);

/**
 * Bu derlemede GERÇEKTEN uygulanmış taşımalar.
 * Bilinçli olarak yalnız `MOCK` — gerçek bağlantı P1-A'nın işidir.
 */
export const IMPLEMENTED_TRANSPORT_TYPES: readonly CompanionTransportType[] =
  Object.freeze(['MOCK']);

export function isTransportImplemented(t: CompanionTransportType): boolean {
  return IMPLEMENTED_TRANSPORT_TYPES.includes(t);
}

export function normalizeTransportType(v: unknown): CompanionTransportType {
  return typeof v === 'string' && (COMPANION_TRANSPORT_TYPES as readonly string[]).includes(v)
    ? (v as CompanionTransportType)
    : 'UNKNOWN';
}

export const TRANSPORT_TYPE_LABEL: Readonly<Record<CompanionTransportType, string>> = {
  UNKNOWN:        'BİLİNMİYOR',
  BLE:            'BLE',
  RFCOMM:         'RFCOMM',
  USB:            'USB',
  WIFI_DIRECT:    'Wi-Fi Direct',
  TCP:            'TCP',
  VENDOR_SERVICE: 'ÜRETİCİ SERVİSİ',
  MCU_BRIDGE:     'MCU KÖPRÜSÜ',
  MOCK:           'MOCK (test)',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Karşı taraf rolü — VARSAYIM YOK
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bağlanan CİHAZIN rolü. P0.8'in `DeviceRole`'ünden AYRIDIR: orada "bu cihaz
 * head unit mi" sorulur, burada "karşı taraf ne" sorulur. Kanıt yoksa UNKNOWN.
 */
export type CompanionPeerRole = 'UNKNOWN' | 'PHONE' | 'HEAD_UNIT' | 'COMPANION_APP' | 'OTHER';

export const COMPANION_PEER_ROLES: readonly CompanionPeerRole[] = Object.freeze([
  'UNKNOWN', 'PHONE', 'HEAD_UNIT', 'COMPANION_APP', 'OTHER',
]);

export function normalizePeerRole(v: unknown): CompanionPeerRole {
  return typeof v === 'string' && (COMPANION_PEER_ROLES as readonly string[]).includes(v)
    ? (v as CompanionPeerRole)
    : 'UNKNOWN';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yetenekler
 * ════════════════════════════════════════════════════════════════════════ */

export type CompanionCapability =
  | 'MEDIA' | 'CALLS' | 'CONTACTS' | 'SMS' | 'FILES' | 'PHOTOS' | 'VIDEO'
  | 'NOTIFICATIONS' | 'VOICE' | 'AUDIO_STREAM' | 'TEXT_REPLY'
  | 'BACKGROUND_SYNC' | 'HEALTH';

export const COMPANION_CAPABILITIES: readonly CompanionCapability[] = Object.freeze([
  'MEDIA', 'CALLS', 'CONTACTS', 'SMS', 'FILES', 'PHOTOS', 'VIDEO',
  'NOTIFICATIONS', 'VOICE', 'AUDIO_STREAM', 'TEXT_REPLY',
  'BACKGROUND_SYNC', 'HEALTH',
]);

const CAPABILITY_SET: ReadonlySet<string> = new Set<string>(COMPANION_CAPABILITIES);

export function isKnownCapability(v: unknown): v is CompanionCapability {
  return typeof v === 'string' && CAPABILITY_SET.has(v);
}

/**
 * Yetenek jetonu — bilinen enum VEYA karşı tarafın gönderdiği bilinmeyen dize.
 * Bilinmeyen jeton DÜŞÜRÜLMEZ; ayrı listede taşınır (ileri uyumluluk).
 */
export type CapabilityToken = string;

/** Jeton biçimi geçerli mi (ad alanı kirliliğine karşı bounded). */
export function isValidCapabilityToken(v: unknown): v is CapabilityToken {
  return typeof v === 'string'
    && v.length > 0 && v.length <= 48
    && /^[A-Z][A-Z0-9_.:-]*$/.test(v);
}

export const CAPABILITY_LABEL: Readonly<Record<CompanionCapability, string>> = {
  MEDIA:           'Medya',
  CALLS:           'Çağrılar',
  CONTACTS:        'Kişiler',
  SMS:             'SMS',
  FILES:           'Dosyalar',
  PHOTOS:          'Fotoğraflar',
  VIDEO:           'Video',
  NOTIFICATIONS:   'Bildirimler',
  VOICE:           'Ses (asistan)',
  AUDIO_STREAM:    'Ses akışı',
  TEXT_REPLY:      'Metin yanıtı',
  BACKGROUND_SYNC: 'Arka plan eşitleme',
  HEALTH:          'Sağlık',
} as const;

/**
 * GİZLİLİK SINIFI: bu yetenek etkinleştiğinde AKACAK verinin hassaslığı.
 * Foundation bu bilgiyi taşır ama HİÇBİR yeteneği ETKİNLEŞTİRMEZ — P1-A'da
 * kullanıcı onayı kapısı bu sınıfa göre kurulacak.
 */
export type CapabilityPrivacyClass = 'LOW' | 'MEDIUM' | 'HIGH' | 'SENSITIVE';

export const CAPABILITY_PRIVACY: Readonly<Record<CompanionCapability, CapabilityPrivacyClass>> = {
  MEDIA:           'LOW',
  CALLS:           'HIGH',
  CONTACTS:        'SENSITIVE',
  SMS:             'SENSITIVE',
  FILES:           'HIGH',
  PHOTOS:          'SENSITIVE',
  VIDEO:           'HIGH',
  NOTIFICATIONS:   'SENSITIVE',
  VOICE:           'MEDIUM',
  AUDIO_STREAM:    'LOW',
  TEXT_REPLY:      'SENSITIVE',
  BACKGROUND_SYNC: 'MEDIUM',
  HEALTH:          'HIGH',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Hata kodları — SABİT ENUM (serbest metin YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export type CompanionErrorCode =
  | 'TRANSPORT_NOT_IMPLEMENTED'
  | 'TRANSPORT_UNAVAILABLE'
  | 'TRANSPORT_OPEN_FAILED'
  | 'TRANSPORT_SEND_FAILED'
  | 'INVALID_STATE_TRANSITION'
  | 'HANDSHAKE_TIMEOUT'
  | 'HEARTBEAT_TIMEOUT'
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'ENVELOPE_MALFORMED'
  | 'ENVELOPE_SCHEMA_UNSUPPORTED'
  | 'CHECKSUM_MISMATCH'
  | 'PAYLOAD_TOO_LARGE'
  | 'COMPRESSION_UNSUPPORTED'
  | 'ENCRYPTION_UNSUPPORTED'
  | 'CAPABILITY_TOKEN_INVALID'
  /* ARCH-05: kontrol komutu için AÇIK yetenek izni yok. Jeton biçimi geçerli
     olabilir (`CAPABILITY_TOKEN_INVALID` ondan AYRIDIR); burada eksik olan
     İZNİN KENDİSİDİR. */
  | 'CAPABILITY_NOT_GRANTED'
  | 'SESSION_GENERATION_STALE'
  | 'SESSION_NOT_ACTIVE'
  | 'PAIRING_NOT_TRUSTED'
  | 'PAIRING_RECORD_MISSING'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_READ_FAILED'
  | 'UNKNOWN';

export const COMPANION_ERROR_LABEL: Readonly<Record<CompanionErrorCode, string>> = {
  TRANSPORT_NOT_IMPLEMENTED:   'Taşıma bu derlemede uygulanmadı',
  TRANSPORT_UNAVAILABLE:       'Taşıma kullanılamıyor',
  TRANSPORT_OPEN_FAILED:       'Taşıma açılamadı',
  TRANSPORT_SEND_FAILED:       'Gönderim başarısız',
  INVALID_STATE_TRANSITION:    'Geçersiz durum geçişi reddedildi',
  HANDSHAKE_TIMEOUT:           'El sıkışma zaman aşımı',
  HEARTBEAT_TIMEOUT:           'Kalp atışı kaybı',
  PROTOCOL_VERSION_MISMATCH:   'Protokol sürümü uyuşmuyor',
  ENVELOPE_MALFORMED:          'Zarf bozuk',
  ENVELOPE_SCHEMA_UNSUPPORTED: 'Zarf şeması desteklenmiyor',
  CHECKSUM_MISMATCH:           'Sağlama toplamı uyuşmuyor',
  PAYLOAD_TOO_LARGE:           'Yük tavanı aşıldı',
  COMPRESSION_UNSUPPORTED:     'Sıkıştırma desteklenmiyor',
  ENCRYPTION_UNSUPPORTED:      'Şifreleme desteklenmiyor',
  CAPABILITY_TOKEN_INVALID:    'Yetenek jetonu geçersiz',
  CAPABILITY_NOT_GRANTED:      'Bu komut için yetenek izni verilmedi',
  SESSION_GENERATION_STALE:    'Bayat oturum nesli reddedildi',
  SESSION_NOT_ACTIVE:          'Aktif oturum yok',
  PAIRING_NOT_TRUSTED:         'Eşleştirme güvenilir değil',
  PAIRING_RECORD_MISSING:      'Eşleştirme kaydı yok',
  STORAGE_WRITE_FAILED:        'Yerel kayıt yazılamadı',
  STORAGE_READ_FAILED:         'Yerel kayıt okunamadı',
  UNKNOWN:                     'Bilinmiyor',
} as const;

export function companionErrorLabel(code: string): string {
  return (COMPANION_ERROR_LABEL as Record<string, string>)[code] ?? code;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ortak yardımcılar (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

/** Metin tavanı — bounded, ASLA throw etmez. */
export function clampText(v: unknown, max = MAX_TEXT_CHARS): string {
  const s = typeof v === 'string' ? v : String(v ?? '');
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * FNV-1a 32-bit hex — deterministik, geri çevrilemez KISA özet.
 * Kriptografik DEĞİLDİR ve öyle sunulmaz; amacı cihaz/mesaj eşleştirmektir.
 */
export function fnv1aHex(v: string): string {
  if (typeof v !== 'string' || v.length === 0) return '00000000';
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Kararlı (anahtar sıralı) JSON — sağlama toplamı için ŞART. `JSON.stringify`
 * anahtar sırasını korur ama nesne oluşturma sırası değişirse toplam değişir;
 * bu fonksiyon sırayı normalize eder. Döngü/derinlik güvenli, ASLA throw etmez.
 */
export function stableStringify(v: unknown, depth = 0, seen?: Set<object>): string {
  if (depth > 12) return '"[DEPTH]"';
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v as number) ? JSON.stringify(v) : 'null';
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(v);
  if (t !== 'object') return 'null';

  const obj = v as object;
  const guard = seen ?? new Set<object>();
  if (guard.has(obj)) return '"[CYCLE]"';
  guard.add(obj);

  try {
    if (Array.isArray(v)) {
      const parts: string[] = [];
      for (let i = 0; i < v.length && i < 256; i++) parts.push(stableStringify(v[i], depth + 1, guard));
      return `[${parts.join(',')}]`;
    }
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    const parts: string[] = [];
    for (const k of keys) {
      if (rec[k] === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${stableStringify(rec[k], depth + 1, guard)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    guard.delete(obj);
  }
}
