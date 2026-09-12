/**
 * phoneHubUserModel.ts — Phone Hub KULLANICI ekranının saf modeli (P1-A · GÖREV 12).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok (zaman DAİMA parametre) ·
 * global durum yok · React importu YOK.
 *
 * ── LAB'DAN FARKI ───────────────────────────────────────────────────────────
 * CAROS LAB ekranı geliştiriciye HER ŞEYİ gösterir (sayaçlar, aşamalar, olay
 * defteri). Bu model son kullanıcıya YALNIZ karar verebilmesi için gerekli
 * olanı verir: bağlıyım/değilim, güvenli mi, ne yapmalıyım. İkisi aynı native
 * kaynaktan beslenir; ayrışan yalnız sunumdur.
 *
 * ── GÖSTERİLMEYENLER (PAZARLIKSIZ) ──────────────────────────────────────────
 * MAC · telefon numarası · kişi adı · ham açık anahtar · ham yük · oturum
 * anahtarı · stack trace. Bu model o alanlara ERİŞMEZ bile.
 */

import type { PhoneHubLinkSnapshotRaw } from './phoneHubLink';

/* ══════════════════════════════════════════════════════════════════════════
 * Durum
 * ════════════════════════════════════════════════════════════════════════ */

export type PhoneHubUserState =
  | 'NOT_CONNECTED'
  | 'WAITING_FOR_PHONE'
  | 'AWAITING_CODE_CONFIRMATION'
  | 'CONNECTED'
  | 'WEAK'
  | 'RECONNECTING'
  | 'ERROR';

export const PHONE_HUB_USER_STATE_LABEL:
  Readonly<Record<PhoneHubUserState, string>> = {
  NOT_CONNECTED:              'Telefon Bağlı Değil',
  WAITING_FOR_PHONE:          'Bağlantı Bekleniyor',
  AWAITING_CODE_CONFIRMATION: 'Doğrulama Kodu',
  CONNECTED:                  'Telefon Bağlandı',
  WEAK:                       'Bağlantı Zayıf',
  RECONNECTING:               'Yeniden Bağlanıyor',
  ERROR:                      'Hata',
} as const;

/**
 * Güven seviyesi.
 *
 * `TRUSTED` YALNIZ kullanıcı onayından sonra ve şifreli oturum kurulduğunda
 * verilir. Bluetooth eşleştirmesinin varlığı `PAIRED_ONLY`dir ve Phone Hub
 * güveni SAYILMAZ — bu ayrım ekranda da açıkça durur.
 */
export type PhoneHubTrustLevel = 'UNKNOWN' | 'PAIRED_ONLY' | 'VERIFIED' | 'TRUSTED';

export const PHONE_HUB_TRUST_LABEL:
  Readonly<Record<PhoneHubTrustLevel, string>> = {
  UNKNOWN:     'BİLİNMİYOR',
  PAIRED_ONLY: 'YALNIZ BLUETOOTH EŞLEŞMESİ',
  VERIFIED:    'BU OTURUMDA DOĞRULANDI',
  TRUSTED:     'GÜVENİLEN CİHAZ',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Sürüş güvenliği kapısı
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Araç hareket hükmü.
 *
 * `UNKNOWN` KRİTİKTİR: hız kaynağı yoksa "araç duruyor" VARSAYILMAZ. Bu
 * varsayım, sürüş sırasında kullanıcının ekrana kod karşılaştırmak için
 * bakmasına yol açardı. Bilinmiyorsa kullanıcı UYARILIR ve sorumluluk açıkça
 * ona bırakılır — sessizce izin verilmez.
 */
export type VehicleMotion = 'STOPPED' | 'MOVING' | 'UNKNOWN';

/** Bu hızın üstü "hareket ediyor" sayılır (km/h). GPS/OBD gürültüsünün üstü. */
export const MOTION_THRESHOLD_KMH = 3;

export function classifyMotion(freshSpeedKmh: number | null): VehicleMotion {
  if (freshSpeedKmh === null || !Number.isFinite(freshSpeedKmh)) return 'UNKNOWN';
  return freshSpeedKmh > MOTION_THRESHOLD_KMH ? 'MOVING' : 'STOPPED';
}

export type PairingGateVerdict = 'ALLOWED' | 'BLOCKED_MOVING' | 'ALLOWED_WITH_WARNING';

export const PAIRING_GATE_MESSAGE:
  Readonly<Record<PairingGateVerdict, string>> = {
  ALLOWED:
    'Araç duruyor. Kodu karşılaştırıp onaylayabilirsiniz.',
  BLOCKED_MOVING:
    'Araç hareket hâlinde. İlk eşleştirme güvenlik gereği kilitlendi — '
    + 'lütfen güvenli bir yerde durun.',
  ALLOWED_WITH_WARNING:
    'Araç hareket bilgisi GÜVENİLİR DEĞİL. Sistem "araç duruyor" varsaymaz. '
    + 'Sürüyorsanız bu işlemi yapmayın.',
} as const;

/**
 * İlk eşleştirme kapısı.
 *
 * Yalnız İLK eşleştirme (kullanıcı onayı gerektiren) kısıtlanır; zaten
 * güvenilen bir telefonun sessiz yeniden bağlanması sürüş sırasında da
 * serbesttir — kullanıcıdan hiçbir şey istemediği için dikkat dağıtmaz.
 */
export function evaluatePairingGate(motion: VehicleMotion): PairingGateVerdict {
  if (motion === 'MOVING') return 'BLOCKED_MOVING';
  if (motion === 'UNKNOWN') return 'ALLOWED_WITH_WARNING';
  return 'ALLOWED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Görünüm
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhoneHubUserView {
  readonly state: PhoneHubUserState;
  readonly stateLabel: string;
  readonly trust: PhoneHubTrustLevel;
  readonly trustLabel: string;
  /** Aktif taşıma adı; bilinmiyorsa null (sahte 'BLE' yazılmaz). */
  readonly transport: string | null;
  /** Son görülme yaşı (ms); ölçülmediyse null. */
  readonly lastSeenAgeMs: number | null;
  /** Anlaşılan protokol sürümü; yoksa null. */
  readonly protocolVersion: number | null;
  readonly grantedCapabilityCount: number | null;
  /** Telefon uygulamasının bildirdiği sürüm; yoksa null. */
  readonly peerAppVersion: string | null;
  readonly errorCode: string | null;
  readonly awaitingCodeConfirmation: boolean;
  readonly canDisconnect: boolean;
  readonly canForgetTrustedPhone: boolean;
  /** Native köprü hiç okunamadıysa false — ekran "KAYNAK YOK" der. */
  readonly present: boolean;
}

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function _str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Güven seviyesi hükmü.
 *
 * Sıra ÖNEMLİ: en güçlü iddia en son kanıtla verilir. Şifreli oturum yoksa
 * `TRUSTED` ASLA yazılmaz — kalıcı güven kaydının varlığı, ŞU AN güvenli bir
 * oturum olduğu anlamına gelmez.
 */
export function deriveTrustLevel(raw: PhoneHubLinkSnapshotRaw): PhoneHubTrustLevel {
  if (!raw?.present) return 'UNKNOWN';
  const session = raw.session;
  const established = session?.trulyEstablished === true;
  const trusted = raw.trust?.hasTrustedPeer === true;

  if (established && trusted) return 'TRUSTED';
  if (established) return 'VERIFIED';
  if (trusted) return 'PAIRED_ONLY';
  return 'UNKNOWN';
}

export function deriveUserState(raw: PhoneHubLinkSnapshotRaw): PhoneHubUserState {
  if (!raw?.present) return 'NOT_CONNECTED';

  if (raw.pairing?.awaitingConfirmation === true) return 'AWAITING_CODE_CONFIRMATION';

  const session = raw.session;
  if (session) {
    if (session.trulyEstablished === true) {
      return session.state === 'DEGRADED' ? 'WEAK' : 'CONNECTED';
    }
    if (session.state === 'FAILED') return 'ERROR';
    /* Oturum var ama kurulmadı → el sıkışma sürüyor demektir. */
    return 'RECONNECTING';
  }

  if (raw.server?.running === true) return 'WAITING_FOR_PHONE';
  if (_str(raw.preconditions?.blockerCode)) return 'ERROR';
  return 'NOT_CONNECTED';
}

export function buildPhoneHubUserView(raw: PhoneHubLinkSnapshotRaw): PhoneHubUserView {
  const present = raw?.present === true;
  const state = deriveUserState(raw ?? { present: false });
  const trust = deriveTrustLevel(raw ?? { present: false });
  const session = present ? raw.session ?? null : null;

  /* Taşıma: bu derlemede tek gerçek taşıma RFCOMM'dur ve YALNIZ bir oturum
   * varken beyan edilir. Oturum yokken "RFCOMM" yazmak, kurulmuş bir bağlantı
   * izlenimi verirdi. */
  const transport = session ? 'RFCOMM' : null;

  const errorCode = _str(session?.lastErrorCode)
    ?? _str(raw?.lastErrorCode)
    ?? _str(raw?.preconditions?.blockerCode);

  return {
    state,
    stateLabel: PHONE_HUB_USER_STATE_LABEL[state],
    trust,
    trustLabel: PHONE_HUB_TRUST_LABEL[trust],
    transport,
    lastSeenAgeMs: _num(session?.lastInboundAgeMs),
    protocolVersion: _num(session?.protocolVersion),
    grantedCapabilityCount: Array.isArray(session?.grantedCapabilities)
      ? session.grantedCapabilities.length : null,
    peerAppVersion: _str(session?.peerAppVersion),
    errorCode,
    awaitingCodeConfirmation: state === 'AWAITING_CODE_CONFIRMATION',
    canDisconnect: !!session,
    canForgetTrustedPhone: raw?.trust?.hasTrustedPeer === true,
    present,
  };
}
