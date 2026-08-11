/**
 * carosLabGuardianRuntime.test.tsx — CAROS LAB · Guardian Runtime KİLİTLERİ.
 *
 * YAKLAŞIM (A3–A8 turlarıyla aynı): model TAMAMEN SAF → gerçek davranış servis
 * mock'u olmadan doğrulanır; ekran kilidi `renderToStaticMarkup` ile alınır.
 *
 * ANA İLKE: bu ekran YENİ OTORİTE DEĞİLDİR ve GUARDIAN TICK'İNE DOKUNMAZ.
 * Kilitler iki soruyu sorar: (1) uydurdu mu? (2) sızdırdı mı?
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildGuardianCards, deriveGuardianVerdict, countByGuardianClass,
  GUARDIAN_VERDICT_LABEL,
} from '../platform/devtools/guardianRuntimeModel';
import type { GuardianRuntimeRawSnapshot } from '../platform/devtools/guardianRuntimeSources';
import { GuardianRuntimeScreen } from '../components/devtools/screens/GuardianRuntimeScreen';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';
import { renderAvailableTool } from '../components/devtools/carosLabScreenMap';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const NOW = 1_700_000_000_000;

function snap(over: Partial<GuardianRuntimeRawSnapshot['runtime']> = {}): GuardianRuntimeRawSnapshot {
  return {
    readAt: NOW,
    coolantHighC: 100, coolantCriticalC: 105,
    batteryLowV: 12.0, batteryCriticalV: 11.8,
    runtime: {
      running: true,
      policyVersion: 'G16.1',
      taskId: 'guardian-ai',
      owner: 'ADAPTIVE_RUNTIME_WHEEL',
      criticality: 'NORMAL',
      deferIdle: false,
      mode: 'BASIC_JS',
      basePeriodMs: 1000,
      effectivePeriodMs: 1998,
      worstCaseLatencyMs: 6998,
      keepsUpWithObd: true,
      sources: [
        { id: 'gps',     wired: true,  reason: 'UnifiedVehicleStore hızı — hiçbir kurala girmiyor.' },
        { id: 'obd',     wired: true,  reason: 'getOBDDataSnapshot(): soğutucu + akü.' },
        { id: 'map',     wired: false, reason: 'Üretici YOK — şartlı kilit #508.' },
        { id: 'weather', wired: false, reason: 'Yalnız interface — veri + lisans (P7).' },
        { id: 'driver',  wired: false, reason: 'Yalnız interface — #509.' },
      ],
      wiredSourceCount: 2,
      tickCount: 120,
      lastTickAtWallMs: NOW - 800,
      lastTickAgeMs: 800,
      errorCount: 0,
      lastErrorKind: null,
      lastErrorStage: null,
      lastErrorAgeMs: null,
      evaluatedRuleCount: 1,
      riskEventCount: 1,
      highestSeverity: 'CRITICAL',
      overallRiskScore: 0.9,
      events: [{ id: 'coolant', type: 'VEHICLE_HEALTH_RISK', severity: 'CRITICAL', confidence: 0.9, distanceMeters: 0 }],
      lastOutputAtWallMs: NOW - 800,
      lastOutputAgeMs: 800,
      budgetMs: 8,
      hardLimitMs: 16,
      lastDurationMs: 0.004,
      maxDurationMs: 0.19,
      p50DurationMs: 0.005,
      p95DurationMs: 0.012,
      durationSampleCount: 64,
      overBudgetCount: 0,
      overHardLimitCount: 0,
      ...over,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 1 — kataloğa kayıtlı ve GERÇEK ekrana gidiyor
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 1 — Guardian Runtime kataloğa kayıtlı ve gerçek ekrana gidiyor', () => {
  it('katalogda AVAILABLE ve eşlemesi var', () => {
    const t = getCarosLabTool('guardian-runtime');
    expect(t).toBeDefined();
    expect(t!.status).toBe('AVAILABLE');
    expect(t!.category).toBe('runtime');
    expect(renderAvailableTool('guardian-runtime')).not.toBeNull();
  });

  it('katalog notu "hiçbir şey başlatmaz" beyanını ve kapsam sınırını taşır', () => {
    const t = getCarosLabTool('guardian-runtime')!;
    expect(t.note).toContain('BAŞLATMAZ');
    expect(t.note).toContain('vehicle-health');
    expect(t.note).toContain('#508');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 2 — ekran Guardian'a DOKUNMAZ
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 2 — ekran Guardian tick\'ine DOKUNMAZ', () => {
  const screen = read('src/components/devtools/screens/GuardianRuntimeScreen.tsx');
  const sources = read('src/platform/devtools/guardianRuntimeSources.ts');
  const model = read('src/platform/devtools/guardianRuntimeModel.ts');

  it('ekran ve okuma katmanı start/stop/tick TETİKLEMEZ', () => {
    for (const src of [screen, sources]) {
      expect(src).not.toMatch(/startGuardianRuntime\s*\(/);
      expect(src).not.toMatch(/stopGuardianRuntime\s*\(/);
      expect(src).not.toMatch(/_runGuardianTickOnceForTest/);
      expect(src).not.toMatch(/scheduleTask/);
    }
  });

  it('ekran timer/abonelik KURMAZ (periyodik yenileme yok)', () => {
    expect(screen).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    expect(screen).not.toMatch(/\.subscribe\(/);
    expect(screen).toContain('mountedRef');
  });

  it('model katmanı SAFtır — I/O · saat ÇAĞRISI · React YOK', () => {
    /* Alt-dize taraması YERİNE gerçek ÇAĞRI aranır: açıklama metninde
       "performance.now" GEÇEBİLİR, ama `performance.now(` ÇAĞRISI geçemez. */
    expect(model).not.toMatch(/Date\.now\s*\(/);
    expect(model).not.toMatch(/performance\.now\s*\(/);
    expect(model).not.toMatch(/from 'react'/);
    expect(model).not.toMatch(/fetch\s*\(/);
  });

  it('okuma katmanı ağa çıkmaz, timer kurmaz', () => {
    expect(sources).not.toMatch(/fetch\(|setInterval|setTimeout/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 3 — GİZLİLİK: koordinat ve serbest metin GELMEZ
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 3 — koordinat ve olay metni bu ekrana GELMEZ', () => {
  it('kartlarda enlem/boylam alanı YOKTUR', () => {
    const json = JSON.stringify(buildGuardianCards(snap()));
    expect(json).not.toMatch(/latitude|longitude|enlem|boylam/i);
  });

  it('okuma katmanı gpsService/koordinat import ETMEZ', () => {
    const sources = read('src/platform/devtools/guardianRuntimeSources.ts');
    expect(sources).not.toMatch(/gpsService|UnifiedVehicleStore/);
  });

  it('olay satırı yalnız tip · severity · güven · mesafe gösterir', () => {
    const cards = buildGuardianCards(snap());
    const f = cards.find((c) => c.id === 'output')!.fields.find((x) => x.id === 'event-coolant')!;
    expect(f.value).toBe('VEHICLE_HEALTH_RISK · CRITICAL · güven 0.90 · 0 m');
    expect(f.value).not.toMatch(/Soğutma sistemi uyarısı/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 4 — kanıtsız bilgi ÜRETİLMEZ (sahte 0 / sahte "sağlıklı" yok)
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 4 — kanıtsız bilgi üretilmez', () => {
  it('hiç koşum yokken süre alanları UNAVAILABLE olur, 0 YAZILMAZ', () => {
    const cards = buildGuardianCards(snap({
      tickCount: 0, lastTickAgeMs: null, lastDurationMs: null, maxDurationMs: null,
      p50DurationMs: null, p95DurationMs: null, durationSampleCount: 0,
      evaluatedRuleCount: null, riskEventCount: null, overallRiskScore: null,
      highestSeverity: null, lastOutputAgeMs: null, events: [],
    }));
    const budget = cards.find((c) => c.id === 'budget')!;
    for (const id of ['last-duration', 'p50', 'p95', 'max-duration']) {
      const f = budget.fields.find((x) => x.id === id)!;
      expect(f.klass).toBe('UNAVAILABLE');
      expect(f.value).toBe('—');
    }
    const output = cards.find((c) => c.id === 'output')!;
    expect(output.fields.find((x) => x.id === 'evaluated-rules')!.klass).toBe('UNAVAILABLE');
    expect(output.fields.find((x) => x.id === 'risk-events')!.klass).toBe('UNAVAILABLE');
  });

  it('mod okunamazsa etkin periyot ve gecikme TÜRETİLMEZ', () => {
    const cards = buildGuardianCards(snap({
      mode: null, effectivePeriodMs: null, worstCaseLatencyMs: null, keepsUpWithObd: null,
    }));
    const cadence = cards.find((c) => c.id === 'cadence')!;
    for (const id of ['mode', 'effective-period', 'worst-latency', 'keeps-up']) {
      expect(cadence.fields.find((x) => x.id === id)!.klass).toBe('UNAVAILABLE');
    }
  });

  it('"sürücüye sunuluyor mu" alanı DÜRÜSTÇE HAYIR der', () => {
    const output = buildGuardianCards(snap()).find((c) => c.id === 'output')!;
    expect(output.fields.find((x) => x.id === 'presentation')!.value).toContain('HAYIR');
  });

  it('bağlı olmayan kaynaklar "BAĞLI DEĞİL" + gerekçe ile görünür', () => {
    const sources = buildGuardianCards(snap()).find((c) => c.id === 'sources')!;
    expect(sources.fields.find((x) => x.id === 'source-map')!.value).toBe('BAĞLI DEĞİL');
    expect(sources.fields.find((x) => x.id === 'source-map')!.note).toContain('#508');
    expect(sources.fields.find((x) => x.id === 'wired-count')!.value).toBe('2 / 5');
  });

  it('eşik satırı kaynak otoritesini AÇIKÇA yazar (ikinci otorite yok)', () => {
    const budget = buildGuardianCards(snap()).find((c) => c.id === 'budget')!;
    const f = budget.fields.find((x) => x.id === 'thresholds')!;
    expect(f.value).toContain('100/105');
    expect(f.value).toContain('12/11.8');
    expect(f.note).toContain('VehicleCompute.worker');
    expect(f.note).toContain('BatteryProtectionService');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 5 — hüküm KANITA dayanır ve FAIL-CLOSED'dır
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 5 — hüküm kanıta dayanır', () => {
  it('görev kayıtlı değilse ÇALIŞMIYOR (en ağır hüküm)', () => {
    expect(deriveGuardianVerdict(snap({ running: false })).status).toBe('NOT_RUNNING');
  });

  it('kayıtlı ama hiç koşmadıysa "koştu" DENMEZ', () => {
    expect(deriveGuardianVerdict(snap({ tickCount: 0 })).status).toBe('NO_TICK_YET');
  });

  it('16 ms tavanı aşıldıysa her şeyin ÜSTÜNDE raporlanır', () => {
    const v = deriveGuardianVerdict(snap({ overHardLimitCount: 3, errorCount: 5, overBudgetCount: 9 }));
    expect(v.status).toBe('OVER_BUDGET');
    expect(v.reasons.join(' ')).toContain('#494');
  });

  it('hata varsa "bütçe içinde koşuyor" DENMEZ', () => {
    expect(deriveGuardianVerdict(snap({ errorCount: 2, lastErrorKind: 'RangeError', lastErrorStage: 'RULES' })).status)
      .toBe('ERRORING');
  });

  it('8 ms bütçesi aşıldıysa (tavan değil) ayrı sınıfta raporlanır', () => {
    expect(deriveGuardianVerdict(snap({ overBudgetCount: 4 })).status).toBe('NEAR_BUDGET');
  });

  it('koşuyor ama hiç kural çalışmıyorsa BU AÇIKÇA söylenir', () => {
    const v = deriveGuardianVerdict(snap({ evaluatedRuleCount: 0, riskEventCount: 0, highestSeverity: null }));
    expect(v.status).toBe('NO_INPUT');
    expect(GUARDIAN_VERDICT_LABEL.NO_INPUT).toContain('HİÇBİR KURAL');
  });

  it('sağlıklı durumda KOŞUYOR', () => {
    expect(deriveGuardianVerdict(snap()).status).toBe('RUNNING');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   KİLİT 6 — ekran render + sınıflandırma bütünlüğü
   ══════════════════════════════════════════════════════════════════════════ */
describe('KİLİT 6 — ekran render', () => {
  it('gerçek servis durumuyla (Guardian koşmuyorken) çökmeden render olur', () => {
    const html = renderToStaticMarkup(<GuardianRuntimeScreen />);
    expect(html).toContain('GUARDIAN RUNTIME');
    expect(html).toContain('SALT OKUNUR');
    expect(html).toContain('data-testid="guardian-runtime"');
  });

  it('kapsam sınırı ekranda AÇIKÇA yazılıdır', () => {
    const html = renderToStaticMarkup(<GuardianRuntimeScreen />);
    expect(html).toContain('vehicle-health');
    expect(html).toContain('#508');
    expect(html).toContain('#509');
  });

  it('kart sayacı tüm alanları sınıflandırır (sınıfsız alan yok)', () => {
    const cards = buildGuardianCards(snap());
    const counts = countByGuardianClass(cards);
    const total = cards.reduce((n, c) => n + c.fields.length, 0);
    expect(counts.OBSERVED + counts.DERIVED + counts.UNAVAILABLE + counts.STALE).toBe(total);
  });

  it('altı kart da üretilir ve hiçbiri boş değildir', () => {
    const cards = buildGuardianCards(snap());
    expect(cards.map((c) => c.id)).toEqual(
      ['ownership', 'cadence', 'sources', 'health', 'output', 'budget'],
    );
    for (const c of cards) expect(c.fields.length).toBeGreaterThan(0);
  });
});
