/**
 * shareReportDiagnosticWiringF54A.test.ts — GERÇEK PAYLAŞIM ZİNCİRİ.
 *
 * ── TEMEL İLKE ──────────────────────────────────────────────────────────
 *   "Rapor motoru teşhis geçmişini destekliyor"
 *   ≠
 *   "Gerçek kullanıcı raporu teşhis geçmişini kullanıyor."
 *
 * F5.4 sözleşmeyi kurdu; bu tur onu GERÇEK çağırana bağlar. Buradaki
 * kilitler, bağlantıyı koparan ya da üç durumu (kaynak yok / okunamadı /
 * kayıt yok) birbirine çeviren her değişiklikte DÜŞER.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ── Supabase sahtesi — okuyucu testleri için ──────────────────────────── */

const mockState: {
  result: { data: unknown; error: unknown };
  lastFilter: { column?: string; value?: unknown };
  throws: boolean;
} = { result: { data: [], error: null }, lastFilter: {}, throws: false };

const builder = {
  select: () => builder,
  eq: (column: string, value: unknown) => {
    mockState.lastFilter = { column, value };
    return builder;
  },
  order: () => builder,
  limit: () => {
    if (mockState.throws) throw new Error('ağ');
    return Promise.resolve(mockState.result);
  },
};

vi.mock('@/lib/supabase', () => ({
  supabaseBrowser: { from: () => builder },
  isSupabaseConfigured: true,
}));

import { loadDiagnosticScans } from '@/lib/diagnostics/diagnosticScansReader';
import { buildVehicleShareReport } from '@/lib/reports/vehicleShareReport';
import type { DiagnosticScanRecord } from '@/lib/diagnostics/diagnosticHistory';

const NOW = 2_300_000_000_000;
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
const P0300 = { code: 'P0300', severity: 'critical', system: 'Motor', desc: 'Ateşleme' };

const okRow = (over: Record<string, unknown> = {}) => ({
  vehicle_id: 'veh-a', source_command_id: 'cmd-secret-1', status: 'RESULT',
  measured_at: iso(86_400_000), completed_at: iso(86_400_000), partial: false,
  completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
  permanent_supported: true, dtcs: [P0300], failure_reason: null, ...over,
});

beforeEach(() => {
  mockState.result = { data: [], error: null };
  mockState.lastFilter = {};
  mockState.throws = false;
});

const report = (diagnosticScans: readonly DiagnosticScanRecord[] | null | undefined) =>
  buildVehicleShareReport({
    now: NOW, title: '34 ABC 123', subtitle: null,
    health: null, weekly: null, events: [], diagnosticScans,
  });

/* ── 1. Okuyucu: üç durum birbirine çevrilmez ──────────────────────────── */

describe('F5.4A · okuyucu üç durumu AYRI tutar', () => {
  it('1. 🔒 TABLO YOK → `undefined` (kaynak yok), ASLA `[]`', async () => {
    mockState.result = { data: null, error: { code: 'PGRST205', message: 'not found' } };
    const out = await loadDiagnosticScans('veh-a');
    /* MUTASYON KAPISI: `[]` dönerse rapor "geçmiş yok" der — yani migration
       uygulanmadığı için sessizce "arıza yok" iddiası doğar. */
    expect(out).toBeUndefined();
    expect(out).not.toEqual([]);
  });

  it('2. 🔒 OKUMA HATASI → `null`, ASLA `[]`', async () => {
    mockState.result = { data: null, error: { code: '42501', message: 'denied' } };
    const out = await loadDiagnosticScans('veh-a');
    expect(out).toBeNull();
    expect(out).not.toEqual([]);
  });

  it('3. 🔒 ağ istisnası → `null` (sessiz boş liste YOK)', async () => {
    mockState.throws = true;
    expect(await loadDiagnosticScans('veh-a')).toBeNull();
  });

  it('4. 🔒 başarılı okuma + kayıt yok → `[]` (gerçekten boş)', async () => {
    mockState.result = { data: [], error: null };
    expect(await loadDiagnosticScans('veh-a')).toEqual([]);
  });

  it('5. 🔒 başarılı okuma → KANONİK sözleşmeye çevrilir (ham satır sızmaz)', async () => {
    mockState.result = { data: [okRow()], error: null };
    const out = await loadDiagnosticScans('veh-a');
    expect(out).toHaveLength(1);
    expect(out![0]).toHaveProperty('sourceCommandId');
    /* Ham Supabase alan adları sunum katmanına GEÇMEZ. */
    expect(out![0]).not.toHaveProperty('measured_at');
    expect(out![0]).not.toHaveProperty('vehicle_id');
  });

  it('6. 🔒 bozuk satır kayıt UYDURMAZ, geçerliler korunur', async () => {
    mockState.result = { data: [{ status: 'BOGUS' }, okRow()], error: null };
    const out = await loadDiagnosticScans('veh-a');
    expect(out).toHaveLength(1);
    expect(out![0]!.status).toBe('RESULT');
  });

  it('7. 🔒 okuma ARAÇ KAPSAMLIDIR', async () => {
    await loadDiagnosticScans('veh-b');
    expect(mockState.lastFilter).toEqual({ column: 'vehicle_id', value: 'veh-b' });
  });
});

/* ── 2. Bağlı rapor: üç durum ayrı cümle ───────────────────────────────── */

describe('F5.4A · bağlı rapor üç durumu ayırır', () => {
  it('8. 🔒 KAYNAK YOK ≠ arıza yok', () => {
    const r = report(undefined);
    expect(r.text).toContain('bu kurulumda tutulmuyor');
    expect(r.text).not.toContain('arıza kodu bulunmadı');
  });

  it('9. 🔒 OKUNAMADI ≠ KAYNAK YOK ≠ arıza yok', () => {
    const fail = report(null);
    expect(fail.text).toContain('okunamadı');
    expect(fail.text).not.toContain('bu kurulumda tutulmuyor');
    expect(fail.text).not.toContain('arıza kodu bulunmadı');
  });

  it('10. 🔒 KAYIT YOK ≠ arıza yok', () => {
    const r = report([]);
    expect(r.text).toContain('kayıtlı arıza taraması bulunmuyor');
    expect(r.limitations.join(' ')).toContain('BİLİNMİYOR');
  });

  it('11. 🔒 üç durumun metni birbirinden FARKLIDIR', () => {
    const texts = [report(undefined).text, report(null).text, report([]).text];
    expect(new Set(texts).size).toBe(3);
  });
});

/* ── 3. Gizlilik: gerçek zincirde ──────────────────────────────────────── */

describe('F5.4A · paylaşılan metinde iç veri yok', () => {
  it('12. 🔒 komut kimliği / tablo adı / backend iç verisi GEÇMEZ', async () => {
    mockState.result = { data: [okRow()], error: null };
    const scans = await loadDiagnosticScans('veh-a');
    const r = report(scans);
    expect(r.text).not.toContain('cmd-secret-1');
    expect(r.text).not.toContain('vehicle_diagnostic_scans');
    expect(r.text).not.toContain('source_command_id');
    expect(r.text).not.toMatch(/VF1[A-Z0-9]{14}/);
    /* Kullanıcının ürün bilgisi GÖSTERİLİR. */
    expect(r.text).toContain('P0300');
  });
});

/* ── 4. Panel bağlantısı (kaynak kilitleri) ────────────────────────────── */

describe('F5.4A · gerçek çağıran bağlı ve TEK okuma otoritesi var', () => {
  const PANEL = readFileSync(
    join(process.cwd(), 'src/components/pwa/VehicleMemoryPanel.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  it('13. 🔒 gerçek paylaşım çağrısı `diagnosticScans` TAŞIR', () => {
    /* MUTASYON KAPISI: bu satır düşerse rapor motoru desteklese de gerçek
       kullanıcı raporu teşhis geçmişini KULLANMAZ. */
    expect(PANEL).toMatch(/buildVehicleShareReport\([\s\S]{0,600}diagnosticScans/);
  });

  it('14. 🔒 hafıza ve rapor AYNI okumayı kullanır (ikinci sorgu yok)', () => {
    expect(PANEL).toContain('loadDiagnosticScans');
    /* Panel kendi Supabase sorgusunu AÇMAZ. */
    expect(PANEL).not.toContain("from('vehicle_diagnostic_scans')");
    expect(PANEL).not.toContain('supabaseBrowser');
    /* Tek çağrı: aynı turda hem hafızaya hem rapora verilir. */
    expect((PANEL.match(/loadDiagnosticScans\(/g) ?? [])).toHaveLength(1);
  });

  it('15. 🔒 teşhis okuması AYNI paralel turda yapılır', () => {
    expect(PANEL).toMatch(/Promise\.all\(\[[\s\S]{0,400}loadDiagnosticScans\(vehicleId\)/);
  });

  it('16. 🔒 GEÇ GELEN SONUÇ koruması korunur (araç değişimi yarışı)', () => {
    /* A okunurken B'ye geçilirse A'nın taraması B'nin raporuna SIZAMAZ. */
    expect(PANEL).toContain('requestedFor.current !== vehicleId');
    expect(PANEL).toMatch(/requestedFor\.current\s*!==\s*vehicleId\)\s*return/);
  });

  it('17. 🔒 araç yokken teşhis durumu SIFIRLANIR (eski araç sızmaz)', () => {
    expect(PANEL).toMatch(/setDiagnosticScans\(undefined\)/);
  });

  it('18. 🔒 paylaşım taşıması DEĞİŞMEDİ (share → clipboard yedeği)', () => {
    expect(PANEL).toContain('nav.share');
    expect(PANEL).toContain('nav.clipboard');
    expect(PANEL).toContain('writeText');
    /* Yeni paylaşım kütüphanesi EKLENMEDİ. */
    expect(PANEL).not.toMatch(/from '(react-share|share-api|copy-to-clipboard)'/);
  });

  it('19. 🔒 Share düğmesi kanonik yükleme BİTMEDEN render edilmez', () => {
    /* `!memory` iken panel erken döner → "yükleniyor" sırasında sahte `[]`
       ile rapor üretilemez (§7). */
    expect(PANEL).toMatch(/if\s*\(!memory\)\s*\{[\s\S]{0,300}return/);
  });
});
