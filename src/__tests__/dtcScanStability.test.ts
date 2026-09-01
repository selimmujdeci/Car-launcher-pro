/**
 * dtcScanStability.test.ts — P0-OBD-11 · DTC TARAMA KARARLILIĞI KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SAHA KUSURU (2026-08-23): AYNI araçta önceki CarOS taramasında P0089 /
 * BEKLEYEN görüldü. Yeni taramada P0089 HİÇ görünmedi ve ekran aynı anda
 * şu ÇELİŞKİYİ gösterdi:
 *      "TARAMA KAPSAMI %100" + "Onaylı ✓" + "Bekleyen ✓"
 *
 * ÖLÇÜLEN KÖK NEDEN: **"NO DATA" BAŞARI SAYILIYORDU.**
 *
 *   ElmProtocol.parseDtcResponse:
 *       if (compact.contains("NODATA")) return [];   // "kod yok"
 *
 * ELM327 "NO DATA" derken **ECU CEVAP VERMEDİ** demektir (ELM kendi zaman
 * aşımına uğradı). GERÇEKTEN temiz bir ECU `43 00` / `47 00` / `4A 00` —
 * yani POZİTİF yanıt + sayaç 0 — döner. Birinde ÖLÇÜM VARDIR, diğerinde
 * HİÇ ÖLÇÜM YOKTUR. Eski zincir ikisini de `{supported:true, codes:[]}`
 * yapıyordu → üst katman `ok` → kapsam 3/3 = %100 → "SİSTEM TEMİZ".
 *
 * Yani **ECU sustuğu anda ürün aracın sağlıklı olduğunu ilan ediyordu** ve
 * P0089'un kaybolması bunun doğrudan sonucuydu.
 *
 * Bu dosya o davranışın geri gelmesini KİLİTLER. Kilitler ZAYIFLATILAMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildScanReport } from '../platform/obd/scanReport';
import { computeDtcVerdict } from '../platform/obd/dtcVerdict';

/* ═══════════════════════════════════════════════════════════════════════════
   A) KAPSAM — "ECU sustu" kapsamı DÜŞÜRÜR, %100 GÖSTERİLMEZ
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-11 · A) tarama kapsamı', () => {
  it('🔒 A1 — ANA KİLİT: üç servis de ECU SUSTU → kapsam %100 DEĞİL, 0', () => {
    /* SAHADAKİ ÇELİŞKİNİN TA KENDİSİ. Eskiden bu girdi coverage=1 üretiyordu
       çünkü NO DATA `ok`a çevriliyordu ve payda yalnız ok+failed idi. */
    const r = buildScanReport({
      stored: 'no_response', pending: 'no_response', permanent: 'no_response', status: 'not_run',
    });
    expect(r.coverage).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.noResponseCount).toBe(3);
    expect(r.summary).toMatch(/ECU yanıt vermedi/i);
    expect(r.summary).toMatch(/bilinmiyor/i);
  });

  it('🔒 A2 — KİLİT: 03 OK · 07 ECU SUSTU → kapsam %100 OLAMAZ', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'no_response', permanent: 'unsupported', status: 'ok',
    });
    expect(r.coverage).toBeLessThan(1);
    expect(r.complete).toBe(false);
    expect(r.noResponseCount).toBe(1);
    // Başarılı servisin sonucu KAYBOLMAZ.
    expect(r.modes.find((m) => m.mode === 'stored')?.status).toBe('ok');
  });

  it('🔒 A3 — KİLİT: 03 OK / 07 timeout(failed) / 0A unsupported', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'failed', permanent: 'unsupported', status: 'ok',
    });
    // 'unsupported' KAPSAM KAYBI DEĞİL (araçta o servis yok) → paydaya girmez.
    expect(r.coverage).toBeCloseTo(2 / 3);
    expect(r.failedCount).toBe(1);
    expect(r.unsupportedCount).toBe(1);
    expect(r.noResponseCount).toBe(0);
    expect(r.complete).toBe(false);
  });

  it('🔒 A4 — KİLİT: üç servis timeout(failed) → kapsam 0, "temiz" YOK', () => {
    const r = buildScanReport({
      stored: 'failed', pending: 'failed', permanent: 'failed', status: 'failed',
    });
    expect(r.coverage).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.summary).toMatch(/Kısmi tarama/i);
  });

  it('A5 — GERÇEK temiz tarama: hepsi OK → kapsam %100 (bu HAK EDİLMİŞTİR)', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'ok', permanent: 'ok', status: 'ok',
    });
    expect(r.coverage).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.noResponseCount).toBe(0);
  });

  it('A6 — desteklenmeyen servis kapsamı DÜŞÜRMEZ (ölçülmüş gerçek)', () => {
    const r = buildScanReport({
      stored: 'ok', pending: 'ok', permanent: 'unsupported', status: 'ok',
    });
    expect(r.coverage).toBe(1);
    expect(r.complete).toBe(true);
    expect(r.summary).toMatch(/desteklemiyor/i);
  });

  it('🔒 A7 — KİLİT: "ECU sustu" ile "okuma düştü" AYRI sayılır', () => {
    const r = buildScanReport({
      stored: 'no_response', pending: 'failed', permanent: 'ok', status: 'ok',
    });
    expect(r.noResponseCount).toBe(1);
    expect(r.failedCount).toBe(1);
    // İkisi tek kovaya atılmaz.
    expect(r.noResponseCount + r.failedCount).toBe(2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) HÜKÜM — sessizlik "arıza yok" DEĞİLDİR
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE = {
  scanRan: true,
  storedCount: 0, pendingCount: 0, permanentCount: 0,
  mil: false as boolean | null,
  pid01DtcCount: 0,
  failedModes: [] as never[],
  manufacturerScope: 'covered' as const,
};

describe('P0-OBD-11 · B) verdi', () => {
  it('🔒 B1 — ANA KİLİT: ECU SUSTU → "temiz" DEĞİL, sonuç BİLİNMİYOR', () => {
    const v = computeDtcVerdict({ ...BASE, noResponseModes: ['stored', 'pending', 'permanent'] });
    expect(v.verdict).toBe('inconclusive');
    expect(v.verdict).not.toBe('clean');
    expect(v.reason).toMatch(/ECU yanıt vermedi/i);
    expect(v.reason).toMatch(/arıza yok.*DEĞİL/i);
  });

  it('🔒 B2 — KİLİT: sessizliğin gerekçesi "okuma düştü" ile KARIŞTIRILMAZ', () => {
    const silent = computeDtcVerdict({ ...BASE, noResponseModes: ['pending'] });
    const broken = computeDtcVerdict({ ...BASE, failedModes: ['pending'] });
    expect(silent.reason).toMatch(/ECU yanıt vermedi/i);
    expect(broken.reason).toMatch(/tamamlanamadı/i);
    expect(silent.reason).not.toBe(broken.reason);
  });

  it('🔒 B3 — KİLİT: BEKLEYEN kod varsa "araç sağlıklı" DENMEZ', () => {
    const v = computeDtcVerdict({ ...BASE, pendingCount: 1 });
    expect(v.verdict).toBe('issues');
    expect(v.issueSources).toContain('bekleyen kod');
  });

  it('B4 — bulgu VARSA sessizlik onu EZMEZ (bulgu > belirsizlik)', () => {
    const v = computeDtcVerdict({ ...BASE, pendingCount: 1, noResponseModes: ['permanent'] });
    expect(v.verdict).toBe('issues');
  });

  it('B5 — gerçekten temiz: hepsi okundu, bulgu yok → clean', () => {
    const v = computeDtcVerdict({ ...BASE });
    expect(v.verdict).toBe('clean');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) ZİNCİR — readAllDTCs native sınıfı OTORİTE mi
   ═══════════════════════════════════════════════════════════════════════════ */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDTC:       vi.fn(async () => ({ codes: [] as string[] })),
    clearDTC:      vi.fn(async () => undefined),
    clearDtcCodes: vi.fn(async () => ({ tx: '04', raw: '44', outcome: 'POSITIVE', elapsedMs: 10 })),
    readDtcClass:  vi.fn(async (_o: { mode: string }) => ({
      codes: [] as string[], raw: '', supported: true,
      outcome: 'OK', elapsedMs: 10, protocol: '6', recoveryCount: 0,
    })),
  },
}));

vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: vi.fn(() => ({
    connectionState: 'connected', speed: 0, rpm: 0, lastSeenMs: Date.now(),
  })),
  getObdSessionEpoch: vi.fn(() => 3),
}));

import { CarLauncher } from '../platform/nativePlugin';
import {
  readAllDTCs, getClearableDtcSnapshot, _resetDtcServiceForTest, mapNativeClassOutcome,
} from '../platform/dtcService';
import {
  getDtcEvidence, summarizeDtcEvidence, _resetDtcEvidenceForTest,
} from '../platform/obd/dtcScanEvidence';
import { buildEvidenceRows, buildServiceTiles, NA } from '../platform/devtools/dtcCoverageModel';

/** Sınıf başına native sonuç programlar. */
type Prog = { codes?: string[]; raw?: string; outcome?: string; recoveryCount?: number };
function program(map: Partial<Record<'03' | '07' | '0A', Prog>>): void {
  vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async (o: { mode: string }) => {
    const cfg = map[o.mode as '03' | '07' | '0A'] ?? {};
    return {
      codes: cfg.codes ?? [],
      raw: cfg.raw ?? '',
      supported: true,
      outcome: cfg.outcome ?? 'OK',
      elapsedMs: 12,
      protocol: '6',
      recoveryCount: cfg.recoveryCount ?? 0,
    };
  });
}

describe('P0-OBD-11 · C) readAllDTCs zinciri', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _resetDtcServiceForTest();
    _resetDtcEvidenceForTest();
    const obd = await import('../platform/obdService');
    vi.mocked(obd.getObdSessionEpoch).mockReturnValue(3);
    program({});
  });

  it('🔒 C1 — ANA KİLİT: üç servis NO DATA → completeness "ok" OLAMAZ', () => {
    program({
      '03': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
      '07': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
      '0A': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
    });
    return readAllDTCs().then((r) => {
      expect(r.completeness).toEqual({
        stored: 'no_response', pending: 'no_response', permanent: 'no_response',
      });
      expect(r.codes).toHaveLength(0);
      // "Destekliyor" da DENMEZ — ölçüm yok.
      expect(r.permanentSupported).toBe(false);

      const report = buildScanReport({ ...r.completeness, status: 'not_run' });
      expect(report.coverage).toBe(0);
      expect(report.complete).toBe(false);
    });
  });

  it('🔒 C2 — KİLİT: "43 00" (POZİTİF, 0 kod) GERÇEK temizdir — NO DATA ile AYNI DEĞİL', async () => {
    program({
      '03': { outcome: 'OK', raw: '43 00', codes: [] },
      '07': { outcome: 'OK', raw: '47 00', codes: [] },
      '0A': { outcome: 'OK', raw: '4A 00', codes: [] },
    });
    const r = await readAllDTCs();
    expect(r.completeness).toEqual({ stored: 'ok', pending: 'ok', permanent: 'ok' });
    expect(r.permanentSupported).toBe(true);
    expect(buildScanReport({ ...r.completeness, status: 'ok' }).coverage).toBe(1);
  });

  it('🔒 C3 — KİLİT: 03 NO DATA / 07 P0089 → başarılı servisin sonucu KAYBOLMAZ', async () => {
    program({
      '03': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
      '07': { outcome: 'OK', raw: '47 01 00 89', codes: ['P0089'] },
      '0A': { outcome: 'UNSUPPORTED', raw: '7F 0A 11' },
    });
    const r = await readAllDTCs();
    expect(r.completeness.stored).toBe('no_response');
    expect(r.completeness.pending).toBe('ok');
    expect(r.completeness.permanent).toBe('unsupported');
    // P0089 GÖRÜNÜR — bir servis sustu diye diğerinin bulgusu düşmez.
    expect(r.codes.map((c) => c.code)).toContain('P0089');
    expect(r.codes.find((c) => c.code === 'P0089')?.status).toBe('pending');
  });

  it('🔒 C4 — KİLİT: 03 OK / 07 timeout / 0A unsupported → sınıflar ayrı taşınır', async () => {
    program({
      '03': { outcome: 'OK', raw: '43 00', codes: [] },
      '07': { outcome: 'BUS_ERROR', raw: 'STOPPED' },
      '0A': { outcome: 'UNSUPPORTED', raw: '?' },
    });
    const r = await readAllDTCs();
    expect(r.completeness).toEqual({ stored: 'ok', pending: 'failed', permanent: 'unsupported' });
  });

  it('🔒 C5 — KİLİT: yanıt geldi ama POZİTİF SID YOK → "0 kod" DEĞİL, failed', async () => {
    program({ '03': { outcome: 'NO_SID', raw: '01 02 03' } });
    const r = await readAllDTCs();
    expect(r.completeness.stored).toBe('failed');
  });

  it('🔒 C6 — ANA KİLİT: P0089 önceki taramada VAR, sonraki tarama SESSİZ → "kod kayboldu" DENMEZ', async () => {
    /* Sahadaki asıl şikâyet budur. Kod kaybolmadı — bu taramada SORULAMADI.
       Envanter önceki ÖLÇÜMÜ korur (uydurma değil, aynı oturumun kaydı). */
    program({ '07': { outcome: 'OK', raw: '47 01 00 89', codes: ['P0089'] } });
    await readAllDTCs();
    expect(getClearableDtcSnapshot().codes.map((c) => c.code)).toContain('P0089');

    program({
      '03': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
      '07': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
      '0A': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
    });
    const r2 = await readAllDTCs();

    // Tarama sonucu boş ama ENVANTER korunur → UI "kod kayboldu" iddiası üretemez.
    expect(r2.codes).toHaveLength(0);
    expect(getClearableDtcSnapshot().codes.map((c) => c.code)).toContain('P0089');
    // Ve hüküm "temiz" DEĞİL.
    const v = computeDtcVerdict({
      ...BASE, pendingCount: 0,
      noResponseModes: ['stored', 'pending', 'permanent'],
    });
    expect(v.verdict).toBe('inconclusive');
  });

  it('🔒 C7 — KİLİT: ESKİ OTURUM sonucu yeni oturuma TAŞINMAZ', async () => {
    program({ '07': { outcome: 'OK', raw: '47 01 00 89', codes: ['P0089'] } });
    await readAllDTCs();
    expect(getClearableDtcSnapshot().count).toBe(1);

    // Adaptör başka araca takıldı → epoch değişti.
    const obd = await import('../platform/obdService');
    vi.mocked(obd.getObdSessionEpoch).mockReturnValue(4);
    expect(getClearableDtcSnapshot().count).toBe(0);
  });

  it('🔒 C8 — KİLİT: tarama ortasında KWP recovery ÖLÇÜLÜR ve gösterilir', async () => {
    // 03 okunurken sayaç 0; 07'de 1 → aralarında ATPC/reinit olmuş.
    program({
      '03': { outcome: 'OK', raw: '43 00', recoveryCount: 0 },
      '07': { outcome: 'NO_RESPONSE', raw: 'NO DATA', recoveryCount: 1 },
      '0A': { outcome: 'OK', raw: '4A 00', recoveryCount: 1 },
    });
    await readAllDTCs();

    const rows = buildEvidenceRows(getDtcEvidence(), 3);
    const pendingRow = rows.find((r) => r.title.includes('07'));
    expect(pendingRow?.recoveredBefore).toBe(true);
    // Aynı oturum numarası bunu GİZLEMEMELİ.
    expect(pendingRow?.epoch).toBe('3');
  });

  it('🔒 C9 — KİLİT: LAB satırında sessiz okuma "0 kod" YAZMAZ (UNAVAILABLE)', async () => {
    program({ '03': { outcome: 'NO_RESPONSE', raw: 'NO DATA' } });
    await readAllDTCs();
    const rows = buildEvidenceRows(getDtcEvidence(), 3);
    const storedRow = rows.find((r) => r.title.includes('03'));
    expect(storedRow?.codes).toBe(NA);
    expect(storedRow?.outcome).toMatch(/ECU YANIT VERMEDİ/i);
    expect(storedRow?.tone).toBe('bad');
    // TX/RX/protokol/süre GÖRÜNÜR olmalı — teşhis bunlarsız yapılamaz.
    expect(storedRow?.tx).toBe('03');
    expect(storedRow?.raw).toBe('NO DATA');
    expect(storedRow?.protocol).toBe('ATDPN 6');
    expect(storedRow?.elapsed).toBe('12 ms');
  });

  it('🔒 C10 — KİLİT: LAB servis karosu sessizlikte YEŞİL olamaz', async () => {
    program({
      '03': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
      '07': { outcome: 'OK', raw: '47 00', codes: [] },
      '0A': { outcome: 'NO_RESPONSE', raw: 'NO DATA' },
    });
    await readAllDTCs();
    const tiles = buildServiceTiles(summarizeDtcEvidence(getDtcEvidence()));
    expect(tiles.find((t) => t.service === '03')?.tone).toBe('bad');
    expect(tiles.find((t) => t.service === '03')?.detail).toMatch(/ECU SUSTU/);
    expect(tiles.find((t) => t.service === '03')?.codes).toBe(NA);
    expect(tiles.find((t) => t.service === '07')?.tone).toBe('ok');
  });

  it('🔒 C11 — KİLİT: canlı Mode 01 polling DTC taramasını ETKİLEMEZ (ayrı yol)', async () => {
    /* Tarama yalnız readDtcClass çağırır; poll döngüsü DURDURULMAZ ve
       burada hiçbir Mode 01 çağrısı YAPILMAZ (hot-path bozulmadı). */
    program({ '03': { outcome: 'OK', raw: '43 00' } });
    await readAllDTCs();
    expect(CarLauncher.readDtcClass).toHaveBeenCalledTimes(3);
    expect(CarLauncher.readDTC).not.toHaveBeenCalled();
  });

  it('🔒 C12 — KİLİT: native reject (bağlantı koptu) → failed, "kod yok" DEĞİL', async () => {
    vi.mocked(CarLauncher.readDtcClass!).mockRejectedValue(new Error('OBD bağlantısı yok'));
    const r = await readAllDTCs();
    expect(r.completeness).toEqual({ stored: 'failed', pending: 'failed', permanent: 'failed' });
    expect(buildScanReport({ ...r.completeness, status: 'not_run' }).coverage).toBe(0);
  });

  it('C13 — sözlük eşlemesi: tanınmayan native sınıf UYDURULMAZ', () => {
    expect(mapNativeClassOutcome('OK')).toBe('ok');
    expect(mapNativeClassOutcome('NO_RESPONSE')).toBe('no_response');
    expect(mapNativeClassOutcome('UNSUPPORTED')).toBe('unsupported');
    expect(mapNativeClassOutcome('BUS_ERROR')).toBe('failed');
    expect(mapNativeClassOutcome('NO_SID')).toBe('failed');
    expect(mapNativeClassOutcome('WHATEVER')).toBeNull();
    expect(mapNativeClassOutcome(undefined)).toBeNull();
  });
});
