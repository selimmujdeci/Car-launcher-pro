/**
 * phoneHubLinkModel.ts — Phone Hub GERÇEK BAĞLANTI tanı modeli (P1-A · SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok (zaman DAİMA parametre) ·
 * global durum yok · React importu YOK. Import yan etkisizdir.
 *
 * ── GÖZLEMLENEBİLİRLİK SÖZLEŞMESİ ───────────────────────────────────────────
 * Sınıflandırma `sessionInspectorModel`'in OBSERVED · DERIVED · UNAVAILABLE ·
 * STALE sözleşmesini KULLANIR. Paralel bir sistem KURULMAZ (CLAUDE.md kuralı).
 *
 * ── KANITSIZ BİLGİ ÜRETİLMEZ ────────────────────────────────────────────────
 * Native okunamadıysa TÜM alanlar UNAVAILABLE olur. "0 çerçeve", "sağlıklı",
 * "bağlı değil" gibi görünüşte masum varsayılanlar SAHTE KANITTIR: kullanıcı
 * bunları ölçülmüş sanır. Ölçülmemiş her şey açıkça KAYNAK YOK'tur.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Doğrulama kodu · oturum anahtarı · nonce · MAC · cihaz adı · ham yük bu
 * modele GİRMEZ ve giremez (testle kilitli). Eş kimliği yalnız KISALTILMIŞ
 * parmak izi olarak görünür.
 */

import {
  derived, observed, unavailable,
  type InspectorField,
} from './sessionInspectorModel';
import type {
  PhoneHubLinkSnapshotRaw, PhoneHubLinkSessionRaw, PhoneHubLinkDiagnosticEventRaw,
} from '../phoneHub/phoneHubLink';

/* ══════════════════════════════════════════════════════════════════════════
 * Bölümler
 * ════════════════════════════════════════════════════════════════════════ */

export type PhoneHubLinkSectionId =
  | 'server' | 'session' | 'security' | 'counters' | 'obd' | 'events';

export const PHONE_HUB_LINK_SECTION_ORDER: readonly PhoneHubLinkSectionId[] = [
  'server', 'session', 'security', 'counters', 'obd', 'events',
] as const;

export const PHONE_HUB_LINK_SECTION_TITLE:
  Readonly<Record<PhoneHubLinkSectionId, string>> = {
  server:   'SUNUCU VE ÖN KOŞULLAR',
  session:  'OTURUM VE ANLAŞMA',
  security: 'GÜVENLİK VE GÜVEN',
  counters: 'SAYAÇLAR VE KUYRUK',
  obd:      'OBD EŞZAMANLILIK',
  events:   'TANI OLAYLARI',
} as const;

export interface PhoneHubLinkSection {
  readonly id: PhoneHubLinkSectionId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export interface PhoneHubLinkEventRow {
  readonly id: string;
  readonly timestamp: number;
  readonly side: string;
  readonly category: string;
  readonly stage: string;
  readonly code: string;
  readonly severity: string;
  readonly generation: number;
  readonly details: string;
}

export interface PhoneHubLinkView {
  /** Native okunabildi mi — false ise HER ŞEY KAYNAK YOK. */
  readonly present: boolean;
  /** Tek satırlık dürüst özet (ekranın tepesi). */
  readonly headline: string;
  /** Şifreli oturum GERÇEKTEN kurulu mu — tek kabul edilebilir "bağlı" ölçütü. */
  readonly trulyEstablished: boolean;
  readonly awaitingUserConfirmation: boolean;
  readonly sections: readonly PhoneHubLinkSection[];
  readonly events: readonly PhoneHubLinkEventRow[];
  readonly droppedEventCount: number;
  readonly redactedEventCount: number;
  /** Saha ölçümü bekleyen konular — kod okumasıyla kapatılamaz. */
  readonly fieldTestRequired: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

export const MAX_EVENT_ROWS = 50;

const SRC_NATIVE = 'PhoneHubLinkPlugin.getSnapshot';
const SRC_SESSION = 'LinkSession.snapshot';
const SRC_SERVER = 'RfcommServerTransport';
const SRC_TRUST = 'PhoneHubTrustStore';

/** Ölçülmemiş süre işareti — native sözleşmesinde -1'dir, 0 DEĞİL. */
const UNMEASURED = -1;

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** -1 (ölçülmedi) ile gerçek 0'ı AYIRIR — sahte sıfır yasağı. */
function _measured(v: unknown): number | null {
  const n = _num(v);
  return n === null || n === UNMEASURED ? null : n;
}

function _bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function _str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function _yesNo(v: boolean | null): string | null {
  return v === null ? null : v ? 'EVET' : 'HAYIR';
}

function _ms(v: number | null): string | null {
  return v === null ? null : `${v} ms`;
}

/** Parmak izi KISALTILIR — tam değer ekrana çıkmaz. */
function _shortFingerprint(v: unknown): string | null {
  const s = _str(v);
  return s === null ? null : `${s.slice(0, 8)}…`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bölüm kurucular
 * ════════════════════════════════════════════════════════════════════════ */

function _serverSection(raw: PhoneHubLinkSnapshotRaw, present: boolean): PhoneHubLinkSection {
  const s = raw.server ?? {};
  const p = raw.preconditions ?? {};
  const f: InspectorField[] = [];

  const push = (
    id: string, label: string, value: unknown, note: string, source = SRC_SERVER,
  ): void => {
    f.push(present
      ? observed({ id, label, source, note }, value)
      : unavailable({ id, label, source, note }, 'Native köprü okunamadı.'));
  };

  push('server-state', 'Sunucu durumu', _str(s.state),
    'RFCOMM dinleyicisinin kendi beyanı.');
  push('server-running', 'Dinlemede', _yesNo(_bool(s.running)),
    'Dinleme soketi açık mı.');
  push('server-listen-started', 'Dinleme başlangıcı', _measured(s.listenStartedAtMs),
    'Monoton saat damgası; ölçülmediyse KAYNAK YOK.');
  push('server-accepted', 'Kabul edilen bağlantı', _num(s.acceptedCount),
    'Kaç kez istemci kabul edildi.');
  push('server-rejected-second', 'Reddedilen ikinci istemci',
    _num(s.rejectedSecondClient),
    'Aynı anda tek oturum kuralı gereği reddedilen bağlantı sayısı.');
  push('server-active-socket', 'Aktif soket var', _yesNo(_bool(s.hasActiveSocket)),
    'Dinleme soketinden AYRI tutulan aktif bağlantı.');
  push('server-error', 'Sunucu hata kodu', _str(s.lastErrorCode),
    'Sabit hata kodu; ham exception metni TAŞINMAZ.');

  push('pre-ready', 'Ön koşullar sağlandı', _yesNo(_bool(p.ready)),
    'Her çağrıda yeniden ölçülür, önbelleğe alınmaz.', SRC_NATIVE);
  push('pre-blocker', 'Engelleyen koşul', _str(p.blockerCode),
    'Bluetooth yok/kapalı veya izin eksikse kodu burada görünür.', SRC_NATIVE);
  push('pre-permission', 'BLUETOOTH_CONNECT izni', _yesNo(_bool(p.connectPermission)),
    'API 31+ runtime izni; eski sürümlerde manifest izni yeterlidir.', SRC_NATIVE);

  push('uuid-distinct', 'UUID OBD SPP\'den farklı',
    _yesNo(_bool(raw.uuidDistinctFromObdSpp)),
    'Phone Hub kendi ad alanını kullanır; OBD\'nin SPP UUID\'si DEĞİL.', SRC_NATIVE);

  return { id: 'server', title: PHONE_HUB_LINK_SECTION_TITLE.server, fields: f };
}

function _sessionSection(raw: PhoneHubLinkSnapshotRaw, present: boolean): PhoneHubLinkSection {
  const s: PhoneHubLinkSessionRaw = raw.session ?? {};
  const hasSession = present && !!raw.session;
  const f: InspectorField[] = [];

  const push = (
    id: string, label: string, value: unknown, note: string, source = SRC_SESSION,
  ): void => {
    f.push(hasSession
      ? observed({ id, label, source, note }, value)
      : unavailable({ id, label, source, note },
        present ? 'Aktif oturum yok.' : 'Native köprü okunamadı.'));
  };

  push('session-state', 'Oturum durumu', _str(s.state),
    'LinkSession durum makinesinin kendi değeri.');
  push('session-generation', 'Oturum nesli', _num(s.generation),
    'Her bağlantı denemesinde artar; bayat çağrılar bu değere göre reddedilir.');
  push('session-stage', 'El sıkışma aşaması', _str(s.handshakeStage),
    'Hangi adımda kalındığı — arıza yerini gösterir.');
  push('session-started', 'Bağlantı başlangıcı', _measured(s.startedAtMs),
    'Monoton damga.');
  push('session-established', 'Kurulma zamanı', _measured(s.establishedAtMs),
    'Şifreli oturumun kurulduğu an.');
  push('session-negotiation', 'Anlaşma süresi', _ms(_measured(s.negotiationDurationMs)),
    'Kurulmadıysa ölçülmemiştir (-1) → KAYNAK YOK.');
  push('session-last-inbound', 'Son gelen veri yaşı', _ms(_measured(s.lastInboundAgeMs)),
    'Kalp atışı sağlığının temel girdisi.');
  push('session-protocol', 'Protokol sürümü',
    _measured(s.protocolVersion) === null ? null : String(s.protocolVersion),
    'İki ucun anlaştığı sürüm.');
  push('session-peer-app', 'Karşı taraf sürümü', _str(s.peerAppVersion),
    'Telefon uygulamasının bildirdiği sürüm.');
  push('session-peer-fp', 'Karşı taraf kimliği', _shortFingerprint(s.peerFingerprint),
    'Kısaltılmış parmak izi; ham açık anahtar GÖSTERİLMEZ.');
  push('session-granted-count', 'Verilen yetenek sayısı',
    Array.isArray(s.grantedCapabilities) ? s.grantedCapabilities.length : null,
    'Bu fazda yalnız HEALTH verilebilir.');
  push('session-granted-list', 'Verilen yetenekler',
    Array.isArray(s.grantedCapabilities) && s.grantedCapabilities.length > 0
      ? s.grantedCapabilities.join(', ') : null,
    'Bağlantı kurulmuş olması MEDIA/CALLS yetkisi verildiği anlamına GELMEZ.');
  push('session-awaiting', 'Kullanıcı onayı bekleniyor',
    _yesNo(_bool(s.awaitingUserConfirm)),
    'Doğrulama kodunun KENDİSİ burada GÖSTERİLMEZ.');
  push('session-trust-skipped', 'Güvenilen cihaz kısa yolu',
    _yesNo(_bool(s.trustSkipped)),
    'Parmak izi eşleştiği için onay atlandı; imza yine doğrulandı.');
  push('session-reader', 'Okuma iş parçacığı canlı', _yesNo(_bool(s.readerAlive)),
    'Kapanış sonrası CANLI görünüyorsa sızıntı vardır.');
  push('session-writer', 'Yazma iş parçacığı canlı', _yesNo(_bool(s.writerAlive)),
    'Kapanış sonrası CANLI görünüyorsa sızıntı vardır.');
  push('session-disconnect-reason', 'Kopma nedeni', _str(s.disconnectReasonCode),
    'Kasıtlı kapanma ile beklenmeyen kopma AYRI kodlardır.');
  push('session-last-error', 'Son hata kodu', _str(s.lastErrorCode),
    'Sabit kod; ham hata metni taşınmaz.');

  return { id: 'session', title: PHONE_HUB_LINK_SECTION_TITLE.session, fields: f };
}

function _securitySection(raw: PhoneHubLinkSnapshotRaw, present: boolean): PhoneHubLinkSection {
  const s: PhoneHubLinkSessionRaw = raw.session ?? {};
  const t = raw.trust ?? {};
  const identity = raw.identity ?? {};
  const hasSession = present && !!raw.session;
  const f: InspectorField[] = [];

  const push = (
    id: string, label: string, value: unknown, note: string,
    source: string, available: boolean,
  ): void => {
    f.push(available
      ? observed({ id, label, source, note }, value)
      : unavailable({ id, label, source, note },
        present ? 'Bu bilgi için aktif kaynak yok.' : 'Native köprü okunamadı.'));
  };

  push('sec-encryption', 'Şifreleme etkin', _yesNo(_bool(s.encryptionActive)),
    'AES-256-GCM oturum anahtarı kurulu mu. Soketin açık olması YETMEZ.',
    SRC_SESSION, hasSession);
  push('sec-truly-established', 'Gerçekten kurulu',
    _yesNo(_bool(s.trulyEstablished)),
    '"Bağlandı" demenin TEK kabul edilebilir ölçütü.', SRC_SESSION, hasSession);
  push('sec-decrypt-failures', 'Şifre çözme hatası', _num(s.decryptFailures),
    'GCM etiketi tutmayan çerçeve sayısı — güvenlik olayıdır.',
    SRC_SESSION, hasSession);
  push('sec-replay', 'Tekrar reddi', _num(s.replayRejections),
    'Sayaç gerilemesi veya yinelenen kimlik nedeniyle reddedilenler.',
    SRC_SESSION, hasSession);

  push('sec-identity', 'Kimlik anahtarı var', _yesNo(_bool(identity.hasIdentity)),
    'Keystore\'da kimlik anahtarı üretildi mi. Anahtarın KENDİSİ okunamaz.',
    SRC_NATIVE, present);
  push('sec-hardware', 'Donanım destekli kimlik', _yesNo(_bool(identity.hardwareBacked)),
    'Ölçülemezse HAYIR gösterilir — "muhtemelen TEE" diye YÜKSELTİLMEZ.',
    SRC_NATIVE, present);

  push('trust-has-peer', 'Güvenilen telefon var', _yesNo(_bool(t.hasTrustedPeer)),
    'Kullanıcı onayından sonra yazılan kalıcı kayıt.', SRC_TRUST, present);
  push('trust-fingerprint', 'Güvenilen kimlik', _shortFingerprint(t.peerFingerprint),
    'Kısaltılmış parmak izi; MAC ve cihaz adı SAKLANMAZ.', SRC_TRUST, present);
  push('trust-last-connected', 'Son başarılı bağlantı', _measured(t.lastConnectedAtMs),
    'Hiç bağlanılmadıysa KAYNAK YOK (sahte 1970 damgası yazılmaz).',
    SRC_TRUST, present);
  push('trust-connect-count', 'Bağlantı sayısı', _num(t.connectCount),
    'Güven kaydındaki toplam başarılı bağlantı.', SRC_TRUST, present);

  return { id: 'security', title: PHONE_HUB_LINK_SECTION_TITLE.security, fields: f };
}

function _countersSection(raw: PhoneHubLinkSnapshotRaw, present: boolean): PhoneHubLinkSection {
  const s: PhoneHubLinkSessionRaw = raw.session ?? {};
  const hasSession = present && !!raw.session;
  const f: InspectorField[] = [];

  const push = (id: string, label: string, value: unknown, note: string): void => {
    f.push(hasSession
      ? observed({ id, label, source: SRC_SESSION, note }, value)
      : unavailable({ id, label, source: SRC_SESSION, note },
        present ? 'Aktif oturum yok.' : 'Native köprü okunamadı.'));
  };

  push('cnt-heartbeat', 'Kalp atışı gön/al',
    _num(s.heartbeatsSent) === null ? null
      : `${s.heartbeatsSent} / ${s.heartbeatsReceived}`,
    'Gönderilen ve alınan kalp atışı sayısı.');
  push('cnt-frames', 'Çerçeve gön/al',
    _num(s.framesSent) === null ? null : `${s.framesSent} / ${s.framesReceived}`,
    'Tel üzerindeki çerçeve sayısı.');
  push('cnt-bytes', 'Bayt gön/al',
    _num(s.bytesSent) === null ? null : `${s.bytesSent} / ${s.bytesReceived}`,
    'Ham bayt toplamı — İÇERİK taşınmaz.');
  push('cnt-app-messages', 'Uygulama mesajı alındı', _num(s.appMessagesReceived),
    'Bu fazda mesajlar SAYILIR ama YÜRÜTÜLMEZ.');
  push('cnt-queue', 'Yazma kuyruğu',
    _num(s.writeQueueDepth) === null ? null
      : `${s.writeQueueDepth} / ${s.writeQueueCapacity}`,
    'Kuyruk SINIRLIDIR; dolarsa mesaj düşer ve raporlanır.');
  push('cnt-queue-rejections', 'Kuyruk taşma reddi', _num(s.writeQueueRejections),
    'Sessizce biriktirmek yerine düşürülen mesaj sayısı.');
  push('cnt-checksum', 'Sağlama hatası', _num(s.checksumFailures),
    'CRC32 tutmayan çerçeve — hat gürültüsü göstergesi.');
  push('cnt-malformed', 'Bozuk çerçeve', _num(s.malformedFrames),
    'Tek bozuk çerçeve bağlantıyı ÖLDÜRMEZ; ısrar öldürür.');
  push('cnt-oversize', 'Tavan aşımı reddi', _num(s.oversizeRejections),
    'Beyan edilen uzunluk tavanı aşan çerçeveler.');
  push('cnt-resync', 'Yeniden hizalama', _num(s.resyncEvents),
    'Akış kaydığında magic aranması — sınırlıdır.');
  push('cnt-unknown-type', 'Bilinmeyen tür düşürüldü', _num(s.unknownTypeDropped),
    'İleri sürüm mesajı taşınır ama ÇALIŞTIRILMAZ.');

  return { id: 'counters', title: PHONE_HUB_LINK_SECTION_TITLE.counters, fields: f };
}

/**
 * OBD eşzamanlılık bölümü.
 *
 * Burada BİLEREK türetilmiş (DERIVED) tek bir alan vardır ve gerisi açıkça
 * FIELD_TEST_REQUIRED'dır: Phone Hub'ın OBD'ye kodda dokunmadığı testle
 * kanıtlanabilir, ama aynı Bluetooth adapter'ını paylaşmanın GERÇEK etkisi
 * ancak araçta ölçülür. Buraya iyimser bir "etkilenmiyor" yazmak sahte kanıt
 * olurdu.
 */
function _obdSection(raw: PhoneHubLinkSnapshotRaw, present: boolean): PhoneHubLinkSection {
  const f: InspectorField[] = [];

  f.push(present
    ? derived({
      id: 'obd-uuid-isolation', label: 'UUID ad alanı ayrımı',
      source: SRC_NATIVE,
      note: 'Kural: Phone Hub UUID\'si OBD SPP UUID\'sinden farklıysa yanlış '
        + 'servise bağlanma riski yoktur.',
    }, _yesNo(_bool(raw.uuidDistinctFromObdSpp)))
    : unavailable({
      id: 'obd-uuid-isolation', label: 'UUID ad alanı ayrımı',
      source: SRC_NATIVE, note: 'Native köprü okunamadı.',
    }));

  /* Değer alanı '—' KALIR: `unavailable()` sözleşmesi gereği ölçülmemiş bir
   * alana metin yazılmaz. FIELD_TEST_REQUIRED işareti NOTA konur — böylece
   * bir gün biri değeri okuyup "ölçüldü" sanamaz. */
  f.push(unavailable({
    id: 'obd-concurrency-effect', label: 'Eşzamanlılık etkisi',
    source: 'SAHA ÖLÇÜMÜ',
    note: 'FIELD_TEST_REQUIRED — Phone Hub bağlıyken OBD veri tazeliğinin '
      + 'bozulup bozulmadığı ancak gerçek araçta ölçülür. Kod izolasyonu '
      + 'bunu KANITLAMAZ.',
  }));

  f.push(unavailable({
    id: 'obd-accept-latency', label: 'Discovery sırasında accept gecikmesi',
    source: 'SAHA ÖLÇÜMÜ',
    note: 'FIELD_TEST_REQUIRED — OBD adapter geneli tarama başlattığında '
      + 'RFCOMM kabul süresinin uzayıp uzamadığı ölçülmedi.',
  }));

  return { id: 'obd', title: PHONE_HUB_LINK_SECTION_TITLE.obd, fields: f };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Olaylar
 * ════════════════════════════════════════════════════════════════════════ */

function _events(raw: PhoneHubLinkSnapshotRaw): PhoneHubLinkEventRow[] {
  const source = raw.diagnostics?.events;
  if (!Array.isArray(source)) return [];
  const out: PhoneHubLinkEventRow[] = [];
  for (let i = 0; i < source.length && out.length < MAX_EVENT_ROWS; i++) {
    const e: PhoneHubLinkDiagnosticEventRaw = source[i] ?? {};
    out.push({
      id: `evt-${i}`,
      timestamp: _num(e.t) ?? 0,
      side: _str(e.side) ?? 'UNKNOWN',
      category: _str(e.category) ?? 'UNKNOWN',
      stage: _str(e.stage) ?? '',
      code: _str(e.code) ?? '-',
      severity: _str(e.severity) ?? 'INFO',
      generation: _num(e.generation) ?? 0,
      details: _str(e.details) ?? '',
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ana kurucu
 * ════════════════════════════════════════════════════════════════════════ */

/** Ekranın tepesindeki tek satırlık DÜRÜST özet. */
export function buildHeadline(raw: PhoneHubLinkSnapshotRaw): string {
  if (!raw.present) return 'KAYNAK YOK — native Phone Hub köprüsü okunamadı';

  const session = raw.session;
  if (session?.trulyEstablished === true) {
    const count = Array.isArray(session.grantedCapabilities)
      ? session.grantedCapabilities.length : 0;
    return `ŞİFRELİ OTURUM KURULU — ${count} yetenek verildi`;
  }
  if (session?.awaitingUserConfirm === true) {
    return 'KULLANICI ONAYI BEKLENİYOR — kod iki ekranda karşılaştırılmalı';
  }
  if (session) return `OTURUM VAR AMA KURULMADI — ${session.state ?? 'BİLİNMİYOR'}`;

  const server = raw.server;
  if (server?.running === true) return 'DİNLEMEDE — henüz telefon bağlanmadı';

  const blocker = raw.preconditions?.blockerCode;
  if (typeof blocker === 'string' && blocker.length > 0) {
    return `SUNUCU BAŞLATILAMAZ — ${blocker}`;
  }
  return 'SUNUCU DURDURULMUŞ';
}

export function buildPhoneHubLinkView(raw: PhoneHubLinkSnapshotRaw): PhoneHubLinkView {
  const present = raw?.present === true;
  const session = present ? raw.session ?? null : null;

  const fieldTestRequired: string[] = [
    'Gerçek head unit üzerinde sunucu dinlemesi hiç ölçülmedi.',
    'Telefon + OBD eşzamanlılığı gerçek araçta gözlenmedi.',
    'Bluetooth kontrol otoritesi (control-plane) hâlâ UNKNOWN.',
  ];

  return {
    present,
    headline: buildHeadline(raw ?? { present: false }),
    trulyEstablished: session?.trulyEstablished === true,
    awaitingUserConfirmation: raw?.pairing?.awaitingConfirmation === true,
    sections: [
      _serverSection(raw, present),
      _sessionSection(raw, present),
      _securitySection(raw, present),
      _countersSection(raw, present),
      _obdSection(raw, present),
    ],
    events: present ? _events(raw) : [],
    droppedEventCount: _num(raw?.diagnostics?.dropped) ?? 0,
    redactedEventCount: _num(raw?.diagnostics?.redacted) ?? 0,
    fieldTestRequired,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * PII'siz dışa aktarım
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tanı JSON'u. Doğrulama kodu, anahtar, MAC ve cihaz adı ZATEN kaynakta
 * yoktur; burada ek olarak parmak izleri KISALTILIR ve olay ayrıntıları
 * olduğu gibi (native tarafta zaten süzülmüş hâliyle) taşınır.
 */
export function buildPhoneHubLinkExport(
  view: PhoneHubLinkView, nowMs: number,
): string {
  const payload = {
    tool: 'phone-hub-link-diagnostics',
    schemaVersion: 1,
    exportedAt: nowMs,
    present: view.present,
    headline: view.headline,
    trulyEstablished: view.trulyEstablished,
    fieldTestRequired: view.fieldTestRequired,
    sections: view.sections.map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.fields.map((field) => ({
        id: field.id,
        label: field.label,
        value: field.value,
        klass: field.klass,
        source: field.source,
      })),
    })),
    events: view.events,
    droppedEventCount: view.droppedEventCount,
    redactedEventCount: view.redactedEventCount,
  };
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '{"error":"EXPORT_SERIALIZE_FAILED"}';
  }
}
