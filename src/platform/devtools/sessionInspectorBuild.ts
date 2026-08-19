/**
 * sessionInspectorBuild.ts — ham anlık görüntü → kart/alan dönüşümü (TAMAMEN SAF).
 *
 * Hiçbir servisi import ETMEZ: girdi yapısal (structural) bir tiptir. Böylece tüm
 * sınıflandırma (OBSERVED/DERIVED/UNAVAILABLE/STALE), çelişki tespiti ve özet
 * türetimi jsdom'da servis mock'u olmadan test edilebilir.
 *
 * DÜRÜSTLÜK KURALLARI (kod içinde uygulanır):
 *  - Kaynağı olmayan alan UNAVAILABLE; uydurma değer/timestamp YOK.
 *  - Yalnız GERÇEK duvar-saati damgası olan alanlarda bayatlık hesaplanır.
 *  - Monotonik (worker performance.now) damgalar bayatlık hesabına GİRMEZ.
 *  - Aynı kavramın iki kaynağı sessizce birleştirilmez; ikisi de ayrı alan olur.
 */

import {
  observed, derived, unavailable, applyStaleness,
  type InspectorCard, type InspectorField,
  type MismatchInput, type SessionHealthInput,
  INSPECTOR_CARD_TITLE, boundCard,
} from './sessionInspectorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Ham anlık görüntü — YAPISAL tip (servis importu yok)
 * ════════════════════════════════════════════════════════════════════════ */

export interface SessionRawSnapshot {
  /** Okuma anı (Unix ms). */
  readonly readAt: number;

  readonly obdStatus: {
    connectionState: string; source: string; vehicleType: string; lastSeenMs: number;
  } | null;

  readonly obdData: {
    transportConnected: boolean; dataFresh: boolean; lastRxAt: number; lastSeenMs: number;
    source: string; connectionState: string;
  } | null;

  readonly sessionHealth: {
    transportReady: boolean; sessionReady: boolean; pollingActive: boolean;
    dataFresh: boolean; ready: boolean;
  } | null;

  /**
   * #526 — İLK VERİYE KADAR GEÇEN SÜRE. Saha şikâyeti: "ilk 2 dakika veri yok".
   * `null` alanlar ÖLÇÜLEMEDİ demektir (sahte 0 yok).
   */
  readonly firstDataTiming: {
    connectStartedAt: number | null;
    firstDataAt: number | null;
    firstDataAfterConnectMs: number | null;
    failedAttemptsBeforeData: number;
    waitingForFirstDataMs: number | null;
  } | null;

  readonly connLifecycle: {
    resetRequestedCount: number; resetCompletedCount: number;
    disconnectCalledCount: number; reconnectRequestedCount: number;
    lastResetReason: string | null;
    lastResetAt: number; lastDisconnectAt: number; lastReconnectAt: number;
    connectionState: string;
    /** ECU verisi yaşı — ATRV HARİÇ (#517 ad ayrımı). */
    lastEcuDataAgeMs: number;
  } | null;

  readonly transportStats: {
    transport: string; connected: boolean;
    reconnectAttempts: number; lastDisconnectReason: string | null;
  } | null;

  readonly handshake: {
    outcome: string; ranAt: number | null; vinPresent: boolean; vinClass: string | null;
    bitmapClass: string | null; readBlocksCount: number; supportedCount: number;
    failReason: string | null; timeoutStage: string | null; durationMs: number | null;
    protocolTried: string | null; protocolActive: string | null;
    lastSuccessAt: number | null; reconnectReason: string | null; reconnectHistoryCount: number;
  } | null;

  readonly health: {
    connectionQuality: number;
    /** HERHANGİ kabul edilen paketin yaşı — ATRV DAHİL, link canlılığı (#517). */
    lastLinkPacketAgeMs: number;
    isStale: boolean; reconnectPressure: number;
  } | null;

  /** Repoda TANIMLI tazelik penceresi (ms). null = okunamadı. */
  readonly freshWindowMs: number | null;

  /** Sayaçlar `null` olabilir: native alan yoksa sahte 0 ÜRETİLMEZ (E-19). */
  readonly kwp: {
    status: string;
    coreNoDataStreak: number | null; maxCoreNoDataStreak: number | null;
    recoveryCount: number | null; suppressedCount: number | null;
    /** #642 — tavan kararının baktığı sayaç; `null` = native vermiyor (BİLİNMİYOR). */
    consecutiveFailedRecoveries: number | null;
    atpcSendFailures: number | null; lastRecoveryAt: number | null;
    lastRecoveryToFirstPidMs: number | null; killedByDataGate: number | null;
    protocolAtRecovery: string | null; threshold: number | null;
    maxPerSession: number | null;
  } | null;

  readonly hal: {
    halConnected: boolean; halConf: number; activeSource: string | null;
    canPhase: string; canRetryCount: number;
    /** null = BİLİNMİYOR (worker hiç bildirmedi) — false (ÖLÜ) ile karıştırılmaz. */
    canAlive: boolean | null; obdAlive: boolean | null; gpsAlive: boolean | null;
    /** ⚠ MONOTONİK worker saati (performance.now) — duvar saati DEĞİL. */
    sourceHealthUpdatedAtMono: number | null;
  } | null;

  readonly connectivity: readonly {
    source: string; available: boolean; connected: boolean;
    confidence: number; lastSignalAt: number; errorReason: string | null;
  }[] | null;

  readonly capture: { obdRefs: number; canRefs: number } | null;

  readonly debug: {
    collecting: boolean; trafficBufferLen: number; trafficBufferMax: number;
    listenerCount: number; obdDropped: number;
    /** Bu alanları YAZAN kod yok — dürüstlük için ayrı bayrak. */
    hzCountersWritten: false;
    fallbackWritten: false;
  } | null;
}

/* ── Kaynak etiketleri (gerçek dosya/fonksiyon) ───────────────────────────── */

/**
 * `null` → "KAYNAK YOK". Birleşik metinlerde sahte 0 yazmamak için (E-19):
 * "0 / 3" ile "ölçülemedi / ölçülemedi" ekranda AYRI görünmelidir.
 */
function _nz(v: number | null): string {
  return v === null ? 'KAYNAK YOK' : String(v);
}

const SRC = {
  status:    'obdService.getOBDStatusSnapshot()',
  data:      'obdService.getOBDDataSnapshot()',
  session:   'obdService.getObdSessionHealth()',
  lifecycle: 'obdService.getObdConnLifecycle()',
  transport: 'obdService.getTransportStats()',
  handshake: 'obdService.getHandshakeDiagnostics()',
  health:    'obd/ObdHealthMonitor.getObdHealth()',
  fresh:     'obdService.getObdFreshWindowMs()',
  kwp:       'obd/kwpRecoveryEvidence.getKwpRecoveryEvidence()',
  hal:       'vehicleDataLayer/halStatusStore',
  conn:      'canBus/VehicleConnectivityManager.getConnectivitySnapshot()',
  capture:   'devtools/devtoolsCapture.getDevtoolsCaptureStatus()',
  debug:     'platform/debug/debugStore',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Kart 1 — Transport / Adapter
 * ════════════════════════════════════════════════════════════════════════ */

function _transportCard(s: SessionRawSnapshot): InspectorCard {
  const f: InspectorField[] = [];
  const fresh = typeof s.freshWindowMs === 'number' ? s.freshWindowMs : 0;

  f.push(observed(
    { id: 'connectionState', label: 'connectionState', source: SRC.status,
      note: 'Tek alanda 4 gerçeği taşıyan eski alan; tek başına "sağlıklı" kanıtı DEĞİL.' },
    s.obdStatus?.connectionState ?? null,
  ));

  f.push(observed(
    { id: 'transportConnected', label: 'transportConnected', source: SRC.data,
      note: 'RFCOMM/GATT/TCP linki doğrulanmış canlı mı (ATRV dahil paket geliyor mu).' },
    s.obdData ? s.obdData.transportConnected : null,
  ));

  f.push(observed(
    { id: 'transportKind', label: 'transport türü', source: SRC.transport,
      note: '"none" = son bilinen transport yok. Adres/cihaz adı gizlilik gereği okunmaz.' },
    s.transportStats?.transport ?? null,
  ));

  f.push(applyStaleness(observed(
    { id: 'lastRxAt', label: 'son native paket (link heartbeat)', source: SRC.data,
      note: 'Herhangi bir native paket (ATRV dahil). Eşik: getObdFreshWindowMs().',
      updatedAt: s.obdData?.lastRxAt ?? null },
    s.obdData?.lastRxAt ? new Date(s.obdData.lastRxAt).toISOString() : null,
  ), s.readAt, fresh));

  f.push(observed(
    { id: 'reconnectAttempts', label: 'reconnect denemesi', source: SRC.transport,
      note: 'Oturum içi sayaç.' },
    s.transportStats?.reconnectAttempts ?? null,
  ));

  f.push(s.transportStats?.lastDisconnectReason
    ? observed(
        { id: 'lastDisconnectReason', label: 'son kopma nedeni', source: SRC.transport,
          note: 'Sınıflandırılmış hata kodu (ham log değil).' },
        s.transportStats.lastDisconnectReason,
      )
    : unavailable(
        { id: 'lastDisconnectReason', label: 'son kopma nedeni', source: SRC.transport, note: '' },
        'Bu oturumda sınıflandırılmış kopma nedeni kaydedilmedi.',
      ));

  if (s.connLifecycle) {
    const l = s.connLifecycle;
    f.push(observed(
      { id: 'lifecycleCounters', label: 'reset / disconnect / reconnect', source: SRC.lifecycle,
        note: 'Bounded yaşam-döngüsü sayaçları (istendi/tamamlandı ayrımı korunur).' },
      `${l.resetRequestedCount}/${l.resetCompletedCount} · ${l.disconnectCalledCount} · ${l.reconnectRequestedCount}`,
    ));
    f.push(l.lastResetReason
      ? observed(
          { id: 'lastResetReason', label: 'son reset nedeni', source: SRC.lifecycle,
            note: 'Reset ≠ Forget; yalnız oturum sıfırlaması.', updatedAt: l.lastResetAt || null },
          l.lastResetReason,
        )
      : unavailable(
          { id: 'lastResetReason', label: 'son reset nedeni', source: SRC.lifecycle, note: '' },
          'Bu oturumda reset kaydı yok.',
        ));
    f.push(l.lastEcuDataAgeMs >= 0
      ? observed(
          { id: 'lastEcuDataAgeMs', label: 'son ECU verisi yaşı (ms) — ATRV HARİÇ', source: SRC.lifecycle,
            note: 'Yalnız GERÇEK veri; ATRV heartbeat sayılmaz.' },
          l.lastEcuDataAgeMs,
        )
      : unavailable(
          { id: 'lastEcuDataAgeMs', label: 'son ECU verisi yaşı (ms) — ATRV HARİÇ', source: SRC.lifecycle, note: '' },
          'Hiç gerçek veri paketi alınmadı (-1).',
        ));
  } else {
    f.push(unavailable(
      { id: 'lifecycleCounters', label: 'reset / disconnect / reconnect', source: SRC.lifecycle, note: '' },
      'Yaşam-döngüsü kaynağı okunamadı.',
    ));
  }

  return boundCard({ id: 'transport', title: INSPECTOR_CARD_TITLE.transport, fields: f });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kart 2 — Protocol / Handshake
 * ════════════════════════════════════════════════════════════════════════ */

function _protocolCard(s: SessionRawSnapshot): InspectorCard {
  const f: InspectorField[] = [];
  const h = s.handshake;

  if (!h) {
    f.push(unavailable(
      { id: 'handshake', label: 'handshake', source: SRC.handshake, note: '' },
      'Handshake teşhis kaynağı okunamadı.',
    ));
    return boundCard({ id: 'protocol', title: INSPECTOR_CARD_TITLE.protocol, fields: f });
  }

  f.push(observed(
    { id: 'handshakeOutcome', label: 'handshake sonucu', source: SRC.handshake,
      note: 'Son denemenin sınıflandırılmış sonucu.', updatedAt: h.ranAt },
    h.outcome,
  ));

  f.push(h.ranAt
    ? observed(
        { id: 'handshakeRanAt', label: 'handshake çalışma zamanı', source: SRC.handshake,
          note: 'Gerçek duvar-saati damgası; bunun için TANIMLI bayatlık eşiği YOK → STALE hesaplanmaz.',
          updatedAt: h.ranAt },
        new Date(h.ranAt).toISOString(),
      )
    : unavailable(
        { id: 'handshakeRanAt', label: 'handshake çalışma zamanı', source: SRC.handshake, note: '' },
        'Handshake bu oturumda hiç çalışmadı.',
      ));

  f.push(h.protocolTried
    ? observed(
        { id: 'protocolTried', label: 'zorlanan protokol (ATSP)', source: SRC.handshake,
          note: 'Önbellek/döngüden gelen ZORLANAN protokol.' },
        h.protocolTried,
      )
    : unavailable(
        { id: 'protocolTried', label: 'zorlanan protokol (ATSP)', source: SRC.handshake, note: '' },
        'Protokol zorlanmadı veya kaydedilmedi.',
      ));

  f.push(h.protocolActive
    ? observed(
        { id: 'protocolActive', label: 'aktif protokol (ATDPN)', source: SRC.handshake,
          note: 'ADAPTÖRDEN OKUNAN gerçek protokol.' },
        h.protocolActive,
      )
    : unavailable(
        { id: 'protocolActive', label: 'aktif protokol (ATDPN)', source: SRC.handshake, note: '' },
        'ATDPN okunmadı — aktif protokol BİLİNMİYOR (varsayım yapılmaz).',
      ));

  // DERIVED — kuralı notta açık
  if (h.protocolTried && h.protocolActive) {
    f.push(derived(
      { id: 'protocolMatch', label: 'protokol tutarlılığı', source: `${SRC.handshake} (tried vs active)`,
        note: 'KURAL: protocolTried === protocolActive → EŞLEŞİYOR, aksi → FARKLI (araç değişimi göstergesi).' },
      h.protocolTried === h.protocolActive ? 'EŞLEŞİYOR' : 'FARKLI',
    ));
  } else {
    f.push(unavailable(
      { id: 'protocolMatch', label: 'protokol tutarlılığı', source: SRC.handshake, note: '' },
      'İki protokol alanından biri yok — karşılaştırma yapılamaz.',
    ));
  }

  f.push(observed(
    { id: 'vinPresent', label: 'VIN yanıtı var mı', source: SRC.handshake,
      note: 'Yalnız var-olma bayrağı; ham VIN OKUNMAZ.' },
    h.vinPresent,
  ));
  f.push(observed(
    { id: 'bitmapClass', label: '0100 bitmap sınıfı', source: SRC.handshake, note: 'Zorunlu bitmap yanıt sınıfı.' },
    h.bitmapClass,
  ));
  f.push(observed(
    { id: 'supportedCount', label: 'desteklenen PID sayısı', source: SRC.handshake, note: 'Handshake sonucu.' },
    h.supportedCount,
  ));
  f.push(observed(
    { id: 'readBlocksCount', label: 'yanıt veren bitmap bloğu', source: SRC.handshake, note: 'Blok sayısı.' },
    h.readBlocksCount,
  ));
  f.push(h.failReason
    ? observed({ id: 'failReason', label: 'başarısızlık nedeni', source: SRC.handshake, note: 'Sınıflandırılmış.' }, h.failReason)
    : unavailable({ id: 'failReason', label: 'başarısızlık nedeni', source: SRC.handshake, note: '' }, 'Başarısızlık kaydı yok.'));
  f.push(h.timeoutStage
    ? observed({ id: 'timeoutStage', label: 'timeout aşaması', source: SRC.handshake, note: 'Hangi aşamada takıldı.' }, h.timeoutStage)
    : unavailable({ id: 'timeoutStage', label: 'timeout aşaması', source: SRC.handshake, note: '' }, 'Timeout olmadı.'));
  f.push(h.durationMs !== null
    ? observed({ id: 'handshakeDuration', label: 'handshake süresi (ms)', source: SRC.handshake, note: 'connect→sonuç.' }, h.durationMs)
    : unavailable({ id: 'handshakeDuration', label: 'handshake süresi (ms)', source: SRC.handshake, note: '' }, 'Süre ölçülmedi.'));
  f.push(h.lastSuccessAt
    ? observed(
        { id: 'lastSuccessAt', label: 'son BAŞARILI handshake', source: SRC.handshake,
          note: 'Gerçek damga; tanımlı bayatlık eşiği YOK → STALE hesaplanmaz.', updatedAt: h.lastSuccessAt },
        new Date(h.lastSuccessAt).toISOString(),
      )
    : unavailable({ id: 'lastSuccessAt', label: 'son BAŞARILI handshake', source: SRC.handshake, note: '' }, 'Hiç başarılı handshake olmadı.'));
  f.push(observed(
    { id: 'reconnectHistoryCount', label: 'reconnect geçmişi (bounded)', source: SRC.handshake, note: 'Kayıt sayısı.' },
    h.reconnectHistoryCount,
  ));

  return boundCard({ id: 'protocol', title: INSPECTOR_CARD_TITLE.protocol, fields: f });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kart 3 — Data Gate / Polling
 * ════════════════════════════════════════════════════════════════════════ */

function _dataGateCard(s: SessionRawSnapshot): InspectorCard {
  const f: InspectorField[] = [];
  const sh = s.sessionHealth;
  const fresh = typeof s.freshWindowMs === 'number' ? s.freshWindowMs : 0;

  f.push(sh
    ? observed({ id: 'sessionReady', label: 'DATA GATE geçildi (sessionReady)', source: SRC.session,
        note: 'ELM init + protokol + İLK gerçek ECU frame tamam mı.' }, sh.sessionReady)
    : unavailable({ id: 'sessionReady', label: 'DATA GATE geçildi (sessionReady)', source: SRC.session, note: '' }, 'Oturum sağlığı okunamadı.'));

  f.push(sh
    ? observed({ id: 'pollingActive', label: 'poll watchdog aktif', source: SRC.session,
        note: 'TS-tarafı stale watchdog zamanlayıcısı çalışıyor mu (canlı oturum kanıtı).' }, sh.pollingActive)
    : unavailable({ id: 'pollingActive', label: 'poll watchdog aktif', source: SRC.session, note: '' }, 'Okunamadı.'));

  f.push(sh
    ? observed({ id: 'transportReady', label: 'transportReady', source: SRC.session,
        note: 'Native handle sayısı > 0 VE transportConnected.' }, sh.transportReady)
    : unavailable({ id: 'transportReady', label: 'transportReady', source: SRC.session, note: '' }, 'Okunamadı.'));

  f.push(sh
    ? observed({ id: 'dataFresh', label: 'dataFresh', source: SRC.session,
        note: 'Kadans-göreli tazelik (ObdHealthMonitor.isStale AYRI motordur).' }, sh.dataFresh)
    : unavailable({ id: 'dataFresh', label: 'dataFresh', source: SRC.session, note: '' }, 'Okunamadı.'));

  f.push(sh
    ? observed({ id: 'sessionReadyAll', label: 'ready (dört eksen birden)', source: SRC.session,
        note: 'transportReady && sessionReady && pollingActive && dataFresh.' }, sh.ready)
    : unavailable({ id: 'sessionReadyAll', label: 'ready (dört eksen birden)', source: SRC.session, note: '' }, 'Okunamadı.'));

  f.push(applyStaleness(observed(
    { id: 'lastSeenMs', label: 'son GEÇERLİ ECU frame', source: SRC.status,
      note: 'ATRV hariç. Eşik: getObdFreshWindowMs() (protokol + aktif kadanstan türer).',
      updatedAt: s.obdStatus?.lastSeenMs ?? null },
    s.obdStatus?.lastSeenMs ? new Date(s.obdStatus.lastSeenMs).toISOString() : null,
  ), s.readAt, fresh));

  f.push(s.freshWindowMs !== null
    ? observed({ id: 'freshWindowMs', label: 'tazelik penceresi (ms)', source: SRC.fresh,
        note: 'Bu ekrandaki TEK bayatlık eşiği; uydurma eşik kullanılmaz.' }, s.freshWindowMs)
    : unavailable({ id: 'freshWindowMs', label: 'tazelik penceresi (ms)', source: SRC.fresh, note: '' }, 'Okunamadı.'));

  f.push(observed(
    { id: 'dataSource', label: 'veri kaynağı', source: SRC.status,
      note: "'real' = gerçek ECU · 'mock' = simüle · 'none' = kaynak yok." },
    s.obdStatus?.source ?? null,
  ));

  if (s.health) {
    f.push(s.health.connectionQuality >= 0
      ? observed({ id: 'connectionQuality', label: 'bağlantı kalitesi (0-100)', source: SRC.health, note: 'Sönümlü kalite skoru.' }, s.health.connectionQuality)
      : unavailable({ id: 'connectionQuality', label: 'bağlantı kalitesi (0-100)', source: SRC.health, note: '' }, 'Bağlantı hiç kurulmadı (-1).'));
    f.push(observed({ id: 'isStale', label: 'isStale (MUTLAK donma)', source: SRC.health,
      note: 'connectionQuality\'den BAĞIMSIZ mutlak donma sinyali — dataFresh ile çelişebilir.' }, s.health.isStale));
    f.push(observed({ id: 'reconnectPressure', label: 'reconnect baskısı', source: SRC.health, note: 'Sönümlü sayaç (2dk yarı-ömür).' }, s.health.reconnectPressure));
  } else {
    f.push(unavailable({ id: 'health', label: 'ObdHealthMonitor', source: SRC.health, note: '' }, 'Sağlık kaynağı okunamadı.'));
  }

  // Gerçekten kaynağı OLMAYAN alanlar — uydurma yerine yokluk beyanı
  f.push(unavailable(
    { id: 'pollCadence', label: 'poll kadansı / scheduler durumu', source: 'YOK', note: '' },
    'AdaptivePollingController için dışa açık senkron snapshot getter YOK. Poll Scheduler ekranı ayrı iştir (Faz A4).',
  ));
  f.push(unavailable(
    { id: 'commandQueue', label: 'komut kuyruğu derinliği', source: 'YOK', note: '' },
    'Kuyruk native tarafta; JS\'e açılmış senkron sayaç YOK. Queue Monitor ekranı ayrı iştir (Faz A4).',
  ));
  f.push(unavailable(
    { id: 'keepAlive', label: 'keep-alive (ATWM) durumu', source: 'YOK', note: '' },
    'Keep-alive yalnız native ElmProtocol içinde; JS tarafına açılmış durum alanı YOK.',
  ));

  return boundCard({ id: 'datagate', title: INSPECTOR_CARD_TITLE.datagate, fields: f });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kart 4 — KWP / Recovery
 * ════════════════════════════════════════════════════════════════════════ */

function _kwpCard(s: SessionRawSnapshot): InspectorCard {
  const f: InspectorField[] = [];
  const k = s.kwp;

  if (!k) {
    f.push(unavailable(
      { id: 'kwpEvidence', label: 'KWP kurtarma kanıtı', source: SRC.kwp, note: '' },
      'Native kanıt önbelleği BOŞ. Bu kanıt yalnız "Tanı Gönder" akışında (refreshKwpRecoveryEvidence) tazelenir; bu ekran salt-okunur olduğu için tazeleme TETİKLEMEZ.',
    ));
    f.push(unavailable(
      { id: 'kwpCounters', label: 'kurtarma sayaçları', source: SRC.kwp, note: '' },
      'Kaynak yok — sayaç uydurulmaz.',
    ));
    return boundCard({ id: 'kwp', title: INSPECTOR_CARD_TITLE.kwp, fields: f });
  }

  const cached = 'Önbellekten okundu; kanıtın TAZELENME zamanı kaynakta KAYITLI DEĞİL → bayatlığı hesaplanamaz.';

  f.push(observed({ id: 'kwpStatus', label: 'kurtarma durumu', source: SRC.kwp, note: cached }, k.status));
  f.push(observed({ id: 'kwpStreak', label: 'ardışık çekirdek NO_DATA (anlık/azami)', source: SRC.kwp, note: `Eşik: ${_nz(k.threshold)}.` },
    `${_nz(k.coreNoDataStreak)} / ${_nz(k.maxCoreNoDataStreak)}`));
  /* #642: eskiden "ATPC gönderimi / tavan" diye YAN YANA yazılıyordu ve iki sayı
     karşılaştırılabilir sanılıyordu (sahada 4/3 görülüp "tavan doldu" sanıldı).
     `recoveryCount` oturum TOPLAMIDIR, tavanla ilgisi YOKTUR; tavan sayacı ayrı satırda. */
  f.push(observed({ id: 'kwpRecoveryCount', label: 'ATPC gönderimi (oturum toplamı)', source: SRC.kwp, note: cached },
    `${_nz(k.recoveryCount)}`));
  f.push(k.consecutiveFailedRecoveries !== null
    ? observed({ id: 'kwpConsecFailed', label: 'ardışık BAŞARISIZ kurtarma / tavan', source: SRC.kwp,
        note: 'Tavan kararının baktığı sayaç. Başarılı kurtarma bunu SIFIRLAR.' },
      `${k.consecutiveFailedRecoveries} / ${_nz(k.maxPerSession)}`)
    : unavailable({ id: 'kwpConsecFailed', label: 'ardışık BAŞARISIZ kurtarma / tavan', source: SRC.kwp, note: '' },
      'Native bu sayacı vermiyor (eski APK) — tavan durumu BİLİNMİYOR.'));
  f.push(derived(
    { id: 'kwpAtLimit', label: 'kurtarma tavanına ulaşıldı mı',
      source: `${SRC.kwp} (consecutiveFailedRecoveries vs maxPerSession)`,
      note: 'KURAL (#642): tavan kararı YALNIZ ardışık BAŞARISIZ kurtarma sayacına bakar — BAŞARILI kurtarma seriyi SIFIRLAR (native semantik 2026-07-23 tarihinde değişti). Sayaç yoksa (eski APK) BİLİNMİYOR; oturum toplamından TÜRETİLMEZ.' },
    k.maxPerSession !== null && k.maxPerSession > 0 && k.consecutiveFailedRecoveries !== null
      ? (k.consecutiveFailedRecoveries >= k.maxPerSession ? 'EVET' : 'HAYIR') : null,
  ));
  f.push(observed({ id: 'kwpSuppressed', label: 'tavan dolduğu için gönderilmedi', source: SRC.kwp, note: cached }, k.suppressedCount));
  f.push(observed({ id: 'kwpSendFail', label: 'ATPC kanal hatası', source: SRC.kwp, note: cached }, k.atpcSendFailures));
  f.push(observed({ id: 'kwpKilledByGate', label: 'Data Gate kurtarmayı yıktı', source: SRC.kwp, note: 'Kurtarma IN_PROGRESS iken oturum kaç kez kapatıldı.' }, k.killedByDataGate));
  f.push(k.lastRecoveryAt !== null && k.lastRecoveryAt > 0
    ? observed({ id: 'kwpLastRecoveryAt', label: 'son kurtarma tetiği', source: SRC.kwp,
        note: 'Gerçek damga; kurtarma için TANIMLI bayatlık eşiği YOK → STALE hesaplanmaz.', updatedAt: k.lastRecoveryAt },
        new Date(k.lastRecoveryAt).toISOString())
    : unavailable({ id: 'kwpLastRecoveryAt', label: 'son kurtarma tetiği', source: SRC.kwp, note: '' }, 'Hiç kurtarma tetiklenmedi.'));
  f.push(k.lastRecoveryToFirstPidMs !== null && k.lastRecoveryToFirstPidMs >= 0
    ? observed({ id: 'kwpRecoveryLatency', label: 'ATPC→ilk geçerli PID (ms)', source: SRC.kwp, note: 'Son BAŞARILI kurtarmada ölçüldü.' }, k.lastRecoveryToFirstPidMs)
    : unavailable({ id: 'kwpRecoveryLatency', label: 'ATPC→ilk geçerli PID (ms)', source: SRC.kwp, note: '' }, 'Ölçülmedi (-1).'));
  f.push(k.protocolAtRecovery
    ? observed({ id: 'kwpProtocol', label: 'kurtarma anındaki protokol', source: SRC.kwp, note: cached }, k.protocolAtRecovery)
    : unavailable({ id: 'kwpProtocol', label: 'kurtarma anındaki protokol', source: SRC.kwp, note: '' }, 'Kurtarma olmadı.'));

  return boundCard({ id: 'kwp', title: INSPECTOR_CARD_TITLE.kwp, fields: f });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kart 5 — Vehicle HAL / Source Health
 * ════════════════════════════════════════════════════════════════════════ */

function _halCard(s: SessionRawSnapshot): InspectorCard {
  const f: InspectorField[] = [];
  const h = s.hal;

  if (h) {
    f.push(observed({ id: 'halConnected', label: 'HAL bağlı', source: SRC.hal, note: 'HAL durum store\'u.' }, h.halConnected));
    f.push(observed({ id: 'halConf', label: 'HAL güveni', source: SRC.hal, note: '0..1.' }, h.halConf));
    f.push(observed({ id: 'halActiveSource', label: 'aktif sinyal kaynağı', source: SRC.hal, note: 'HAL\'in seçtiği kaynak.' }, h.activeSource));
    f.push(observed({ id: 'canPhase', label: 'CAN bağlantı fazı', source: SRC.hal, note: `Retry: ${h.canRetryCount}.` }, h.canPhase));

    // null = BİLİNMİYOR (kaynak açıkça böyle tanımlar) → UNAVAILABLE
    for (const [id, label, val] of [
      ['halCanAlive', 'sourceHealth.canAlive', h.canAlive],
      ['halObdAlive', 'sourceHealth.obdAlive', h.obdAlive],
      ['halGpsAlive', 'sourceHealth.gpsAlive', h.gpsAlive],
    ] as const) {
      f.push(val === null
        ? unavailable({ id, label, source: SRC.hal, note: '' },
            'Worker henüz sağlık bildirmedi → BİLİNMİYOR. Bu "kaynak ölü" (false) ile KARIŞTIRILMAZ.')
        : observed({ id, label, source: SRC.hal, note: 'Worker 1Hz watchdog bildirimi (yalnız geçişte gelir).' }, val));
    }

    f.push(h.sourceHealthUpdatedAtMono !== null
      ? observed(
          { id: 'halSourceHealthMono', label: 'sourceHealth damgası (MONOTONİK)', source: SRC.hal,
            note: '⚠ Worker performance.now() saati — DUVAR SAATİ DEĞİL. Bu yüzden bayatlık HESAPLANMAZ.' },
          h.sourceHealthUpdatedAtMono,
        )
      : unavailable({ id: 'halSourceHealthMono', label: 'sourceHealth damgası (MONOTONİK)', source: SRC.hal, note: '' },
          'Worker hiç sağlık bildirimi göndermedi.'));
  } else {
    f.push(unavailable({ id: 'hal', label: 'HAL durum store', source: SRC.hal, note: '' }, 'HAL store okunamadı.'));
  }

  if (Array.isArray(s.connectivity) && s.connectivity.length > 0) {
    for (const c of s.connectivity) {
      f.push(observed(
        { id: `conn-${c.source}`, label: `bağlantı yöneticisi · ${c.source}`, source: SRC.conn,
          note: `available=${c.available} · confidence=${c.confidence}${c.errorReason ? ` · ${c.errorReason}` : ''}. Kendi 3sn watchdog'u vardır.`,
          updatedAt: c.lastSignalAt || null },
        c.connected ? 'connected' : 'disconnected',
      ));
    }
  } else {
    f.push(unavailable({ id: 'connectivity', label: 'VehicleConnectivityManager', source: SRC.conn, note: '' },
      'Bağlantı yöneticisi anlık görüntüsü okunamadı.'));
  }

  /* #517: iki otorite aynı soruya farklı cevap veriyorsa AÇIKÇA yaz. */
  _pushFirstDataTiming(f, s);
  _pushSourceAuthorityDivergence(f, s);

  return boundCard({ id: 'hal', title: INSPECTOR_CARD_TITLE.hal, fields: f });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kart 6 — Runtime / Capture
 * ════════════════════════════════════════════════════════════════════════ */

function _runtimeCard(s: SessionRawSnapshot): InspectorCard {
  const f: InspectorField[] = [];

  if (s.capture) {
    f.push(observed({ id: 'captureObdRefs', label: 'OBD ham trafik yakalama (ref)', source: SRC.capture,
      note: 'Ref-count > 0 = en az bir panel açık. Bu ekran yakalama AÇMAZ.' }, s.capture.obdRefs));
    f.push(observed({ id: 'captureCanRefs', label: 'CAN kütük toplama (ref)', source: SRC.capture,
      note: 'Ref-count > 0 = CAN Monitor açık.' }, s.capture.canRefs));
  } else {
    f.push(unavailable({ id: 'capture', label: 'yakalama durumu', source: SRC.capture, note: '' }, 'Okunamadı.'));
  }

  if (s.debug) {
    f.push(observed({ id: 'debugCollecting', label: 'debug store collecting', source: SRC.debug, note: 'CAN halka tamponu doluyor mu.' }, s.debug.collecting));
    f.push(observed({ id: 'trafficBuffer', label: 'OBD trafik tamponu', source: SRC.debug, note: 'Bounded halka tamponu.' },
      `${s.debug.trafficBufferLen} / ${s.debug.trafficBufferMax}`));
    /**
     * T14: `listenerCount` ile capture ref-count AYNI KAVRAM DEĞİLDİR.
     *
     * SAHA (snapshot 2026-08-01): `obdRefs:1, canRefs:1, collecting:true` yanında
     * `listenerCount:0` görünüyordu — "yakalama açık ama kimse dinlemiyor" gibi
     * okunan sahte bir alarm. Gerçek: `dbgUpdateListenerCount`in uygulama içinde
     * HİÇ ÇAĞIRANI YOK, alan hiç yazılmıyor. Yani değer 0 DEĞİL, ÖLÇÜLMEMİŞ.
     * Sıfır göstermek "ölçüldü ve sıfır çıktı" iddiasıdır — kanıtsızdır.
     */
    f.push(unavailable({ id: 'listenerCount', label: 'listener sayısı', source: SRC.debug,
      note: 'Capture ref-count ile AYNI ŞEY DEĞİL: ref-count yakalama talebini, bu alan olay dinleyicisini sayar.' },
      'ÖLÇÜLMEDİ — `dbgUpdateListenerCount` çağıranı yok (kanal yazılmıyor). "0 dinleyici" DEĞİL.'));
    f.push(observed({ id: 'obdDropped', label: 'düşen OBD paketi', source: SRC.debug, note: 'dbgIncrementDropped sayacı.' }, s.debug.obdDropped));

    // Dürüstlük: bu alanları YAZAN kod yok → OBSERVED gibi sunmak yalan olurdu
    f.push(unavailable({ id: 'hzCounters', label: 'canHz / obdHz / gpsHz', source: SRC.debug, note: '' },
      'debugStore\'da alan VAR ama bu değerleri YAZAN kod YOK — her zaman 0 kalır. Gerçek frekans ölçümü mevcut değil.'));
    f.push(unavailable({ id: 'fallbackStatus', label: 'fallback durumu (canAlive/obdFallbackActive)', source: SRC.debug, note: '' },
      'dbgUpdateFallback fonksiyonunun ÇAĞIRANI YOK — alan ölü. Gerçek fallback durumu için HAL sourceHealth kullanılmalı.'));
  } else {
    f.push(unavailable({ id: 'debug', label: 'debug store', source: SRC.debug, note: '' }, 'Okunamadı.'));
  }

  return boundCard({ id: 'runtime', title: INSPECTOR_CARD_TITLE.runtime, fields: f });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Dışa açık kurucular
 * ════════════════════════════════════════════════════════════════════════ */

export function buildInspectorCards(s: SessionRawSnapshot): InspectorCard[] {
  if (!s) return [];
  return [
    _transportCard(s), _protocolCard(s), _dataGateCard(s),
    _kwpCard(s), _halCard(s), _runtimeCard(s),
  ];
}

/** Çelişki karşılaştırması için ham alanlar (birleştirme YOK). */
export function buildMismatchInput(s: SessionRawSnapshot): MismatchInput {
  const conn = Array.isArray(s?.connectivity) ? s.connectivity.find((c) => c.source === 'OBD') : undefined;
  return {
    connectionState:          s?.obdStatus?.connectionState ?? null,
    transportConnected:       s?.obdData ? s.obdData.transportConnected : null,
    transportReady:           s?.sessionHealth ? s.sessionHealth.transportReady : null,
    dataFresh:                s?.sessionHealth ? s.sessionHealth.dataFresh : null,
    healthIsStale:            s?.health ? s.health.isStale : null,
    connectivityObdConnected: conn ? conn.connected : null,
    halObdAlive:              s?.hal ? s.hal.obdAlive : null,
    protocolTried:            s?.handshake?.protocolTried ?? null,
    protocolActive:           s?.handshake?.protocolActive ?? null,
  };
}

/** Fail-closed özet için ham alanlar. */
export function buildHealthInput(s: SessionRawSnapshot, mismatchCount: number): SessionHealthInput {
  const k = s?.kwp ?? null;
  return {
    connectionState: s?.obdStatus?.connectionState ?? null,
    transportReady:  s?.sessionHealth ? s.sessionHealth.transportReady : null,
    sessionReady:    s?.sessionHealth ? s.sessionHealth.sessionReady : null,
    pollingActive:   s?.sessionHealth ? s.sessionHealth.pollingActive : null,
    dataFresh:       s?.sessionHealth ? s.sessionHealth.dataFresh : null,
    lastSeenMs:      s?.obdStatus?.lastSeenMs ?? null,
    freshWindowMs:   typeof s?.freshWindowMs === 'number' ? s.freshWindowMs : 0,
    nowMs:           typeof s?.readAt === 'number' ? s.readAt : 0,
    dataSource:      s?.obdStatus?.source ?? null,
    kwpStatus:       k ? k.status : null,
    /* #642 — bkz. runtimeSchedulingBuild: karar sayacı `recoveryCount` DEĞİL. */
    kwpAtLimit:      k && k.maxPerSession !== null && k.maxPerSession > 0
      && k.consecutiveFailedRecoveries !== null
      ? k.consecutiveFailedRecoveries >= k.maxPerSession : null,
    mismatchCount:   typeof mismatchCount === 'number' && mismatchCount > 0 ? mismatchCount : 0,
  };
}

/**
 * #517 — İKİ OTORİTE AYRIŞMA DEDEKTÖRÜ.
 *
 * "Kaynak canlı mı?" sorusuna İKİ yer cevap veriyor ve eşikleri FARKLI:
 *   · `hal.*Alive`  → **worker-yerel** görüş. Worker'ın kendi watchdog'u
 *     (GPS için 5 sn), saat `performance.now()` (MONOTONİK). Füzyon girdisidir.
 *   · `connectivity[*].connected` → **sistem** görüşü. VehicleConnectivityManager,
 *     kendi eşiği (GPS için 10 sn), saat `Date.now()` (DUVAR).
 *
 * İkisi ayrışabilir ve bu ayrışma bugüne kadar SESSİZDİ: LAB iki cevabı yan yana
 * koyuyor, hangisinin doğru olduğunu söylemiyordu (saha 2026-08-09: `gpsAlive:false`
 * iken `connectivity[GPS].connected:true`, sinyal 104 ms önce gelmiş).
 *
 * OTORİTE KURALI: gözlem yüzeyinde **sistem görüşü (connectivity) otoritedir** —
 * ürünün gerçek akışından beslenir ve duvar saatiyle ölçülür. `hal.*Alive` füzyon
 * için KALIR ama "kaynak canlı mı"nın cevabı DEĞİLDİR. Ayrışma varsa gizlenmez:
 * aşağıdaki alan onu AÇIKÇA yazar.
 */
/**
 * #526 — İLK VERİYE KADAR SÜRE. Saha şikâyeti *"ilk 2 dakika veri yok"* idi ve
 * bu süre hiçbir yerde ÖLÇÜLMÜYORDU. Ölçülen zincir (2026-08-10): kullanıcı
 * eylemi → +30,1 sn bağlantı ZAMAN AŞIMI (15 s) → `real → none` → +37,0 sn
 * `none → real`. Yani 37 saniyenin 15'i DÜŞEN bir denemeydi.
 */
function _pushFirstDataTiming(f: InspectorField[], s: SessionRawSnapshot): void {
  const t = s.firstDataTiming;
  if (!t) {
    f.push(unavailable(
      { id: 'firstDataTiming', label: 'ilk veriye kadar süre', source: SRC.status, note: '' },
      'Ölçüm okunamadı.',
    ));
    return;
  }
  const note = 'Bağlantı denemesinin BAŞLADIĞI andan İLK GERÇEK ECU verisine kadar. '
             + 'Düşen denemeler bu sürenin İÇİNDEDİR — "kaç saniye bekledim" sorusunun cevabı.';
  if (t.firstDataAfterConnectMs !== null) {
    f.push(observed(
      { id: 'firstDataTiming', label: 'ilk veriye kadar süre', source: SRC.status, note },
      `${(t.firstDataAfterConnectMs / 1000).toFixed(1)} sn`
      + (t.failedAttemptsBeforeData > 0
          ? ` · ${t.failedAttemptsBeforeData} deneme DÜŞTÜ`
          : ' · düşen deneme yok'),
    ));
    return;
  }
  if (t.waitingForFirstDataMs !== null) {
    f.push(observed(
      { id: 'firstDataTiming', label: 'ilk veriye kadar süre', source: SRC.status, note },
      `HÂLÂ VERİ YOK — ${(t.waitingForFirstDataMs / 1000).toFixed(1)} sn bekleniyor`
      + ` · ${t.failedAttemptsBeforeData} deneme düştü`,
    ));
    return;
  }
  f.push(unavailable(
    { id: 'firstDataTiming', label: 'ilk veriye kadar süre', source: SRC.status, note },
    'Henüz bağlantı denemesi yapılmadı.',
  ));
}

function _pushSourceAuthorityDivergence(f: InspectorField[], s: SessionRawSnapshot): void {
  const h = s.hal;
  const list = Array.isArray(s.connectivity) ? s.connectivity : [];
  if (!h || list.length === 0) return;

  const pairs: readonly [string, boolean | null][] = [
    ['CAN', h.canAlive],
    ['OBD', h.obdAlive],
    ['GPS', h.gpsAlive],
  ];

  const diverged: string[] = [];
  for (const [src, halVal] of pairs) {
    if (halVal === null) continue;                       // BİLİNMİYOR → kıyaslanmaz
    const c = list.find((x) => x.source === src);
    if (!c) continue;
    if (c.connected !== halVal) {
      diverged.push(`${src}: worker=${halVal ? 'canlı' : 'ölü'} · sistem=${c.connected ? 'canlı' : 'ölü'}`);
    }
  }

  f.push(diverged.length === 0
    ? observed(
        { id: 'srcAuthority', label: 'kaynak canlılığı — iki otorite uyumu', source: SRC.hal,
          note: '#517: worker-yerel (hal.*Alive, monotonik saat) ile sistem görüşü '
              + '(connectivity, duvar saati) karşılaştırıldı. Gözlemde OTORİTE sistem görüşüdür; '
              + 'hal.*Alive füzyon girdisidir, "kaynak canlı mı" sorusunun cevabı DEĞİLDİR.' },
        'uyumlu')
    : derived(
        { id: 'srcAuthority', label: 'kaynak canlılığı — İKİ OTORİTE AYRIŞIYOR', source: SRC.hal,
          note: '#517: eşikler ve saatler FARKLI (worker GPS 5 sn / monotonik · sistem GPS 10 sn / '
              + 'duvar). Gözlemde OTORİTE sistem görüşüdür. Ayrışma bir ARIZA olmayabilir '
              + '(worker o kaynağı beslenmiyor olabilir) ama SESSİZ GEÇİLMEZ.' },
        diverged.join(' | ')));
}

