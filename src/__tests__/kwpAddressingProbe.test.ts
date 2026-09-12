/**
 * kwpAddressingProbe.test.ts — P0-OBD-DIAG-01 KİLİTLERİ.
 *
 * SAHA (2026-08-25 · Protocol 5 / KWP · ECU 7A · rx `86F17A`): fonksiyonel
 * sorgular cevap verirken fiziksel `817AF1` isteklerinin TAMAMI sustu — Mode 03
 * (1 bayt, uzunluk DOĞRU) da, oturum probu `10 81` (2 bayt, uzunluk YANLIŞ
 * beyan ediliyor) da. Araçta BİLİNEN gerçek arıza var ama emisyon hafızası boş
 * → arıza üretici hafızasında ve oraya YALNIZ fiziksel adresle ulaşılır.
 *
 * Bu kilitler matrisin üç şeyini korur:
 *   1. SALT-OKUMA olduğunu (destructive servis matriste OLAMAZ),
 *   2. FAIL-CLOSED olduğunu (sessizlik adres kanıtı SAYILMAZ),
 *   3. KONTROL satırının hükmü ayırdığını ("hat öldü" ≠ "adres yanlış").
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  KWP_ADDRESSING_VARIANTS, KWP_ADDRESSING_MAX_VARIANTS, KWP_ADDRESSING_PROBE_RING,
  classifyKwpAddressingResponse, compactHex, displayRaw, isElmTextStatus,
  ecuSourceFromRxHeader, positiveSidOf,
  getKwpAddressingProbes, recordKwpAddressingProbe, resolveVariantHeader,
  summarizeKwpAddressing, _resetKwpAddressingProbesForTest,
  type KwpAddressingProbeEntry, type KwpAddressingResult,
} from '../platform/obd/kwpAddressingProbe';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const V = (id: string) => KWP_ADDRESSING_VARIANTS.find((x) => x.id === id)!;

function entry(p: Partial<KwpAddressingProbeEntry> & { variantId: string }): KwpAddressingProbeEntry {
  return {
    atMs: 1, sessionEpoch: 7, rx: '86F17A', header: '817AF1',
    physical: true, initFirst: null, initRaw: null, request: '03', raw: null, result: 'NO_RESPONSE',
    nrc: null, protocol: '5', nativeOutcome: null, error: null,
    ...p,
  };
}

beforeEach(() => { _resetKwpAddressingProbesForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * 1) MATRİS SÖZLEŞMESİ — SALT-OKUMA VE GEREKÇELİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-DIAG-01 — matris sözleşmesi', () => {
  it('🔒 KİLİT: matriste DESTRUCTIVE servis YOK (yazma · silme · reset · security)', () => {
    /* Bir TANI matrisinin işi okumaktır. Bu liste gevşerse ürün, adresini bile
       kanıtlayamadığı bir ECU'ya araç hafızasını değiştiren komut gönderebilir. */
    const forbidden = ['04', '11', '14', '23', '27', '2E', '2F', '31', '34', '35', '36', '37', '3B', '3D', '85', '87'];
    for (const v of KWP_ADDRESSING_VARIANTS) {
      const sid = compactHex(v.request).slice(0, 2);
      expect(forbidden, `${v.id} destructive servis taşıyor: ${sid}`).not.toContain(sid);
    }
  });

  it('🔒 KİLİT: KONTROL satırı VARDIR ve İLK sıradadır', () => {
    /* Kontrol satırı matrisin hükmünü ayıran şeydir; sona atılırsa hat matris
       ortasında ölünce "adres yanlış" diye YANLIŞ teşhis üretiriz. */
    const control = KWP_ADDRESSING_VARIANTS.filter((v) => !v.physical);
    expect(control.length, 'kontrol satırı kaldırılmış').toBe(1);
    expect(KWP_ADDRESSING_VARIANTS[0]!.physical, 'kontrol satırı ilk sırada değil').toBe(false);
    expect(KWP_ADDRESSING_VARIANTS[0]!.headerTemplate).toBe('C133F1');
  });

  it('🔒 KİLİT: fiziksel satırlar ARAÇA ÖZEL SABİT taşımaz — adres şablondan gelir', () => {
    for (const v of KWP_ADDRESSING_VARIANTS.filter((x) => x.physical)) {
      expect(v.headerTemplate, `${v.id} adresi sabitlenmiş`).toContain('{src}');
    }
  });

  it('her satırın GEREKÇESİ vardır (kanıtsız satır yasak) ve kimlikler tekildir', () => {
    for (const v of KWP_ADDRESSING_VARIANTS) {
      expect(v.why.length, `${v.id} gerekçesiz`).toBeGreaterThan(30);
      expect(v.label.length).toBeGreaterThan(5);
    }
    expect(new Set(KWP_ADDRESSING_VARIANTS.map((v) => v.id)).size)
      .toBe(KWP_ADDRESSING_VARIANTS.length);
  });

  it('matris TAVANLIDIR — K-line yavaştır, sınırsız deneme kabul edilemez', () => {
    expect(KWP_ADDRESSING_VARIANTS.length).toBeLessThanOrEqual(KWP_ADDRESSING_MAX_VARIANTS);
  });

  it('🔒 KİLİT: K-line BAŞLATMA satırları matrisin SONUNDA durur', () => {
    /* Başlatma çalışan fonksiyonel oturumu ANLIK böler. Başa alınırsa her
       taramada gereksiz yere hat kırılır; ölçüm için gereken sıra: önce
       kırmayan satırlar, sonra (gerekirse) başlatma. */
    const idx = KWP_ADDRESSING_VARIANTS.map((v, i) => (v.initFirst ? i : -1)).filter((i) => i >= 0);
    expect(idx.length, 'başlatma satırı yok — son aday ölçülmüyor').toBeGreaterThan(0);
    const firstInit = Math.min(...idx);
    const lastPlain = Math.max(...KWP_ADDRESSING_VARIANTS
      .map((v, i) => (v.initFirst ? -1 : i)));
    expect(firstInit, 'başlatma satırı kırmayan satırlardan ÖNCE').toBeGreaterThan(lastPlain);
  });

  it('🔒 KİLİT: başlatma satırları da SALT-OKUMA servisi taşır', () => {
    for (const v of KWP_ADDRESSING_VARIANTS.filter((x) => x.initFirst)) {
      expect(['03', '10'], `${v.id} başlatma sonrası riskli servis`)
        .toContain(compactHex(v.request).slice(0, 2));
    }
  });

  it('🔒 KİLİT: ISO 14230-2 uzunluk hipotezi matriste GERÇEKTEN ölçülüyor', () => {
    /* Kusurun ta kendisi buydu: ürün 2+ baytlık isteği de `81` ile gönderiyor.
       Matris aynı isteği DOĞRU uzunlukla (`82`) sormazsa hipotez ölçülmemiş olur. */
    const len2 = KWP_ADDRESSING_VARIANTS.filter(
      (v) => v.physical && v.headerTemplate.startsWith('82') && compactHex(v.request).length === 4);
    expect(len2.length, 'uzunluk-2 varyantı yok — hipotez ölçülmüyor').toBeGreaterThan(0);
    const len1 = KWP_ADDRESSING_VARIANTS.filter(
      (v) => v.physical && v.headerTemplate.startsWith('81') && compactHex(v.request).length === 2);
    expect(len1.length, 'uzunluk-1 temel satırı yok — karşılaştırma imkânsız').toBeGreaterThan(0);
  });

  it('header şablonu ECU kaynak adresiyle doldurulur', () => {
    expect(resolveVariantHeader(V('PHY_LEN1_03'), '7a')).toBe('817AF1');
    expect(resolveVariantHeader(V('PHY_LEN2_1081'), '7A')).toBe('827AF1');
    expect(resolveVariantHeader(V('CTRL_FUNCTIONAL_03'), '7A')).toBe('C133F1');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) ADRES OKUMA — rx header'dan KAYNAK
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-DIAG-01 — ECU kaynak adresi rx header icinden OKUNUR', () => {
  it('ISO 14230-2 yanit header bicimi Fmt·Tgt·Src → kaynak SON bayttir', () => {
    expect(ecuSourceFromRxHeader('86F17A')).toBe('7A');
    expect(ecuSourceFromRxHeader('86 F1 10')).toBe('10');
  });

  it('🔒 KİLİT: tester/fonksiyonel adres ECU kaynağı SAYILMAZ (yankı satırı)', () => {
    expect(ecuSourceFromRxHeader('8633F1')).toBeNull();   // src F1 = tester
    expect(ecuSourceFromRxHeader('86F133')).toBeNull();   // src 33 = fonksiyonel
    expect(ecuSourceFromRxHeader('86F16B')).toBeNull();
  });

  it('geçersiz/eksik header ADRES UYDURMAZ', () => {
    expect(ecuSourceFromRxHeader('7E8')).toBeNull();
    expect(ecuSourceFromRxHeader('')).toBeNull();
    expect(ecuSourceFromRxHeader(null)).toBeNull();
  });

  it('pozitif yanıt servisi SID+0x40 kuralından çıkar', () => {
    expect(positiveSidOf('03')).toBe('43');
    expect(positiveSidOf('1081')).toBe('50');
    expect(positiveSidOf('13')).toBe('53');
    expect(positiveSidOf('')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) SINIFLANDIRMA — FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-DIAG-01 — classifyKwpAddressingResponse (saf)', () => {
  it('pozitif yanıt (43…) → ANSWERED', () => {
    const r = classifyKwpAddressingResponse(V('PHY_LEN1_03'),
      { request: '03', raw: '86 F1 7A 43 00 00', outcome: 'ok' });
    expect(r.result).toBe<KwpAddressingResult>('ANSWERED');
  });

  it('🔒 KİLİT: ayrık NEGATİF yanıt (7F 03 11) da ADRES KANITIDIR — ECU konuşuyor', () => {
    /* Bu satır matrisin en ince yeridir: negatif yanıt "servis yok" der ama
       "bu adres CANLI" der. Sessizlikle aynı kefeye konursa gerçek bir kanıt
       çöpe gider ve üretici DTC yolu sonsuza dek kapalı kalır. */
    const r = classifyKwpAddressingResponse(V('PHY_LEN1_13'),
      { request: '13', raw: '86 F1 7A 7F 13 11', outcome: 'ok' });
    expect(r.result).toBe<KwpAddressingResult>('NEGATIVE');
    expect(r.nrc).toBe(0x11);
  });

  it('🔒 KİLİT: native "ok" DESE BİLE pozitif SID yoksa ANSWERED DEĞİL', () => {
    const r = classifyKwpAddressingResponse(V('PHY_LEN1_03'),
      { request: '03', raw: '?', outcome: 'ok' });
    expect(r.result).toBe<KwpAddressingResult>('MALFORMED');
  });

  it('🔒 KİLİT: SAHA SENARYOSU — ECU sustu → NO_RESPONSE (asla ANSWERED)', () => {
    const r = classifyKwpAddressingResponse(V('PHY_LEN1_03'),
      { request: '03', raw: null, outcome: 'no_response' });
    expect(r.result).toBe<KwpAddressingResult>('NO_RESPONSE');
  });

  it('hat hatası ECU hakkında kanıt DEĞİLDİR → TRANSPORT_ERROR', () => {
    const r = classifyKwpAddressingResponse(V('PHY_LEN1_03'),
      { request: '03', raw: 'BUS ERROR', outcome: 'transport_error' });
    expect(r.result).toBe<KwpAddressingResult>('TRANSPORT_ERROR');
  });

  it('istek hiç gönderilmediyse NOT_ATTEMPTED ("sorulmadı" ≠ "olmadı")', () => {
    const r = classifyKwpAddressingResponse(V('PHY_LEN1_03'),
      { request: null, raw: null, outcome: 'not_attempted' });
    expect(r.result).toBe<KwpAddressingResult>('NOT_ATTEMPTED');
  });

  it('BAŞKA servisin negatifi bu satıra YAZILMAZ (7F 03 vs 7F 13)', () => {
    const r = classifyKwpAddressingResponse(V('PHY_LEN1_13'),
      { request: '13', raw: '7F 03 11', outcome: 'ok' });
    expect(r.result).not.toBe<KwpAddressingResult>('NEGATIVE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) HÜKÜM — KONTROL SATIRI TEŞHİSİ AYIRIR
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-DIAG-01 — summarizeKwpAddressing (saf)', () => {
  it('kayıt yoksa proven=false ve "hiç koşmadı" der', () => {
    const v = summarizeKwpAddressing([], '86F17A', 7);
    expect(v.proven).toBe(false);
    expect(v.attempts).toBe(0);
    expect(v.reason).toContain('hiç koşmadı');
  });

  it('🔒 KİLİT: SAHA — hat CANLI, tüm fiziksel satırlar sustu → proven=false', () => {
    recordKwpAddressingProbe(entry({ variantId: 'CTRL_FUNCTIONAL_03', physical: false,
      header: 'C133F1', raw: '43 00 00', result: 'ANSWERED' }));
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN1_03', result: 'NO_RESPONSE' }));
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN2_1081', header: '827AF1', result: 'NO_RESPONSE' }));
    const v = summarizeKwpAddressing(getKwpAddressingProbes(), '86F17A', 7);
    expect(v.proven).toBe(false);
    expect(v.controlAlive).toBe(true);
    expect(v.provenHeader).toBeNull();
    expect(v.reason).toContain('hat CANLI');
  });

  it('🔒 KİLİT: KONTROL DA sustuysa teşhis "adres yanlış" DEĞİL "HAT ÖLÜ"', () => {
    /* Bu ayrım olmadan matris, hattın koptuğu bir turda ECU'yu haksız yere
       "fiziksel isteğe kapalı" ilan eder ve teşhis kalıcı olarak yanlışa sapar. */
    recordKwpAddressingProbe(entry({ variantId: 'CTRL_FUNCTIONAL_03', physical: false,
      header: 'C133F1', result: 'NO_RESPONSE' }));
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN1_03', result: 'NO_RESPONSE' }));
    const v = summarizeKwpAddressing(getKwpAddressingProbes(), '86F17A', 7);
    expect(v.proven).toBe(false);
    expect(v.controlAlive).toBe(false);
    expect(v.reason).toContain('HAT ÖLÜ');
    expect(v.reason).not.toContain('adres kapalı');
  });

  it('🔒 KİLİT: fiziksel ANSWERED → proven ve KAZANAN header taşınır', () => {
    recordKwpAddressingProbe(entry({ variantId: 'CTRL_FUNCTIONAL_03', physical: false,
      header: 'C133F1', raw: '43', result: 'ANSWERED' }));
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN1_03', result: 'NO_RESPONSE' }));
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN2_0100', header: '827AF1',
      request: '0100', raw: '86 F1 7A 41 00 BE', result: 'ANSWERED' }));
    const v = summarizeKwpAddressing(getKwpAddressingProbes(), '86F17A', 7);
    expect(v.proven).toBe(true);
    expect(v.provenHeader).toBe('827AF1');
    expect(v.provenVariantId).toBe('PHY_LEN2_0100');
    expect(v.response).toContain('4100BE');
  });

  it('🔒 KİLİT: fiziksel NEGATIVE de adresi KANITLAR (ECU o adresten konuşuyor)', () => {
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN1_13', request: '13',
      raw: '7F 13 11', result: 'NEGATIVE', nrc: 0x11 }));
    const v = summarizeKwpAddressing(getKwpAddressingProbes(), '86F17A', 7);
    expect(v.proven).toBe(true);
    expect(v.provenHeader).toBe('817AF1');
  });

  it('🔒 KİLİT: KONTROL satırı TEK BAŞINA adres kanıtı SAYILMAZ', () => {
    /* Fonksiyonel yanıt "bu ECU var" der, "bu adrese istek gidiyor" DEMEZ. */
    recordKwpAddressingProbe(entry({ variantId: 'CTRL_FUNCTIONAL_03', physical: false,
      header: 'C133F1', raw: '43 00 00', result: 'ANSWERED' }));
    const v = summarizeKwpAddressing(getKwpAddressingProbes(), '86F17A', 7);
    expect(v.proven).toBe(false);
    expect(v.provenHeader).toBeNull();
  });

  it('🔒 KİLİT: BAŞKA OTURUMUN kanıtı sayılmaz (bayat kanıt karar veremez)', () => {
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN1_03', sessionEpoch: 6,
      raw: '43', result: 'ANSWERED' }));
    expect(summarizeKwpAddressing(getKwpAddressingProbes(), '86F17A', 7).proven).toBe(false);
  });

  it('🔒 KİLİT: BASKA ECU kaniti bu ECU kaydina YAZILAMAZ', () => {
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN1_03', rx: '86F110',
      raw: '43', result: 'ANSWERED' }));
    expect(summarizeKwpAddressing(getKwpAddressingProbes(), '86F17A', 7).proven).toBe(false);
  });

  it('yeni oturum epoch degeri defteri TEMİZLER (kendini temizleyen mühür)', () => {
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN1_03', sessionEpoch: 7 }));
    recordKwpAddressingProbe(entry({ variantId: 'PHY_LEN1_03', sessionEpoch: 8 }));
    const all = getKwpAddressingProbes();
    expect(all).toHaveLength(1);
    expect(all[0]!.sessionEpoch).toBe(8);
  });

  it('defter tavanlı ve okuması KOPYA döner (bellek + bütünlük)', () => {
    for (let i = 0; i < KWP_ADDRESSING_PROBE_RING + 5; i++) {
      recordKwpAddressingProbe(entry({ variantId: `V${i}` }));
    }
    expect(getKwpAddressingProbes().length).toBeLessThanOrEqual(KWP_ADDRESSING_PROBE_RING);
    const a = getKwpAddressingProbes();
    (a as KwpAddressingProbeEntry[]).length = 0;
    expect(getKwpAddressingProbes().length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) ZİNCİR KİLİTLERİ — NATIVE KAPI + ÜRÜNE GERİ YAZIM
 * ════════════════════════════════════════════════════════════════════════ */

describe('P0-OBD-DIAG-03 — BASLATMA gerekcesi ve SAHTE HEX yasagi', () => {
  it('🔒 KİLİT: "NO DATA" HEX YANITA çevrilmez (sahada `DAA` görüldü)', () => {
    /* ÖLÇÜLEN KUSUR: `compactHex("NO DATA")` = "DAA" — çünkü D, A, A geçerli
       hex karakterleridir. Adaptörün "veri yok" demesi, ekranda UYDURMA bir ECU
       yanıtına dönüşüyordu. Ölçülmemiş bir değeri ölçülmüş gibi göstermek bu
       deponun en sert kuralının ihlalidir. */
    expect(compactHex('NO DATA')).toBe('DAA');          // kusurun kaynağı — belge
    expect(displayRaw('NO DATA')).toBe('NO DATA');      // düzeltme
    expect(isElmTextStatus('NO DATA')).toBe(true);
    for (const t of ['STOPPED', 'BUS INIT: ERROR', 'UNABLE TO CONNECT', 'CAN ERROR']) {
      expect(isElmTextStatus(t), `${t} metin durumu sayılmadı`).toBe(true);
      expect(displayRaw(t), `${t} hex'e zorlandı`).toBe(t);
    }
  });

  it('gerçek hex yanıt HÂLÂ sıkıştırılmış hex döner', () => {
    expect(displayRaw('86 F1 7A 43 00')).toBe('86F17A4300');
    expect(displayRaw('')).toBeNull();
    expect(displayRaw(null)).toBeNull();
  });

  it('🔒 KİLİT: BAŞLATMA düşüşü AYRI sonuç sınıfıdır (hat hatasıyla karışmaz)', () => {
    /* Sahada iki ATFI satırı da `TRANSPORT_ERROR · rx=YOK` göründü ve teşhis
       edilemedi: adaptör komutu bilmiyor mu, araç uyanmadı mı, zaman mı aştı? */
    const r = classifyKwpAddressingResponse(V('PHY_FASTINIT_03'),
      { request: '03', raw: null, outcome: 'init_failed', initRaw: 'ATFI -> ?' });
    expect(r.result).toBe<KwpAddressingResult>('INIT_FAILED');
  });

  it('🔒 KİLİT: BAŞLATMA düşüşü ADRES kanıtı SAYILMAZ ve gerekçe TAŞINIR', () => {
    recordKwpAddressingProbe(entry({ variantId: 'CTRL_FUNCTIONAL_03', physical: false,
      header: 'C133F1', raw: '43 00 00', result: 'ANSWERED' }));
    recordKwpAddressingProbe(entry({ variantId: 'PHY_FASTINIT_03', initFirst: 'FAST',
      initRaw: 'ATFI -> BUS INIT: ERROR', result: 'INIT_FAILED' }));
    const v = summarizeKwpAddressing(getKwpAddressingProbes(), '86F17A', 7);
    expect(v.proven).toBe(false);
    expect(v.reason, 'başlatma ham yanıtı gerekçede yok').toContain('BUS INIT: ERROR');
    expect(v.reason, 'ECU suçlanıyor').toContain('ECU sustu" DEĞİLDİR');
  });

  it('🔒 KİLİT: native BAŞLATMA yanıtını TAŞIR (gerekçesiz düşüş yok)', () => {
    const src = read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
    expect(src, 'InitResult kaldırılmış').toContain('private static final class InitResult');
    expect(src, 'başlatma ham yanıtı kanıta yazılmıyor')
      .toContain('new AddressingEvidence(req, null, "init_failed", ir.raw)');
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    expect(plugin, 'köprü initRaw taşımıyor').toContain('ret.put("initRaw", ev.initRaw)');
  });

  it('🔒 KİLİT: LAB satırı başlatma gerekçesini GÖSTERİR', () => {
    const m = read('src/platform/devtools/kwpMonitorModel.ts');
    expect(m).toContain('başlatma: ${r.initRaw}');
  });
});

describe('P0-OBD-DIAG-01 — zincir kilitleri', () => {
  const elm = () => read('android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');
  const scan = () => read('src/platform/obd/multiEcuScan.ts');

  it('🔒 KİLİT: NATIVE servis beyaz listesi VAR ve destructive servis İÇERMEZ', () => {
    /* İKİNCİ ve SON kapı: TS matrisi bozulsa bile araç hafızasını değiştiren
       komut hatta ÇIKAMAZ. Bu liste gevşerse tanı aracı silici olur. */
    const src = elm();
    expect(src, 'beyaz liste kaldırılmış').toContain('KWP_PROBE_ALLOWED_SIDS');
    const block = src.slice(src.indexOf('KWP_PROBE_ALLOWED_SIDS'),
      src.indexOf('probeKwpAddressingRow'));
    for (const bad of ['"04"', '"11"', '"14"', '"27"', '"2E"', '"31"', '"2F"', '"85"']) {
      expect(block, `beyaz listeye destructive servis girmiş: ${bad}`).not.toContain(bad);
    }
    expect(block).toContain('"03"');
    expect(block).toContain('"18"');
  });

  it('🔒 KİLİT: native beyaz liste DIŞI istek hatta ÇIKMAZ (not_attempted)', () => {
    const src = elm();
    const fn = src.slice(src.indexOf('public AddressingEvidence probeKwpAddressingRow'));
    expect(fn, 'beyaz liste kontrolü kaldırılmış').toContain('KWP_PROBE_ALLOWED_SIDS.contains(sid)');
    const guardIdx = fn.indexOf('KWP_PROBE_ALLOWED_SIDS.contains(sid)');
    const sendIdx  = fn.indexOf('sendAddressingRow');
    expect(guardIdx, 'beyaz liste kapısı gönderimden SONRA').toBeLessThan(sendIdx);
  });

  it('🔒 KİLİT: header HER DURUMDA restore edilir (yanlis ECU adresine sizinti yok)', () => {
    const src = elm();
    /* 3 argumanli GERCEK uygulama (2 argumanli bicim yalniz ona devreder). */
    const fn = src.slice(src.indexOf(
      'public AddressingEvidence probeKwpAddressingRow(String header, String request, String init)'));
    expect(fn.slice(0, 2000), 'header restore kaldirilmis')
      .toContain('restoreKwpDefaultHeader(protocolDigit)');
  });

  it('🔒 KİLİT: KANITLANAN header ÜRÜNE geri yazılır (adres uydurulmaz, ölçülür)', () => {
    const src = scan();
    expect(src, 'kazanan header kullanılmıyor — matris kanıtı çöpe gidiyor')
      .toContain('txHeader: provenTxHeader ?? ecu.txHeader');
    expect(src, 'matris kanıtı adreslenebilirliği yükseltmiyor')
      .toContain("addressability = mergeAddressability(addressability, 'PROVEN')");
  });

  it('🔒 KİLİT: BAŞLATMA satırı hat canlılığı ÖLÇÜLMEDEN koşmaz', () => {
    /* Kontrol satırı cevap vermediyse hattın kendisi şüphelidir; onu bir de biz
       yeniden başlatmayız (çalışan oturumu kırma riski kanıtsız alınmaz). */
    const src = scan();
    expect(src, 'başlatma kapısı kaldırılmış')
      .toContain('if (init !== null && !controlAnswered) continue;');
    expect(src).toContain('controlAnswered = true;');
  });

  it('🔒 KİLİT: NATIVE başlatma düşerse istek GÖNDERİLMEZ', () => {
    /* Yarım kurulmuş hatta veri istemek "ECU sustu" diye YANLIŞ hüküm üretir. */
    const src = elm();
    /* P0-OBD-DIAG-03: kapı GÜÇLENDİ — başlatma artık sonucu VE ham yanıtı
       birlikte döndürür; düşerse istek yine GÖNDERİLMEZ ama gerekçe TAŞINIR. */
    expect(src).toContain('InitResult ir = initKLineForRow(init);');
    expect(src).toContain('ev = ir.ok ? sendAddressingRow(req, ir.raw)');
    const fn = src.slice(src.indexOf('private InitResult initKLineForRow'));
    expect(fn.slice(0, 1200), 'başlatma hatası başarı sayılıyor').toContain('contains("ERROR")');
  });

  it('🔒 KİLİT: matris YALNIZ yavaş seri hatta ve adres KANITLANMAMIŞKEN koşar', () => {
    const src = scan();
    expect(src).toContain("if (addressability !== 'PROVEN' && isSlowSerialProtocol(activeProtocol))");
    /* CAN hattında matris anlamsız trafiktir; kapı kalkarsa her taramada
       gereksiz istek üretilir. */
    const idx = src.indexOf('_probeKwpAddressing(ecu, sessionEpoch, activeProtocol)');
    expect(idx, 'matris çağrısı kaldırılmış').toBeGreaterThan(0);
  });

  it('🔒 KİLİT: 0x18 kapısı matristen BAĞIMSIZ olarak fail-closed kalır', () => {
    const src = scan();
    /* Matris adresi kanıtlamadıysa `kwpTargetVerified` yükselmez ve native
       `readAdvancedDtcs` 0x18'i `not_addressable` diye geri çevirir. */
    expect(src).toContain('kwpTargetVerified: ecu.addressBits === 8');
    const plugin = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
    /* P0-OBD-DIAG-02: kapı GENİŞLEDİ — 0x13 de aynı fiziksel hedef kanıtını
       ister. İnvaryant aynı: kanıtsız hedefe üretici DTC servisi GİTMEZ. */
    expect(plugin, '0x18/0x13 hedef kapısı kaldırılmış')
      .toContain('if (("18".equals(service) || "13".equals(service)) && !targetVerified)');
  });
});
