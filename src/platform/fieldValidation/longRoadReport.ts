/**
 * longRoadReport.ts — SAHA RAPORU ÜRETİMİ (görev §16) · SAF.
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React yok.
 * Girdi tamamen çağırandan gelir → rapor testte birebir doğrulanabilir.
 *
 * ÜRETİLENLER:
 *   1. İnsan okunur TÜRKÇE rapor (markdown)
 *   2. Makine okunur JSON
 *   3. Maskeli CAROS LAB kopyası (snapshot gövdeleri) — JSON içinde
 *   4. Kritik BlackBox olay paketi — JSON içinde
 *   5. Kabul matrisi — her iki çıktıda
 *
 * ── DÜRÜSTLÜK KAPILARI ──────────────────────────────────────────────────────
 *  · Kanıtsız PASS YOKTUR; nihai karar `finalVerdict` ile hesaplanır.
 *  · Bilinmeyen alan `UNAVAILABLE` yazılır — sahte 0 / sahte tarih YOK.
 *  · Gizlilik hükmü İDDİA DEĞİL, ÖLÇÜMDÜR: rapor gövdesi gerçekten taranır
 *    (`auditPrivacy`) ve bir sızıntı deseni bulunursa `privacyVerdict=FAILED`.
 *  · Gerçek araç doğrulaması, gerçek araç kanıtı yoksa `BLOCKED_REAL_VEHICLE`
 *    kalır — "test yeşil" bunu VALIDATED yapmaz (CLAUDE.md §Saha Kütüğü).
 */

import {
  LR_SNAPSHOT_CRITICAL_QUOTA, LR_SNAPSHOT_PERIODIC_QUOTA,
  SCENARIO_TITLE, SEVERITY_LABEL, SESSION_STATE_LABEL, SIGNAL_LABEL,
  SNAPSHOT_TRIGGER_LABEL, VERDICT_LABEL,
  counterDelta, elapsedMs, odometerDistanceKm, signalAverage, signalCoverageRatio,
  type LongRoadSession, type ScenarioId,
} from './longRoadModel';
import {
  ACCEPTANCE_SECTION_LABEL, buildAcceptanceMatrix, finalVerdict, specThresholds,
  summarizeMatrix, topFindings,
  type AcceptanceRow, type AcceptanceSummary, type Finding,
} from './longRoadAcceptance';
import type { BlackBoxMeta, BlackBoxWindow } from './longRoadBlackBox';
import {
  SELF_CHECK_LABEL, validateSelf,
  type SelfValidationEvidence, type SelfValidationReport,
} from './longRoadSelfValidator';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · Gizlilik denetimi (görev §21 privacyVerdict)
 * ════════════════════════════════════════════════════════════════════════ */

export type PrivacyVerdict = 'PASS' | 'FAILED';

export interface PrivacyAudit {
  readonly verdict: PrivacyVerdict;
  /** Bulunan sızıntı deseni ADLARI — DEĞERLERİ ASLA taşınmaz. */
  readonly violations: readonly string[];
  readonly scannedBytes: number;
}

/**
 * Rapor gövdesini GERÇEKTEN tarar. Bulgu, desenin ADIYLA bildirilir; eşleşen
 * metnin KENDİSİ rapora GİRMEZ (sızıntıyı raporlarken sızdırmamak için).
 */
export function auditPrivacy(serialized: string): PrivacyAudit {
  const violations: string[] = [];

  /* 17 haneli tam VIN (I,O,Q hariç standart alfabe). */
  if (/\b[A-HJ-NPR-Z0-9]{17}\b/.test(serialized)) violations.push('TAM_VIN_DESENI');
  /* Bearer / Authorization başlığı. */
  if (/bearer\s+[A-Za-z0-9._-]{12,}/i.test(serialized)) violations.push('BEARER_TOKEN');
  /* JWT üç parçalı yapı. */
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/.test(serialized)) violations.push('JWT');
  /* E-posta. */
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(serialized)) violations.push('EPOSTA');
  /* Koordinat çifti: "latitude"/"longitude"/"lat"/"lng" anahtarı + ondalık sayı. */
  if (/"(latitude|longitude|lat|lng)"\s*:\s*-?\d+\.\d{3,}/.test(serialized)) violations.push('KOORDINAT');
  /* Uzun hex/gizli anahtar görünümü. */
  if (/"(api_?key|apiKey|secret|token)"\s*:\s*"[^"]{8,}"/i.test(serialized)) violations.push('ANAHTAR_ALANI');

  return {
    verdict: violations.length === 0 ? 'PASS' : 'FAILED',
    violations,
    scannedBytes: serialized.length,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · Rapor sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

export type RealVehicleVerdict = 'BLOCKED_REAL_VEHICLE' | 'VALIDATED' | 'FAILED';
export type PersistenceVerdict = 'PASS' | 'PARTIAL' | 'FAILED';

export interface ReportInput {
  readonly session: LongRoadSession;
  readonly blackBox: readonly BlackBoxMeta[];
  /** Maskeli CAROS LAB kopyaları (snapshot gövdeleri). */
  readonly snapshotBodies: readonly unknown[];
  /**
   * BlackBox pencerelerinin TAM gövdesi — YALNIZ self-validator kullanır
   * (`preWindowComplete` iddiasını kare geçmişiyle sınamak için). Verilmezse
   * ilgili denetim `NOT_CHECKED` kalır; sessizce "doğrulandı" SAYILMAZ.
   */
  readonly blackBoxWindows?: readonly BlackBoxWindow[];
  /**
   * Öz-denetimin İKİNCİ otorite olarak kullandığı ham ölçümler (D1–D3):
   * BlackBox okuma/checksum hükmü ve bellekteki snapshot gövde kimlikleri.
   * Verilmezse ilgili denetimler `NOT_CHECKED` kalır — uydurma "doğrulandı" YOK.
   */
  readonly selfEvidence?: SelfValidationEvidence;
  /** Gözlemcinin KENDİ yazma defteri (eMMC bütçe kanıtı) — ürün metriği DEĞİL. */
  readonly writeStats?: {
    readonly sessionWrites: number;
    readonly sessionBytes: number;
    readonly blackBoxWrites: number;
    readonly blackBoxBytes: number;
  };
  readonly nowMs: number;
}

export interface LongRoadReport {
  readonly markdown: string;
  readonly json: string;
  readonly matrix: readonly AcceptanceRow[];
  readonly summary: AcceptanceSummary;
  readonly findings: readonly Finding[];
  readonly privacy: PrivacyAudit;
  readonly finalVerdict: ReturnType<typeof finalVerdict>;
  readonly persistenceVerdict: PersistenceVerdict;
  readonly realVehicleVerdict: RealVehicleVerdict;
  /**
   * İKİNCİ OTORİTE. Kabul matrisinden BAĞIMSIZDIR ve onu DEĞİŞTİRMEZ:
   * `finalVerdict` hesabı `selfValidation`a hiç bakmaz (testle kilitli).
   */
  readonly selfValidation: SelfValidationReport;
}

/* ── biçimleyiciler ──────────────────────────────────────────────────────── */

const NA = 'UNAVAILABLE';

function fmtNum(v: number | null, digits = 0): string {
  return v === null ? NA : v.toFixed(digits);
}

function fmtPct(v: number | null): string {
  return v === null ? NA : `%${(v * 100).toFixed(1)}`;
}

function fmtDur(ms: number | null): string {
  if (ms === null) return NA;
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
}

function fmtStamp(ms: number | null): string {
  if (ms === null) return NA;
  try { return new Date(ms).toISOString(); } catch { return NA; }
}

function fmtText(v: string | null): string {
  return v === null || v === '' ? NA : v;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · Yardımcı hükümler
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kalıcılık hükmü. Restore hiç yaşanmadıysa PARTIAL'dır: "çalışıyor" diyebilmek
 * için gerçekten bir kesinti atlatılmış OLMALI (kanıtsız PASS yasağı).
 */
export function judgePersistence(s: LongRoadSession): PersistenceVerdict {
  if (s.state === 'CORRUPT') return 'FAILED';
  const persisted = s.lastCheckpointAt !== null;
  if (!persisted) return 'FAILED';
  if (s.restoreCount === 0) return 'PARTIAL';
  return s.sessionVersion > 1 ? 'PASS' : 'FAILED';
}

/**
 * Gerçek araç hükmü. `source === 'real'` GÖRÜLMEDİKÇE doğrulama YAPILMAMIŞTIR.
 * Mock/none kaynağı saha kanıtı SAYILMAZ (CLAUDE.md §mock politikası).
 */
export function judgeRealVehicle(s: LongRoadSession): RealVehicleVerdict {
  const adapter = s.env.obdAdapter;
  if (adapter !== 'real') return 'BLOCKED_REAL_VEHICLE';
  const speed = s.signals.find((r) => r.id === 'speed');
  if (!speed || speed.validSamples === 0) return 'BLOCKED_REAL_VEHICLE';
  return 'VALIDATED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · Rapor üretimi
 * ════════════════════════════════════════════════════════════════════════ */

export function buildLongRoadReport(input: ReportInput): LongRoadReport {
  const s = input.session;
  const matrix = buildAcceptanceMatrix(s, input.nowMs);
  const summary = summarizeMatrix(matrix);
  const findings = topFindings(matrix, 20);
  const verdict = finalVerdict(s, matrix);
  const persistence = judgePersistence(s);
  const realVehicle = judgeRealVehicle(s);

  /* İKİNCİ OTORİTE — `verdict` YUKARIDA zaten hesaplandı; aşağıdaki satır onu
     ETKİLEMEZ. Ölçen ile ölçümü denetleyen ayrı kalmalıdır. */
  const selfValidation = validateSelf(
    s, input.blackBoxWindows ?? [], input.nowMs, input.selfEvidence,
  );

  const jsonBody = {
    schema: 'caros.fieldvalidation.longroad.v1',
    generatedAt: input.nowMs,
    session: {
      sessionId: s.sessionId,
      sessionVersion: s.sessionVersion,
      state: s.state,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      elapsedMs: elapsedMs(s, input.nowMs),
      recordedMs: s.odometry.recordedMs,
      distanceKm: odometerDistanceKm(s.odometry),
      movingMs: s.odometry.movingMs,
      stoppedMs: s.odometry.stoppedMs,
      unknownMs: s.odometry.unknownMs,
      restoreCount: s.restoreCount,
      lastRestoreReason: s.lastRestoreReason,
      env: s.env,
    },
    preflight: s.preflight,
    scenarios: s.scenarios,
    signals: s.signals.map((r) => ({
      ...r,
      average: signalAverage(r),
      coverage: signalCoverageRatio(r, s.odometry.recordedMs),
    })),
    counters: {
      ...s.counters,
      deltas: {
        obdReconnectRequested: counterDelta(s.counters.obdReconnectRequested),
        obdResetRequested: counterDelta(s.counters.obdResetRequested),
        obdDisconnectCalled: counterDelta(s.counters.obdDisconnectCalled),
        kwpRecoveryCount: counterDelta(s.counters.kwpRecoveryCount),
        gpsSwitchCount: counterDelta(s.counters.gpsSwitchCount),
        gpsFallbackCount: counterDelta(s.counters.gpsFallbackCount),
        tripTotalCount: counterDelta(s.counters.tripTotalCount),
      },
    },
    events: s.events,
    snapshotIndex: s.snapshots,
    snapshotBodies: input.snapshotBodies,
    blackBox: input.blackBox,
    storage: s.storage,
    dropped: s.dropped,
    /* D1 · kayıt kimliği bütünlüğü defteri (restore tohumlamasının kanıtı). */
    identity: s.identity,
    /* D3 · sınıf kotaları — hangi havuzun dolduğu raporda görünür. */
    snapshotPolicy: {
      count: s.snapshotPolicy.count,
      periodicCount: s.snapshotPolicy.periodicCount,
      criticalCount: s.snapshotPolicy.criticalCount,
      suppressedCount: s.snapshotPolicy.suppressedCount,
      evictedCriticalCount: s.snapshotPolicy.evictedCriticalCount,
    },
    /* D2 · gözlemcinin kendi eMMC yazım defteri (ölçüm, tahmin DEĞİL). */
    writeStats: input.writeStats ?? null,
    blackBoxLoad: input.selfEvidence?.blackBoxLoad ?? null,
    matrix,
    summary,
    findings,
    verdicts: {
      final: verdict,
      persistence,
      realVehicle,
      driverDistraction: 'SAFE_PASSIVE',
      productBehavior: 'UNCHANGED',
    },
    /* AYRI OTORİTE — `verdicts` bloğunun İÇİNDE DEĞİL, bilinçli olarak dışında. */
    selfValidation: {
      verdict: selfValidation.verdict,
      verifiedCount: selfValidation.verifiedCount,
      problemCount: selfValidation.problemCount,
      affectsAcceptanceVerdict: selfValidation.affectsAcceptanceVerdict,
      rows: selfValidation.rows,
    },
    specThresholds: specThresholds(),
  };

  const json = JSON.stringify(jsonBody, null, 2);
  const privacy = auditPrivacy(json);

  const markdown = _renderMarkdown({
    s, matrix, summary, findings, verdict, persistence, realVehicle, privacy,
    blackBox: input.blackBox, selfValidation, nowMs: input.nowMs,
    writeStats: input.writeStats ?? null,
    blackBoxLoad: input.selfEvidence?.blackBoxLoad ?? null,
  });

  return {
    markdown, json, matrix, summary, findings, privacy,
    finalVerdict: verdict,
    persistenceVerdict: persistence,
    realVehicleVerdict: realVehicle,
    selfValidation,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · Markdown
 * ════════════════════════════════════════════════════════════════════════ */

interface RenderInput {
  readonly s: LongRoadSession;
  readonly matrix: readonly AcceptanceRow[];
  readonly summary: AcceptanceSummary;
  readonly findings: readonly Finding[];
  readonly verdict: ReturnType<typeof finalVerdict>;
  readonly persistence: PersistenceVerdict;
  readonly realVehicle: RealVehicleVerdict;
  readonly privacy: PrivacyAudit;
  readonly blackBox: readonly BlackBoxMeta[];
  readonly selfValidation: SelfValidationReport;
  readonly nowMs: number;
  readonly writeStats: ReportInput['writeStats'] | null;
  readonly blackBoxLoad: NonNullable<SelfValidationEvidence['blackBoxLoad']> | null;
}

function _renderMarkdown(r: RenderInput): string {
  const s = r.s;
  const L: string[] = [];
  const p = (line = ''): void => { L.push(line); };

  p('# CAROS PRO — UZUN YOL SAHA DOĞRULAMA RAPORU');
  p();
  p(`**Nihai karar:** \`${r.verdict}\``);
  p(`**Kalıcılık:** \`${r.persistence}\` · **Gerçek araç:** \`${r.realVehicle}\` · ` +
    `**Gizlilik:** \`${r.privacy.verdict}\` · **Sürücü dikkati:** \`SAFE_PASSIVE\` · ` +
    `**Ürün davranışı:** \`UNCHANGED\``);
  p();

  /* ── Oturum ──────────────────────────────────────────────────────────── */
  p('## 1 · Oturum bilgileri');
  p();
  p('| Alan | Değer |');
  p('|---|---|');
  p(`| Oturum kimliği | \`${s.sessionId}\` |`);
  p(`| Oturum sürümü | ${s.sessionVersion} (restore: ${s.restoreCount}) |`);
  p(`| Durum | ${SESSION_STATE_LABEL[s.state]} (\`${s.state}\`) |`);
  p(`| Başlangıç | ${fmtStamp(s.startedAt)} |`);
  p(`| Bitiş | ${fmtStamp(s.endedAt)} |`);
  p(`| Geçen süre | ${fmtDur(elapsedMs(s, r.nowMs))} |`);
  p(`| Ölçüm süresi | ${fmtDur(s.odometry.recordedMs)} |`);
  p(`| Mesafe | ${fmtNum(odometerDistanceKm(s.odometry), 1)} km |`);
  p(`| Hareket / duruş / bilinmeyen | ${fmtDur(s.odometry.movingMs)} / ` +
    `${fmtDur(s.odometry.stoppedMs)} / ${fmtDur(s.odometry.unknownMs)} |`);
  p(`| Uygulama sürümü | ${fmtText(s.env.appVersion)} |`);
  p(`| Build türü | ${fmtText(s.env.buildType)} |`);
  p(`| APK SHA-256 | ${fmtText(s.env.apkSha256)} |`);
  p(`| Git revizyonu | ${fmtText(s.env.gitRevision)} |`);
  p(`| Cihaz | ${fmtText(s.env.deviceModel)} |`);
  p(`| OBD adaptörü / taşıma | ${fmtText(s.env.obdAdapter)} / ${fmtText(s.env.transport)} |`);
  p(`| Aktif protokol | ${fmtText(s.env.protocolActive)} |`);
  p(`| Araç referansı (maskeli) | ${fmtText(s.env.vehicleRef)} |`);
  p(`| Başlangıç bölgesi | ${fmtText(s.env.startRegion)} |`);
  p();

  /* ── Preflight ───────────────────────────────────────────────────────── */
  p('## 2 · Preflight');
  p();
  p('| Kapı | Sonuç | Açıklama |');
  p('|---|---|---|');
  for (const row of s.preflight) {
    p(`| ${row.id} | \`${row.verdict}\` | ${row.detail} |`);
  }
  if (s.preflight.length === 0) p('| — | — | Preflight kaydı yok. |');
  p();

  /* ── Senaryolar ──────────────────────────────────────────────────────── */
  p('## 3 · Senaryo kapsaması');
  p();
  const observed = s.scenarios.filter((x) => x.hits > 0).length;
  p(`Gözlenen senaryo: **${observed} / ${s.scenarios.length}** ` +
    '(gözlenmeyen senaryo BAŞARISIZLIK DEĞİLDİR — o koşul yolda yaşanmamıştır).');
  p();
  p('| Senaryo | Gözlem | İlk | Son |');
  p('|---|---|---|---|');
  for (const sc of s.scenarios) {
    p(`| ${SCENARIO_TITLE[sc.id as ScenarioId]} | ${sc.hits > 0 ? sc.hits : 'NOT_OBSERVED'} | ` +
      `${fmtStamp(sc.firstAt)} | ${fmtStamp(sc.lastAt)} |`);
  }
  p();

  /* ── Sinyaller ───────────────────────────────────────────────────────── */
  p('## 4 · Sinyal defteri');
  p();
  p('| Sinyal | İlk görülme | Örnek | Geçerli | Geçersiz | Bayat | Kapsama | En uzun boşluk | Min | Ort | Max | Kaynak |');
  p('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const row of s.signals) {
    p(`| ${SIGNAL_LABEL[row.id]} | ${fmtStamp(row.firstSeenAt)} | ${row.samples} | ${row.validSamples} | ` +
      `${row.invalidSamples} | ${row.staleSamples} | ` +
      `${fmtPct(signalCoverageRatio(row, s.odometry.recordedMs))} | ` +
      `${fmtNum(row.longestGapMs / 1000, 1)} sn | ${fmtNum(row.min, 1)} | ` +
      `${fmtNum(signalAverage(row), 1)} | ${fmtNum(row.max, 1)} | ${fmtText(row.source)} |`);
  }
  p();

  /* ── Sayaçlar ────────────────────────────────────────────────────────── */
  p('## 5 · OBD / KWP / CAN sayaçları (oturum kapsamlı delta)');
  p();
  p('| Sayaç | Değer |');
  p('|---|---|');
  p(`| Reconnect isteği | ${fmtNum(counterDelta(s.counters.obdReconnectRequested))} |`);
  p(`| Taşıma reconnect denemesi | ${fmtNum(counterDelta(s.counters.obdTransportReconnectAttempts))} |`);
  p(`| Reset isteği | ${fmtNum(counterDelta(s.counters.obdResetRequested))} |`);
  p(`| Disconnect çağrısı | ${fmtNum(counterDelta(s.counters.obdDisconnectCalled))} |`);
  p(`| KWP recovery | ${fmtNum(counterDelta(s.counters.kwpRecoveryCount))} |`);
  p(`| KWP bastırılan | ${fmtNum(counterDelta(s.counters.kwpSuppressedCount))} |`);
  p(`| KWP ATPC hatası | ${fmtNum(counterDelta(s.counters.kwpAtpcFailures))} |`);
  p(`| CAN retry | ${fmtNum(counterDelta(s.counters.canRetryCount))} |`);
  p(`| Veri kaybı olayı | ${s.counters.obdDataGapCount} |`);
  p(`| En uzun veri kesintisi | ${fmtNum(s.counters.longestObdGapMs / 1000, 1)} sn |`);
  p(`| Başarısız reconnect | ${s.counters.failedReconnectCount} |`);
  p();

  /* ── Konum ───────────────────────────────────────────────────────────── */
  p('## 6 · Konum');
  p();
  p('| Metrik | Değer |');
  p('|---|---|');
  p(`| Kayıp olayı | ${s.counters.gpsLossCount} |`);
  p(`| En uzun kayıp | ${fmtNum(s.counters.longestGpsLossMs / 1000, 1)} sn |`);
  p(`| Kaynak değişimi | ${fmtNum(counterDelta(s.counters.gpsSwitchCount))} |`);
  p(`| Fallback | ${fmtNum(counterDelta(s.counters.gpsFallbackCount))} |`);
  p();
  p('> Tam rota koordinatları rapora BİLEREK konmaz (görev §4).');
  p();

  /* ── Bulut ───────────────────────────────────────────────────────────── */
  p('## 7 · Fleet / bulut / çevrimdışı');
  p();
  p(`| İnternet kaybı olayı | ${s.counters.internetLossCount} |`);
  p('|---|---|');
  p(`| En uzun ağ kesintisi | ${fmtNum(s.counters.longestInternetLossMs / 1000, 1)} sn |`);
  p();

  /* ── Kritik olaylar ──────────────────────────────────────────────────── */
  p('## 8 · Kritik olaylar');
  p();
  const critical = s.events.filter((e) => e.severity === 'CRITICAL');
  if (critical.length === 0) {
    p('Kritik olay kaydedilmedi.');
  } else {
    p('| Zaman | Tip | Açıklama |');
    p('|---|---|---|');
    for (const e of critical) p(`| ${fmtStamp(e.detectedAt)} | \`${e.type}\` | ${e.detail} |`);
  }
  p();

  /* ── BlackBox ────────────────────────────────────────────────────────── */
  p('## 9 · BlackBox olay paketi');
  p();
  if (r.blackBox.length === 0) {
    p('BlackBox penceresi açılmadı.');
  } else {
    p('| Olay | Tip | Şiddet | Zaman | Ön pencere | Son pencere | Kare | Düşen |');
    p('|---|---|---|---|---|---|---|---|');
    for (const w of r.blackBox) {
      p(`| \`${w.eventId}\` | \`${w.eventType}\` | ${SEVERITY_LABEL[w.severity]} | ` +
        `${fmtStamp(w.detectedAt)} | ${w.preWindowComplete ? 'TAM' : 'EKSİK'} | ` +
        `${w.postWindowComplete ? 'TAM' : 'EKSİK'} | ${w.frameCount} | ${w.droppedRecords} |`);
    }
  }
  p();

  /* ── Snapshot ────────────────────────────────────────────────────────── */
  p('## 10 · Snapshot indeksi');
  p();
  p(`Üretilen: ${s.snapshots.length} · bastırılan (cooldown/dedupe/bütçe): ` +
    `${s.snapshotPolicy.suppressedCount}`);
  p();
  if (s.snapshots.length > 0) {
    p('| Snapshot | Tetik | Zaman | Bayt | Mesafe |');
    p('|---|---|---|---|---|');
    for (const row of s.snapshots) {
      p(`| \`${row.id}\` | ${SNAPSHOT_TRIGGER_LABEL[row.trigger]} | ${fmtStamp(row.takenAt)} | ` +
        `${row.bytes} | ${fmtNum(row.distanceKm, 1)} km |`);
    }
    p();
  }

  /* ── Kabul matrisi ───────────────────────────────────────────────────── */
  p('## 11 · Kabul matrisi');
  p();
  p(`GEÇTİ: ${r.summary.pass} · DÜŞTÜ: ${r.summary.fail} · ZAYIFLADI: ${r.summary.degraded} · ` +
    `GÖZLENMEDİ: ${r.summary.notObserved} · ENGELLİ: ${r.summary.blocked} · ` +
    `KANIT YETERSİZ: ${r.summary.insufficient} (toplam ${r.summary.total})`);
  p();
  p('| Madde | Bölüm | Sonuç | PASS şartı | Eşik kaynağı |');
  p('|---|---|---|---|---|');
  for (const row of r.matrix) {
    p(`| ${row.title} | ${ACCEPTANCE_SECTION_LABEL[row.section]} | ` +
      `\`${row.verdict}\` ${VERDICT_LABEL[row.verdict]} | ${row.requirement} | ${row.thresholdSource} |`);
  }
  p();

  /* ── Bulgular ────────────────────────────────────────────────────────── */
  p('## 12 · En ağır bulgular (P0–P4)');
  p();
  if (r.findings.length === 0) {
    p('Açık bulgu yok.');
  } else {
    p('| Öncelik | Madde | Sonuç | Ayrıntı |');
    p('|---|---|---|---|');
    for (const f of r.findings) {
      p(`| ${f.priority} | ${f.title} | \`${f.verdict}\` | ${f.detail} |`);
    }
  }
  p();

  /* ── Kanıt eksikleri ─────────────────────────────────────────────────── */
  p('## 13 · Kanıt eksikleri');
  p();
  const missing = r.matrix.filter((x) => x.missing.length > 0);
  if (missing.length === 0) {
    p('Kanıt eksiği bildirilmedi.');
  } else {
    for (const row of missing) {
      p(`- **${row.title}** — ${row.missing.join(' ')}`);
    }
  }
  p();
  p('### Bu turda sabitlenen saha eşikleri (ürün sözleşmesinde karşılığı YOK)');
  p();
  p('| Eşik | Değer | Kaynak |');
  p('|---|---|---|');
  for (const t of specThresholds()) p(`| \`${t.key}\` | ${t.value} | ${t.source} |`);
  p();

  /* ── Gözlemci disiplini ──────────────────────────────────────────────── */
  p('## 14 · Gözlemci disiplini ve bütçe');
  p();
  p(`| Depolama baskısı | \`${s.storage.pressure}\` (${fmtNum(s.storage.usedBytes)} bayt) |`);
  p('|---|---|');
  p(`| Budanan snapshot / olay | ${s.storage.prunedSnapshots} / ${s.storage.prunedEvents} |`);
  p(`| Düşen örnek / olay / BlackBox kaydı | ${s.dropped.droppedSamples} / ` +
    `${s.dropped.droppedEvents} / ${s.dropped.droppedBlackBoxRecords} |`);
  p(`| Düşen snapshot (periyodik / **KRİTİK**) | ${s.dropped.droppedPeriodicSnapshots} / ` +
    `**${s.dropped.droppedCriticalSnapshots}** |`);
  p(`| Gizlilik taraması | \`${r.privacy.verdict}\` — taranan ${r.privacy.scannedBytes} bayt` +
    `${r.privacy.violations.length > 0 ? `, bulgu: ${r.privacy.violations.join(', ')}` : ''} |`);
  p();

  /* ── D1 · Kayıt kimliği ──────────────────────────────────────────────── */
  p('### 14.1 · Kayıt kimliği bütünlüğü (restore)');
  p();
  p('| Alan | Değer |');
  p('|---|---|');
  p(`| Kimlik hükmü | \`${s.identity.lastScanVerdict}\` |`);
  p(`| Dağıtılmış en büyük sekans | ${s.identity.idHighWater} |`);
  p(`| Restore tohumlaması | ${s.identity.seedCount} kez · son tohum=${s.identity.lastSeededFrom} |`);
  p(`| Kopya kimlik / kopya sekans | ${s.identity.duplicateIds} / ${s.identity.duplicateSequences} |`);
  p(`| Çözülemeyen kimlik | ${s.identity.unparsableIds} |`);
  p(`| Sekans boşluğu | ${s.identity.sequenceGaps} — **hata değil**, bütçe/dağıtım tanısı |`);
  p();

  /* ── D2 · Yazma bütçesi ──────────────────────────────────────────────── */
  p('### 14.2 · eMMC yazma defteri (ölçüm — tahmin değil)');
  p();
  if (r.writeStats === null || r.writeStats === undefined) {
    p('Yazım ölçümü verilmedi → `UNAVAILABLE`. (Sayı UYDURULMAZ.)');
  } else {
    p('| Kalem | Yazım | Bayt |');
    p('|---|---|---|');
    p(`| Oturum gövdesi | ${r.writeStats.sessionWrites} | ${r.writeStats.sessionBytes} |`);
    p(`| BlackBox blob | ${r.writeStats.blackBoxWrites} | ${r.writeStats.blackBoxBytes} |`);
    p(`| **Toplam** | **${r.writeStats.sessionWrites + r.writeStats.blackBoxWrites}** | ` +
      `**${r.writeStats.sessionBytes + r.writeStats.blackBoxBytes}** |`);
  }
  p();
  p(`BlackBox okuma hükmü: \`${r.blackBoxLoad?.kind ?? 'UNAVAILABLE'}\` · ` +
    `format=${r.blackBoxLoad?.formatVersion ?? 'UNAVAILABLE'} · ` +
    `checksum=${r.blackBoxLoad === null || r.blackBoxLoad.checksumOk === null
      ? 'DENETLENMEDİ' : r.blackBoxLoad.checksumOk ? 'TUTUYOR' : 'TUTMUYOR'}`);
  p();

  /* ── D3 · Snapshot kotası ────────────────────────────────────────────── */
  p('### 14.3 · Snapshot kota defteri');
  p();
  p('| Sınıf | Saklanan sayaç | Kota | Düşen |');
  p('|---|---|---|---|');
  p(`| PERIODIC | ${s.snapshotPolicy.periodicCount} | ${LR_SNAPSHOT_PERIODIC_QUOTA} | ` +
    `${s.dropped.droppedPeriodicSnapshots} |`);
  p(`| CRITICAL | ${s.snapshotPolicy.criticalCount} | ${LR_SNAPSHOT_CRITICAL_QUOTA} | ` +
    `${s.dropped.droppedCriticalSnapshots} |`);
  p();
  p(`Kontrollü tahliye (düşük öncelikli kritik kayıt): ${s.snapshotPolicy.evictedCriticalCount}`);
  p();
  if (s.dropped.droppedCriticalSnapshots > 0) {
    p('> ⚠️ **Kritik snapshot düşürüldü.** O anların ham gövdesi bu oturumda YOKTUR; ' +
      'ilgili maddeler kanıt açısından eksiktir.');
    p();
  }

  /* ── Self-validation (AYRI OTORİTE) ──────────────────────────────────── */
  p('## 15 · Kayıt öz-denetimi (kabul matrisinden AYRI otorite)');
  p();
  p(`**Doğrulayıcı hükmü:** \`${r.selfValidation.verdict}\` ` +
    `(${SELF_CHECK_LABEL[r.selfValidation.verdict]}) · ` +
    `doğrulanan ${r.selfValidation.verifiedCount}/${r.selfValidation.rows.length} · ` +
    `sorunlu ${r.selfValidation.problemCount}`);
  p();
  p('> Bu bölüm PASS/FAIL kararını **DEĞİŞTİRMEZ**. Kabul matrisi "ölçüm ne diyor"u, ' +
    'öz-denetim ise "o ölçüme güvenilebilir mi"yi söyler. İkisi ayrı durur.');
  p();
  p('| Denetim | Sonuç | Ne ölçüldü |');
  p('|---|---|---|');
  for (const row of r.selfValidation.rows) {
    p(`| ${row.title} | \`${row.result}\` ${SELF_CHECK_LABEL[row.result]} | ${row.detail} |`);
  }
  p();
  const problems = r.selfValidation.rows.filter(
    (x) => x.result === 'MISMATCH' || x.result === 'CORRUPT' || x.result === 'INSUFFICIENT_RAW_EVIDENCE',
  );
  if (problems.length > 0) {
    p('### Öz-denetim kanıt satırları');
    p();
    for (const row of problems) {
      p(`- **${row.title}** (\`${row.result}\`)`);
      for (const e of row.evidence) p(`  - ${e}`);
    }
    p();
  }

  p('## 16 · Son karar');
  p();
  p(`Kabul matrisi: \`${r.verdict}\``);
  p();
  p(`Kayıt öz-denetimi: \`${r.selfValidation.verdict}\``);
  p();
  if (r.selfValidation.verdict === 'MISMATCH' || r.selfValidation.verdict === 'CORRUPT') {
    p('> ⚠️ Öz-denetim ham kayıtla hüküm arasında tutarsızlık buldu. Kabul matrisi ' +
      'sonucu bu oturum için **güvenilir sayılmamalıdır**.');
    p();
  }
  p();
  if (r.realVehicle === 'BLOCKED_REAL_VEHICLE') {
    p('> ⚠️ Gerçek araç kanıtı yok (`obdAdapter !== "real"` veya hiç geçerli hız örneği ' +
      'toplanmadı). Bu rapor SAHA DOĞRULAMASI SAYILMAZ.');
  }

  return L.join('\n');
}
