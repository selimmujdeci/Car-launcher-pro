/**
 * dtcClearChain.test.ts — P0-OBD-10 · MODE 04 (DTC SİLME) ZİNCİR KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SAHA KUSURU: gerçek araçta P0089 **BEKLEYEN (Mode 07)** olarak DOĞRU
 * okunuyordu; kullanıcı "HAFIZAYI TEMİZLE" dediğinde kod silinmiyordu.
 * Zincir uçtan uca ölçüldü; ÜÇ ayrı kusur bulundu:
 *
 *  (1) KOMUT HİÇ GİTMİYORDU. Silme önkoşulu YALNIZ Mode 03 (onaylanmış)
 *      listesine bakıyordu → bekleyen-yalnız araçta liste boş → düğme pasif +
 *      servis erken dönüş → ECU'ya tek bayt gitmiyordu.
 *  (2) BAŞARI = "İSTİSNA FIRLATMADI" idi. ECU'nun ne cevapladığı okunmuyordu;
 *      NO DATA · timeout · negatif yanıt · hat hatası tek bir `false`a düşüyordu.
 *  (3) SİLME SONRASI YENİDEN OKUMA YOKTU. UI listesi körlemesine boşaltılıyordu
 *      (`codes: []`) → ekran "temizlendi" derken araçta kod duruyordu.
 *
 * Bu dosya o üç kusurun geri gelmesini KİLİTLER. Kilitler ZAYIFLATILAMAZ.
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  classifyClearResponse, evaluateClearVerdict, isClearSuccessVerdict, describeClearNrc,
  DTC_CLEAR_VERDICT_MESSAGE,
  type ClearObservedCode,
} from '../platform/obd/dtcClearModel';
import type { DtcScanCompleteness } from '../platform/dtcService';

/* ═══════════════════════════════════════════════════════════════════════════
   A) SAF KATMAN — ECU YANITI SINIFLANDIRMASI
   ═══════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-10 · A) Mode 04 yanıt sınıflandırması', () => {
  it('A1 — BAŞARILI Mode 04: pozitif yanıt (44) tanınır', () => {
    for (const raw of ['44', '44 00', '7E8 01 44', '7E8 03 44 00 00', ' 44 \r']) {
      expect(classifyClearResponse(raw).outcome).toBe('POSITIVE');
    }
  });

  it('A2 — NEGATİF yanıt: 7F 04 <NRC> "silindi" SAYILMAZ ve NRC taşınır', () => {
    const r = classifyClearResponse('7F 04 22');
    expect(r.outcome).toBe('NEGATIVE');
    expect(r.nrc).toBe('22');
    expect(describeClearNrc('22')).toMatch(/koşullar uygun değil/i);
  });

  it('🔒 A3 — KİLİT: "7F 04 44" (NRC 0x44) POZİTİF SANILMAZ', () => {
    /* ÖLÇÜLEN KÖK NEDEN: eski native kod `raw.contains("44")` yapıyordu; NRC
       değeri 0x44 olan bir NEGATİF yanıt "silindi" olarak okunuyordu. Hizasız
       eşleşme sahte başarı üretir — bu kilit onu kalıcı olarak kapatır. */
    const r = classifyClearResponse('7E8 03 7F 04 44');
    expect(r.outcome).toBe('NEGATIVE');
    expect(r.nrc).toBe('44');
    expect(r.outcome).not.toBe('POSITIVE');
  });

  it('A4 — NO DATA: ECU sustu; hat hatasıyla KARIŞTIRILMAZ', () => {
    expect(classifyClearResponse('NO DATA').outcome).toBe('NO_DATA');
    expect(classifyClearResponse('NO DATA').outcome).not.toBe('BUS_ERROR');
  });

  it('A5 — TIMEOUT: boş/yok yanıt NO_RESPONSE (kanal prompt görmeden döndü)', () => {
    expect(classifyClearResponse('').outcome).toBe('NO_RESPONSE');
    expect(classifyClearResponse('   ').outcome).toBe('NO_RESPONSE');
    expect(classifyClearResponse(null).outcome).toBe('NO_RESPONSE');
  });

  it('A6 — BAĞLANTI KOPMASI/hat hatası: BUS_ERROR (ECU reddetti DEĞİL)', () => {
    for (const raw of ['UNABLE TO CONNECT', 'CAN ERROR', 'BUS ERROR', 'STOPPED', 'BUFFER FULL']) {
      expect(classifyClearResponse(raw).outcome).toBe('BUS_ERROR');
    }
  });

  it('A7 — "?" adaptör komutu anlamadı → UNSUPPORTED', () => {
    expect(classifyClearResponse('?').outcome).toBe('UNSUPPORTED');
  });

  it('A8 — çok-ECU: bir ECU 44 dönerse POZİTİF (fonksiyonel yayın)', () => {
    expect(classifyClearResponse('7E8 01 44\n7E9 01 44').outcome).toBe('POSITIVE');
  });

  it('A9 — hiçbir sınıfa girmeyen yanıt UNKNOWN (hüküm UYDURULMAZ)', () => {
    expect(classifyClearResponse('01 02 03').outcome).toBe('UNKNOWN');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) SAF KATMAN — HÜKÜM (komut + silme sonrası ÖLÇÜM)
   ═══════════════════════════════════════════════════════════════════════════ */

const FULL_OK: DtcScanCompleteness = { stored: 'ok', pending: 'ok', permanent: 'ok' };
const c = (code: string, status: ClearObservedCode['status']): ClearObservedCode => ({ code, status });

describe('P0-OBD-10 · B) Silme hükmü — "komut gönderildi" ≠ "kod silindi"', () => {
  it('🔒 B1 — KİLİT: komut BAŞARILI + yeniden okumada kod YOK → SİLİNDİ', () => {
    const v = evaluateClearVerdict({
      outcome: 'POSITIVE', before: [c('P0089', 'pending')], after: [], afterCompleteness: FULL_OK,
    });
    expect(v.verdict).toBe('CLEARED');
    expect(v.removed).toEqual(['P0089']);
    expect(isClearSuccessVerdict(v.verdict)).toBe(true);
  });

  it('🔒 B2 — KİLİT: komut başarılı ama HİÇ kod gitmedi → "SİLİNDİ" DENMEZ', () => {
    /* "hiç silinemedi" ile "silindi ve arıza aktif olduğu için anında geri yazıldı"
       TEK yeniden okumayla AYIRT EDİLEMEZ. Ürün taraf TUTMAZ — ama asla
       "temizlendi" de DEMEZ. */
    const v = evaluateClearVerdict({
      outcome: 'POSITIVE',
      before: [c('P0089', 'pending')],
      after:  [c('P0089', 'pending')],
      afterCompleteness: FULL_OK,
    });
    expect(v.verdict).toBe('INDETERMINATE_CODES_REMAIN');
    expect(isClearSuccessVerdict(v.verdict)).toBe(false);
    expect(v.remaining).toEqual(['P0089']);
    expect(DTC_CLEAR_VERDICT_MESSAGE[v.verdict]).toMatch(/ayırt edilemez/i);
  });

  it('🔒 B3 — KİLİT: ONAYLANMIŞ gidiyor ama BEKLEYEN geri geliyor → sınıflar KARIŞMAZ', () => {
    const v = evaluateClearVerdict({
      outcome: 'POSITIVE',
      before: [c('P0089', 'stored')],
      after:  [c('P0089', 'pending')],   // aktif arıza: ECU bekleyen olarak yeniden yazdı
      afterCompleteness: FULL_OK,
    });
    expect(v.verdict).toBe('CLEARED_BUT_RETURNED');
    expect(v.removed).toEqual(['P0089']);      // onaylanmış GİTTİ (ölçüldü)
    expect(v.returned).toEqual(['P0089']);     // bekleyen olarak GERİ GELDİ
    /* Bu bir BAŞARISIZLIK DEĞİLDİR ve "silinemedi" ile karıştırılmaz — ama
       "her şey temiz" de değildir; başarı sayılmaz. */
    expect(isClearSuccessVerdict(v.verdict)).toBe(false);
  });

  it('🔒 B4 — KİLİT: KALICI (Mode 0A) kod duruyor → BAŞARISIZLIK DEĞİL', () => {
    /* SAE J1979: Mode 0A kodu Mode 04 ile silinmez, ECU koşullar sağlanınca
       kendi temizler. Onu "silinemedi" saymak SAHTE BAŞARISIZLIK üretir. */
    const v = evaluateClearVerdict({
      outcome: 'POSITIVE',
      before: [c('P0089', 'pending'), c('P0420', 'permanent')],
      after:  [c('P0420', 'permanent')],
      afterCompleteness: FULL_OK,
    });
    expect(v.verdict).toBe('CLEARED_PERMANENT_REMAINS');
    expect(v.permanentRemaining).toEqual(['P0420']);
    expect(v.remaining).toEqual([]);                 // KALICI "duran" sayılmaz
    expect(isClearSuccessVerdict(v.verdict)).toBe(true);
    expect(DTC_CLEAR_VERDICT_MESSAGE[v.verdict]).toMatch(/kalıcı/i);
  });

  it('🔒 B5 — KİLİT: komut başarılı + araçta zaten kod yok → SİLİNDİ (sahte hata yok)', () => {
    const v = evaluateClearVerdict({
      outcome: 'POSITIVE', before: [], after: [], afterCompleteness: FULL_OK,
    });
    expect(v.verdict).toBe('CLEARED');
  });

  it('🔒 B6 — KİLİT: ECU reddettiyse hüküm KOMUT BAŞARISIZ (yeniden okumaya bakılmaz)', () => {
    for (const o of ['NEGATIVE', 'NO_DATA', 'NO_RESPONSE', 'BUS_ERROR', 'UNSUPPORTED', 'TRANSPORT_ERROR', 'UNKNOWN'] as const) {
      const v = evaluateClearVerdict({ outcome: o, before: [c('P0089', 'pending')], after: [], afterCompleteness: FULL_OK });
      expect(v.verdict).toBe('COMMAND_FAILED');
      expect(isClearSuccessVerdict(v.verdict)).toBe(false);
    }
  });

  it('🔒 B7 — KİLİT: doğrulama okuması YAPILAMADI → "silindi" DENMEZ (DOĞRULANAMADI)', () => {
    const v = evaluateClearVerdict({
      outcome: 'POSITIVE', before: [c('P0089', 'pending')], after: null, afterCompleteness: null,
    });
    expect(v.verdict).toBe('UNVERIFIED');
    expect(isClearSuccessVerdict(v.verdict)).toBe(false);
  });

  it('🔒 B8 — KİLİT: doğrulama okumasının BİR MODU düştüyse hüküm DOĞRULANAMADI', () => {
    const v = evaluateClearVerdict({
      outcome: 'POSITIVE', before: [c('P0089', 'pending')], after: [],
      afterCompleteness: { stored: 'ok', pending: 'failed', permanent: 'ok' },
    });
    expect(v.verdict).toBe('UNVERIFIED');
  });

  it('B9 — "unsupported" mod kapsamı BOZMAZ (araç o servisi hiç bilmiyor)', () => {
    const v = evaluateClearVerdict({
      outcome: 'POSITIVE', before: [c('P0089', 'pending')], after: [],
      afterCompleteness: { stored: 'ok', pending: 'ok', permanent: 'unsupported' },
    });
    expect(v.verdict).toBe('CLEARED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) ZİNCİR — dtcService.clearDTCCodes uçtan uca
   ═══════════════════════════════════════════════════════════════════════════ */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    readDTC:       vi.fn(async () => ({ codes: [] as string[] })),
    clearDTC:      vi.fn(async () => undefined),
    clearDtcCodes: vi.fn(async () => ({ tx: '04', raw: '44', outcome: 'POSITIVE', elapsedMs: 120 })),
    readDtcClass:  vi.fn(async (_o: { mode: string }) => ({ codes: [] as string[], raw: '', supported: true })),
  },
}));
vi.mock('../platform/obdService', () => ({
  getOBDDataSnapshot: vi.fn(() => ({
    connectionState: 'connected', speed: 0, rpm: 0, lastSeenMs: Date.now(),
  })),
  getObdSessionEpoch: vi.fn(() => 7),
}));

import { CarLauncher } from '../platform/nativePlugin';
import {
  clearDTCCodes, readAllDTCs, readDTCCodes,
  getClearableDtcSnapshot, getDTCStateSnapshot, _resetDtcServiceForTest,
} from '../platform/dtcService';
import { getDtcClearEvidence, _resetDtcClearEvidenceForTest } from '../platform/obd/dtcClearEvidence';
import { _resetDtcEvidenceForTest } from '../platform/obd/dtcScanEvidence';
/* ARCH-05 FIXTURE (kilit ZAYIFLATMASI DEĞİL): `clearDTCCodes` artık write
   gate'in yanında bir YETKİ kapısı da taşır; o kapı araç kapsamını
   `capabilityStore`dan, hareketi `obdService.getObdSpeedFresh`ten okur ve bu
   dosyada `obdService` mocklandığı için ölçüm bulamaz → fail-closed reddeder.
   Aşağıdaki bağlam bu zincirin sınadığı GERÇEK durumu anlatır: kimliği çözülmüş
   bir araç, kontak açık ve DURUYOR (mock `speed: 0` ile birebir tutarlı).
   Hiçbir iddia gevşetilmedi; yetki kapısının GERÇEKTEN çalıştığı ayrı kilitlerle
   kanıtlanır (`arch05ProductionEnforcement.test.ts` G bloğu). */
import { _setSecurityContextForTest } from '../platform/security/enforcement';

/** Native `readDtcClass`'ı sınıf başına programlar (mode → kodlar). */
/*
 * P0-VDK-F2C1 — VARSAYILAN HAM GÖVDE ARTIK BOŞ ('').
 * Bu dosya NATIVE SİLME ZİNCİRİNİ sınar, çözümleyiciyi değil. Eski varsayılan
 * (`'RAW'`) gerçek bir DTC gövdesi DEĞİLDİR ve kanonik çözümleyici onu haklı
 * olarak tanımaz. Boş gövde `LEGACY_NATIVE` yolunu seçtirir → bu dosyadaki
 * kilitlerin İDDİASI DEĞİŞMEDEN korunur (zayıflatma değil, fixture düzeltmesi).
 * Kanonik çözümleyicinin kendi kilitleri `functionalDtcParser.test.ts`tedir.
 */
function programClasses(map: Partial<Record<'03' | '07' | '0A', string[]>>, raw = ''): void {
  vi.mocked(CarLauncher.readDtcClass!).mockImplementation(async (o: { mode: string }) => ({
    codes: map[o.mode as '03' | '07' | '0A'] ?? [],
    raw,
    supported: true,
  }));
  vi.mocked(CarLauncher.readDTC).mockResolvedValue({ codes: map['03'] ?? [] });
}

describe('P0-OBD-10 · C) clearDTCCodes zinciri (native)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    _resetDtcServiceForTest();
    _resetDtcClearEvidenceForTest();
    _resetDtcEvidenceForTest();
    vi.mocked(CarLauncher.clearDtcCodes!).mockResolvedValue({ tx: '04', raw: '44', outcome: 'POSITIVE', elapsedMs: 120 });
    // Oturum mührünü her testte SIFIRLA — C10 onu bilinçli olarak değiştirir ve
    // `clearAllMocks` implementasyonu (mockReturnValue) sıfırlamaz.
    const obd = await import('../platform/obdService');
    vi.mocked(obd.getObdSessionEpoch).mockReturnValue(7);
    _setSecurityContextForTest({ vehicleRef: 'a1b2c3d4e5f60718', motion: 'PARKED' });
    programClasses({});
  });
  afterEach(() => { _setSecurityContextForTest(null); });

  it('🔒 C1 — KİLİT (ANA SAHA KUSURU): YALNIZ BEKLEYEN kod varken Mode 04 GÖNDERİLİR', async () => {
    /* ÖLÇÜLEN KUSUR: envanter yalnız `_state.codes` (Mode 03) idi. Gerçek araçta
       tek arıza P0089 BEKLEYEN olduğu için silme HİÇ denenmiyordu — ECU'ya tek
       bayt gitmiyordu. Bu kilit "komut gerçekten hatta çıkıyor mu" sorusunu
       kalıcı olarak yanıtlar. */
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();

    // Mode 03 listesi BOŞ olmasına rağmen envanter DOLU olmalı.
    expect(getDTCStateSnapshot().codes).toHaveLength(0);
    expect(getClearableDtcSnapshot().count).toBe(1);

    programClasses({});                       // silme sonrası: kod kalmadı
    const r = await clearDTCCodes({ confirmed: true });

    expect(CarLauncher.clearDtcCodes).toHaveBeenCalledTimes(1);   // ← ana kilit
    expect(r.allowed).toBe(true);
    expect(r.clear?.verdict).toBe('CLEARED');
    expect(r.clear?.success).toBe(true);
  });

  it('🔒 C2 — KİLİT: KALICI (Mode 0A) kod TEK BAŞINA silme düğmesini AÇMAZ', () => {
    /* Mode 04 kalıcı kodu silemez; onun için komut göndermek "sil" deyip
       "silinemedi" demektir (sahte başarısızlık). */
    programClasses({ '0A': ['P0420'] });
    return readAllDTCs().then(() => {
      expect(getClearableDtcSnapshot().count).toBe(0);
    });
  });

  it('🔒 C3 — KİLİT: NEGATİF yanıt → "temizlendi" DENMEZ, liste KORUNUR', async () => {
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();
    vi.mocked(CarLauncher.clearDtcCodes!).mockResolvedValue({
      tx: '04', raw: '7F 04 22', outcome: 'NEGATIVE', nrc: '22', elapsedMs: 90,
    });

    const r = await clearDTCCodes({ confirmed: true });

    expect(r.clear?.commandOutcome).toBe('NEGATIVE');
    expect(r.clear?.verdict).toBe('COMMAND_FAILED');
    expect(r.clear?.success).toBe(false);
    expect(r.clear?.userMessage).toMatch(/koşullar uygun değil/i);
    // Kodlar KORUNUR: envanter boşaltılmaz (yalancı temizlik yok).
    expect(getClearableDtcSnapshot().count).toBe(1);
  });

  it('🔒 C4 — KİLİT: NO DATA → başarısız; yeniden okuma DENENMEZ', async () => {
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();
    vi.mocked(CarLauncher.readDtcClass!).mockClear();
    vi.mocked(CarLauncher.clearDtcCodes!).mockResolvedValue({
      tx: '04', raw: 'NO DATA', outcome: 'NO_DATA', elapsedMs: 4000,
    });

    const r = await clearDTCCodes({ confirmed: true });

    expect(r.clear?.commandOutcome).toBe('NO_DATA');
    expect(r.clear?.success).toBe(false);
    expect(CarLauncher.readDtcClass).not.toHaveBeenCalled();
  });

  it('🔒 C5 — KİLİT: TIMEOUT (boş yanıt) → başarısız, sahte onay YOK', async () => {
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();
    vi.mocked(CarLauncher.clearDtcCodes!).mockResolvedValue({
      tx: '04', raw: '', outcome: 'NO_RESPONSE', elapsedMs: 4000,
    });

    const r = await clearDTCCodes({ confirmed: true });
    expect(r.clear?.commandOutcome).toBe('NO_RESPONSE');
    expect(r.clear?.success).toBe(false);
  });

  it('🔒 C6 — KİLİT: BAĞLANTI KOPMASI (native reject) → TRANSPORT_ERROR, kodlar KORUNUR', async () => {
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();
    vi.mocked(CarLauncher.clearDtcCodes!).mockRejectedValue(new Error('OBD okuyucu bağlı değil'));

    const r = await clearDTCCodes({ confirmed: true });

    expect(r.clear?.commandOutcome).toBe('TRANSPORT_ERROR');
    expect(r.clear?.success).toBe(false);
    expect(r.clear?.userMessage).toMatch(/bağlı değil/i);
    expect(getClearableDtcSnapshot().count).toBe(1);
    expect(getDTCStateSnapshot().isStale).toBe(true);
  });

  it('🔒 C7 — KİLİT: komut başarılı + AYNI BEKLEYEN kod geri geliyor → "silindi" DENMEZ', async () => {
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();
    // Silme sonrası okuma AYNI kodu döndürür (arıza aktif ya da silme olmadı).
    const r = await clearDTCCodes({ confirmed: true });

    expect(r.clear?.commandOutcome).toBe('POSITIVE');
    expect(r.clear?.verdict).toBe('INDETERMINATE_CODES_REMAIN');
    expect(r.clear?.success).toBe(false);
    expect(r.clear?.remaining).toEqual(['P0089']);
  });

  it('🔒 C8 — KİLİT: ONAYLANMIŞ gidiyor, BEKLEYEN geri geliyor → SİLİNDİ+GERİ GELDİ', async () => {
    programClasses({ '03': ['P0089'] });
    await readDTCCodes();
    await readAllDTCs();
    expect(getClearableDtcSnapshot().count).toBe(1);

    programClasses({ '07': ['P0089'] });     // silme sonrası: bekleyen olarak geri geldi
    const r = await clearDTCCodes({ confirmed: true });

    expect(r.clear?.verdict).toBe('CLEARED_BUT_RETURNED');
    expect(r.clear?.removed).toEqual(['P0089']);
    expect(r.clear?.returned).toEqual(['P0089']);
    expect(r.clear?.success).toBe(false);
  });

  it('🔒 C9 — KİLİT: KALICI kod duruyor → başarı sayılır ama AYRI raporlanır', async () => {
    programClasses({ '07': ['P0089'], '0A': ['P0420'] });
    await readAllDTCs();

    programClasses({ '0A': ['P0420'] });     // kalıcı silinmez — beklenen davranış
    const r = await clearDTCCodes({ confirmed: true });

    expect(r.clear?.verdict).toBe('CLEARED_PERMANENT_REMAINS');
    expect(r.clear?.permanentRemaining).toEqual(['P0420']);
    expect(r.clear?.success).toBe(true);
    expect(r.clear?.remaining).toEqual([]);
  });

  it('🔒 C10 — KİLİT: BAYAT/ESKİ OTURUM kodu yeni taramaya TAŞINMAZ', async () => {
    /* Silme sonrası liste ÖLÇÜMDEN kurulur, körlemesine boşaltılmaz VE eski
       oturumun envanteri yeni oturuma sızmaz. */
    programClasses({ '03': ['P0301'], '07': ['P0089'] });
    await readDTCCodes();
    await readAllDTCs();
    expect(getClearableDtcSnapshot().count).toBe(2);

    // Adaptör başka araca takıldı → yeni oturum.
    const obd = await import('../platform/obdService');
    vi.mocked(obd.getObdSessionEpoch).mockReturnValue(8);

    expect(getClearableDtcSnapshot().codes.some((x) => x.status === 'pending')).toBe(false);
  });

  it('🔒 C11 — KİLİT: fonksiyonel kapsam (7DF) kaydedilir — YANLIŞ ECU/header kullanılmaz', async () => {
    /* Ürün Mode 04'ü FONKSİYONEL adresle yayınlar; belirli bir ECU header'ı
       SEÇMEZ (ATSH ile fiziksel adres kurup silme YOK). Kanıt bunu yazar ki
       "yanlış ECU'ya gitti mi" sorusu ölçümle yanıtlanabilsin. */
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();
    programClasses({});
    await clearDTCCodes({ confirmed: true });

    const ev = getDtcClearEvidence();
    expect(ev).toHaveLength(1);
    expect(ev[0].scope).toBe('functional_7DF');
    expect(ev[0].tx).toBe('04');
    expect(ev[0].raw).toBe('44');
    expect(ev[0].sessionEpoch).toBe(7);
    // Silme sonrası üç sınıfın da yeniden okunduğu KANITTA görünür.
    expect(ev[0].reread.map((r) => r.service)).toEqual(['03', '07', '0A']);
  });

  it('🔒 C12 — KİLİT: yazma kapısı reddi de KANITA yazılır (komut gitmedi kaydı)', async () => {
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();

    const r = await clearDTCCodes({ confirmed: false });   // onay yok → kapı reddeder

    expect(CarLauncher.clearDtcCodes).not.toHaveBeenCalled();
    expect(r.allowed).toBe(false);
    expect(r.clear).toBeNull();

    const ev = getDtcClearEvidence();
    expect(ev).toHaveLength(1);
    expect(ev[0].gateAllowed).toBe(false);
    expect(ev[0].gateDenyReason).toBe('not_confirmed');
    expect(ev[0].tx).toBeNull();          // komut GİTMEDİ — "04" yazmak yalan olurdu
    expect(ev[0].verdict).toBe('DENIED');
  });

  it('🔒 C13 — KİLİT: doğrulama okuması DÜŞERSE hüküm DOĞRULANAMADI (liste KORUNUR)', async () => {
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();
    vi.mocked(CarLauncher.readDtcClass!).mockRejectedValue(new Error('ELM327 hata yanıtı'));

    const r = await clearDTCCodes({ confirmed: true });

    expect(r.clear?.verdict).toBe('UNVERIFIED');
    expect(r.clear?.success).toBe(false);
    expect(r.clear?.rereadRan).toBe(true);   // okuma DENENDİ ama kapsam düştü
    expect(getDTCStateSnapshot().isStale).toBe(true);
  });

  it('C14 — eski native plugin (clearDtcCodes YOK) → eski yol çalışır, ham yanıt UYDURULMAZ', async () => {
    programClasses({ '07': ['P0089'] });
    await readAllDTCs();
    const saved = CarLauncher.clearDtcCodes;
    // @ts-expect-error — geri-uyumluluk yolu: metot yokmuş gibi davran.
    CarLauncher.clearDtcCodes = undefined;
    try {
      programClasses({});
      const r = await clearDTCCodes({ confirmed: true });
      expect(CarLauncher.clearDTC).toHaveBeenCalledTimes(1);
      expect(r.clear?.verdict).toBe('CLEARED');
      const ev = getDtcClearEvidence();
      expect(ev[ev.length - 1].raw).toBeNull();   // ham yok → boş string YAZILMAZ
    } finally {
      CarLauncher.clearDtcCodes = saved;
    }
  });
});
