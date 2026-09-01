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
export type KwpSectionId = 'protocol' | 'session' | 'recovery' | 'keepalive' | 'dtc' | 'sessionProbe' | 'addressing';

export const KWP_SECTION_ORDER: readonly KwpSectionId[] = [
  'protocol', 'session', 'recovery', 'keepalive', 'dtc', 'sessionProbe', 'addressing',
] as const;

export const KWP_SECTION_TITLE: Readonly<Record<KwpSectionId, string>> = {
  protocol:  '1 · Protokol / Uygulanabilirlik',
  session:   '2 · Oturum Sağlığı',
  recovery:  '3 · Kurtarma Merdiveni (ATPC)',
  keepalive: '4 · Keep-Alive (ATWM/ATSW/ATST)',
  dtc:       '5 · DTC Kanalı (0x18 ReadDTCByStatus)',
  sessionProbe: '6 · Tanı Oturumu Probu (0x10 StartDiagnosticSession)',
  addressing:   '7 · Fiziksel Adresleme Matrisi (ISO 14230-2 format baytı)',
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
  readonly lastEvent:                string | null;
  readonly noDataCount:              number | null;
  readonly promptTimeoutCount:       number | null;
  readonly partialTimeoutCount:      number | null;
  readonly ecuSilentCount:           number | null;
  readonly sessionRecoveryCount:     number | null;
  readonly transportReconnectCount: number | null;
  readonly recoveredCount:           number | null;
  readonly recoveryFailedCount:      number | null;
  readonly maxCommandDurationMs:     number | null;
  readonly maxKeepAliveGapMs:        number | null;
  readonly keepAliveGapExceededCount:number | null;
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
  /**
   * P0-OBD-FINAL-02 — KWP TANI OTURUMU (0x10) PROBUNUN KANIT DEFTERİ.
   *
   * `null` = defter okunamadı. Boş dizi = prob bu oturumda HİÇ KOŞMADI
   * ("oturum yok" DEMEK DEĞİLDİR — prob yalnız tam araç taramasında koşar).
   * Bu ekran KOMUT GÖNDERMEZ; yalnız son turun kaydını GÖSTERİR.
   */
  readonly sessionProbes?: readonly KwpSessionProbeRawRow[] | null;
  /**
   * P0-OBD-DIAG-01 — fiziksel adresleme matrisinin kanıt defteri.
   *
   * `null` = defter okunamadı. Boş dizi = matris bu oturumda HİÇ KOŞMADI
   * ("adres yanlış" DEMEK DEĞİLDİR — matris yalnız tam araç taramasında ve
   * yalnız adres henüz kanıtlanmamışken koşar).
   */
  readonly addressingProbes?: readonly KwpAddressingProbeRawRow[] | null;
}

/** `kwpAddressingProbe.getKwpAddressingProbes()` satırının YAPISAL izdüşümü. */
export interface KwpAddressingProbeRawRow {
  readonly rx: string;
  readonly header: string;
  readonly variantId: string;
  readonly physical: boolean;
  /** Satır K-line başlatma yaptı mı ('FAST'/'SLOW'); yapmadıysa null. */
  readonly initFirst: string | null;
  /** Başlatma komutunun HAM yanıtı; yoksa null (gerekçesiz düşüş YASAK). */
  readonly initRaw: string | null;
  readonly request: string | null;
  readonly raw: string | null;
  readonly result: string;
  readonly nrc: number | null;
  readonly nativeOutcome: string | null;
  readonly sessionEpoch: number;
  readonly protocol: string | null;
}

/** `kwpSessionProbe.getKwpSessionProbes()` satırının YAPISAL izdüşümü. */
export interface KwpSessionProbeRawRow {
  readonly tx: string;
  readonly rx: string;
  readonly request: string | null;
  readonly positiveNeedle: string;
  readonly raw: string | null;
  readonly result: string;
  readonly nrc: number | null;
  readonly nativeOutcome: string | null;
  readonly sessionEpoch: number;
  readonly protocol: string | null;
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
  readonly functional03Raw?: string | null;
  readonly functional07Raw?: string | null;
  readonly physicalTarget?: string | null;
  readonly targetProvenance?: string | null;
  readonly sessionRequest?: string | null;
  readonly sessionResponse?: string | null;
  readonly request18Tx?: string | null;
  readonly response18Raw?: string | null;
  readonly gateOutcome?: 'SENT' | 'NOT_SENT' | null;
  readonly notSentReason?: string | null;
  readonly foundDtcs?: readonly string[];
  readonly publishedToCanonicalAuthority?: boolean | null;
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
    { id: 'lastEvent', label: 'son recovery olayı', source: SRC.kwp,
      note: 'NO_DATA / PROMPT_TIMEOUT / PARTIAL_TIMEOUT / ECU_SILENT / SESSION_RECOVERY / TRANSPORT_RECONNECT / RECOVERED / RECOVERY_FAILED.' },
    k.lastEvent,
  ));

  for (const [id, label, value] of [
    ['noDataCount', 'NO_DATA', k.noDataCount],
    ['promptTimeoutCount', 'PROMPT_TIMEOUT', k.promptTimeoutCount],
    ['partialTimeoutCount', 'PARTIAL_TIMEOUT', k.partialTimeoutCount],
    ['ecuSilentCount', 'ECU_SILENT', k.ecuSilentCount],
    ['sessionRecoveryCount', 'SESSION_RECOVERY', k.sessionRecoveryCount],
    ['transportReconnectCount', 'TRANSPORT_RECONNECT', k.transportReconnectCount],
    ['recoveredCount', 'RECOVERED', k.recoveredCount],
    ['recoveryFailedCount', 'RECOVERY_FAILED', k.recoveryFailedCount],
  ] as const) f.push(observed({ id, label, source: SRC.kwp, note: 'Oturumluk bounded sayaç.' }, value));

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
function _keepAliveSection(s: KwpRawSnapshot): KwpSection {
  const k = s.recovery;
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
    observed({ id: 'maxCommandDurationMs', label: 'en uzun komut süresi (ms)', source: SRC.kwp,
      note: 'DTC/DID dahil KWP komutunun hattı ne kadar tuttuğu.' }, k?.maxCommandDurationMs ?? null),
    observed({ id: 'maxKeepAliveGapMs', label: 'en uzun komutlar arası boşluk (ms)', source: SRC.kwp,
      note: 'TesterPresent/wakeup boşluğu riski için ölçülen üst değer.' }, k?.maxKeepAliveGapMs ?? null),
    observed({ id: 'keepAliveGapExceededCount', label: '5 sn boşluk aşımı', source: SRC.kwp,
      note: 'KWP session keep-alive risk penceresini aşan boşluk sayısı.' }, k?.keepAliveGapExceededCount ?? null),
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

  f.push(observed({ id: 'functional03Raw', label: 'fonksiyonel 03 ham RX', source: SRC_DTC,
    note: 'null = bu ürün yolunda ham yanıt taşınmadı; temiz anlamına gelmez.' }, d.functional03Raw ?? null));
  f.push(observed({ id: 'functional07Raw', label: 'fonksiyonel 07 ham RX', source: SRC_DTC,
    note: 'null = bu ürün yolunda ham yanıt taşınmadı; temiz anlamına gelmez.' }, d.functional07Raw ?? null));
  f.push(observed({ id: 'kwpPhysicalTarget', label: 'KWP fiziksel hedef', source: SRC_DTC,
    note: 'Yalnız doğrulanmış keşif kanıtından gelir; Renault adresi tahmin edilmez.' }, d.physicalTarget ?? null));
  f.push(observed({ id: 'kwpTargetProvenance', label: 'hedef provenance', source: SRC_DTC,
    note: 'UNKNOWN ise fiziksel komut fail-closed kesilir.' }, d.targetProvenance ?? null));
  /* P0-OBD-FINAL-02: bu iki alan artık ÖLÇÜLÜYOR (`kwpSessionProbe`). Eskiden
     kodda VARDI ama sonsuza dek `null`dı — oturum komutu yalnız bir NRC sonrası
     YAN ETKİ olarak gidiyor ve sonucu bir `boolean`a düşürülüp ATILIYORDU. */
  f.push(observed({ id: 'kwpSessionRequest', label: 'oturum isteği', source: SRC_DTC,
    note: 'Kontrollü prob ölçer (10 81 → 50 81; olmazsa 10 C0 → 50 C0). null = prob koşmadı.' },
  d.sessionRequest ?? null));
  f.push(observed({ id: 'kwpSessionResponse', label: 'oturum yanıtı', source: SRC_DTC,
    note: 'Gerçek TX/RX kanıtı olmadan oturum doğrulandı denmez.' }, d.sessionResponse ?? null));
  f.push(observed({ id: 'kwp18Tx', label: 'KWP 0x18 TX', source: SRC_DTC,
    note: 'Yalnız komut gerçekten köprüye verildiyse 1800FF00 gösterilir.' }, d.request18Tx ?? null));
  f.push(observed({ id: 'kwp18RawRx', label: 'KWP 0x18 ham RX', source: SRC_DTC,
    note: 'NO DATA/malformed/null temiz sonuç değildir.' }, d.response18Raw ?? null));
  f.push(observed({ id: 'kwpGate', label: '0x18 gate sonucu', source: SRC_DTC,
    note: 'SENT veya NOT_SENT; kanıt yoksa alan da yoktur.' }, d.gateOutcome ?? null));
  f.push(observed({ id: 'kwpNotSentReason', label: 'gönderilmeme nedeni', source: SRC_DTC,
    note: 'Fail-closed kapının kesin gerekçesi.' }, d.notSentReason ?? null));
  f.push(observed({ id: 'kwpFoundDtcs', label: 'bulunan KWP DTC’leri', source: SRC_DTC,
    note: 'Aynı kodun başka kaynağı authority katmanında korunur.' }, d.foundDtcs?.join(', ') ?? null));
  f.push(observed({ id: 'kwpAuthorityPublish', label: 'canonical authority yayını', source: SRC_DTC,
    note: 'true yalnız KWP kaynağından en az bir gözlem yayınlandı demektir.' },
  d.publishedToCanonicalAuthority ?? null));

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

/**
 * P0-OBD-FINAL-02 — TANI OTURUMU PROBU BÖLÜMÜ (SALT-OKUNUR).
 *
 * NEDEN AYRI BÖLÜM: DTC bölümü `attempted:false` / `lastScanAtMs:null` olunca
 * ERKEN DÖNER. Sahada tam olarak bu durumdaydık (KWP dalı hiç denenmemişti) —
 * yani oturum kanıtını DTC bölümüne koysaydık, EN ÇOK İHTİYAÇ DUYULAN ANDA
 * görünmezdi. Kendi bölümü kısa devreye UĞRAMAZ.
 *
 * Bu bölüm KOMUT GÖNDERMEZ: prob yalnız tam araç taraması sırasında koşar,
 * burada YALNIZ son turun kaydı okunur.
 */
function _sessionProbeSection(s: KwpRawSnapshot): KwpSection {
  const f: InspectorField[] = [];
  const SRC_PROBE = 'obd/kwpSessionProbe.getKwpSessionProbes()';
  const rows = s.sessionProbes;

  if (rows === null || rows === undefined) {
    f.push(unavailable(
      { id: 'sessionProbeLedger', label: 'oturum probu defteri', source: SRC_PROBE, note: '' },
      'Kanıt okunamadı.',
    ));
    return _bound({ id: 'sessionProbe', title: KWP_SECTION_TITLE.sessionProbe, fields: f });
  }

  if (rows.length === 0) {
    f.push(unavailable(
      { id: 'sessionProbeLedger', label: 'oturum probu defteri', source: SRC_PROBE, note: '' },
      'Bu oturumda prob HİÇ koşmadı — prob yalnız tam araç taramasında ve yalnız '
      + 'fiziksel adres henüz kanıtlanmamışken çalışır. Bu "oturum yok" DEMEK DEĞİLDİR.',
    ));
    return _bound({ id: 'sessionProbe', title: KWP_SECTION_TITLE.sessionProbe, fields: f });
  }

  const proven = rows.filter((r) => r.result === 'POSITIVE');
  f.push(observed({
    id: 'sessionProbeCount', label: 'deneme sayısı', source: SRC_PROBE,
    note: 'ECU başına en fazla 2 komut (10 81 → 50 81; olmazsa 10 C0 → 50 C0).',
  }, rows.length));

  f.push(observed({
    id: 'sessionProven', label: 'pozitif oturum kanıtı', source: SRC_PROBE,
    note: 'YALNIZ pozitif önek HAM YANITTA görüldüyse VAR. Sessizlik/NRC/bozuk yanıt '
        + 'POZİTİF SAYILMAZ ve 0x18 zincirini AÇMAZ (fail-closed).',
  }, proven.length > 0 ? `VAR (${proven.length})` : 'YOK'));

  for (const r of rows) {
    f.push(observed({
      id: `sessionProbe:${r.tx}:${r.request ?? 'none'}`,
      label: `${r.tx} · ${r.request ?? 'gönderilmedi'}`,
      source: SRC_PROBE,
      note: 'Ham yanıt · ölçülen sonuç · NRC. Karar TS tarafında verilir; native yalnız kanıt taşır.',
    }, `${r.result}${r.nrc !== null ? ` · NRC 0x${r.nrc.toString(16).toUpperCase().padStart(2, '0')}` : ''}`
       + ` · rx=${r.raw ?? 'YOK'}`));
  }

  return _bound({ id: 'sessionProbe', title: KWP_SECTION_TITLE.sessionProbe, fields: f });
}

/**
 * P0-OBD-DIAG-01 — FİZİKSEL ADRESLEME MATRİSİ BÖLÜMÜ (SALT-OKUNUR).
 *
 * NEDEN AYRI BÖLÜM: sahadaki soru "0x18 gitti mi" DEĞİL, "bu ECU'ya fiziksel
 * istek HANGİ header ile ulaşıyor" idi. Matris tam olarak bunu ölçer ve cevabı
 * BURADA, satır satır gösterir: hangi header + hangi istek → hangi ham yanıt.
 *
 * KONTROL SATIRI AYRI OKUNUR: fiziksel satırların hepsi sustu VE kontrol de
 * sustuysa teşhis "adres yanlış" DEĞİL "hat matris sırasında ölmüş"tür.
 */
function _addressingSection(s: KwpRawSnapshot): KwpSection {
  const f: InspectorField[] = [];
  const SRC = 'obd/kwpAddressingProbe.getKwpAddressingProbes()';
  const rows = s.addressingProbes;

  if (rows === null || rows === undefined) {
    f.push(unavailable(
      { id: 'addressingLedger', label: 'adresleme matrisi defteri', source: SRC, note: '' },
      'Kanıt okunamadı.',
    ));
    return _bound({ id: 'addressing', title: KWP_SECTION_TITLE.addressing, fields: f });
  }

  if (rows.length === 0) {
    f.push(unavailable(
      { id: 'addressingLedger', label: 'adresleme matrisi defteri', source: SRC, note: '' },
      'Bu oturumda matris HİÇ koşmadı — yalnız tam araç taramasında ve yalnız '
      + 'fiziksel adres henüz kanıtlanmamışken çalışır. Bu "adres yanlış" DEMEK DEĞİLDİR.',
    ));
    return _bound({ id: 'addressing', title: KWP_SECTION_TITLE.addressing, fields: f });
  }

  const answered = rows.filter((r) => r.physical && (r.result === 'ANSWERED' || r.result === 'NEGATIVE'));
  const control  = rows.find((r) => !r.physical) ?? null;

  f.push(observed({
    id: 'addressingProven', label: 'fiziksel adres KANITI', source: SRC,
    note: 'Pozitif yanıt DA ayrık negatif yanıt DA adresin CANLI olduğunu kanıtlar; '
        + 'yalnız SESSİZLİK kanıt değildir (fail-closed).',
  }, answered.length > 0
      ? `VAR — ${answered[0]!.header}`
        + (answered[0]!.initFirst !== null
            ? ` (${answered[0]!.initFirst === 'FAST' ? 'ATFI' : 'ATSI'} BAŞLATMA GEREKTİ)` : '')
      : 'YOK'));

  f.push(control === null
    ? unavailable({ id: 'addressingControl', label: 'kontrol satırı (fonksiyonel)', source: SRC, note: '' },
        'Kontrol satırı kaydı yok.')
    : observed({
        id: 'addressingControl', label: 'kontrol satırı (fonksiyonel)', source: SRC,
        note: 'Matris sırasında hattın CANLI olduğunu kanıtlar. Bu satır da sustuysa '
            + 'fiziksel sessizlik "adres yanlış" KANITI DEĞİLDİR.',
      }, `${control.header} + ${control.request ?? 'gönderilmedi'} → ${control.result}`));

  for (const r of rows) {
    f.push(observed({
      id: `addressingRow:${r.variantId}`,
      label: `${r.physical ? 'fiziksel' : 'KONTROL'} · ${r.header}`
           + `${r.initFirst !== null ? ` + ${r.initFirst === 'FAST' ? 'ATFI' : 'ATSI'}` : ''}`
           + ` + ${r.request ?? '—'}`,
      source: SRC,
      note: 'ISO 14230-2: format baytının alt 6 biti VERİ UZUNLUĞUDUR. Satırlar tam '
          + 'olarak o alanın (ve servis seçiminin) etkisini ölçer.',
    }, `${r.result}${r.nrc !== null ? ` · NRC 0x${r.nrc.toString(16).toUpperCase().padStart(2, '0')}` : ''}`
       + ` · rx=${r.raw ?? 'YOK'}`
       /* P0-OBD-DIAG-03: başlatma düştüyse GEREKÇE burada görünür — "rx=YOK"
          tek başına teşhis edilemez bir düşüştür. */
       + (r.initRaw !== null ? ` · başlatma: ${r.initRaw}` : '')));
  }

  return _bound({ id: 'addressing', title: KWP_SECTION_TITLE.addressing, fields: f });
}

export function buildKwpSections(s: KwpRawSnapshot): KwpSection[] {
  const nowMs = s.readAt;
  return [
    _protocolSection(s),
    _sessionSection(s, nowMs),
    _recoverySection(s),
    _keepAliveSection(s),
    _dtcSection(s, nowMs),
    _sessionProbeSection(s),
    _addressingSection(s),
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
