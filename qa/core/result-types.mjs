/**
 * result-types.mjs — OEM Validation Lab'in durum sözlüğü (tek gerçek kaynak).
 *
 * NEDEN: Faz sonuçları, verdict merdiveni ve bulgu şiddetleri Lab'in HER katmanında
 * (orchestrator, scoring, verdict, raporlar, testler) kullanılıyor. Tek dosyada,
 * dondurulmuş sabitler olarak tutulur → bir katman "PASSED" yazıp diğeri "PASS"
 * beklemesin.
 *
 * V8/Hidden-class notu (CLAUDE.md §V8): Faz sonucu ve bulgu nesneleri ŞABLON
 * literal ile üretilir — tüm alanlar aynı sırada, eksik olanlar null. Dinamik
 * property ekleme yok.
 *
 * Yan etkisiz: bu modül import edildiğinde hiçbir I/O yapılmaz.
 */

/** Faz sonucu durumları. */
export const PHASE_RESULT = Object.freeze({
  PASS:               'PASS',
  PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
  FAIL:               'FAIL',
  SKIPPED_NA:         'SKIPPED_NA',
  MANUAL_PENDING:     'MANUAL_PENDING',
  INCOMPLETE:         'INCOMPLETE',
});

/** Tüm geçerli faz sonuçları (doğrulama için). */
export const PHASE_RESULTS = Object.freeze(Object.values(PHASE_RESULT));

/**
 * Verdict merdiveni — DÜŞÜKTEN YÜKSEĞE. Index = rütbe.
 * Bir profil `maxVerdict` ile tavan koyar; coverage modeli tavanı AYRICA düşürebilir.
 */
export const VERDICT = Object.freeze({
  REJECTED:         'REJECTED',
  HOST_VERIFIED:    'HOST_VERIFIED',
  OEM_READY:        'OEM_READY',
  PRODUCTION_READY: 'PRODUCTION_READY',
  FLAGSHIP_READY:   'FLAGSHIP_READY',
});

/** Verdict rütbe sırası (düşük → yüksek). */
export const VERDICT_LADDER = Object.freeze([
  VERDICT.REJECTED,
  VERDICT.HOST_VERIFIED,
  VERDICT.OEM_READY,
  VERDICT.PRODUCTION_READY,
  VERDICT.FLAGSHIP_READY,
]);

/** Verdict rütbesi (bilinmeyen → 0 = REJECTED). */
export function verdictRank(verdict) {
  const i = VERDICT_LADDER.indexOf(verdict);
  return i < 0 ? 0 : i;
}

/** Bulgu şiddetleri. `blocker` → verdict daima REJECTED. */
export const SEVERITY = Object.freeze({
  BLOCKER: 'blocker',
  MAJOR:   'major',
  MINOR:   'minor',
  INFO:    'info',
});

export const SEVERITIES = Object.freeze(Object.values(SEVERITY));

/**
 * Yetenek (capability) alan adları. Faz `requires` listesi bunlardan seçer.
 * Alan öneki (nokta öncesi) coverage kovasını belirler: host / device / vehicle.
 *
 * PR-1'de yalnız `host.*` yetenekleri GERÇEKTEN tespit edilir. `device.*` ve
 * `vehicle.*` isimleri burada TANIMLI ama hiçbir faz onları sağlamaz → host-only
 * koşuda device coverage YAPISAL olarak 0'dır (bkz. scoring.mjs).
 */
export const CAPABILITY = Object.freeze({
  HOST_NODE:      'host.node',       // Node runtime (daima var)
  HOST_REPO:      'host.repo',       // repo kökü okunabilir
  HOST_DIST:      'host.dist',       // dist/ derlenmiş web çıktısı mevcut
  HOST_APK:       'host.apk',        // derlenmiş APK dosyası mevcut
  HOST_AAPT:      'host.aapt',       // aapt2 bulunabildi
  HOST_APKSIGNER: 'host.apksigner',  // apksigner bulunabildi
  HOST_GRADLE:    'host.gradle',     // gradlew mevcut
  HOST_JAVA:      'host.java',       // JRE (apksigner JAVA olmadan koşmaz)
  DEVICE_ADB:     'device.adb',      // (PR-2) adb transport
  DEVICE_APP:     'device.app',      // (PR-2) uygulama cihazda kurulu
  DEVICE_SENSORS: 'device.sensors',  // (PR-3) sensör okuma
  DEVICE_PERF:    'device.perf',     // (PR-3) FPS/bellek/termal ölçümü
  VEHICLE_OBD:    'vehicle.obd',     // (PR-4) canlı araç telemetrisi
  VEHICLE_CAN:    'vehicle.can',     // (PR-4) CAN bus
});

export const CAPABILITIES = Object.freeze(Object.values(CAPABILITY));

/** Coverage kovaları — capability önekinden türetilir. */
export const COVERAGE_DOMAINS = Object.freeze(['host', 'device', 'vehicle']);

/** Bir capability'nin coverage kovası ("device.adb" → "device"). */
export function capabilityDomain(capability) {
  const dot = String(capability).indexOf('.');
  const domain = dot < 0 ? String(capability) : String(capability).slice(0, dot);
  return COVERAGE_DOMAINS.includes(domain) ? domain : 'host';
}

/** Faz kategorileri — skor ağırlık çarpanı bunlara bağlanır (thresholds.categoryMultipliers). */
export const PHASE_CATEGORY = Object.freeze({
  GENERAL:     'general',
  BUILD:       'build',
  SECURITY:    'security',
  PERFORMANCE: 'performance',
  VEHICLE:     'vehicle',
  UX:          'ux',
});

/**
 * Bulgu (finding) şablon literali — V8 hidden-class kararlılığı için TÜM alanlar
 * her zaman aynı sırada üretilir.
 */
export function createFinding({
  id,
  severity = SEVERITY.INFO,
  title,
  detail = null,
  evidence = null,
  remediation = null,
}) {
  if (!id || typeof id !== 'string') throw new TypeError('finding.id zorunlu (string)');
  if (!SEVERITIES.includes(severity)) throw new TypeError(`geçersiz severity: ${severity}`);
  if (!title || typeof title !== 'string') throw new TypeError('finding.title zorunlu (string)');
  return Object.freeze({
    id,
    severity,
    title,
    detail,
    evidence,
    remediation,
  });
}

/**
 * Faz sonucu şablon literali. Orchestrator BU şekli garanti eder — bir faz
 * eksik alan döndürse bile burada tamamlanır (fail-soft).
 */
export function createPhaseResult({
  id,
  name,
  order = 0,
  category = PHASE_CATEGORY.GENERAL,
  weight = 1,
  effectiveWeight = null,
  requires = [],
  safetyCritical = false,
  result = PHASE_RESULT.INCOMPLETE,
  score = 0,
  scored = false,
  durationMs = 0,
  findings = [],
  artifacts = [],
  metrics = {},
  skippedReason = null,
  manualFallback = null,
}) {
  if (!id || typeof id !== 'string') throw new TypeError('phaseResult.id zorunlu (string)');
  if (!PHASE_RESULTS.includes(result)) throw new TypeError(`geçersiz phase result: ${result}`);
  return Object.freeze({
    id,
    name: name ?? id,
    order,
    category,
    weight,
    effectiveWeight,
    requires: Object.freeze([...requires]),
    safetyCritical,
    result,
    score,
    scored,
    durationMs,
    findings: Object.freeze([...findings]),
    artifacts: Object.freeze([...artifacts]),
    metrics: Object.freeze({ ...metrics }),
    skippedReason,
    manualFallback,
  });
}

/**
 * Faz İÇİ tekil kontrol (check) sonucu — Build Validation gibi çok-kontrollü
 * fazlar bunları toplayıp tek faz sonucuna yuvarlar (bkz. rollupChecks).
 */
export function createCheck({
  id,
  title,
  status = PHASE_RESULT.INCOMPLETE,
  detail = null,
  severity = SEVERITY.INFO,
  metrics = {},
}) {
  if (!id || typeof id !== 'string') throw new TypeError('check.id zorunlu (string)');
  if (!PHASE_RESULTS.includes(status)) throw new TypeError(`geçersiz check status: ${status}`);
  return Object.freeze({ id, title: title ?? id, status, detail, severity, metrics: Object.freeze({ ...metrics }) });
}

/**
 * Kontrolleri tek faz sonucuna yuvarlar.
 *
 * KURAL (skor şişirme yasağı):
 * - Hiç kontrol çalışmadıysa → INCOMPLETE (kanıt yok; PASS DEĞİL)
 * - Herhangi bir FAIL → FAIL
 * - Atlanan (SKIPPED_NA / MANUAL_PENDING / INCOMPLETE) kontrol varsa → en fazla
 *   PASS_WITH_WARNINGS (tam PASS "her kanıt toplandı" demektir)
 * - Hepsi PASS → PASS
 */
export function rollupChecks(checks) {
  const executed = checks.filter(
    (c) => c.status === PHASE_RESULT.PASS ||
           c.status === PHASE_RESULT.PASS_WITH_WARNINGS ||
           c.status === PHASE_RESULT.FAIL,
  );
  if (executed.length === 0) return PHASE_RESULT.INCOMPLETE;
  if (executed.some((c) => c.status === PHASE_RESULT.FAIL)) return PHASE_RESULT.FAIL;
  const hasGap = checks.length !== executed.length ||
                 executed.some((c) => c.status === PHASE_RESULT.PASS_WITH_WARNINGS);
  return hasGap ? PHASE_RESULT.PASS_WITH_WARNINGS : PHASE_RESULT.PASS;
}
