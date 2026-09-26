/**
 * diagnosticHistoryF53.test.ts — KALICI TEŞHİS GEÇMİŞİ.
 *
 * ── TEMEL İLKE ──────────────────────────────────────────────────────────
 *   "Geçmişte gördük"      ≠ "Şu anda var"
 *   "Bu taramada görmedik" ≠ "Tamir edildi"
 *
 * Kalıcı geçmişin görevi hüküm uydurmak değil, aracın gerçekten ÖLÇÜLMÜŞ
 * teşhis geçmişini dürüstçe hatırlamaktır.
 *
 * Buradaki kilitler, başarısız/kısmi/eski bir taramayı "arıza yok" ya da
 * "sağlıklı" diye sunan her değişiklikte DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildDiagnosticScanRecord,
  buildDtcSightings,
  latestSuccessfulScan,
  scanCanClaimZeroDtc,
  scanSucceeded,
  summarizeScan,
  type DiagnosticScanRecord,
} from '@/lib/diagnostics/diagnosticHistory';
import type { DtcCommandRow } from '@/lib/diagnostics/dtcResultContract';

const NOW = 2_000_000_000_000;
const VEH_A = 'veh-aaaa';
const VEH_B = 'veh-bbbb';
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();

/** Tamamlanmış `read_dtc` komut satırı. */
function cmd(over: Partial<DtcCommandRow> = {}): DtcCommandRow {
  return {
    id: 'cmd-1',
    vehicle_id: VEH_A,
    type: 'read_dtc',
    status: 'completed',
    result: {
      dtcs: [],
      readAt: iso(60_000),
      partial: false,
      completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
    },
    error_message: null,
    finished_at: iso(50_000),
    ...over,
  };
}

const build = (row: DtcCommandRow, vehicleId = VEH_A) =>
  buildDiagnosticScanRecord(row, vehicleId, NOW);

const P0300 = { code: 'P0300', severity: 'critical' as const, system: 'Motor', desc: 'Ateşleme' };

/* ── 1. Başarılı tarama → kalıcı kayıt ─────────────────────────────────── */

describe('F5.3 · başarılı tarama kalıcı kayda döner', () => {
  it('1. 🔒 kod bulundu → RESULT ve kodlar korunur', () => {
    const rec = build(cmd({ result: { dtcs: [P0300], readAt: iso(60_000), partial: false,
      completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' } } }));
    expect(rec?.status).toBe('RESULT');
    expect(rec?.dtcs.map((d) => d.code)).toEqual(['P0300']);
    expect(rec?.measuredAt).toBe(iso(60_000));
    expect(rec?.sourceCommandId).toBe('cmd-1');
  });

  it('2. 🔒 tam tarama + sıfır kod → NO_DTC (kod yok İDDİASI EDİLEBİLİR)', () => {
    const rec = build(cmd());
    expect(rec?.status).toBe('NO_DTC');
    expect(rec?.dtcs).toEqual([]);
    expect(scanCanClaimZeroDtc(rec!.status)).toBe(true);
  });

  it('3. 🔒 uçuştaki komut KALICILAŞTIRILMAZ (yarım gerçek saklanmaz)', () => {
    expect(build(cmd({ status: 'pending' }))).toBeNull();
    expect(build(cmd({ status: 'executing' }))).toBeNull();
  });
});

/* ── 2. Başarısızlık ≠ kod yok ─────────────────────────────────────────── */

describe('F5.3 · başarısız tarama "arıza yok" DEMEZ', () => {
  it('4. 🔒 TIMEOUT ≠ kod yok', () => {
    const rec = build(cmd({ status: 'timeout', result: null, error_message: 'Araç yanıt vermedi' }));
    expect(rec?.status).toBe('TIMEOUT');
    expect(scanCanClaimZeroDtc(rec!.status)).toBe(false);
    expect(summarizeScan(rec!).claimsZeroDtc).toBe(false);
  });

  it('5. 🔒 OFFLINE ≠ kod yok', () => {
    const rec = build(cmd({ status: 'failed', result: null, error_message: 'Araç bağlantısı yok' }));
    expect(rec?.status).toBe('OFFLINE');
    expect(scanCanClaimZeroDtc(rec!.status)).toBe(false);
  });

  it('6. 🔒 UNSUPPORTED ≠ sağlıklı', () => {
    const rec = build(cmd({ result: { dtcs: [], readAt: iso(60_000),
      completeness: { stored: 'unsupported', pending: 'unsupported', permanent: 'unsupported' } } }));
    expect(rec?.status).toBe('UNSUPPORTED');
    expect(scanSucceeded(rec!.status)).toBe(false);
    expect(summarizeScan(rec!).headline).not.toMatch(/sağlık|arıza kodu bulunmadı/i);
  });

  it('7. 🔒 hiçbir servis okunamadı → FAILED (boş liste KANIT DEĞİL)', () => {
    const rec = build(cmd({ result: { dtcs: [], readAt: iso(60_000),
      completeness: { stored: 'failed', pending: 'failed', permanent: 'failed' } } }));
    expect(rec?.status).toBe('FAILED');
    expect(scanCanClaimZeroDtc(rec!.status)).toBe(false);
  });

  it('8. 🔒 `completed` ama araç gövde yazmadı → FAILED (teslim ≠ ölçüm)', () => {
    const rec = build(cmd({ result: null }));
    expect(rec?.status).toBe('FAILED');
    expect(rec?.dtcs).toEqual([]);
  });

  it('9. 🔒 başarısız kayıt KOD TAŞIMAZ (DB kısıtının kod tarafı karşılığı)', () => {
    for (const row of [
      cmd({ status: 'timeout', result: null, error_message: 'yanıt yok' }),
      cmd({ status: 'failed',  result: null, error_message: 'bağlantı yok' }),
      cmd({ result: null }),
    ]) {
      expect(build(row)!.dtcs.length).toBe(0);
    }
  });
});

/* ── 3. Kısmi ≠ tam ────────────────────────────────────────────────────── */

describe('F5.3 · kısmi tarama tam tarama gibi sunulmaz', () => {
  it('10. 🔒 kısmi + sıfır kod → "kod yok" İDDİA EDİLMEZ', () => {
    const rec = build(cmd({ result: { dtcs: [], readAt: iso(60_000), partial: true,
      completeness: { stored: 'ok', pending: 'failed', permanent: 'ok' } } }));
    expect(rec?.status).toBe('NO_DTC');
    expect(rec?.partial).toBe(true);
    /* MUTASYON KAPISI: kısmi tarama "kapsamda kod yok" diyemez. */
    expect(summarizeScan(rec!).claimsZeroDtc).toBe(false);
    expect(summarizeScan(rec!).headline).toContain('kısmi');
  });

  it('11. 🔒 kapsam sınırları KAYBOLMAZ', () => {
    const rec = build(cmd({ result: { dtcs: [], readAt: iso(60_000), partial: true,
      completeness: { stored: 'ok', pending: 'failed', permanent: 'unsupported' } } }));
    const s = summarizeScan(rec!);
    expect(rec?.completeness).toEqual({ stored: 'ok', pending: 'failed', permanent: 'unsupported' });
    expect(s.limitations.join(' ')).toMatch(/Bekleyen/);
    expect(s.limitations.join(' ')).toMatch(/Kalıcı/);
  });

  it('12. 🔒 tam tarama kısmi ile AYNI cümleyi kurmaz', () => {
    const full    = summarizeScan(build(cmd())!);
    const partial = summarizeScan(build(cmd({ result: { dtcs: [], readAt: iso(60_000),
      partial: true, completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' } } }))!);
    expect(full.headline).not.toBe(partial.headline);
    expect(full.claimsZeroDtc).toBe(true);
    expect(partial.claimsZeroDtc).toBe(false);
  });
});

/* ── 4. İdempotens ve tarama kimliği ───────────────────────────────────── */

describe('F5.3 · aynı komut tek kayıt, iki gerçek tarama iki kayıt', () => {
  it('13. 🔒 aynı komut iki kez işlenirse AYNI kimlik üretilir', () => {
    const row = cmd({ result: { dtcs: [P0300], readAt: iso(60_000), partial: false,
      completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' } } });
    expect(build(row)!.sourceCommandId).toBe(build(row)!.sourceCommandId);
  });

  it('14. 🔒 İKİ AYRI tarama aynı kodu verse de AYRI kayıttır', () => {
    const body = { dtcs: [P0300], readAt: iso(60_000), partial: false,
      completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' } };
    const a = build(cmd({ id: 'cmd-1', result: body }));
    const b = build(cmd({ id: 'cmd-2', result: { ...body, readAt: iso(10_000) } }));
    /* DTC listesi tarama kimliği DEĞİLDİR. */
    expect(a!.sourceCommandId).not.toBe(b!.sourceCommandId);
  });
});

/* ── 5. Araç izolasyonu ────────────────────────────────────────────────── */

describe('F5.3 · araçlar arası sızma yok', () => {
  it('15. 🔒 başka aracın komut satırı bu aracın geçmişine YAZILAMAZ', () => {
    const rec = build(cmd({ vehicle_id: VEH_B }), VEH_A);
    expect(rec?.status).toBe('FAILED');
    expect(rec?.failureReason).toMatch(/bu araca ait değil/i);
    expect(rec?.dtcs).toEqual([]);
  });

  it('16. 🔒 yanlış komut türü teşhis olarak yorumlanmaz', () => {
    const rec = build(cmd({ type: 'read_voltage' }));
    expect(rec?.status).toBe('FAILED');
  });

  it('17. 🔒 kayıt DAİMA beklenen araca bağlanır', () => {
    expect(build(cmd())!.vehicleId).toBe(VEH_A);
  });
});

/* ── 6. Geçmiş ≠ güncel ────────────────────────────────────────────────── */

describe('F5.3 · geçmişte görülen kod güncel arıza değildir', () => {
  const scan = (over: Partial<DiagnosticScanRecord>): DiagnosticScanRecord => ({
    sourceCommandId: 'c', vehicleId: VEH_A, status: 'NO_DTC', measuredAt: iso(0),
    completedAt: null, partial: false, completeness: null, permanentSupported: null,
    dtcs: [], failureReason: null, ...over,
  });

  it('18. 🔒 eski kod "görüldü" dilinde kalır, "hâlâ var" DEMEZ', () => {
    const sightings = buildDtcSightings([
      scan({ sourceCommandId: 'new', status: 'NO_DTC', measuredAt: iso(0) }),
      scan({ sourceCommandId: 'old', status: 'RESULT', measuredAt: iso(30 * 86_400_000), dtcs: [P0300] }),
    ]);
    const s = sightings.find((x) => x.code === 'P0300')!;
    expect(s.seenInScans).toBe(1);
    expect(s.lastSeenAt).toBe(iso(30 * 86_400_000));
    /* En son taramada GÖRÜLMEDİ — ama bu "tamir edildi" DEĞİLDİR; sözleşme
       yalnız görülme kanıtı taşır, hüküm alanı YOKTUR. */
    expect(s.seenInLatestScan).toBe(false);
    expect(Object.keys(s)).not.toContain('repaired');
    expect(Object.keys(s)).not.toContain('resolved');
  });

  it('19. 🔒 BAŞARISIZ tarama "görülmedi" kanıtı ÜRETMEZ', () => {
    const sightings = buildDtcSightings([
      scan({ sourceCommandId: 'to', status: 'TIMEOUT', measuredAt: null, failureReason: 'yanıt yok' }),
      scan({ sourceCommandId: 'old', status: 'RESULT', measuredAt: iso(86_400_000), dtcs: [P0300] }),
    ]);
    const s = sightings.find((x) => x.code === 'P0300')!;
    /* En son BAŞARILI tarama hâlâ kodu gördü → timeout onu silemez. */
    expect(s.seenInLatestScan).toBe(true);
  });

  it('20. 🔒 hiç başarılı tarama yoksa "son tarama" YOKTUR (arıza yok DEĞİL)', () => {
    expect(latestSuccessfulScan([
      scan({ status: 'TIMEOUT', failureReason: 'x' }),
      scan({ status: 'OFFLINE', failureReason: 'x' }),
    ])).toBeNull();
    expect(latestSuccessfulScan([])).toBeNull();
  });

  it('21. 🔒 geçmiş projeksiyonu HÜKÜM dili üretmez', () => {
    const summaries = (['RESULT','NO_DTC','UNSUPPORTED','OFFLINE','TIMEOUT','FAILED','STALE'] as const)
      .map((status) => summarizeScan(scan({
        status,
        dtcs: status === 'RESULT' ? [P0300] : [],
        failureReason: status === 'RESULT' || status === 'NO_DTC' ? null : 'x',
      })));
    for (const s of summaries) {
      expect(s.headline).not.toMatch(/tamir edildi|çözüldü|araç sağlam|sorun yok|sağlıklı/i);
    }
  });
});

/* ── 7. Geçmiş güncel hüküm/bildirim ÜRETEMEZ (§8 · §17) ───────────────── */

describe('F5.3 · geçmiş, güncel sağlık ve bildirim sınırını AŞAMAZ', () => {
  const read = (rel: string) =>
    readFileSync(resolve(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  it('22. 🔒 teşhis geçmişi F2.2 sağlık motoruna BAĞLANMAZ', () => {
    /* MUTASYON KAPISI: `diagnosticHistory` sağlık hükmü üretmeye başlarsa
       "30 gün önce P0300 → bugün CRITICAL" yolu açılır. */
    const diag = read('src/lib/diagnostics/diagnosticHistory.ts');
    expect(diag).not.toContain('vehicleHealth');
    expect(diag).not.toContain('buildVehicleHealthSummary');
    expect(diag).not.toContain('CRITICAL');
    expect(diag).not.toContain('WARNING');
  });

  it('23. 🔒 bildirim taraması geçmişi YALNIZ güncellik kapısından alır', () => {
    /* ── SÖZLEŞME GELİŞTİ (F5.4) ───────────────────────────────────────
     * F5.3'te bu kilit "geçmişe hiç dokunma" diyordu; o dönemde kalıcı
     * kaynak bildirim yoluna BİLİNÇLİ olarak bağlanmamıştı. F5.4 onu
     * bağladı — ama HAM olarak değil, kanonik güven penceresinden
     * (`DTC_HEALTH_MAX_AGE_MS`) geçirerek.
     *
     * Korunan gerçek invariant AYNI: ESKİ bir arıza kodu her cron turunda
     * yeniden bildirim ÜRETEMEZ. Kapı aşılırsa sonuç `STALE` olur ve F2.2
     * onu `NO_EVIDENCE` sayar. */
    const scan = read('../supabase/functions/consumer-notify-scan/index.ts');
    expect(scan).toContain('durableScanToCurrentDtcEvidence');
    /* MUTASYON KAPISI: ham satırı doğrudan sağlık girdisine vermek YASAK. */
    expect(scan).not.toMatch(/dtc:\s*(scanRes|latestScan\s*[,}])/);
    expect(scan).not.toMatch(/dtc:\s*rowToDiagnosticScanRecord/);
  });

  it('24. 🔒 kalıcı kayıt tipi, güncel teşhis girdisiyle AYNI TİP DEĞİLDİR', () => {
    /* `evaluateVehicleNotification` `DtcOutcome` bekler; kalıcı kayıt
       `DiagnosticScanRecord`tır. Tip sistemi geçmişin güncel kanıt yerine
       geçmesini DERLEME ZAMANINDA engeller. */
    const rec = build(cmd({ result: { dtcs: [P0300], readAt: iso(60_000), partial: false,
      completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' } } }))!;
    expect(rec).toHaveProperty('sourceCommandId');
    expect(rec).not.toHaveProperty('kind');
  });
});
