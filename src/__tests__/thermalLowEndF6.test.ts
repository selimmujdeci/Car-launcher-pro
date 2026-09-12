/**
 * ARCH-06/F6 — TERMAL + DÜŞÜK-UÇ + ARKA PLAN · KİLİT TESTLERİ.
 *
 * Bu dosya iki şeyi korur:
 *  (1) L7 projeksiyonunun SAFLIĞI ve DETERMİNİZMİ,
 *  (2) "asla kısılmaz" listesinin YAPISAL korunması.
 *
 * ⚠️ Bu kilitler sayı ölçmez — F6'da ölçülmüş ms/FPS/°C İDDİASI YOKTUR.
 *    Korunan şey SÖZLEŞMEDİR: sıra · monotonluk · çelişkisizlik · dürüstlük.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  projectWorkloadCeilings, readDegradationInputs, getWorkloadCeilings,
  getHysteresisContract, getObservedTierEvidence, workloadOrder,
  ceilingFor, HYSTERESIS_CALIBRATION,
  type DegradationInputs, type WorkloadId, type WorkloadCeiling,
} from '../platform/perf/workloadCeilings';
import { memoryTrimLadder } from '../platform/memoryWatchdog';
import { getPerformanceDiagnosticsSnapshot } from '../platform/perf/performanceAggregator';

const CEILINGS = readFileSync('src/platform/perf/workloadCeilings.ts', 'utf8');
const COMMUNITY = readFileSync('src/platform/communityService.ts', 'utf8');
const DEVICE = readFileSync('src/platform/deviceCapabilities.ts', 'utf8');

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const BASE: DegradationInputs = Object.freeze({
  runtimeMode: 'BALANCED',
  thermalLevel: 0,
  memoryLevel: 'NORMAL',
  deviceTier: 'high',
  workerSaturation: null,
  workerLifecycle: null,
});

function withInputs(patch: Partial<DegradationInputs>): DegradationInputs {
  return Object.freeze({ ...BASE, ...patch }) as DegradationInputs;
}

const RANK: Readonly<Record<WorkloadCeiling, number>> =
  { FULL: 0, REDUCED: 1, MINIMAL: 2, OFF: 3 };

/* ═══════════════════════════════════════════════════════════════════════════
   A) SAFLIK — L7 karar verir, iş YAPMAZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/A · L7 saf projeksiyondur', () => {
  it('A1 · zamanlayıcı/rAF/abonelik KURMAZ', () => {
    const code = codeOnly(CEILINGS);
    expect(code).not.toMatch(/\bsetInterval\s*\(/);
    expect(code).not.toMatch(/\bsetTimeout\s*\(/);
    expect(code).not.toMatch(/requestAnimationFrame\s*\(/);
    expect(code).not.toMatch(/requestIdleCallback\s*\(/);
    expect(code).not.toMatch(/addEventListener\s*\(/);
  });

  it('A2 · I/O veya duvar saati KULLANMAZ (determinizm şartı)', () => {
    const code = codeOnly(CEILINGS);
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/localStorage/);
    expect(code).not.toMatch(/safeStorage/);
  });

  it('A3 · İKİNCİ OTORİTE değildir — hiçbir sahibin durumunu yazmaz', () => {
    const code = codeOnly(CEILINGS);
    expect(code).not.toMatch(/setMode\s*\(/);
    expect(code).not.toMatch(/setPowerCeiling\s*\(/);
    expect(code).not.toMatch(/applyTrimLevel|setMemoryLevel/);
    expect(code).not.toMatch(/startThermalWatchdog|injectDeviceTemp/);
  });

  it('A4 · termal baskı bir ARIZA DEĞİLDİR — reportFailure çağırmaz', () => {
    expect(codeOnly(CEILINGS)).not.toMatch(/reportFailure/);
  });

  it('A5 · aynı girdi → aynı çıktı (yan etkisiz)', () => {
    const inp = withInputs({ thermalLevel: 2, memoryLevel: 'TRIM_PREFETCH', deviceTier: 'low' });
    const a = projectWorkloadCeilings(inp).ceilings;
    const b = projectWorkloadCeilings(inp).ceilings;
    expect(a).toEqual(b);
  });

  it('A6 · çıktı DONDURULMUŞ — tüketici tavanı değiştiremez', () => {
    const p = projectWorkloadCeilings(BASE);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.ceilings)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) ASLA KISILMAYANLAR — yapısal koruma
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/B · korunan alanlar bir iş yükü olarak TANIMLI DEĞİL', () => {
  /* Koruma bir `if` koşuluna değil, LİSTEDE BULUNMAMAYA dayanır: tavanı
     olmayan şey kısılamaz (F5'teki NON_EVICTABLE_TRUTH deseniyle aynı). */
  const FORBIDDEN = [
    'vehicleTruth', 'vehicleSignal', 'obdPolling', 'canStream',
    'touch', 'touchResponse', 'input',
    'navigationGuidance', 'guidance', 'reroute',
    'audio', 'audioPlayback', 'media',
    'criticalAlert', 'alert', 'safety',
    'command', 'commandExecution',
    'security', 'authorization', 'securityGate',
  ];

  it('B1 · korunan hiçbir alan WorkloadId sözlüğünde YOK', () => {
    const ids = workloadOrder() as readonly string[];
    for (const f of FORBIDDEN) {
      expect(ids, `korunan alan kısılabilir hâle getirilmiş: ${f}`).not.toContain(f);
    }
  });

  it('B2 · en ağır baskıda bile sözlük GENİŞLEMEZ (sinsi ekleme yasağı)', () => {
    const worst = projectWorkloadCeilings(withInputs({
      runtimeMode: 'SAFE_MODE', thermalLevel: 3,
      memoryLevel: 'CRITICAL_PROTECT', deviceTier: 'low',
    }));
    expect(Object.keys(worst.ceilings).sort()).toEqual([...workloadOrder()].sort());
  });

  it('B3 · gerçek çalışma zamanında da sözlük aynıdır', () => {
    const live = getWorkloadCeilings();
    expect(Object.keys(live.ceilings).sort()).toEqual([...workloadOrder()].sort());
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) FEDA SIRASI — F6 §2 ile birebir
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/C · degradasyon sırası sabittir', () => {
  it('C1 · sıra F6 §2 ile BİREBİR aynı', () => {
    const expected: WorkloadId[] = [
      'labSampling', 'telemetrySampling', 'prefetch', 'backgroundIndexing',
      'nonCriticalAnimations', 'mapDecoration', 'artworkQuality', 'maviVisualFx',
    ];
    expect(workloadOrder()).toEqual(expected);
  });

  it('C2 · LAB örneklemesi kullanıcı görselinden ÖNCE feda edilir', () => {
    const o = workloadOrder();
    expect(o.indexOf('labSampling')).toBeLessThan(o.indexOf('maviVisualFx'));
    expect(o.indexOf('labSampling')).toBeLessThan(o.indexOf('artworkQuality'));
    expect(o.indexOf('prefetch')).toBeLessThan(o.indexOf('mapDecoration'));
  });

  it('C3 · ilk baskı kademesi kullanıcının GÖRDÜĞÜ hiçbir şeyi kapatmaz', () => {
    /* L1 (~45°C) hafif bir uyarıdır: harita süsü, artwork ve Mavi FX
       DOKUNULMAZ kalır — erken görsel kayıp "bozuldu" olarak okunur. */
    const c = projectWorkloadCeilings(withInputs({ thermalLevel: 1 })).ceilings;
    expect(c.mapDecoration).toBe('FULL');
    expect(c.artworkQuality).toBe('FULL');
    expect(c.maviVisualFx).toBe('FULL');
    expect(c.labSampling).not.toBe('FULL');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) MONOTONLUK VE ÇELİŞKİSİZLİK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/D · daha çok baskı asla daha az kısıtlama üretmez', () => {
  it('D1 · termal seviye artarken hiçbir tavan GEVŞEMEZ', () => {
    const levels: Array<0 | 1 | 2 | 3> = [0, 1, 2, 3];
    let prev: Record<WorkloadId, WorkloadCeiling> | null = null;
    for (const lvl of levels) {
      const c = projectWorkloadCeilings(withInputs({ thermalLevel: lvl })).ceilings;
      if (prev !== null) {
        for (const id of workloadOrder()) {
          expect(RANK[c[id]], `termal ${lvl} · ${id} gevşedi`)
            .toBeGreaterThanOrEqual(RANK[prev[id]]);
        }
      }
      prev = { ...c };
    }
  });

  it('D2 · bellek kademesi yükselirken hiçbir tavan GEVŞEMEZ', () => {
    let prev: Record<WorkloadId, WorkloadCeiling> | null = null;
    for (const lvl of memoryTrimLadder()) {
      const c = projectWorkloadCeilings(withInputs({ memoryLevel: lvl })).ceilings;
      if (prev !== null) {
        for (const id of workloadOrder()) {
          expect(RANK[c[id]], `bellek ${lvl} · ${id} gevşedi`)
            .toBeGreaterThanOrEqual(RANK[prev[id]]);
        }
      }
      prev = { ...c };
    }
  });

  it('D3 · iki kaynak çelişirse EN KISITLAYICI kazanır', () => {
    /* Termal L3 prefetch'i OFF yapar; bellek NORMAL onu FULL bırakırdı.
       Birleşimde OFF kazanmalı — yoksa iki tablo birbirini ezerdi. */
    const c = projectWorkloadCeilings(withInputs({
      thermalLevel: 3, memoryLevel: 'NORMAL',
    })).ceilings;
    expect(c.prefetch).toBe('OFF');

    const c2 = projectWorkloadCeilings(withInputs({
      thermalLevel: 0, memoryLevel: 'CRITICAL_PROTECT',
    })).ceilings;
    expect(c2.prefetch).toBe('OFF');
  });

  it('D4 · birleşim, tek tek kaynakların en kısıtlayıcısından gevşek OLAMAZ', () => {
    const both = projectWorkloadCeilings(withInputs({
      thermalLevel: 2, memoryLevel: 'PAUSE_BACKGROUND', deviceTier: 'low',
    })).ceilings;
    const onlyThermal = projectWorkloadCeilings(withInputs({ thermalLevel: 2 })).ceilings;
    const onlyMemory = projectWorkloadCeilings(withInputs({ memoryLevel: 'PAUSE_BACKGROUND' })).ceilings;
    const onlyTier = projectWorkloadCeilings(withInputs({ deviceTier: 'low' })).ceilings;
    for (const id of workloadOrder()) {
      const maxSingle = Math.max(RANK[onlyThermal[id]], RANK[onlyMemory[id]], RANK[onlyTier[id]]);
      expect(RANK[both[id]], `${id} birleşimde gevşedi`).toBeGreaterThanOrEqual(maxSingle);
    }
  });

  it('D5 · baskısız durumda HİÇBİR ŞEY kısılmaz', () => {
    const c = projectWorkloadCeilings(BASE).ceilings;
    for (const id of workloadOrder()) expect(c[id]).toBe('FULL');
    expect(projectWorkloadCeilings(BASE).dominantSource).toBe('NONE');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) F5 BELLEK MERDİVENİYLE ÇAKIŞMA YOK
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/E · bellek baskısı bir GİRDİDİR, ikinci otorite değil', () => {
  it('E1 · F5 merdivenindeki HER kademe L7 tablosunda karşılanır', () => {
    /* Kör guard yasağı: F5 yeni bir kademe eklerse burası SESSİZCE
       geçmemeli — eksik kademe hemen görünür olmalı. */
    for (const lvl of memoryTrimLadder()) {
      expect(() => projectWorkloadCeilings(withInputs({ memoryLevel: lvl }))).not.toThrow();
    }
    expect(memoryTrimLadder().length).toBeGreaterThan(1);
  });

  it('E2 · L7 kendi bellek eşiğini/merdivenini KURMAZ', () => {
    const code = codeOnly(CEILINGS);
    expect(code).not.toMatch(/usedJSHeapSize|jsHeapSizeLimit|performance\.memory/);
    expect(code).not.toMatch(/registerMemoryParticipant|registerCachePurge/);
  });

  it('E3 · en ağır bellek kademesi LAB örneklemesini kapatır, aracı değil', () => {
    const c = projectWorkloadCeilings(withInputs({ memoryLevel: 'CRITICAL_PROTECT' })).ceilings;
    expect(c.labSampling).toBe('OFF');
    expect(Object.keys(c)).not.toContain('vehicleTruth');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) CİHAZ SINIFI — otorite deviceCapabilities'te KALIR
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/F · cihaz sınıfı otoritesi taşınmadı', () => {
  it('F1 · L7 kendi tier tespitini YAPMAZ (SKU/model listesi yok)', () => {
    const code = codeOnly(CEILINGS);
    expect(code).not.toMatch(/navigator\.(userAgent|hardwareConcurrency|deviceMemory)/);
    expect(code).not.toMatch(/UNMASKED_RENDERER/);
  });

  it('F2 · BİLİNMEYEN cihaz MID sayılır — LOW varsayılmaz', () => {
    /* `getDeviceTier()` hiçbir zaman UNKNOWN dönmez: sınıflandırılamayan
       cihaz `else` dalında MID'e düşer. Bilinmeyeni LOW saymak, güçlü ama
       tanınmayan bir head unit'i kalıcı olarak sakatlardı. */
    const code = codeOnly(DEVICE);
    const fn = code.slice(code.indexOf('export function getDeviceTier'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/else\s*\{\s*_tier\s*=\s*''/);
    expect(body).not.toMatch(/UNKNOWN/);
  });

  it('F3 · MID sınıf, LOW sınıftan daha az kısıtlanır', () => {
    const mid = projectWorkloadCeilings(withInputs({ deviceTier: 'mid' })).ceilings;
    const low = projectWorkloadCeilings(withInputs({ deviceTier: 'low' })).ceilings;
    let strictlyLooser = 0;
    for (const id of workloadOrder()) {
      expect(RANK[mid[id]]).toBeLessThanOrEqual(RANK[low[id]]);
      if (RANK[mid[id]] < RANK[low[id]]) strictlyLooser += 1;
    }
    expect(strictlyLooser).toBeGreaterThan(0);
  });

  it('F4 · HIGH sınıf tek başına hiçbir şeyi kısmaz', () => {
    const c = projectWorkloadCeilings(withInputs({ deviceTier: 'high' })).ceilings;
    for (const id of workloadOrder()) expect(c[id]).toBe('FULL');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) HİSTEREZİS — kalibre edilmemiş, uydurulmamış
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/G · histerezis sözleşmesi', () => {
  it('G1 · kalibrasyon yokken eşik SAYISI YAZILMAZ (null kalır)', () => {
    const h = getHysteresisContract();
    expect(h.calibration).toBe('UNCALIBRATED');
    expect(h.downgradeConsecutiveSamples).toBeNull();
    expect(h.upgradeConsecutiveSamples).toBeNull();
    expect(h.cooldownSamples).toBeNull();
  });

  it('G2 · ASİMETRİ kalibrasyondan bağımsız olarak korunur', () => {
    /* Düşürmek ucuz ve geri alınabilir; yükseltmek kasmayı geri getirir.
       Bu oran sözleşmenin parçasıdır — 1 olursa salınım başlar. */
    expect(getHysteresisContract().upgradeStrictnessFactor).toBeGreaterThan(1);
  });

  it('G3 · gözlenen sınıf UNCALIBRATED iken TÜRETİLMEZ', () => {
    const ev = getObservedTierEvidence();
    expect(HYSTERESIS_CALIBRATION).toBe('UNCALIBRATED');
    expect(ev.observedTier).toBeNull();
    expect(ev.mismatch).toBe(false);
    expect(ev.reason).toMatch(/KAL[İI]BRE ED[İI]LMED[İI]/i);
  });

  it('G4 · observedTier staticTier’ı OTOMATİK DEĞİŞTİRMEZ', () => {
    const code = codeOnly(CEILINGS);
    expect(code).not.toMatch(/_tier\s*=/);
    expect(code).not.toMatch(/setDeviceTier|overrideTier/);
  });

  it('G5 · histerezis için YENİ ZAMANLAYICI kurulmaz (mevcut tik kullanılır)', () => {
    const code = codeOnly(CEILINGS);
    expect(code).not.toMatch(/scheduleTask\s*\(/);
    expect(code).toMatch(/getPerfSeriesSnapshot/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   H) DÜRÜSTLÜK — ölçülmeyen sinyal uydurulmaz
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/H · ölçülmeyen girdi UNKNOWN kalır', () => {
  it('H1 · worker DOYGUNLUĞU ölçülmüyor → daima null', () => {
    /* "Hepsi active → doygun" sahte bir sinyaldir: sağlıklı sistemde de
       hepsi active'tir. Yaşam döngüsü sayısı KANIT olarak durur. */
    expect(readDegradationInputs().workerSaturation).toBeNull();
  });

  it('H2 · worker yaşam döngüsü sayıları KARARA girmez', () => {
    const withWorkers = projectWorkloadCeilings(withInputs({
      workerLifecycle: { total: 4, active: 4 },
    })).ceilings;
    expect(withWorkers).toEqual(projectWorkloadCeilings(BASE).ceilings);
  });

  it('H3 · okunamayan sahip 0 değil null üretir (fail-soft)', () => {
    const c = projectWorkloadCeilings(withInputs({
      runtimeMode: null, thermalLevel: null, memoryLevel: null, deviceTier: null,
    }));
    expect(c.dominantSource).toBe('NONE');
    for (const id of workloadOrder()) expect(c.ceilings[id]).toBe('FULL');
  });

  it('H4 · gerçek okuma çökmeden çalışır ve donmuş girdi döner', () => {
    const inp = readDegradationInputs();
    expect(Object.isFrozen(inp)).toBe(true);
    expect(['low', 'mid', 'high', null]).toContain(inp.deviceTier);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   I) GERÇEK TÜKETİCİ — tavan okunur, iş kısılır
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/I · arka plan işi tavana bağlı', () => {
  it('I1 · topluluk BULUT ÇEKİMİ tavanı okur', () => {
    const code = codeOnly(COMMUNITY);
    const pull = code.slice(code.indexOf('function _idlePull'));
    expect(pull.slice(0, 900)).toMatch(/ceilingFor\s*\(/);
  });

  it('I2 · GİDEN kullanıcı kuyruğu KISILMAZ (veri kaybı yasağı)', () => {
    /* `_idleSync` kullanıcının kendi bildirimlerini taşır; atlanması
       geri getirilemez kayıptır. Tavan yalnız yeniden üretilebilir
       GELEN zenginleştirmeye uygulanır. */
    const code = codeOnly(COMMUNITY);
    const start = code.indexOf('function _idleSync');
    expect(start, '_idleSync kayboldu — kilit körleşti').toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf('\n}', start) + 2);
    expect(body).not.toMatch(/ceilingFor/);
  });

  it('I3 · ceilingFor fail-soft: okunamazsa FULL döner (ölçüm hatası ürünü sakatlamaz)', () => {
    expect(['FULL', 'REDUCED', 'MINIMAL', 'OFF']).toContain(ceilingFor('backgroundIndexing'));
    expect(codeOnly(CEILINGS))
      .toMatch(/return safe\(\(\) => getWorkloadCeilings\(\)\.ceilings\[id\], ''\);/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   J) LAB GÖZLEMLENEBİLİRLİĞİ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ARCH-06/F6/J · LAB kanıtı', () => {
  it('J1 · toplayıcı workload_ceilings bölümünü yayar', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'workload_ceilings');
    expect(sec, 'workload_ceilings bölümü kayıp — kilit körleşti').toBeDefined();
    expect(sec!.metrics.length).toBeGreaterThan(workloadOrder().length);
  });

  it('J2 · her iş yükü için bir satır vardır', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'workload_ceilings')!;
    const names = sec.metrics.map((m) => m.name);
    for (const id of workloadOrder()) expect(names).toContain(`ceiling.${id}`);
  });

  it('J3 · ölçülmeyen alanlar UNMEASURED olarak işaretlenir (sahte 0 yok)', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'workload_ceilings')!;
    const sat = sec.metrics.find((m) => m.name === 'ceiling.workerSaturation');
    expect(sat?.kind).toBe('UNMEASURED');
    expect(sat?.value).toBeNull();
    expect(sec.metrics.find((m) => m.name === 'ceiling.observedTier')?.kind).toBe('UNMEASURED');
  });

  it('J4 · LAB’a cihaz MODELİ / SKU / PII taşınmaz', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'workload_ceilings')!;
    const blob = JSON.stringify(sec);
    expect(blob).not.toMatch(/userAgent|Mozilla|SM-|Mali-|Snapdragon/i);
    expect(blob).not.toMatch(/[A-HJ-NPR-Z0-9]{17}/);
  });

  it('J5 · LAB ikinci otorite değil — bölüm kendi hükmünü üretmez', () => {
    const snap = getPerformanceDiagnosticsSnapshot();
    const sec = snap.sections.find((s) => s.sectionId === 'workload_ceilings')!;
    const blob = JSON.stringify(sec.notes);
    expect(blob).toMatch(/UYGULANMAZ/);
    expect(blob).not.toMatch(/sa[ğg]l[ıi]kl[ıi]|healthy|regresyon/i);
  });
});
