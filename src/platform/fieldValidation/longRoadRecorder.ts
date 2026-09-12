/**
 * longRoadRecorder.ts — OTOMATİK UZUN YOL SAHA DOĞRULAMA gözlemcisi.
 *
 * Bu modül sistemin TEK zamanlayıcı sahibidir. Diğer tüm katmanlar SAFtır.
 *
 * ── BU MODÜL NE YAPMAZ (görev §0 — pazarlıksız) ─────────────────────────────
 *  · OBD komutu göndermez · polling sırasını/süresini değiştirmez
 *  · bağlantı kurmaz/kesmez · reset/reconnect tetiklemez
 *  · GPS/Bluetooth/internet durumunu değiştirmez
 *  · servis veya süreç başlatmaz/yeniden başlatmaz
 *  · popup açmaz · ses çalmaz · sesli komut vermez · ekran değiştirmez
 *  · müzik/navigasyon başlatmaz · araç komutu göndermez
 *  · yapay arıza üretmez
 * Yaptığı TEK şey: mevcut senkron getter'ları OKUMAK ve defter tutmak.
 *
 * ── ZAMANLAYICI DİSİPLİNİ ───────────────────────────────────────────────────
 *  · TEK `setInterval` (1 Hz). Oturum durdurulunca MUTLAKA temizlenir.
 *  · Dinleyiciler (`visibilitychange`, `online`/`offline`, bellek baskısı)
 *    açılışta kurulur, kapanışta MUTLAKA sökülür — Zero-Leak (CLAUDE.md §1).
 *  · Tick içinde ağır analiz YOKTUR: okuma + saf defter ilerletme.
 *  · Diske yazım tick başına DEĞİL, checkpoint aralığında olur.
 */

import {
  LR_CHECKPOINT_INTERVAL_MS, LR_MAX_BLACKBOX_EVENTS, LR_SAMPLE_INTERVAL_MS,
  LR_SNAPSHOT_PERIODIC_KM, LR_SNAPSHOT_PERIODIC_MS, SNAPSHOT_PRIORITY,
  advanceCounter, advanceOdometry, advanceSignal, applySnapshotDecision,
  applyStoragePressure, chooseCriticalEvictionVictim, classifySnapshotDrop,
  collectRecordIds, createSession, decideSnapshot, emptyIdentityScan, findScenario,
  formatRecordId, isBlackBoxTrigger, isRecordingState, isSnapshotAllowed, markScenario,
  nextSessionState, odometerDistanceKm, preflightBlocksSession, pushEvent,
  resumeSession, scanRecordIdentity,
  type FieldEvent, type IdentityScan, type LongRoadSession, type RestoreReason,
  type SignalId, type SnapshotIndexRow, type SnapshotTrigger,
} from './longRoadModel';
import {
  blackBoxFinalize, blackBoxOpen, blackBoxTick, emptyBlackBoxState, frameFromSample,
  type BlackBoxState,
} from './longRoadBlackBox';
import {
  detect, emptyDetectState, seedDetectState,
  type DetectState, type LongRoadSample,
} from './longRoadDetect';
import {
  emptyInjection, readAsyncAugment, readLongRoadSample, readPreflight, readSessionEnv,
  type SampleInjection,
} from './longRoadSources';
import {
  classifyStoragePressure, deleteSession, loadBlackBoxOutcome, loadSession,
  measureUsedBytes, saveBlackBox, saveSession,
  type BlackBoxLoadOutcome,
} from './longRoadStore';
import { readSessionRawSnapshot } from '../devtools/sessionInspectorSources';
import { onMemoryPressure } from '../memoryWatchdog';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Modül durumu
 * ════════════════════════════════════════════════════════════════════════ */

/** Bellekte tutulan snapshot gövdesi sayısı — dışa aktarım için (bounded). */
const MAX_SNAPSHOT_BODIES = 8;

export interface SnapshotBody {
  readonly id: string;
  readonly trigger: SnapshotTrigger;
  readonly takenAt: number;
  /** CAROS LAB oturum snapshot'ının AYNISI — paralel model kurulmadı. */
  readonly raw: ReturnType<typeof readSessionRawSnapshot> | null;
  readonly offlineQueueSize: number | null;
}

interface RecorderState {
  session: LongRoadSession | null;
  detect: DetectState;
  blackBox: BlackBoxState;
  injection: SampleInjection;
  bodies: SnapshotBody[];
  timer: ReturnType<typeof setInterval> | null;
  cleanups: (() => void)[];
  lastTickMono: number | null;
  lastCheckpointMono: number | null;
  lastPeriodicSnapshotMono: number | null;
  lastPeriodicDistanceKm: number | null;
  /** Aynı anda birden fazla async augment koşmasın. */
  augmentInFlight: boolean;
  seq: number;
  /**
   * BlackBox içerik revizyonu (D2). YALNIZ pencere kümesi KENAR değiştirdiğinde
   * artar (açılış · kapanış · finalizasyon). `persistedRev` ile farklıysa disk
   * bayattır → yazılır. Bu iki sayı, "her 30 sn'de tam blob yeniden yazımı"nın
   * yerine geçen tek mekanizmadır.
   */
  blackBoxRev: number;
  blackBoxPersistedRev: number;
  /** Son BlackBox okuma hükmü — LAB ve öz-denetim için (gözlemlenebilirlik). */
  blackBoxLoad: BlackBoxLoadOutcome | null;
  /** Son kimlik taraması (D1) — restore tohumlamasının kanıtı. */
  identityScan: IdentityScan;
}

const _state: RecorderState = {
  session: null,
  detect: emptyDetectState(),
  blackBox: emptyBlackBoxState(),
  injection: emptyInjection(),
  bodies: [],
  timer: null,
  cleanups: [],
  lastTickMono: null,
  lastCheckpointMono: null,
  lastPeriodicSnapshotMono: null,
  lastPeriodicDistanceKm: null,
  augmentInFlight: false,
  seq: 0,
  blackBoxRev: 0,
  blackBoxPersistedRev: 0,
  blackBoxLoad: null,
  identityScan: emptyIdentityScan(),
};

type Listener = () => void;
const _listeners = new Set<Listener>();

/** Ekran/gösterge aboneliği. Dönen thunk aboneliği SÖKER (Zero-Leak). */
export function subscribeLongRoad(fn: Listener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

function _emit(): void {
  for (const fn of _listeners) {
    try { fn(); } catch { /* dinleyici patlarsa gözlemci DURMAZ */ }
  }
}

function _now(): number { return Date.now(); }
function _mono(): number {
  try { return performance.now(); } catch { return Date.now(); }
}

/**
 * Yeni kayıt kimliği (D1). Sayaç `_state.seq` process ömürlüdür AMA restore'da
 * defterden tohumlanır; kimliğe ayrıca `sessionVersion` öneki girer → aynı
 * sekans farklı sürümlerde bile ÇAKIŞAMAZ.
 *
 * `version` AÇIKÇA geçilir: `_state.session` bu çağrı sırasında henüz eski/boş
 * olabilir (oturum açılışı) ve sessizce yanlış sürüm damgalanırdı.
 */
function _nextId(prefix: 'EV' | 'SNAP', version: number): string {
  _state.seq += 1;
  return formatRecordId(prefix, version, _state.seq);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Dışa açık okuma yüzeyi (salt-okunur)
 * ════════════════════════════════════════════════════════════════════════ */

export function getLongRoadSession(): LongRoadSession | null {
  return _state.session;
}

export function getLongRoadBlackBox(): BlackBoxState {
  return _state.blackBox;
}

export function getLongRoadBodies(): readonly SnapshotBody[] {
  return _state.bodies;
}

export function isLongRoadActive(): boolean {
  return _state.session !== null && isRecordingState(_state.session.state);
}

function _criticalCount(s: LongRoadSession | null): number {
  if (!s) return 0;
  let n = 0;
  for (const e of s.events) if (e.severity === 'CRITICAL') n += 1;
  return n;
}

/** Sürüş göstergesi için kritik sorun sayısı (görev §14). */
export function getLongRoadCriticalCount(): number {
  return _criticalCount(_state.session);
}

/**
 * Sürüş sırasındaki PASİF gösterge için asgari özet (görev §14).
 * Yalnız üç sayı + hareket durumu — gösterge bundan fazlasını GÖSTERMEZ.
 */
export interface LongRoadGlance {
  readonly active: boolean;
  readonly elapsedMs: number;
  readonly distanceKm: number | null;
  readonly criticalCount: number;
  /** `true` → araç hareket hâlinde. Özet ancak DURUNCA açılabilir. */
  readonly moving: boolean;
}

export function getLongRoadGlance(): LongRoadGlance {
  const s = _state.session;
  if (!s) return { active: false, elapsedMs: 0, distanceKm: null, criticalCount: 0, moving: false };
  const prev = _state.detect.prev;
  return {
    active: isRecordingState(s.state),
    elapsedMs: Math.max(0, (s.endedAt ?? _now()) - s.startedAt),
    distanceKm: odometerDistanceKm(s.odometry),
    criticalCount: getLongRoadCriticalCount(),
    /* Hız okunamıyorsa HAREKET VARSAYILIR (fail-closed): bilinmezlikte özet
       açılmaz, çünkü sürücünün dikkatini dağıtmamak güvenlik tarafındadır. */
    moving: prev === null || prev.speed === null || prev.speed > 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Oturum yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Uygulama açılışında çağrılır: DİSKTE aktif oturum varsa AYNI `sessionId` ile
 * devam eder (görev §13). Aktif oturum yoksa HİÇBİR ŞEY BAŞLATMAZ.
 *
 * Bu fonksiyon yeni oturum AÇMAZ — yalnız var olanı sürdürür.
 */
export function initLongRoadRecorder(reason: RestoreReason = 'APP_RESTART'): LongRoadSession | null {
  if (_state.session !== null) return _state.session;

  const outcome = loadSession();
  if (outcome.kind === 'NONE') return null;

  if (outcome.kind === 'CORRUPT') {
    /* FAIL-CLOSED: bozuk kayıt sessizce SİLİNMEZ ve "yeni oturum" gibi
       gösterilmez; kullanıcıya CORRUPT olarak sunulur. */
    const marker = createSession('CORRUPT', _now());
    _state.session = { ...marker, state: 'CORRUPT' };
    _emit();
    return _state.session;
  }

  const stored = outcome.session;
  const load = loadBlackBoxOutcome(stored.sessionId);
  _state.blackBoxLoad = load;

  if (!isRecordingState(stored.state) && stored.state !== 'PAUSED_BY_SYSTEM') {
    /* Tamamlanmış/başarısız oturum: RAPOR için yüklenir ama ÖLÇÜM başlamaz. */
    _state.session = stored;
    _state.blackBox = { ..._state.blackBox, closed: load.windows };
    /* Disk zaten güncel — yüklediğimizi geri YAZMAYIZ (D2 yazma bütçesi). */
    _state.blackBoxRev = 0;
    _state.blackBoxPersistedRev = 0;
    _seedIdentityFromSession(stored, load);
    _emit();
    return _state.session;
  }

  /* ── D1 · KİMLİK TOHUMLAMASI — resumeSession'dan ÖNCE ─────────────────────
     Sıra kritiktir: `resumeSession` deftere RESTORE olayı yazar; sayacı ondan
     sonra tohumlamak yeni kimlikleri de taramaya dâhil ederdi. */
  const scan = _seedIdentityFromSession(stored, load);

  const resumed = resumeSession(stored, reason, _now());
  _state.session = _applyIdentityLedger(resumed, scan);
  /* "İLK bağlantı/handshake" senaryoları RESTORE'da TEKRAR ÜRETİLMEZ. */
  _state.detect = seedDetectState(emptyDetectState(), {
    firstLinkSeen: findScenario(stored, 'FIRST_VEHICLE_LINK').hits > 0,
    firstHandshakeSeen: findScenario(stored, 'FIRST_HANDSHAKE_OK').hits > 0,
  });
  _state.blackBox = { ...emptyBlackBoxState(), closed: load.windows };
  _state.blackBoxRev = 0;
  _state.blackBoxPersistedRev = 0;

  /* Kimlik bütünlüğü FAIL ise SESSİZCE DEVAM EDİLMEZ: defterde görünür,
     fail-closed bir kayıt bırakılır (öz-denetleyici bunu ayrıca yakalar). */
  if (scan.verdict === 'FAIL_DUPLICATE_ID' || scan.verdict === 'FAIL_DUPLICATE_SEQUENCE') {
    _state.session = pushEvent(_state.session, {
      id: _nextId('EV', _state.session.sessionVersion),
      type: 'IDENTITY_INTEGRITY',
      severity: 'CRITICAL',
      detectedAt: _now(),
      detail: `Kayıt kimliği bütünlüğü BOZUK (${scan.verdict}): kopya kimlik=${scan.duplicateIds}, `
        + `kopya sekans=${scan.duplicateSequences}, çözülemeyen=${scan.unparsable}`,
    });
  } else if (scan.verdict === 'DEGRADED_UNPARSABLE') {
    _state.session = pushEvent(_state.session, {
      id: _nextId('EV', _state.session.sessionVersion),
      type: 'IDENTITY_INTEGRITY',
      severity: 'WARN',
      detectedAt: _now(),
      detail: `Çözülemeyen kayıt kimliği bulundu ve YOK SAYILDI (adet=${scan.unparsable}); `
        + `sayaç en büyük geçerli sekanstan (${scan.maxSequence}) tohumlandı.`,
    });
  }

  _startLoop();
  _takeSnapshot('PROCESS_RESTORE');
  _persist();
  _emit();
  return _state.session;
}

/**
 * D1 · Sekans sayacını TOHUMLAR ve taramayı döner.
 *
 * İKİ bağımsız kaynağın BÜYÜĞÜ alınır:
 *  · defterdeki **tüm** geçerli kimliklerin en büyük sekansı (son kayda
 *    güvenilmez — budama/atlama olabilir),
 *  · oturumla birlikte diske yazılan `identity.idHighWater`.
 * Defter tamamen budanmış olsa bile ikincisi korur; ikisi de kaybolursa
 * kimlikteki `sessionVersion` öneki yapısal güvence olarak kalır.
 */
function _seedIdentityFromSession(
  stored: LongRoadSession,
  load: BlackBoxLoadOutcome,
): IdentityScan {
  const scan = scanRecordIdentity(
    collectRecordIds(stored, load.windows.map((w) => w.eventId)),
  );
  _state.identityScan = scan;
  _state.seq = Math.max(scan.maxSequence, stored.identity?.idHighWater ?? 0);
  return scan;
}

function _applyIdentityLedger(s: LongRoadSession, scan: IdentityScan): LongRoadSession {
  return {
    ...s,
    identity: {
      idHighWater: Math.max(s.identity?.idHighWater ?? 0, _state.seq),
      lastScanVerdict: scan.verdict,
      unparsableIds: scan.unparsable,
      duplicateIds: scan.duplicateIds,
      duplicateSequences: scan.duplicateSequences,
      sequenceGaps: scan.sequenceGaps,
      seedCount: (s.identity?.seedCount ?? 0) + 1,
      lastSeededFrom: _state.seq,
    },
  };
}

/** Son kimlik taraması — LAB/rapor için salt-okunur. */
export function getLongRoadIdentityScan(): IdentityScan {
  return _state.identityScan;
}

/** Son BlackBox okuma hükmü — LAB/rapor için salt-okunur. */
export function getLongRoadBlackBoxLoad(): BlackBoxLoadOutcome | null {
  return _state.blackBoxLoad;
}

/**
 * Son checkpoint'ten bu yana kaybedilebilecek AZAMİ ölçüm penceresi.
 *
 * Bu bir HATA DEĞİL, açıkça seçilmiş bir bütçe takasıdır: her tick'te diske
 * yazmak eMMC bütçesini (CLAUDE.md §I/O) 8 saatlik yolculukta ~29 000 yazımla
 * patlatırdı. Kritik olaylar bu pencereyi BEKLEMEZ — anında yazılır (aşağıya
 * bkz. `_tick` içindeki kritik-olay persist'i). Raporda da bu sınır belirtilir.
 */
export const LR_MAX_CHECKPOINT_LOSS_MS = LR_CHECKPOINT_INTERVAL_MS;

/**
 * Kullanıcının tek eylemi: BAŞLAT. Preflight koşar, oturum açar, döngüyü kurar.
 * Preflight kritik kapıda düşerse oturum FAILED olur ve döngü KURULMAZ.
 */
export function startLongRoadSession(): LongRoadSession {
  stopLoopOnly();

  const now = _now();
  const id = `LR-${now.toString(36).toUpperCase()}`;
  /* YENİ oturum → sayaç ve kimlik defteri SIFIRDAN başlar (restore DEĞİL). */
  _state.seq = 0;
  _state.identityScan = emptyIdentityScan();
  _state.blackBoxLoad = null;
  let s = createSession(id, now);
  s = { ...s, env: readSessionEnv(), preflight: readPreflight() };

  /* Kapı TEK OTORİTEDEN sorulur (`preflightBlocksSession`). Buradaki kural
     eskiden elle kopyalanmıştı; iki kopya, kritik kapı listesi değiştiğinde
     sessizce ayrışırdı (envanter denetimi E-31 — ikinci otorite). */
  if (preflightBlocksSession(s.preflight)) {
    s = pushEvent({ ...s, state: nextSessionState(s.state, 'FAIL') }, {
      id: _nextId('EV', s.sessionVersion),
      type: 'PREFLIGHT',
      severity: 'CRITICAL',
      detectedAt: now,
      detail: 'Kalıcılık kapısı düştü — kanıt saklanamayacağı için oturum başlatılmadı.',
    });
    _state.session = s;
    _persist();
    _emit();
    return s;
  }

  s = { ...s, state: nextSessionState(s.state, 'ACTIVATE') };
  _state.session = s;
  _state.detect = emptyDetectState();
  _state.blackBox = emptyBlackBoxState();
  _state.bodies = [];
  _state.lastTickMono = null;
  _state.lastCheckpointMono = null;
  _state.lastPeriodicSnapshotMono = null;
  _state.lastPeriodicDistanceKm = null;
  _state.blackBoxRev = 0;
  _state.blackBoxPersistedRev = 0;

  _startLoop();
  _takeSnapshot('SESSION_START');
  _persist();
  _emit();
  /* `_takeSnapshot`/`_persist` `_state.session`i GÜNCELLER — yerel `s` bayattır.
     Çağırana bayat gövde dönmek "snapshot alınmadı" gibi görünürdü. */
  return _state.session ?? s;
}

/** Kullanıcının ikinci eylemi: DURDUR. Döngü söker, son snapshot alınır. */
export function stopLongRoadSession(): LongRoadSession | null {
  const s = _state.session;
  if (!s) return null;

  _takeSnapshot('SESSION_END');
  _state.blackBox = blackBoxFinalize(_state.blackBox, _mono());
  /* Finalizasyon bir KENAR'dır: açık pencereler kapandı → disk bayatladı. */
  _state.blackBoxRev += 1;

  const stopped: LongRoadSession = {
    ..._state.session ?? s,
    state: nextSessionState((_state.session ?? s).state, 'STOP'),
    endedAt: _now(),
  };
  _state.session = stopped;
  stopLoopOnly();
  _persist();
  _emit();
  return stopped;
}

/** Oturumu ve kanıtı siler (kullanıcı açıkça isterse). */
export function clearLongRoadSession(): void {
  stopLoopOnly();
  deleteSession();
  _state.session = null;
  _state.detect = emptyDetectState();
  _state.blackBox = emptyBlackBoxState();
  _state.bodies = [];
  _state.seq = 0;
  _state.blackBoxRev = 0;
  _state.blackBoxPersistedRev = 0;
  _state.blackBoxLoad = null;
  _state.identityScan = emptyIdentityScan();
  _emit();
}

/** Yalnız zamanlayıcı/dinleyicileri söker — oturum gövdesine DOKUNMAZ. */
export function stopLoopOnly(): void {
  if (_state.timer !== null) {
    clearInterval(_state.timer);
    _state.timer = null;
  }
  for (const c of _state.cleanups) {
    try { c(); } catch { /* sökme hatası gözlemciyi kilitlemez */ }
  }
  _state.cleanups = [];
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Döngü ve dinleyiciler
 * ════════════════════════════════════════════════════════════════════════ */

function _startLoop(): void {
  stopLoopOnly();

  /* Bellek baskısı: ürünün KENDİ otoritesi (memoryWatchdog) — biz eşik üretmeyiz. */
  try {
    const off = onMemoryPressure((evt) => {
      _state.injection = { ..._state.injection, memoryPressure: evt.level };
    });
    _state.cleanups.push(off);
  } catch { /* watchdog yoksa alan null kalır */ }

  /* Uygulama görünürlüğü — salt dinleme (+ kontrollü process-death güvenlik noktası). */
  try {
    const onVis = (): void => {
      const visible = document.visibilityState === 'visible';
      _state.injection = { ..._state.injection, appVisible: visible };
      /* D2: arka plana geçiş, Android'in süreci öldürmeye EN YAKIN olduğu andır.
         Blob'u 30 sn'de bir yeniden yazmak yerine TAM BURADA bir kez yazarız —
         kenar tetiklemeli yazımın "kontrollü güvenlik noktası" ayağı budur. */
      if (!visible && _state.session !== null && isRecordingState(_state.session.state)) {
        _persist();
      }
    };
    onVis();
    document.addEventListener('visibilitychange', onVis);
    _state.cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
  } catch { /* DOM yoksa alan null kalır */ }

  _state.timer = setInterval(_tick, LR_SAMPLE_INTERVAL_MS);
}

/**
 * Tek tick. SIRA ÖNEMLİ: okuma → saf defter → BlackBox → snapshot → checkpoint.
 * Hiçbir adım throw etmemeli; throw ederse gözlemci durur ama ÜRÜN etkilenmez.
 */
function _tick(): void {
  try {
    const s = _state.session;
    if (!s || !isRecordingState(s.state)) return;

    const wall = _now();
    const mono = _mono();
    const dt = _state.lastTickMono === null ? 0 : Math.max(0, mono - _state.lastTickMono);
    _state.lastTickMono = mono;

    /* Saat sıçraması koruması: monoton delta beklenenin 10 katıysa örnek
       ölçüme SAYILMAZ (uyku/askıya alma) — sahte "hareket süresi" üretmez. */
    const dtValid = dt > 0 && dt <= LR_SAMPLE_INTERVAL_MS * 10;
    const effectiveDt = dtValid ? dt : 0;

    const sample = readLongRoadSample(wall, mono, _state.injection);

    const beforeCritical = _criticalCount(s);
    const revBefore = _state.blackBoxRev;
    let next = _advanceLedgers(s, sample, effectiveDt, wall);
    next = _applyDetection(next, sample, wall, mono);

    /* Pencere KAPANIŞI bir kenardır: kapalı pencere sayısı arttıysa post-window
       tamamlanmış demektir → final bounded kayıt diske yazılmalı (D2). */
    const closedBefore = _state.blackBox.closed.length;
    _state.blackBox = blackBoxTick(_state.blackBox, frameFromSample(sample));
    if (_state.blackBox.closed.length > closedBefore) _state.blackBoxRev += 1;

    _state.session = next;

    _maybePeriodicSnapshot(mono);

    /* KRİTİK olay ve BlackBox KENARI checkpoint aralığını BEKLEMEZ: kesinti
       anında uygulama ölürse bu kanıt bir daha üretilemez (tekrarlanamaz saha
       olayı). Kenar = pencere açılışı (pre-kareler donduruldu) veya kapanışı
       (post tamamlandı) — D2'nin izin verdiği yazım anları tam olarak bunlar. */
    if (_criticalCount(next) > beforeCritical || _state.blackBoxRev !== revBefore) {
      _state.lastCheckpointMono = mono;
      _persist();
    } else {
      _maybeCheckpoint(mono);
    }
    _emit();
  } catch {
    /* Gözlemci hatası ÜRÜNÜ etkilemez; bir sonraki tick yeniden dener. */
  }
}

/* ── Defter ilerletme (saf fonksiyonların çağrıldığı yer) ────────────────── */

const _SIGNAL_PICK: Readonly<Record<SignalId, (s: LongRoadSample) => number | null>> = {
  speed:          (s) => s.speed,
  rpm:            (s) => s.rpm,
  engineTemp:     (s) => s.engineTemp,
  throttle:       (s) => s.throttle,
  intakeTemp:     (s) => s.intakeTemp,
  fuelLevel:      (s) => s.fuelLevel,
  batteryVoltage: (s) => s.batteryVoltage,
};

function _advanceLedgers(
  s: LongRoadSession,
  sample: LongRoadSample,
  dtMs: number,
  wall: number,
): LongRoadSession {
  const fresh = sample.obdDataFresh === true;

  const signals = s.signals.map((row) =>
    advanceSignal(row, _SIGNAL_PICK[row.id](sample), fresh, sample.obdSource, wall, dtMs));

  const odometry = advanceOdometry(s.odometry, sample.speed, sample.tripTotalDistanceKm, dtMs);

  const c = s.counters;
  const counters = {
    ...c,
    obdReconnectRequested: advanceCounter(c.obdReconnectRequested, sample.reconnectRequested),
    obdResetRequested: advanceCounter(c.obdResetRequested, sample.resetRequested),
    obdDisconnectCalled: advanceCounter(c.obdDisconnectCalled, sample.disconnectCalled),
    obdTransportReconnectAttempts:
      advanceCounter(c.obdTransportReconnectAttempts, sample.transportReconnectAttempts),
    kwpRecoveryCount: advanceCounter(c.kwpRecoveryCount, sample.kwpRecoveryCount),
    kwpSuppressedCount: advanceCounter(c.kwpSuppressedCount, sample.kwpSuppressedCount),
    kwpAtpcFailures: advanceCounter(c.kwpAtpcFailures, sample.kwpAtpcFailures),
    canRetryCount: advanceCounter(c.canRetryCount, sample.canRetryCount),
    gpsSwitchCount: advanceCounter(c.gpsSwitchCount, sample.gpsSwitchCount),
    gpsFallbackCount: advanceCounter(c.gpsFallbackCount, sample.gpsFallbackCount),
    tripTotalCount: advanceCounter(c.tripTotalCount, sample.tripTotalCount),
  };

  return { ...s, signals, odometry, counters };
}

/* ── Algılama sonuçlarını oturuma işleme ─────────────────────────────────── */

function _applyDetection(
  s: LongRoadSession,
  sample: LongRoadSample,
  wall: number,
  mono: number,
): LongRoadSession {
  const result = detect(_state.detect, sample);
  const prevDetect = _state.detect;
  _state.detect = result.state;

  let next = s;

  /* Süre sayaçları: kenar değil SÜREKLİ ölçüm ister → algılayıcı durumundan
     okunur (aynı gerçeğin iki kez sayılmaması için tek kaynak). */
  next = _accumulateGaps(next, prevDetect, result.state, mono);

  for (const hit of result.hits) {
    next = markScenario(next, hit.scenario, wall);

    const ev: FieldEvent = {
      id: _nextId('EV', next.sessionVersion),
      type: hit.scenario,
      severity: hit.severity,
      detectedAt: wall,
      detail: hit.detail,
    };
    next = pushEvent(next, ev);

    if (hit.scenario === 'OBD_DATA_LOST') {
      next = { ...next, counters: { ...next.counters, obdDataGapCount: next.counters.obdDataGapCount + 1 } };
    } else if (hit.scenario === 'GPS_LOST') {
      next = { ...next, counters: { ...next.counters, gpsLossCount: next.counters.gpsLossCount + 1 } };
    } else if (hit.scenario === 'INTERNET_LOST') {
      next = { ...next, counters: { ...next.counters, internetLossCount: next.counters.internetLossCount + 1 } };
    }

    if (isBlackBoxTrigger(ev.type)) {
      /* Pencere AÇILIŞI ikinci kenardır: `pre` kareler bu anda DONDURULUR ve
         hemen kalıcı olmalıdır — olay öncesi 60 sn bir daha üretilemez (D2). */
      const openBefore = _state.blackBox.open.length;
      _state.blackBox = blackBoxOpen(
        _state.blackBox, ev.id, ev.type, ev.severity, wall, mono,
        LR_MAX_BLACKBOX_EVENTS, [ev.id],
      );
      if (_state.blackBox.open.length > openBefore) _state.blackBoxRev += 1;
    }
    if (hit.snapshotTrigger !== null) {
      next = _requestSnapshot(next, hit.snapshotTrigger, wall);
    }
  }

  return next;
}

/**
 * Açık kesintilerin SÜRESİNİ biriktirir. Kesinti bittiğinde değil, HER tick'te
 * en uzun süre güncellenir → uygulama kesinti sırasında ölse bile en uzun
 * kesinti kaydı korunur (checkpoint'e yazılmış olur).
 */
function _accumulateGaps(
  s: LongRoadSession,
  _prev: DetectState,
  cur: DetectState,
  mono: number,
): LongRoadSession {
  const c = s.counters;
  const obdGap = cur.obdGapStartMono === null ? 0 : mono - cur.obdGapStartMono;
  const gpsGap = cur.gpsLossStartMono === null ? 0 : mono - cur.gpsLossStartMono;
  const netGap = cur.internetLossStartMono === null ? 0 : mono - cur.internetLossStartMono;

  if (obdGap <= c.longestObdGapMs && gpsGap <= c.longestGpsLossMs && netGap <= c.longestInternetLossMs) {
    return s;
  }
  return {
    ...s,
    counters: {
      ...c,
      longestObdGapMs: Math.max(c.longestObdGapMs, obdGap),
      longestGpsLossMs: Math.max(c.longestGpsLossMs, gpsGap),
      longestInternetLossMs: Math.max(c.longestInternetLossMs, netGap),
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Snapshot
 * ════════════════════════════════════════════════════════════════════════ */

function _requestSnapshot(s: LongRoadSession, trigger: SnapshotTrigger, wall: number): LongRoadSession {
  /* D3: karar SAKLANAN indekse de bakar — kritik kota doluysa tahliye adayı
     oradan seçilir. */
  const decision = decideSnapshot(s.snapshotPolicy, trigger, wall, s.snapshots);
  const policy = applySnapshotDecision(s.snapshotPolicy, trigger, decision, wall);

  if (!isSnapshotAllowed(decision)) {
    /* Cooldown/global-gap bir POLİTİKA kararıdır (kayıp değil); kota ise
       gerçek bir kanıt kaybıdır ve SINIFIYLA sayılır — görünmez kalamaz. */
    const lostClass = classifySnapshotDrop(trigger, decision);
    if (lostClass === null) return { ...s, snapshotPolicy: policy };
    const dropped = lostClass === 'CRITICAL'
      ? { ...s.dropped, droppedCriticalSnapshots: s.dropped.droppedCriticalSnapshots + 1 }
      : { ...s.dropped, droppedPeriodicSnapshots: s.dropped.droppedPeriodicSnapshots + 1 };
    return { ...s, snapshotPolicy: policy, dropped };
  }

  let retained: readonly SnapshotIndexRow[] = s.snapshots;
  let dropped = s.dropped;

  if (decision === 'ALLOW_EVICT_CRITICAL') {
    const victim = chooseCriticalEvictionVictim(retained, SNAPSHOT_PRIORITY[trigger] ?? 0);
    if (victim !== null) {
      retained = retained.filter((r) => r.id !== victim.id);
      /* DANGLING REFERANS YASAĞI: indeks satırı düşen snapshot'ın GÖVDESİ de
         düşer; aksi hâlde dışa aktarımda indekste olmayan bir gövde kalırdı. */
      _state.bodies = _state.bodies.filter((b) => b.id !== victim.id);
      dropped = { ...dropped, droppedCriticalSnapshots: dropped.droppedCriticalSnapshots + 1 };
    }
  }

  const raw = (() => {
    try { return readSessionRawSnapshot(); } catch { return null; }
  })();

  const id = _nextId('SNAP', s.sessionVersion);
  const bytes = (() => {
    try { return JSON.stringify(raw ?? {}).length; } catch { return 0; }
  })();

  const body: SnapshotBody = {
    id, trigger, takenAt: wall, raw,
    offlineQueueSize: _state.injection.offlineQueueSize,
  };
  _state.bodies = [..._state.bodies, body].slice(-MAX_SNAPSHOT_BODIES);

  const row: SnapshotIndexRow = {
    id, trigger, takenAt: wall, bytes,
    distanceKm: odometerDistanceKm(s.odometry),
  };

  /* Async ek okuma snapshot ANINDA yapılır (tick'te DEĞİL) — kuyruk/pil. */
  _scheduleAugment();

  return { ...s, snapshotPolicy: policy, dropped, snapshots: [...retained, row] };
}

/** Dışarıdan (ekran/başlangıç) snapshot talebi. */
function _takeSnapshot(trigger: SnapshotTrigger): void {
  const s = _state.session;
  if (!s) return;
  _state.session = _requestSnapshot(s, trigger, _now());
}

/**
 * Kuyruk boyu ve pil YALNIZ burada okunur. Aynı anda ikinci koşum ENGELLENİR;
 * sonuç bir sonraki tick'in örneğine girer (geriye dönük düzeltme YAPILMAZ).
 */
function _scheduleAugment(): void {
  if (_state.augmentInFlight) return;
  _state.augmentInFlight = true;
  void readAsyncAugment()
    .then((a) => {
      _state.injection = {
        ..._state.injection,
        offlineQueueSize: a.offlineQueueSize,
        batteryPercent: a.batteryPercent,
        charging: a.charging,
      };
    })
    .catch(() => { /* fail-soft */ })
    .finally(() => { _state.augmentInFlight = false; });
}

function _maybePeriodicSnapshot(mono: number): void {
  const s = _state.session;
  if (!s) return;

  if (_state.lastPeriodicSnapshotMono === null) {
    _state.lastPeriodicSnapshotMono = mono;
  } else if (mono - _state.lastPeriodicSnapshotMono >= LR_SNAPSHOT_PERIODIC_MS) {
    _state.lastPeriodicSnapshotMono = mono;
    _takeSnapshot('PERIODIC_TIME');
  }

  const km = odometerDistanceKm(s.odometry);
  if (km === null) return;
  if (_state.lastPeriodicDistanceKm === null) {
    _state.lastPeriodicDistanceKm = km;
  } else if (km - _state.lastPeriodicDistanceKm >= LR_SNAPSHOT_PERIODIC_KM) {
    _state.lastPeriodicDistanceKm = km;
    _takeSnapshot('PERIODIC_DISTANCE');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · Checkpoint / kalıcılık
 * ════════════════════════════════════════════════════════════════════════ */

function _maybeCheckpoint(mono: number): void {
  if (_state.lastCheckpointMono !== null
      && mono - _state.lastCheckpointMono < LR_CHECKPOINT_INTERVAL_MS) return;
  _state.lastCheckpointMono = mono;
  _persist();
}

/**
 * D2 · BlackBox KENAR YAZIMI.
 *
 * Eski davranış: her checkpoint'te (30 sn) blob'un TAMAMI yeniden yazılıyordu →
 * bağımsız denetimin ölçtüğü 8 saatte ~192–923 MB eMMC yazımı. Yeni davranış:
 * disk ancak `blackBoxRev` değiştiyse (pencere açıldı · kapandı · finalize
 * edildi) veya kontrollü bir güvenlik noktasında yazılır. Pencere AÇIKKEN
 * biriken post-kareler diske akmaz; süreç o sırada ölürse pencere dürüstçe
 * `postWindowComplete=false` olarak geri yüklenir — eksik pencere TAM gibi
 * SUNULMAZ.
 */
function _persistBlackBoxIfDirty(): void {
  const s = _state.session;
  if (!s) return;
  if (_state.blackBoxRev === _state.blackBoxPersistedRev) return;
  const windows = [..._state.blackBox.closed, ..._state.blackBox.open];
  const result = saveBlackBox(s.sessionId, windows);
  /* Yazım başarısızsa revizyon İLERLETİLMEZ → bir sonraki kenarda yeniden dener
     (sessizce "yazıldı" sayılmaz). */
  if (result.ok) _state.blackBoxPersistedRev = _state.blackBoxRev;
}

/**
 * Oturum gövdesini diske yazar; BlackBox'ı YALNIZ kirliyse yazar.
 *
 * D2 sonrası `immediate` parametresi KALDIRILDI: eskiden "anında" bayrağı
 * BlackBox blob'unu koşulsuz yeniden yazdırıyordu ve yazma büyütmesinin
 * kaynağı buydu. Artık tek kural var — kenar değiştiyse yaz.
 */
function _persist(): void {
  const s = _state.session;
  if (!s) return;

  /* Kimlik defterinin yüksek-su işareti HER yazımda güncellenir: defter
     tamamen budansa bile restore sayacı buradan tohumlanabilir (D1). */
  const withIdentity: LongRoadSession = _state.seq > (s.identity?.idHighWater ?? 0)
    ? { ...s, identity: { ...s.identity, idHighWater: _state.seq } }
    : s;

  const withStamp: LongRoadSession = { ...withIdentity, lastCheckpointAt: _now() };
  const result = saveSession(withStamp);

  const used = measureUsedBytes();
  const pressure = classifyStoragePressure(used);
  const pruned = pressure === 'CRITICAL' || result.overBudget
    ? applyStoragePressure(withStamp, pressure, used)
    : { ...withStamp, storage: { ...withStamp.storage, pressure, usedBytes: used } };

  _state.session = pruned;

  if (pressure === 'CRITICAL' || result.overBudget) {
    /* Budanmış gövdeyi tekrar yaz — aksi hâlde disk hâlâ şişkin kalırdı. */
    saveSession(pruned);
  }

  _persistBlackBoxIfDirty();
}

/** Ekranın "elle kaydet" düğmesi için — ayrıca oturumu bitirMEZ. */
export function checkpointLongRoad(): void {
  _persist();
  _emit();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · Test kancası
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Testler için tek tick sürücüsü. ÜRETİMDE ÇAĞRILMAZ — gerçek döngü
 * `setInterval` ile döner. Bu kanca sayesinde 8 saatlik yolculuk saniyeler
 * içinde simüle edilebilir (görev §20 "long-running simulated clock").
 */
export function _driveTickForTest(): void {
  _tick();
}

/** Testler için durum sıfırlama (modül tekilliği yeniden kurulmadan). */
export function _resetForTest(): void {
  stopLoopOnly();
  _state.session = null;
  _state.detect = emptyDetectState();
  _state.blackBox = emptyBlackBoxState();
  _state.injection = emptyInjection();
  _state.bodies = [];
  _state.lastTickMono = null;
  _state.lastCheckpointMono = null;
  _state.lastPeriodicSnapshotMono = null;
  _state.lastPeriodicDistanceKm = null;
  _state.augmentInFlight = false;
  _state.seq = 0;
  _state.blackBoxRev = 0;
  _state.blackBoxPersistedRev = 0;
  _state.blackBoxLoad = null;
  _state.identityScan = emptyIdentityScan();
  _listeners.clear();
}
