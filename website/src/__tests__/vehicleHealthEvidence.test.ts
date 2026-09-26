/**
 * F2.2 · ARAÇ SAĞLIĞI KANIT MODELİ.
 *
 * ── ÖLÇÜLEN BOŞLUK ───────────────────────────────────────────────────────
 * Arabam Cebimde sensör ve DTC listesi gösteriyordu; aracın DURUMUNU
 * söyleyen hiçbir yüzey yoktu. Mevcut hüküm otoritesi (`judgeVehicle`)
 * yalnız `/dashboard`ta kullanılıyordu ve DTC'yi HİÇ bilmiyordu — yani
 * Arabam Cebimde'nin en güçlü sağlık kanıtı hükme girmiyordu.
 *
 * ── KİLİTLENEN INVARIANTLAR ──────────────────────────────────────────────
 * Unknown ≠ healthy · Missing ≠ normal · Stale ≠ current ·
 * Unsupported ≠ failed · Offline ≠ unhealthy.
 *
 * Bu testler KANONİK otoriteyi kullanır: `Verdict` enum'u ve `VERDICT_RANK`
 * `@/lib/console/evidenceModel`den gelir — ikinci bir sağlık enum'u yoktur.
 */

import { describe, it, expect } from 'vitest';
import {
  buildVehicleHealthSummary,
  judgeDtcEvidence,
  type HealthInput,
} from '@/lib/diagnostics/vehicleHealth';
import { VERDICT_RANK, type Verdict } from '@/lib/console/evidenceModel';
import {
  buildVehicleFreshness,
  type VehicleFreshness,
} from '@/lib/fleet/vehicleTelemetryFreshness';
import type { DtcOutcome, VoltageOutcome } from '@/lib/diagnostics/dtcResultContract';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');
const OK_COMPLETENESS = { stored: 'ok', pending: 'ok', permanent: 'ok' } as const;

/** Gerçek tazelik kurucusunu kullanır — sahte `VehicleFreshness` uydurulmaz. */
function freshness(over: {
  ageMs?: number;
  temp?: number | null;
  fuel?: number | null;
  rpm?: number | null;
} = {}): VehicleFreshness {
  const age = over.ageMs ?? 30_000;
  const at = new Date(NOW - age).toISOString();
  return buildVehicleFreshness({
    now: NOW,
    readable: true,
    row: {
      updatedAt: at,
      obdObservedAt: at,
      gpsObservedAt: at,
      temp: over.temp === undefined ? 84 : over.temp,
      fuel: over.fuel === undefined ? 55 : over.fuel,
      rpm: over.rpm === undefined ? 820 : over.rpm,
      speed: 0,
    },
  });
}

function summary(over: Partial<HealthInput> = {}) {
  return buildVehicleHealthSummary({
    now: NOW,
    freshness: freshness(),
    dtc: null,
    voltage: null,
    ...over,
  });
}

const noDtc = (partial = false, readAtMs = NOW - 60_000): DtcOutcome => ({
  kind: 'NO_DTC',
  partial,
  readAt: new Date(readAtMs).toISOString(),
  completeness: OK_COMPLETENESS,
});

const withDtc = (
  severity: 'critical' | 'warning' | 'info' = 'warning',
  readAtMs = NOW - 60_000,
): DtcOutcome => ({
  kind: 'RESULT',
  partial: false,
  readAt: new Date(readAtMs).toISOString(),
  completeness: OK_COMPLETENESS,
  dtcs: [{ code: 'P0571', severity, system: 'Fren', desc: 'Fren Pedalı Anahtarı Devresi' }],
});

const volts = (v: number, readAtMs = NOW - 60_000): VoltageOutcome => ({
  kind: 'RESULT',
  volts: v,
  readAt: new Date(readAtMs).toISOString(),
});

/* ═══ 1–2 · "arıza yok" ile "her şey sağlam" ayrımı ═══════════════════════ */

describe('F2.2 · sağlıklı görünüm', () => {
  it('1 — güncel başarılı NO_DTC + güncel motor verisi → VERIFIED', () => {
    const s = summary({ dtc: noDtc() });
    expect(s.verdict).toBe<Verdict>('VERIFIED');
    expect(s.headline).toBe('Aracınız iyi görünüyor');
    expect(s.measuredAt).not.toBeNull();
  });

  it('2 — NO_DTC tek başına "araç tamamen sağlıklı" İDDİA ETMEZ', () => {
    const s = summary({ dtc: noDtc(), freshness: undefined });
    expect(s.verdict).toBe<Verdict>('VERIFIED');
    /* Manşet mutlak sağlık iddiası içermez, kapsam açıkça söylenir. */
    expect(s.explanation).toContain('Mevcut');
    expect(s.explanation).not.toMatch(/tamamen|kesinlikle|tüm sistemler/i);
    /* Ölçülmeyen kanıtlar KISIT olarak yazılır — sessizce "kapsandı" sayılmaz. */
    expect(s.limitations).toContain('Motor verisi alınamadı');
    expect(s.limitations).toContain('Akü voltajı ölçülmedi');
    expect(s.confidence).toBe('LOW');
  });
});

/* ═══ 3–5 · DTC entegrasyonu ═════════════════════════════════════════════ */

describe('F2.2 · DTC → sağlık', () => {
  it('3 — DTC RESULT → WARNING (kontrol edilmeli)', () => {
    const s = summary({ dtc: withDtc('warning') });
    expect(s.verdict).toBe<Verdict>('WARNING');
    expect(s.headline).toBe('Kontrol edilmesi gereken bir durum var');
    expect(s.dtcs).toHaveLength(1);
    expect(s.dtcs[0].code).toBe('P0571');
  });

  it('3b — CRITICAL YALNIZ aracın kendi severity kaydından çıkar', () => {
    /* Telefon P-kodundan severity TAHMİN ETMEZ: aynı kod `warning` iken
       WARNING, araç `critical` yazdığında CRITICAL olur. */
    expect(summary({ dtc: withDtc('info') }).verdict).toBe<Verdict>('WARNING');
    expect(summary({ dtc: withDtc('critical') }).verdict).toBe<Verdict>('CRITICAL');
  });

  it('4 — başarısız DTC okuması SAĞLIKLI üretmez', () => {
    const s = summary({
      dtc: { kind: 'FAILED', reason: 'Araç ölçüm sonucu yazmadı' },
      freshness: undefined,
    });
    expect(s.verdict).toBe<Verdict>('NO_EVIDENCE');
    expect(s.headline).not.toContain('iyi görünüyor');
  });

  it('5 — UNSUPPORTED sağlıklı DEĞİL, arıza da DEĞİL', () => {
    const s = summary({
      dtc: { kind: 'UNSUPPORTED', reason: 'Araç bu teşhis servislerini desteklemiyor' },
      freshness: undefined,
    });
    expect(s.verdict).toBe<Verdict>('NO_EVIDENCE');
    /* Unsupported ≠ failed: kısıt olarak anlatılır, arıza olarak DEĞİL. */
    expect(s.limitations).toContain('Araç bu teşhis servislerini desteklemiyor');
    expect(VERDICT_RANK[s.verdict]).toBeLessThan(VERDICT_RANK.WARNING);
  });
});

/* ═══ 6–8 · tazelik / bağlantı ═══════════════════════════════════════════ */

describe('F2.2 · tazelik ve bağlantı', () => {
  it('6 — bayat ölçüm GÜNCEL sağlık iddiası üretmez', () => {
    /* 3 saat önce okunmuş normal motor sıcaklığı: ne "iyi" ne "uyarı". */
    const s = summary({ freshness: freshness({ ageMs: 3 * 3_600_000 }) });
    expect(s.verdict).toBe<Verdict>('NO_EVIDENCE');
    expect(s.limitations).toContain('Motor sıcaklığı verisi güncel değil');
  });

  it('6b — bayat ama EŞİĞİ AŞAN ölçüm yumuşatılmaz (güvenlik sinyali)', () => {
    const s = summary({ freshness: freshness({ ageMs: 3 * 3_600_000, temp: 118 }) });
    expect(s.verdict).toBe<Verdict>('CRITICAL');
  });

  it('7 — araç çevrimdışı olması ARIZA DEĞİLDİR', () => {
    const s = summary({
      dtc: { kind: 'OFFLINE', reason: 'Araç bağlantısı yok: teşhis okuması yapılamadı' },
      freshness: buildVehicleFreshness({ now: NOW, readable: true, row: null }),
    });
    expect(s.verdict).toBe<Verdict>('NO_EVIDENCE');
    expect(s.headline).toBe('Güncel sağlık verisi bekleniyor');
    /* Sağlık ile bağlantı AYRI alanlarda taşınır (§11). */
    expect(s.connection.state).toBe('NEVER_SEEN');
    expect(VERDICT_RANK[s.verdict]).toBeLessThan(VERDICT_RANK.WARNING);
  });

  it('8 — hiç kanıt yoksa sonuç UNKNOWN, güven NONE', () => {
    const s = summary({ freshness: undefined });
    expect(s.verdict).toBe<Verdict>('NO_EVIDENCE');
    expect(s.confidence).toBe('NONE');
    expect(s.measuredAt).toBeNull();
    expect(s.freshness).toBe('UNKNOWN');
  });
});

/* ═══ 9–12 · sağlık kanıtı SAYILMAYANLAR ═════════════════════════════════ */

describe('F2.2 · kanıt kapsamı', () => {
  it('9 — odometre sağlık kanıtı DEĞİLDİR (ölçüm zamanı yok)', () => {
    /* `vehicles.odometer_km` ölçüm damgası taşımaz; "şu anki km" iddiası
       kurulamaz, bu yüzden sağlık hükmüne HİÇ girmez. */
    const ids = summary({ dtc: noDtc() }).evidence.map((e) => e.id);
    expect(ids).not.toContain('odometer');
  });

  it('10 — akü ölçülmediyse NORMAL VARSAYILMAZ', () => {
    const s = summary({ dtc: noDtc(), voltage: null });
    const batt = s.evidence.find((e) => e.id === 'battery')!;
    expect(batt.verdict).toBe<Verdict>('NO_EVIDENCE');
    expect(batt.detail).toBe('Hiç ölçülmedi');
    expect(batt.countedInVerdict).toBe(false);
    expect(s.limitations).toContain('Akü voltajı ölçülmedi');
  });

  it('10b — gerçekten düşük akü voltajı hükme girer', () => {
    /* Eşik mevcut kanonik `BATTERY_RULE`dır; yeni eşik tanımlanmadı. */
    expect(summary({ dtc: noDtc(), voltage: volts(11.4) }).verdict)
      .toBe<Verdict>('CRITICAL');
    expect(summary({ dtc: noDtc(), voltage: volts(12.6) }).verdict)
      .toBe<Verdict>('VERIFIED');
  });

  it('11 — desteklenmeyen kapsam BAŞARISIZLIK sayılmaz', () => {
    const unsupported = judgeDtcEvidence(
      { kind: 'UNSUPPORTED', reason: 'Araç bu teşhis servislerini desteklemiyor' },
      NOW,
    );
    const failed = judgeDtcEvidence({ kind: 'FAILED', reason: 'Okunamadı' }, NOW);
    /* İkisi de sağlık üretmez ama ikisi de UYARI da değildir; ayrımı
       kullanıcıya yazılan gerekçe taşır. */
    expect(unsupported.reading.verdict).toBe<Verdict>('NO_EVIDENCE');
    expect(failed.reading.verdict).toBe<Verdict>('NO_EVIDENCE');
    expect(unsupported.note).not.toBe(failed.note);
  });

  it('12 — yakıt seviyesi sağlık hükmüne SOKULMAZ', () => {
    /* Yakıt bir sağlık göstergesi değildir (§3). Deponun boş olması aracı
       arızalı yapmaz. */
    const low = summary({ dtc: noDtc(), freshness: freshness({ fuel: 2 }) });
    const full = summary({ dtc: noDtc(), freshness: freshness({ fuel: 98 }) });
    expect(low.verdict).toBe(full.verdict);
    expect(low.evidence.map((e) => e.id)).not.toContain('fuel');
  });
});

/* ═══ 13–16 · projeksiyon bütünlüğü ══════════════════════════════════════ */

describe('F2.2 · projeksiyon bütünlüğü', () => {
  it('13 — her kanıt satırı PROVENANCE taşır', () => {
    const s = summary({ dtc: noDtc(), voltage: volts(12.5) });
    for (const e of s.evidence) {
      expect(e.provenance.length, e.id).toBeGreaterThan(0);
    }
    expect(s.evidence.find((e) => e.id === 'dtc')!.provenance).toBe('Araç teşhis okuması');
  });

  it('14 — kısmi tarama KISIT olarak taşınır, gizlenmez', () => {
    const s = summary({ dtc: noDtc(true) });
    expect(s.limitations).toContain('Teşhis taraması kısmi: bazı sistemler okunamadı');
  });

  it('15 — F2.1 semantiği korunur: STALE sonuç sağlık üretmez', () => {
    const s = summary({
      dtc: { kind: 'STALE', reason: 'Sonuç güncel değil, yeniden okuyun' },
      freshness: undefined,
    });
    expect(s.verdict).toBe<Verdict>('NO_EVIDENCE');
    expect(s.dtcs).toHaveLength(0);
  });

  it('16 — hüküm sıralaması konsolla AYNI otoriteden gelir', () => {
    /* İkinci bir sağlık enum'u/sıralaması kurulmadığının kilidi. */
    const critical = summary({ dtc: withDtc('critical'), voltage: volts(12.5) });
    expect(critical.verdict).toBe<Verdict>('CRITICAL');
    expect(VERDICT_RANK[critical.verdict]).toBeGreaterThan(VERDICT_RANK.WARNING);
    expect(VERDICT_RANK.WARNING).toBeGreaterThan(VERDICT_RANK.VERIFIED);
    expect(VERDICT_RANK.VERIFIED).toBeGreaterThan(VERDICT_RANK.NO_EVIDENCE);
  });
});
