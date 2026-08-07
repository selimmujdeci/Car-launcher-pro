/**
 * runtimeSchedulingBuild.ts — ham anlık görüntü → KANAL kurucuları (TAMAMEN SAF).
 *
 * Servis import ETMEZ (girdi yapısal tip) → tüm sınıflandırma, aktivite kararı ve
 * çelişki tespiti mock'suz test edilir.
 *
 * ═══ KANALLAR AYRI TUTULUR ══════════════════════════════════════════════════
 * Bunlar repoda GERÇEKTEN ayrı runtime otoriteleridir; tek bir "scheduler" gibi
 * sunulmaz:
 *  1. Command Execution      → NATIVE OBDManager poll döngüsü + seri kanal (JS'te kolu YOK)
 *  2. Live Polling           → obdService stale-watchdog (JS timer) + tazelik kapısı
 *  3. Handshake / Init       → obdService tek-atımlık init işi (kuyruk DEĞİL)
 *  4. KWP Keep-Alive/Recovery→ NATIVE ElmProtocol (JS yalnız bounded kanıt önbelleği görür)
 *  5. Discovery / Deep Scan  → discoveryLive koordinatörü + deepScanRuntimeService (İKİ AYRI motor)
 *  6. CAN Collection         → debugStore halka tamponu (panel kapısı)
 */

import {
  schedObserved, schedDerived, schedUnavailable, schedUnsafe, schedApplyStaleness,
  boundChannel, SCHED_CHANNEL_TITLE,
  type SchedChannel, type SchedField, type ChannelActivity, type SchedConflictInput,
  type RuntimeSummaryInput,
} from './runtimeSchedulingModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Ham anlık görüntü — YAPISAL tip
 * ════════════════════════════════════════════════════════════════════════ */

export interface SchedRawSnapshot {
  readonly readAt: number;

  /**
   * Native poll/komut hattı kanıtı (`extendedPollEvidence.getExtendedPollEvidence()`).
   * SENKRON ve yan etkisizdir AMA yalnız ÖNBELLEĞİ okur: önbellek `refreshExtendedPollEvidence()`
   * (ASYNC native pull, "Tanı Gönder" akışı) çalışmadıysa `present=false` gelir.
   * `present=false` iken sayaçlar 0 GÖSTERİLMEZ → UNAVAILABLE.
   */
  readonly pollEvidence: {
    present: boolean;
    evidenceComplete: boolean;
    /** T6-B: kanıt önbelleği tazelendi mi — "ölçmedik" ≠ "yok". */
    cacheState: string;
    /** T6: 'native_available' | 'native_unavailable_js_only' | 'insufficient'. */
    evidenceState: string;
    /** T6: kanıt yoksa null — sahte varsayılan taşınmaz. */
    transport: string | null;
    burstEnabled: boolean | null;
    configuredPidCount: number | null;
    counters: {
      pollCycles: number; burstCycles: number; roundRobinCycles: number;
      attempted: number; success: number; noData: number; busy: number;
      negativeResponse: number; error: number; timeoutNoBytes: number;
      timeoutPartial: number; parseFailure: number; cancelled: number;
      unknownFailure: number; callbackEmitted: number; maxBurstSizeObserved: number;
    } | null;
    lastAttemptedPid: string | null;
    lastSuccessfulPid: string | null;
    lastOutcome: string | null;
    lastElapsedMs: number | null;
    /** Gerçek duvar-saati damgası (native). 0/null = yok. */
    lastPollAt: number | null;
    decisionLabel: string;
    js: { eventsReceived: number; decodeFailures: number; valuesStored: number; valuesCached: number };
  } | null;

  readonly sessionHealth: {
    pollingActive: boolean; dataFresh: boolean; transportReady: boolean; sessionReady: boolean;
  } | null;

  readonly obdStatus: { connectionState: string; source: string; lastSeenMs: number } | null;
  readonly health: { isStale: boolean; lastPacketAgeMs: number } | null;
  readonly freshWindowMs: number | null;

  readonly handshake: {
    outcome: string; ranAt: number | null; durationMs: number | null;
    timeoutStage: string | null; failReason: string | null; lastSuccessAt: number | null;
  } | null;

  readonly kwp: {
    status: string; recoveryCount: number; maxPerSession: number; suppressedCount: number;
    atpcSendFailures: number; lastRecoveryAt: number; coreNoDataStreak: number; threshold: number;
  } | null;

  readonly deepScan: {
    status: string; phase: string | null; progressPercent: number;
    startedAt: number | null; updatedAt: number | null; completedAt: number | null;
    warningsCount: number; errorCode: string | null;
  } | null;

  readonly canCollect: { collecting: boolean; bufferLen: number; bufferMax: number } | null;

  readonly capture: { obdRefs: number; canRefs: number } | null;
}

/* ── Kaynak etiketleri ────────────────────────────────────────────────────── */

const SRC = {
  pollEv:   'obd/extendedPollEvidence.getExtendedPollEvidence()',
  session:  'obdService.getObdSessionHealth()',
  status:   'obdService.getOBDStatusSnapshot()',
  health:   'obd/ObdHealthMonitor.getObdHealth()',
  fresh:    'obdService.getObdFreshWindowMs()',
  hs:       'obdService.getHandshakeDiagnostics()',
  kwp:      'obd/kwpRecoveryEvidence.getKwpRecoveryEvidence()',
  deep:     'deepScan/deepScanRuntimeService.getSnapshot()',
  debug:    'platform/debug/debugStore',
  capture:  'devtools/devtoolsCapture.getDevtoolsCaptureStatus()',
  none:     'YOK',
  unsafe:   'obd/discovery/discoveryLive.getLiveDiscoveryCoordinator()',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Command Execution — NATIVE otorite
 * ════════════════════════════════════════════════════════════════════════ */

function _commandExecChannel(s: SchedRawSnapshot): SchedChannel {
  const f: SchedField[] = [];
  const ev = s.pollEvidence;
  const present = !!(ev && ev.present && ev.counters);

  // Kuyruk derinliği HİÇBİR koşulda okunamaz — native kuyruk JS'e açılmamıştır.
  f.push(schedUnavailable(
    { id: 'cmdQueueDepth', label: 'komut kuyruğu derinliği', source: SRC.none, note: '' },
    'Native OBDManager seri kanalının kuyruk derinliği JS\'e AÇILMAMIŞTIR. Boş kuyruk VARSAYILMAZ.',
  ));
  f.push(schedUnavailable(
    { id: 'cmdPriority', label: 'komut önceliği / sıralama politikası', source: SRC.none, note: '' },
    'Öncelik native tarafta; JS\'e açılmış okuma yüzeyi yok.',
  ));

  if (!present) {
    f.push(schedUnavailable(
      { id: 'cmdEvidence', label: 'native poll/komut kanıtı', source: SRC.pollEv, note: '' },
      'Kanıt önbelleği BOŞ (present=false). Önbellek yalnız "Tanı Gönder" akışındaki ASYNC native pull ile dolar; bu ekran pull YAPMAZ → sayaçlar 0 olarak GÖSTERİLMEZ.',
    ));
    return boundChannel({
      id: 'command-exec', authority: 'NATIVE · OBDManager poll döngüsü + seri kanal',
      title: SCHED_CHANNEL_TITLE['command-exec'],
      activity: 'UNKNOWN',
      activityNote: 'Native komut hattının çalışıp çalışmadığı okunamıyor (kanıt önbelleği boş).',
      fields: f,
    });
  }

  const c = ev!.counters!;
  const fresh = typeof s.freshWindowMs === 'number' ? s.freshWindowMs : 0;

  f.push(schedObserved({ id: 'cmdPollCycles', label: 'poll turu (cycle)', source: SRC.pollEv,
    note: 'Native döngü sayacı — önbellekten.' }, c.pollCycles));
  f.push(schedObserved({ id: 'cmdAttempted', label: 'denenen / başarılı', source: SRC.pollEv,
    note: 'Oturumluk bounded sayaçlar.' }, `${c.attempted} / ${c.success}`));
  f.push(schedObserved({ id: 'cmdFailures', label: 'noData / timeout / error', source: SRC.pollEv,
    note: 'timeoutNoBytes + timeoutPartial ayrı tutulur (sessiz timeout ayrımı).' },
    `${c.noData} / ${c.timeoutNoBytes + c.timeoutPartial} / ${c.error}`));
  f.push(schedObserved({ id: 'cmdBusy', label: 'busy / negatif yanıt', source: SRC.pollEv, note: 'ECU meşgul + NRC.' },
    `${c.busy} / ${c.negativeResponse}`));
  f.push(ev!.lastAttemptedPid
    ? schedObserved({ id: 'cmdActiveJob', label: 'son denenen iş (PID)', source: SRC.pollEv,
        note: 'ANLIK aktif iş değil — son DENENEN iştir (native anlık iş alanı yok).' }, ev!.lastAttemptedPid)
    : schedUnavailable({ id: 'cmdActiveJob', label: 'son denenen iş (PID)', source: SRC.pollEv, note: '' },
        'Kanıtta son denenen PID yok.'));
  f.push(ev!.lastOutcome
    ? schedObserved({ id: 'cmdLastOutcome', label: 'son sonuç', source: SRC.pollEv, note: 'Sınıflandırılmış sonuç kodu.' }, ev!.lastOutcome)
    : schedUnavailable({ id: 'cmdLastOutcome', label: 'son sonuç', source: SRC.pollEv, note: '' }, 'Kayıt yok.'));
  f.push(typeof ev!.lastElapsedMs === 'number' && ev!.lastElapsedMs >= 0
    ? schedObserved({ id: 'cmdLastElapsed', label: 'son iş süresi (ms)', source: SRC.pollEv, note: 'Native ölçüm.' }, ev!.lastElapsedMs)
    : schedUnavailable({ id: 'cmdLastElapsed', label: 'son iş süresi (ms)', source: SRC.pollEv, note: '' }, 'Ölçülmedi.'));

  f.push(ev!.lastPollAt
    ? schedApplyStaleness(schedObserved(
        { id: 'cmdLastPollAt', label: 'son poll zamanı', source: SRC.pollEv,
          note: 'Native duvar-saati damgası. Eşik: getObdFreshWindowMs().', updatedAt: ev!.lastPollAt },
        new Date(ev!.lastPollAt).toISOString(),
      ), s.readAt, fresh)
    : schedUnavailable(
        { id: 'cmdLastPollAt', label: 'son poll zamanı', source: SRC.pollEv, note: '' },
        'Native kanıt tazelenmedi ya da `lastPollAt` damgası 0 (hiç poll turu tamamlanmadı). Damga uydurulmaz.',
      ));

  f.push(ev!.lastSuccessfulPid
    ? schedObserved({ id: 'cmdLastSuccessPid', label: 'son BAŞARILI PID', source: SRC.pollEv,
        note: 'Native son değer üreten PID — "denendi" ile "başarılı" AYNI şey değildir.' }, ev!.lastSuccessfulPid)
    : schedUnavailable({ id: 'cmdLastSuccessPid', label: 'son BAŞARILI PID', source: SRC.pollEv, note: '' },
        'Kanıtta başarılı PID yok (hiç değer üretilmedi ya da kanıt tazelenmedi).'));

  // T6: kanıt yoksa bu iki alan UNAVAILABLE'dır — `false`/`0` göstermek sahte bilgiydi.
  f.push(ev!.burstEnabled === null
    ? schedUnavailable({ id: 'cmdBurst', label: 'tanı BURST modu', source: SRC.pollEv, note: '' },
        'Native kanıt yok — burst durumu BİLİNMİYOR (kapalı olduğu iddia EDİLEMEZ).')
    : schedObserved({ id: 'cmdBurst', label: 'tanı BURST modu', source: SRC.pollEv,
        note: 'Açıkken EXTENDED grubu her turda tümüyle okunur (ekstra ECU trafiği).' }, ev!.burstEnabled));
  f.push(ev!.configuredPidCount === null
    ? schedUnavailable({ id: 'cmdConfiguredPids', label: 'yapılandırılmış PID sayısı', source: SRC.pollEv, note: '' },
        'Native kanıt yok — izlenen PID sayısı BİLİNMİYOR ("0 PID" DEĞİL).')
    : schedObserved({ id: 'cmdConfiguredPids', label: 'yapılandırılmış PID sayısı', source: SRC.pollEv,
        note: 'Native izlenen liste boyutu.' }, ev!.configuredPidCount));
  f.push(schedObserved({ id: 'cmdDecision', label: 'hat hükmü', source: SRC.pollEv,
    note: 'classifyExtendedPoll — native/JS sayaç tutarlılığından türetilmiş mevcut sınıflandırma.' }, ev!.decisionLabel));
  f.push(schedObserved({ id: 'cmdJsBridge', label: 'JS köprüsü (olay/decode/store)', source: SRC.pollEv,
    note: 'eventsReceived / decodeFailures / valuesStored.' },
    `${ev!.js.eventsReceived} / ${ev!.js.decodeFailures} / ${ev!.js.valuesStored}`));

  f.push(schedDerived(
    { id: 'cmdEvidenceFreshness', label: 'kanıt bütünlüğü', source: `${SRC.pollEv} (present && coherent)`,
      note: 'KURAL: present=true VE native sayaçlar tutarlı (coherent) ise TAM, aksi hâlde EKSİK.' },
    ev!.evidenceComplete ? 'TAM' : 'EKSİK',
  ));

  // Aktivite: sayaç ilerlemesi ANLIK okunamaz → "çalışıyor" DİYEMEYİZ.
  const activity: ChannelActivity = 'UNKNOWN';
  return boundChannel({
    id: 'command-exec', authority: 'NATIVE · OBDManager poll döngüsü + seri kanal',
    title: SCHED_CHANNEL_TITLE['command-exec'],
    activity,
    activityNote: 'Kanıt ÖNBELLEKTEN okunur; anlık ilerleme görülemediği için "çalışıyor" denemez (fail-closed).',
    fields: f,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Live Polling — JS otorite (stale watchdog)
 * ════════════════════════════════════════════════════════════════════════ */

function _livePollingChannel(s: SchedRawSnapshot): SchedChannel {
  const f: SchedField[] = [];
  const sh = s.sessionHealth;
  const fresh = typeof s.freshWindowMs === 'number' ? s.freshWindowMs : 0;

  f.push(sh
    ? schedObserved({ id: 'pollTimerActive', label: 'stale-watchdog timer nesnesi', source: SRC.session,
        note: 'YALNIZ zamanlayıcının VARLIĞI. Veri aktığı anlamına GELMEZ.' }, sh.pollingActive)
    : schedUnavailable({ id: 'pollTimerActive', label: 'stale-watchdog timer nesnesi', source: SRC.session, note: '' }, 'Okunamadı.'));

  f.push(sh
    ? schedObserved({ id: 'pollDataFresh', label: 'veri tazeliği (dataFresh)', source: SRC.session,
        note: 'Kadans-göreli tazelik kapısı.' }, sh.dataFresh)
    : schedUnavailable({ id: 'pollDataFresh', label: 'veri tazeliği (dataFresh)', source: SRC.session, note: '' }, 'Okunamadı.'));

  f.push(schedApplyStaleness(schedObserved(
    { id: 'pollLastSeen', label: 'son geçerli ECU frame', source: SRC.status,
      note: 'ATRV hariç. Eşik: getObdFreshWindowMs().', updatedAt: s.obdStatus?.lastSeenMs ?? null },
    s.obdStatus?.lastSeenMs ? new Date(s.obdStatus.lastSeenMs).toISOString() : null,
  ), s.readAt, fresh));

  f.push(s.freshWindowMs !== null
    ? schedObserved({ id: 'pollFreshWindow', label: 'tazelik penceresi (ms)', source: SRC.fresh,
        note: 'Bu ekrandaki TEK meşru bayatlık eşiği.' }, s.freshWindowMs)
    : schedUnavailable({ id: 'pollFreshWindow', label: 'tazelik penceresi (ms)', source: SRC.fresh, note: '' }, 'Okunamadı.'));

  // Poll kadansı: hesaplayan fonksiyon SAF, sonucu HİÇBİR YERDE saklanmıyor.
  f.push(schedUnavailable(
    { id: 'pollCadence', label: 'aktif poll kadansı (fast/slow ms)', source: SRC.none, note: '' },
    'computeObdPollProfile() SAF bir fonksiyondur; obdService hesapladığı profili SAKLAMAZ ve native\'e gönderilen değeri de tutmaz. Yeniden hesaplamak GERÇEK aktif kadansı kanıtlamaz → uydurma değer gösterilmez.',
  ));
  f.push(schedUnavailable(
    { id: 'pollFastSlowGroups', label: 'fast/slow grup dağılımı', source: SRC.none, note: '' },
    'Grup üyeliği native tarafta; JS\'e açılmış okuma yüzeyi yok.',
  ));

  f.push(s.obdStatus
    ? schedDerived({ id: 'pollMockEngine', label: 'mock poll motoru', source: `${SRC.status} (source alanı)`,
        note: "KURAL: source === 'mock' → mock zamanlayıcısı çalışıyor, aksi hâlde hayır." },
        s.obdStatus.source === 'mock' ? 'ÇALIŞIYOR' : 'HAYIR')
    : schedUnavailable({ id: 'pollMockEngine', label: 'mock poll motoru', source: SRC.status, note: '' }, 'Okunamadı.'));

  // AKTİVİTE KURALI: timer varlığı TEK BAŞINA yetmez; veri hareketi kanıtı şart.
  let activity: ChannelActivity = 'UNKNOWN';
  let activityNote = 'Zamanlayıcı durumu okunamadı.';
  if (sh) {
    if (sh.pollingActive && sh.dataFresh) {
      activity = 'RUNNING';
      activityNote = 'Zamanlayıcı VAR ve veri TAZE — çalıştığı iki bağımsız gözlemle doğrulandı.';
    } else if (sh.pollingActive && !sh.dataFresh) {
      activity = 'UNKNOWN';
      activityNote = 'Zamanlayıcı var ama veri tazelenmiyor → "çalışıyor" DENMEZ (çelişki bölümünde raporlanır).';
    } else if (!sh.pollingActive) {
      activity = 'NOT_RUNNING';
      activityNote = 'Stale-watchdog zamanlayıcısı yok — canlı poll oturumu kurulmamış.';
    }
  }

  return boundChannel({
    id: 'live-polling', authority: 'JS · obdService stale-watchdog + tazelik kapısı',
    title: SCHED_CHANNEL_TITLE['live-polling'], activity, activityNote, fields: f,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Handshake / Initialization — tek-atımlık iş (kuyruk DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

function _handshakeChannel(s: SchedRawSnapshot): SchedChannel {
  const f: SchedField[] = [];
  const h = s.handshake;

  f.push(schedUnavailable(
    { id: 'hsQueue', label: 'kuyruk', source: SRC.none, note: '' },
    'Handshake bir KUYRUK değildir: bağlantı başına TEK ATIMLIK init işidir. Kuyruk kavramı uygulanmaz.',
  ));

  if (!h) {
    f.push(schedUnavailable({ id: 'hsOutcome', label: 'son iş sonucu', source: SRC.hs, note: '' }, 'Handshake teşhisi okunamadı.'));
    return boundChannel({
      id: 'handshake', authority: 'JS · obdService init akışı', title: SCHED_CHANNEL_TITLE.handshake,
      activity: 'UNKNOWN', activityNote: 'Handshake teşhis kaynağı okunamadı.', fields: f,
    });
  }

  f.push(schedObserved({ id: 'hsOutcome', label: 'son iş sonucu', source: SRC.hs,
    note: 'Sınıflandırılmış handshake sonucu.', updatedAt: h.ranAt }, h.outcome));
  f.push(h.ranAt
    ? schedObserved({ id: 'hsRanAt', label: 'son çalıştırma', source: SRC.hs,
        note: 'Gerçek damga; handshake için TANIMLI bayatlık eşiği YOK → STALE hesaplanmaz.', updatedAt: h.ranAt },
        new Date(h.ranAt).toISOString())
    : schedUnavailable({ id: 'hsRanAt', label: 'son çalıştırma', source: SRC.hs, note: '' }, 'Bu oturumda hiç çalışmadı.'));
  f.push(h.durationMs !== null
    ? schedObserved({ id: 'hsDuration', label: 'iş süresi (ms)', source: SRC.hs, note: 'connect→sonuç.' }, h.durationMs)
    : schedUnavailable({ id: 'hsDuration', label: 'iş süresi (ms)', source: SRC.hs, note: '' }, 'Ölçülmedi.'));
  f.push(h.timeoutStage
    ? schedObserved({ id: 'hsTimeoutStage', label: 'timeout aşaması', source: SRC.hs, note: 'Hangi aşamada takıldı.' }, h.timeoutStage)
    : schedUnavailable({ id: 'hsTimeoutStage', label: 'timeout aşaması', source: SRC.hs, note: '' }, 'Timeout olmadı.'));
  f.push(h.failReason
    ? schedObserved({ id: 'hsFailReason', label: 'başarısızlık nedeni', source: SRC.hs, note: 'Sınıflandırılmış.' }, h.failReason)
    : schedUnavailable({ id: 'hsFailReason', label: 'başarısızlık nedeni', source: SRC.hs, note: '' }, 'Başarısızlık kaydı yok.'));

  // Aktivite: "şu an handshake sürüyor mu" için ayrı bir bayrak YOK.
  const activity: ChannelActivity = 'UNKNOWN';
  return boundChannel({
    id: 'handshake', authority: 'JS · obdService init akışı', title: SCHED_CHANNEL_TITLE.handshake,
    activity,
    activityNote: '"Şu anda handshake sürüyor mu" için ayrı bir çalışma bayrağı YOK — yalnız SON işin sonucu okunabilir.',
    fields: f,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · KWP Keep-Alive / Recovery — NATIVE otorite
 * ════════════════════════════════════════════════════════════════════════ */

function _kwpChannel(s: SchedRawSnapshot): SchedChannel {
  const f: SchedField[] = [];
  const k = s.kwp;

  f.push(schedUnavailable(
    { id: 'kwpKeepAlive', label: 'keep-alive (ATWM) zamanlaması', source: SRC.none, note: '' },
    'Keep-alive yalnız native ElmProtocol içinde çalışır; JS\'e açılmış durum/zamanlama alanı YOK.',
  ));

  if (!k) {
    f.push(schedUnavailable(
      { id: 'kwpEvidence', label: 'kurtarma kanıtı', source: SRC.kwp, note: '' },
      'Kanıt önbelleği BOŞ. Önbellek yalnız "Tanı Gönder" akışındaki ASYNC native pull ile dolar; bu ekran komut göndermez ve pull yapmaz.',
    ));
    return boundChannel({
      id: 'kwp', authority: 'NATIVE · ElmProtocol keep-alive + kurtarma merdiveni',
      title: SCHED_CHANNEL_TITLE.kwp, activity: 'UNKNOWN',
      activityNote: 'Kurtarma kanıtı okunamıyor → durum bilinmiyor.', fields: f,
    });
  }

  const atLimit = k.maxPerSession > 0 && k.recoveryCount >= k.maxPerSession;

  f.push(schedObserved({ id: 'kwpStatus', label: 'kurtarma durumu', source: SRC.kwp,
    note: 'Önbellekten; tazelenme zamanı kaynakta KAYITLI DEĞİL.' }, k.status));
  f.push(schedObserved({ id: 'kwpCount', label: 'ATPC gönderimi / tavan', source: SRC.kwp, note: 'Oturum tavanı native sabiti.' },
    `${k.recoveryCount} / ${k.maxPerSession}`));
  f.push(schedObserved({ id: 'kwpSuppressed', label: 'tavan nedeniyle gönderilmedi', source: SRC.kwp, note: 'Bastırılan kurtarma sayısı.' }, k.suppressedCount));
  f.push(schedObserved({ id: 'kwpStreak', label: 'ardışık NO_DATA / eşik', source: SRC.kwp, note: 'Eşiğe doğru sayan sayaç.' },
    `${k.coreNoDataStreak} / ${k.threshold}`));
  f.push(schedObserved({ id: 'kwpSendFail', label: 'ATPC kanal hatası', source: SRC.kwp, note: 'Denendi ama gitmedi.' }, k.atpcSendFailures));
  f.push(k.lastRecoveryAt > 0
    ? schedObserved({ id: 'kwpLastAt', label: 'son kurtarma tetiği', source: SRC.kwp,
        note: 'Gerçek damga; kurtarma için TANIMLI eşik YOK → STALE hesaplanmaz.', updatedAt: k.lastRecoveryAt },
        new Date(k.lastRecoveryAt).toISOString())
    : schedUnavailable({ id: 'kwpLastAt', label: 'son kurtarma tetiği', source: SRC.kwp, note: '' }, 'Hiç kurtarma tetiklenmedi.'));
  f.push(schedDerived(
    { id: 'kwpAtLimit', label: 'oturum tavanına ulaşıldı mı', source: `${SRC.kwp} (recoveryCount vs maxPerSession)`,
      note: 'KURAL: maxPerSession > 0 VE recoveryCount >= maxPerSession → EVET.' },
    k.maxPerSession > 0 ? (atLimit ? 'EVET' : 'HAYIR') : null,
  ));

  let activity: ChannelActivity = 'UNKNOWN';
  let activityNote = 'Kurtarma durumu sınıflandırılamadı.';
  if (atLimit || k.status === 'FAILED') {
    activity = 'BLOCKED';
    activityNote = atLimit
      ? 'Oturum kurtarma TAVANI dolu — yeni ATPC gönderilmiyor (açık bekleme/tavan durumu).'
      : 'Son kurtarma FAILED — ATPC sonrası veri dönmedi.';
  } else if (k.status === 'IN_PROGRESS') {
    activity = 'RUNNING';
    activityNote = 'Native kanıt kurtarmanın SÜRDÜĞÜNÜ bildiriyor (ATPC gönderildi, ilk PID bekleniyor).';
  } else if (k.status === 'NOT_ATTEMPTED') {
    activity = 'NOT_RUNNING';
    activityNote = 'Bu oturumda kurtarma hiç tetiklenmedi (KWP değil veya oturum sağlam).';
  } else if (k.status === 'RECOVERED') {
    activity = 'NOT_RUNNING';
    activityNote = 'Son kurtarma tamamlandı; şu an aktif kurtarma yok.';
  }

  return boundChannel({
    id: 'kwp', authority: 'NATIVE · ElmProtocol keep-alive + kurtarma merdiveni',
    title: SCHED_CHANNEL_TITLE.kwp, activity, activityNote, fields: f,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Discovery / Deep Scan — İKİ AYRI motor
 * ════════════════════════════════════════════════════════════════════════ */

function _discoveryDeepScanChannel(s: SchedRawSnapshot): SchedChannel {
  const f: SchedField[] = [];

  // Discovery: okumanın TEK yolu tekil nesneyi TEMBEL OLUŞTURUR → yan etki.
  f.push(schedUnsafe(
    { id: 'discoveryStatus', label: 'discovery koordinatör durumu', source: SRC.unsafe, note: '' },
    'Durumu okumanın tek yolu getLiveDiscoveryCoordinator(); bu fonksiyon tekil koordinatörü YOKSA OLUŞTURUR (üretim modül durumunu değiştirir). Yan etkisiz "peek" erişimcisi olmadığı için OKUNMADI.',
  ));
  f.push(schedUnavailable(
    { id: 'discoveryQueueDepth', label: 'discovery aday kuyruğu derinliği', source: SRC.none, note: '' },
    'extendedPidService._discoveryQueue modül-içi özeldir; erişimcisi yok. Boş kuyruk VARSAYILMAZ.',
  ));

  const d = s.deepScan;
  if (d) {
    f.push(schedObserved({ id: 'deepStatus', label: 'deep scan durumu', source: SRC.deep,
      note: 'Ayrı motor: deepScanRuntimeService (discovery koordinatöründen BAĞIMSIZ).' }, d.status));
    f.push(d.phase
      ? schedObserved({ id: 'deepPhase', label: 'aktif faz', source: SRC.deep, note: 'Çok fazlı orkestrasyonun anlık fazı.' }, d.phase)
      : schedUnavailable({ id: 'deepPhase', label: 'aktif faz', source: SRC.deep, note: '' }, 'Faz yok (tarama başlamadı).'));
    f.push(schedObserved({ id: 'deepProgress', label: 'ilerleme (%)', source: SRC.deep, note: 'Motorun kendi ilerleme alanı.' }, d.progressPercent));
    f.push(d.startedAt
      ? schedObserved({ id: 'deepStartedAt', label: 'başlangıç', source: SRC.deep,
          note: 'Gerçek damga; deep scan için TANIMLI bayatlık eşiği YOK → STALE hesaplanmaz.', updatedAt: d.startedAt },
          new Date(d.startedAt).toISOString())
      : schedUnavailable({ id: 'deepStartedAt', label: 'başlangıç', source: SRC.deep, note: '' }, 'Hiç başlatılmadı.'));
    f.push(d.updatedAt
      ? schedObserved({ id: 'deepUpdatedAt', label: 'son güncelleme', source: SRC.deep, note: 'Gerçek damga.', updatedAt: d.updatedAt },
          new Date(d.updatedAt).toISOString())
      : schedUnavailable({ id: 'deepUpdatedAt', label: 'son güncelleme', source: SRC.deep, note: '' }, 'Güncelleme yok.'));
    f.push(schedObserved({ id: 'deepWarnings', label: 'uyarı sayısı', source: SRC.deep, note: 'Bounded uyarı listesi boyutu.' }, d.warningsCount));
    f.push(d.errorCode
      ? schedObserved({ id: 'deepError', label: 'hata kodu', source: SRC.deep, note: 'Sınıflandırılmış.' }, d.errorCode)
      : schedUnavailable({ id: 'deepError', label: 'hata kodu', source: SRC.deep, note: '' }, 'Hata kaydı yok.'));
  } else {
    f.push(schedUnavailable({ id: 'deepStatus', label: 'deep scan durumu', source: SRC.deep, note: '' }, 'Deep scan runtime okunamadı.'));
  }

  // Aktivite: YALNIZ deep scan gözlemlenebilir; discovery UNSAFE olduğu için kanal
  // tamamen "çalışmıyor" ilan EDİLEMEZ.
  let activity: ChannelActivity = 'UNKNOWN';
  let activityNote = 'Discovery okunamıyor (yan etki riski); kanal bütünüyle sınıflandırılamaz.';
  if (d) {
    if (d.status === 'running' || d.status === 'scanning') {
      activity = 'RUNNING';
      activityNote = 'Deep scan motoru çalışıyor (durum alanı doğrudan gözlemlendi).';
    } else if (d.status === 'blocked' || d.status === 'waiting_ignition') {
      activity = 'BLOCKED';
      activityNote = 'Deep scan açık bir bekleme durumunda (kontak/kapı).';
    } else {
      activity = 'UNKNOWN';
      activityNote = `Deep scan durumu "${d.status}" (çalışmıyor) — ancak discovery koordinatörü yan etki riski nedeniyle okunmadı, bu yüzden kanal NOT_RUNNING ilan EDİLMEZ.`;
    }
  }

  return boundChannel({
    id: 'discovery-deepscan',
    authority: 'İKİ AYRI motor: discoveryLive koordinatörü + deepScanRuntimeService',
    title: SCHED_CHANNEL_TITLE['discovery-deepscan'], activity, activityNote, fields: f,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · CAN Collection
 * ════════════════════════════════════════════════════════════════════════ */

function _canCollectChannel(s: SchedRawSnapshot): SchedChannel {
  const f: SchedField[] = [];
  const c = s.canCollect;

  if (c) {
    f.push(schedObserved({ id: 'canCollecting', label: 'toplama açık', source: SRC.debug,
      note: 'Panel kapısı: yalnız CAN Monitor/DebugPanel açıkken halka tamponu dolar.' }, c.collecting));
    f.push(schedObserved({ id: 'canBuffer', label: 'halka tamponu', source: SRC.debug, note: 'Bounded tampon doluluğu.' },
      `${c.bufferLen} / ${c.bufferMax}`));
  } else {
    f.push(schedUnavailable({ id: 'canCollecting', label: 'toplama açık', source: SRC.debug, note: '' }, 'Okunamadı.'));
  }

  if (s.capture) {
    f.push(schedObserved({ id: 'canRefs', label: 'CAN toplama tüketicisi (ref)', source: SRC.capture,
      note: 'Ref-count > 0 = en az bir panel açık.' }, s.capture.canRefs));
    f.push(schedObserved({ id: 'obdCaptureRefs', label: 'OBD trafik yakalama tüketicisi (ref)', source: SRC.capture,
      note: 'Raw OBD Traffic ekranı açık mı.' }, s.capture.obdRefs));
  } else {
    f.push(schedUnavailable({ id: 'canRefs', label: 'CAN toplama tüketicisi (ref)', source: SRC.capture, note: '' }, 'Okunamadı.'));
  }

  f.push(schedUnavailable(
    { id: 'canFrameRate', label: 'CAN frame hızı (Hz)', source: SRC.none, note: '' },
    'debugStore.perf.canHz alanı VAR ama onu YAZAN kod YOK — gerçek frekans ölçümü mevcut değil.',
  ));

  let activity: ChannelActivity = 'UNKNOWN';
  let activityNote = 'Toplama durumu okunamadı.';
  if (c) {
    if (c.collecting && c.bufferLen > 0) {
      activity = 'RUNNING';
      activityNote = 'Toplama açık VE tamponda kayıt var — iki bağımsız gözlem.';
    } else if (c.collecting && c.bufferLen === 0) {
      activity = 'UNKNOWN';
      activityNote = 'Toplama bayrağı açık ama hiç frame yok — "veri akıyor" DENMEZ.';
    } else {
      activity = 'NOT_RUNNING';
      activityNote = 'Toplama kapalı (panel açık değil) — halka tamponu dolmuyor.';
    }
  }

  return boundChannel({
    id: 'can-collect', authority: 'JS · debugStore halka tamponu (panel kapısı)',
    title: SCHED_CHANNEL_TITLE['can-collect'], activity, activityNote, fields: f,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Dışa açık kurucular
 * ════════════════════════════════════════════════════════════════════════ */

export function buildSchedChannels(s: SchedRawSnapshot): SchedChannel[] {
  if (!s) return [];
  return [
    _commandExecChannel(s), _livePollingChannel(s), _handshakeChannel(s),
    _kwpChannel(s), _discoveryDeepScanChannel(s), _canCollectChannel(s),
  ];
}

export function buildSchedConflictInput(s: SchedRawSnapshot): SchedConflictInput {
  const k = s?.kwp ?? null;
  return {
    pollingTimerActive: s?.sessionHealth ? s.sessionHealth.pollingActive : null,
    dataFresh:          s?.sessionHealth ? s.sessionHealth.dataFresh : null,
    healthIsStale:      s?.health ? s.health.isStale : null,
    burstEnabled:       s?.pollEvidence && s.pollEvidence.present ? s.pollEvidence.burstEnabled : null,
    liveDataScreenOpen: s?.capture ? s.capture.obdRefs > 0 : null,
    kwpAtLimit:         k ? (k.maxPerSession > 0 ? k.recoveryCount >= k.maxPerSession : null) : null,
    kwpStatus:          k ? k.status : null,
  };
}

/**
 * Özet girdisi. `queueDepthKnown` ve `activeJobKnown` bugün DAİMA false —
 * native komut kuyruğu ve anlık aktif iş JS'e açılmamıştır (bkz. A4.1 önerisi).
 */
export function buildRuntimeSummaryInput(
  channels: readonly SchedChannel[],
  conflicts: number,
  counts: { running: number; blocked: number; unknown: number; notRunning: number },
): RuntimeSummaryInput {
  void channels;
  return {
    runningChannels:    counts.running,
    blockedChannels:    counts.blocked,
    unknownChannels:    counts.unknown,
    notRunningChannels: counts.notRunning,
    conflicts,
    queueDepthKnown:    false,
    activeJobKnown:     false,
  };
}
