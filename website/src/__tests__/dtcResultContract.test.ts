/**
 * dtcResultContract — F2.1 DTC SONUÇ YORUMU.
 *
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
 * `DiagnosticsPanel` `read_dtc` gönderiyor ama sonucu `/api/pwa/dtc-result`
 * üzerinden okumaya çalışıyordu; o uç bilinçli bir 410 tombstone. Araç tarafı
 * sonucu ZATEN `vehicle_commands.result`a yazıyor (kanıt: commandListener
 * `case 'read_dtc' → executeReadDtc()`), yani zincirin tek kopuk halkası
 * telefonun OKUMA yoluydu.
 *
 * ── KİLİTLENEN INVARIANT ─────────────────────────────────────────────────
 * "0 arıza" ile "okunamadı" AYNI ŞEY DEĞİLDİR. `completed` taşıma
 * tamamlanmasıdır, ÖLÇÜM BAŞARISI DEĞİLDİR (F0 invariantı).
 */

import { describe, it, expect } from 'vitest';
import {
  classifyDtcCommand,
  describeDtcOutcome,
  hasAnySuccessfulRead,
  isFullyUnsupported,
  parseDtcResult,
  type DtcCommandRow,
} from '@/lib/diagnostics/dtcResultContract';

const VEHICLE = 'veh-1';

function row(over: Partial<DtcCommandRow> = {}): DtcCommandRow {
  return {
    id: 'cmd-1',
    vehicle_id: VEHICLE,
    type: 'read_dtc',
    status: 'completed',
    result: null,
    error_message: null,
    ...over,
  };
}

function classify(over: Partial<DtcCommandRow> = {}, extra: { maxAgeMs?: number; now?: number } = {}) {
  return classifyDtcCommand({
    row: row(over),
    expectedVehicleId: VEHICLE,
    expectedType: 'read_dtc',
    ...extra,
  });
}

const OK_COMPLETENESS = { stored: 'ok', pending: 'ok', permanent: 'ok' } as const;

describe('F2.1 · güvenlik bağı', () => {
  it('1 — satır okunamazsa telefon SONUÇ ÜRETMEZ', () => {
    expect(classifyDtcCommand({
      row: null, expectedVehicleId: VEHICLE, expectedType: 'read_dtc',
    })).toMatchObject({ kind: 'FAILED' });
  });

  it('2 — komut BAŞKA araca aitse reddedilir (IDOR ek savunması)', () => {
    /* Birincil koruma RLS'tedir ("commands: okuyabilir" →
       is_vehicle_owner OR is_paired); bu, id bilmenin yetmediğini
       istemci tarafında da kilitler. */
    expect(classify({ vehicle_id: 'baska-arac' }))
      .toMatchObject({ kind: 'FAILED', reason: 'Komut bu araca ait değil' });
  });

  it('3 — YANLIŞ komut türünün sonucu DTC olarak yorumlanmaz', () => {
    expect(classify({ type: 'read_voltage', result: { voltage: 12.6 } }))
      .toMatchObject({ kind: 'FAILED', reason: 'Komut türü teşhis okuması değil' });
  });
});

describe('F2.1 · yaşam döngüsü durumları', () => {
  it('4 — beklemedeki komut WAITING_FOR_VEHICLE', () => {
    for (const status of ['pending', 'queued', 'received', 'sent', 'accepted']) {
      expect(classify({ status }), status).toMatchObject({ kind: 'WAITING_FOR_VEHICLE' });
    }
  });

  it('5 — araç yürütürken READING', () => {
    expect(classify({ status: 'executing' })).toMatchObject({ kind: 'READING' });
  });

  it('6 — süresi geçen komut TIMEOUT (arıza yok DEĞİL)', () => {
    const out = classify({ status: 'expired' });
    expect(out.kind).toBe('TIMEOUT');
    expect(describeDtcOutcome(out)).not.toContain('Arıza kodu bulunamadı');
  });

  it('7 — araç bağlantısı yoksa OFFLINE', () => {
    /* Yürütücünün gerçek gerekçesi: "Araç bağlantısı yok: teşhis okuması
       yapılamadı" (remoteDiagnosticCommands.NO_LINK_REASON). */
    expect(classify({
      status: 'failed',
      error_message: 'Araç bağlantısı yok: teşhis okuması yapılamadı',
    })).toMatchObject({ kind: 'OFFLINE' });
  });

  it('8 — bilinmeyen durum kodu UYDURULMAZ, beklenir', () => {
    expect(classify({ status: 'bilinmeyen_durum' }))
      .toMatchObject({ kind: 'WAITING_FOR_VEHICLE' });
  });
});

describe('F2.1 · ölçüm gerçeği', () => {
  it('9 — `completed` ama SONUÇ YOKSA ölçüm başarısı SAYILMAZ (F0 invariantı)', () => {
    const out = classify({ status: 'completed', result: null });
    expect(out).toMatchObject({ kind: 'FAILED', reason: 'Araç ölçüm sonucu yazmadı' });
    /* Taşıma tamamlanması, teşhis başarısına DÖNÜŞMEZ. */
    expect(out.kind).not.toBe('NO_DTC');
  });

  it('10 — bozuk gövde FAILED olur, sessizce boş listeye çevrilmez', () => {
    for (const bad of [{}, { dtcs: 'x' }, { dtcs: [{ severity: 'info' }] }, [], 'metin']) {
      const out = classify({ result: bad });
      expect(out.kind, JSON.stringify(bad)).toBe('FAILED');
    }
  });

  it('11 — başarılı BOŞ okuma NO_DTC olur', () => {
    const out = classify({
      result: { dtcs: [], completeness: OK_COMPLETENESS, readAt: new Date().toISOString() },
    });
    expect(out).toMatchObject({ kind: 'NO_DTC', partial: false });
    expect(describeDtcOutcome(out)).toBe('Arıza kodu bulunamadı');
  });

  it('12 — hiçbir servis okunamadıysa boş liste KANIT DEĞİLDİR', () => {
    const out = classify({
      result: { dtcs: [], completeness: { stored: 'failed', pending: 'failed', permanent: 'failed' } },
    });
    expect(out).toMatchObject({ kind: 'FAILED', reason: 'Teşhis servisleri okunamadı' });
  });

  it('13 — araç servisleri hiç desteklemiyorsa UNSUPPORTED (arıza yok DEĞİL)', () => {
    const out = classify({
      result: {
        dtcs: [],
        completeness: { stored: 'unsupported', pending: 'unsupported', permanent: 'unsupported' },
      },
    });
    expect(out.kind).toBe('UNSUPPORTED');
  });

  it('14 — DTC listesi RESULT olarak döner ve alanlar korunur', () => {
    const out = classify({
      result: {
        dtcs: [{ code: 'P0571', severity: 'warning', system: 'Fren', desc: 'Fren Pedalı Anahtarı Devresi', status: 'stored' }],
        completeness: OK_COMPLETENESS,
        readAt: '2026-09-18T07:00:00.000Z',
      },
    });
    expect(out).toMatchObject({ kind: 'RESULT', partial: false });
    if (out.kind !== 'RESULT') throw new Error('beklenen RESULT');
    expect(out.dtcs[0]).toMatchObject({
      code: 'P0571', severity: 'warning', system: 'Fren', status: 'stored',
    });
  });

  it('15 — kısmi tarama açıkça bildirilir', () => {
    const out = classify({
      result: { dtcs: [], partial: true, completeness: { stored: 'ok', pending: 'failed' } },
    });
    expect(out).toMatchObject({ kind: 'NO_DTC', partial: true });
    expect(describeDtcOutcome(out)).toContain('kısmi');
  });

  it('16 — bayat sonuç STALE işaretlenir', () => {
    const out = classify(
      { result: { dtcs: [], completeness: OK_COMPLETENESS, readAt: '2026-09-18T06:00:00.000Z' } },
      { maxAgeMs: 60_000, now: Date.parse('2026-09-18T07:00:00.000Z') },
    );
    expect(out.kind).toBe('STALE');
  });

  it('17 — açıklama gelmezse UYDURULMAZ', () => {
    /* Telefonda PARALEL DTC SÖZLÜĞÜ kurulmaz; açıklama aracın otoritesinden
       gelir. Yoksa dürüstçe "tanım yok" denir. */
    const parsed = parseDtcResult({ dtcs: [{ code: 'P1234', severity: 'info', system: 'Motor' }] });
    expect(parsed?.dtcs[0].desc).toBe('Tanımı mevcut değil');
  });
});

describe('F2.1 · bütünlük yardımcıları', () => {
  it('eski kayıtlarda completeness yoksa okuma yapılmış sayılır', () => {
    expect(hasAnySuccessfulRead(undefined)).toBe(true);
  });

  it('tek bir başarılı servis bile okuma kanıtıdır', () => {
    expect(hasAnySuccessfulRead({ stored: 'failed', pending: 'ok' })).toBe(true);
  });

  it('unsupported KAPSAM KAYBI değildir; kısmi saymaz', () => {
    expect(isFullyUnsupported({ stored: 'unsupported', pending: 'unsupported' })).toBe(true);
    expect(isFullyUnsupported({ stored: 'unsupported', pending: 'ok' })).toBe(false);
  });
});
