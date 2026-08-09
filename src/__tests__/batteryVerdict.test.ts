/**
 * batteryVerdict.test.ts — ADR-286 Adım 3/2 · motorun İLK ÜRETİM BAĞLANTISI.
 *
 * `maviReasoningEngine` 751 satırdı, testleri yeşildi ve **hiçbir ürün
 * çağıranı yoktu** — ölü koddu. Bu dosya onun gerçekten hüküm ürettiğini,
 * doğru kapsamla ürettiğini ve fail-closed kaldığını kilitler.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  produceBatteryVerdict, readBatteryVerdict, readBatteryVerdictStats,
  startBatteryVerdictService, stopBatteryVerdictService,
  VERDICT_TTL_MS, _resetBatteryVerdictForTest,
} from '../platform/reasoning/batteryVerdictService';
import {
  ingestVoltageSample, readLocalBatteryEvidence, _resetBatteryEvidenceForTest,
} from '../platform/reasoning/batteryEvidenceSource';
import { _resetUnknownInputStatsForTest } from '../platform/reasoning/core/evidenceInputGuard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const T = 2_000_000;

/** Motor çalışır, normal şarj — kanıt üretecek kadar örnek. */
function feedHealthy(base = T): void {
  for (let i = 0; i < 5; i++) ingestVoltageSample(14.0, 900, base + i * 5_000);
}
/** Motor çalışır, şarj düşük — WARNING kanıdı. */
function feedFaulty(base = T): void {
  for (let i = 0; i < 5; i++) ingestVoltageSample(12.8, 900, base + i * 5_000);
}

beforeEach(() => {
  _resetBatteryEvidenceForTest();
  _resetBatteryVerdictForTest();
  _resetUnknownInputStatsForTest();
});

describe('ölü motor canlandı — hüküm gerçekten üretiliyor', () => {
  it('yerel kanıttan hüküm üretilir', () => {
    feedHealthy();
    expect(readLocalBatteryEvidence().length).toBeGreaterThan(0);

    produceBatteryVerdict(T + 30_000);
    const v = readBatteryVerdict(T + 30_000);
    expect(v).not.toBeNull();
    expect(readBatteryVerdictStats().produced).toBe(1);
  });

  it('sağlıklı akü → SUPPORTED, güven UNKNOWN değil', () => {
    feedHealthy();
    produceBatteryVerdict(T + 30_000);
    const v = readBatteryVerdict(T + 30_000)!;
    expect(v.decision).toBe('SUPPORTED');
    /* Kapsam 1/1 tam olduğu için güven kapsamdan DÜŞMEZ — seçenek (a)'nın
       asıl kazancı budur. VEHICLE_HEALTH seçilseydi kapsam 1/5 olur ve
       güven LOW'a çakılırdı. */
    expect(v.confidence).not.toBe('UNKNOWN');
  });

  it('şarj arızası → UNSUPPORTED (olumsuz haber serbest)', () => {
    feedFaulty();
    produceBatteryVerdict(T + 30_000);
    const v = readBatteryVerdict(T + 30_000)!;
    expect(v.decision).toBe('UNSUPPORTED');
  });

  it('hüküm kapsamını TAŞIR — akü, araç değil', () => {
    feedHealthy();
    produceBatteryVerdict(T + 30_000);
    expect(readBatteryVerdict(T + 30_000)!.scope).toBe('BATTERY_ONLY');
  });

  it('kanıt üretimi hükmü TETİKLER (abonelik zinciri)', () => {
    const off = startBatteryVerdictService();
    try {
      feedHealthy();
      // Hiç elle produceBatteryVerdict çağrılmadı.
      expect(readBatteryVerdictStats().produced).toBeGreaterThan(0);
    } finally { off(); }
  });
});

describe('fail-closed', () => {
  it('kanıt YOKSA hüküm üretilmez — INSUFFICIENT_EVIDENCE bile yazılmaz', () => {
    /* "Değerlendirdik, yetersiz" ile "hiç kanıt gelmedi" AYRI şeylerdir.
       İkincisinde hüküm kaydı açmak, ölçüm yapılmış izlenimi verirdi. */
    produceBatteryVerdict(T);
    expect(readBatteryVerdict(T)).toBeNull();
    expect(readBatteryVerdictStats().produced).toBe(0);
  });

  it('TTL dolunca hüküm DÜŞER — son bilinen iyi hüküm taşınmaz', () => {
    feedHealthy();
    produceBatteryVerdict(T + 30_000);
    expect(readBatteryVerdict(T + 30_000)).not.toBeNull();

    const later = T + 30_000 + VERDICT_TTL_MS + 1_000;
    expect(readBatteryVerdict(later)).toBeNull();
    expect(readBatteryVerdictStats().expiredDrops).toBe(1);
  });

  it('TTL tam sınırda hüküm hâlâ geçerli', () => {
    feedHealthy();
    produceBatteryVerdict(T + 30_000);
    expect(readBatteryVerdict(T + 30_000 + VERDICT_TTL_MS)).not.toBeNull();
  });

  it('hüküm TTL\'i kanıt TTL\'inden KISADIR', () => {
    // Kanıt 24 sa yaşar; hüküm anlık durumun yorumudur, o kadar yaşayamaz.
    expect(VERDICT_TTL_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('servis durdurulunca yeni hüküm üretilmez (zero-leak)', () => {
    const off = startBatteryVerdictService();
    feedHealthy();
    const before = readBatteryVerdictStats().produced;
    off();
    stopBatteryVerdictService();
    _resetBatteryEvidenceForTest();
    feedHealthy(T + 200_000);
    expect(readBatteryVerdictStats().produced).toBe(before);
  });
});

describe('motorun kuralına DOKUNULMADI (#488 paritesi)', () => {
  const SRC = readFileSync(join(process.cwd(),
    'src', 'platform', 'reasoning', 'batteryVerdictService.ts'), 'utf8');
  const codeOnly = SRC.split('\n')
    .filter((l) => { const t = l.trimStart(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
    .join('\n');

  it('bu dosyada İKİNCİ karar otoritesi yok', () => {
    /* Eşik/oran/güven hesabı buraya sızarsa TS↔SQL paritesi kırılır ve
       cihaz ile filo aynı araç için farklı hüküm verir. */
    expect(codeOnly).not.toMatch(/CONFIDENCE_ORDER|weakest|coverageRatio/);
    expect(codeOnly).not.toMatch(/severity\s*[=:]\s*['"](WARNING|CRITICAL)/);
    expect(codeOnly).not.toMatch(/decision\s*=\s*['"]/);
  });

  it('hüküm motordan gelir — burada üretilmez', () => {
    expect(codeOnly).toContain('reason(');
    expect(codeOnly).toContain('maviReasoningEngine');
  });

  it('niyet AÇIKÇA verilir (türetmeye bırakılmaz)', () => {
    // Defterde başka kategori belirdiği gün hüküm sessizce başka şeye dönmesin.
    expect(codeOnly).toContain("requestedIntent: 'BATTERY'");
    expect(codeOnly).not.toContain("'VEHICLE_HEALTH'");
  });
});

describe('hot-path dokunulmazlığı (#283 kesişimi)', () => {
  const SRC = readFileSync(join(process.cwd(),
    'src', 'platform', 'reasoning', 'batteryVerdictService.ts'), 'utf8');

  it('kendi timer\'ı YOK', () => {
    expect(SRC).not.toMatch(/setInterval|setTimeout/);
  });

  it('OBD akışına DOĞRUDAN abone değil — kanıt olayına biner', () => {
    // OBD hot-path'tir; hüküm oraya bağlanırsa her pakette koşardı.
    expect(SRC).not.toContain('onOBDData');
    expect(SRC).toContain('onBatteryEvidenceProduced');
  });

  it('okuma senkron hesap YAPMAZ — önbellekten döner', () => {
    // Safety katmanı hükme bakacaksa hesap tetiklememelidir.
    const readBlock = SRC.slice(SRC.indexOf('export function readBatteryVerdict'),
      SRC.indexOf('export function readBatteryVerdictStats'));
    expect(readBlock).not.toContain('reason(');
  });

  it('ağ çağrısı YOK — buluta yazma kapsam dışı', () => {
    expect(SRC).not.toMatch(/fetch\(|supabase|http/i);
  });
});

describe('gözlem yüzeyi', () => {
  it('istatistik kopya döner ve politika sürümü taşır', () => {
    feedHealthy();
    produceBatteryVerdict(T + 30_000);
    const s = readBatteryVerdictStats() as { produced: number };
    s.produced = 999;
    expect(readBatteryVerdictStats().produced).not.toBe(999);
    expect(readBatteryVerdictStats().policyVersion).toMatch(/^BVD-\d{4}\.\d{2}\.\d{2}$/);
  });

  it('karar · güven · gerekçe dağılımı sayılır', () => {
    feedHealthy();
    produceBatteryVerdict(T + 30_000);
    const s = readBatteryVerdictStats();
    expect(Object.keys(s.byDecision).length).toBeGreaterThan(0);
    expect(Object.keys(s.byConfidence).length).toBeGreaterThan(0);
    expect(Object.keys(s.byReason).length).toBeGreaterThan(0);
  });

  it('hüküm görünümü VOLTAJ DEĞERİ taşımaz', () => {
    feedHealthy();
    produceBatteryVerdict(T + 30_000);
    const dump = JSON.stringify(readBatteryVerdict(T + 30_000));
    expect(dump).not.toContain('14');       // voltaj değeri sızmamalı
    expect(dump).not.toMatch(/voltage|volt/i);
  });
});
