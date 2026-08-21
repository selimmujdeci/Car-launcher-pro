/**
 * kwpMonitorModel.ts — KWP İzleyici'nin SAF görünüm modeli (Faz A4).
 *
 * BU DOSYA YENİ BİR OTORİTE DEĞİLDİR: KWP oturum yöneticisi, keep-alive motoru ya da
 * kurtarma merdiveni YAZMAZ. Kurtarma tamamen native `ElmProtocol` içindedir; burada
 * yalnız MEVCUT kanıt sayaçları sınıflandırılıp okunur hâle getirilir.
 *
 * PARALEL MİMARİ YOK: gözlemlenebilirlik ilkelleri (`observed` · `derived` ·
 * `unavailable` · `applyStaleness` · `formatAge` · `Observability`) Session
 * Inspector'ın modelinden AYNEN yeniden kullanılır — ikinci bir sınıflandırma
 * sistemi kurulmaz.
 *
 * ── DÜRÜSTLÜK KURALLARI (pazarlıksız) ───────────────────────────────────────
 *  · ATWM / ATSW / ATST değerleri JS'e AÇILMAMIŞTIR (yalnız native
 *    `ElmInitSequencer` içinde yaşarlar). Bu alanlar UNAVAILABLE gösterilir —
 *    native sabitleri buraya kopyalayıp "gerçek veri" gibi sunmak YASAKTIR.
 *  · `lastRecoveryAt === 0` → "hiç kurtarma olmadı" demektir, epoch 0 tarihi DEĞİL.
 *  · `lastRecoveryToFirstPidMs === -1` → ÖLÇÜLMEDİ demektir, -1 ms değil.
 *  · Bayatlık YALNIZ gerçek duvar-saati damgası + repoda TANIMLI eşik
 *    (`getObdFreshWindowMs()`) varken hesaplanır.
 *  · Kaynak yoksa yokluk BEYAN EDİLİR; varsayılan değer uydurulmaz.
 *
 * SAF: I/O yok, timer yok, modül durumu yok. Kaynak okuma `kwpMonitorSources.ts`te.
 */

import {
  observed, derived, unavailable, applyStaleness, formatAge,
  type InspectorField, type Observability,
} from './sessionInspectorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/** Ekrandaki bölümler. Sıra sabittir (deterministik render). */
export type KwpSectionId = 'protocol' | 'session' | 'recovery' | 'keepalive' | 'dtc';

export const KWP_SECTION_ORDER: readonly KwpSectionId[] = [
  'protocol', 'session', 'recovery', 'keepalive', 'dtc',
] as const;

export const KWP_SECTION_TITLE: Readonly<Record<KwpSectionId, string>> = {
  protocol:  '1 · Protokol / Uygulanabilirlik',
  session:   '2 · Oturum Sağlığı',
  recovery:  '3 · Kurtarma Merdiveni (ATPC)',
  keepalive: '4 · Keep-Alive (ATWM/ATSW/ATST)',
  dtc:       '5 · DTC Kanalı (0x18 ReadDTCByStatus)',
} as const;

export interface KwpSection {
  readonly id:     KwpSectionId;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

/** Bölüm başına azami alan — Mali-400 render bütçesi. */
export const MAX_FIELDS_PER_KWP_SECTION = 24;

/**
 * Ekranın genel hükmü. FAIL-CLOSED: kanıt yoksa `UNKNOWN` — "sağlıklı" VARSAYILMAZ.
 *
 * `NOT_APPLICABLE`, bu aracın KWP/ISO9141 KULLANMADIĞI (CAN vb.) anlamına gelir;
 * ekranın boş görünmesi bir arıza değil, doğru cevaptır.
 */
export type KwpActivity =
  | 'UNKNOWN'
  | 'NOT_APPLICABLE'
  | 'HEALTHY'
  | 'RECOVERING'
  | 'DEGRADED';

export const KWP_ACTIVITY_LABEL: Readonly<Record<KwpActivity, string>> = {
  UNKNOWN:        'BİLİNMİYOR',
  NOT_APPLICABLE: 'BU ARAÇTA GEÇERSİZ',
  HEALTHY:        'SAĞLIKLI',
  RECOVERING:     'KURTARILIYOR',
  DEGRADED:       'ZAYIF',
} as const;

/** Native kurtarma durumunun Türkçe karşılığı (ham enum `data-*`ta AYNEN kalır). */
export const KWP_RECOVERY_STATUS_LABEL: Readonly<Record<string, string>> = {
  NOT_ATTEMPTED: 'DENENMEDİ',
  IN_PROGRESS:   'SÜRÜYOR',
  RECOVERED:     'DİRİLDİ',
  FAILED:        'BAŞARISIZ',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham anlık görüntü sözleşmesi (kaynak okuyucu bunu üretir)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * KWP kurtarma kanıtı — **her sayaç `null` olabilir.**
 *
 * `null` = native bu alanı VERMEDİ (eski APK / alan yok) → UNAVAILABLE.
 * `0`    = gerçekten ölçüldü ve sıfır. Bu ikisi ASLA aynı değere düşürülmez
 * (envanter denetimi E-19; gözlemlenebilirlik kuralı madde 5).
 */
export interface KwpRecoveryRaw {
  readonly status:                   string;
  readonly coreNoDataStreak:         number | null;
  readonly maxCoreNoDataStreak:      number | null;
  readonly recoveryCount:            number | null;
  readonly suppressedCount:          number | null;
  readonly atpcSendFailures:         number | null;
  readonly lastRecoveryAt:           number | null;
  readonly lastRecoveryToFirstPidMs: number | null;
  readonly killedByDataGate:         number | null;
  readonly protocolAtRecovery:       string | null;
  readonly threshold:                number | null;
  readonly maxPerSession:            number | null;
}

export interface KwpRawSnapshot {
  readonly readAt: number;
  /** `handshake.protocolActive` — ATSP numarası ('3'/'4'/'5'/'6'…). */
  readonly protocolActive:  string | null;
  readonly protocolTried:   string | null;
  /** `classifyProtocol()` sonucu — kaynak okuyucuda hesaplanır (saf fonksiyon). */
  readonly protocolClass:   string | null;
  /** `isSlowSerialProtocol()` — KWP/ISO9141 mi. null = protokol bilinmiyor. */
  readonly slowSerial:      boolean | null;
  readonly transportConnected: boolean | null;
  readonly connectionState: string | null;
  readonly dataFresh:       boolean | null;
  readonly lastRxAt:        number | null;
  readonly freshWindowMs:   number | null;
  readonly pollingActive:   boolean | null;
  readonly recovery:        KwpRecoveryRaw | null;
  /**
   * V-08 — KWP DTC kanalının son tam-tarama kanıtı. `null` = okunamadı.
   * Bu kanal SÜREKLİ akmaz; yalnız tam araç taramasında çalışır.
   */
  readonly dtc:             KwpDtcEvidenceRaw | null;
}

/** `multiEcuScan.getKwpDtcEvidence()` çıktısının YAPISAL izdüşümü (servis importu YOK). */
export interface KwpDtcEvidenceRaw {
  readonly lastScanAtMs:     number | null;
  readonly protocolAtScan:   string | null;
  readonly attempted:        boolean;
  readonly channelAvailable: boolean;
  readonly okCount:          number;
  readonly unsupportedCount: number;
  readonly failedCount:      number;
  readonly codeCount:        number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kaynak künyeleri — hangi alan GERÇEKTE nereden geliyor
 * ════════════════════════════════════════════════════════════════════════ */

const SRC = {
  handshake: 'obdService.getHandshakeDiagnostics()',
  data:      'obdService.getOBDDataSnapshot()',
  session:   'obdService.getObdSessionHealth()',
  fresh:     'obdService.getObdFreshWindowMs()',
  kwp:       'obd/kwpRecoveryEvidence.getKwpRecoveryEvidence()',
  profile:   'obd/protocolProfile.classifyProtocol()',
  none:      'YOK',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Bölüm kurucuları — hepsi SAF
 * ════════════════════════════════════════════════════════════════════════ */

function _protocolSection(s: KwpRawSnapshot): KwpSection {
  const f: InspectorField[] = [];

  f.push(observed(
    { id: 'protocolActive', label: 'aktif protokol (ATSP)', source: SRC.handshake,
      note: 'ELM327\'den ATDPN ile okunan aktif protokol numarası.' },
    s.protocolActive,
  ));

  f.push(observed(
    { id: 'protocolTried', label: 'denenen protokol', source: SRC.handshake,
      note: 'Handshake sırasında zorlanan protokol; otomatik taramada boş kalır.' },
    s.protocolTried,
  ));

  f.push(derived(
    { id: 'protocolClass', label: 'protokol sınıfı', source: SRC.profile,
      note: 'classifyProtocol(): 3=ISO9141 · 4/5=KWP2000 · 6-C=CAN.' },
    s.protocolClass,
  ));

  f.push(s.slowSerial === null
    ? unavailable(
        { id: 'kwpApplicable', label: 'KWP/ISO9141 uygulanabilir mi', source: SRC.profile, note: '' },
        'Aktif protokol henüz bilinmiyor (handshake yapılmadı ya da ATSP0 otomatik tarama sürüyor).',
      )
    : derived(
        { id: 'kwpApplicable', label: 'KWP/ISO9141 uygulanabilir mi', source: SRC.profile,
          note: 'isSlowSerialProtocol(): yalnız KWP/ISO9141 yavaş seri sayılır; CAN bu ekranın kapsamı DIŞINDADIR.' },
        s.slowSerial,
      ));

  return _bound({ id: 'protocol', title: KWP_SECTION_TITLE.protocol, fields: f });
}

function _sessionSection(s: KwpRawSnapshot, nowMs: number): KwpSection {
  const f: InspectorField[] = [];
  const threshold = typeof s.freshWindowMs === 'number' && s.freshWindowMs > 0 ? s.freshWindowMs : 0;

  f.push(observed(
    { id: 'connectionState', label: 'bağlantı durumu', source: SRC.data, note: 'OBD bağlantı durum makinesi.' },
    s.connectionState,
  ));

  f.push(observed(
    { id: 'transportConnected', label: 'transport bağlı', source: SRC.data,
      note: 'Fiziksel kanal (BLE/Classic) açık mı — oturum sağlığından AYRI bir gerçektir.' },
    s.transportConnected,
  ));

  f.push(observed(
    { id: 'pollingActive', label: 'sorgulama etkin', source: SRC.session,
      note: 'Poll döngüsü çalışıyor mu (kurtarma kararı bu bayrağa bağlı DEĞİLDİR).' },
    s.pollingActive,
  ));

  f.push(observed(
    { id: 'dataFresh', label: 'veri taze', source: SRC.data,
      note: 'Tazelik kapısının o anki hükmü.' },
    s.dataFresh,
  ));

  // Son veri damgası: GERÇEK duvar saati + TANIMLI eşik varsa bayatlık hesaplanır.
  const lastRx = observed(
    { id: 'lastRxAt', label: 'son veri damgası', source: SRC.data, updatedAt: s.lastRxAt,
      note: 'Adaptörden son geçerli yanıtın alındığı an.' },
    s.lastRxAt && s.lastRxAt > 0 ? new Date(s.lastRxAt).toISOString() : null,
  );
  f.push(applyStaleness(lastRx, nowMs, threshold));

  f.push(threshold > 0
    ? observed(
        { id: 'freshWindowMs', label: 'tazelik penceresi (ms)', source: SRC.fresh,
          note: 'Adaptif kadans kapısının o anki eşiği — sabit DEĞİL, gözlenen kadanstan öğrenilir.' },
        threshold,
      )
    : unavailable(
        { id: 'freshWindowMs', label: 'tazelik penceresi (ms)', source: SRC.fresh, note: '' },
        'Eşik okunamadı; bu yüzden bayatlık HESAPLANMADI (uydurma eşik kullanılmaz).',
      ));

  return _bound({ id: 'session', title: KWP_SECTION_TITLE.session, fields: f });
}

function _recoverySection(s: KwpRawSnapshot): KwpSection {
  const f: InspectorField[] = [];
  const k = s.recovery;

  if (!k) {
    f.push(unavailable(
      { id: 'recoveryEvidence', label: 'kurtarma kanıtı', source: SRC.kwp, note: '' },
      'Native kanıt yok: eski APK, CAN aracı ya da kanıt kanalı henüz yayın yapmadı. ' +
      'Sayaçlar UYDURULMAZ — 0 göstermek "kurtarma hiç olmadı" yalanı olurdu.',
    ));
    return _bound({ id: 'recovery', title: KWP_SECTION_TITLE.recovery, fields: f });
  }

  f.push(observed(
    { id: 'recoveryStatus', label: 'kurtarma durumu', source: SRC.kwp,
      note: 'DENENMEDİ = KWP değil VEYA oturum sağlıklı. Native ElmProtocol hükmü.' },
    k.status,
  ));

  f.push(observed(
    { id: 'coreNoDataStreak', label: 'ardışık çekirdek NO_DATA', source: SRC.kwp,
      note: 'Eşiğe doğru sayan anlık seri.' },
    k.coreNoDataStreak,
  ));

  f.push(observed(
    { id: 'maxCoreNoDataStreak', label: 'oturumun EN YÜKSEK serisi', source: SRC.kwp,
      note: 'Eşiğe ne kadar yaklaşıldığını gösterir (kurtarma tetiklenmese bile).' },
    k.maxCoreNoDataStreak,
  ));

  f.push(observed(
    { id: 'threshold', label: 'kurtarma eşiği', source: SRC.kwp,
      note: 'Native sabiti — kaç ardışık NO_DATA sonrası ATPC gönderilir.' },
    k.threshold !== null && k.threshold > 0 ? k.threshold : null,
  ));

  f.push(observed(
    { id: 'recoveryCount', label: 'ATPC gönderim sayısı', source: SRC.kwp,
      note: 'Bu oturumda kaç kez kurtarma tetiklendi.' },
    k.recoveryCount,
  ));

  f.push(observed(
    { id: 'maxPerSession', label: 'oturum başına tavan', source: SRC.kwp,
      note: 'Native sabiti — tavan dolunca ATPC gönderilmez.' },
    k.maxPerSession !== null && k.maxPerSession > 0 ? k.maxPerSession : null,
  ));

  f.push(observed(
    { id: 'suppressedCount', label: 'tavan nedeniyle bastırılan', source: SRC.kwp,
      note: 'Kurtarma GEREKTİ ama tavan dolu olduğu için gönderilmedi.' },
    k.suppressedCount,
  ));

  f.push(observed(
    { id: 'atpcSendFailures', label: 'ATPC gönderim hatası', source: SRC.kwp,
      note: 'Komut denendi ama kanala yazılamadı (transport sorunu).' },
    k.atpcSendFailures,
  ));

  f.push(observed(
    { id: 'killedByDataGate', label: 'Data Gate tarafından yıkıldı', source: SRC.kwp,
      note: 'Kurtarma SÜRERKEN JS tazelik kapısı bağlantıyı kapattı — saha hipotezinin ölçümü.' },
    k.killedByDataGate,
  ));

  // 0 = "hiç kurtarma olmadı"; epoch 0 tarihine ÇEVRİLMEZ.
  f.push(k.lastRecoveryAt !== null && k.lastRecoveryAt > 0
    ? observed(
        { id: 'lastRecoveryAt', label: 'son kurtarma zamanı', source: SRC.kwp, updatedAt: k.lastRecoveryAt,
          note: 'Son ATPC gönderim anı.' },
        new Date(k.lastRecoveryAt).toISOString(),
      )
    : unavailable(
        { id: 'lastRecoveryAt', label: 'son kurtarma zamanı', source: SRC.kwp, note: '' },
        'Bu oturumda hiç kurtarma tetiklenmedi (damga 0 = "yok", tarih DEĞİL).',
      ));

  // -1 = ölçülmedi; -1 ms olarak GÖSTERİLMEZ.
  f.push(k.lastRecoveryToFirstPidMs !== null && k.lastRecoveryToFirstPidMs >= 0
    ? observed(
        { id: 'lastRecoveryToFirstPidMs', label: 'ATPC → ilk geçerli PID (ms)', source: SRC.kwp,
          note: 'Kurtarmanın GERÇEKTEN işe yarayıp yaramadığının tek ölçüsü.' },
        k.lastRecoveryToFirstPidMs,
      )
    : unavailable(
        { id: 'lastRecoveryToFirstPidMs', label: 'ATPC → ilk geçerli PID (ms)', source: SRC.kwp, note: '' },
        'Ölçülmedi (-1): başarılı bir kurtarma tamamlanmadı. Süre olarak GÖSTERİLMEZ.',
      ));

  f.push(observed(
    { id: 'protocolAtRecovery', label: 'kurtarma anındaki protokol', source: SRC.kwp,
      note: 'Kurtarma tetiklendiğinde aktif olan ATSP numarası.' },
    k.protocolAtRecovery,
  ));

  return _bound({ id: 'recovery', title: KWP_SECTION_TITLE.recovery, fields: f });
}

/**
 * Keep-alive bölümü — TAMAMEN UNAVAILABLE ve bu BİLİNÇLİDİR.
 *
 * ATWM (wakeup mesajı), ATSW (wakeup aralığı) ve ATST (yanıt bekleme) yalnız native
 * `ElmInitSequencer` içinde gönderilir; JS'e açılmış hiçbir durum/zamanlama getter'ı
 * YOKTUR. Native kaynak koddaki sabitleri buraya kopyalamak, ekranda ÖLÇÜLMEMİŞ bir
 * değeri ölçülmüş gibi göstermek olurdu — Session Inspector ve Runtime Scheduling
 * ekranları da bu alanları aynı gerekçeyle UNAVAILABLE gösterir.
 */
function _keepAliveSection(): KwpSection {
  const f: InspectorField[] = [
    unavailable(
      { id: 'kwpKeepAliveMsg', label: 'wakeup mesajı (ATWM)', source: SRC.none, note: '' },
      'Yalnız native ElmInitSequencer içinde gönderilir; JS\'e açılmış durum alanı YOK. ' +
      'Native sabiti kopyalayıp göstermek ölçüm gibi görünürdü — göstermiyoruz.',
    ),
    unavailable(
      { id: 'kwpKeepAliveInterval', label: 'wakeup aralığı (ATSW)', source: SRC.none, note: '' },
      'Aralık native tarafta ayarlanır; JS okuyamaz. Gözlem kanalı açılana kadar KAYNAK YOK.',
    ),
    unavailable(
      { id: 'kwpResponseTimeout', label: 'yanıt bekleme (ATST)', source: SRC.none, note: '' },
      'ATST yalnız native init dizisinde uygulanır; JS\'e raporlanmaz.',
    ),
    unavailable(
      { id: 'kwpKeepAliveHealth', label: 'keep-alive sağlığı', source: SRC.none, note: '' },
      'ECU wakeup\'ı kabul etti mi bilgisi native tarafta bile ayrıca ölçülmüyor. ' +
      'Dolaylı kanıt: yukarıdaki kurtarma sayaçları.',
    ),
  ];
  return _bound({ id: 'keepalive', title: KWP_SECTION_TITLE.keepalive, fields: f });
}

/** Tüm bölümler, sabit sırada. */
/**
 * V-08 — KWP DTC kanalı (0x18). Bu kanal SÜREKLİ AKMAZ: yalnız tam araç
 * taraması sırasında çalışır. Bu yüzden gösterilen her şey SON TURUN kanıtıdır
 * ve "hiç taranmadı" ile "tarandı, sonuç yok" BİLİNÇLİ OLARAK AYRIDIR —
 * ikisini birleştirmek, bakılmamış bir aracı "temiz" göstermenin LAB'daki
 * karşılığı olurdu.
 */
function _dtcSection(s: KwpRawSnapshot, nowMs: number): KwpSection {
  const f: InspectorField[] = [];
  const d = s.dtc;
  const SRC_DTC = 'obd/multiEcuScan.getKwpDtcEvidence()';

  if (!d) {
    f.push(unavailable(
      { id: 'dtcEvidence', label: 'DTC kanalı', source: SRC_DTC, note: '' },
      'Kanıt okunamadı.',
    ));
    return { id: 'dtc', title: KWP_SECTION_TITLE.dtc, fields: f };
  }

  f.push(observed({
    id: 'dtcChannel', label: 'native kanal', source: SRC_DTC,
    note: 'Köprü yoksa 0x18 HİÇ sorulamaz — web veya eski APK ortamında beklenen durumdur.',
  }, d.channelAvailable ? 'VAR' : 'YOK'));

  if (d.lastScanAtMs === null) {
    f.push(unavailable(
      { id: 'dtcScan', label: 'son tam tarama', source: SRC_DTC, note: '' },
      'Bu oturumda tam araç taraması HİÇ koşmadı — DTC kanalı hakkında hüküm YOK.',
    ));
    return { id: 'dtc', title: KWP_SECTION_TITLE.dtc, fields: f };
  }

  f.push(derived({
    id: 'dtcScanAge', label: 'son tam tarama', source: SRC_DTC,
    note: 'Damgadan türetildi.', updatedAt: d.lastScanAtMs,
  }, formatAge(d.lastScanAtMs, nowMs)));

  f.push(observed({
    id: 'dtcProtocol', label: 'taramadaki protokol', source: SRC_DTC,
    note: 'KWP dalı yalnız yavaş seri hatta (3/4/5) denenir.',
  }, d.protocolAtScan ?? 'bilinmiyor'));

  if (!d.attempted) {
    f.push(unavailable(
      { id: 'dtcAttempt', label: '0x18 denemesi', source: SRC_DTC, note: '' },
      'DENENMEDİ — protokol CAN olduğu için (veya okunamadığı için) KWP dalı hiç çalışmadı. Bu bir hata DEĞİL, kapsam kararıdır.',
    ));
    return { id: 'dtc', title: KWP_SECTION_TITLE.dtc, fields: f };
  }

  f.push(observed({
    id: 'dtcEcuStates', label: 'ECU sonuçları', source: SRC_DTC,
    note: 'ok = 0x18 yanıtladı · desteklemiyor = GERÇEK cevap · düştü = okuma hatası.',
  }, `${d.okCount} ok · ${d.unsupportedCount} desteklemiyor · ${d.failedCount} düştü`));

  f.push(observed({
    id: 'dtcCodes', label: 'KWP kodu', source: SRC_DTC,
    note: 'Standart modda OLMAYAN, yalnız 0x18 yanıtından gelen üretici kodları (dedupe sonrası).',
  }, d.codeCount));

  return { id: 'dtc', title: KWP_SECTION_TITLE.dtc, fields: f };
}

export function buildKwpSections(s: KwpRawSnapshot): KwpSection[] {
  const nowMs = s.readAt;
  return [
    _protocolSection(s),
    _sessionSection(s, nowMs),
    _recoverySection(s),
    _keepAliveSection(),
    _dtcSection(s, nowMs),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Genel hüküm — FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

export interface KwpActivityResult {
  readonly status:  KwpActivity;
  readonly reasons: readonly string[];
}

/**
 * Ekranın tek cümlelik hükmü.
 *
 * FAIL-CLOSED sıralama:
 *   1. Protokol bilinmiyor            → UNKNOWN   ("sağlıklı" varsayılmaz)
 *   2. Yavaş seri DEĞİL (CAN vb.)     → NOT_APPLICABLE
 *   3. Kurtarma kanıtı YOK            → UNKNOWN   (0 sayaç "sorun yok" demek DEĞİLDİR)
 *   4. Kurtarma SÜRÜYOR               → RECOVERING
 *   5. Kurtarma olmuş / seri var /
 *      veri bayat / gate yıkmış       → DEGRADED
 *   6. Aksi hâlde                     → HEALTHY
 */
export function deriveKwpActivity(s: KwpRawSnapshot): KwpActivityResult {
  const reasons: string[] = [];

  if (s.slowSerial === null) {
    reasons.push('Aktif protokol bilinmiyor — KWP olup olmadığı ÖLÇÜLEMEDİ.');
    return { status: 'UNKNOWN', reasons };
  }

  if (s.slowSerial === false) {
    reasons.push('Aktif protokol yavaş seri DEĞİL (CAN/J1850) — KWP kurtarma merdiveni bu araçta çalışmaz.');
    reasons.push('Bu ekranın boş görünmesi arıza değildir; CAN kurtarması AYRI motordur.');
    return { status: 'NOT_APPLICABLE', reasons };
  }

  const k = s.recovery;
  if (!k) {
    reasons.push('KWP aktif ama native kurtarma kanıtı okunamadı (eski APK ya da kanal yayın yapmıyor).');
    reasons.push('Sayaç yokluğu "sorun yok" anlamına GELMEZ — hüküm kurulmadı.');
    return { status: 'UNKNOWN', reasons };
  }

  if (k.status === 'IN_PROGRESS') {
    reasons.push('ATPC gönderildi, ilk geçerli PID bekleniyor.');
    return { status: 'RECOVERING', reasons };
  }

  if (k.status === 'FAILED')                 reasons.push('Son kurtarma BAŞARISIZ: ATPC sonrası veri dönmedi.');
  if (k.status === 'RECOVERED')              reasons.push('Oturum en az bir kez ÖLÜP dirildi (kurtarma çalıştı).');
  if ((k.recoveryCount ?? 0) > 0)                   reasons.push(`Bu oturumda ${k.recoveryCount} kez kurtarma tetiklendi.`);
  if ((k.suppressedCount ?? 0) > 0)                 reasons.push(`${k.suppressedCount} kurtarma tavan dolduğu için BASTIRILDI.`);
  if ((k.atpcSendFailures ?? 0) > 0)                reasons.push(`${k.atpcSendFailures} ATPC gönderimi kanala yazılamadı.`);
  if ((k.killedByDataGate ?? 0) > 0)                reasons.push(`Data Gate, kurtarma sürerken oturumu ${k.killedByDataGate} kez yıktı.`);
  if ((k.coreNoDataStreak ?? 0) > 0)                reasons.push(`Şu an ${k.coreNoDataStreak} ardışık çekirdek NO_DATA var.`);
  if (s.dataFresh === false)                 reasons.push('Veri BAYAT — tazelik kapısı kapalı.');

  if (reasons.length > 0) return { status: 'DEGRADED', reasons };

  reasons.push('KWP aktif, kurtarma gerekmedi ve veri akışı taze.');
  return { status: 'HEALTHY', reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _bound(section: KwpSection): KwpSection {
  if (!section || !Array.isArray(section.fields)) return section;
  if (section.fields.length <= MAX_FIELDS_PER_KWP_SECTION) return section;
  return { ...section, fields: section.fields.slice(0, MAX_FIELDS_PER_KWP_SECTION) };
}

/** Sınıf başına alan sayısı (özet rozetleri). */
export function countByKwpClass(sections: readonly KwpSection[]): Record<Observability, number> {
  const out: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  if (!Array.isArray(sections)) return out;
  for (const s of sections) {
    if (!s || !Array.isArray(s.fields)) continue;
    for (const f of s.fields as readonly InspectorField[]) {
      if (f && Object.prototype.hasOwnProperty.call(out, f.klass)) out[f.klass] += 1;
    }
  }
  return out;
}
