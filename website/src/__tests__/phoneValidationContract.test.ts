/**
 * phoneValidationContract.test.ts — TELEFON DOĞRULAMA SÖZLEŞMESİ KİLİTLERİ.
 *
 * En kritik kilit: **gerçek head unit olmadan head-unit doğrulaması PASS
 * yazılamaz** ve **kanıtsız PASS kabul edilmez**. Bu kurallar bir belgede
 * metin olarak dururken unutulabilir; burada makine tarafından zorlanır.
 */

import { describe, it, expect } from 'vitest';
import {
  PHONE_SCENARIOS, HEAD_UNIT_BLOCKED_AREAS, findScenario, validateRun,
  summarize, scenarioResultLabel, SCENARIO_RESULTS, MAX_SCENARIO_RUNS,
  isDeviceContextComplete, ValidationEvidenceCollector, toLabExport,
  type ScenarioRun, type ScenarioResult, type DeviceContext,
} from '@/lib/validation/phoneValidationScenarios';

/** Gerçek koşumda doldurulacak cihaz bağlamı. */
const DEVICE: DeviceContext = {
  model: 'Test Telefon A1', androidVersion: '13', appBuild: 'local-dev-abc123',
};

/* ── 1. SÖZLEŞME BÜTÜNLÜĞÜ ─────────────────────────────────────────────── */

describe('telefon doğrulama · sözleşme bütünlüğü', () => {
  it('P1–P15 senaryoları tanımlıdır', () => {
    expect(PHONE_SCENARIOS).toHaveLength(15);
    for (let i = 1; i <= 15; i++) {
      expect(findScenario(`P${i}`)).not.toBeNull();
    }
  });

  it('senaryo kimlikleri BENZERSİZDİR', () => {
    const all = [...PHONE_SCENARIOS, ...HEAD_UNIT_BLOCKED_AREAS].map((s) => s.scenarioId);
    expect(new Set(all).size).toBe(all.length);
  });

  it('her telefon senaryosu adım, beklenti ve YASAKLI olay taşır', () => {
    for (const s of PHONE_SCENARIOS) {
      expect(s.steps.length).toBeGreaterThan(0);
      expect(s.prohibitedEvents.length).toBeGreaterThan(0);
      expect(s.evidenceRequired.length).toBeGreaterThan(0);
      expect(s.title.length).toBeGreaterThan(10);
    }
  });

  it('telefon senaryolarının HİÇBİRİ head-unit gerektirmez', () => {
    for (const s of PHONE_SCENARIOS) expect(s.requiresHeadUnit).toBe(false);
  });

  it('head-unit alanları AYRI listelenir ve hepsi bloklu', () => {
    expect(HEAD_UNIT_BLOCKED_AREAS.length).toBeGreaterThan(5);
    for (const s of HEAD_UNIT_BLOCKED_AREAS) expect(s.requiresHeadUnit).toBe(true);
  });

  it('her sonuç türü için Türkçe etiket vardır', () => {
    for (const r of SCENARIO_RESULTS) {
      expect(scenarioResultLabel(r as ScenarioResult).length).toBeGreaterThan(3);
    }
  });

  it('kayıt sınırı bounded', () => {
    expect(MAX_SCENARIO_RUNS).toBeGreaterThan(0);
    expect(MAX_SCENARIO_RUNS).toBeLessThanOrEqual(1000);
  });
});

/* ── 2. HEAD-UNIT KAPISI (en kritik kilit) ─────────────────────────────── */

describe('telefon doğrulama · head-unit kapısı', () => {
  it('🔴 head-unit senaryosu telefonda PASS YAZILAMAZ', () => {
    const run: ScenarioRun = {
      scenarioId: HEAD_UNIT_BLOCKED_AREAS[0].scenarioId,
      result: 'PASS',
      evidence: ['MANUAL_NOTE'],
      note: 'telefonda denedim, çalıştı',
    };
    const check = validateRun(run);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('HEAD_UNIT_REQUIRED');
  });

  it('head-unit senaryosu BLOCKED_HEAD_UNIT olarak kaydedilebilir', () => {
    const run: ScenarioRun = {
      scenarioId: HEAD_UNIT_BLOCKED_AREAS[0].scenarioId,
      result: 'BLOCKED_HEAD_UNIT',
      evidence: [],
      note: 'gerçek araç ünitesi yok',
    };
    expect(validateRun(run).ok).toBe(true);
  });

  it('TÜM head-unit alanları için PASS reddedilir', () => {
    for (const s of HEAD_UNIT_BLOCKED_AREAS) {
      const check = validateRun({
        scenarioId: s.scenarioId, result: 'PASS',
        evidence: ['SCREENSHOT','LAB_SNAPSHOT','SERVER_STATE','UI_TEXT','MANUAL_NOTE'],
        note: '',
      });
      expect(check.ok).toBe(false);
      expect(check.reason).toBe('HEAD_UNIT_REQUIRED');
    }
  });
});

/* ── 3. KANITSIZ PASS YASAK ────────────────────────────────────────────── */

describe('telefon doğrulama · kanıt zorunluluğu', () => {
  it('🔴 kanıtsız PASS REDDEDİLİR', () => {
    const check = validateRun({
      scenarioId: 'P1', result: 'PASS', evidence: [], note: 'çalışıyor',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('EVIDENCE_MISSING');
  });

  it('EKSİK kanıtla PASS reddedilir', () => {
    // P1 hem UI_TEXT hem LAB_SNAPSHOT ister.
    const check = validateRun({
      scenarioId: 'P1', result: 'PASS', evidence: ['UI_TEXT'], note: '',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('EVIDENCE_MISSING');
  });

  it('TAM kanıtla PASS kabul edilir', () => {
    const check = validateRun({
      scenarioId: 'P1', result: 'PASS',
      evidence: ['UI_TEXT', 'LAB_SNAPSHOT'], note: 'ölçüldü', device: DEVICE,
    });
    expect(check.ok).toBe(true);
  });

  it('FAIL kaydı kanıt gerektirmez (düşüş gizlenmemeli)', () => {
    expect(validateRun({
      scenarioId: 'P1', result: 'FAIL', evidence: [], note: 'kaydedildi dedi',
    }).ok).toBe(true);
  });

  it('bilinmeyen senaryo kaydedilmez', () => {
    const check = validateRun({
      scenarioId: 'P99', result: 'PASS', evidence: ['UI_TEXT'], note: '',
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('UNKNOWN_SCENARIO');
  });
});

/* ── 4. ÖZET DÜRÜSTLÜĞÜ ────────────────────────────────────────────────── */

describe('telefon doğrulama · özet dürüstlüğü', () => {
  it('hiç koşulmadıysa phoneValidated FALSE ve hepsi NOT_RUN', () => {
    const s = summarize([]);
    expect(s.total).toBe(15);
    expect(s.notRun).toBe(15);
    expect(s.passed).toBe(0);
    expect(s.phoneValidated).toBe(false);
  });

  it('🔴 "çoğu geçti" doğrulama SAYILMAZ — tek NOT_RUN yeterli', () => {
    const runs: ScenarioRun[] = PHONE_SCENARIOS.slice(0, 14).map((sc) => ({
      scenarioId: sc.scenarioId, result: 'PASS' as const,
      evidence: [...sc.evidenceRequired], note: '', device: DEVICE,
    }));
    const s = summarize(runs);
    expect(s.passed).toBe(14);
    expect(s.notRun).toBe(1);
    expect(s.phoneValidated).toBe(false);
  });

  it('kanıtsız PASS özet içinde GEÇMİŞ sayılmaz', () => {
    const runs: ScenarioRun[] = PHONE_SCENARIOS.map((sc) => ({
      scenarioId: sc.scenarioId, result: 'PASS' as const,
      evidence: [], note: '',           // kanıt YOK
    }));
    const s = summarize(runs);
    expect(s.passed).toBe(0);
    expect(s.blocked).toBe(15);
    expect(s.phoneValidated).toBe(false);
  });

  it('hepsi kanıtlı PASS ise phoneValidated TRUE olur', () => {
    const runs: ScenarioRun[] = PHONE_SCENARIOS.map((sc) => ({
      scenarioId: sc.scenarioId, result: 'PASS' as const,
      evidence: [...sc.evidenceRequired], note: 'ölçüldü', device: DEVICE,
    }));
    const s = summarize(runs);
    expect(s.passed).toBe(15);
    expect(s.phoneValidated).toBe(true);
  });

  it('bir FAIL varsa phoneValidated FALSE', () => {
    const runs: ScenarioRun[] = PHONE_SCENARIOS.map((sc, i) => ({
      scenarioId: sc.scenarioId,
      result: (i === 3 ? 'FAIL' : 'PASS') as ScenarioResult,
      evidence: [...sc.evidenceRequired], note: '', device: DEVICE,
    }));
    const s = summarize(runs);
    expect(s.failed).toBe(1);
    expect(s.phoneValidated).toBe(false);
  });

  it('head-unit senaryoları telefon özetine DAHİL EDİLMEZ', () => {
    // Özet yalnız telefonda koşulabilir 15 senaryoyu sayar.
    const s = summarize([]);
    expect(s.total).toBe(PHONE_SCENARIOS.length);
    expect(s.total).toBeLessThan(PHONE_SCENARIOS.length + HEAD_UNIT_BLOCKED_AREAS.length);
  });
});

/* ── 4b. CİHAZ BAĞLAMI ZORUNLULUĞU ─────────────────────────────────────── */

describe('telefon doğrulama · cihaz bağlamı', () => {
  it('🔴 cihaz bağlamı OLMADAN PASS yazılamaz', () => {
    const check = validateRun({
      scenarioId: 'P1', result: 'PASS',
      evidence: ['UI_TEXT', 'LAB_SNAPSHOT'], note: 'geçti',
      // device YOK
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('DEVICE_CONTEXT_MISSING');
  });

  it('EKSİK cihaz bağlamı da reddedilir', () => {
    for (const partial of [
      { model: '', androidVersion: '13', appBuild: 'b1' },
      { model: 'A1', androidVersion: '', appBuild: 'b1' },
      { model: 'A1', androidVersion: '13', appBuild: '  ' },
    ]) {
      expect(isDeviceContextComplete(partial)).toBe(false);
      const check = validateRun({
        scenarioId: 'P1', result: 'PASS',
        evidence: ['UI_TEXT', 'LAB_SNAPSHOT'], note: '', device: partial,
      });
      expect(check.reason).toBe('DEVICE_CONTEXT_MISSING');
    }
  });

  it('tam cihaz bağlamı kabul edilir', () => {
    expect(isDeviceContextComplete(DEVICE)).toBe(true);
  });

  it('FAIL/BLOCKED kaydı cihaz bağlamı gerektirmez', () => {
    expect(validateRun({ scenarioId: 'P1', result: 'FAIL', evidence: [], note: '' }).ok).toBe(true);
  });
});

/* ── 4c. KANIT TOPLAYICI ───────────────────────────────────────────────── */

describe('telefon doğrulama · kanıt toplayıcı', () => {
  it('geçersiz PASS toplayıcıya GİRMEZ', () => {
    const collector = new ValidationEvidenceCollector();
    const result = collector.record({
      scenarioId: 'P1', result: 'PASS', evidence: [], note: 'kanıtsız',
    });
    expect(result.ok).toBe(false);
    expect(collector.all()).toHaveLength(0);
  });

  it('geçerli kayıt eklenir ve özete yansır', () => {
    const collector = new ValidationEvidenceCollector();
    expect(collector.record({
      scenarioId: 'P1', result: 'PASS',
      evidence: ['UI_TEXT', 'LAB_SNAPSHOT'], note: '', device: DEVICE,
    }).ok).toBe(true);
    expect(collector.all()).toHaveLength(1);
    expect(collector.summary().passed).toBe(1);
    expect(collector.summary().phoneValidated).toBe(false);   // 1/15
  });

  it('aynı senaryonun yeni koşumu eskisini DEĞİŞTİRİR', () => {
    const collector = new ValidationEvidenceCollector();
    collector.record({ scenarioId: 'P1', result: 'FAIL', evidence: [], note: 'ilk' });
    collector.record({ scenarioId: 'P1', result: 'FAIL', evidence: [], note: 'ikinci' });
    expect(collector.all()).toHaveLength(1);
    expect(collector.all()[0].note).toBe('ikinci');
  });

  it('toplayıcı BOUNDED — sınırsız büyümez', () => {
    const collector = new ValidationEvidenceCollector();
    for (let i = 0; i < MAX_SCENARIO_RUNS + 50; i++) {
      collector.record({ scenarioId: 'P1', result: 'FAIL', evidence: [], note: `n${i}` });
    }
    expect(collector.all().length).toBeLessThanOrEqual(MAX_SCENARIO_RUNS);
  });
});

/* ── 4d. LAB EXPORT REDAKSİYONU ────────────────────────────────────────── */

describe('telefon doğrulama · LAB export', () => {
  const runs: ScenarioRun[] = [{
    scenarioId: 'P1', result: 'PASS',
    evidence: ['UI_TEXT', 'LAB_SNAPSHOT'],
    note: 'kullanıcı ahmet@example.com ile test edildi',
    device: { model: 'Xiaomi 22101316G', androidVersion: '13', appBuild: 'local-abc' },
    evidenceRef: 'C:/Users/selim/Desktop/ekran1.png',
    completedAt: 1000,
  }];

  it('🔴 LAB export PII ve dosya yolu TAŞIMAZ', () => {
    const exported = toLabExport(runs);
    const json = JSON.stringify(exported);
    expect(json).not.toMatch(/@example\.com|ahmet|ekran1\.png|Users|Xiaomi|22101316G/);
  });

  it('yalnız sayım ve derleme kimliği taşır', () => {
    const exported = toLabExport(runs);
    expect(exported.lastBuild).toBe('local-abc');
    expect(exported.passed).toBe(1);
    expect(exported.evidenceComplete).toBe(1);
    expect(exported.phoneValidated).toBe(false);
  });

  it('koşum yoksa lastBuild NULL — sahte derleme uydurulmaz', () => {
    const exported = toLabExport([]);
    expect(exported.lastBuild).toBeNull();
    expect(exported.notRun).toBe(15);
    expect(exported.phoneValidated).toBe(false);
  });

  it('kanıtsız PASS evidenceComplete sayımına GİRMEZ', () => {
    const exported = toLabExport([
      { scenarioId: 'P1', result: 'PASS', evidence: [], note: '' },
    ]);
    expect(exported.evidenceComplete).toBe(0);
    expect(exported.passed).toBe(0);
  });
});

/* ── 5. GİZLİLİK ───────────────────────────────────────────────────────── */

describe('telefon doğrulama · gizlilik', () => {
  it('P14 LAB gizlilik yasaklarını açıkça listeler', () => {
    const p14 = findScenario('P14');
    expect(p14).not.toBeNull();
    const banned = p14!.prohibitedEvents.join(' ');
    for (const term of ['E-posta', 'Eşleştirme kodu', 'konum', 'payload']) {
      expect(banned).toContain(term);
    }
  });

  it('senaryo metinleri gerçek kimlik/sır içermez', () => {
    const all = JSON.stringify(PHONE_SCENARIOS);
    expect(all).not.toMatch(/@gmail|@test\.com|eyJ[A-Za-z0-9]|sk-[A-Za-z0-9]/);
  });
});
