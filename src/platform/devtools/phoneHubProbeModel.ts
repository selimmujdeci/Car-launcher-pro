/**
 * phoneHubProbeModel.ts — Phone Hub Hardware Probe SAF modeli (P0.5).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React importu yok.
 * Servis importu YOK — girdi YAPISALDIR (mock'suz test edilir).
 *
 * ── TEMEL İLKE: "BAĞLI GÖRÜNMEK" YETENEK DEĞİLDİR ───────────────────────────
 * A2DP/HFP CONNECTED görünmesi, CAROS'un o ses/çağrı yolunu KONTROL ETTİĞİNİ
 * KANITLAMAZ (vendor/MCU yığını da bağlamış olabilir). Bu yüzden bağlantı DURUMU
 * ile kontrol OTORİTESİ ayrı taşınır ve "destekleniyor" ifadesi YALNIZ
 * DEVICE_OBSERVED kanıt + ANDROID_APP otoritesi birlikteyken kullanılabilir.
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 * Girdi tipinde cihaz adı · MAC · kişi adı · telefon modeli · medya başlığı ·
 * bildirim içeriği · token · dosya yolu TAŞIYAN ALAN YOKTUR. Sızıntı tip olarak
 * imkânsızdır.
 */

import {
  observed, derived, unavailable, applyStaleness,
  type InspectorField, type Observability,
} from './sessionInspectorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

/** Bu eşikten eski gözlem STALE sayılır (donanım durumu hızlı değişir). */
export const PHONE_HUB_STALE_MS = 30_000;
export const MAX_FIELDS_PER_PH_SECTION = 24;
export const MAX_PH_REASONS = 8;

/** Kaynak güven sınıfı — `Observability`'den AYRI bir eksendir. */
export type SourceTrust =
  | 'CODE_OBSERVED' | 'DEVICE_OBSERVED' | 'VENDOR_DECLARED' | 'INFERRED' | 'UNKNOWN';

export const SOURCE_TRUST_LABEL: Readonly<Record<SourceTrust, string>> = {
  CODE_OBSERVED:   'KODDAN GÖZLENDİ',
  DEVICE_OBSERVED: 'CİHAZDAN GÖZLENDİ',
  VENDOR_DECLARED: 'ÜRETİCİ BEYANI',
  INFERRED:        'ÇIKARIM',
  UNKNOWN:         'BİLİNMİYOR',
} as const;

export type ControlAuthority =
  | 'UNKNOWN' | 'VENDOR_STACK' | 'MCU_STACK' | 'ANDROID_APP' | 'UNAVAILABLE';

export const AUTHORITY_LABEL: Readonly<Record<ControlAuthority, string>> = {
  UNKNOWN:      'BİLİNMİYOR',
  VENDOR_STACK: 'ÜRETİCİ YIĞINI',
  MCU_STACK:    'MCU YIĞINI',
  ANDROID_APP:  'ANDROID UYGULAMASI',
  UNAVAILABLE:  'KAYNAK YOK',
} as const;

export type CollisionLevel = 'NONE_OBSERVED' | 'POSSIBLE' | 'HIGH' | 'UNKNOWN';

export const COLLISION_LABEL: Readonly<Record<CollisionLevel, string>> = {
  NONE_OBSERVED: 'GÖZLENEN ÇAKIŞMA YOK',
  POSSIBLE:      'OLASI',
  HIGH:          'YÜKSEK',
  UNKNOWN:       'BİLİNMİYOR',
} as const;

/** Sabit gerekçe kodları — serbest metin YOK (native sözleşmesiyle aynı). */
export const COLLISION_REASON_LABEL: Readonly<Record<string, string>> = {
  OBD_CONNECTED_WITH_DISCOVERY:       'OBD bağlıyken Bluetooth keşfi aktif',
  OBD_POLLING_WITH_PHONE_PROFILE:     'OBD sorgulaması sürerken telefon profili bağlı',
  ADAPTER_RESET_IN_PROGRESS:          'Adaptör sıfırlama süreci devam ediyor',
  SIMULTANEOUS_PROFILE_STATE_UNKNOWN: 'Eşzamanlı profil durumu okunamıyor',
  BT_STATE_UNREADABLE:                'Bluetooth durumu okunamıyor',
} as const;

export type ProbeStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'STALE';

export const PROBE_STATUS_LABEL: Readonly<Record<ProbeStatus, string>> = {
  AVAILABLE:   'KANIT MEVCUT',
  UNAVAILABLE: 'KANIT YOK',
  STALE:       'BAYAT KANIT',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham girdi — YAPISAL tip
 * ════════════════════════════════════════════════════════════════════════ */

export interface PhNativeBluetooth {
  readonly adapterAvailable: boolean;
  readonly adapterEnabled: boolean;
  readonly adapterNamePresent: boolean;
  readonly permConnect: string;
  readonly permScan: string;
  readonly permLegacy: string;
  readonly discoveryActive: string;
  /** -1 = okunamadı (0 DEĞİL). */
  readonly bondedDeviceCount: number;
  readonly phoneLikeCount: number;
  readonly audioLikeCount: number;
  readonly obdLikeCandidateCount: number;
  readonly unknownClassCount: number;
  readonly evidence: string;
}

export interface PhNativeProfiles {
  readonly a2dpConnectionState: string;
  readonly headsetConnectionState: string;
  readonly gattConnectionState: string;
  readonly a2dpControlAuthority: string;
  readonly hfpControlAuthority: string;
  readonly evidence: string;
}

export interface PhNativeVendor {
  readonly knownVendorPackageDetected: boolean;
  readonly knownVendorBroadcastObserved: boolean;
  readonly vendorFamily: string;
  /** -1 = hiç gözlem yok (0 ms DEĞİL). */
  readonly lastEvidenceAgeMs: number;
  readonly evidence: string;
}

export interface PhNativeAudio {
  readonly audioMode: number;
  readonly musicActive: boolean;
  readonly communicationDeviceType: string;
  readonly routeAuthority: string;
  readonly evidence: string;
}

/** OBD tarafı — MEVCUT JS getter'larından gelir (native'e yeni kod eklenmedi). */
export interface PhObdRaw {
  readonly transport: string | null;
  readonly transportConnected: boolean;
  readonly pollingActive: boolean;
  readonly dataFresh: boolean;
  /** -1 = hiç paket yok (0 ms DEĞİL). */
  readonly lastPacketAgeMs: number;
  readonly resetInProgress: boolean;
}

export interface PhoneHubProbeRaw {
  readonly readAt: number;
  /** Native gözlem var mı (metot yok/patladı → false). */
  readonly present: boolean;
  readonly schemaVersion: number | null;
  /** Native duvar-saati damgası. 0/geçersiz → null ("şimdi" UYDURULMAZ). */
  readonly capturedAt: number | null;
  readonly platformApiLevel: number | null;
  readonly bluetooth: PhNativeBluetooth | null;
  readonly profiles: PhNativeProfiles | null;
  readonly vendor: PhNativeVendor | null;
  readonly audio: PhNativeAudio | null;
  readonly obd: PhObdRaw | null;
  readonly errors: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bölümler
 * ════════════════════════════════════════════════════════════════════════ */

export type PhSectionId =
  | 'status' | 'adapter' | 'profiles' | 'vendor' | 'audio' | 'obd' | 'restrictions';

export interface PhSection {
  readonly id: PhSectionId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export const PH_SECTION_TITLE: Readonly<Record<PhSectionId, string>> = {
  status:       '1 · Probe Durumu',
  adapter:      '2 · Bluetooth Adaptörü',
  profiles:     '3 · Bluetooth Profilleri',
  vendor:       '4 · Üretici / MCU Kanıtı',
  audio:        '5 · Ses Yolu',
  obd:          '6 · OBD Eşzamanlılığı',
  restrictions: '8 · Kısıtlamalar',
} as const;

const SRC = {
  native: 'CarLauncher.getPhoneHubHardwareProbe() (salt-okunur)',
  obd:    'obdService + ObdHealthMonitor (mevcut getter\'lar)',
  none:   'YOK',
} as const;

function _bound(f: readonly InspectorField[]): readonly InspectorField[] {
  return f.length <= MAX_FIELDS_PER_PH_SECTION ? f : f.slice(0, MAX_FIELDS_PER_PH_SECTION);
}

/* ── Probe durumu ─────────────────────────────────────────────────────────── */

/**
 * KURAL: native kanıt yoksa UNAVAILABLE · damga varsa ve eşikten eskiyse STALE ·
 * aksi hâlde AVAILABLE. Damga yoksa AVAILABLE denmez (yaş doğrulanamaz) → STALE.
 */
export function deriveProbeStatus(s: PhoneHubProbeRaw): ProbeStatus {
  if (!s || !s.present) return 'UNAVAILABLE';
  if (s.capturedAt === null) return 'STALE';
  const age = s.readAt - s.capturedAt;
  return age > PHONE_HUB_STALE_MS ? 'STALE' : 'AVAILABLE';
}

function _statusSection(s: PhoneHubProbeRaw): PhSection {
  const f: InspectorField[] = [];
  const status = deriveProbeStatus(s);

  f.push(derived(
    { id: 'phStatus', label: 'probe durumu', source: SRC.native,
      note: `KURAL: kanıt yok → KANIT YOK · damga yok veya ${Math.round(PHONE_HUB_STALE_MS / 1000)}sn'den eski → BAYAT.` },
    PROBE_STATUS_LABEL[status],
  ));

  f.push(s.capturedAt !== null
    ? applyStaleness(observed(
        { id: 'phCapturedAt', label: 'gözlem damgası', source: SRC.native,
          note: 'Native duvar-saati damgası.', updatedAt: s.capturedAt },
        new Date(s.capturedAt).toISOString(),
      ), s.readAt, PHONE_HUB_STALE_MS)
    : unavailable({ id: 'phCapturedAt', label: 'gözlem damgası', source: SRC.native, note: '' },
        'Damga yok — "şimdi" UYDURULMAZ.'));

  f.push(s.platformApiLevel !== null && s.platformApiLevel > 0
    ? observed({ id: 'phApiLevel', label: 'Android API seviyesi', source: SRC.native,
        note: 'Build.VERSION.SDK_INT.' }, s.platformApiLevel)
    : unavailable({ id: 'phApiLevel', label: 'Android API seviyesi', source: SRC.native, note: '' },
        'Okunamadı.'));

  f.push(s.schemaVersion !== null
    ? observed({ id: 'phSchema', label: 'şema sürümü', source: SRC.native,
        note: 'Snapshot sözleşme sürümü — alan kayması görünür olsun diye.' }, s.schemaVersion)
    : unavailable({ id: 'phSchema', label: 'şema sürümü', source: SRC.native, note: '' }, 'Okunamadı.'));

  f.push(observed(
    { id: 'phErrorCount', label: 'sınıflandırılmış hata adedi', source: SRC.native,
      note: 'Fail-soft yakalanan okuma hataları (yığın izi/dosya yolu TAŞIMAZ).' },
    s.errors.length,
  ));

  return { id: 'status', title: PH_SECTION_TITLE.status, fields: _bound(f) };
}

/* ── Adapter ──────────────────────────────────────────────────────────────── */

function _adapterSection(s: PhoneHubProbeRaw): PhSection {
  const f: InspectorField[] = [];
  const bt = s.bluetooth;

  if (!bt) {
    f.push(unavailable({ id: 'phAdapter', label: 'adaptör durumu', source: SRC.native, note: '' },
      'Native gözlem yok — "adaptör yok" VARSAYILMAZ.'));
    return { id: 'adapter', title: PH_SECTION_TITLE.adapter, fields: _bound(f) };
  }

  f.push(observed({ id: 'phAdapterAvailable', label: 'adaptör var', source: SRC.native,
    note: 'BluetoothAdapter.getDefaultAdapter() null değil mi.' }, bt.adapterAvailable));
  f.push(observed({ id: 'phAdapterEnabled', label: 'adaptör açık', source: SRC.native,
    note: 'isEnabled(). Kapalıyken profil durumu OKUNAMAZ (bağlı değil DEMEK DEĞİLDİR).' },
    bt.adapterEnabled));
  f.push(observed({ id: 'phAdapterName', label: 'adaptör adı kayıtlı', source: SRC.native,
    note: 'GİZLİLİK: adın KENDİSİ taşınmaz — yalnız varlığı.' },
    bt.adapterNamePresent ? 'VAR (gösterilmez)' : 'YOK'));
  f.push(observed({ id: 'phPermConnect', label: 'BLUETOOTH_CONNECT izni', source: SRC.native,
    note: 'API 31 öncesinde bu izin YOKTUR → UYGULANMAZ (reddedildi DEĞİL).' }, bt.permConnect));
  f.push(observed({ id: 'phPermScan', label: 'BLUETOOTH_SCAN izni', source: SRC.native,
    note: 'İzin VARLIĞI runtime yeteneği KANITLAMAZ. Bu ekran tarama YAPMAZ.' }, bt.permScan));
  f.push(observed({ id: 'phPermLegacy', label: 'BLUETOOTH (eski) izni', source: SRC.native,
    note: 'API 31+ için UYGULANMAZ.' }, bt.permLegacy));
  f.push(observed({ id: 'phDiscovery', label: 'keşif (discovery) durumu', source: SRC.native,
    note: 'isDiscovering() SALT OKUNUR — bu ekran keşif BAŞLATMAZ. Okunamazsa BİLİNMİYOR.' },
    bt.discoveryActive));

  f.push(bt.bondedDeviceCount >= 0
    ? observed({ id: 'phBonded', label: 'eşleşmiş cihaz adedi', source: SRC.native,
        note: 'Eşleşmiş olmak AKTİF BAĞLANTI DEMEK DEĞİLDİR.' }, bt.bondedDeviceCount)
    : unavailable({ id: 'phBonded', label: 'eşleşmiş cihaz adedi', source: SRC.native, note: '' },
        'Okunamadı (izin/güvenlik) — 0 GÖSTERİLMEZ.'));

  f.push(bt.phoneLikeCount >= 0
    ? observed({ id: 'phClassCounts', label: 'anonim sınıf sayımı', source: SRC.native,
        note: 'telefon / ses / OBD-adayı / bilinmeyen. Cihaz ADI ve MAC HİÇ okunmaz; sınıflandırma yalnız BluetoothClass major baytındandır.' },
        `${bt.phoneLikeCount} / ${bt.audioLikeCount} / ${bt.obdLikeCandidateCount} / ${bt.unknownClassCount}`)
    : unavailable({ id: 'phClassCounts', label: 'anonim sınıf sayımı', source: SRC.native, note: '' },
        'Okunamadı.'));

  f.push(derived(
    { id: 'phObdCandidateNote', label: 'OBD adayı çıkarımı', source: `${SRC.native} (BluetoothClass)`,
      note: 'KURAL: OBD adaptörleri standart sınıf İLAN ETMEZ (çoğu MISC/UNCATEGORIZED) → bu sayım ÇIKARIMDIR, kesin değildir.' },
    SOURCE_TRUST_LABEL.INFERRED,
  ));

  return { id: 'adapter', title: PH_SECTION_TITLE.adapter, fields: _bound(f) };
}

/* ── Profiller ────────────────────────────────────────────────────────────── */

function _profilesSection(s: PhoneHubProbeRaw): PhSection {
  const f: InspectorField[] = [];
  const p = s.profiles;

  if (!p) {
    f.push(unavailable({ id: 'phProfiles', label: 'profil durumları', source: SRC.native, note: '' },
      'Native gözlem yok — profil durumu UYDURULMAZ.'));
    return { id: 'profiles', title: PH_SECTION_TITLE.profiles, fields: _bound(f) };
  }

  f.push(observed({ id: 'phA2dpState', label: 'A2DP bağlantı durumu', source: SRC.native,
    note: 'getProfileConnectionState(A2DP). CONNECTED olması ses yolunu BİZİM sürdüğümüz anlamına GELMEZ.' },
    p.a2dpConnectionState));
  f.push(observed({ id: 'phHfpState', label: 'HEADSET (HFP) bağlantı durumu', source: SRC.native,
    note: 'getProfileConnectionState(HEADSET). CONNECTED olması çağrı/mikrofon kontrolü DEMEK DEĞİLDİR.' },
    p.headsetConnectionState));
  f.push(observed({ id: 'phGattState', label: 'GATT durumu', source: SRC.native,
    note: 'Adapter seviyesinde GÜVENİLİR salt-okunur GATT durumu API\'si YOK → tahmin edilmez.' },
    p.gattConnectionState));

  f.push(derived(
    { id: 'phA2dpAuthority', label: 'A2DP kontrol otoritesi', source: `${SRC.native} (pozitif kanıt şartı)`,
      note: 'KURAL: uygulamanın profili YÖNETTİĞİNE dair kod kanıtı yoksa BİLİNMİYOR. Depoda A2DP Sink yığınını yöneten kod YOKTUR.' },
    AUTHORITY_LABEL[_authority(p.a2dpControlAuthority)],
  ));
  f.push(derived(
    { id: 'phHfpAuthority', label: 'HFP kontrol otoritesi', source: `${SRC.native} (pozitif kanıt şartı)`,
      note: 'KURAL: HFP/SCO yığınını yöneten kod kanıtı yoksa BİLİNMİYOR.' },
    AUTHORITY_LABEL[_authority(p.hfpControlAuthority)],
  ));

  f.push(derived(
    { id: 'phA2dpSupportClaim', label: 'A2DP "destekleniyor" denebilir mi', source: 'model kuralı',
      note: 'KURAL: yalnız CİHAZDAN GÖZLENDİ kanıtı VE otorite=ANDROID UYGULAMASI ise EVET.' },
    _canClaimSupport(p.evidence, p.a2dpControlAuthority) ? 'EVET' : 'HAYIR — kanıt yetersiz',
  ));
  f.push(derived(
    { id: 'phHfpSupportClaim', label: 'HFP "destekleniyor" denebilir mi', source: 'model kuralı',
      note: 'KURAL: yalnız CİHAZDAN GÖZLENDİ kanıtı VE otorite=ANDROID UYGULAMASI ise EVET.' },
    _canClaimSupport(p.evidence, p.hfpControlAuthority) ? 'EVET' : 'HAYIR — kanıt yetersiz',
  ));

  return { id: 'profiles', title: PH_SECTION_TITLE.profiles, fields: _bound(f) };
}

function _authority(v: string): ControlAuthority {
  return (v === 'VENDOR_STACK' || v === 'MCU_STACK' || v === 'ANDROID_APP' || v === 'UNAVAILABLE')
    ? v : 'UNKNOWN';
}

/**
 * "Destekleniyor" iddiası KAPISI. Yalnız DEVICE_OBSERVED kanıt + ANDROID_APP
 * otoritesi birlikteyken açılır. Aksi hâlde ASLA kesin ifade kullanılmaz.
 */
export function _canClaimSupport(evidence: string, authority: string): boolean {
  return evidence === 'DEVICE_OBSERVED' && authority === 'ANDROID_APP';
}

/* ── Vendor ───────────────────────────────────────────────────────────────── */

function _vendorSection(s: PhoneHubProbeRaw): PhSection {
  const f: InspectorField[] = [];
  const v = s.vendor;

  if (!v) {
    f.push(unavailable({ id: 'phVendor', label: 'üretici kanıtı', source: SRC.native, note: '' },
      'Native gözlem yok.'));
    return { id: 'vendor', title: PH_SECTION_TITLE.vendor, fields: _bound(f) };
  }

  f.push(observed({ id: 'phVendorPkg', label: 'bilinen üretici paketi', source: SRC.native,
    note: 'PackageManager ile YALNIZ var/yok kontrolü — servise BIND OLUNMAZ, intent GÖNDERİLMEZ.' },
    v.knownVendorPackageDetected ? 'VAR' : 'YOK'));
  f.push(observed({ id: 'phVendorFamily', label: 'üretici ailesi', source: SRC.native,
    note: 'Kesin bilinmiyorsa BİLİNMİYOR — tahmin edilmez.' }, v.vendorFamily));
  f.push(observed({ id: 'phVendorBroadcast', label: 'üretici yayını gözlendi', source: SRC.native,
    note: 'Depodaki CAN broadcast adaptörü alınan yayınlar için ZAMAN DAMGASI/SAYAÇ TUTMAZ → gözlem kanıtı YOKTUR. Yeni izleyici eklemek bu salt-okunur fazın KAPSAMI DIŞINDADIR.' },
    v.knownVendorBroadcastObserved ? 'EVET' : 'HAYIR (kanıt altyapısı yok)'));

  f.push(v.lastEvidenceAgeMs >= 0
    ? observed({ id: 'phVendorAge', label: 'son kanıt yaşı (ms)', source: SRC.native, note: 'Gerçek ölçüm.' },
        v.lastEvidenceAgeMs)
    : unavailable({ id: 'phVendorAge', label: 'son kanıt yaşı (ms)', source: SRC.native, note: '' },
        'Hiç gözlem yok — 0 ms GÖSTERİLMEZ.'));

  f.push(derived(
    { id: 'phVendorTrust', label: 'kaynak güveni', source: 'model kuralı',
      note: 'KURAL: yalnız paket varlığı → KODDAN GÖZLENDİ. Paket VARLIĞI vendor API\'nin KULLANILABİLİR olduğunu KANITLAMAZ.' },
    SOURCE_TRUST_LABEL[_trust(v.evidence)],
  ));

  return { id: 'vendor', title: PH_SECTION_TITLE.vendor, fields: _bound(f) };
}

export function _trust(v: string): SourceTrust {
  return (v === 'CODE_OBSERVED' || v === 'DEVICE_OBSERVED' || v === 'VENDOR_DECLARED' || v === 'INFERRED')
    ? v : 'UNKNOWN';
}

/* ── Audio ────────────────────────────────────────────────────────────────── */

function _audioSection(s: PhoneHubProbeRaw): PhSection {
  const f: InspectorField[] = [];
  const a = s.audio;

  if (!a) {
    f.push(unavailable({ id: 'phAudio', label: 'ses yolu', source: SRC.native, note: '' },
      'Native gözlem yok.'));
    return { id: 'audio', title: PH_SECTION_TITLE.audio, fields: _bound(f) };
  }

  f.push(a.audioMode >= 0
    ? observed({ id: 'phAudioMode', label: 'ses modu (AudioManager.getMode)', source: SRC.native,
        note: 'SALT OKUNUR — mod DEĞİŞTİRİLMEZ.' }, a.audioMode)
    : unavailable({ id: 'phAudioMode', label: 'ses modu', source: SRC.native, note: '' }, 'Okunamadı.'));
  f.push(observed({ id: 'phMusicActive', label: 'müzik çalıyor', source: SRC.native,
    note: 'isMusicActive(). Hangi UYGULAMANIN çaldığı OKUNMAZ; medya başlığı GÖSTERİLMEZ.' },
    a.musicActive));
  f.push(observed({ id: 'phCommDevice', label: 'iletişim cihazı türü', source: SRC.native,
    note: 'API 31+ getCommunicationDevice().getType() — yalnız TÜR; cihaz adı/adresi OKUNMAZ.' },
    a.communicationDeviceType));
  f.push(derived(
    { id: 'phRouteAuthority', label: 'ses yolu otoritesi', source: 'model kuralı',
      note: 'KURAL: uygulamamız route DEĞİŞTİRMEZ; head unit\'te yolu vendor/MCU sürüyor olabilir → kanıtsız atama YOK.' },
    AUTHORITY_LABEL[_authority(a.routeAuthority)],
  ));

  return { id: 'audio', title: PH_SECTION_TITLE.audio, fields: _bound(f) };
}

/* ── OBD eşzamanlılığı ────────────────────────────────────────────────────── */

function _obdSection(s: PhoneHubProbeRaw): PhSection {
  const f: InspectorField[] = [];
  const o = s.obd;

  if (!o) {
    f.push(unavailable({ id: 'phObd', label: 'OBD durumu', source: SRC.obd, note: '' },
      'OBD getter\'ları okunamadı — "bağlı değil" VARSAYILMAZ.'));
    return { id: 'obd', title: PH_SECTION_TITLE.obd, fields: _bound(f) };
  }

  f.push(o.transport
    ? observed({ id: 'phObdTransport', label: 'taşıma türü', source: SRC.obd, note: 'Mevcut OBD getter.' }, o.transport)
    : unavailable({ id: 'phObdTransport', label: 'taşıma türü', source: SRC.obd, note: '' }, 'Okunamadı.'));
  f.push(observed({ id: 'phObdConnected', label: 'OBD bağlı', source: SRC.obd,
    note: 'Bu ekran OBD\'ye BAĞLANMAZ/KOPARMAZ — yalnız mevcut durumu okur.' }, o.transportConnected));
  f.push(observed({ id: 'phObdPolling', label: 'sorgulama aktif', source: SRC.obd,
    note: 'Polling davranışı bu ekrandan DEĞİŞTİRİLMEZ.' }, o.pollingActive));
  f.push(observed({ id: 'phObdFresh', label: 'veri taze', source: SRC.obd,
    note: 'Adaptif tazelik kapısı.' }, o.dataFresh));
  f.push(o.lastPacketAgeMs >= 0
    ? observed({ id: 'phObdPacketAge', label: 'son paket yaşı (ms)', source: SRC.obd, note: 'Gerçek ölçüm.' },
        o.lastPacketAgeMs)
    : unavailable({ id: 'phObdPacketAge', label: 'son paket yaşı (ms)', source: SRC.obd, note: '' },
        'Hiç paket yok — 0 ms GÖSTERİLMEZ.'));
  f.push(observed({ id: 'phObdReset', label: 'sıfırlama süreci', source: SRC.obd,
    note: 'Bu ekran sıfırlama TETİKLEMEZ.' }, o.resetInProgress));

  return { id: 'obd', title: PH_SECTION_TITLE.obd, fields: _bound(f) };
}

/* ── Kısıtlamalar (sabit beyan) ───────────────────────────────────────────── */

function _restrictionsSection(): PhSection {
  const mk = (id: string, label: string): InspectorField =>
    observed({ id, label, source: SRC.none, note: 'Kod ve statik güvenlik testiyle kilitlenmiştir.' }, 'EVET');
  return {
    id: 'restrictions',
    title: PH_SECTION_TITLE.restrictions,
    fields: _bound([
      mk('phRoRead',    'Salt-okunur probe'),
      mk('phRoPairing', 'Eşleştirme YAPILMADI'),
      mk('phRoScan',    'Bluetooth taraması BAŞLATILMADI'),
      mk('phRoMedia',   'Medya/çağrı komutu GÖNDERİLMEDİ'),
      mk('phRoObd',     'OBD davranışı DEĞİŞTİRİLMEDİ'),
      mk('phRoPerm',    'İzin İSTENMEDİ'),
    ]),
  };
}

export function buildPhSections(s: PhoneHubProbeRaw): PhSection[] {
  if (!s) return [];
  return [
    _statusSection(s), _adapterSection(s), _profilesSection(s),
    _vendorSection(s), _audioSection(s), _obdSection(s), _restrictionsSection(),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çakışma değerlendirmesi — YALNIZ TÜRETİLMİŞ
 * ════════════════════════════════════════════════════════════════════════ */

export interface CollisionResult {
  readonly level: CollisionLevel;
  /** Sabit enum kodları (serbest metin YOK). */
  readonly reasons: readonly string[];
}

/**
 * Native ile AYNI kural sırası (tek gerçek, iki yerde tutarlı):
 *  1. adapter reseti VEYA (OBD bağlı + BT keşfi aktif) → HIGH
 *  2. OBD polling + telefon profili bağlı              → POSSIBLE
 *  3. BT durumu okunamıyor                             → UNKNOWN
 *  4. aksi hâlde                                       → NONE_OBSERVED
 *
 * Kanıt eksikse ASLA NONE_OBSERVED verilmez (fail-closed).
 */
export function assessPhCollision(s: PhoneHubProbeRaw): CollisionResult {
  const reasons: string[] = [];
  const push = (r: string): void => { if (reasons.length < MAX_PH_REASONS) reasons.push(r); };

  if (!s || !s.present) {
    return { level: 'UNKNOWN', reasons: ['BT_STATE_UNREADABLE', 'SIMULTANEOUS_PROFILE_STATE_UNKNOWN'] };
  }

  const bt = s.bluetooth;
  const p  = s.profiles;
  const o  = s.obd;

  const a2dp = p ? p.a2dpConnectionState : 'UNKNOWN';
  const hfp  = p ? p.headsetConnectionState : 'UNKNOWN';
  const stateUnreadable =
    a2dp === 'UNKNOWN' || a2dp === 'UNAVAILABLE' || hfp === 'UNKNOWN' || hfp === 'UNAVAILABLE';

  const discoveryActive = bt ? bt.discoveryActive === 'ACTIVE' : false;
  const obdConnected = o ? o.transportConnected : false;
  const obdPolling   = o ? o.pollingActive : false;
  const resetting    = o ? o.resetInProgress : false;

  if (resetting) push('ADAPTER_RESET_IN_PROGRESS');
  if (obdConnected && discoveryActive) push('OBD_CONNECTED_WITH_DISCOVERY');
  if (reasons.length > 0) return { level: 'HIGH', reasons };

  const phoneProfileConnected = a2dp === 'CONNECTED' || hfp === 'CONNECTED';
  if (obdPolling && phoneProfileConnected) {
    push('OBD_POLLING_WITH_PHONE_PROFILE');
    if (stateUnreadable) push('SIMULTANEOUS_PROFILE_STATE_UNKNOWN');
    return { level: 'POSSIBLE', reasons };
  }

  if (stateUnreadable || !o) {
    push('BT_STATE_UNREADABLE');
    push('SIMULTANEOUS_PROFILE_STATE_UNKNOWN');
    return { level: 'UNKNOWN', reasons };
  }

  return { level: 'NONE_OBSERVED', reasons: [] };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rozet sayaçları
 * ════════════════════════════════════════════════════════════════════════ */

export function countByPhClass(sections: readonly PhSection[]): Record<Observability, number> {
  const out: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  if (!Array.isArray(sections)) return out;
  for (const sec of sections) {
    if (!sec || !Array.isArray(sec.fields)) continue;
    for (const f of sec.fields as readonly InspectorField[]) {
      if (f && Object.prototype.hasOwnProperty.call(out, f.klass)) out[f.klass]++;
    }
  }
  return out;
}
