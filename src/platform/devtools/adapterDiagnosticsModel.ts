/**
 * adapterDiagnosticsModel.ts — Adaptör Tanılama'nın SAF görünüm modeli (Faz A6).
 *
 * BU DOSYA YENİ BİR OTORİTE DEĞİLDİR: yeni bağlantı sağlığı motoru, kalite skoru ya
 * da birleşik "truth object" YAZMAZ. Mevcut iki motorun (obdService · ObdHealthMonitor)
 * çıktılarını SINIFLANDIRIR, ÇELİŞKİLERİ AÇIĞA ÇIKARIR ve fail-closed bir hüküm türetir.
 *
 * PARALEL MİMARİ YOK: gözlemlenebilirlik ilkelleri Session Inspector modelinden AYNEN
 * yeniden kullanılır — ikinci bir sınıflandırma sistemi kurulmaz.
 *
 * ── DÜRÜSTLÜK KURALLARI (pazarlıksız) ───────────────────────────────────────
 *  · `-1` sentinel'i ASLA sayı gibi basılmaz: `lastPacketAgeMs = -1` → "hiç paket
 *    yok", `connectionQuality = -1` → "hiç bağlanılmadı". "0" DEMEK DEĞİLDİR.
 *  · `0` SAYAÇ ile KAYNAK YOK ayrıdır: getter null döndüyse sayaç gösterilmez.
 *  · Damga yoksa "şimdi" YAZILMAZ.
 *  · `connected === true` TEK BAŞINA "SAĞLIKLI" hükmü VERMEZ.
 *  · `dataFresh` (adaptif pencere) ile `isStale` (MUTLAK 4 sn donma) KARIŞTIRILMAZ;
 *    ayrı alanlar, ayrı motorlar, çelişirlerse çelişki AÇIKÇA gösterilir.
 *  · RSSI · native buffer doluluğu · klon/orijinal adaptör hükmü · gelişmiş BLE
 *    tanısı için repoda KAYNAK YOKTUR → uydurulmaz, KAYNAK YOK olarak beyan edilir.
 *
 * SAF: I/O yok, timer yok, modül durumu yok. Kaynak okuma `adapterDiagnosticsSources.ts`te.
 */

import {
  observed, derived, unavailable,
  type InspectorField, type Observability,
} from './sessionInspectorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type AdSectionId = 'transport' | 'session' | 'lifecycle' | 'linkLoss' | 'limits';

export const AD_SECTION_ORDER: readonly AdSectionId[] = [
  'transport', 'session', 'lifecycle', 'linkLoss', 'limits',
] as const;

export const AD_SECTION_TITLE: Readonly<Record<AdSectionId, string>> = {
  transport: '1 · Transport',
  session:   '2 · OBD Oturumu',
  lifecycle: '3 · Yaşam Döngüsü',
  linkLoss:  '4 · Kopma Kanıtı (#536)',
  limits:    '5 · Kaynak Sınırları',
} as const;

export interface AdSection {
  readonly id:     AdSectionId;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

/** Bölüm başına azami alan — Mali-400 render bütçesi. */
export const MAX_FIELDS_PER_AD_SECTION = 24;
/** Hüküm gerekçesi tavanı — liste sınırsız büyümez. */
export const MAX_AD_REASONS = 8;

/**
 * Adaptör sağlık hükmü. FAIL-CLOSED sıralama: kanıt yoksa `UNKNOWN`.
 * `connected === true` tek başına `HEALTHY` ÜRETMEZ.
 */
export type AdVerdict =
  | 'UNKNOWN'
  | 'DISCONNECTED'
  | 'TRANSPORT_ONLY'
  | 'DATA_STALE'
  | 'DEGRADED'
  | 'HEALTHY';

export const AD_VERDICT_LABEL: Readonly<Record<AdVerdict, string>> = {
  UNKNOWN:        'BİLİNMİYOR',
  DISCONNECTED:   'BAĞLI DEĞİL',
  TRANSPORT_ONLY: 'TRANSPORT HAZIR / OTURUM HAZIR DEĞİL',
  DATA_STALE:     'VERİ BAYAT',
  DEGRADED:       'ZAYIF',
  HEALTHY:        'SAĞLIKLI',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham anlık görüntü sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

export interface AdTransportRaw {
  readonly transport:            string;
  readonly connected:            boolean;
  readonly reconnectAttempts:    number;
  readonly lastDisconnectReason: string | null;
}

export interface AdStatusRaw {
  readonly connectionState: string;
  readonly source:          string;
  readonly vehicleType:     string;
  readonly lastSeenAt:      number | null;
}

export interface AdDataRaw {
  readonly transportConnected: boolean;
  readonly dataFresh:          boolean;
  readonly lastRxAt:           number | null;
  /** Adaptör ADININ KENDİSİ taşınmaz — yalnız varlığı. */
  readonly adapterNamePresent: boolean;
}

export interface AdSessionRaw {
  readonly transportReady: boolean;
  readonly sessionReady:   boolean;
  readonly pollingActive:  boolean;
  readonly dataFresh:      boolean;
  readonly ready:          boolean;
}

export interface AdLifecycleRaw {
  readonly resetRequestedCount:     number;
  readonly resetCompletedCount:     number;
  readonly disconnectCalledCount:   number;
  readonly reconnectRequestedCount: number;
  readonly lastResetReason:         string | null;
  readonly lastResetAt:             number | null;
  readonly lastDisconnectAt:        number | null;
  readonly lastReconnectAt:         number | null;
  /**
   * #517 AD AYRIMI — **ECU verisi** yaşı (ms). ATRV (adaptör voltajı) HARİÇTİR:
   * ATRV, ECU ölse bile ~5 sn'de bir gelir ve donmayı maskelerdi. `-1` = hiç ECU
   * verisi yok (sentinel korunur, "0 ms" DEĞİL).
   */
  readonly lastEcuDataAgeMs:        number;
}

export interface AdHealthRaw {
  /** `-1` = bağlantı hiç kurulmadı (sentinel korunur). */
  readonly connectionQuality:     number;
  /**
   * #517 AD AYRIMI — kabul edilen **HERHANGİ** paketin yaşı (ms), **ATRV DAHİL**:
   * bu bir LİNK CANLILIĞI ölçüsüdür, ECU verisi yaşı DEĞİL. İkisi 20 kat
   * ayrışabilir ve bu bir ÇELİŞKİ DEĞİLDİR (link canlı, ECU susmuş).
   * `-1` = hiç paket yok (sentinel korunur).
   */
  readonly lastLinkPacketAgeMs:   number;
  /** MUTLAK 4 sn donma bayrağı — `dataFresh` ile AYNI ŞEY DEĞİLDİR. */
  readonly isStale:               boolean;
  readonly reconnectPressure:     number;
  readonly reliabilityFieldCount: number | null;
}

/**
 * #536 — KOPMA KANIT DEFTERİ ÖZETİ (GÖREV A).
 *
 * Bu blok yeni bir sağlık motoru DEĞİLDİR: `obd/linkLossLedger` saf modelinin
 * çıktısını taşır. Ekran kendi sınıflandırmasını YAPMAZ (ikinci otorite olmaz).
 * `null` = defter okunamadı — "kopma olmadı" DEMEK DEĞİLDİR.
 */
export interface AdLinkLossRaw {
  readonly total:                number;
  /** Kanıtla kurulan baskın aday. `null` = kanıt yetersiz (iddia YOK). */
  readonly dominant:             string | null;
  readonly unknownCount:         number;
  readonly pendingRecoveryCount: number;
  readonly medianRecoveryMs:     number | null;
  readonly maxRecoveryMs:        number | null;
  /** En çok eksik olan kanıt — bir sonraki turun ölçüm işi. `null` = boşluk yok. */
  readonly nextMeasurement:      string | null;
  /** Aday → adet (yalnız adedi >0 olanlar taşınır). */
  readonly candidates:           readonly { readonly key: string; readonly count: number }[];
  /** En YENİ kaydın insan-okur notu. `null` = hiç kayıt yok. */
  readonly lastNote:             string | null;
  readonly lastAtMs:             number | null;
}

export interface AdRawSnapshot {
  readonly readAt:        number;
  readonly transport:     AdTransportRaw | null;
  readonly status:        AdStatusRaw | null;
  readonly data:          AdDataRaw | null;
  readonly session:       AdSessionRaw | null;
  readonly freshWindowMs: number | null;
  readonly lifecycle:     AdLifecycleRaw | null;
  readonly health:        AdHealthRaw | null;
  readonly linkLoss:      AdLinkLossRaw | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kaynak künyeleri
 * ════════════════════════════════════════════════════════════════════════ */

const SRC = {
  trans:  'obdService.getTransportStats()',
  status: 'obdService.getOBDStatusSnapshot()',
  data:   'obdService.getOBDDataSnapshot()',
  sess:   'obdService.getObdSessionHealth()',
  fresh:  'obdService.getObdFreshWindowMs()',
  life:   'obdService.getObdConnLifecycle()',
  health: 'obd/ObdHealthMonitor.getObdHealth()',
  loss:   'obdService.getLinkLossLedger()',
  none:   'YOK',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Bölümler
 * ════════════════════════════════════════════════════════════════════════ */

function _transportSection(s: AdRawSnapshot): AdSection {
  const f: InspectorField[] = [];
  const t = s.transport;

  if (!t) {
    f.push(unavailable(
      { id: 'adTransport', label: 'transport türü', source: SRC.trans, note: '' },
      'Transport kaynağı okunamadı. Sayaçlar 0 GÖSTERİLMEZ — 0 ile "kaynak yok" AYRI şeydir.',
    ));
  } else {
    f.push(observed(
      { id: 'adTransport', label: 'transport türü', source: SRC.trans,
        note: 'Son bilinen taşıma katmanı (classic/ble/none).' },
      t.transport,
    ));
    f.push(observed(
      { id: 'adConnected', label: 'bağlı', source: SRC.trans,
        note: 'YALNIZ bağlantı durumudur — tek başına "sağlıklı" ANLAMINA GELMEZ.' },
      t.connected,
    ));
    f.push(observed(
      { id: 'adReconnectAttempts', label: 'reconnect denemesi', source: SRC.trans,
        note: 'Bu oturumdaki yeniden bağlanma denemesi sayısı.' },
      t.reconnectAttempts,
    ));
    f.push(t.lastDisconnectReason
      ? observed(
          { id: 'adLastDiscReason', label: 'son kopma nedeni', source: SRC.trans,
            note: 'Son tanı olayının hata kodu.' },
          t.lastDisconnectReason,
        )
      : unavailable(
          { id: 'adLastDiscReason', label: 'son kopma nedeni', source: SRC.trans, note: '' },
          'Kayıtlı kopma nedeni yok (bu oturumda kopma olmamış olabilir).',
        ));
  }

  // Adaptör kimliği: AD/ADRES/SERİ GÖSTERİLMEZ — yalnız varlık beyanı.
  f.push(s.data
    ? derived(
        { id: 'adAdapterName', label: 'adaptör kimliği', source: SRC.data,
          note: 'GİZLİLİK: adaptör adı/adresi EKRANA BASILMAZ; yalnız kayıtlı olup ' +
                'olmadığı gösterilir. Repo\'nun kendi transport tanısı da adres/ad taşımaz.' },
        s.data.adapterNamePresent ? 'kayıtlı (gösterilmez)' : 'kayıt yok',
      )
    : unavailable(
        { id: 'adAdapterName', label: 'adaptör kimliği', source: SRC.data, note: '' },
        'Veri anlık görüntüsü okunamadı.',
      ));

  f.push(s.status && s.status.lastSeenAt
    ? observed(
        { id: 'adLastSeenAt', label: 'son görülme', source: SRC.status, updatedAt: s.status.lastSeenAt,
          note: 'Son gerçek veri anı (duvar saati).' },
        new Date(s.status.lastSeenAt).toISOString(),
      )
    : unavailable(
        { id: 'adLastSeenAt', label: 'son görülme', source: SRC.status, note: '' },
        s.status ? 'Damga 0 — hiç gerçek veri görülmedi. "şimdi" YAZILMAZ.' : 'Kaynak okunamadı.',
      ));

  f.push(s.data && s.data.lastRxAt
    ? observed(
        { id: 'adLastRxAt', label: 'son alınan veri', source: SRC.data, updatedAt: s.data.lastRxAt,
          note: 'Adaptörden son yanıtın alındığı an.' },
        new Date(s.data.lastRxAt).toISOString(),
      )
    : unavailable(
        { id: 'adLastRxAt', label: 'son alınan veri', source: SRC.data, note: '' },
        s.data ? 'Damga 0 — hiç yanıt alınmadı. "şimdi" YAZILMAZ.' : 'Kaynak okunamadı.',
      ));

  return _bound({ id: 'transport', title: AD_SECTION_TITLE.transport, fields: f });
}

function _sessionSection(s: AdRawSnapshot): AdSection {
  const f: InspectorField[] = [];

  f.push(s.status
    ? observed(
        { id: 'adConnState', label: 'connection state', source: SRC.status,
          note: 'OBD bağlantı durum makinesi.' },
        s.status.connectionState,
      )
    : unavailable({ id: 'adConnState', label: 'connection state', source: SRC.status, note: '' },
        'Kaynak okunamadı.'));

  if (!s.session) {
    f.push(unavailable(
      { id: 'adSessionFlags', label: 'oturum bayrakları', source: SRC.sess, note: '' },
      'Oturum sağlığı okunamadı — transport/session/polling/fresh bayrakları false GÖSTERİLMEZ.',
    ));
  } else {
    f.push(observed(
      { id: 'adTransportReady', label: 'transport ready', source: SRC.sess,
        note: 'Native handle duruyor ve link canlı.' }, s.session.transportReady));
    f.push(observed(
      { id: 'adSessionReady', label: 'session ready', source: SRC.sess,
        note: 'Veri kapısı geçildi (ELM init + protokol + ilk gerçek ECU frame\'i).' },
      s.session.sessionReady));
    f.push(observed(
      { id: 'adPollingActive', label: 'polling active', source: SRC.sess,
        note: 'TS tarafı stale watchdog çalışıyor.' }, s.session.pollingActive));
    f.push(observed(
      { id: 'adDataFresh', label: 'data fresh (adaptif pencere)', source: SRC.sess,
        note: 'ADAPTİF tazelik kapısı. Aşağıdaki MUTLAK donma bayrağıyla AYNI ŞEY DEĞİLDİR.' },
      s.session.dataFresh));
  }

  f.push(s.freshWindowMs !== null
    ? observed(
        { id: 'adFreshWindow', label: 'tazelik penceresi (ms)', source: SRC.fresh,
          note: 'Aktif poll kadansından türer — sabit değildir.' },
        s.freshWindowMs,
      )
    : unavailable({ id: 'adFreshWindow', label: 'tazelik penceresi (ms)', source: SRC.fresh, note: '' },
        'Eşik okunamadı.'));

  /* İKİ AYRI MOTOR — birleştirilmez. */
  f.push(s.health
    ? observed(
        { id: 'adAbsStale', label: 'MUTLAK donma (4 sn eşiği)', source: SRC.health,
          note: 'ObdHealthMonitor\'ın AYRI hükmü: son paket 4 sn\'den eskiyse gösterge ' +
                '"donuk" sayılır. Adaptif dataFresh ile çelişebilir; birleştirilmez.' },
        s.health.isStale,
      )
    : unavailable({ id: 'adAbsStale', label: 'MUTLAK donma (4 sn eşiği)', source: SRC.health, note: '' },
        'Sağlık motoru okunamadı.'));

  if (s.session && s.health) {
    const disagree = s.session.dataFresh === s.health.isStale; // fresh=true & stale=true → çelişki
    f.push(derived(
      { id: 'adEngineAgreement', label: 'motorlar uyuşuyor mu', source: 'türetim (bu model)',
        note: 'dataFresh (adaptif) ile isStale (mutlak) mantıksal olarak zıt olmalı. ' +
              'Zıt DEĞİLSE iki motor farklı şey söylüyordur — hangisinin haklı olduğu ' +
              'BURADA KARARA BAĞLANMAZ, çelişki görünür kılınır.' },
      disagree ? 'ÇELİŞKİ' : 'uyumlu',
    ));
  }

  return _bound({ id: 'session', title: AD_SECTION_TITLE.session, fields: f });
}

function _lifecycleSection(s: AdRawSnapshot): AdSection {
  const f: InspectorField[] = [];
  const l = s.lifecycle;

  if (!l) {
    f.push(unavailable(
      { id: 'adLifecycle', label: 'yaşam döngüsü sayaçları', source: SRC.life, note: '' },
      'Kaynak okunamadı. Sayaçlar 0 GÖSTERİLMEZ — "hiç olmadı" ile "bilinmiyor" AYRI şeydir.',
    ));
    return _bound({ id: 'lifecycle', title: AD_SECTION_TITLE.lifecycle, fields: f });
  }

  f.push(observed({ id: 'adResetReq', label: 'reset istendi', source: SRC.life,
    note: 'Reset talebi sayısı.' }, l.resetRequestedCount));
  f.push(observed({ id: 'adResetDone', label: 'reset tamamlandı', source: SRC.life,
    note: 'Tamamlanan reset sayısı — istekle FARKI yarım kalan resetleri gösterir.' },
    l.resetCompletedCount));
  f.push(observed({ id: 'adDisconnects', label: 'disconnect çağrısı', source: SRC.life,
    note: 'Bağlantı kapatma çağrısı sayısı.' }, l.disconnectCalledCount));
  f.push(observed({ id: 'adReconnects', label: 'reconnect isteği', source: SRC.life,
    note: 'Yeniden bağlanma talebi sayısı.' }, l.reconnectRequestedCount));

  f.push(l.lastResetReason
    ? observed({ id: 'adLastResetReason', label: 'son reset nedeni', source: SRC.life,
        note: 'Son reset talebinin gerekçesi.' }, l.lastResetReason)
    : unavailable({ id: 'adLastResetReason', label: 'son reset nedeni', source: SRC.life, note: '' },
        'Kayıtlı reset nedeni yok.'));

  for (const [id, label, ts] of [
    ['adLastResetAt', 'son reset zamanı', l.lastResetAt],
    ['adLastDisconnectAt', 'son disconnect zamanı', l.lastDisconnectAt],
    ['adLastReconnectAt', 'son reconnect zamanı', l.lastReconnectAt],
  ] as const) {
    f.push(ts
      ? observed({ id, label, source: SRC.life, updatedAt: ts, note: 'Gerçek duvar-saati damgası.' },
          new Date(ts).toISOString())
      : unavailable({ id, label, source: SRC.life, note: '' },
          'Damga 0 — bu olay hiç gerçekleşmedi. "şimdi" YAZILMAZ.'));
  }

  // -1 sentinel: "hiç paket yok" — 0 ms DEĞİL.
  f.push(l.lastEcuDataAgeMs >= 0
    ? observed({ id: 'adEcuDataAge', label: 'son ECU verisi yaşı — ATRV HARİÇ', source: SRC.life,
        note: '#517: obdService `_lastRealDataMs` ölçümü. ATRV (adaptör voltajı) bu damgayı '
            + 'TAZELEMEZ — ECU donmasını maskelememesi için bilinçli olarak dışarıda.' },
        l.lastEcuDataAgeMs)
    : unavailable({ id: 'adEcuDataAge', label: 'son ECU verisi yaşı — ATRV HARİÇ', source: SRC.life, note: '' },
        'Hiç ECU verisi alınmadı (-1 sentinel). "0 ms" olarak GÖSTERİLMEZ.'));

  if (s.health) {
    f.push(s.health.lastLinkPacketAgeMs >= 0
      ? observed({ id: 'adLinkPacketAge', label: 'son LİNK paketi yaşı — ATRV DAHİL', source: SRC.health,
          note: '#517: ObdHealthMonitor ölçümü — kabul edilen HERHANGİ paket (ATRV dahil). '
              + 'Yukarıdaki ECU yaşından ÇOK KÜÇÜK olması ÇELİŞKİ DEĞİLDİR: link canlı, ECU susmuş '
              + 'demektir. İki sayı AYNI ŞEYİ ÖLÇMEZ.' },
          s.health.lastLinkPacketAgeMs)
      : unavailable({ id: 'adLinkPacketAge', label: 'son LİNK paketi yaşı — ATRV DAHİL', source: SRC.health, note: '' },
          'Hiç paket yok (-1 sentinel).'));

    f.push(s.health.connectionQuality >= 0
      ? observed({ id: 'adQuality', label: 'bağlantı kalitesi (0-100)', source: SRC.health,
          note: 'ObdHealthMonitor skoru — reconnect baskısı ve bayatlıkla cezalandırılır.' },
          s.health.connectionQuality)
      : unavailable({ id: 'adQuality', label: 'bağlantı kalitesi (0-100)', source: SRC.health, note: '' },
          'Bağlantı HİÇ kurulmadı (-1 sentinel). "0 puan" olarak GÖSTERİLMEZ.'));

    f.push(observed({ id: 'adReconnectPressure', label: 'reconnect baskısı', source: SRC.health,
      note: 'Sönümlü kopma sayacı (2 dk yarı-ömür).' }, s.health.reconnectPressure));

    f.push(s.health.reliabilityFieldCount !== null
      ? observed({ id: 'adReliabilityFields', label: 'veri görülen sinyal sayısı', source: SRC.health,
          note: 'Hiç veri görmemiş alanlar haritada YOKTUR; bu sayı gerçek kapsamı gösterir.' },
          s.health.reliabilityFieldCount)
      : unavailable({ id: 'adReliabilityFields', label: 'veri görülen sinyal sayısı', source: SRC.health, note: '' },
          'Güvenilirlik haritası okunamadı.'));
  }

  return _bound({ id: 'lifecycle', title: AD_SECTION_TITLE.lifecycle, fields: f });
}

/**
 * #536 · KOPMA KANITI — GÖREV A'nın gözlem yüzeyi.
 *
 * NE YAPAR: kopmanın hangi imzayla geldiğini (aday) ve neyi ÖLÇEMEDİĞİMİZİ
 * gösterir. NE YAPMAZ: kök neden İLAN ETMEZ. Baskın aday yoksa "belirsiz"
 * yazar — sahada dört adayın (adaptör · soket · ELM init · ECU uykusu) imzası
 * bazı durumlarda BİREBİR aynıdır ve orada hüküm vermek uydurma olur.
 */
function _linkLossSection(s: AdRawSnapshot): AdSection {
  const f: InspectorField[] = [];
  const l = s.linkLoss;

  if (!l) {
    f.push(unavailable(
      { id: 'adLossLedger', label: 'kopma defteri', source: SRC.loss, note: '' },
      'Defter okunamadı. "kopma olmadı" DEMEK DEĞİLDİR — 0 ile "bilinmiyor" AYRI şeydir.',
    ));
    return _bound({ id: 'linkLoss', title: AD_SECTION_TITLE.linkLoss, fields: f });
  }

  f.push(observed(
    { id: 'adLossTotal', label: 'kayıtlı kopma olayı', source: SRC.loss,
      note: 'Bounded defter (son 24). ECU susması da kayıtlıdır ama KOPMA SAYILMAZ.' },
    l.total,
  ));

  f.push(l.dominant !== null
    ? derived(
        { id: 'adLossDominant', label: 'baskın aday', source: SRC.loss,
          note: 'Yalnız pay ≥ %50 VE ikinciden AÇIK FARK varken bildirilir. ' +
                'Bu bir HÜKÜM değil, imza sınıfıdır.' },
        l.dominant,
      )
    : unavailable(
        { id: 'adLossDominant', label: 'baskın aday', source: SRC.loss, note: '' },
        l.total === 0
          ? 'Bu oturumda kayıtlı kopma yok — aday üretilmez.'
          : 'Kanıt baskın bir aday göstermiyor. "muhtemelen X" YAZILMAZ.',
      ));

  for (const c of l.candidates) {
    f.push(observed(
      { id: `adLossCand_${c.key}`, label: `aday · ${c.key}`, source: SRC.loss,
        note: 'Kurtarma kanıtıyla keskinleşmiş aday sayısı.' },
      c.count,
    ));
  }

  f.push(observed(
    { id: 'adLossUnknown', label: 'kanıt yetersiz kayıt', source: SRC.loss,
      note: 'Aday kurulamayan kopma sayısı. Bu sayı YÜKSEKSE eksik olan ÖLÇÜMDÜR, ' +
            'düzeltme değil (kör düzeltme yasak).' },
    l.unknownCount,
  ));

  f.push(observed(
    { id: 'adLossPending', label: 'kurtarması bekleyen', source: SRC.loss,
      note: 'Kopmadan sonra HENÜZ başarılı handshake görülmemiş kayıt. ' +
            '"kurtuldu" iddiası kanıt olmadan üretilmez.' },
    l.pendingRecoveryCount,
  ));

  for (const [id, label, v] of [
    ['adLossRecMedian', 'kurtarma süresi (ortanca, ms)', l.medianRecoveryMs],
    ['adLossRecMax',    'kurtarma süresi (en uzun, ms)', l.maxRecoveryMs],
  ] as const) {
    f.push(v !== null
      ? observed({ id, label, source: SRC.loss,
          note: 'Kopmadan başarılı handshake\'e geçen süre. Hızlı + denemesiz kurtarma ' +
                'SOKET düşüşü, yavaş/denemeli kurtarma ADAPTÖR erişilemezliği imzasıdır.' }, v)
      : unavailable({ id, label, source: SRC.loss, note: '' },
          'Hiç kurtarma ölçülmedi — "0 ms" olarak GÖSTERİLMEZ.'));
  }

  f.push(l.nextMeasurement !== null
    ? derived(
        { id: 'adLossNextMeasure', label: 'önce ölçülmesi gereken', source: SRC.loss,
          note: 'Kararı en çok engelleyen eksik kanıt. GÖREV A\'nın iş listesi budur.' },
        l.nextMeasurement,
      )
    : unavailable(
        { id: 'adLossNextMeasure', label: 'önce ölçülmesi gereken', source: SRC.loss, note: '' },
        l.total === 0 ? 'Kayıt yok — eksik kanıt listesi de yok.' : 'Kanıt boşluğu kalmadı.',
      ));

  f.push(l.lastNote !== null
    ? observed(
        { id: 'adLossLast', label: 'son kayıt', source: SRC.loss,
          updatedAt: l.lastAtMs ?? undefined,
          note: 'Defterin en yeni satırı (insan-okur). PII taşımaz.' },
        l.lastNote,
      )
    : unavailable({ id: 'adLossLast', label: 'son kayıt', source: SRC.loss, note: '' },
        'Defter boş.'));

  return _bound({ id: 'linkLoss', title: AD_SECTION_TITLE.linkLoss, fields: f });
}

/**
 * Kaynak sınırları — TAMAMEN UNAVAILABLE ve bu BİLİNÇLİDİR.
 * Bu alanlar için repoda HİÇBİR getter yoktur; değer üretmek uydurma olurdu.
 */
function _limitsSection(): AdSection {
  const f: InspectorField[] = [
    unavailable(
      { id: 'adRssi', label: 'sinyal gücü (RSSI)', source: SRC.none, note: '' },
      'JS\'e açılmış RSSI kaynağı YOK. Bluetooth sinyal gücü native tarafta bile ' +
      'raporlanmıyor — tahmin üretmek ölçüm gibi görünürdü.',
    ),
    unavailable(
      { id: 'adBuffer', label: 'native buffer doluluğu', source: SRC.none, note: '' },
      'Native okuma tamponunun doluluğu JS\'e açılmamıştır. Boş varsaymak da dolu ' +
      'varsaymak da yanlış olurdu.',
    ),
    unavailable(
      { id: 'adClone', label: 'klon / orijinal adaptör', source: SRC.none, note: '' },
      'Klon tespiti için kanıt (ELM sürüm dizesi, çip imzası) JS\'e açılmamıştır. ' +
      'Davranıştan "klon" hükmü çıkarmak spekülasyondur.',
    ),
    unavailable(
      { id: 'adBleAdvanced', label: 'gelişmiş BLE tanısı (MTU/GATT)', source: SRC.none, note: '' },
      'MTU, GATT servis/karakteristik listesi ve bağlantı aralığı native tarafta ' +
      'kalıyor; JS getter\'ı YOK.',
    ),
    unavailable(
      { id: 'adFirmware', label: 'adaptör firmware / seri no', source: SRC.none, note: '' },
      'Adaptör kimlik sorgusu (ATI/ATZ) KOMUT GÖNDERMEYİ gerektirir — bu ekran ' +
      'salt-okunurdur ve komut göndermez. Kayıtlı bir kimlik getter\'ı da yoktur.',
    ),
  ];
  return _bound({ id: 'limits', title: AD_SECTION_TITLE.limits, fields: f });
}

/** Tüm bölümler, sabit sırada. */
export function buildAdSections(s: AdRawSnapshot): AdSection[] {
  return [
    _transportSection(s),
    _sessionSection(s),
    _lifecycleSection(s),
    _linkLossSection(s),
    _limitsSection(),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sağlık hükmü — FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

export interface AdVerdictResult {
  readonly status:  AdVerdict;
  readonly reasons: readonly string[];
}

/**
 * Hüküm sırası (ilk eşleşen kazanır):
 *   1. Oturum VE transport kaynağı yok            → UNKNOWN
 *   2. Bağlı değil / transport hazır değil        → DISCONNECTED
 *   3. Transport hazır ama oturum hazır değil     → TRANSPORT_ONLY
 *   4. Veri bayat (adaptif VEYA mutlak)           → DATA_STALE
 *   5. Baskı/çelişki/kalite düşüklüğü var         → DEGRADED
 *   6. Aksi hâlde                                 → HEALTHY
 *
 * `connected === true` TEK BAŞINA HEALTHY üretmez: 3, 4 ve 5. kurallar önce çalışır.
 */
export function deriveAdVerdict(s: AdRawSnapshot): AdVerdictResult {
  const reasons: string[] = [];
  const push = (r: string) => { if (reasons.length < MAX_AD_REASONS) reasons.push(r); };

  const t = s.transport;
  const sess = s.session;

  if (!t && !sess) {
    push('Transport ve oturum kaynaklarının İKİSİ de okunamadı — hüküm kurulamaz.');
    return { status: 'UNKNOWN', reasons };
  }

  const connected      = t ? t.connected : null;
  const transportReady = sess ? sess.transportReady : null;

  if (connected === false || transportReady === false) {
    if (connected === false)      push('Transport bağlı değil.');
    if (transportReady === false) push('Native handle yok ya da link ölü (transport ready = false).');
    if (t && t.lastDisconnectReason) push(`Son kopma nedeni: ${t.lastDisconnectReason}.`);
    return { status: 'DISCONNECTED', reasons };
  }

  if (connected === null && transportReady === null) {
    push('Bağlantı durumu okunamadı — "bağlı" VARSAYILMAZ.');
    return { status: 'UNKNOWN', reasons };
  }

  if (sess && sess.transportReady && !sess.sessionReady) {
    push('Transport hazır ama veri kapısı geçilmedi (session ready = false).');
    push('ELM init / protokol seçimi / ilk gerçek ECU frame\'i henüz tamamlanmadı.');
    return { status: 'TRANSPORT_ONLY', reasons };
  }

  const adaptiveStale = sess ? sess.dataFresh === false : null;
  const absoluteStale = s.health ? s.health.isStale : null;

  if (adaptiveStale === true || absoluteStale === true) {
    if (adaptiveStale === true) push('Adaptif tazelik kapısı KAPALI (dataFresh = false).');
    if (absoluteStale === true) push('MUTLAK donma bayrağı AÇIK (son paket 4 sn\'den eski).');
    if (adaptiveStale === false && absoluteStale === true) {
      push('İki motor ÇELİŞİYOR: adaptif pencere "taze" derken mutlak eşik "donuk" diyor.');
    }
    return { status: 'DATA_STALE', reasons };
  }

  /* POZİTİF KANIT ŞARTI: SAĞLIKLI hükmü ancak oturum kaynağı GERÇEKTEN okunup
     hazır olduğunu söylediğinde verilir. Oturum kaynağı yokken "bağlı" olmak
     tek başına sağlık kanıtı DEĞİLDİR — fail-closed olarak BİLİNMİYOR kalır. */
  if (!sess) {
    push('Oturum sağlığı okunamadı — "bağlı" olmak TEK BAŞINA sağlıklı kanıtı değildir.');
    return { status: 'UNKNOWN', reasons };
  }
  if (!sess.sessionReady) {
    push('Oturum hazır değil (session ready = false).');
    return { status: 'TRANSPORT_ONLY', reasons };
  }

  if (!sess.pollingActive) push('Poll watchdog çalışmıyor (polling active = false).');
  if (t && t.reconnectAttempts > 0) push(`Bu oturumda ${t.reconnectAttempts} reconnect denemesi oldu.`);
  if (s.health && s.health.reconnectPressure > 0) {
    push(`Reconnect baskısı ${s.health.reconnectPressure.toFixed(2)} (sönümlü kopma sayacı).`);
  }
  if (s.lifecycle && s.lifecycle.resetRequestedCount > s.lifecycle.resetCompletedCount) {
    push('Yarım kalan reset var (istenen > tamamlanan).');
  }
  if (s.health && s.health.connectionQuality >= 0 && s.health.connectionQuality < 60) {
    push(`Bağlantı kalitesi düşük (${s.health.connectionQuality}/100).`);
  }

  if (reasons.length > 0) return { status: 'DEGRADED', reasons };

  push('Transport bağlı, oturum hazır, veri taze ve kopma baskısı yok.');
  return { status: 'HEALTHY', reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _bound(section: AdSection): AdSection {
  if (!section || !Array.isArray(section.fields)) return section;
  if (section.fields.length <= MAX_FIELDS_PER_AD_SECTION) return section;
  return { ...section, fields: section.fields.slice(0, MAX_FIELDS_PER_AD_SECTION) };
}

/** Sınıf başına alan sayısı (özet rozetleri). */
export function countByAdClass(sections: readonly AdSection[]): Record<Observability, number> {
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
