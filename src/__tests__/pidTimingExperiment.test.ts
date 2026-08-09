/**
 * pidTimingExperiment.test.ts — H-A deneyi analiz kilitleri (kütük #518-HA).
 *
 * Deney: aynı bağlantıda A (mevcut ATST ~200 ms) ve B (ATST uzatılmış) aşaması.
 * Bu testler ANALİZİ kilitler — hipotezi doğru VARSAYMAZ: "ATST kök DEĞİL"
 * sonucu da ayrıca kilitlenir, yoksa araç yalnız beklediğimizi söyler.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import {
  buildPidTimingReport, RESCUE_MIN_DROP, MIN_SAMPLES_PER_PHASE, VERDICT_MIN_DROP,
  EXPERIMENT_VERDICT_LABEL, PID_VERDICT_LABEL,
  type PidTimingSample, type PidTimingRaw,
} from '../platform/obd/pidTimingExperimentModel';

/** n örnek üretir: `okCount` tanesi OK (süre `okMs`), kalanı NO_DATA (süre `ndMs`). */
function mk(phase: 'A' | 'B', pid: string, n: number, okCount: number,
            okMs = 60, ndMs = 210): PidTimingSample[] {
  return Array.from({ length: n }, (_, i) => ({
    phase, pid,
    outcome: i < okCount ? 'OK' : 'NO_DATA',
    elapsedMs: i < okCount ? okMs : ndMs,
    respLen: i < okCount ? 12 : 8,
  }));
}

function raw(samples: PidTimingSample[], stB = 'FF'): PidTimingRaw {
  return {
    status: 'done',
    phases: [
      { phase: 'A', stApplied: 'default', stCommandOk: true, startedAt: 1000, finishedAt: 21000 },
      { phase: 'B', stApplied: stB, stCommandOk: true, startedAt: 22000, finishedAt: 70000 },
    ],
    samples,
  };
}

describe('temel istatistik', () => {
  it('🔒 örnek yokken yüzdelik NULL — sahte 0 üretilmez', () => {
    const r = buildPidTimingReport(raw([]));
    expect(r.totals[0].noDataRate).toBeNull();
    expect(r.totals[0].successMs.p50).toBeNull();
    expect(r.totals[0].noDataMs.max).toBeNull();
    expect(r.verdict).toBe('OLCUM_YOK');
  });

  it('🔒 NO_DATA oranı ve süre yüzdelikleri PID başına hesaplanır', () => {
    const r = buildPidTimingReport(raw([
      ...mk('A', '23', 20, 10, 55, 205),
      ...mk('B', '23', 20, 18, 380, 1010),
    ]));
    const t = r.target23!;
    expect(t.a!.noDataRate).toBeCloseTo(0.5, 6);
    expect(t.b!.noDataRate).toBeCloseTo(0.1, 6);
    expect(t.a!.noDataMs.p50).toBe(205);
    expect(t.b!.successMs.p50).toBe(380);
  });

  it('🔒 yüzdelik İNTERPOLASYONSUZ (en yakın sıra) — sahte hassasiyet yok', () => {
    const samples: PidTimingSample[] = [10, 20, 30, 40].map((ms) => ({
      phase: 'A' as const, pid: '0C', outcome: 'OK', elapsedMs: ms, respLen: 4,
    }));
    const r = buildPidTimingReport(raw(samples));
    /* p50 → ceil(0.5×4)=2 → 2. eleman = 20 (interpolasyonlu olsaydı 25 olurdu). */
    expect(r.totals[0].successMs.p50).toBe(20);
    expect(r.totals[0].successMs.max).toBe(40);
  });
});

describe('0x23 ayrı raporlanır (deneyin somut hedefi)', () => {
  it('🔒 target23 dolu gelir ve kendi hükmünü taşır', () => {
    const r = buildPidTimingReport(raw([
      ...mk('A', '23', 20, 4),
      ...mk('B', '23', 20, 19),
      ...mk('A', '0C', 20, 20),
      ...mk('B', '0C', 20, 20),
    ]));
    expect(r.target23).not.toBeNull();
    expect(r.target23!.pid).toBe('23');
    expect(r.target23!.verdict).toBe('SURE_ILE_KURTULDU');
  });

  it('🔒 0x23 hiç ölçülmediyse target23 NULL — uydurulmaz', () => {
    const r = buildPidTimingReport(raw([...mk('A', '0C', 20, 20), ...mk('B', '0C', 20, 20)]));
    expect(r.target23).toBeNull();
  });
});

describe('PID başına hüküm', () => {
  it('🔒 A\'da kayıp yoksa ZATEN_SAGLAM', () => {
    const r = buildPidTimingReport(raw([...mk('A', '0C', 20, 20), ...mk('B', '0C', 20, 20)]));
    expect(r.perPid[0].verdict).toBe('ZATEN_SAGLAM');
  });

  it('🔒 eşik altı düşüş DEGISMEDI sayılır (gürültü kurtuluş değildir)', () => {
    const r = buildPidTimingReport(raw([
      ...mk('A', '2C', 20, 10),                    // %50 kayıp
      ...mk('B', '2C', 20, 13),                    // %35 kayıp → 0.15 düşüş < eşik
    ]));
    expect(RESCUE_MIN_DROP).toBe(0.30);
    expect(r.perPid[0].verdict).toBe('DEGISMEDI');
  });

  it('🔒 B\'de kayıp ARTARSA kötüleşti denir (sessizce yutulmaz)', () => {
    const r = buildPidTimingReport(raw([...mk('A', '33', 20, 18), ...mk('B', '33', 20, 4)]));
    expect(r.perPid[0].verdict).toBe('KOTULESTI');
  });

  it('🔒 tek aşama varsa PID hükmü VERİLMEZ', () => {
    const r = buildPidTimingReport(raw(mk('A', '49', 20, 10)));
    expect(r.perPid[0].verdict).toBe('ELCILMEDI');
    expect(r.perPid[0].noDataRateDelta).toBeNull();
  });
});

describe('deney hükmü — her iki yön de kilitli', () => {
  it('🔒 kayıp belirgin düşerse ATST_KOKTU (H-A doğrulanır)', () => {
    const r = buildPidTimingReport(raw([
      ...mk('A', '23', 20, 8), ...mk('A', '2C', 20, 10),
      ...mk('B', '23', 20, 19), ...mk('B', '2C', 20, 18),
    ]));
    expect(r.verdict).toBe('ATST_KOKTU');
    expect(r.verdictNote).toMatch(/NO_DATA oranı/);
  });

  it('🔒 kayıp değişmezse ATST_KOK_DEGIL (hipotez ÇÜRÜR)', () => {
    const r = buildPidTimingReport(raw([
      ...mk('A', '23', 20, 10), ...mk('A', '2C', 20, 10),
      ...mk('B', '23', 20, 11), ...mk('B', '2C', 20, 9),
    ]));
    expect(r.verdict, 'araç yalnız beklediğimizi söylüyor').toBe('ATST_KOK_DEGIL');
    expect(r.verdictNote).toMatch(/kök BAŞKA yerde/);
  });

  it('🔒 az örnekte hüküm VERİLMEZ', () => {
    const r = buildPidTimingReport(raw([...mk('A', '23', 5, 2), ...mk('B', '23', 5, 5)]));
    expect(MIN_SAMPLES_PER_PHASE).toBe(20);
    expect(r.verdict).toBe('EKSIK_ASAMA');
  });

  it('🔒 kötüleşme BELIRSIZ sayılır — "iyileşti" diye sunulmaz', () => {
    const r = buildPidTimingReport(raw([
      ...mk('A', '23', 20, 18), ...mk('A', '2C', 20, 18),
      ...mk('B', '23', 20, 4),  ...mk('B', '2C', 20, 4),
    ]));
    expect(r.verdict).toBe('BELIRSIZ');
  });

  it('🔒 eşik sabitleri isimli ve makul', () => {
    expect(VERDICT_MIN_DROP).toBe(0.20);
    expect(RESCUE_MIN_DROP).toBeGreaterThan(VERDICT_MIN_DROP);
  });
});

describe('sözleşme bütünlüğü', () => {
  it('🔒 aşama toplam süresi meta\'dan gelir, yoksa NULL', () => {
    const r = buildPidTimingReport(raw(mk('A', '23', 20, 10)));
    expect(r.totals[0].wallMs).toBe(20000);
    const noMeta = buildPidTimingReport({ status: 'done', phases: [], samples: mk('A', '23', 20, 10) });
    expect(noMeta.totals[0].wallMs).toBeNull();
    expect(noMeta.totals[0].stApplied).toBe('UNKNOWN');
  });

  it('🔒 her hükmün etiketi var (sessiz boşluk yok)', () => {
    for (const [k, v] of Object.entries(EXPERIMENT_VERDICT_LABEL)) {
      expect(v.length, `${k} etiketsiz`).toBeGreaterThan(0);
    }
    for (const [k, v] of Object.entries(PID_VERDICT_LABEL)) {
      expect(v.length, `${k} etiketsiz`).toBeGreaterThan(0);
    }
  });

  it('🔒 SAF — aynı girdi aynı rapor, girdi mutasyona uğramaz', () => {
    const input = raw([...mk('A', '23', 20, 8), ...mk('B', '23', 20, 19)]);
    const copy = JSON.stringify(input);
    const a = buildPidTimingReport(input);
    const b = buildPidTimingReport(input);
    expect(JSON.stringify(input)).toBe(copy);
    expect(a).toEqual(b);
  });

  it('🔒 null/bozuk girdi ÇÖKERTMEZ', () => {
    expect(buildPidTimingReport(null).verdict).toBe('OLCUM_YOK');
    expect(buildPidTimingReport(undefined).status).toBe('idle');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LAB KİLİTLERİ — bu ekran LAB'ın BİLİNÇLİ istisnası; sınırları kilitlenir
 * ════════════════════════════════════════════════════════════════════════ */
describe('LAB · H-A deneyi ekranı', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  const SCREEN = 'src/components/devtools/screens/PidTimingExperimentScreen.tsx';

  it('🔒 katalogda AVAILABLE ve İSTİSNA olduğu AÇIKÇA yazılı', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'pid-timing-experiment');
    expect(tool, 'katalogda pid-timing-experiment yok').toBeDefined();
    expect(tool!.status).toBe('AVAILABLE');
    expect(tool!.category, 'ölçüm aracı developer kategorisinde olmalı').toBe('developer');
    expect(tool!.note, 'salt-okunur olmadığı gizlenmiş').toMatch(/SALT-OKUNUR DEĞİL/);
    expect(tool!.note).toMatch(/SORGU GÖNDERİR/);
    expect(tool!.note, 'ayarın geri alındığı yazılmamış').toMatch(/GERİ ALINIR/);
    expect(tool!.note, 'eleme öğrenmesinin beslenmediği yazılmamış').toMatch(/BESLENMEZ/);
  });

  it('🔒 ekran haritası lazy bağlar', () => {
    const map = read('src/components/devtools/carosLabScreenMap.tsx');
    expect(map).toMatch(/case 'pid-timing-experiment':/);
    expect(map).toMatch(/import\('\.\/screens\/PidTimingExperimentScreen'\)/);
  });

  it('🔒 AÇILIŞTA komut göndermez — yalnız okuma', () => {
    const src = read(SCREEN);
    /* useEffect içinde YALNIZ refresh çağrılır; start/abort orada OLMAMALI. */
    const effect = src.slice(src.indexOf('useEffect(() => {'), src.indexOf('}, [refresh]);'));
    expect(effect).toMatch(/void refresh\(\)/);
    expect(effect, 'açılışta deney başlatılıyor').not.toMatch(/startPidTimingExperiment/);
  });

  it('🔒 yazma/silme yolu YOK (yalnız Mode-01 okuma)', () => {
    const code = read(SCREEN).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [/clearDTC/, /writeActiveRoute/, /setObdCorePids/, /fetch\(/, /setInterval/]) {
      expect(code, `ekran yasak çağrı içeriyor: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it('🔒 varsayılan PID listesi UYDURULMAZ', () => {
    const src = read(SCREEN);
    expect(src).toMatch(/getWatchedExtendedPids\(\)/);
    expect(src, 'liste boşken sessizce devam ediyor').toMatch(/UYDURULMAZ/);
  });

  it('🔒 native tarafta eleme öğrenmesi beslenmiyor ve ayar geri alınıyor', () => {
    const java = read('android/app/src/main/java/com/cockpitos/pro/obd/PidTimingExperiment.java');
    const code = java.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code, 'deney ürünün eleme öğrenmesini besliyor')
      .not.toMatch(/recordOutcome|extNoData/);
    expect(code, 'ATST geri alınmıyor').toMatch(/finally[\s\S]*applyStTimeout\(DEFAULT_ST_HEX\)/);
  });

  it('🔒 ham AT komutu arka kapısı AÇILMADI — yalnız ATST beyaz listesi', () => {
    const elm = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
    const fn = elm.slice(elm.indexOf('public String setResponseTimeout'));
    const body = fn.slice(0, fn.indexOf('\n    }'));
    expect(body, 'parametre hex ile sınırlanmamış').toMatch(/matches\("\[0-9A-F\]\{2\}"\)/);
    expect(body, 'komut dışarıdan geliyor — arka kapı').toMatch(/"ATST" \+ v/);
  });
});
