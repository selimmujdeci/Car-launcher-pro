/**
 * functionalDtcParser.test.ts — P0-VDK-F2C1 · KANONİK FONKSİYONEL PARSER KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A BÖLÜMÜ = NATIVE PARİTESİ (bu dosyanın en önemli kısmı)
 * ══════════════════════════════════════════════════════════════════════════
 * Fixture'lar `android/app/src/test/java/com/cockpitos/pro/obd/DtcClassParserTest.java`
 * dosyasından **BİREBİR** alınmıştır. Amaç, TS çözümleyicisinin native
 * davranışın "yeniden yorumu" DEĞİL, ölçülmüş EŞDEĞERİ olduğunu kanıtlamaktır.
 *
 * Bu fixture'lar gerçek saha kusurlarının kanıtıdır:
 *  · `47 01 00 89 00 00 00` (dolgulu) eskiden `P0100` + `B0900` UYDURUYORDU
 *  · ISO-TP çok çerçeve `P0200`/`B0901`/`C3100` uyduruyordu
 *  · hizasız SID tüm gövdeyi kaydırıyordu
 *
 * Bir kilit değişecekse JVM tarafı da BİRLİKTE güncellenmelidir — aksi hâlde
 * iki çözümleyici sessizce ayrışır ve F2-C1'in kapattığı borç geri gelir.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NATIVE_DTC_RAW_MAX } from '../platform/obd/functionalDtcSource';
import {
  parseFunctionalDtcResponse, decodeDtcPair, FUNCTIONAL_POSITIVE_SID,
  type FunctionalDtcMode,
} from '../platform/obd/functionalDtc';

function codes(mode: FunctionalDtcMode, raw: string | null, truncated?: boolean): string[] {
  return parseFunctionalDtcResponse({ mode, rawResponse: raw, truncated })
    .records.map((r) => r.code);
}
function parse(mode: FunctionalDtcMode, raw: string | null, truncated?: boolean) {
  return parseFunctionalDtcResponse({ mode, rawResponse: raw, truncated });
}

/** ISO-TP segment önekli ÇOK ÇERÇEVELİ yanıt (JVM `cokCerceveliIsoTp` fixture'ı). */
const ISO_TP_MULTIFRAME = '0: 10 08 47 02 00 89\n1: 01 71 00 00 00 00 00';

/* ═══════════════════════════════════════════════════════════════════════════
   A) NATIVE PARİTESİ — DtcClassParserTest.java fixture'ları AYNEN
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · A) native parser paritesi', () => {
  it('🔒 ANA SAHA KİLİDİ: P0089 (Mode 07) ALTI gerçek adaptör biçiminde de çözülür', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['CAN sayaçlı dolgusuz',        '47 01 00 89'],
      ['CAN sayaçlı 8 bayta DOLGULU', '47 01 00 89 00 00 00'],
      ['compact',                     '4701 0089'],
      ['ATH1 başlığı + PCI',          '7E8 04 47 01 00 89'],
      ['ATH1 başlığı + PCI + dolgu',  '7E8 06 47 01 00 89 00 00'],
      ['K-line sıfır dolgulu',        '47 00 89 00 00 00 00'],
    ];
    for (const [name, raw] of cases) {
      const out = codes('07', raw);
      expect(out, `${name} → P0089 kayboldu: ${out.join(',')}`).toContain('P0089');
      expect(out, `${name} → fazladan UYDURMA kod: ${out.join(',')}`).toHaveLength(1);
    }
  });

  it('🔒 dolgulu çerçeve UYDURMA kod üretmez (ölçülen kusur: P0100 + B0900)', () => {
    const out = codes('07', '47 01 00 89 00 00 00');
    expect(out).not.toContain('P0100');
    expect(out).not.toContain('B0900');
    expect(out).toEqual(['P0089']);
  });

  it('🔒 ISO-TP çok çerçeveli yanıt doğru çözülür (ölçülen kusur: P0200/B0901)', () => {
    expect(codes('07', '0: 10 08 47 02 00 89\n1: 01 71 00 00 00 00 00'))
      .toEqual(['P0089', 'P0171']);
  });

  it('🔒 sınıflar AYRI çözülür — 03 / 07 / 0A', () => {
    expect(codes('03', '43 01 00 89')).toEqual(['P0089']);
    expect(codes('07', '47 01 00 89')).toEqual(['P0089']);
    expect(codes('0A', '4A 01 00 89')).toEqual(['P0089']);
  });

  it('🔒 sınıf önekleri KARIŞMAZ — başka modun yanıtından kod üretilmez', () => {
    expect(codes('03', '47 01 00 89')).toEqual([]);
    expect(codes('07', '43 01 00 89')).toEqual([]);
    expect(codes('03', '4A 01 00 89')).toEqual([]);
  });

  it('🔒 mod öneki artığı SAHTE kod üretmez (C0300 / C0700)', () => {
    expect(codes('03', '43 01 43 00')).not.toContain('C0300');
    expect(codes('07', '47 01 47 00')).not.toContain('C0700');
  });

  it('🔒 K-line sıfır dolgulu ÇOK kod korunur', () => {
    const out = codes('03', '43 01 71 04 20 00 00');
    expect(out).toContain('P0171');
    expect(out).toContain('P0420');
  });

  it('🔒 çok-ECU ayrı satırlar korunur', () => {
    const out = codes('03', '7E8 43 01 71 00 00\n7E9 43 01 20 00 00');
    expect(out).toContain('P0171');
    expect(out).toContain('P0120');
  });

  it('🔒 sonu 0x00 ile biten GERÇEK kod dolgu SANILMAZ (P0100)', () => {
    expect(codes('03', '43 01 01 00 00 00 00')).toEqual(['P0100']);
  });

  it('🔒 SID yalnız ÇİFT hizada aranır — hizasız "47" yakalanmaz', () => {
    expect(codes('07', 'A4 70 10 08')).toEqual([]);
  });

  it('🔒 boş gövde kod üretmez', () => {
    expect(codes('07', '47')).toEqual([]);
    expect(codes('07', '47 00')).toEqual([]);
  });

  it('🔒 KISMİ yanıt sessizce EKSİK liste döndürmez (sayaç 3, gövdede 1)', () => {
    const r = parse('07', '47 03 00 89');
    expect(r.records).toEqual([]);
    expect(r.malformedReason).toBe('PARTIAL_COUNT');
    expect(r.outcome).toBe('PARTIAL_TIMEOUT');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) BAYT ÇÖZÜMÜ — SAE J2012 / ISO 15031-6
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · B) bayt → kod', () => {
  it('🔒 P ailesi (00xxxxxx)', () => {
    expect(decodeDtcPair('0301')).toBe('P0301');
    expect(decodeDtcPair('0380')).toBe('P0380');
    expect(decodeDtcPair('0420')).toBe('P0420');
    expect(decodeDtcPair('0089')).toBe('P0089');
  });

  it('🔒 C ailesi (01xxxxxx)', () => {
    expect(decodeDtcPair('4123')).toBe('C0123');
    expect(decodeDtcPair('5234')).toBe('C1234');
  });

  it('🔒 B ailesi (10xxxxxx)', () => {
    expect(decodeDtcPair('8123')).toBe('B0123');
    expect(decodeDtcPair('9900')).toBe('B1900');
  });

  it('🔒 U ailesi (11xxxxxx)', () => {
    expect(decodeDtcPair('C100')).toBe('U0100');
    expect(decodeDtcPair('D073')).toBe('U1073');
  });

  it('🔒 ikinci rakam ONALTILIK basılır (0-F), ilk rakam ONDALIK (0-3)', () => {
    expect(decodeDtcPair('0F00')).toBe('P0F00');
    expect(decodeDtcPair('3000')).toBe('P3000');
  });

  it('🔒 dört aile TEK yanıtta ayrı ayrı çözülür', () => {
    /* CAN sayaçlı gövde: SID + n=4 + dört kayıt.
       03 01 → P0301 · 41 23 → C0123 · 81 23 → B0123 · C1 00 → U0100 */
    const out = codes('03', '43 04 03 01 41 23 81 23 C1 00');
    expect(out).toEqual(['P0301', 'C0123', 'B0123', 'U0100']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) POZİTİF YANIT SÖZLEŞMESİ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · C) pozitif yanıt sözleşmesi', () => {
  it('🔒 beklenen SID: 03→43 · 07→47 · 0A→4A', () => {
    expect(FUNCTIONAL_POSITIVE_SID).toEqual({ '03': '43', '07': '47', '0A': '4A' });
  });

  it('🔒 "43 00 00 00 00 00 00" → POSITIVE_EMPTY (desteklenmiyor DEĞİL)', () => {
    const r = parse('03', '43 00 00 00 00 00 00');
    expect(r.outcome).toBe('POSITIVE_EMPTY');
    expect(r.records).toEqual([]);
    expect(r.paddingRecords).toBeGreaterThan(0);
  });

  it('🔒 "7F 03 11" → NEGATIVE_UNSUPPORTED, kod YOK', () => {
    const r = parse('03', '7F 03 11');
    expect(r.outcome).toBe('NEGATIVE_UNSUPPORTED');
    expect(r.records).toEqual([]);
  });

  it('🔒 NO DATA → NO_DATA (POSITIVE_EMPTY DEĞİL — ölçüm yok)', () => {
    const r = parse('03', 'NO DATA');
    expect(r.outcome).toBe('NO_DATA');
    expect(r.records).toEqual([]);
  });

  it('🔒 boş yanıt → PROMPT_TIMEOUT (POSITIVE_EMPTY DEĞİL)', () => {
    expect(parse('03', '').outcome).toBe('PROMPT_TIMEOUT');
    expect(parse('03', null).outcome).toBe('PROMPT_TIMEOUT');
  });

  it('🔒 hat hataları kod ÜRETMEZ ve temiz SAYILMAZ', () => {
    for (const bad of ['STOPPED', 'CAN ERROR', 'BUS ERROR', 'UNABLE TO CONNECT', 'BUFFER FULL']) {
      const r = parse('03', bad);
      expect(r.records, bad).toEqual([]);
      expect(r.outcome, bad).toBe('BUS_ERROR');
    }
    expect(parse('03', '?').outcome).toBe('TRANSPORT_ERROR');
  });

  it('🔒 BEKLENMEYEN SID → MALFORMED (sessiz "temiz" DEĞİL)', () => {
    const r = parse('03', '41 00 BE 3F A8 13');
    expect(r.outcome).toBe('MALFORMED');
    expect(r.records).toEqual([]);
    expect(r.malformedReason).toBe('MISSING_POSITIVE_SID');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) DOLGU · ARTIK · BOZUK GÖVDE
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · D) dolgu ve bozukluk', () => {
  it('KILIT: 0000 dolgusu kod DEGIL ama SAYILIR (kanit kaybolmaz)', () => {
    /* JVM `klineSifirDolgulu_cokKod_korunur` ile AYNI fixture. Sayac yorumu
       burada DOGRULANAMAZ (artik `20 00 00` saf dolgu degil) -> K-line yolu. */
    const r = parse('03', '43 01 71 04 20 00 00');
    expect(r.records.map((x) => x.code)).toEqual(['P0171', 'P0420']);
    expect(r.paddingRecords).toBeGreaterThan(0);
  });

  it('KILIT: SAYAC yorumu dogrulaninca dolgu SONRASI bayt kod SAYILMAZ', () => {
    /* `43 01 71 00 00 00 00`: sayac n=1 · artigin TAMAMI sifir · sekil 7 bayt
       -> dogrulama GECER, tek kayit `71 00` = C3100. Native ile BIREBIR ayni
       davranistir; "P0171 + dolgu" okumak sayac baytini yok saymak olurdu. */
    expect(codes('03', '43 01 71 00 00 00 00')).toEqual(['C3100']);
  });

  it('🔒 tekrarlı dolgu kod üretmez', () => {
    const r = parse('03', '43 00 00 00 00 00 00 00 00');
    expect(r.records).toEqual([]);
    expect(r.paddingRecords).toBeGreaterThan(0);
  });

  it('KILIT: TEK haneli/bozuk govde kod URETMEZ - sessiz "temiz" DEGIL', () => {
    /* `splitDtcBodies` tek uzunluklu govdede bastaki 3 haneyi hiza icin ayirir
       (ATH1 kimligi). Kalan govdede pozitif SID YOKTUR -> fail-closed. */
    const r = parse('03', '43 01 71 0');
    expect(r.records).toEqual([]);
    expect(r.malformedReason).toBe('MISSING_POSITIVE_SID');
    expect(r.outcome).toBe('MALFORMED');
  });

  it('KILIT: YAPISAL GARANTI - kayit yuvasi artigi OLUSAMAZ (leftover 0)', () => {
    /* Hiza `splitDtcBodies`te garanti altina alinir ve `payloadAfterSid` her
       dalda 4'un kati hane dondurur. `leftoverBytes` bu yuzden bir OLCUMDUR ve
       0 kalmasi beklenir - sifirdan farkli cikmasi, sinirin degistiginin
       kanitidir ve bu kilit onu yakalar. */
    const raws: ReadonlyArray<readonly [FunctionalDtcMode, string]> = [
      ['03', '43 01 71 04 20 99'],
      ['03', '43 01 71 04 20 00 00'],
      ['03', '7E8 43 01 71 00 00'],
      ['07', ISO_TP_MULTIFRAME],
    ];
    for (const [m, raw] of raws) {
      expect(parse(m, raw).leftoverBytes, raw).toBe(0);
    }
  });

  it('🔒 KIRPILMIŞ girdi işaretlenir — çözüm eksik olabilir', () => {
    const r = parse('03', '43 01 71 04 20 00 00', true);
    expect(r.malformedReason).toBe('TRUNCATED_INPUT');
    /* Kod yine çözülür (kanıt kaybolmaz) ama bozukluk sebebi GÖRÜNÜR kalır. */
    expect(r.records.map((x) => x.code)).toContain('P0171');
  });

  it('KILIT: kucuk harf hex ve bosluk normalize edilir', () => {
    expect(codes('03', '43 01 00 89'.toLowerCase())).toEqual(['P0089']);
    expect(codes('03', '4301 0089')).toEqual(['P0089']);
    expect(codes('03', '  43	01   00 89  ')).toEqual(['P0089']);
  });

  it('KILIT: SATIR SONU govde ayirir (native split ile ayni)', () => {
    /* Iki satir = iki AYRI ECU govdesi. Tek govdeymis gibi birlestirmek
       cok-ECU yanitini bozardi - native de ayirir. */
    const r = parse('03', ['43 01 00 89', '43 01 01 71'].join('\n'));
    expect(r.bodyCount).toBe(2);
    expect(r.records.map((x) => x.code)).toEqual(['P0089', 'P0171']);
  });

  it('🔒 aynı kod TEKRARLARSA tek satıra iner (sıra korunur)', () => {
    const out = codes('03', '7E8 43 01 71 00 00\n7E9 43 01 71 00 00');
    expect(out).toEqual(['P0171']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) ÇOK-ECU ATIFI — UYDURULMAZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · E) çok-ECU atfı', () => {
  it('🔒 ATH1 kimliği ÖLÇÜLÜRSE kayda yazılır', () => {
    const r = parse('03', '7E8 43 01 71 00 00\n7E9 43 01 20 00 00');
    expect(r.ecuAttribution).toBe('MEASURED');
    const byCode = new Map(r.records.map((x) => [x.code, x.ecuHeader]));
    expect(byCode.get('P0171')).toBe('7E8');
    expect(byCode.get('P0120')).toBe('7E9');
  });

  it('🔒 kimlik ÖLÇÜLMEZSE UNKNOWN — tek ECU VARSAYILMAZ', () => {
    const r = parse('03', '43 01 71 00 00\n43 01 20 00 00');
    expect(r.ecuAttribution).toBe('UNKNOWN');
    expect(r.records.every((x) => x.ecuHeader === null)).toBe(true);
  });

  it('🔒 tek gövdede atıf sorusu DOĞMAZ', () => {
    expect(parse('03', '43 01 00 89').ecuAttribution).toBe('NOT_APPLICABLE');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) SAFLIK VE MALİYET
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · F) saflık ve maliyet', () => {
  it('🔒 aynı girdi → BİREBİR aynı çıktı (saf)', () => {
    const raw = '7E8 43 03 01 71 04 20 03 01';
    expect(parse('03', raw)).toEqual(parse('03', raw));
  });

  it('🔒 100 DTC sentetik gövde O(n) çözülür ve kod kaybetmez', () => {
    /* K-line biçimi: SID + 100 çift. Sayaç yorumu bu şekle uymaz (n=0x03
       doğrulanamaz) → tüm çiftler yuva sayılır. */
    const pairs: string[] = [];
    for (let i = 0; i < 100; i++) {
      pairs.push((0x0300 + i).toString(16).toUpperCase().padStart(4, '0'));
    }
    const raw = '43' + pairs.join('');
    const t0 = performance.now();
    const r = parse('03', raw);
    const ms = performance.now() - t0;
    expect(r.records).toHaveLength(100);
    expect(r.records[0]!.code).toBe('P0300');
    expect(r.records[99]!.code).toBe('P0363');
    expect(ms, `100 kayıt çözümü ${ms.toFixed(1)}ms sürdü`).toBeLessThan(50);
  });

  it('🔒 20 DTC gövdesi tam çözülür', () => {
    const pairs: string[] = [];
    for (let i = 0; i < 20; i++) {
      pairs.push((0x0300 + i).toString(16).toUpperCase().padStart(4, '0'));
    }
    const r = parse('03', '43' + pairs.join(''));
    expect(r.records).toHaveLength(20);
  });

  it('🔒 kayıt sırası ve ham baytlar korunur', () => {
    const r = parse('03', '43 01 71 04 20 00 00');
    expect(r.records[0]).toMatchObject({
      code: 'P0171', rawBytes: '0171', sourceMode: '03', recordIndex: 0, bodyIndex: 0,
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) NATIVE SÖZLEŞMESİ — kopya sabitler SESSİZCE ESKİYEMEZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2C1 · G) native sozlesmesi', () => {
  const JAVA = resolve(__dirname, '../../android/app/src/main/java/com/cockpitos/pro/obd/ElmProtocol.java');

  it('KILIT: NATIVE_DTC_RAW_MAX Java sabitiyle AYNI (kirpma tespiti bunun uzerine kurulu)', () => {
    const src = readFileSync(JAVA, 'utf8');
    const m = /DTC_RAW_MAX\s*=\s*(\d+)/.exec(src);
    expect(m, 'Java tarafinda DTC_RAW_MAX bulunamadi').not.toBeNull();
    expect(Number(m![1]), 'Java sabiti degisti — TS kopyasi ESKIDI').toBe(NATIVE_DTC_RAW_MAX);
  });

  it('KILIT: native COZUMLEYICI hala mevcut (legacy taniklik yolu KIRILMADI)', () => {
    const src = readFileSync(JAVA, 'utf8');
    /* `parseDtcResponse` LEGACY TANIK olarak korunur: eski APK'lar ve
       parite karsilastirmasi ona bagimlidir. Silinmesi geri uyumu kirardi. */
    expect(src).toMatch(/static java\.util\.List<String> parseDtcResponse\(/);
    expect(src).toMatch(/public DtcClassResult readDtcClass\(/);
  });

  it('KILIT: readDtcClass HAM yaniti tasimaya DEVAM ediyor (kanonik yolun girdisi)', () => {
    const src = readFileSync(JAVA, 'utf8');
    /* Kanonik TS cozumleyicisinin TEK girdisi bu ham govdedir; kaldirilirsa
       urun sessizce LEGACY_NATIVE yedegine duser. */
    expect(src).toMatch(/new DtcClassResult\(trimmed, parseDtcResponse\(raw, reply\)/);
  });
});
