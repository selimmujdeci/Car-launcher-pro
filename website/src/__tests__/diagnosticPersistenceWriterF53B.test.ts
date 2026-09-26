/**
 * diagnosticPersistenceWriterF53B.test.ts — KALICI TEŞHİS YAZICISI.
 *
 * ── TEMEL İLKE ──────────────────────────────────────────────────────────
 *   "Sonuç geçici tabloda görüldü"
 *   ≠
 *   "Kalıcı geçmişe güvenle kaydedildi."
 *
 * Kalıcı geçmiş ancak sunucu tarafı DURABLE WRITE kanıtlandıktan sonra
 * oluşmuş sayılır. Buradaki kilitler, yazıcının ikinci bir yorumcu doğurduğu,
 * tarayıcıya bağlandığı, bozuk satırda tüm turu durdurduğu ya da başarısız
 * satırı kalıcı olarak atladığı her değişiklikte DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { planDiagnosticPersistence } from '@/lib/diagnostics/diagnosticPersistencePlan';
import type { DtcCommandRow } from '@/lib/diagnostics/dtcResultContract';

const NOW = 2_100_000_000_000;
const VEH_A = 'veh-aaaa';
const VEH_B = 'veh-bbbb';
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();

const P0300 = { code: 'P0300', severity: 'critical' as const, system: 'Motor', desc: 'Ateşleme' };
const OK = { stored: 'ok', pending: 'ok', permanent: 'ok' } as const;

function cmd(over: Partial<DtcCommandRow> = {}): DtcCommandRow {
  return {
    id: 'cmd-1',
    vehicle_id: VEH_A,
    type: 'read_dtc',
    status: 'completed',
    result: { dtcs: [], readAt: iso(60_000), partial: false, completeness: OK },
    error_message: null,
    finished_at: iso(50_000),
    ...over,
  };
}

const plan = (commands: DtcCommandRow[], already: string[] = []) =>
  planDiagnosticPersistence({
    now: NOW,
    commands,
    alreadyPersistedCommandIds: new Set(already),
  });

/** Edge Function kaynağı — yorumlar sökülür, `://` korunur. */
const WRITER = readFileSync(
  join(process.cwd(), '../supabase/functions/diagnostic-history-writer/index.ts'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

/* ── 1. Terminal sonuçlar kalıcılaşır ──────────────────────────────────── */

describe('F5.3B · terminal sonuç kalıcı kayda döner', () => {
  it('1. 🔒 RESULT → kayıt, kodlar korunur', () => {
    const p = plan([cmd({ result: { dtcs: [P0300], readAt: iso(60_000), partial: false, completeness: OK } })]);
    expect(p.records).toHaveLength(1);
    expect(p.records[0]!.status).toBe('RESULT');
    expect(p.records[0]!.dtcs.map((d) => d.code)).toEqual(['P0300']);
  });

  it('2. 🔒 NO_DTC → kayıt (başarılı tarama, kapsamda kod yok)', () => {
    const p = plan([cmd()]);
    expect(p.records[0]!.status).toBe('NO_DTC');
  });

  it('3. 🔒 TIMEOUT → timeout kaydı, "sıfır kod" DEĞİL', () => {
    const p = plan([cmd({ status: 'timeout', result: null, error_message: 'Araç yanıt vermedi' })]);
    expect(p.records[0]!.status).toBe('TIMEOUT');
    expect(p.records[0]!.dtcs).toEqual([]);
    expect(p.records[0]!.status).not.toBe('NO_DTC');
  });

  it('4. 🔒 OFFLINE → offline kaydı', () => {
    const p = plan([cmd({ status: 'failed', result: null, error_message: 'Araç bağlantısı yok' })]);
    expect(p.records[0]!.status).toBe('OFFLINE');
  });

  it('5. 🔒 FAILED → failed kaydı', () => {
    const p = plan([cmd({ status: 'failed', result: null, error_message: 'ECU hatası' })]);
    expect(p.records[0]!.status).toBe('FAILED');
  });

  it('6. 🔒 UNSUPPORTED → unsupported kaydı', () => {
    const p = plan([cmd({ result: { dtcs: [], readAt: iso(60_000),
      completeness: { stored: 'unsupported', pending: 'unsupported', permanent: 'unsupported' } } })]);
    expect(p.records[0]!.status).toBe('UNSUPPORTED');
  });

  it('7. 🔒 kısmi tarama bilgisi KORUNUR', () => {
    const p = plan([cmd({ result: { dtcs: [], readAt: iso(60_000), partial: true,
      completeness: { stored: 'ok', pending: 'failed', permanent: 'ok' } } })]);
    expect(p.records[0]!.partial).toBe(true);
    expect(p.records[0]!.completeness).toEqual({ stored: 'ok', pending: 'failed', permanent: 'ok' });
  });
});

/* ── 2. Uçuştaki komut kalıcılaşmaz ────────────────────────────────────── */

describe('F5.3B · terminal olmayan komut KALICILAŞMAZ', () => {
  it('8. 🔒 WAITING → kayıt yok', () => {
    const p = plan([cmd({ status: 'pending' })]);
    expect(p.records).toHaveLength(0);
    expect(p.tally.skippedNonTerminal).toBe(1);
  });

  it('9. 🔒 READING → kayıt yok', () => {
    const p = plan([cmd({ status: 'executing' })]);
    expect(p.records).toHaveLength(0);
    expect(p.tally.skippedNonTerminal).toBe(1);
  });
});

/* ── 3. İdempotens ─────────────────────────────────────────────────────── */

describe('F5.3B · aynı komut tek kayıt', () => {
  it('10. 🔒 zaten kalıcılaşmış komut ATLANIR', () => {
    const p = plan([cmd({ id: 'cmd-9' })], ['cmd-9']);
    expect(p.records).toHaveLength(0);
    expect(p.tally.deduped).toBe(1);
  });

  it('11. 🔒 süreç yeniden başlasa da dedupe KAYBOLMAZ (durum DB\'den gelir)', () => {
    /* MUTASYON KAPISI: dedupe bellek içi Set/singleton'a taşınırsa yazıcı
       her restart sonrası aynı komutu yeniden yazmaya çalışırdı. Plan
       fonksiyonu durumu DIŞARIDAN alır; kendi belleği YOKTUR. */
    expect(WRITER).not.toMatch(/const\s+\w*[Ss]een\w*\s*=\s*new\s+Set/);
    expect(WRITER).toContain('vehicle_diagnostic_scans');
    expect(WRITER).toContain('source_command_id');
  });

  it('12. 🔒 İKİ AYRI komut aynı kodu verse de İKİ kayıt olur', () => {
    const body = { dtcs: [P0300], readAt: iso(60_000), partial: false, completeness: OK };
    const p = plan([cmd({ id: 'cmd-1', result: body }), cmd({ id: 'cmd-2', result: body })]);
    expect(p.records).toHaveLength(2);
    expect(p.records.map((r) => r.sourceCommandId)).toEqual(['cmd-1', 'cmd-2']);
  });
});

/* ── 4. Araç bağı istemciden gelmez ────────────────────────────────────── */

describe('F5.3B · araç kapsamı KANONİK satırdan gelir', () => {
  it('13. 🔒 her kayıt KENDİ komut satırının aracına bağlanır', () => {
    const p = plan([cmd({ id: 'a', vehicle_id: VEH_A }), cmd({ id: 'b', vehicle_id: VEH_B })]);
    expect(p.records.map((r) => r.vehicleId)).toEqual([VEH_A, VEH_B]);
  });

  it('14. 🔒 plan fonksiyonu DIŞARIDAN vehicleId KABUL ETMEZ', () => {
    /* İmzada böyle bir parametre olsaydı "B'nin sonucunu A'ya yaz" mümkün
       olurdu. Tip sistemi bunu derleme zamanında engeller. */
    const src = readFileSync(
      join(process.cwd(), 'src/lib/diagnostics/diagnosticPersistencePlan.ts'), 'utf8');
    expect(src).not.toMatch(/vehicleId\s*:\s*string/);
    expect(src).toContain('row.vehicle_id');
  });
});

/* ── 5. Bozuk veri: fail-closed ama tur durmaz ─────────────────────────── */

describe('F5.3B · bozuk satır uydurulmaz ve turu durdurmaz', () => {
  it('15. 🔒 bozuk sonuç gövdesi UYDURULMAZ (FAILED, "arıza yok" değil)', () => {
    const p = plan([cmd({ result: { garbage: true } })]);
    expect(p.records[0]!.status).toBe('FAILED');
    expect(p.records[0]!.dtcs).toEqual([]);
  });

  it('16. 🔒 yapısal olarak kullanılamaz satır ATLANIR', () => {
    const p = plan([{ ...cmd(), id: '' }, { ...cmd(), vehicle_id: '' }]);
    expect(p.records).toHaveLength(0);
    expect(p.tally.skippedInvalid).toBe(2);
  });

  it('17. 🔒 TEK bozuk satır GEÇERLİ batch\'i durdurmaz', () => {
    const good = cmd({ id: 'good', result: { dtcs: [P0300], readAt: iso(60_000), partial: false, completeness: OK } });
    const p = plan([{ ...cmd(), id: '' }, good, { ...cmd(), vehicle_id: '' }]);
    expect(p.records).toHaveLength(1);
    expect(p.records[0]!.sourceCommandId).toBe('good');
    expect(p.tally.skippedInvalid).toBe(2);
    expect(p.tally.scanned).toBe(3);
  });
});

/* ── 6. Yazıcı mimarisi kilitleri ──────────────────────────────────────── */

describe('F5.3B · yazıcı sınırları', () => {
  it('18. 🔒 TARAYICI GEREKMEZ (service_role kapısı, PWA bağımlılığı yok)', () => {
    expect(WRITER).toContain('SERVICE_ROLE_KEY');
    expect(WRITER).toContain('Unauthorized');
    expect(WRITER).not.toContain('localStorage');
    expect(WRITER).not.toContain('vehicleStore');
    expect(WRITER).not.toContain('window.');
  });

  it('19. 🔒 İKİNCİ YORUMCU YOK — kanonik sınıflandırma kullanılır', () => {
    expect(WRITER).toContain('planDiagnosticPersistence');
    /* MUTASYON KAPISI: durum adlarını yazıcı kendisi üretmeye başlarsa
       ikinci bir yorumcu doğar. */
    expect(WRITER).not.toMatch(/status\s*[=:]\s*['"](RESULT|NO_DTC|TIMEOUT|OFFLINE|UNSUPPORTED)['"]/);
    expect(WRITER).not.toContain('parseDtcResult');
    expect(WRITER).not.toContain('classifyDtcCommand');
  });

  it('20. 🔒 İMLEÇ YOK — başarısız satır kalıcı olarak ATLANMAZ', () => {
    /* İlerleyen bir imleç/offset, yazılamayan satırı sonsuza dek atlardı.
       Yazıcı anti-join kullanır: kalıcılaşmamış satır bir sonraki turun
       adayı olarak KALIR. */
    expect(WRITER).not.toMatch(/\.range\(/);
    expect(WRITER).not.toMatch(/offset/i);
    expect(WRITER).not.toMatch(/last_processed|cursor/i);
    expect(WRITER).toContain('alreadyPersistedCommandIds');
  });

  it('21. 🔒 YALNIZ normalize sözleşme yazılır — ham veri KALICILAŞMAZ', () => {
    /* Ham `result` JSON'unun tamamı kopyalanırsa CAN çerçeveleri / ECU
       dökümleri / transport iç verisi kalıcı tüketici geçmişine sızar. */
    expect(WRITER).not.toMatch(/result:\s*row\.result/);
    expect(WRITER).not.toMatch(/raw|frames|debug_trace/i);
    for (const field of ['vehicle_id', 'source_command_id', 'status', 'measured_at',
      'completed_at', 'partial', 'completeness', 'permanent_supported', 'dtcs',
      'failure_reason']) {
      expect(WRITER).toContain(field);
    }
  });

  it('22. 🔒 yazıcı PUSH GÖNDERMEZ (F5.2B sınırı)', () => {
    expect(WRITER).not.toContain('consumer-push-notify');
    expect(WRITER).not.toContain('push_subscriptions');
    expect(WRITER).not.toContain('notification');
  });

  it('23. 🔒 yazıcı GÜNCEL SAĞLIĞI değiştirmez', () => {
    expect(WRITER).not.toContain('vehicle_telemetry');
    expect(WRITER).not.toContain('buildVehicleHealthSummary');
    expect(WRITER).not.toContain('consumer_notification_state');
  });

  it('24. 🔒 "kalıcılaştı" ile "işlendi" AYRI sayılır; teslim dili YOK', () => {
    expect(WRITER).toContain('persisted');
    expect(WRITER).toContain('eligible');
    /* Web Push terminolojisi teşhis yazıcısına SIZMAZ. */
    expect(WRITER).not.toContain('DELIVERED');
    expect(WRITER).not.toContain('SEEN');
  });

  it('25. 🔒 unique çakışması HATA sayılmaz (idempotensin kanıtı)', () => {
    expect(WRITER).toContain('23505');
  });

  it('26. 🔒 loglarda hassas içerik YOK', () => {
    const logs = [...WRITER.matchAll(/console\.(log|warn|error)\(([^;]*)\)/g)]
      .map((m) => m[2] ?? '').join(' ');
    for (const forbidden of ['vin', 'api_key', 'apiKey', 'dtcs', 'p256dh', 'Authorization']) {
      expect(logs.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
