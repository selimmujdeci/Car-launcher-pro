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

  /**
   * #506 — JS-tarafı EXTENDED SORGU KAPISI (`extendedPidService.getExtendedGateState()`).
   *
   * #503 ile gürültü (NO-DATA fırtınası) SESSİZLİKLE takas edildi: destek kanıtı yokken
   * hiçbir izlenen PID native'e gitmez. Bu doğru davranıştır ama DIŞARIDAN "poll ölü" ile
   * ayırt edilemezdi — `configuredPidCount: 0` hem "kimse izlemiyor" hem "16 PID kanıt
   * bekliyor" demek olabiliyordu. Bu alan sessizliğin SEBEBİNİ taşır.
   *
   * Native kanıttan BAĞIMSIZDIR (JS modül durumu) → kanıt önbelleği boşken de okunur.
   */
  /**
   * #524 — ELEME DURUMU. `null` = OKUNMADI; `elimState` ayrımı taşır
   * ('unsupported' = eski APK · 'error' = okuma düştü · 'never' = hiç denenmedi).
   */
  readonly elimState: 'never' | 'unsupported' | 'ok' | 'error';
  /** #526 — snapshot tazelenme anı (ms). `null` = hiç tazelenmedi. */
  readonly elimRefreshedAt: number | null;
  readonly pollEvidenceRefreshedAt: number | null;
  readonly elim: {
    cycle: number; watchedCount: number;
    permanentCount: number; pausedCount: number; everOkCount: number;
    bulkResetCount: number; lastBulkCycle: number;
    stabilizing: boolean; stabilizeCycles: number; suppressedDuringStabilize: number;
    demoteThreshold: number;
    permanentPids: readonly string[];
    pausedRemainingCycles: Readonly<Record<string, number>>;
    pauseLadder: readonly number[];
    reasonNeverOk: string; reasonPaused: string;
  } | null;

  readonly extGate: {
    supportedKnown: boolean;
    supportedCount: number;
    watchedCount: number;
    gatedCount: number;
    gatedPids: string[];
    discoveryPending: number;
    nativeListCount: number;
    burst: boolean;
  } | null;

  /** #512 · saha hipotezi 2: eleme ↔ tazelik zaman ekseni (bounded kuyruk). */
  readonly timeline: {
    /* YAPISAL tip — bu dosya servis/model import ETMEZ (dosya sözleşmesi). */
    summary: {
      verdict: string;
      sampleCount: number;
      demoteLevels: number;
      opposingSteps: number;
      agreeingSteps: number;
      firstAvgAgeMs: number | null;
      lastAvgAgeMs: number | null;
      firstDemoted: number | null;
      lastDemoted: number | null;
      reachedZeroPollable: boolean;
    };
    tail: readonly {
      atMs: number; watched: number; demoted: number;
      pollable: number; valued: number;
      avgAgeMs: number | null; maxAgeMs: number | null;
    }[];
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
  extGate:  'obd/extendedPidService.getExtendedGateState()',
  elim:     'obd/extendedElimination.getExtendedElimination()',
  session:  'obdService.getObdSessionHealth()',
  status:   'obdService.getOBDStatusSnapshot()',
  health:   'obd/ObdHealthMonitor.getObdHealth()',
  fresh:    'obdService.getObdFreshWindowMs()',
  hs:       'obdService.getHandshakeDiagnostics()',
  kwp:      'obd/kwpRecoveryEvidence.getKwpRecoveryEvidence()',
  deep:     'deepScan/deepScanRuntimeService.getSnapshot()',
  debug:    'platform/debug/debugStore',
  capture:  'devtools/devtoolsCapture.getDevtoolsCaptureStatus()',
  timeline: 'obd/extendedPollTimeline.readExtendedTimeline()',
  none:     'YOK',
  unsafe:   'obd/discovery/discoveryLive.getLiveDiscoveryCoordinator()',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Command Execution — NATIVE otorite
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * #506 — extended sorgu kapısının alanları. #503 (fail-closed) sessizliği ürettiği için
 * sessizliğin SEBEBİ okunabilir olmalıdır: "destek kanıtı yok → N PID beklemede".
 * Kaynak okunamazsa UNAVAILABLE — "kapı açık" ya da "0 PID" VARSAYILMAZ.
 */
/**
 * #512 · SAHA HİPOTEZİ 2 — "tazelenme, elemenin SONUCU olabilir".
 *
 * Round-robin tur başına 1 PID okur ve elenen PID'i atlar → bir PID'in güncellenme
 * aralığı ≈ (izlenen − elenen) × tur süresi. Liste kısaldıkça hayatta kalanlar
 * TAZELEŞİR; uçta liste sıfırlanırsa hiçbir şey güncellenmez. Bu blok iki eğriyi
 * AYNI ZAMAN EKSENİNDE gösterir ki iddia gözle değil ÖLÇÜMLE sınansın.
 */
function _pushTimelineFields(f: SchedField[], s: SchedRawSnapshot): void {
  const t = s.timeline;
  if (!t) {
    f.push(schedUnavailable(
      { id: 'tlVerdict', label: 'eleme ↔ tazelik ilişkisi', source: SRC.timeline, note: '' },
      'Zaman ekseni okunamadı — ilişki hakkında hüküm VERİLMEZ.',
    ));
    return;
  }

  const sum = t.summary;
  f.push(schedObserved(
    { id: 'tlVerdict', label: 'eleme ↔ tazelik ilişkisi', source: SRC.timeline,
      note: 'Ardışık örneklerde ELEME değişen adımlar sayılır; korelasyon katsayısı '
          + 'ÜRETİLMEZ (örnekler düzensiz aralıklı — sahte hassasiyet olurdu).' },
    `${sum.verdict} · destekleyen ${sum.opposingSteps} / karşı ${sum.agreeingSteps} adım`,
  ));

  f.push(schedObserved(
    { id: 'tlSamples', label: 'örnek / eleme seviyesi', source: SRC.timeline,
      note: 'Örnekleme YENİ TIMER kurmaz — var olan değer/eleme olaylarına iliştirilir. '
          + 'Kanal susunca örnekleme de durur; bu bir boşluk DEĞİL, bulgunun kendisidir.' },
    `${sum.sampleCount} örnek · ${sum.demoteLevels} farklı eleme seviyesi`,
  ));

  f.push(sum.firstAvgAgeMs === null || sum.lastAvgAgeMs === null
    ? schedUnavailable(
        { id: 'tlAge', label: 'ortalama yaş (ilk → son)', source: SRC.timeline, note: '' },
        'Değerli PID yok — yaş ölçülemedi (sahte 0 üretilmez).')
    : schedObserved(
        { id: 'tlAge', label: 'ortalama yaş (ilk → son)', source: SRC.timeline,
          note: 'Aynı pencerede eleme kaç → kaça çıktı, altındaki satırda.' },
        `${Math.round(sum.firstAvgAgeMs)} ms → ${Math.round(sum.lastAvgAgeMs)} ms`));

  f.push(sum.firstDemoted === null || sum.lastDemoted === null
    ? schedUnavailable(
        { id: 'tlDemote', label: 'elenen PID (ilk → son)', source: SRC.timeline, note: '' },
        'Örnek yok.')
    : schedObserved(
        { id: 'tlDemote', label: 'elenen PID (ilk → son)', source: SRC.timeline,
          note: 'Yaş DÜŞERKEN bu sayı ARTIYORSA hipotez doğrulanır.' },
        `${sum.firstDemoted} → ${sum.lastDemoted}`));

  f.push(schedObserved(
    { id: 'tlZero', label: 'rotasyon sıfıra düştü mü', source: SRC.timeline,
      note: 'Sıfır = izlenenlerin TAMAMI elenmiş → hiçbir extended PID güncellenmiyor '
          + '(tur sayacı yine de artmaya devam eder).' },
    sum.reachedZeroPollable ? 'EVET — kanal tamamen sustu' : 'hayır',
  ));

  /* Son 12 örnek — üç seri AYNI satırda, zaman farkı ile (mutlak damga değil). */
  const tail = t.tail;
  if (tail.length === 0) {
    f.push(schedUnavailable(
      { id: 'tlTail', label: 'son örnekler', source: SRC.timeline, note: '' },
      'Hiç örnek kaydedilmedi — extended kanal bu oturumda hiç veri/eleme üretmedi.',
    ));
    return;
  }
  const t0 = tail[0].atMs;
  const rows = tail.map((x) => {
    const age = x.avgAgeMs === null ? '—' : `${Math.round(x.avgAgeMs)}ms`;
    return `+${Math.round((x.atMs - t0) / 1000)}s izl${x.watched}/ele${x.demoted}/rot${x.pollable} yaş${age}`;
  });
  f.push(schedObserved(
    { id: 'tlTail', label: 'son örnekler (izlenen/elenen/rotasyon · ortalama yaş)',
      source: SRC.timeline,
      note: 'Zaman ilk örneğe GÖRELİ (mutlak damga taşınmaz). Bounded: son 12 örnek.' },
    rows.join('  |  '),
  ));
}

/**
 * #524 — ELEME GÖRÜNÜRLÜĞÜ. Sahada izlenen PID sayısı 6'ya düşüyordu ve
 * "hangi PID neden sorulmuyor" sorusunun cevabı HİÇBİR YERDE yoktu.
 */
function _pushElimFields(f: SchedField[], s: SchedRawSnapshot): void {
  /* #526 — SNAPSHOT YAŞI EN ÜSTTE. Sahada `lastPollAt` 5 dk 17 sn bayat görünüp
     "poll durdu" sanıldı; poll durmamıştı, ÖNBELLEK eskiydi. `cacheState:'ok'`
     bunu gizliyordu — "bir kez tazelendi" ile "şu an taze" AYNI ŞEY DEĞİL.
     Yaş artık okuyucunun gözünün önünde; tahmin gerektirmez. */
  const ageOf = (at: number | null): string =>
    at === null ? 'hiç tazelenmedi'
      : `${Math.round(Math.max(0, s.readAt - at) / 1000)} sn önce okundu`;
  f.push(schedDerived(
    { id: 'elimSnapshotAge', label: 'native sayaç snapshot yaşı', source: 'türetim (bu model)',
      note: 'Bu bölümdeki native sayaçlar ÖNBELLEKTEN gelir; önbelleği yalnız bu ekran '
          + 'açıldığında yapılan async çağrı doldurur. Yaş büyükse sayılar ESKİ bir andan '
          + 'gelir — "poll durdu" DEMEK DEĞİLDİR.' },
    `eleme: ${ageOf(s.elimRefreshedAt)} · poll kanıtı: ${ageOf(s.pollEvidenceRefreshedAt)}`,
  ));

  const e = s.elim;
  if (!e) {
    const why = s.elimState === 'unsupported'
      ? 'Bu APK sürümünde eleme okuma ucu YOK — eleme OLMADIĞI anlamına GELMEZ.'
      : s.elimState === 'error'
        ? 'Okuma DÜŞTÜ — eleme durumu bilinmiyor.'
        : 'Henüz okunmadı.';
    f.push(schedUnavailable(
      { id: 'elimState', label: 'PID eleme durumu', source: SRC.elim, note: '' }, why));
    return;
  }

  /* Ana satır: tek bakışta "kaç PID sustuu ve NEDEN". */
  const head = e.permanentCount === 0 && e.pausedCount === 0
    ? 'eleme YOK — tüm izlenen PID sırada'
    : `${e.permanentCount} kalıcı · ${e.pausedCount} geçici duraklatılmış`;
  f.push(schedObserved(
    { id: 'elimSummary', label: 'elenen PID (kalıcı / duraklatılmış)', source: SRC.elim,
      note: `KALICI = ${e.reasonNeverOk}; DURAKLATILMIŞ = ${e.reasonPaused}. `
          + 'Bir kez OK dönen PID KALICI elenemez — artan aralıkla yeniden denenir.' },
    head,
  ));

  f.push(schedObserved(
    { id: 'elimEverOk', label: 'veri vermiş PID / izlenen', source: SRC.elim,
      note: 'Bir kez OK dönen PID kalıcı eleme dışıdır (araç verdiğini kanıtladı).' },
    `${e.everOkCount} / ${e.watchedCount}`,
  ));

  if (e.permanentPids.length > 0) {
    f.push(schedObserved(
      { id: 'elimPermPids', label: 'kalıcı elenen PID listesi', source: SRC.elim,
        note: 'Hiç OK dönmemiş PID listesi. Oturum-içi: yeni bağlantı sıfırlar.' },
      e.permanentPids.join(' · '),
    ));
  }
  const pausedEntries = Object.entries(e.pausedRemainingCycles);
  if (pausedEntries.length > 0) {
    f.push(schedObserved(
      { id: 'elimPausedPids', label: 'duraklatılmış PID → kalan tur', source: SRC.elim,
        note: `Merdiven (tur): ${e.pauseLadder.join(' → ')}. Süre dolunca sıraya GERİ girer.` },
      pausedEntries.map(([pid, left]) => `${pid}:${left}`).join(' · '),
    ));
  }

  /* Stabilizasyon: bağlantı sonrası sessizlik ELEME KANITI DEĞİLDİR. */
  f.push(schedObserved(
    { id: 'elimStabilize', label: 'stabilizasyon penceresi', source: SRC.elim,
      note: `Bağlantıdan sonraki ilk ${e.stabilizeCycles} turda NO_DATA eleme kanıtı SAYILMAZ `
          + '(hat henüz oturmamıştır).' },
    e.stabilizing
      ? `AÇIK (tur ${e.cycle}) · şu ana dek ${e.suppressedDuringStabilize} NO_DATA kanıt sayılmadı`
      : `kapalı · pencerede ${e.suppressedDuringStabilize} NO_DATA kanıt sayılmamıştı`,
  ));

  /* Toplu eleme = HAT OLAYI. Sessizce yutulmaz. */
  f.push(schedObserved(
    { id: 'elimBulk', label: 'toplu eleme (hat olayı)', source: SRC.elim,
      note: 'Kısa pencerede çok sayıda PID birden susarsa bu, araçların ayrı ayrı '
          + '"desteklemiyorum" demesi DEĞİL, hattın düşmesidir → eleme sıfırlanır.' },
    e.bulkResetCount === 0
      ? 'olay YOK'
      : `${e.bulkResetCount} kez · sonuncusu tur ${e.lastBulkCycle}`,
  ));
}

function _pushGateFields(f: SchedField[], s: SchedRawSnapshot): void {
  const g = s.extGate;
  if (!g) {
    f.push(schedUnavailable(
      { id: 'cmdGate', label: 'extended sorgu kapısı', source: SRC.extGate, note: '' },
      'Kapı durumu okunamadı — sessizliğin sebebi BİLİNMİYOR ("kapı açık" VARSAYILMAZ).',
    ));
    return;
  }

  // Ana satır: tek bakışta "neden sessiz".
  const reason = !g.supportedKnown
    ? (g.gatedCount > 0
        ? `DESTEK KANITI YOK → ${g.gatedCount} PID BEKLEMEDE`
        : 'DESTEK KANITI YOK · izlenen PID de yok')
    : (g.gatedCount > 0
        ? `kanıt VAR · ${g.gatedCount} PID araç desteklemediği için elendi`
        : 'kanıt VAR · elenen PID yok');
  f.push(schedObserved(
    { id: 'cmdGate', label: 'extended sorgu kapısı', source: SRC.extGate,
      note: '#503 fail-closed: destek kanıtı YOKKEN izlenen PID native\'e GİTMEZ. '
          + '"Beklemede" = sorgulanabilir ama kanıt beklediği için gönderilmeyen PID.' },
    reason,
  ));

  f.push(schedObserved(
    { id: 'cmdGateWatchers', label: 'izleyici / beklemede / native listede', source: SRC.extGate,
      note: 'İzleyici sayısı JS tarafındadır; native liste keşif kuyruğunu da içerir.' },
    `${g.watchedCount} / ${g.gatedCount} / ${g.nativeListCount}`,
  ));

  f.push(g.gatedPids.length > 0
    ? schedObserved({ id: 'cmdGatePids', label: 'bekleyen PID\'ler', source: SRC.extGate,
        note: 'Bounded liste (≤16) — hangi sinyalin sustuğu görünsün.' }, g.gatedPids.join(' '))
    : schedObserved({ id: 'cmdGatePids', label: 'bekleyen PID\'ler', source: SRC.extGate,
        note: 'Bekleyen yok.' }, '—'));

  f.push(schedObserved(
    { id: 'cmdGateDiscovery', label: 'kapıyı açacak keşif sorgusu', source: SRC.extGate,
      note: 'Bekleyen bitmask sorgusu (00/20/40…). 0 + kanıt yok = kapı KENDİLİĞİNDEN açılmaz.' },
    g.discoveryPending,
  ));

  f.push(g.supportedKnown
    ? schedObserved({ id: 'cmdGateSupported', label: 'kanıtlı destekli PID', source: SRC.extGate,
        note: 'Handshake tohumu + extended bitmask keşfinin BİRLEŞİMİ.' }, g.supportedCount)
    : schedUnavailable({ id: 'cmdGateSupported', label: 'kanıtlı destekli PID', source: SRC.extGate, note: '' },
        'Destek kanıtı YOK — desteklenen PID sayısı BİLİNMİYOR ("0 destekli" DEĞİL).'));
}

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

  /* #506 — SESSİZLİĞİN SEBEBİ. Native kanıttan BAĞIMSIZ okunur (JS modül durumu), bu yüzden
     `present=false` erken dönüşünden ÖNCE eklenir: kanıt önbelleği boşken bile "neden hiçbir
     şey sorulmuyor" cevaplanabilmelidir — #503 fail-closed'ın gözlem borcu tam olarak budur. */
  _pushGateFields(f, s);
  _pushElimFields(f, s);
  /* #512 — ELEME ↔ TAZELİK. Kapı gibi bu da JS modül durumundan okunur, o yüzden
     `present=false` erken dönüşünden ÖNCE eklenir: native kanıt boşken de "eleme
     arttıkça tazelik arttı mı" sorusu cevaplanabilmelidir. */
  _pushTimelineFields(f, s);

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
