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
  buildPidTimingReport, RESCUE_MIN_DROP, MIN_SAMPLES_PER_PHASE, MIN_ROUNDS_PER_PHASE,
  VERDICT_MIN_DROP, ATST_APPLIED_MIN_RATIO,
  EXPERIMENT_VERDICT_LABEL, PID_VERDICT_LABEL,
  type PidTimingSample, type PidTimingRaw,
} from '../platform/obd/pidTimingExperimentModel';

/** n örnek üretir: `okCount` tanesi OK (süre `okMs`), kalanı NO_DATA (süre `ndMs`). */
/**
 * n örnek üretir. NO_DATA süresi AŞAMAYA göre varsayılan alır: B'de ~1010 ms
 * (ATST FF uygulanmış), A/A'de ~210 ms (ELM varsayılanı). Bu, B1'in bağımsız
 * kanıt kapısını gerçekçi kılar — sabit süre kullanılsaydı her kurgu
 * `ATST_UYGULANMADI`ya düşerdi (ve nitekim ilk yazımda düşüyordu).
 */
function mk(phase: 'A' | 'B' | 'A2', pid: string, n: number, okCount: number,
            okMs = 60, ndMs?: number): PidTimingSample[] {
  const nd = ndMs ?? (phase === 'B' ? 1010 : 210);
  return Array.from({ length: n }, (_, i) => ({
    phase, pid,
    outcome: i < okCount ? 'OK' : 'NO_DATA',
    elapsedMs: i < okCount ? okMs : nd,
    queueWaitMs: 5,
    respLen: i < okCount ? 12 : 8,
  }));
}

function raw(samples: PidTimingSample[], stB = 'FF'): PidTimingRaw {
  return {
    status: 'done',
    phases: [
      { phase: 'A',  stApplied: 'UNKNOWN', stCommandOk: true, startedAt: 1000,  finishedAt: 21000, sinceConnectMs: 5000,  readDeadlineMs: 1500 },
      { phase: 'B',  stApplied: stB,        stCommandOk: true, startedAt: 22000, finishedAt: 70000, sinceConnectMs: 26000, readDeadlineMs: 1620 },
      { phase: 'A2', stApplied: '32',       stCommandOk: true, startedAt: 71000, finishedAt: 91000, sinceConnectMs: 75000, readDeadlineMs: 1500 },
    ],
    samples,
    stRestored: 'true',
    experimentStartMs: 1000,
    experimentEndMs: 91000,
  };
}

/** Uc asamali tam kurgu: her asama icin (n, okCount). */
function trio(pid: string, a: [number, number], b: [number, number], a2: [number, number]) {
  return [
    ...mk('A',  pid, a[0],  a[1]),
    ...mk('B',  pid, b[0],  b[1]),
    ...mk('A2', pid, a2[0], a2[1]),
  ];
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
      ...trio('23', [20, 4], [20, 19], [20, 5]),
      ...trio('0C', [20, 20], [20, 20], [20, 20]),
    ]));
    expect(r.target23).not.toBeNull();
    expect(r.target23!.a2, 'kontrol aşaması taşınmıyor').not.toBeNull();
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
  it('🔒 A kötü · B iyi · A\' YİNE KÖTÜ → ATST_KOKTU (H-A kanıtlanır)', () => {
    const r = buildPidTimingReport(raw([
      ...trio('23', [20, 8], [20, 19], [20, 7]),
      ...trio('2C', [20, 10], [20, 18], [20, 9]),
    ]));
    expect(r.verdict).toBe('ATST_KOKTU');
    expect(r.verdictNote, 'geri alınca yükseldiği yazılmamış').toMatch(/GERİ ALININCA/);
  });

  it('🔒 A kötü · B iyi · A\' DE İYİ → ZAMAN_ETKISI (ATST katkısı belirsiz)', () => {
    /* Kullanıcının saha gözlemi: hat kendiliğinden oturuyor. Bu kurguda B'nin
       iyiliği ATST'den DEĞİL zamandan gelir — üçüncü aşama olmasa ATST_KOKTU
       denecekti ve YANLIŞ olacaktı. */
    const r = buildPidTimingReport(raw([
      ...trio('23', [20, 8], [20, 19], [20, 19]),
      ...trio('2C', [20, 10], [20, 18], [20, 18]),
    ]));
    expect(r.verdict).toBe('ZAMAN_ETKISI');
    expect(r.verdictNote).toMatch(/hattın kendiliğinden oturmasından/);
  });

  it('🔒 kontrol aşaması EKSİKSE hüküm VERİLMEZ — zaman/ATST ayrılamaz', () => {
    const r = buildPidTimingReport(raw([
      ...mk('A', '23', 20, 8), ...mk('B', '23', 20, 19),
    ]));
    expect(r.verdict).toBe('EKSIK_ASAMA');
    expect(r.verdictNote).toMatch(/AYRILAMAZ/);
  });

  it('🔒 üç aşama benzerse ATST_KOK_DEGIL (hipotez ÇÜRÜR)', () => {
    const r = buildPidTimingReport(raw([
      ...trio('23', [20, 10], [20, 11], [20, 10]),
      ...trio('2C', [20, 10], [20, 9],  [20, 11]),
    ]));
    expect(r.verdict, 'araç yalnız beklediğimizi söylüyor').toBe('ATST_KOK_DEGIL');
    expect(r.verdictNote).toMatch(/[Kk]ök BAŞKA yerde/);
  });

  it('🔒 KISMİ aşamayla hüküm VERİLMEZ — tam tur şartı (B7)', () => {
    /* 1 PID × 20 tur = 20 deneme gerekir; 5 gelmiş. */
    const r = buildPidTimingReport(raw(trio('23', [5, 2], [5, 5], [5, 2])));
    expect(MIN_ROUNDS_PER_PHASE).toBe(20);
    expect(r.verdict).toBe('EKSIK_ASAMA');
    expect(r.verdictNote, 'kısmi aşama gerekçesi yazılmamış').toMatch(/TAM tur|Kısmi aşamayla/);
  });

  it('🔒 iki PID varsa eşik İKİYE katlanır (yarım tur yeterli SAYILMAZ)', () => {
    /* 2 PID × 20 tur = 40 deneme gerekir; her PID'den 20 → toplam 40 → yeterli.
       Ama tek PID'den 20 gelirse (toplam 20) YETERSİZ olmalı. */
    const yeterli = buildPidTimingReport(raw([
      ...trio('23', [20, 8], [20, 19], [20, 7]),
      ...trio('2C', [20, 10], [20, 18], [20, 9]),
    ]));
    expect(yeterli.verdict).not.toBe('EKSIK_ASAMA');
    const yarim = buildPidTimingReport(raw([
      ...trio('23', [20, 8], [20, 19], [20, 7]),
      ...trio('2C', [10, 5], [10, 9], [10, 4]),
    ]));
    expect(yarim.verdict, 'yarım tur yeterli sayılmış').toBe('EKSIK_ASAMA');
  });

  it('🔒 kötüleşme BELIRSIZ sayılır — "iyileşti" diye sunulmaz', () => {
    const r = buildPidTimingReport(raw([
      ...trio('23', [20, 18], [20, 4], [20, 18]),
      ...trio('2C', [20, 18], [20, 4], [20, 18]),
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

  it('🔒 her aşamanın bağlantıya göre başlangıcı taşınır (zaman ekseni)', () => {
    const r = buildPidTimingReport(raw(trio('23', [20, 10], [20, 10], [20, 10])));
    expect(r.totals[0].sinceConnectMs).toBe(5000);
    expect(r.totals[1].sinceConnectMs).toBe(26000);
    expect(r.totals[2].sinceConnectMs).toBe(75000);
    /* Damga yoksa NULL — sahte 0 YOK. */
    const noStamp = buildPidTimingReport({
      status: 'done',
      phases: [{ phase: 'A', stApplied: 'default', stCommandOk: true, startedAt: 1, finishedAt: 2 }],
      samples: mk('A', '23', 20, 10),
    });
    expect(noStamp.totals[0].sinceConnectMs).toBeNull();
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
    const input = raw(trio('23', [20, 8], [20, 19], [20, 7]));
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

/* ══════════════════════════════════════════════════════════════════════════
 * DENETİM DÜZELTMELERİ (#518 · B1/B2/B6/B7) — deneyi GEÇERSİZ kılan boşluklar
 * ════════════════════════════════════════════════════════════════════════ */

describe('B1 — ATST uygulandığı BAĞIMSIZ gösterilmeli', () => {
  it('🔒 NO_DATA süresi iki katına çıkmadıysa ATST_UYGULANMADI (hüküm YOK)', () => {
    /* Klasik tuzak: oran düşmüş görünüyor AMA ayar hiç geçmemiş. */
    const s = [
      ...mk('A',  '23', 20, 8,  60, 210),
      ...mk('B',  '23', 20, 19, 60, 215),   // süre AYNI → ayar geçmemiş
      ...mk('A2', '23', 20, 7,  60, 210),
    ];
    const r = buildPidTimingReport(raw(s));
    expect(r.verdict).toBe('ATST_UYGULANMADI');
    expect(r.verdictNote, 'OK yanıtının kanıt olmadığı yazılmamış').toMatch(/KANIT DEĞİLDİR/);
    expect(ATST_APPLIED_MIN_RATIO).toBe(2.0);
  });

  it('🔒 stCommandOk TRUE olsa bile süre kanıtı yoksa hüküm VERİLMEZ', () => {
    const s = [
      ...mk('A',  '23', 20, 8,  60, 200),
      ...mk('B',  '23', 20, 19, 60, 240),
      ...mk('A2', '23', 20, 7,  60, 200),
    ];
    const r = buildPidTimingReport(raw(s));   // fixture stCommandOk: true
    expect(r.totals[1].stCommandOk).toBe(true);
    expect(r.verdict, 'klon "OK" dedi diye hüküm verilmiş').toBe('ATST_UYGULANMADI');
  });

  it('🔒 kanıt oranı rapora taşınır', () => {
    const r = buildPidTimingReport(raw(trio('23', [20, 8], [20, 19], [20, 7])));
    expect(r.atstEvidenceRatio).not.toBeNull();
    expect(r.atstEvidenceRatio!).toBeGreaterThanOrEqual(2.0);
  });
});

describe('B2 — sınıf kaymasına körlük kapalı', () => {
  it('🔒 NO_DATA düştü ama OK ARTMADIYSA iyileşme İDDİA EDİLMEZ', () => {
    /* NO_DATA 60% → 10%, ama kayıp 7F/BUSY'ye kaymış: OK aynı kalmış. */
    const mkShift = (phase: 'A' | 'B' | 'A2', ok: number, nd: number, other: number) => [
      ...Array.from({ length: ok }, () => ({ phase, pid: '23', outcome: 'OK',
        elapsedMs: 60, queueWaitMs: 5, respLen: 12 })),
      ...Array.from({ length: nd }, () => ({ phase, pid: '23', outcome: 'NO_DATA',
        elapsedMs: phase === 'B' ? 1010 : 210, queueWaitMs: 5, respLen: 8 })),
      ...Array.from({ length: other }, () => ({ phase, pid: '23', outcome: 'NEG_7F',
        elapsedMs: 90, queueWaitMs: 5, respLen: 6 })),
    ];
    const r = buildPidTimingReport(raw([
      ...mkShift('A',  8, 12, 0),
      ...mkShift('B',  8,  2, 10),   // NO_DATA düştü, OK AYNI, 'diğer' fırladı
      ...mkShift('A2', 8, 12, 0),
    ] as never));
    expect(r.verdict).toBe('BELIRSIZ');
    expect(r.verdictNote, 'sınıf kayması söylenmiyor').toMatch(/SINIF DEĞİŞTİRDİ/);
    expect(r.totals[1].other).toBe(10);
  });

  it('🔒 other / successRate / otherMs / queueWaitMs raporda var', () => {
    const r = buildPidTimingReport(raw(trio('23', [20, 8], [20, 19], [20, 7])));
    const b = r.totals[1];
    expect(b.other).toBe(0);
    expect(b.successRate).toBeCloseTo(0.95, 6);
    expect(b.otherMs.count).toBe(0);
    expect(b.queueWaitMs.p50).toBe(5);
    expect(b.readDeadlineMs, 'deadline ATST degerine gore olceklenmemis').toBe(1620);
  });
});

describe('B6 — PID hükmü kontrol aşamasını alır', () => {
  it('🔒 kurtulus ancak A2 asamasinda GERI DONDUYSE gecerli', () => {
    const geriDondu = buildPidTimingReport(raw(trio('23', [20, 4], [20, 19], [20, 5])));
    expect(geriDondu.target23!.verdict).toBe('SURE_ILE_KURTULDU');
    const donmedi = buildPidTimingReport(raw(trio('23', [20, 4], [20, 19], [20, 19])));
    expect(donmedi.target23!.verdict, 'geri dönmeden kurtuluş iddia edilmiş').toBe('DEGISMEDI');
  });
});

describe('B7 — dürüstlük', () => {
  it('🔒 ATST geri alma sonucu rapora taşınır (sessiz yutma yok)', () => {
    const r = buildPidTimingReport(raw(trio('23', [20, 8], [20, 19], [20, 7])));
    expect(r.stRestored).toBe('true');
    const bilinmiyor = buildPidTimingReport({
      status: 'done', phases: [], samples: [],
    });
    expect(bilinmiyor.stRestored, 'bilinmeyen durum UNKNOWN yazılmamış').toBe('UNKNOWN');
  });

  it('🔒 deney penceresi damgası taşınır (B5 — saha okuması kirlenmesin)', () => {
    const r = buildPidTimingReport(raw(trio('23', [20, 8], [20, 19], [20, 7])));
    expect(r.windowStartMs).toBe(1000);
    expect(r.windowEndMs).toBe(91000);
  });

  it('🔒 A aşamasının stApplied değeri UNKNOWN (sahte kesinlik yok — B3)', () => {
    const r = buildPidTimingReport(raw(trio('23', [20, 8], [20, 19], [20, 7])));
    expect(r.totals[0].stApplied, 'adaptorun gercek ST degeri biliniyormus gibi yazilmis')
      .toBe('UNKNOWN');
  });
});
