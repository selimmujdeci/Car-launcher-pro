/**
 * oemValidationLab.test.ts — OEM Validation Lab (PR-1 host foundation) sözleşme testleri.
 *
 * KİLİTLENEN İNVARYANTLAR (bunlar zayıflatılırsa Lab yalan söyler):
 *  · Atlanan test SKORU ŞİŞİRMEZ — coverage'ı düşürür.
 *  · Cihaz kanıtı olmadan OEM_READY/PRODUCTION_READY/FLAGSHIP_READY ÜRETİLEMEZ.
 *  · Safety-critical FAIL veya blocker bulgu → REJECTED (skor ne olursa olsun).
 *  · Faz çökerse Lab çökmez (izolasyon), kalan fazlar koşar.
 *  · report.json TEK gerçek kaynak; markdown ondan RENDER edilir.
 *  · PR-1'de gerçek cihaz (adb) komutu ÇALIŞTIRILMAZ — host lane yapısal olarak reddeder.
 *  · Raporlarda sır / kişisel mutlak yol sızıntısı YOK.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  PHASE_RESULT, VERDICT, SEVERITY, CAPABILITY, PHASE_CATEGORY,
  createPhaseResult, createFinding, rollupChecks, createCheck, verdictRank,
} from '../../qa/core/result-types.mjs';
import { createRegistry, definePhase } from '../../qa/core/registry.mjs';
import { createContext } from '../../qa/core/context.mjs';
import { createArtifactStore } from '../../qa/core/artifact-store.mjs';
import { runPhases } from '../../qa/core/orchestrator.mjs';
import { computeScore } from '../../qa/core/scoring.mjs';
import { decideVerdict } from '../../qa/core/verdict.mjs';
import { runCommand } from '../../qa/core/exec.mjs';
import { redactText, redactPath, redactDeep } from '../../qa/core/redact.mjs';
import { validateProfile } from '../../qa/profiles/_schema.mjs';
import { buildReport, validateReport } from '../../qa/reports/report-schema.mjs';
import { writeReportJson } from '../../qa/reports/json-writer.mjs';
import { renderQaReport, renderOemReport, renderBuildReport } from '../../qa/reports/markdown-writer.mjs';
import buildPhase, { parseBadging, diffPermissions, sha256File } from '../../qa/phases/01-build-validation.mjs';
import { runLab, createLabRegistry, loadProfile, loadThresholds, runIdFromDate } from '../../qa/index.mjs';

const REPO_ROOT = process.cwd();
const THRESHOLDS = loadThresholds('global', REPO_ROOT);

/* ── yardımcılar ─────────────────────────────────────────────────────────── */

const tmpDirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'oemlab-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* temizlik best-effort */ }
  }
});

const HOST_PROFILE = {
  id: 'test-host', name: 'Test Host', lane: 'host',
  maxVerdict: VERDICT.HOST_VERIFIED, phases: null as string[] | null, manualFallbacks: {} as Record<string, string>,
};

 
function ctx(overrides: any = {}) {
  return createContext({
    repoRoot:   overrides.repoRoot ?? REPO_ROOT,
    runId:      'test-run',
    startedAt:  '2026-07-11T12:00:00.000Z',
    profile:    { ...HOST_PROFILE, ...(overrides.profile ?? {}) },
    thresholds: THRESHOLDS,
    capabilities: overrides.capabilities ?? [CAPABILITY.HOST_NODE, CAPABILITY.HOST_REPO],
    paths:      overrides.paths ?? {},
    artifacts:  overrides.artifacts ?? createArtifactStore({ baseDir: null, repoRoot: REPO_ROOT }),
    logger:     () => {},
    exec:       overrides.exec,
  });
}

 
function fakePhase(id: string, result: string, extra: any = {}) {
  return definePhase({
    id, name: `Faz ${id}`, order: extra.order ?? 10, weight: extra.weight ?? 1,
    category: extra.category ?? PHASE_CATEGORY.GENERAL,
    requires: extra.requires ?? [],
    safetyCritical: extra.safetyCritical ?? false,
    run: extra.run ?? (() => ({ result, findings: extra.findings ?? [], artifacts: [], metrics: {} })),
  });
}

 
function phaseResult(id: string, result: string, extra: any = {}) {
  return createPhaseResult({
    id, name: id, order: 1,
    category: extra.category ?? PHASE_CATEGORY.GENERAL,
    weight: extra.weight ?? 1,
    effectiveWeight: extra.effectiveWeight ?? extra.weight ?? 1,
    requires: extra.requires ?? [],
    safetyCritical: extra.safetyCritical ?? false,
    result,
    findings: extra.findings ?? [],
  });
}

/* ── 1-4: Registry ───────────────────────────────────────────────────────── */

describe('Registry — faz defteri', () => {
  it('1. boş registry hiçbir faz döndürmez', () => {
    const r = createRegistry();
    expect(r.size).toBe(0);
    expect(r.list()).toEqual([]);
  });

  it('2. faz kaydedilir ve geri okunur', () => {
    const r = createRegistry();
    r.register(fakePhase('a', PHASE_RESULT.PASS));
    expect(r.size).toBe(1);
    expect(r.get('a')?.id).toBe('a');
    expect(r.has('a')).toBe(true);
  });

  it('3. aynı id iki kez kaydedilemez (sessiz üzerine-yazma yok)', () => {
    const r = createRegistry();
    r.register(fakePhase('dup', PHASE_RESULT.PASS));
    expect(() => r.register(fakePhase('dup', PHASE_RESULT.FAIL))).toThrow(/duplicate|zaten kayıtlı/i);
  });

  it('4. fazlar order → id ile deterministik sıralanır (kayıt sırası önemsiz)', () => {
    const r = createRegistry();
    r.register(fakePhase('z', PHASE_RESULT.PASS, { order: 30 }));
    r.register(fakePhase('b', PHASE_RESULT.PASS, { order: 10 }));
    r.register(fakePhase('a', PHASE_RESULT.PASS, { order: 10 }));
    expect(r.list().map((p: { id: string }) => p.id)).toEqual(['a', 'b', 'z']);
  });
});

/* ── 5-10: Orchestrator durum modeli ─────────────────────────────────────── */

describe('Orchestrator — izolasyon ve durum modeli', () => {
  it('5. faz exception fırlatırsa Lab çökmez, sonraki fazlar koşar', async () => {
    const r = createRegistry();
    r.register(fakePhase('boom', PHASE_RESULT.PASS, {
      order: 1,
      run: () => { throw new Error('faz patladı'); },
    }));
    r.register(fakePhase('sonraki', PHASE_RESULT.PASS, { order: 2 }));

    const results = await runPhases(r, ctx());
    expect(results).toHaveLength(2);
    expect(results[0].result).toBe(PHASE_RESULT.INCOMPLETE);
    expect(results[0].findings[0].title).toMatch(/hata fırlattı/i);
    expect(results[1].result).toBe(PHASE_RESULT.PASS);   // izolasyon: kalan faz koştu
  });

  it('6. PASS sonucu kaydedilir', async () => {
    const r = createRegistry();
    r.register(fakePhase('ok', PHASE_RESULT.PASS));
    const results = await runPhases(r, ctx());
    expect(results[0].result).toBe(PHASE_RESULT.PASS);
    expect(results[0].scored).toBe(true);
  });

  it('7. PASS_WITH_WARNINGS sonucu kaydedilir', async () => {
    const r = createRegistry();
    r.register(fakePhase('warn', PHASE_RESULT.PASS_WITH_WARNINGS));
    const results = await runPhases(r, ctx());
    expect(results[0].result).toBe(PHASE_RESULT.PASS_WITH_WARNINGS);
  });

  it('8. FAIL sonucu kaydedilir', async () => {
    const r = createRegistry();
    r.register(fakePhase('bad', PHASE_RESULT.FAIL));
    const results = await runPhases(r, ctx());
    expect(results[0].result).toBe(PHASE_RESULT.FAIL);
  });

  it('9. yeteneği olmayan faz SKIPPED_NA olur (koşmaz)', async () => {
    let ran = false;
    const r = createRegistry();
    r.register(fakePhase('cihaz', PHASE_RESULT.PASS, {
      requires: [CAPABILITY.DEVICE_ADB],
      run: () => { ran = true; return { result: PHASE_RESULT.PASS }; },
    }));
    const results = await runPhases(r, ctx());
    expect(ran).toBe(false);
    expect(results[0].result).toBe(PHASE_RESULT.SKIPPED_NA);
    expect(results[0].skippedReason).toMatch(/device\.adb/);
  });

  it('10. manuel karşılığı olan atlanmış faz MANUAL_PENDING olur', async () => {
    const r = createRegistry();
    r.register(fakePhase('cihaz', PHASE_RESULT.PASS, { requires: [CAPABILITY.DEVICE_ADB] }));
    const results = await runPhases(r, ctx({
      profile: { manualFallbacks: { cihaz: 'T507: elle kontrol et (ADB yok)' } },
    }));
    expect(results[0].result).toBe(PHASE_RESULT.MANUAL_PENDING);
    expect(results[0].manualFallback).toMatch(/T507/);
  });
});

/* ── 11-17: Coverage & skor ──────────────────────────────────────────────── */

describe('Scoring — coverage-aware skor', () => {
  it('11. coverage alan bazında hesaplanır (host/device/vehicle)', () => {
    const s = computeScore([
      phaseResult('h1', PHASE_RESULT.PASS),
      phaseResult('d1', PHASE_RESULT.SKIPPED_NA, { requires: [CAPABILITY.DEVICE_ADB] }),
      phaseResult('d2', PHASE_RESULT.SKIPPED_NA, { requires: [CAPABILITY.DEVICE_PERF] }),
    ], THRESHOLDS);

    expect(s.coverage.host.executed).toBe(1);
    expect(s.coverage.host.ratio).toBe(1);
    expect(s.coverage.device.planned).toBe(2);
    expect(s.coverage.device.executed).toBe(0);
    expect(s.coverage.device.ratio).toBe(0);
  });

  it('12. atlanan faz skoru ŞİŞİRMEZ (skora girmez) ama coverage düşürür', () => {
    const onlyHost = computeScore([phaseResult('h1', PHASE_RESULT.PASS)], THRESHOLDS);
    const withSkipped = computeScore([
      phaseResult('h1', PHASE_RESULT.PASS),
      phaseResult('d1', PHASE_RESULT.SKIPPED_NA, { requires: [CAPABILITY.DEVICE_ADB] }),
    ], THRESHOLDS);

    // Skor aynı (atlanan ne pay ne payda) — ama coverage YENİ bir boşluk gösteriyor.
    expect(withSkipped.score).toBe(onlyHost.score);
    expect(withSkipped.coverage.device.planned).toBe(1);
    expect(withSkipped.coverage.device.ratio).toBe(0);
    // Ve atlanan faz "geçmiş" sayılmıyor:
    expect(withSkipped.counts.SKIPPED_NA).toBe(1);
    expect(withSkipped.counts.PASS).toBe(1);
  });

  it('12b. INCOMPLETE skora 0 olarak GİRER (bedava geçiş yok)', () => {
    const s = computeScore([
      phaseResult('a', PHASE_RESULT.PASS),
      phaseResult('b', PHASE_RESULT.INCOMPLETE),
    ], THRESHOLDS);
    expect(s.score).toBe(50);
  });

  it('13. hiç faz planlanmayan alanın coverage oranı 0 olur (boş küme "tam" sayılmaz)', () => {
    const s = computeScore([phaseResult('h1', PHASE_RESULT.PASS)], THRESHOLDS);
    expect(s.coverage.device.planned).toBe(0);
    expect(s.coverage.device.ratio).toBe(0);      // 1 DEĞİL — vacuous truth reddedilir
    expect(s.coverage.vehicle.ratio).toBe(0);
  });

  it('17. kategori çarpanı ağırlığı büyütür (security/performance/vehicle ×2)', () => {
    const secFail = computeScore([
      phaseResult('build', PHASE_RESULT.PASS, { category: PHASE_CATEGORY.BUILD, weight: 1, effectiveWeight: 1 }),
      phaseResult('sec',   PHASE_RESULT.FAIL, { category: PHASE_CATEGORY.SECURITY, weight: 1, effectiveWeight: 2 }),
    ], THRESHOLDS);
    // 1×1 kazanıldı / (1 + 2) mümkün → 33.3 (ağırlıksız olsaydı 50 olurdu)
    expect(secFail.score).toBeCloseTo(33.3, 1);
    expect(secFail.weighted.possible).toBe(3);
  });

  it('17b. PASS_WITH_WARNINGS tam PASS\'ten düşük puanlanır', () => {
    const pass = computeScore([phaseResult('a', PHASE_RESULT.PASS)], THRESHOLDS);
    const warn = computeScore([phaseResult('a', PHASE_RESULT.PASS_WITH_WARNINGS)], THRESHOLDS);
    expect(warn.score).toBeLessThan(pass.score);
    expect(warn.score).toBe(75);
  });
});

/* ── 13-16, 38: Verdict ──────────────────────────────────────────────────── */

describe('Verdict — kanıt olmadan iddia yok', () => {
  it('13. host-only koşu HOST_VERIFIED üretir', () => {
    const results = [phaseResult('build', PHASE_RESULT.PASS)];
    const s = computeScore(results, THRESHOLDS);
    const v = decideVerdict({ results, score: s.score, coverage: s.coverage, thresholds: THRESHOLDS, profile: HOST_PROFILE });
    expect(v.verdict).toBe(VERDICT.HOST_VERIFIED);
  });

  it('14. device coverage 0 iken skor 100 olsa bile OEM_READY ÜRETİLEMEZ', () => {
    const results = [
      phaseResult('a', PHASE_RESULT.PASS),
      phaseResult('b', PHASE_RESULT.PASS),
    ];
    const s = computeScore(results, THRESHOLDS);
    expect(s.score).toBe(100);

    // Profil tavanı KALDIRILSA bile coverage kapısı yükselmeyi engeller.
    const v = decideVerdict({
      results, score: 100, coverage: s.coverage, thresholds: THRESHOLDS,
      profile: { id: 'sinirsiz', maxVerdict: VERDICT.FLAGSHIP_READY },
    });
    expect(v.verdict).toBe(VERDICT.HOST_VERIFIED);
    expect(v.caps.coverage).toBe(VERDICT.HOST_VERIFIED);
    expect(v.reasons.join(' ')).toMatch(/Cihaz coverage = 0/);
  });

  it('15. safety-critical faz FAIL → REJECTED (skor yüksek olsa bile)', () => {
    const results = [
      phaseResult('a', PHASE_RESULT.PASS, { weight: 10, effectiveWeight: 10 }),
      phaseResult('safety', PHASE_RESULT.FAIL, { safetyCritical: true, weight: 1, effectiveWeight: 1 }),
    ];
    const s = computeScore(results, THRESHOLDS);
    expect(s.score).toBeGreaterThan(85);   // skor yüksek…
    const v = decideVerdict({ results, score: s.score, coverage: s.coverage, thresholds: THRESHOLDS, profile: HOST_PROFILE });
    expect(v.verdict).toBe(VERDICT.REJECTED);   // …ama güvenlik kapısı kapalı
  });

  it('15b. safety-critical faz INCOMPLETE → REJECTED (kanıt üretemedi)', () => {
    const results = [phaseResult('safety', PHASE_RESULT.INCOMPLETE, { safetyCritical: true })];
    const v = decideVerdict({ results, score: 100, coverage: computeScore(results, THRESHOLDS).coverage, thresholds: THRESHOLDS, profile: HOST_PROFILE });
    expect(v.verdict).toBe(VERDICT.REJECTED);
  });

  it('16. blocker bulgu → REJECTED', () => {
    const results = [phaseResult('a', PHASE_RESULT.PASS_WITH_WARNINGS, {
      findings: [createFinding({ id: 'x', severity: SEVERITY.BLOCKER, title: 'İmzasız release APK' })],
    })];
    const s = computeScore(results, THRESHOLDS);
    const v = decideVerdict({ results, score: s.score, coverage: s.coverage, thresholds: THRESHOLDS, profile: HOST_PROFILE });
    expect(v.verdict).toBe(VERDICT.REJECTED);
    expect(v.reasons.join(' ')).toMatch(/BLOCKER/);
  });

  it('16b. düşük skor → REJECTED', () => {
    const results = [phaseResult('a', PHASE_RESULT.FAIL)];
    const s = computeScore(results, THRESHOLDS);
    const v = decideVerdict({ results, score: s.score, coverage: s.coverage, thresholds: THRESHOLDS, profile: HOST_PROFILE });
    expect(v.verdict).toBe(VERDICT.REJECTED);
  });

  it('38. cihazsız PRODUCTION_READY/FLAGSHIP_READY matematiksel olarak imkânsız', () => {
    for (const score of [70, 85, 92, 97, 100]) {
      const results = [phaseResult('a', PHASE_RESULT.PASS)];
      const coverage = computeScore(results, THRESHOLDS).coverage;
      const v = decideVerdict({
        results, score, coverage, thresholds: THRESHOLDS,
        profile: { id: 'x', maxVerdict: VERDICT.FLAGSHIP_READY },
      });
      expect(verdictRank(v.verdict)).toBeLessThanOrEqual(verdictRank(VERDICT.HOST_VERIFIED));
    }
  });

  it('38b. cihaz kanıtı GELİRSE merdiven açılır (model ileriye dönük doğru)', () => {
    const results = [
      phaseResult('h', PHASE_RESULT.PASS),
      phaseResult('d1', PHASE_RESULT.PASS, { requires: [CAPABILITY.DEVICE_ADB] }),
      phaseResult('d2', PHASE_RESULT.PASS, { requires: [CAPABILITY.DEVICE_PERF] }),
    ];
    const s = computeScore(results, THRESHOLDS);
    expect(s.coverage.device.ratio).toBe(1);
    const v = decideVerdict({
      results, score: s.score, coverage: s.coverage, thresholds: THRESHOLDS,
      profile: { id: 'device', maxVerdict: VERDICT.OEM_READY },
    });
    expect(v.verdict).toBe(VERDICT.OEM_READY);
  });
});

/* ── 18, 39: Değişmezlik ─────────────────────────────────────────────────── */

describe('Immutability — girdi mutasyona uğramaz', () => {
  it('18. context ve faz sonucu dondurulmuştur', async () => {
    const c = ctx();
    expect(Object.isFrozen(c)).toBe(true);
    expect(() => { (c as unknown as Record<string, unknown>).repoRoot = 'hack'; }).toThrow();

    const r = createRegistry();
    r.register(fakePhase('a', PHASE_RESULT.PASS));
    const results = await runPhases(r, c);
    expect(Object.isFrozen(results[0])).toBe(true);
    expect(Object.isFrozen(results[0].findings)).toBe(true);
  });

  it('39. orchestrator faz tanımını / context yeteneklerini mutasyona uğratmaz', async () => {
    const phase = fakePhase('a', PHASE_RESULT.PASS, { requires: [CAPABILITY.HOST_REPO] });
    const beforeRequires = [...phase.requires];
    const c = ctx();
    const capsBefore = [...c.capabilities];

    const r = createRegistry();
    r.register(phase);
    await runPhases(r, c);

    expect([...phase.requires]).toEqual(beforeRequires);
    expect([...c.capabilities]).toEqual(capsBefore);
    expect(Object.isFrozen(phase)).toBe(true);
  });
});

/* ── 19, 20: Raporlar ────────────────────────────────────────────────────── */

describe('Raporlar — report.json tek gerçek kaynak', () => {
   
  function sampleReport(): any {
    const results = [phaseResult('build-validation', PHASE_RESULT.PASS_WITH_WARNINGS, {
      findings: [createFinding({ id: 'f1', severity: SEVERITY.MAJOR, title: 'APK kanıtı yok' })],
    })];
    const scoring = computeScore(results, THRESHOLDS);
    const verdict = decideVerdict({ results, score: scoring.score, coverage: scoring.coverage, thresholds: THRESHOLDS, profile: HOST_PROFILE });
    return buildReport({
      runId: '2026-07-11T12-00-00Z',
      startedAt: '2026-07-11T12:00:00.000Z',
      finishedAt: '2026-07-11T12:00:05.000Z',
      repoRoot: REPO_ROOT,
      profile: HOST_PROFILE,
      thresholds: THRESHOLDS,
      capabilities: [CAPABILITY.HOST_NODE],
      results, scoring, verdict,
      environment: { platform: 'win32', nodeVersion: 'v20.0.0', ci: false },
      logs: [],
    });
  }

  it('19. report.json şema doğrulamasından geçer ve diske yazılır', async () => {
    const report = sampleReport();
    expect(validateReport(report).valid).toBe(true);

    const dir = tmp();
    const path = await writeReportJson(dir, report);
    expect(existsSync(path)).toBe(true);

    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.verdict.value).toBe(VERDICT.HOST_VERIFIED);
    expect(parsed.capabilities.deviceLayerImplemented).toBe(false);
  });

  it('19b. bozuk rapor diske YAZILMAZ (şema kapısı)', async () => {
    const dir = tmp();
    await expect(writeReportJson(dir, { schemaVersion: 99 })).rejects.toThrow(/şema ihlali/i);
    expect(existsSync(join(dir, 'report.json'))).toBe(false);
  });

  it('20. markdown raporlar YALNIZCA report nesnesinden render edilir (saf fonksiyon)', () => {
    const report = sampleReport();
    const qa = renderQaReport(report);
    const oem = renderOemReport(report);
    const build = renderBuildReport(report);

    // Verdict ve skor JSON'daki değerlerle birebir aynı — ikinci bir hesap yok.
    expect(qa).toContain(report.verdict.value);
    expect(qa).toContain(String(report.score.value));
    expect(oem).toContain(report.verdict.value);
    expect(oem).toMatch(/Gerçek araçta.*kanıtlanmadı/s);
    expect(build).toContain('Build Doğrulama Raporu');

    // Aynı girdi → aynı çıktı (deterministik, yan etkisiz)
    expect(renderQaReport(report)).toBe(qa);
  });
});

/* ── 21, 22: Profil ──────────────────────────────────────────────────────── */

describe('Profil — şema doğrulama', () => {
  it('21. host-only.json geçerlidir ve tavanı HOST_VERIFIED\'dır', () => {
    const profile = loadProfile('host-only', REPO_ROOT);
    expect(validateProfile(profile).valid).toBe(true);
    expect(profile.lane).toBe('host');
    expect(profile.maxVerdict).toBe(VERDICT.HOST_VERIFIED);
    expect(profile.phases).toContain('build-validation');
  });

  it('22. geçersiz profil REDDEDİLİR (sessiz varsayılana düşmez)', () => {
    expect(validateProfile(null).valid).toBe(false);
    expect(validateProfile({ id: 'x' }).valid).toBe(false);
    expect(validateProfile({ id: 'x', name: 'X', lane: 'uzay', maxVerdict: VERDICT.HOST_VERIFIED, phases: ['a'] }).valid).toBe(false);
    expect(validateProfile({ id: 'x', name: 'X', lane: 'host', maxVerdict: 'SUPER_READY', phases: ['a'] }).valid).toBe(false);
    expect(validateProfile({ id: 'x', name: 'X', lane: 'host', maxVerdict: VERDICT.HOST_VERIFIED, phases: [] }).valid).toBe(false);
  });

  it('22b. host lane profili OEM_READY tavanı İSTEYEMEZ (yapısal kilit)', () => {
    const bad = validateProfile({ id: 'hile', name: 'Hile', lane: 'host', maxVerdict: VERDICT.OEM_READY, phases: ['build-validation'] });
    expect(bad.valid).toBe(false);
    expect(bad.errors.join(' ')).toMatch(/cihaz kanıtı yok/i);
  });

  it('22c. profil bilinmeyen faz isteyemez', () => {
    const r = createLabRegistry();
    expect(() => r.list(['olmayan-faz'])).toThrow(/bilinmeyen faz/i);
  });
});

/* ── 23-29, 40: Build Validation fazı ────────────────────────────────────── */

describe('Faz 1 — Build Validation', () => {
  it('23. APK bulunamazsa faz ÇÖKMEZ: kontrol SKIPPED_NA + "kanıt yok" bulgusu', async () => {
    const repo = tmp();
    const out = await buildPhase.run(ctx({
      repoRoot: repo,
      paths: { apk: null, aapt2: null, apksigner: null },
    }));

    const apkCheck = out.metrics.checks.find((c: { id: string }) => c.id === 'apk-present');
    expect(apkCheck.status).toBe(PHASE_RESULT.SKIPPED_NA);
    expect(out.findings.some((f: { id: string }) => f.id === 'build.apk-missing')).toBe(true);
    // Atlanan kontrol "geçti" SAYILMAZ → faz tam PASS olamaz
    expect(out.result).not.toBe(PHASE_RESULT.PASS);
  });

  it('24. SHA-256 stream ile doğru üretilir', async () => {
    const dir = tmp();
    const file = join(dir, 'fake.apk');
    writeFileSync(file, 'CarOS Pro APK içeriği');
    const expected = createHash('sha256').update('CarOS Pro APK içeriği').digest('hex');
    await expect(sha256File(file)).resolves.toBe(expected);
  });

  it('25. aapt2 badging çıktısından paket adı ayrıştırılır', () => {
    const badging = parseBadging(
      "package: name='com.cockpitos.pro' versionCode='7' versionName='1.2.3' platformBuildVersionName='14'",
    );
    expect(badging.packageName).toBe('com.cockpitos.pro');
  });

  it('26. sürüm (versionName/versionCode) ayrıştırılır', () => {
    const badging = parseBadging("package: name='com.cockpitos.pro' versionCode='7' versionName='1.2.3'");
    expect(badging.versionCode).toBe('7');
    expect(badging.versionName).toBe('1.2.3');
  });

  it('26b. debuggable bayrağı tespit edilir', () => {
    expect(parseBadging('application-debuggable').debuggable).toBe(true);
    expect(parseBadging("package: name='x'").debuggable).toBe(false);
  });

  it('27. izin farkı hesaplanır (beklenmeyen / yasaklı / eksik / kritik)', () => {
    const expectContract = {
      allowedPermissions:   ['android.permission.INTERNET', 'android.permission.CAMERA'],
      criticalPermissions:  ['android.permission.CAMERA'],
      forbiddenPermissions: ['android.permission.READ_SMS'],
    };
    const diff = diffPermissions(
      ['android.permission.INTERNET', 'android.permission.READ_SMS', 'android.permission.NFC'],
      expectContract,
    );
    expect(diff.banned).toEqual(['android.permission.READ_SMS']);
    expect(diff.unexpected).toEqual(['android.permission.READ_SMS', 'android.permission.NFC']);
    expect(diff.missing).toEqual(['android.permission.CAMERA']);
    expect(diff.unexpectedCritical).toEqual(['android.permission.READ_SMS']);
  });

  it('28. apksigner yoksa imza kontrolü SKIPPED_NA olur (fail-soft, Lab çökmez)', async () => {
    const repo = tmp();
    writeFileSync(join(repo, 'app.apk'), 'sahte-apk');
    const out = await buildPhase.run(ctx({
      repoRoot: repo,
      paths: { apk: join(repo, 'app.apk'), aapt2: null, apksigner: null },
    }));
    const sig = out.metrics.checks.find((c: { id: string }) => c.id === 'apk-signature');
    expect(sig.status).toBe(PHASE_RESULT.SKIPPED_NA);
    expect(out.findings.some((f: { id: string }) => f.id === 'build.apksigner-missing')).toBe(true);
  });

  it('29. aapt2 yoksa manifest kontrolleri SKIPPED_NA olur (fail-soft)', async () => {
    const repo = tmp();
    writeFileSync(join(repo, 'app.apk'), 'sahte-apk');
    const out = await buildPhase.run(ctx({
      repoRoot: repo,
      paths: { apk: join(repo, 'app.apk'), aapt2: null, apksigner: null },
    }));
    for (const id of ['apk-package', 'apk-version', 'apk-permissions', 'apk-debuggable']) {
      expect(out.metrics.checks.find((c: { id: string }) => c.id === id).status).toBe(PHASE_RESULT.SKIPPED_NA);
    }
    // SHA-256 yine de üretilmiş olmalı (araçsız da olsa kanıt toplanır)
    expect(out.metrics.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('40. faz MEVCUT araçları yeniden kullanır (scripts/verify-webview-compat.mjs)', () => {
    const src = readFileSync(join(REPO_ROOT, 'qa', 'phases', '01-build-validation.mjs'), 'utf8');
    expect(src).toContain('verify-webview-compat.mjs');
    expect(src).toContain('version.properties');
  });
});

/* ── 30: Exec ────────────────────────────────────────────────────────────── */

describe('Exec — sınırlı alt-süreç', () => {
  it('30. zaman aşımında süreç öldürülür, timer temizlenir, throw ETMEZ', async () => {
    const res = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 400 });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.error).toMatch(/zaman aşımı/i);
    expect(res.durationMs).toBeLessThan(5000);
  }, 15_000);

  it('30b. bulunamayan komut throw ETMEZ (fail-soft)', async () => {
    const res = await runCommand('kesinlikle-olmayan-komut-xyz', ['--v'], { timeoutMs: 2000 });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  }, 15_000);
});

/* ── 31-33: Redaksiyon ───────────────────────────────────────────────────── */

describe('Privacy — sır ve yol redaksiyonu', () => {
  it('31. sırlar redakte edilir (api key / token / JWT / MAC)', () => {
    const raw = [
      'VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdef123',
      'api_key: AIzaSyD-1234567890abcdefghijklmnopqrs',
      'storePassword=SuperGizli123',
      'Bluetooth OBD: AA:BB:CC:DD:EE:FF',
    ].join('\n');
    const out = redactText(raw, REPO_ROOT);

    expect(out).not.toContain('SuperGizli123');
    expect(out).not.toContain('AIzaSyD-1234567890abcdefghijklmnopqrs');
    expect(out).not.toContain('AA:BB:CC:DD:EE:FF');
    expect(out).toMatch(/REDACTED/);
  });

  it('32. mutlak yollar repo-göreli / <HOME> / <ABS> olur', () => {
    expect(redactPath(join(REPO_ROOT, 'src', 'App.tsx'), REPO_ROOT)).toBe('repo:/src/App.tsx');
    expect(redactPath('C:\\Users\\selim\\Desktop\\gizli\\keystore.jks', '/baska/repo')).toBe('<HOME>/Desktop/gizli/keystore.jks');
    expect(redactPath('/home/selim/.android/debug.keystore', '/baska/repo')).toBe('<HOME>/.android/debug.keystore');
    // Repo/ev dışı makine yolu (gradle buildDir override) → topoloji sızmaz
    expect(redactPath('C:/Temp/carlauncher/app/build/outputs/apk/debug/app-debug.apk', REPO_ROOT))
      .toBe('<ABS>/debug/app-debug.apk');
  });

  it('32c. rapor metnine sızan makine yolları da <ABS> olur', () => {
    const out = redactText('APK bulundu: C:/Temp/carlauncher/app/build/outputs/apk/debug/app-debug.apk', REPO_ROOT);
    expect(out).not.toContain('C:/Temp/carlauncher');
    expect(out).toContain('<ABS>/');
  });

  it('32b. rapor ağacı derinlemesine redakte edilir (döngü güvenli)', () => {
    const tree = { a: { b: ['token=SuperGizli123', 'C:\\Users\\selim\\x.txt'] }, n: 42 };
    const out = redactDeep(tree, REPO_ROOT) as { a: { b: string[] }, n: number };
    expect(out.a.b[0]).not.toContain('SuperGizli123');
    expect(out.a.b[1]).toContain('<HOME>');
    expect(out.n).toBe(42);
  });

  it('33. Windows ters-eğik çizgili yollar da redakte edilir', () => {
    const winPath = REPO_ROOT.replace(/\//g, '\\');
    const out = redactText(`Yol: ${winPath}\\android\\app.apk`, REPO_ROOT);
    expect(out).not.toContain(winPath);
    expect(out).toContain('repo:');
  });
});

/* ── 34: gitignore ───────────────────────────────────────────────────────── */

describe('Git hijyeni', () => {
  it('34. docs-local/qa-runs git\'e girmez', () => {
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/docs-local\/qa-runs/);
  });
});

/* ── 35: Artefakt sınırları ──────────────────────────────────────────────── */

describe('Artefakt deposu — bounded', () => {
  it('35. dosya sayısı ve dosya boyutu sınırlıdır (kaçak faz diski dolduramaz)', () => {
    const dir = tmp();
    const store = createArtifactStore({ baseDir: dir, repoRoot: REPO_ROOT, maxFiles: 2, maxBytesPerFile: 50 });

    store.write('raw/a.txt', 'x'.repeat(500));
    store.write('raw/b.txt', 'kısa');
    const third = store.write('raw/c.txt', 'taşan');

    expect(store.count).toBe(2);
    expect(third.dropped).toBe(true);
    expect(store.droppedCount).toBe(1);
    expect(existsSync(join(dir, 'raw', 'c.txt'))).toBe(false);
    expect(readFileSync(join(dir, 'raw', 'a.txt'), 'utf8')).toMatch(/ARTEFAKT KESİLDİ/);
  });

  it('35b. artefakt koşu klasörü dışına yazamaz (path traversal)', () => {
    const dir = tmp();
    const store = createArtifactStore({ baseDir: dir, repoRoot: REPO_ROOT });
    expect(() => store.write('../../kacak.txt', 'x')).toThrow(/dışına/i);
  });
});

/* ── 36, 37: PR-1 kapsam kilitleri ───────────────────────────────────────── */

describe('PR-1 kapsam kilitleri', () => {
  it('36. qa/index.mjs import edilmesi hiçbir şey ÇALIŞTIRMAZ (yan etkisiz)', () => {
    // Modül zaten yukarıda import edildi; koşu tetiklenmiş olsaydı burada
    // rapor klasörü oluşurdu.
    expect(typeof runLab).toBe('function');
    expect(typeof createLabRegistry).toBe('function');

    const src = readFileSync(join(REPO_ROOT, 'qa', 'index.mjs'), 'utf8');
    expect(src).toMatch(/invokedDirectly/);   // main() yalnız doğrudan çağrıda koşar

    // Import sırasında koşu klasörü ÜRETİLMEDİ:
    expect(existsSync(join(REPO_ROOT, 'docs-local', 'qa-runs', runIdFromDate(new Date())))).toBe(false);
  });

  it('37. PR-1 hiçbir yerde gerçek cihaz (adb) komutu çalıştırmaz', async () => {
    // (a) Kaynak taraması: qa/ altında adb çağrısı YOK.
    const sources = [
      'qa/index.mjs', 'qa/core/context.mjs', 'qa/core/exec.mjs', 'qa/core/orchestrator.mjs',
      'qa/core/registry.mjs', 'qa/core/scoring.mjs', 'qa/core/verdict.mjs',
      'qa/phases/01-build-validation.mjs',
    ];
    for (const rel of sources) {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      // exec/spawn ile adb çağrısı arayan desen (yorumlardaki "adb" kelimesi serbest)
      expect(src).not.toMatch(/exec\s*\(\s*['"`]adb/);
      expect(src).not.toMatch(/spawn\s*\(\s*['"`]adb/);
      expect(src).not.toMatch(/['"`]adb\s+(shell|devices|install)/);
    }

    // (b) Davranışsal kilit: host lane adb'yi REDDEDER — yol biçimi ne olursa olsun.
    // (Ters-bölülü Windows yolu POSIX CI'da kapıdan SIZIYORDU; bu kilit onu tutar.)
    await expect(ctx().exec('adb', ['devices'])).rejects.toThrow(/host lane/i);
    await expect(ctx().exec('C:\\sdk\\platform-tools\\adb.exe', ['shell', 'ls'])).rejects.toThrow(/host lane/i);
    await expect(ctx().exec('/opt/android-sdk/platform-tools/adb', ['devices'])).rejects.toThrow(/host lane/i);
    await expect(ctx().exec('fastboot', ['reboot'])).rejects.toThrow(/host lane/i);
  });

  it('37b. faz kataloğunda cihaz fazı YOK (PR-1 host foundation)', () => {
    const registry = createLabRegistry();
    for (const phase of registry.list()) {
      for (const cap of phase.requires) {
        expect(cap.startsWith('device.')).toBe(false);
        expect(cap.startsWith('vehicle.')).toBe(false);
      }
    }
  });
});

/* ── Uçtan uca: runLab (dry-run, diske yazmaz) ───────────────────────────── */

describe('runLab — uçtan uca host koşusu', () => {
  it('E2E. host-only profil ile koşar, HOST_VERIFIED tavanını aşmaz, rapor üretir', async () => {
    const { report, reportDir } = await runLab({
      profileId: 'host-only',
      repoRoot: REPO_ROOT,
      outRoot: null,                    // dry-run: diske yazma yok
      now: new Date('2026-07-11T12:00:00.000Z'),
      logger: () => {},
    });

    expect(reportDir).toBeNull();
    expect(validateReport(report).valid).toBe(true);
    expect(report.profile.id).toBe('host-only');
    expect(verdictRank(report.verdict.value)).toBeLessThanOrEqual(verdictRank(VERDICT.HOST_VERIFIED));
    expect(report.coverage.device.ratio).toBe(0);
    expect(report.capabilities.deviceLayerImplemented).toBe(false);
    expect(report.phases.map((p: { id: string }) => p.id)).toContain('build-validation');
    expect(report.capabilities.detected.every((c: string) => c.startsWith('host.'))).toBe(true);
  }, 120_000);

  it('E2E-b. koşu klasörü report.json + 3 markdown üretir', async () => {
    const out = tmp();
    const { report, reportDir } = await runLab({
      profileId: 'host-only',
      repoRoot: REPO_ROOT,
      outRoot: out,
      now: new Date('2026-07-11T12:00:00.000Z'),
      logger: () => {},
    });

    expect(reportDir).toBeTruthy();
    for (const f of ['report.json', 'QA_REPORT.md', 'OEM_REPORT.md', 'BUILD_REPORT.md']) {
      expect(existsSync(join(reportDir!, f))).toBe(true);
    }
    const onDisk = JSON.parse(readFileSync(join(reportDir!, 'report.json'), 'utf8'));
    expect(onDisk.verdict.value).toBe(report.verdict.value);   // JSON = tek gerçek kaynak
  }, 120_000);
});

/* ── Durum modeli yardımcıları ───────────────────────────────────────────── */

describe('rollupChecks — kontrol → faz sonucu', () => {
  it('hiç kontrol koşmadıysa INCOMPLETE (PASS DEĞİL)', () => {
    expect(rollupChecks([createCheck({ id: 'a', status: PHASE_RESULT.SKIPPED_NA })])).toBe(PHASE_RESULT.INCOMPLETE);
  });

  it('atlanan kontrol varsa en fazla PASS_WITH_WARNINGS', () => {
    expect(rollupChecks([
      createCheck({ id: 'a', status: PHASE_RESULT.PASS }),
      createCheck({ id: 'b', status: PHASE_RESULT.SKIPPED_NA }),
    ])).toBe(PHASE_RESULT.PASS_WITH_WARNINGS);
  });

  it('hepsi PASS ise PASS', () => {
    expect(rollupChecks([
      createCheck({ id: 'a', status: PHASE_RESULT.PASS }),
      createCheck({ id: 'b', status: PHASE_RESULT.PASS }),
    ])).toBe(PHASE_RESULT.PASS);
  });

  it('bir FAIL varsa FAIL', () => {
    expect(rollupChecks([
      createCheck({ id: 'a', status: PHASE_RESULT.PASS }),
      createCheck({ id: 'b', status: PHASE_RESULT.FAIL }),
    ])).toBe(PHASE_RESULT.FAIL);
  });
});

/* ── mkdirSync kullanımı (lint: import kullanılıyor) ─────────────────────── */
describe('Sanity', () => {
  it('geçici klasör altyapısı çalışıyor', () => {
    const d = tmp();
    mkdirSync(join(d, 'x'), { recursive: true });
    expect(existsSync(join(d, 'x'))).toBe(true);
  });
});
