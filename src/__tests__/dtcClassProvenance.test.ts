/**
 * dtcClassProvenance.test.ts — P0-OBD-09 DTC SINIF + KAYNAK KİLİTLERİ.
 *
 * SAHA KUSURU: aynı araç + aynı adaptörle başka bir OBD uygulaması
 *   `P0089 — Fuel Pressure Regulator 1 Performance · BEKLİYOR (pending)`
 * gösterirken CarOS aynı DTC'yi göstermiyordu.
 *
 * Kök neden native çözümleyicideydi (Java tarafında `DtcClassParserTest`
 * kilitler). Bu dosya TS tarafındaki sözleşmeyi kilitler:
 *   · pending / confirmed / permanent BİRBİRİNE KARIŞMAZ
 *   · aynı kod birden fazla sınıfta/ECU'da olsa BİLGİ KAYBEDİLMEZ
 *   · ECU kaynağı (key/rol/adres) KORUNUR
 *   · reconnect / araç değişiminde eski DTC yeni oturuma TAŞINMAZ
 *   · NO DATA "arıza yok" SAYILMAZ · malformed/partial FAIL-CLOSED
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  DTC_CLASS_LABEL, DTC_CLASS_OF_SERVICE, DTC_SERVICE_OF_CLASS,
  DTC_CLASS_OF_STATUS, DTC_CLASS_OF_SCAN_MODE,
  FUNCTIONAL_ORIGIN, mergeDtcObservations, recordsOfClass, describeOrigin,
  normalizeDtcCode,
  type DtcObservation, type DtcEcuOrigin,
} from '../platform/obd/dtcClassModel';
import {
  recordDtcEvidence, getDtcEvidence, summarizeDtcEvidence,
  _resetDtcEvidenceForTest, DTC_EVIDENCE_RING,
} from '../platform/obd/dtcScanEvidence';
import {
  buildDtcCoverageView, buildServiceTiles, buildEvidenceRows, outcomeTone, NA,
} from '../platform/devtools/dtcCoverageModel';

const EPOCH = 7;

function ecu(label: string, tx: string, role: string | null = null): DtcEcuOrigin {
  return { ecuKey: `veh:${tx}`, ecuLabel: label, ecuTxHeader: tx, ecuRole: role };
}

function obs(
  code: string,
  service: DtcObservation['service'],
  origin: DtcEcuOrigin = FUNCTIONAL_ORIGIN,
  sessionEpoch = EPOCH,
): DtcObservation {
  return { code, service, origin, sessionEpoch };
}

/* ══════════════════════════════════════════════════════════════════════════
   A) SINIF EŞLEMESİ — tek otorite, kopya tablo yok
   ══════════════════════════════════════════════════════════════════════════ */

describe('dtcClassModel › sınıf eşlemesi', () => {
  it('🔒 servis → sınıf eşlemesi SAE J1979 ile birebir', () => {
    expect(DTC_CLASS_OF_SERVICE['03']).toBe('CONFIRMED');
    expect(DTC_CLASS_OF_SERVICE['07']).toBe('PENDING');
    expect(DTC_CLASS_OF_SERVICE['0A']).toBe('PERMANENT');
  });

  it('🔒 ters eşleme tutarlı (kopya tablo ayrışamaz)', () => {
    for (const svc of ['03', '07', '0A'] as const) {
      expect(DTC_SERVICE_OF_CLASS[DTC_CLASS_OF_SERVICE[svc]]).toBe(svc);
    }
  });

  it('🔒 eski `status` sözleşmesi aynı sınıfa iner', () => {
    expect(DTC_CLASS_OF_STATUS.stored).toBe('CONFIRMED');
    expect(DTC_CLASS_OF_STATUS.pending).toBe('PENDING');
    expect(DTC_CLASS_OF_STATUS.permanent).toBe('PERMANENT');
    // multiEcuScan.mode ile AYNI tablo — ikinci otorite YOK.
    expect(DTC_CLASS_OF_SCAN_MODE).toBe(DTC_CLASS_OF_STATUS);
  });

  it('🔒 Türkçe etiketler UI sözleşmesidir', () => {
    expect(DTC_CLASS_LABEL.PENDING).toBe('BEKLEYEN');
    expect(DTC_CLASS_LABEL.CONFIRMED).toBe('ONAYLANMIŞ');
    expect(DTC_CLASS_LABEL.PERMANENT).toBe('KALICI');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B) ANA SAHA KİLİDİ — P0089 BEKLEYEN
   ══════════════════════════════════════════════════════════════════════════ */

describe('dtcClassModel › P0089 bekleyen', () => {
  it('🔒 Mode 07 P0089 → PENDING; CONFIRMED UYDURULMAZ', () => {
    const recs = mergeDtcObservations([obs('P0089', '07')], EPOCH);
    expect(recs.length).toBe(1);
    expect(recs[0].code).toBe('P0089');
    expect(recs[0].classes).toEqual(['PENDING']);
    expect(recs[0].primaryClass).toBe('PENDING');
    expect(recs[0].classes).not.toContain('CONFIRMED');
  });

  it('🔒 YALNIZ Mode 03 → CONFIRMED (pending uydurulmaz)', () => {
    const recs = mergeDtcObservations([obs('P0089', '03')], EPOCH);
    expect(recs[0].classes).toEqual(['CONFIRMED']);
    expect(recs[0].classes).not.toContain('PENDING');
  });

  it('🔒 YALNIZ Mode 0A → PERMANENT', () => {
    const recs = mergeDtcObservations([obs('P0089', '0A')], EPOCH);
    expect(recs[0].classes).toEqual(['PERMANENT']);
  });

  it('🔒 AYNI kod Mode 03 + Mode 07 → İKİ sınıf da korunur (bilgi kaybı YOK)', () => {
    const recs = mergeDtcObservations(
      [obs('P0089', '03'), obs('P0089', '07')], EPOCH);
    expect(recs.length).toBe(1);
    expect(recs[0].classes.sort()).toEqual(['CONFIRMED', 'PENDING']);
    // Rozet önceliği onaylanmış; ama bekleyen SİLİNMEZ.
    expect(recs[0].primaryClass).toBe('CONFIRMED');
    expect(recs[0].observations.length).toBe(2);
  });

  it('🔒 sınıf listesi AĞIRDAN hafife sıralı', () => {
    const recs = mergeDtcObservations(
      [obs('P0089', '07'), obs('P0089', '0A'), obs('P0089', '03')], EPOCH);
    expect(recs[0].classes).toEqual(['PERMANENT', 'CONFIRMED', 'PENDING']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C) ECU KAYNAĞI (provenance)
   ══════════════════════════════════════════════════════════════════════════ */

describe('dtcClassModel › ECU kaynağı', () => {
  it('🔒 aynı DTC farklı ECU\'larda → HER İKİ kaynak da korunur', () => {
    const recs = mergeDtcObservations([
      obs('P0089', '07', ecu('ECU 7E8', '7E0')),
      obs('P0089', '07', ecu('ECU 7E9', '7E1')),
    ], EPOCH);
    expect(recs.length).toBe(1);
    expect(recs[0].observations.length).toBe(2);
    expect(recs[0].ecuLabels).toEqual(['ECU 7E8', 'ECU 7E9']);
    expect(recs[0].hasEcuOrigin).toBe(true);
  });

  it('🔒 ECU anahtarı ve adresi gözlemde KORUNUR', () => {
    const recs = mergeDtcObservations([obs('P0089', '03', ecu('ECU 7E8', '7E0', 'engine'))], EPOCH);
    const o = recs[0].observations[0].origin;
    expect(o.ecuKey).toBe('veh:7E0');
    expect(o.ecuTxHeader).toBe('7E0');
    expect(o.ecuRole).toBe('engine');
  });

  it('🔒 FONKSİYONEL okumada ECU UYDURULMAZ', () => {
    const recs = mergeDtcObservations([obs('P0089', '07')], EPOCH);
    expect(recs[0].ecuLabels).toEqual([]);
    expect(recs[0].hasEcuOrigin).toBe(false);
    expect(describeOrigin(FUNCTIONAL_ORIGIN)).toBeNull();
  });

  it('🔒 rol bilinmiyorsa etiket gösterilir, rol UYDURULMAZ', () => {
    expect(describeOrigin(ecu('ECU 7E8', '7E0'))).toBe('ECU 7E8');
    expect(describeOrigin(ecu('ECU 7E8', '7E0', 'unknown'))).toBe('ECU 7E8');
    expect(describeOrigin(ecu('ECU 7E8', '7E0', 'abs'))).toBe('abs · ECU 7E8');
  });

  it('🔒 aynı kod: bir ECU\'da bekleyen, başka ECU\'da onaylanmış → ikisi de durur', () => {
    const recs = mergeDtcObservations([
      obs('P0089', '07', ecu('ABS', '7E1')),
      obs('P0089', '03', ecu('Motor', '7E0')),
    ], EPOCH);
    expect(recs[0].classes.sort()).toEqual(['CONFIRMED', 'PENDING']);
    expect(recs[0].ecuLabels.sort()).toEqual(['ABS', 'Motor']);
    const pendingOnly = recs[0].observations.filter((o) => o.service === '07');
    expect(pendingOnly[0].origin.ecuLabel).toBe('ABS');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D) OTURUM MÜHRÜ — reconnect / araç değişimi
   ══════════════════════════════════════════════════════════════════════════ */

describe('dtcClassModel › oturum mührü', () => {
  it('🔒 ESKİ oturumun kodu yeni oturuma TAŞINMAZ', () => {
    const recs = mergeDtcObservations([
      obs('P0089', '07', FUNCTIONAL_ORIGIN, 6),   // eski oturum
      obs('P0420', '03', FUNCTIONAL_ORIGIN, 7),   // yeni oturum
    ], 7);
    expect(recs.map((r) => r.code)).toEqual(['P0420']);
  });

  it('🔒 reconnect sonrası TÜM eski kodlar düşer (boş liste dürüsttür)', () => {
    const old = [obs('P0089', '07', FUNCTIONAL_ORIGIN, 1), obs('P0171', '03', FUNCTIONAL_ORIGIN, 1)];
    expect(mergeDtcObservations(old, 2)).toEqual([]);
  });

  it('🔒 epoch OKUNAMAZSA sahte filtre UYGULANMAZ', () => {
    const recs = mergeDtcObservations([obs('P0089', '07', FUNCTIONAL_ORIGIN, 1)], null);
    expect(recs.length).toBe(1);
  });

  it('🔒 boş/bozuk kod KAYIT DEĞİLDİR', () => {
    expect(mergeDtcObservations([obs('', '07'), obs('   ', '03')], EPOCH)).toEqual([]);
    expect(normalizeDtcCode(' p0089 ')).toBe('P0089');
    expect(normalizeDtcCode(null)).toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E) SINIFA GÖRE SÜZME — listeler karışmaz
   ══════════════════════════════════════════════════════════════════════════ */

describe('dtcClassModel › sınıfa göre süzme', () => {
  it('🔒 bekleyen listesi onaylanmışları İÇERMEZ', () => {
    const recs = mergeDtcObservations([
      obs('P0089', '07'), obs('P0420', '03'), obs('P0300', '0A'),
    ], EPOCH);
    expect(recordsOfClass(recs, 'PENDING').map((r) => r.code)).toEqual(['P0089']);
    expect(recordsOfClass(recs, 'CONFIRMED').map((r) => r.code)).toEqual(['P0420']);
    expect(recordsOfClass(recs, 'PERMANENT').map((r) => r.code)).toEqual(['P0300']);
  });

  it('🔒 iki sınıflı kod HER İKİ listede de görünür', () => {
    const recs = mergeDtcObservations([obs('P0089', '07'), obs('P0089', '03')], EPOCH);
    expect(recordsOfClass(recs, 'PENDING').map((r) => r.code)).toEqual(['P0089']);
    expect(recordsOfClass(recs, 'CONFIRMED').map((r) => r.code)).toEqual(['P0089']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F) KANIT DEFTERİ — NO DATA · malformed · unsupported · oturum
   ══════════════════════════════════════════════════════════════════════════ */

describe('dtcScanEvidence', () => {
  beforeEach(() => { _resetDtcEvidenceForTest(); });

  it('🔒 NO DATA (0 kod) BAŞARILI okumadır — "arıza yok" DEMEK DEĞİL', () => {
    recordDtcEvidence({ service: '07', outcome: 'ok', codes: [], sessionEpoch: EPOCH, raw: 'NO DATA' });
    const s = summarizeDtcEvidence();
    expect(s.byService['07'].okCount).toBe(1);
    expect(s.byService['07'].failedCount).toBe(0);
    expect(s.byService['07'].uniqueCodes).toBe(0);
  });

  it('🔒 DÜŞEN okumanın kod listesi kanıt SAYILMAZ', () => {
    recordDtcEvidence({
      service: '07', outcome: 'failed', codes: ['P9999'],
      sessionEpoch: EPOCH, error: 'STOPPED',
    });
    const e = getDtcEvidence();
    expect(e[0].codes).toEqual([]);      // sahte kanıt üretilmez
    expect(e[0].error).toBe('STOPPED');
  });

  it('🔒 unsupported bir HATA DEĞİLDİR (ayrı sayılır)', () => {
    recordDtcEvidence({ service: '0A', outcome: 'unsupported', sessionEpoch: EPOCH });
    const s = summarizeDtcEvidence();
    expect(s.byService['0A'].unsupportedCount).toBe(1);
    expect(s.byService['0A'].failedCount).toBe(0);
  });

  it('🔒 ham yanıt yoksa `null` KALIR (boş string YASAK)', () => {
    recordDtcEvidence({ service: '03', outcome: 'ok', codes: ['P0089'], sessionEpoch: EPOCH });
    expect(getDtcEvidence()[0].raw).toBeNull();
  });

  it('🔒 YENİ OTURUM yazmaya başlayınca eski kanıt DÜŞER', () => {
    recordDtcEvidence({ service: '03', outcome: 'ok', codes: ['P0171'], sessionEpoch: 1 });
    recordDtcEvidence({ service: '07', outcome: 'ok', codes: ['P0089'], sessionEpoch: 2 });
    const e = getDtcEvidence();
    expect(e.length).toBe(1);
    expect(e[0].sessionEpoch).toBe(2);
    expect(e[0].codes).toEqual(['P0089']);
  });

  it('🔒 defter TAVANLIDIR (bellek sızıntısı yok)', () => {
    for (let i = 0; i < DTC_EVIDENCE_RING + 12; i++) {
      recordDtcEvidence({ service: '03', outcome: 'ok', codes: [`P00${i}`], sessionEpoch: EPOCH });
    }
    expect(getDtcEvidence().length).toBe(DTC_EVIDENCE_RING);
  });

  it('🔒 okuma kaydı ÜRÜNÜ DÜŞÜREMEZ', () => {
    expect(() => recordDtcEvidence(
      { service: '03', outcome: 'ok', sessionEpoch: EPOCH } as never,
    )).not.toThrow();
  });

  it('🔒 dönen defter ÇAĞIRAN tarafından bozulamaz', () => {
    recordDtcEvidence({ service: '03', outcome: 'ok', codes: ['P0089'], sessionEpoch: EPOCH });
    const copy = getDtcEvidence() as unknown as unknown[];
    copy.length = 0;
    expect(getDtcEvidence().length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   G) LAB MODELİ — kapsam dürüstlüğü
   ══════════════════════════════════════════════════════════════════════════ */

describe('dtcCoverageModel', () => {
  beforeEach(() => { _resetDtcEvidenceForTest(); });

  it('🔒 HİÇ SORULMAMIŞ servis "temiz" GÖSTERİLMEZ', () => {
    const tiles = buildServiceTiles(summarizeDtcEvidence([]));
    expect(tiles.length).toBe(3);
    for (const t of tiles) {
      expect(t.notAsked).toBe(true);
      expect(t.detail).toBe('HİÇ SORULMADI');
      expect(t.codes).toBe(NA);
      expect(t.tone).not.toBe('ok');       // sorulmamış = yeşil DEĞİL
    }
  });

  it('🔒 bir okuma bile DÜŞTÜYSE servis yeşil GÖSTERİLMEZ', () => {
    recordDtcEvidence({ service: '07', outcome: 'ok', codes: ['P0089'], sessionEpoch: EPOCH });
    recordDtcEvidence({ service: '07', outcome: 'failed', sessionEpoch: EPOCH, error: 'timeout' });
    const tile = buildServiceTiles(summarizeDtcEvidence()).find((t) => t.service === '07');
    expect(tile?.tone).toBe('bad');
    expect(tile?.detail).toContain('düştü');
  });

  it('🔒 sonuç tonları: unsupported UYARI DEĞİL, failed ASLA ok', () => {
    expect(outcomeTone('ok')).toBe('ok');
    expect(outcomeTone('unsupported')).toBe('muted');
    expect(outcomeTone('failed')).toBe('bad');
  });

  it('🔒 BAŞKA oturumun kaydı ekranda GÖSTERİLMEZ', () => {
    const entries = [
      { service: '07' as const, ecuLabel: null, ecuTxHeader: null, outcome: 'ok' as const,
        codes: ['P0089'], raw: null, sessionEpoch: 1, atMs: 1, error: null },
      { service: '03' as const, ecuLabel: null, ecuTxHeader: null, outcome: 'ok' as const,
        codes: ['P0171'], raw: null, sessionEpoch: 2, atMs: 2, error: null },
    ];
    const rows = buildEvidenceRows(entries, 2);
    expect(rows.length).toBe(1);
    expect(rows[0].codes).toBe('P0171');
  });

  it('🔒 ham yanıt yoksa UNAVAILABLE yazılır', () => {
    recordDtcEvidence({ service: '07', outcome: 'ok', codes: ['P0089'], sessionEpoch: EPOCH });
    const rows = buildEvidenceRows(getDtcEvidence(), EPOCH);
    expect(rows[0].raw).toBe(NA);
  });

  it('🔒 ham yanıt VARSA ham ile çözümlenmiş YAN YANA durur', () => {
    recordDtcEvidence({
      service: '07', outcome: 'ok', codes: ['P0089'],
      raw: '47 01 00 89 00 00 00', sessionEpoch: EPOCH,
    });
    const rows = buildEvidenceRows(getDtcEvidence(), EPOCH);
    expect(rows[0].raw).toBe('47 01 00 89 00 00 00');
    expect(rows[0].codes).toBe('P0089');
    expect(rows[0].title).toBe('Mode 07 — BEKLEYEN');
  });

  it('🔒 FONKSİYONEL okuma ECU UYDURMAZ', () => {
    recordDtcEvidence({ service: '03', outcome: 'ok', codes: [], sessionEpoch: EPOCH });
    expect(buildEvidenceRows(getDtcEvidence(), EPOCH)[0].target).toBe('FONKSİYONEL (7DF)');
  });

  it('🔒 ECU kaynağı VARSA adresiyle birlikte gösterilir', () => {
    recordDtcEvidence({
      service: '07', ecuLabel: 'ECU 7E9', ecuTxHeader: '7E1',
      outcome: 'ok', codes: ['P0089'], sessionEpoch: EPOCH,
    });
    expect(buildEvidenceRows(getDtcEvidence(), EPOCH)[0].target).toBe('ECU 7E9 (7E1)');
  });

  it('🔒 kanıt yokken ekran "temiz" DEMEZ', () => {
    const v = buildDtcCoverageView([], summarizeDtcEvidence([]), EPOCH);
    expect(v.empty).toBe(true);
    expect(v.tiles.every((t) => t.notAsked)).toBe(true);
  });

  it('🔒 KARIŞIK oturum sessizce yutulmaz (teşhis sinyali)', () => {
    const entries = [
      { service: '03' as const, ecuLabel: null, ecuTxHeader: null, outcome: 'ok' as const,
        codes: [], raw: null, sessionEpoch: 1, atMs: 1, error: null },
      { service: '03' as const, ecuLabel: null, ecuTxHeader: null, outcome: 'ok' as const,
        codes: [], raw: null, sessionEpoch: 2, atMs: 2, error: null },
    ];
    expect(buildDtcCoverageView(entries, summarizeDtcEvidence(entries), 2).mixedEpochs).toBe(true);
  });

  it('🔒 epoch okunamazsa UNAVAILABLE yazılır (sahte 0 YASAK)', () => {
    expect(buildDtcCoverageView([], summarizeDtcEvidence([]), null).epochLabel).toBe(NA);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   H) readAllDTCs YOLU — desteklenmeyen servis · düşen okuma · kanıt yazımı
   ══════════════════════════════════════════════════════════════════════════ */

describe('dtcService.readAllDTCs — servis kapsamı', () => {
  beforeEach(() => {
    _resetDtcEvidenceForTest();
    vi.resetModules();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  /** Native ortamı taklit eden yükleyici — her testte TAZE modül grafiği. */
  async function loadWith(carLauncher: Record<string, unknown>) {
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
      registerPlugin: () => ({}),
    }));
    vi.doMock('../platform/nativePlugin', () => ({ CarLauncher: carLauncher }));
    vi.doMock('../platform/obdService', () => ({
      // P0-OBD-CORE-05: readAllDTCs artık admisyon kapısından geçer — bu blok
      // ZATEN bağlı/oturum-hazır bir aracı taklit ediyor (native class outcome
      // çözümlemesini test eder), o yüzden 'connected' AÇIKÇA verilir.
      getOBDDataSnapshot: () => ({ connectionState: 'connected', transportConnected: true, dataFresh: true }),
      getObdSessionEpoch: () => 42,
    }));
    const ev = await import('../platform/obd/dtcScanEvidence');
    ev._resetDtcEvidenceForTest();
    const svc = await import('../platform/dtcService');
    return { svc, ev };
  }

  it('🔒 Mode 07 P0089 → status "pending"; CONFIRMED UYDURULMAZ', async () => {
    const { svc } = await loadWith({
      readDTC:          async () => ({ codes: [] }),
      readPendingDTC:   async () => ({ codes: ['P0089'] }),
      readPermanentDTC: async () => ({ codes: [], supported: true }),
    });
    const r = await svc.readAllDTCs();
    const p0089 = r.codes.filter((c) => c.code === 'P0089');
    expect(p0089.length).toBe(1);
    expect(p0089[0].status).toBe('pending');
    expect(r.completeness.pending).toBe('ok');
  });

  it('🔒 eski native plugin (Mode 07 metodu YOK) → "unsupported", sessiz temiz DEĞİL', async () => {
    const { svc } = await loadWith({
      readDTC:          async () => ({ codes: [] }),
      readPermanentDTC: async () => ({ codes: [], supported: true }),
    });
    const r = await svc.readAllDTCs();
    expect(r.completeness.pending).toBe('unsupported');
    expect(r.codes.length).toBe(0);
  });

  it('🔒 düşen Mode 07 okuması "failed" — kapsam KISMİ olur', async () => {
    const { svc } = await loadWith({
      readDTC:          async () => ({ codes: ['P0171'] }),
      readPendingDTC:   async () => { throw new Error('STOPPED'); },
      readPermanentDTC: async () => ({ codes: [], supported: true }),
    });
    const r = await svc.readAllDTCs();
    expect(r.completeness.pending).toBe('failed');
    expect(r.completeness.stored).toBe('ok');
    expect(r.codes.map((c) => c.code)).toEqual(['P0171']);
  });

  it('🔒 Mode 0A desteklenmeyen araç: "kalıcı kod yok" ile KARIŞTIRILMAZ', async () => {
    const { svc } = await loadWith({
      readDTC:          async () => ({ codes: [] }),
      readPendingDTC:   async () => ({ codes: [] }),
      readPermanentDTC: async () => ({ codes: [], supported: false }),
    });
    const r = await svc.readAllDTCs();
    expect(r.permanentSupported).toBe(false);
    expect(r.completeness.permanent).toBe('unsupported');
  });

  it('🔒 HAM yanıt taşıyan yeni yol kullanılır ve KANIT yazılır', async () => {
    const { svc, ev } = await loadWith({
      readDTC:          async () => ({ codes: [] }),
      readDtcClass:     async ({ mode }: { mode: string }) =>
        mode === '07'
          ? { codes: ['P0089'], raw: '47 01 00 89 00 00 00', supported: true }
          : { codes: [], raw: 'NO DATA', supported: true },
    });
    const r = await svc.readAllDTCs();
    expect(r.codes.map((c) => c.status)).toEqual(['pending']);

    const entries = ev.getDtcEvidence();
    const pendingEv = entries.find((e) => e.service === '07');
    expect(pendingEv?.raw).toBe('47 01 00 89 00 00 00');
    expect(pendingEv?.codes).toEqual(['P0089']);
    expect(pendingEv?.sessionEpoch).toBe(42);
    // Üç servis de sorulmuş olmalı — biri atlanırsa kapsam sessizce daralır.
    expect(new Set(entries.map((e) => e.service))).toEqual(new Set(['03', '07', '0A']));
  });

  it('🔒 her kod OTURUM mührü taşır (reconnect ayrımı için)', async () => {
    const { svc } = await loadWith({
      readDTC:        async () => ({ codes: ['P0171'] }),
      readPendingDTC: async () => ({ codes: ['P0089'] }),
    });
    const r = await svc.readAllDTCs();
    expect(r.codes.every((c) => c.sessionEpoch === 42)).toBe(true);
    // Fonksiyonel okuma → ECU UYDURULMAZ.
    expect(r.codes.every((c) => c.ecuLabel === null)).toBe(true);
  });
});
