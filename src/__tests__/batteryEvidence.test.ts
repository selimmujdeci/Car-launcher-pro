/**
 * batteryEvidence.test.ts — ADR-286 Adım 3/1 · cihazda kanıt üretimi (#490).
 *
 * Dört şartın her biri ayrı ayrı kilitlenir:
 *   1. Marş penceresi dışlanır — marşta düşen voltaj "bitik akü" sayılmaz.
 *   2. Asıl hüküm motor çalışırken; motor kapalı okuma yalnız INFO.
 *   3. Tek örnekten INFO dışı severity çıkmaz.
 *   4. Kanıt yoksa kanıt üretilmez — boş/varsayılan yazılmaz.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  decideBatteryEvidence,
  CRANK_VOLTAGE_FLOOR, CRANK_WINDOW_MS, CONSISTENCY_WINDOW_MS, MIN_SAMPLES,
  CHARGE_LOW_V, CHARGE_OVER_V, VOLTAGE_SANE_MAX,
  type VoltageSample,
} from '../platform/reasoning/core/batteryEvidenceModel';
import {
  ingestVoltageSample, readBatteryEvidenceStats, readLocalBatteryEvidence,
  _resetBatteryEvidenceForTest,
} from '../platform/reasoning/batteryEvidenceSource';
import { _resetUnknownInputStatsForTest } from '../platform/reasoning/core/evidenceInputGuard';

const T = 1_000_000;

/** `n` adet örnek: en yenisi `nowMs`, geriye 5 sn aralıklarla. */
function run(voltage: number, n: number, rpm = 800, nowMs = T): VoltageSample[] {
  const out: VoltageSample[] = [];
  for (let i = n - 1; i >= 0; i--) out.push({ voltage, rpm, atMs: nowMs - i * 5_000 });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   ŞART 1 · MARŞ PENCERESİ
   ══════════════════════════════════════════════════════════════════════════ */

describe('ŞART 1 · marş penceresi dışlanır', () => {
  it('marş bölgesine inen okuma varsa TÜM pencere atlanır', () => {
    /* Marş anı ve onu izleyen toparlanma aynı penceredir; ortalaması yanıltır.
       Sağlıklı akü de marşta 9–10 V'a düşer — bu "bitik akü" DEĞİLDİR. */
    const s: VoltageSample[] = [
      { voltage: 12.5, rpm: 0, atMs: T - 15_000 },
      { voltage: 9.4,  rpm: 0, atMs: T - 10_000 },   // marş
      { voltage: 14.1, rpm: 900, atMs: T - 1_000 },
    ];
    const d = decideBatteryEvidence(s, T);
    expect(d.produce).toBe(false);
    expect(d.produce === false && d.reason).toBe('CRANKING');
  });

  it('marş eşiğinin TAM üstü marş sayılmaz (sınır)', () => {
    const s = run(CRANK_VOLTAGE_FLOOR, MIN_SAMPLES, 900);
    const d = decideBatteryEvidence(s, T);
    // 11.0 V motor çalışırken WARNING'dir ama CRANKING DEĞİLDİR.
    expect(d.produce === false && d.reason).not.toBe('CRANKING');
  });

  it('motor 0 → çalışır geçişinden sonra pencere boyunca kanıt YOK', () => {
    const s: VoltageSample[] = [
      { voltage: 12.4, rpm: 0,   atMs: T - 6_000 },
      { voltage: 13.9, rpm: 850, atMs: T - 1_000 },  // geçiş, 1 sn önce
    ];
    const d = decideBatteryEvidence(s, T);
    expect(d.produce === false && d.reason).toBe('CRANKING');
  });

  it('geçiş penceresi DOLDUKTAN sonra kanıt üretilir', () => {
    const after = CRANK_WINDOW_MS + 1_000;
    const s: VoltageSample[] = [
      { voltage: 12.4, rpm: 0,   atMs: T - after - 5_000 },
      { voltage: 13.9, rpm: 850, atMs: T - after },
      { voltage: 14.0, rpm: 860, atMs: T - 2_000 },
      { voltage: 14.1, rpm: 870, atMs: T },
    ];
    const d = decideBatteryEvidence(s, T);
    expect(d.produce).toBe(true);
  });

  it('tek düşük okumadan CRITICAL ÇIKMAZ', () => {
    const s: VoltageSample[] = [
      { voltage: 14.0, rpm: 900, atMs: T - 10_000 },
      { voltage: 14.1, rpm: 900, atMs: T - 5_000 },
      { voltage: 12.9, rpm: 900, atMs: T },          // tek düşük
    ];
    const d = decideBatteryEvidence(s, T);
    // Tutarlı değil → kanıt yok; CRITICAL/WARNING kesinlikle yok.
    expect(d.produce === true && d.severity).not.toBe('CRITICAL');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ŞART 2 · ASIL HÜKÜM MOTOR ÇALIŞIRKEN
   ══════════════════════════════════════════════════════════════════════════ */

describe('ŞART 2 · motor kapalı okuma yalnız INFO', () => {
  it('motor kapalı + DÜŞÜK voltaj → yine de INFO (yanlış alarm yasağı)', () => {
    /* Kontak açık ölçüm head unit yükü altındadır; sağlıklı akü 12.1–12.3
       okuyabilir. Bunu "zayıf" saymak yanlış alarmdır. */
    const d = decideBatteryEvidence(run(12.1, 5, 0), T);
    expect(d.produce).toBe(true);
    expect(d.produce === true && d.severity).toBe('INFO');
    expect(d.produce === true && d.engineRunning).toBe(false);
  });

  it('motor kapalı + YÜKSEK voltaj → yine INFO (yüzey şarjı yanılgısı)', () => {
    // Yeni park etmiş araçta zayıf akü de 12.6 okuyabilir → "sağlıklı" denemez.
    const d = decideBatteryEvidence(run(12.7, 5, 0), T);
    expect(d.produce === true && d.severity).toBe('INFO');
  });

  it('motor kapalı ve çalışır okumalar AYRI metriklerdir', () => {
    const rest = decideBatteryEvidence(run(12.5, 4, 0), T);
    const running = decideBatteryEvidence(run(14.0, 4, 900), T);
    expect(rest.produce === true && rest.metric).toBe('battery_voltage_rest');
    expect(running.produce === true && running.metric).toBe('battery_voltage_running');
  });

  it('motor çalışırken şarj DÜŞÜK → WARNING', () => {
    const d = decideBatteryEvidence(run(CHARGE_LOW_V - 0.3, MIN_SAMPLES + 1, 900), T);
    expect(d.produce === true && d.severity).toBe('WARNING');
  });

  it('motor çalışırken AŞIRI şarj → CRITICAL', () => {
    const d = decideBatteryEvidence(run(CHARGE_OVER_V + 0.3, MIN_SAMPLES + 1, 900), T);
    expect(d.produce === true && d.severity).toBe('CRITICAL');
  });

  it('normal şarj bandı → INFO', () => {
    for (const v of [13.4, 14.0, 14.7]) {
      const d = decideBatteryEvidence(run(v, MIN_SAMPLES + 1, 900), T);
      expect(d.produce === true && d.severity, `${v} V`).toBe('INFO');
    }
  });

  it('sınır bölgesi (14.8–15.0) alarm ÜRETMEZ', () => {
    const d = decideBatteryEvidence(run(14.9, MIN_SAMPLES + 1, 900), T);
    expect(d.produce === true && d.severity).toBe('INFO');
  });

  it('motor durumu BİLİNMİYORSA kanıt üretilmez (fail-closed)', () => {
    // Hangi eşik takımı geçerli bilinmiyor → tahmin edilmez.
    const d = decideBatteryEvidence(run(12.5, 4, -1), T);
    expect(d.produce === false && d.reason).toBe('ENGINE_STATE_UNKNOWN');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ŞART 3 · TEK ÖRNEKTEN HÜKÜM YOK
   ══════════════════════════════════════════════════════════════════════════ */

describe('ŞART 3 · INFO dışı severity çoklu tutarlı okuma ister', () => {
  it(`${MIN_SAMPLES} altındaki tutarlı okuma WARNING üretmez`, () => {
    const d = decideBatteryEvidence(run(12.8, MIN_SAMPLES - 1, 900), T);
    expect(d.produce).toBe(false);
    expect(d.produce === false && d.reason).toBe('INSUFFICIENT_SAMPLES');
  });

  it('TEK gürültülü düşüş severity üretmez (çoğunluk normal)', () => {
    /* Klima kompresörü / direksiyon pompası anlık düşüş yapar. Son okuma
       WARNING bandında olsa bile pencerede tutarlı yeterli okuma yoksa
       severity üretilmez. */
    const s: VoltageSample[] = [
      { voltage: 14.0, rpm: 900, atMs: T - 15_000 },
      { voltage: 14.1, rpm: 900, atMs: T - 10_000 },
      { voltage: 14.0, rpm: 900, atMs: T - 5_000 },
      { voltage: 12.9, rpm: 900, atMs: T },            // tek gürültülü düşüş
    ];
    const d = decideBatteryEvidence(s, T);
    expect(d.produce).toBe(false);
    expect(d.produce === false && d.reason).toBe('INCONSISTENT');
  });

  it('gerçek şarj arızası (çoğunluk düşük) WARNING ÜRETİR', () => {
    // Kilidin ters yönü: gürültü elenirken gerçek arıza da kaçırılmamalı.
    const s: VoltageSample[] = [
      { voltage: 14.0, rpm: 900, atMs: T - 15_000 },   // tek normal
      { voltage: 12.8, rpm: 900, atMs: T - 10_000 },
      { voltage: 12.9, rpm: 900, atMs: T - 5_000 },
      { voltage: 12.8, rpm: 900, atMs: T },
    ];
    const d = decideBatteryEvidence(s, T);
    expect(d.produce === true && d.severity).toBe('WARNING');
  });

  it('pencere DIŞINDAKİ eski okumalar sayılmaz', () => {
    const old = CONSISTENCY_WINDOW_MS + 10_000;
    const s: VoltageSample[] = [
      { voltage: 12.8, rpm: 900, atMs: T - old - 5_000 },
      { voltage: 12.8, rpm: 900, atMs: T - old },
      { voltage: 12.8, rpm: 900, atMs: T },
    ];
    const d = decideBatteryEvidence(s, T);
    expect(d.produce).toBe(false);   // pencerede yalnız 1 okuma var
  });

  it('INFO için çoklu okuma şartı YOKTUR (alarm değil)', () => {
    const d = decideBatteryEvidence(run(14.0, 1, 900), T);
    expect(d.produce === true && d.severity).toBe('INFO');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ŞART 4 · KANIT YOKSA KANIT ÜRETİLMEZ
   ══════════════════════════════════════════════════════════════════════════ */

describe('ŞART 4 · sahte kanıt yasağı', () => {
  it('hiç örnek yoksa kanıt yok', () => {
    const d = decideBatteryEvidence([], T);
    expect(d.produce === false && d.reason).toBe('NO_SAMPLES');
  });

  it('fiziksel olarak anlamsız voltaj kanıt üretmez', () => {
    for (const v of [0, 3, VOLTAGE_SANE_MAX + 5, Number.NaN]) {
      const d = decideBatteryEvidence(run(v, 4, 900), T);
      expect(d.produce, `${v} V`).toBe(false);
    }
  });

  it('gelecekten gelen okuma sayılmaz (saat sıçraması)', () => {
    const s: VoltageSample[] = [{ voltage: 14.0, rpm: 900, atMs: T + 60_000 }];
    const d = decideBatteryEvidence(s, T);
    expect(d.produce).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ÜRETİM YOLU · sayaçlar · guard · gizlilik
   ══════════════════════════════════════════════════════════════════════════ */

describe('üretim yolu', () => {
  beforeEach(() => {
    _resetBatteryEvidenceForTest();
    _resetUnknownInputStatsForTest();
  });

  it('voltaj gelmiyorsa ÖRNEK BİLE yazılmaz', () => {
    ingestVoltageSample(Number.NaN, 900, T);
    ingestVoltageSample(Number.POSITIVE_INFINITY, 900, T);
    expect(readBatteryEvidenceStats().samplesSeen).toBe(0);
    expect(readLocalBatteryEvidence().length).toBe(0);
  });

  it('yeterli tutarlı okumadan sonra kanıt üretilir ve deftere yazılır', () => {
    for (let i = 0; i < 5; i++) ingestVoltageSample(14.0, 900, T + i * 5_000);
    const ev = readLocalBatteryEvidence();
    expect(ev.length).toBeGreaterThan(0);
    const e = ev[ev.length - 1]!;
    expect(e.category).toBe('BATTERY');
    expect(e.source).toBe('TELEMETRY');
    expect(e.provenance).toBe('MEASURED');
    expect(e.state).toBe('ACTIVE');
    expect(e.metric).toBe('battery_voltage_running');
    expect(e.expiresAt).toBeGreaterThan(e.createdAt);   // süresiz kanıt YOK
  });

  it('güven YAZILMAZ, omurganın TEK fonksiyonundan TÜRETİLİR', () => {
    /* Sunucuda bunu trigger yapar; cihazda öyle bir kapı yok. Yer tutucu
       UNKNOWN bırakmak tüm kanıtları güvensiz yapar ve motor
       EVIDENCE_UNKNOWN_CONFIDENCE hükmü verirdi. */
    for (let i = 0; i < 5; i++) ingestVoltageSample(14.0, 900, T + i * 5_000);
    const e = readLocalBatteryEvidence()[0]!;
    expect(e.confidence).not.toBe('UNKNOWN');
    // TELEMETRY tavanı HIGH; örnek sayısı tavanı da uygulanır.
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(e.confidence);
  });

  it('atlanan üretimin GEREKÇESİ sayılır (sessiz yutma yok)', () => {
    // Motor durumu bilinmiyor → ENGINE_STATE_UNKNOWN
    for (let i = 0; i < 5; i++) ingestVoltageSample(12.5, -1, T + i * 5_000);
    const s = readBatteryEvidenceStats();
    expect(s.skipped).toBeGreaterThan(0);
    expect(s.bySkipReason['ENGINE_STATE_UNKNOWN']).toBeGreaterThan(0);
    expect(s.lastSkipReason).toBe('ENGINE_STATE_UNKNOWN');
    expect(readLocalBatteryEvidence().length).toBe(0);
  });

  it('kanıt defteri SINIRLIDIR (cihazda sınırsız defter yok)', () => {
    for (let i = 0; i < 400; i++) ingestVoltageSample(14.0, 900, T + i * 21_000);
    expect(readLocalBatteryEvidence().length).toBeLessThanOrEqual(64);
  });

  it('istatistik KOPYA döner ve politika sürümü taşır', () => {
    const s = readBatteryEvidenceStats() as { produced: number };
    s.produced = 999;
    expect(readBatteryEvidenceStats().produced).not.toBe(999);
    expect(readBatteryEvidenceStats().policyVersion).toMatch(/^BEV-\d{4}\.\d{2}\.\d{2}$/);
  });

  it('kanıt KİŞİSEL VERİ taşımaz', () => {
    for (let i = 0; i < 5; i++) ingestVoltageSample(14.0, 900, T + i * 5_000);
    const dump = JSON.stringify(readLocalBatteryEvidence());
    expect(dump).not.toMatch(/vin|plate|plaka|lat|lon|driverName/i);
    // Yalnız metrik adı ve sayısal voltaj taşınır.
    expect(dump).toContain('battery_voltage');
  });
});
