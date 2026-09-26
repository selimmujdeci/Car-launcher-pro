/**
 * diagnosticProductClosureF54.test.ts — TEŞHİS ÜRÜN KAPANIŞI.
 *
 * ── TEMEL İLKELER ───────────────────────────────────────────────────────
 *   "Geçmişte gördük"        ≠ "Şu anda var."
 *   "Sonraki taramada görmedik" ≠ "Tamir edildi."
 *   "DTC bulundu"            ≠ "CRITICAL."
 *
 * Kalıcı geçmiş aracın GEÇMİŞİNİ anlatır; güncel sağlık motoru ŞU ANI
 * değerlendirir; bildirim yalnız gerçekten bildirmeye değer GÜNCEL kanıtı
 * haber verir. Buradaki kilitler bu üç sınırı karıştıran her değişiklikte
 * DÜŞER.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  durableScanToCurrentDtcEvidence,
  rowToDiagnosticScanRecord,
  type DiagnosticScanRecord,
} from '@/lib/diagnostics/diagnosticHistory';
import { DTC_HEALTH_MAX_AGE_MS } from '@/lib/diagnostics/dtcResultContract';
import { buildVehicleShareReport } from '@/lib/reports/vehicleShareReport';
import { judgeDtcEvidence } from '@/lib/diagnostics/vehicleHealth';

/** Yorumları söker; `://` korunur (URL yorum değildir). */
const pureCode = (rel: string) =>
  readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const NOW = 2_200_000_000_000;
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
const P0300 = { code: 'P0300', severity: 'critical' as const, system: 'Motor', desc: 'Ateşleme' };
const P0128 = { code: 'P0128', severity: 'warning' as const, system: 'Motor', desc: 'Termostat' };

function scan(over: Partial<DiagnosticScanRecord> = {}): DiagnosticScanRecord {
  return {
    sourceCommandId: 'cmd-1', vehicleId: 'veh-a', status: 'NO_DTC',
    measuredAt: iso(60_000), completedAt: iso(50_000), partial: false,
    completeness: { stored: 'ok', pending: 'ok', permanent: 'ok' },
    permanentSupported: true, dtcs: [], failureReason: null, ...over,
  };
}

const report = (diagnosticScans?: readonly DiagnosticScanRecord[] | null) =>
  buildVehicleShareReport({
    now: NOW, title: '34 ABC 123', subtitle: null,
    health: null, weekly: null, events: [],
    ...(diagnosticScans !== undefined ? { diagnosticScans } : {}),
  });

/* ── 1. Paylaşım raporu: üç durum AYRI ─────────────────────────────────── */

describe('F5.4 · rapor "kaynak yok" ile "kayıt yok"u ayırır', () => {
  it('1. 🔒 KAYNAK YOK ≠ geçmiş yok ≠ arıza yok', () => {
    const r = report(undefined);
    expect(r.text).toContain('Kalıcı arıza taraması kaydı bu kurulumda tutulmuyor');
    expect(r.limitations.join(' ')).toContain('"araçta arıza yok" anlamına GELMEZ');
    /* Asıl risk OLUMLU iddiadır. "arıza yok" ifadesi raporda YALNIZ onu
       REDDEDEN cümlenin içinde geçebilir; NO_DTC manşeti kurulamaz. */
    expect(r.text).not.toContain('arıza kodu bulunmadı');
    expect(r.text).not.toContain('Kontrol edilen sistemlerde sorun görülmedi');
  });

  it('2. 🔒 OKUNAMADI ≠ arıza yok', () => {
    const r = report(null);
    expect(r.text).toContain('okunamadı');
    expect(r.limitations.join(' ')).toContain('"araçta arıza yok" anlamına GELMEZ');
  });

  it('3. 🔒 KAYIT YOK ≠ arıza yok (hiç taranmadı)', () => {
    const r = report([]);
    expect(r.text).toContain('kayıtlı arıza taraması bulunmuyor');
    expect(r.limitations.join(' ')).toContain('BİLİNMİYOR');
  });
});

/* ── 2. Rapor dili: tarihli kanıt, hüküm değil ─────────────────────────── */

describe('F5.4 · rapor hüküm üretmez, tarihli kanıt sunar', () => {
  it('4. 🔒 bulunan kod TARİHİYLE birlikte "görülen" diye sunulur', () => {
    const r = report([scan({ status: 'RESULT', dtcs: [P0300], measuredAt: iso(86_400_000) })]);
    expect(r.text).toContain('TARAMADA GÖRÜLEN ARIZA KODLARI');
    expect(r.text).toContain('P0300');
    /* Tarih ZORUNLU: tarihsiz kod "şu anda var" gibi okunur. */
    expect(r.text).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(r.limitations.join(' ')).toContain('bugün hâlâ mevcut olup olmadıkları');
  });

  it('5. 🔒 YASAK hüküm ifadeleri hiçbir senaryoda geçmez', () => {
    const cases = [
      report([scan({ status: 'RESULT', dtcs: [P0300] })]),
      report([scan({ status: 'NO_DTC' })]),
      report([scan({ status: 'NO_DTC' }), scan({ sourceCommandId: 'c2', status: 'RESULT', dtcs: [P0300] })]),
      report([scan({ status: 'TIMEOUT', failureReason: 'yanıt yok', dtcs: [] })]),
      report([]), report(null), report(undefined),
    ];
    for (const r of cases) {
      const blob = `${r.text} ${r.limitations.join(' ')}`;
      expect(blob).not.toMatch(/tamir edildi|giderildi|çözüldü|araç sağlam|problem yok/i);
      expect(blob).not.toMatch(/şu anda arıza var/i);
    }
  });

  it('6. 🔒 TIMEOUT raporu "arıza yok" DEMEZ', () => {
    const r = report([scan({ status: 'TIMEOUT', failureReason: 'Araç yanıt vermedi', dtcs: [] })]);
    expect(r.text).toContain('tamamlanamadı');
    expect(r.text).not.toMatch(/arıza kodu bulunmadı/i);
    expect(r.limitations.join(' ')).toContain('BİLİNMİYOR');
  });

  it('7. 🔒 son deneme düştüyse SON BAŞARILI tarama ayrıca gösterilir', () => {
    const r = report([
      scan({ sourceCommandId: 'c2', status: 'TIMEOUT', failureReason: 'yanıt yok', measuredAt: null, completedAt: iso(1_000) }),
      scan({ sourceCommandId: 'c1', status: 'RESULT', dtcs: [P0128], measuredAt: iso(86_400_000) }),
    ]);
    expect(r.text).toContain('Son tarama');
    expect(r.text).toContain('Son başarılı tarama');
    expect(r.text).toContain('P0128');
  });

  it('8. 🔒 kısmi tarama sınırı raporda KAYBOLMAZ', () => {
    const r = report([scan({ status: 'RESULT', dtcs: [P0300], partial: true,
      completeness: { stored: 'ok', pending: 'failed', permanent: 'ok' } })]);
    expect(r.limitations.join(' ')).toMatch(/kısmi/i);
    expect(r.limitations.join(' ')).toMatch(/Bekleyen/);
  });
});

/* ── 3. Gizlilik ───────────────────────────────────────────────────────── */

describe('F5.4 · rapor iç veri sızdırmaz', () => {
  it('9. 🔒 komut kimliği / backend iç verisi rapora GİRMEZ', () => {
    const r = report([scan({ sourceCommandId: 'cmd-secret-123', status: 'RESULT', dtcs: [P0300] })]);
    expect(r.text).not.toContain('cmd-secret-123');
    expect(r.text).not.toMatch(/vehicle_diagnostic_scans|source_command_id/);
    expect(r.text).not.toMatch(/VF1[A-Z0-9]{14}/);
    /* Kod ve açıklaması kullanıcının ürün bilgisidir — GÖSTERİLİR. */
    expect(r.text).toContain('P0300');
  });
});

/* ── 4. Güncellik kapısı: geçmiş bugünün hükmü olamaz ──────────────────── */

describe('F5.4 · kalıcı kayıt ancak GÜNCELSE kanıt olur', () => {
  it('10. 🔒 güven penceresi İÇİNDEKİ RESULT güncel kanıt olur', () => {
    const ev = durableScanToCurrentDtcEvidence(
      scan({ status: 'RESULT', dtcs: [P0300], measuredAt: iso(60_000) }), NOW);
    expect(ev?.kind).toBe('RESULT');
  });

  it('11. 🔒 pencere AŞILIRSA STALE → F2.2 bunu NO_EVIDENCE sayar', () => {
    const old = durableScanToCurrentDtcEvidence(
      scan({ status: 'RESULT', dtcs: [P0300], measuredAt: iso(DTC_HEALTH_MAX_AGE_MS + 60_000) }), NOW);
    expect(old?.kind).toBe('STALE');
    /* MUTASYON KAPISI: eski kod bugünün CRITICAL'ini ÜRETEMEZ. */
    expect(judgeDtcEvidence(old, NOW).reading.verdict).toBe('NO_EVIDENCE');
  });

  it('12. 🔒 ölçüm anı BİLİNMİYORSA güncel sayılmaz', () => {
    const ev = durableScanToCurrentDtcEvidence(
      scan({ status: 'RESULT', dtcs: [P0300], measuredAt: null }), NOW);
    expect(ev?.kind).toBe('STALE');
  });

  it('13. 🔒 kendi eşiğini uydurmaz — KANONİK sabiti kullanır', () => {
    const code = pureCode('src/lib/diagnostics/diagnosticHistory.ts');
    expect(code).toContain('DTC_HEALTH_MAX_AGE_MS');
    /* Gizli bir dakika/saat sabiti tanımlanmamalı. */
    expect(code).not.toMatch(/=\s*\d+\s*\*\s*60_?000/);
  });

  it('14. 🔒 başarısız durumlar NO_DTC\'ye ÇEVRİLMEZ', () => {
    for (const st of ['TIMEOUT', 'OFFLINE', 'FAILED', 'UNSUPPORTED', 'STALE'] as const) {
      const ev = durableScanToCurrentDtcEvidence(
        scan({ status: st, failureReason: 'x', dtcs: [] }), NOW);
      expect(ev?.kind).toBe(st);
      expect(ev?.kind).not.toBe('NO_DTC');
      /* Hiçbiri sağlık hükmü üretmez. */
      expect(judgeDtcEvidence(ev, NOW).reading.verdict).toBe('NO_EVIDENCE');
    }
  });

  it('15. 🔒 tarama YOKSA kanıt da yok (null → null)', () => {
    expect(durableScanToCurrentDtcEvidence(null, NOW)).toBeNull();
    expect(durableScanToCurrentDtcEvidence(undefined, NOW)).toBeNull();
  });
});

/* ── 5. Severity kanonik otoriteden gelir ──────────────────────────────── */

describe('F5.4 · DTC bulundu ≠ CRITICAL', () => {
  it('16. 🔒 yalnız ARAÇ kodu `critical` işaretlediyse CRITICAL olur', () => {
    const warn = durableScanToCurrentDtcEvidence(
      scan({ status: 'RESULT', dtcs: [P0128] }), NOW);
    expect(judgeDtcEvidence(warn, NOW).reading.verdict).toBe('WARNING');

    const crit = durableScanToCurrentDtcEvidence(
      scan({ status: 'RESULT', dtcs: [P0300] }), NOW);
    expect(judgeDtcEvidence(crit, NOW).reading.verdict).toBe('CRITICAL');
  });

  it('17. 🔒 kod → severity eşlemesi teşhis geçmişinde TANIMLI DEĞİL', () => {
    /* KOD denetlenir, PROZA değil: bir kuralı AÇIKLAYAN yorum (ör. "12
       Eylül'de P0300 görüldü") kuralın ihlali sanılmaz. */
    const code = pureCode('src/lib/diagnostics/diagnosticHistory.ts');
    expect(code).not.toMatch(/P0\d{3}/);
    expect(code).not.toContain('CRITICAL');
    expect(code).not.toContain('WARNING');
  });

  it('18. 🔒 başarılı NO_DTC sağlık hükmü VERIFIED üretir, bildirim değil', () => {
    const ev = durableScanToCurrentDtcEvidence(scan({ status: 'NO_DTC' }), NOW);
    expect(judgeDtcEvidence(ev, NOW).reading.verdict).toBe('VERIFIED');
  });
});

/* ── 6. DB satırı eşlemesi fail-closed ─────────────────────────────────── */

describe('F5.4 · bozuk satırdan kayıt UYDURULMAZ', () => {
  it('19. 🔒 tanınmayan status → null', () => {
    expect(rowToDiagnosticScanRecord({ vehicle_id: 'v', status: 'WHATEVER' })).toBeNull();
  });

  it('20. 🔒 araç kimliği yoksa → null', () => {
    expect(rowToDiagnosticScanRecord({ status: 'NO_DTC' })).toBeNull();
    expect(rowToDiagnosticScanRecord(null)).toBeNull();
  });

  it('21. 🔒 kodlar YALNIZ RESULT için taşınır (savunma derinliği)', () => {
    const rec = rowToDiagnosticScanRecord({
      vehicle_id: 'v', status: 'TIMEOUT', dtcs: [P0300], failure_reason: 'x',
    });
    expect(rec?.status).toBe('TIMEOUT');
    expect(rec?.dtcs).toEqual([]);
  });
});

/* ── 7. Fonksiyon sınırları ────────────────────────────────────────────── */

describe('F5.4 · yazıcı ile bildirim tarayıcısı ayrı otorite kalır', () => {
  const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  const NOTIFY = src('../supabase/functions/consumer-notify-scan/index.ts');
  const WRITER = src('../supabase/functions/diagnostic-history-writer/index.ts');

  it('22. 🔒 bildirim tarayıcısı teşhis geçmişi YAZMAZ', () => {
    expect(NOTIFY).not.toMatch(/from\('vehicle_diagnostic_scans'\)[\s\S]{0,200}\.insert/);
    expect(NOTIFY).not.toContain('.insert(');
  });

  it('23. 🔒 yazıcı PUSH göndermez ve bildirim durumuna dokunmaz', () => {
    expect(WRITER).not.toContain('consumer-push-notify');
    expect(WRITER).not.toContain('consumer_notification_state');
  });

  it('24. 🔒 bildirim tarayıcısı güncellik kapısını KULLANIR', () => {
    expect(NOTIFY).toContain('durableScanToCurrentDtcEvidence');
    /* Ham satırı doğrudan health'e vermek YASAK. */
    expect(NOTIFY).not.toMatch(/dtc:\s*scanRes/);
  });

  it('25. 🔒 tarama ARAÇ KAPSAMLI okunur (çok araç izolasyonu)', () => {
    expect(NOTIFY).toMatch(/from\('vehicle_diagnostic_scans'\)[\s\S]{0,300}eq\('vehicle_id', vehicleId\)/);
  });
});
