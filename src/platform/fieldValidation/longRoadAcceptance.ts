/**
 * longRoadAcceptance.ts — OTOMATİK KARAR MATRİSİ (görev §15) · SAF.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React yok.
 *
 * ── EŞİKLERİN KAYNAĞI (görev §15: "keyfî eşik uydurma") ─────────────────────
 * Her kabul maddesi `thresholdSource` taşır ve iki sınıftan birine girer:
 *
 *  A) ÜRÜN SÖZLEŞMESİ  — eşik ürün kodunda zaten VARDIR (ör. `dataFresh`
 *     hükmü `obdService.getObdFreshWindowMs()`; konum durumu `LocationState`;
 *     trip açılış/kapanışı `tripLogService`). Biz eşik ÜRETMEYİZ, ürünün kendi
 *     hükmünü SAYARIZ.
 *
 *  B) SAHA KABUL SÖZLEŞMESİ — ürün kodunda karşılığı OLMAYAN, bu doğrulama
 *     turu için AÇIKÇA sabitlenmiş eşik (ör. "en az 60 dk bağlı süre").
 *     Bunlar `SPEC` kaynağıyla işaretlenir ve raporda AÇIK BORÇ olarak listelenir
 *     → gizlice "ürün standardı" gibi sunulmaz.
 *
 * ── PAZARLIKSIZ ────────────────────────────────────────────────────────────
 *  · Kanıt yoksa PASS YOK. Varsayılan `NOT_OBSERVED` / `INSUFFICIENT_EVIDENCE`.
 *  · Backend/donanım/politika yokluğu FAIL DEĞİLDİR → BLOCKED_*.
 *  · Her maddede `missing[]` alanı NEYİN eksik olduğunu SAYAR — "bilinmiyor"
 *    gerekçesiz bırakılmaz.
 */

import {
  counterDelta, elapsedMs, findScenario, findSignal, isPass, isBlocked,
  odometerInvariantHolds, scenarioVerdict, signalCoverageRatio,
  type FinalVerdict, type LongRoadSession, type Verdict,
} from './longRoadModel';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Eşikler
 * ════════════════════════════════════════════════════════════════════════ */

export type ThresholdClass = 'PRODUCT_CONTRACT' | 'SPEC';

export interface ThresholdDef {
  readonly value: number;
  readonly klass: ThresholdClass;
  readonly source: string;
}

export const LR_THRESHOLDS = {
  /** Uzun yol kararlılığı için asgari BAĞLI süre. */
  obdStabilityMs: {
    value: 60 * 60_000, klass: 'SPEC',
    source: 'Görev §15 örneği ("en az 60 dakika bağlı süre") — ürün kodunda karşılığı YOK.',
  },
  /** `dataFresh` kapsama oranı — tazelik hükmü ÜRÜNÜNDÜR, oran bu turun eşiğidir. */
  obdFreshCoverage: {
    value: 0.90, klass: 'SPEC',
    source: 'Tazelik hükmü: obdService.getObdFreshWindowMs() (ÜRÜN). Kapsama ORANI görev §15 eşiği.',
  },
  /** Geçersiz (fiziksel olarak imkânsız) örnek oranı üst sınırı. */
  invalidSampleRatio: {
    value: 0.01, klass: 'SPEC',
    source: 'Akla-yatkınlık kuralı CLAUDE.md §2 (ÜRÜN); ORAN üst sınırı görev §15 eşiği.',
  },
  /** Konum LIVE kapsama oranı. */
  gpsLiveCoverage: {
    value: 0.80, klass: 'SPEC',
    source: 'LIVE/STALE/LAST_KNOWN/OFFLINE hükmü locationConfidence (ÜRÜN); ORAN görev §15 eşiği.',
  },
  /** Rapor için asgari ölçüm süresi — altında kanıt "yetersiz" sayılır. */
  minRecordedMs: {
    value: 10 * 60_000, klass: 'SPEC',
    source: 'Görev §15 "PASS için minimum kanıt şartı" — kısa oturum hüküm üretemez.',
  },
  /** Süre invaryantı toleransı. */
  invariantToleranceMs: {
    value: 2, klass: 'PRODUCT_CONTRACT',
    source: 'moving+stopped+unknown === recorded (görev §5) — hesap tek yerde yapılır.',
  },
} as const satisfies Readonly<Record<string, ThresholdDef>>;

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Matris satırı
 * ════════════════════════════════════════════════════════════════════════ */

export type AcceptanceSection =
  | 'OBD' | 'GPS' | 'TRIP' | 'DRIVER' | 'FLEET' | 'AI'
  | 'ANDROID' | 'MEDIA' | 'NAV' | 'OBSERVER';

export const ACCEPTANCE_SECTION_LABEL: Readonly<Record<AcceptanceSection, string>> = {
  OBD:      'OBD / KWP / CAN',
  GPS:      'GPS / Location',
  TRIP:     'Trip',
  DRIVER:   'Driver',
  FLEET:    'Fleet / Cloud',
  AI:       'Evidence / Reasoning / AI',
  ANDROID:  'Android dayanıklılığı',
  MEDIA:    'Müzik',
  NAV:      'Navigasyon',
  OBSERVER: 'Gözlemci disiplini',
} as const;

export interface AcceptanceRow {
  readonly id: string;
  readonly section: AcceptanceSection;
  readonly title: string;
  readonly verdict: Verdict;
  /** PASS için gereken asgari kanıt — kullanıcıya AÇIKÇA gösterilir. */
  readonly requirement: string;
  readonly thresholdSource: string;
  /** Toplanan kanıt satırları (sayı/oran/süre — PII YOK). */
  readonly evidence: readonly string[];
  /** Neyin eksik olduğu. Boş → eksik yok. */
  readonly missing: readonly string[];
}

/* ── küçük yardımcılar (saf) ─────────────────────────────────────────────── */

function pct(v: number | null): string {
  return v === null ? '—' : `%${(v * 100).toFixed(1)}`;
}

function mins(ms: number | null): string {
  return ms === null ? '—' : `${Math.round(ms / 60_000)} dk`;
}

function num(v: number | null): string {
  return v === null ? '—' : String(v);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Matrisin üretimi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Oturumdan kabul matrisini üretir. TAMAMEN SAF: aynı oturum → aynı matris.
 *
 * `nowMs` yalnız "geçen süre" için kullanılır; oturum kapandıysa `endedAt` esastır.
 */
export function buildAcceptanceMatrix(s: LongRoadSession, nowMs: number): readonly AcceptanceRow[] {
  const rows: AcceptanceRow[] = [];
  const recorded = s.odometry.recordedMs;
  const enoughTime = recorded >= LR_THRESHOLDS.minRecordedMs.value;

  const add = (r: AcceptanceRow): void => { rows.push(r); };

  /* ── OBD ─────────────────────────────────────────────────────────────── */

  const link = findScenario(s, 'FIRST_VEHICLE_LINK');
  add({
    id: 'OBD_LINK', section: 'OBD', title: 'Araç bağlantısı kuruldu',
    /* Tek otorite: `scenarioVerdict` (hits>0 → PASS, aksi NOT_OBSERVED).
       Kural eskiden burada elle kopyalıydı (envanter denetimi E-32). */
    verdict: scenarioVerdict(link),
    requirement: 'Oturum içinde en az bir kez taşıma bağlantısı GÖZLENMELİ.',
    thresholdSource: 'obdService.getOBDDataSnapshot().transportConnected (ÜRÜN)',
    evidence: [`bağlantı gözlemi=${link.hits}`],
    missing: link.hits > 0 ? [] : ['Taşıma bağlantısı hiç gözlenmedi.'],
  });

  const hs = findScenario(s, 'FIRST_HANDSHAKE_OK');
  add({
    id: 'OBD_HANDSHAKE', section: 'OBD', title: 'ECU handshake başarılı',
    verdict: hs.hits > 0 ? 'PASS' : link.hits > 0 ? 'FAIL' : 'NOT_OBSERVED',
    requirement: 'Bağlantı varsa handshake `ok` GÖZLENMELİ.',
    thresholdSource: 'obdService.getHandshakeDiagnostics().outcome === "ok" (ÜRÜN)',
    evidence: [`handshake ok gözlemi=${hs.hits}`],
    missing: hs.hits > 0 ? []
      : link.hits > 0 ? ['Bağlantı kuruldu ama handshake `ok` gözlenmedi.']
      : ['Bağlantı olmadığı için handshake beklenemez.'],
  });

  const speedRow = findSignal(s, 'speed');
  const freshCoverage = signalCoverageRatio(speedRow, recorded);
  const stabilityOk = recorded >= LR_THRESHOLDS.obdStabilityMs.value;
  const failedReconnects = s.counters.failedReconnectCount;
  const stabilityMissing: string[] = [];
  if (!stabilityOk) stabilityMissing.push(`Bağlı ölçüm süresi ${mins(recorded)} < ${mins(LR_THRESHOLDS.obdStabilityMs.value)}.`);
  if (freshCoverage === null) stabilityMissing.push('Tazelik kapsaması ölçülemedi (sinyal defteri boş).');
  else if (freshCoverage < LR_THRESHOLDS.obdFreshCoverage.value) {
    stabilityMissing.push(`Tazelik kapsaması ${pct(freshCoverage)} < ${pct(LR_THRESHOLDS.obdFreshCoverage.value)}.`);
  }
  if (failedReconnects > 0) stabilityMissing.push(`${failedReconnects} başarısız reconnect.`);
  add({
    id: 'OBD_LONG_STABILITY', section: 'OBD', title: 'Uzun yol OBD kararlılığı',
    verdict: link.hits === 0 ? 'NOT_OBSERVED'
      : failedReconnects > 0 ? 'FAIL'
      : stabilityMissing.length === 0 ? 'PASS'
      : enoughTime ? 'DEGRADED' : 'INSUFFICIENT_EVIDENCE',
    requirement:
      `En az ${mins(LR_THRESHOLDS.obdStabilityMs.value)} bağlı süre · tazelik kapsaması ` +
      `≥ ${pct(LR_THRESHOLDS.obdFreshCoverage.value)} · başarısız reconnect YOK · ölçüm defteri eksiksiz.`,
    thresholdSource: `${LR_THRESHOLDS.obdStabilityMs.source} | ${LR_THRESHOLDS.obdFreshCoverage.source}`,
    evidence: [
      `ölçüm süresi=${mins(recorded)}`,
      `tazelik kapsaması=${pct(freshCoverage)}`,
      `en uzun kesinti=${Math.round(s.counters.longestObdGapMs / 1000)} sn`,
      `veri kaybı olayı=${s.counters.obdDataGapCount}`,
      `reconnect isteği=${num(counterDelta(s.counters.obdReconnectRequested))}`,
    ],
    missing: stabilityMissing,
  });

  let invalidTotal = 0;
  let sampleTotal = 0;
  const signalEvidence: string[] = [];
  for (const row of s.signals) {
    invalidTotal += row.invalidSamples;
    sampleTotal += row.samples;
    signalEvidence.push(
      `${row.id}: örnek=${row.samples} geçerli=${row.validSamples} geçersiz=${row.invalidSamples} ` +
      `bayat=${row.staleSamples} kapsama=${pct(signalCoverageRatio(row, recorded))}`,
    );
  }
  const invalidRatio = sampleTotal > 0 ? invalidTotal / sampleTotal : null;
  add({
    id: 'OBD_SIGNAL_INTEGRITY', section: 'OBD', title: 'Sinyal bütünlüğü',
    verdict: sampleTotal === 0 ? 'NOT_OBSERVED'
      : invalidRatio !== null && invalidRatio > LR_THRESHOLDS.invalidSampleRatio.value ? 'FAIL'
      : enoughTime ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
    requirement:
      `Fiziksel olarak imkânsız değer oranı ≤ ${pct(LR_THRESHOLDS.invalidSampleRatio.value)} ` +
      `ve her sinyal için defter (ilk görülme · kapsama · boşluk · min/max) dolu.`,
    thresholdSource: LR_THRESHOLDS.invalidSampleRatio.source,
    evidence: [`geçersiz oran=${pct(invalidRatio)}`, ...signalEvidence],
    missing: sampleTotal === 0 ? ['Hiç sinyal örneği toplanmadı.'] : [],
  });

  const reconnectHits = findScenario(s, 'OBD_RECONNECT');
  const lossHits = findScenario(s, 'OBD_DATA_LOST');
  add({
    id: 'OBD_RECOVERY', section: 'OBD', title: 'Kesinti sonrası toparlanma',
    verdict: lossHits.hits === 0 && reconnectHits.hits === 0 ? 'NOT_OBSERVED'
      : failedReconnects > 0 ? 'FAIL'
      : 'PASS',
    requirement: 'Veri kaybı/reconnect yaşandıysa veri geri DÖNMELİ; başarısız reconnect OLMAMALI.',
    thresholdSource: 'obdService.getObdConnLifecycle() + kwpRecoveryEvidence (ÜRÜN sayaçları)',
    evidence: [
      `veri kaybı=${lossHits.hits}`, `reconnect=${reconnectHits.hits}`,
      `KWP recovery=${num(counterDelta(s.counters.kwpRecoveryCount))}`,
      `KWP bastırılan=${num(counterDelta(s.counters.kwpSuppressedCount))}`,
      `başarısız reconnect=${failedReconnects}`,
    ],
    missing: [],
  });

  /* ── GPS ─────────────────────────────────────────────────────────────── */

  const gpsLost = findScenario(s, 'GPS_LOST');
  const gpsBack = findScenario(s, 'GPS_RESTORED');
  const gpsMissing: string[] = [];
  if (gpsLost.hits > 0 && gpsBack.hits === 0) gpsMissing.push('Konum kaybı sonrası geri dönüş GÖZLENMEDİ.');
  add({
    id: 'GPS_CONTINUITY', section: 'GPS', title: 'Konum sürekliliği',
    verdict: recorded === 0 ? 'NOT_OBSERVED'
      : gpsMissing.length > 0 ? 'DEGRADED'
      : enoughTime ? 'PASS' : 'INSUFFICIENT_EVIDENCE',
    requirement:
      `LIVE kapsaması ≥ ${pct(LR_THRESHOLDS.gpsLiveCoverage.value)} ve her kayıptan sonra ` +
      'geri dönüş gözlenmeli.',
    thresholdSource: LR_THRESHOLDS.gpsLiveCoverage.source,
    evidence: [
      `kayıp=${gpsLost.hits}`, `geri dönüş=${gpsBack.hits}`,
      `en uzun kayıp=${Math.round(s.counters.longestGpsLossMs / 1000)} sn`,
      `kaynak değişimi=${num(counterDelta(s.counters.gpsSwitchCount))}`,
      `fallback=${num(counterDelta(s.counters.gpsFallbackCount))}`,
    ],
    missing: gpsMissing,
  });

  const tunnel = findScenario(s, 'TUNNEL_GNSS_LOSS');
  add({
    id: 'GPS_TUNNEL', section: 'GPS', title: 'Tünel benzeri GNSS kaybı',
    verdict: scenarioVerdict(tunnel),
    requirement: 'Konum yokken araç hareket etmeye devam ederse olay işaretlenmeli.',
    thresholdSource: 'locationConfidence LocationState (ÜRÜN) + hız otoritesi',
    evidence: [`tünel şüphesi=${tunnel.hits}`],
    missing: tunnel.hits > 0 ? [] : ['Bu güzergâhta tünel/GNSS kaybı yaşanmadı.'],
  });

  /* ── Trip ────────────────────────────────────────────────────────────── */

  const tripStart = findScenario(s, 'TRIP_START');
  const tripClose = findScenario(s, 'TRIP_CLOSE_AFTER_STOP');
  const invariantOk = odometerInvariantHolds(s.odometry, LR_THRESHOLDS.invariantToleranceMs.value);
  add({
    id: 'TRIP_LIFECYCLE', section: 'TRIP', title: 'Trip yaşam döngüsü',
    verdict: tripStart.hits === 0 ? 'NOT_OBSERVED'
      : tripClose.hits === 0 ? 'DEGRADED' : 'PASS',
    requirement: 'En az bir trip AÇILMALI ve durduktan sonra KAPANMALI.',
    thresholdSource: 'tripLogService.getTripSnapshot().active (ÜRÜN durum makinesi)',
    evidence: [`açılış=${tripStart.hits}`, `kapanış=${tripClose.hits}`,
      `toplam trip=${num(counterDelta(s.counters.tripTotalCount))}`],
    missing: tripStart.hits === 0 ? ['Oturumda hiç trip açılmadı.']
      : tripClose.hits === 0 ? ['Trip açıldı ama kapanışı gözlenmedi.'] : [],
  });

  add({
    id: 'TRIP_TIME_INVARIANT', section: 'TRIP', title: 'Süre invaryantı',
    verdict: recorded === 0 ? 'NOT_OBSERVED' : invariantOk ? 'PASS' : 'FAIL',
    requirement: 'hareket + duruş + bilinmeyen === toplam ölçüm süresi.',
    thresholdSource: LR_THRESHOLDS.invariantToleranceMs.source,
    evidence: [
      `hareket=${mins(s.odometry.movingMs)}`, `duruş=${mins(s.odometry.stoppedMs)}`,
      `bilinmeyen=${mins(s.odometry.unknownMs)}`, `toplam=${mins(recorded)}`,
    ],
    missing: invariantOk ? [] : ['Süre defteri tutarsız — sayaç kaybı var.'],
  });

  /* ── Driver ──────────────────────────────────────────────────────────── */

  add({
    id: 'DRIVER_CHAIN', section: 'DRIVER', title: 'Sürücü zinciri',
    verdict: 'BLOCKED_HARDWARE',
    requirement: 'Gerçek NFC / telefon / Bluetooth sürücü kaynağı BAĞLI olmalı.',
    thresholdSource: 'driverPresence + driverAuthentication (ÜRÜN) — kaynak donanımı yok.',
    evidence: ['Bu turda gerçek sürücü kimlik kaynağı head unit\'e bağlı değil.'],
    missing: ['Sürücü kaynağı olmadan attribution/DNA hükmü ÜRETİLEMEZ (görev §6).'],
  });

  /* ── Fleet ───────────────────────────────────────────────────────────── */

  const queueGrowth = findScenario(s, 'OFFLINE_QUEUE_GROWTH');
  const queueReplay = findScenario(s, 'QUEUE_REPLAY');
  const netLost = findScenario(s, 'INTERNET_LOST');
  const netBack = findScenario(s, 'INTERNET_RESTORED');
  const backendSeen = s.preflight.some((p) => p.id === 'BACKEND_ACCESS' && p.verdict === 'PASS');
  add({
    id: 'FLEET_OFFLINE_REPLAY', section: 'FLEET', title: 'Çevrimdışı kuyruk ve replay',
    verdict: !backendSeen ? 'BLOCKED_BACKEND'
      : queueGrowth.hits === 0 && queueReplay.hits === 0 ? 'NOT_OBSERVED'
      : queueGrowth.hits > 0 && queueReplay.hits === 0 ? 'DEGRADED' : 'PASS',
    requirement: 'İnternet kesildiğinde kuyruk BÜYÜMELİ, geri geldiğinde BOŞALMALI.',
    thresholdSource: 'connectivityService kuyruk sayacı (ÜRÜN) — eşik yok, KENAR sayılır.',
    evidence: [
      `ağ kaybı=${netLost.hits}`, `ağ dönüşü=${netBack.hits}`,
      `kuyruk büyümesi=${queueGrowth.hits}`, `kuyruk boşalması=${queueReplay.hits}`,
      `en uzun ağ kesintisi=${Math.round(s.counters.longestInternetLossMs / 1000)} sn`,
    ],
    missing: !backendSeen ? ['Fleet backend köprüsü bu cihazda yapılandırılmamış.'] : [],
  });

  const realtime = findScenario(s, 'REALTIME_DROP_RECOVER');
  add({
    id: 'FLEET_REALTIME', section: 'FLEET', title: 'Realtime kopma / toparlanma',
    verdict: !backendSeen ? 'BLOCKED_BACKEND' : scenarioVerdict(realtime),
    requirement: 'Realtime kanalın kopup toparlanması gözlenmeli.',
    thresholdSource: 'Fleet realtime otoritesi (ÜRÜN) — head unit tarafında gözlem yüzeyi sınırlı.',
    evidence: [`realtime olayı=${realtime.hits}`],
    missing: backendSeen && realtime.hits === 0 ? ['Bu oturumda realtime kopması yaşanmadı.'] : [],
  });

  /* ── AI ──────────────────────────────────────────────────────────────── */

  const aiRow = s.preflight.find((p) => p.id === 'AI_POLICY');
  add({
    id: 'AI_EVIDENCE', section: 'AI', title: 'Evidence / Reasoning üretimi',
    verdict: aiRow && aiRow.verdict === 'BLOCKED_POLICY' ? 'BLOCKED_POLICY' : 'NOT_OBSERVED',
    requirement: 'AI ana şalteri ve provider HAZIR ise kanıt/karar akışı gözlenmeli.',
    thresholdSource: 'aiGatewayFlag + provider readiness (ÜRÜN) — CONFIGURED ≠ READY.',
    evidence: [aiRow ? aiRow.detail : 'AI politikası okunamadı.'],
    missing: ['P0 turunda AI kanıt akışının pasif gözlemi bağlanmadı — açık borç.'],
  });

  /* ── Android ─────────────────────────────────────────────────────────── */

  const restoreOk = s.restoreCount === 0 || s.sessionVersion > 1;
  add({
    id: 'ANDROID_PERSISTENCE', section: 'ANDROID', title: 'Oturum kalıcılığı / restore',
    verdict: s.restoreCount === 0 ? 'NOT_OBSERVED' : restoreOk ? 'PASS' : 'FAIL',
    requirement: 'Uygulama kapanıp açılınca AYNI sessionId ile devam edilmeli.',
    thresholdSource: 'longRoadStore şema sürümü + sessionVersion (bu modülün sözleşmesi)',
    evidence: [
      `restore=${s.restoreCount}`, `oturum sürümü=${s.sessionVersion}`,
      `son neden=${s.lastRestoreReason ?? '—'}`,
    ],
    missing: s.restoreCount === 0 ? ['Oturum boyunca yeniden başlatma yaşanmadı.'] : [],
  });

  const mem = findScenario(s, 'MEMORY_PRESSURE');
  const thermal = findScenario(s, 'THERMAL_PRESSURE');
  add({
    id: 'ANDROID_RESOURCE', section: 'ANDROID', title: 'Termal / bellek baskısı',
    verdict: mem.hits === 0 && thermal.hits === 0 ? 'NOT_OBSERVED' : 'PASS',
    requirement: 'Baskı yaşanırsa olay + snapshot kaydedilmeli (çökme olmamalı).',
    thresholdSource: 'memoryWatchdog seviyeleri + AdaptiveRuntimeManager modu (ÜRÜN)',
    evidence: [`bellek baskısı=${mem.hits}`, `mod düşüşü=${thermal.hits}`],
    missing: mem.hits === 0 && thermal.hits === 0 ? ['Bu oturumda kaynak baskısı gözlenmedi.'] : [],
  });

  /* ── Müzik / Navigasyon — PASİF (görev §10) ──────────────────────────── */

  add({
    id: 'MEDIA_PASSIVE', section: 'MEDIA', title: 'Müzik otoritesi (pasif)',
    verdict: 'NOT_OBSERVED',
    requirement: 'Kullanıcı müziği KENDİ kullanırsa gözlenir. Sistem müzik BAŞLATMAZ.',
    thresholdSource: 'Görev §10 — pasif gözlem; bu P0 turunda medya kanalı bağlanmadı.',
    evidence: ['Sistem kendi kendine müzik başlatmaz (görev §0).'],
    missing: ['Medya gözlem kanalı P0\'da bağlanmadı — açık borç.'],
  });

  add({
    id: 'NAV_PASSIVE', section: 'NAV', title: 'Navigasyon (pasif)',
    verdict: 'NOT_OBSERVED',
    requirement: 'Kullanıcı rota başlatırsa gözlenir. Sistem rota BAŞLATMAZ.',
    thresholdSource: 'Görev §10 — pasif gözlem; bu P0 turunda navigasyon kanalı bağlanmadı.',
    evidence: ['Sistem kendi kendine navigasyon başlatmaz (görev §0).'],
    missing: ['Navigasyon gözlem kanalı P0\'da bağlanmadı — açık borç.'],
  });

  /* ── Gözlemci disiplini (kendi yükümüz — görev §9 son cümle) ─────────── */

  /**
   * D3: **kritik** snapshot kaybı da bir gözlemci bütünlüğü ihlalidir — kritik
   * an bir daha üretilemez. Periyodik kayıp ise bilinçli bir bütçe davranışıdır
   * ve hükmü düşürmez; yalnız kanıt satırında görünür.
   */
  const droppedAny = s.dropped.droppedSamples + s.dropped.droppedEvents
    + s.dropped.droppedBlackBoxRecords + s.dropped.droppedCriticalSnapshots;
  add({
    id: 'OBSERVER_INTEGRITY', section: 'OBSERVER', title: 'Gözlemci kayıt bütünlüğü',
    verdict: recorded === 0 ? 'NOT_OBSERVED' : droppedAny === 0 ? 'PASS' : 'DEGRADED',
    requirement: 'Gözlemci kendi kaydını DÜŞÜRMEMELİ; düşerse SAYMALI.',
    thresholdSource: 'Bu modülün bounded tampon sözleşmesi (görev §17)',
    evidence: [
      `düşen örnek=${s.dropped.droppedSamples}`,
      `düşen olay=${s.dropped.droppedEvents}`,
      `düşen BlackBox kaydı=${s.dropped.droppedBlackBoxRecords}`,
      `düşen snapshot: periyodik=${s.dropped.droppedPeriodicSnapshots} · `
        + `KRİTİK=${s.dropped.droppedCriticalSnapshots}`,
      `snapshot=${s.snapshots.length}/${s.snapshotPolicy.count} `
        + `(periyodik=${s.snapshotPolicy.periodicCount} · kritik=${s.snapshotPolicy.criticalCount})`,
      `bastırılan snapshot=${s.snapshotPolicy.suppressedCount}`,
      `kimlik hükmü=${s.identity.lastScanVerdict}`,
      `depolama baskısı=${s.storage.pressure}`,
    ],
    missing: droppedAny === 0 ? [] : ['Bütçe sınırında kayıt düşürüldü — rapor eksik olabilir.'],
  });

  /* `nowMs` yalnız süre görüntüsü için — hükümlerde KULLANILMAZ (belirlenimci matris). */
  void elapsedMs(s, nowMs);

  return rows;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Nihai karar (görev §16)
 * ════════════════════════════════════════════════════════════════════════ */

export interface AcceptanceSummary {
  readonly pass: number;
  readonly fail: number;
  readonly degraded: number;
  readonly notObserved: number;
  readonly blocked: number;
  readonly insufficient: number;
  readonly total: number;
}

export function summarizeMatrix(rows: readonly AcceptanceRow[]): AcceptanceSummary {
  let pass = 0, fail = 0, degraded = 0, notObserved = 0, blocked = 0, insufficient = 0;
  for (const r of rows) {
    if (r.verdict === 'PASS') pass += 1;
    else if (r.verdict === 'FAIL') fail += 1;
    else if (r.verdict === 'DEGRADED') degraded += 1;
    else if (r.verdict === 'NOT_OBSERVED') notObserved += 1;
    else if (r.verdict === 'INSUFFICIENT_EVIDENCE') insufficient += 1;
    else if (isBlocked(r.verdict)) blocked += 1;
  }
  return { pass, fail, degraded, notObserved, blocked, insufficient, total: rows.length };
}

/**
 * Nihai karar. KANITSIZ PASS YOKTUR:
 *  · asgari ölçüm süresi dolmamışsa → INSUFFICIENT_EVIDENCE (FAIL yoksa)
 *  · tek bir FAIL bile → FAILED
 *  · her madde PASS/BLOCKED ve süre yeterliyse → PASS
 *  · aksi hâlde → PARTIAL
 */
export function finalVerdict(
  s: LongRoadSession,
  rows: readonly AcceptanceRow[],
): FinalVerdict {
  const sum = summarizeMatrix(rows);
  if (sum.fail > 0) return 'FIELD_VALIDATION_FAILED';

  const enoughTime = s.odometry.recordedMs >= LR_THRESHOLDS.minRecordedMs.value;
  if (!enoughTime || sum.pass === 0) return 'FIELD_VALIDATION_INSUFFICIENT_EVIDENCE';

  const unresolved = sum.degraded + sum.notObserved + sum.insufficient;
  if (unresolved === 0) return 'FIELD_VALIDATION_PASS';
  return 'FIELD_VALIDATION_PARTIAL';
}

/** En ağır bulgular (görev §16 "en ağır 20 bulgu"). */
export interface Finding {
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  readonly rowId: string;
  readonly section: AcceptanceSection;
  readonly title: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

const _PRIORITY_BY_VERDICT: Readonly<Record<Verdict, Finding['priority']>> = {
  FAIL:                  'P0',
  DEGRADED:              'P1',
  INSUFFICIENT_EVIDENCE: 'P2',
  BLOCKED_BACKEND:       'P3',
  BLOCKED_HARDWARE:      'P3',
  BLOCKED_POLICY:        'P3',
  NOT_OBSERVED:          'P4',
  PASS:                  'P4',
} as const;

const _PRIORITY_RANK: Readonly<Record<Finding['priority'], number>> = {
  P0: 0, P1: 1, P2: 2, P3: 3, P4: 4,
} as const;

export function topFindings(rows: readonly AcceptanceRow[], limit = 20): readonly Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (isPass(r.verdict)) continue;
    out.push({
      priority: _PRIORITY_BY_VERDICT[r.verdict],
      rowId: r.id,
      section: r.section,
      title: r.title,
      verdict: r.verdict,
      detail: r.missing.length > 0 ? r.missing.join(' ') : r.requirement,
    });
  }
  out.sort((a, b) => _PRIORITY_RANK[a.priority] - _PRIORITY_RANK[b.priority]);
  return out.slice(0, limit);
}

/** Eşiklerin kaynağı — raporun "açık borç" bölümü bunu KULLANIR. */
export function specThresholds(): readonly { key: string; value: number; source: string }[] {
  const out: { key: string; value: number; source: string }[] = [];
  for (const [key, def] of Object.entries(LR_THRESHOLDS)) {
    if (def.klass === 'SPEC') out.push({ key, value: def.value, source: def.source });
  }
  return out;
}
