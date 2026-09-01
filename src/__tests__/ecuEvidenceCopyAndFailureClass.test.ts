/**
 * P0-OBD-FINAL-02 · FIX C — LAB KANIT KOPYASI + NATIVE FAILURE CLASS ZİNCİRİ
 *
 * ── ÖLÇÜLEN SAHA KUSURLARI (2026-08-25 · gerçek araç) ──────────────────────
 * (C1) Ekranda `ECU 7A (KWP)` · rx `86F17A` · tx `817AF1` · 8-bit · rol UNKNOWN
 *      GÖRÜNÜYORDU; "TÜMÜNÜ KOPYALA" çıktısında bu kanıt HİÇ YOKTU. Gönderilen
 *      tam dökümden teşhis ÇIKARILAMADI — #535/#523 ile AYNI SINIF kusur:
 *      ölçüm yapıldı, dışarı çıkarılmadı.
 * (C2) Kopma defteri: 6 bağlantı hatası · 4'ü UNKNOWN ·
 *      `NATIVE_SOCKET_ERROR` kanıt açığı = 4. Oysa native hata SINIFI JS'te
 *      ZATEN VARDI (`ObdFailureClass.of` → `obdStatus.failureClass` →
 *      `obdService._lastNativeFailureClass`). Kopan halka DEFTERİN GİRDİSİYDİ.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import { buildCarosLabCopy, type CarosLabCopyInput } from '../platform/devtools/carosLabCopyModel';
import {
  classifyLinkLoss, candidateFromNativeFailureClass, type LinkLossSample,
} from '../platform/obd/linkLossLedger';
import { NATIVE_CONNECT_FAILURE_CLASSES } from '../platform/obd/connectFailureReason';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/* ══════════════════════════════════════════════════════════════════════════
 * C1 — LAB KOPYASINDA ECU KEŞİF / ADRESLENEBİLİRLİK KANITI
 * ═════════════════════════════════════════════════════════════════════════ */

function emptyInput(over: Partial<CarosLabCopyInput> = {}): CarosLabCopyInput {
  return {
    meta: {
      generatedAtWallMs: 1_700_000_000_000, platform: 'test', appVersion: '1.0.0',
      category: 'vehicle', activeTool: 'ecu-inventory', captureRefs: null,
    },
    catalog: null, session: null, scheduling: null, evidence: null,
    obdTraffic: null, canRaw: null, discovery: null, obdData: null,
    blackBox: null, errorLog: null,
    ...over,
  } as CarosLabCopyInput;
}

/** SAHA kanıtı — ölçülen değerlerin birebir aynısı. */
const FIELD_EVIDENCE = {
  gozlemler: [{
    oturum: 3, protokol: '5', rx: '86F17A', tx: '817AF1', adresBiti: 8,
    etiket: 'ECU 7A (KWP)', rol: 'unknown', rolKaniti: 'none',
    kesifKaynagi: 'functional_0100', probSonucu: 'responded',
    txProvenance: 'kwp_iso14230',
    adreslenebilirlik: 'NOT_ADDRESSABLE',
    adreslenebilirlikEtiket: 'ULAŞILAMADI — istek gitti, ECU sustu',
    gerekce: 'fiziksel istek gitti, ECU sustu (03:NO_RESPONSE · 07:NO_RESPONSE)',
    admisyon: 'READY', kwpHedefDogrulandi: false, otoriteYayini: null,
    denemeler: [{ servis: '03', altFonksiyon: null, sonuc: 'NO_RESPONSE', ham: null, kodAdedi: 0 }],
  }],
  tamlik: {
    oturum: 3, bayatOturum: false, kesfedilen: 1, problanan: 1, taranan: 0,
    atlanan: 0, okunamayan: 0, ulasilamayan: 1, paydaBiliniyor: false,
    kapsamEtiketi: 'UNKNOWN',
  },
  kwpOturumProbu: [{
    oturum: 3, protokol: '5', tx: '817AF1', rx: '86F17A',
    istek: '1081', pozitifOnek: '5081', hamYanit: null,
    sonuc: 'NO_RESPONSE', sonucEtiket: 'ECU SUSTU — istek gitti, yanıt yok',
    nrc: null, nativeSonuc: 'no_response', hata: null,
  }],
  kwp18Kapisi: {
    kapiSonucu: 'NOT_SENT', gonderilmemeNedeni: 'KWP target/session kanıtı yok',
    oturumIstegi: '1081', oturumYaniti: null, fizikselHedef: null,
  },
};

describe('P0-OBD-FINAL-02 › C1 — LAB kopyası ECU kanıtını TAŞIR', () => {
  it('🔒 KİLİT: bölüm HER ZAMAN vardır — kaynak okunamasa bile "okunamadı" yazar', () => {
    const r = buildCarosLabCopy(emptyInput());
    expect(r.text).toContain('## ECU KEŞİF / ADRESLENEBİLİRLİK KANITI');
    /* Boşluk "araçta ECU yok" DİYE OKUNMAMALIDIR — metin bunu AÇIKÇA söyler. */
    expect(r.text).toMatch(/ECU yok. ANLAMINA GELMEZ/);
  });

  it('🔒 KİLİT: SAHA KANITI kopyaya GİRER (adres · protokol · adreslenebilirlik)', () => {
    const r = buildCarosLabCopy(emptyInput({ ecuDiscovery: FIELD_EVIDENCE }));
    for (const needle of ['86F17A', '817AF1', 'NOT_ADDRESSABLE', 'kwp_iso14230']) {
      expect(r.text, needle).toContain(needle);
    }
  });

  it('🔒 KİLİT: KWP oturum probu kanıtı kopyaya GİRER (istek · pozitif önek · sonuç)', () => {
    const r = buildCarosLabCopy(emptyInput({ ecuDiscovery: FIELD_EVIDENCE }));
    expect(r.text).toContain('1081');
    expect(r.text).toContain('5081');
    expect(r.text).toContain('NO_RESPONSE');
  });

  it('🔒 KİLİT: 0x18 kapısının GÖNDERİLMEME NEDENİ kopyada okunabilir', () => {
    const r = buildCarosLabCopy(emptyInput({ ecuDiscovery: FIELD_EVIDENCE }));
    expect(r.text).toContain('NOT_SENT');
    expect(r.text).toMatch(/kan.t. yok/);
  });

  it('🔒 KİLİT: ROL kanıtsız taşınır — kopya adresten anlam ÇIKARMAZ', () => {
    const r = buildCarosLabCopy(emptyInput({ ecuDiscovery: FIELD_EVIDENCE }));
    expect(r.text).toContain('unknown');
    for (const guess of ['motor ECU', 'engine', 'transmission', 'ABS']) {
      expect(r.text, guess).not.toContain(guess);
    }
  });

  it('🔒 KİLİT: kanıt KANONİK kaynaklardan okunur — ikinci paralel state YOK', () => {
    const src = stripComments(read('src/platform/devtools/carosLabCopySources.ts'));
    expect(src).toMatch(/getEcuObservations/);
    expect(src).toMatch(/getLastEcuCompleteness/);
    expect(src).toMatch(/getKwpSessionProbes/);
    expect(src).toMatch(/getKwpDtcEvidence/);
    /* Kopya yolu SENKRONDUR: yeni tarama/prob TETİKLEMEZ (gözlem eylemi). */
    expect(src).not.toMatch(/scanAllEcus|runFullVehicleScan|probeKwpSession/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C2 — NATIVE FAILURE CLASS ZİNCİRİ (native → köprü → runtime → defter → LAB)
 * ═════════════════════════════════════════════════════════════════════════ */

function connectFailSample(over: Partial<LinkLossSample> = {}): LinkLossSample {
  return {
    atMs: 1_000, trigger: 'CONNECT_FAIL', timeoutStage: null,
    linkPacketAgeMs: 500, ecuDataAgeMs: 900, adapterVoltageV: 13.8,
    everHadEcuData: true, transport: 'classic', protocolActive: '5',
    nativeFailureClass: null,
    ...over,
  };
}

describe('P0-OBD-FINAL-02 › C2 — native hata sınıfı UNKNOWN’a KAYBOLMAZ', () => {
  it('🔒 KİLİT: SAHA — sınıf YOKKEN UNKNOWN + NATIVE_SOCKET_ERROR açığı KORUNUR', () => {
    const r = classifyLinkLoss(connectFailSample({ nativeFailureClass: null }));
    expect(r.candidate).toBe('UNKNOWN');
    expect(r.evidenceGap).toContain('NATIVE_SOCKET_ERROR');
    expect(r.nativeFailureClass).toBeNull();
  });

  it('🔒 KİLİT: sınıf VARSA aday ÜRETİLİR ve kanıt açığı KAPANIR', () => {
    const r = classifyLinkLoss(connectFailSample({ nativeFailureClass: 'socket_closed' }));
    expect(r.candidate).toBe('RFCOMM_SOCKET_DROP');
    expect(r.evidenceGap).not.toContain('NATIVE_SOCKET_ERROR');
    expect(r.nativeFailureClass).toBe('socket_closed');
    expect(r.note).toMatch(/socket_closed/);
  });

  it('sınıf → aday eşlemesi ölçülmüş anlamı taşır (uydurma eşleme yok)', () => {
    expect(candidateFromNativeFailureClass('broken_pipe')?.candidate).toBe('RFCOMM_SOCKET_DROP');
    expect(candidateFromNativeFailureClass('connection_refused')?.candidate).toBe('ADAPTER_UNREACHABLE');
    expect(candidateFromNativeFailureClass('resource_busy')?.candidate).toBe('ADAPTER_UNREACHABLE');
    expect(candidateFromNativeFailureClass('elm_init_failed')?.candidate).toBe('ELM_INIT_INCOMPLETE');
    expect(candidateFromNativeFailureClass('no_vehicle_response')?.candidate).toBe('ECU_SILENT');
  });

  it('🔒 KİLİT: AYIRT EDİCİ OLMAYAN sınıflar aday UYDURMAZ (fail-closed)', () => {
    for (const cls of ['io_error', 'timeout', 'interrupted', 'unknown']) {
      expect(candidateFromNativeFailureClass(cls), cls).toBeNull();
      const r = classifyLinkLoss(connectFailSample({ nativeFailureClass: cls }));
      expect(r.candidate, cls).toBe('UNKNOWN');
    }
  });

  it('🔒 KİLİT: TANINMAYAN dize teşhisi KİRLETEMEZ (kapalı küme)', () => {
    expect(candidateFromNativeFailureClass('kernel_panic_9000')).toBeNull();
    expect(candidateFromNativeFailureClass(undefined)).toBeNull();
    expect(classifyLinkLoss(connectFailSample({ nativeFailureClass: 'kernel_panic_9000' })).candidate)
      .toBe('UNKNOWN');
  });

  it('eşlenen her sınıf `NATIVE_CONNECT_FAILURE_CLASSES` kapalı kümesinde YAŞAR', () => {
    for (const cls of ['socket_closed', 'broken_pipe', 'read_failed', 'connection_refused',
      'device_not_found', 'bt_disabled', 'bond_failed', 'gatt_failure', 'resource_busy',
      'permission_denied', 'elm_init_failed', 'no_vehicle_response']) {
      expect(NATIVE_CONNECT_FAILURE_CLASSES.has(cls), cls).toBe(true);
    }
  });

  it('timeout aşaması bildirilmese de sınıf ayırt ediciyse aday üretilir (iki eksen ayrı)', () => {
    const r = classifyLinkLoss(connectFailSample({
      trigger: 'CONNECT_TIMEOUT', timeoutStage: null, nativeFailureClass: 'elm_init_failed',
    }));
    expect(r.candidate).toBe('ELM_INIT_INCOMPLETE');
    /* Aşama kanıtı HÂLÂ eksiktir ve bu SESSİZLEŞTİRİLMEZ. */
    expect(r.evidenceGap).toContain('TIMEOUT_STAGE');
  });

  it('🔒 KİLİT: bildirilmiş timeout AŞAMASI native sınıfla EZİLMEZ (ölçülmüş kanıt önce)', () => {
    const r = classifyLinkLoss(connectFailSample({
      trigger: 'CONNECT_TIMEOUT', timeoutStage: 'transport', nativeFailureClass: 'no_vehicle_response',
    }));
    expect(r.candidate).toBe('ADAPTER_UNREACHABLE');
    expect(r.evidenceGap).not.toContain('TIMEOUT_STAGE');
  });
});

describe('P0-OBD-FINAL-02 › C2 — zincirin UÇTAN UCA bağlı olduğu', () => {
  it('1. NATIVE: istisna SINIFINDAN türer ve callback ile taşınır', () => {
    for (const f of ['OBDManager', 'BleObdManager']) {
      const j = read(`android/app/src/main/java/com/cockpitos/pro/obd/${f}.java`);
      expect(j, f).toMatch(/ObdFailureClass\.of\(e\)/);
      expect(j, f).toMatch(/void onFailed\(String error, String code, String failureClass\)/);
    }
  });

  it('2. KÖPRÜ: plugin `failureClass` alanını olaya YAZAR', () => {
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin).toMatch(/event\.put\("failureClass", failureClass\)/);
  });

  it('3. RUNTIME: obdService sınıfı SAKLAR ve kopma defterine GEÇİRİR', () => {
    const svc = stripComments(read('src/platform/obdService.ts'));
    expect(svc).toMatch(/_lastNativeFailureClass = event\.failureClass/);
    /* Bu turda kapatılan halka: defterin GİRDİSİ. */
    expect(svc).toMatch(/nativeFailureClass: _lastNativeFailureClass/);
  });

  it('4. DEFTER: kayıt sınıfı TAŞIR → LAB kopyası onu otomatik görür', () => {
    const led = stripComments(read('src/platform/obd/linkLossLedger.ts'));
    expect(led).toMatch(/nativeFailureClass: sample\.nativeFailureClass \?\? null/);
    const src = stripComments(read('src/platform/devtools/carosLabCopySources.ts'));
    /* Kopma defteri kayıtları kopyaya HAM geçer — alan eklemek yeterlidir. */
    expect(src).toMatch(/records: l\.records/);
  });
});
