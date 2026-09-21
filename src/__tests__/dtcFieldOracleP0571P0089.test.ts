/**
 * dtcFieldOracleP0571P0089.test.ts — SAHA REGRESYON ORACLE'I (ECU 7A / KWP).
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * Sahada rakip bir OBD uygulaması aynı araçta ECU 7A üzerinden `P0571`
 * (fren/hız sabitleyici anahtar A devresi) ve `P0089` (yakıt basıncı
 * regülatörü 1 performansı) kodlarını okuyabiliyor; CarOS okuyamıyordu.
 *
 * Bu dosya o iki kodu ÜRÜNE GÖMMEZ — yalnız ORACLE olarak kullanır:
 * "ECU gövdesi bu kodları İÇERDİĞİNDE kanonik çözümleyici onları DOĞRU
 * çözüyor mu?" sorusunu byte seviyesinde kilitler. Hangi servisin taşıyacağı
 * araca göre değişebileceği için ÜÇ kanonik yol da ayrı ayrı kilitlenir:
 * generic Mode 03/07/0A · KWP 0x18 · (0x18 ile aynı çözücüyü kullanan) 0x13.
 *
 * Bayt düzeni ISO 15031-6 / SAE J2012'den TÜRETİLMİŞTİR, uydurulmamıştır:
 *   P0571 → bit15-14=00 (P) · bit13-12=0 · bit11-8=5 · düşük bayt 0x71 → `05 71`
 *   P0089 → bit15-14=00 (P) · bit13-12=0 · bit11-8=0 · düşük bayt 0x89 → `00 89`
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stripComments } from './helpers';
import { decodeDtcPair, parseFunctionalDtcResponse } from '../platform/obd/functionalDtc';
import { resolveFunctionalDtcSource } from '../platform/obd/functionalDtcSource';
import { parseKwpDtcResponse, validateKwpDtcResponse } from '../platform/obd/kwpDtc';

/** Saha kodlarının ISO 15031-6 ham karşılığı (2 bayt). */
const RAW_P0571 = '0571';
const RAW_P0089 = '0089';

describe('saha oracle › bayt → kod çözümü (ISO 15031-6)', () => {
  it('ham çift doğrudan doğru koda çözülür', () => {
    expect(decodeDtcPair(RAW_P0571)).toBe('P0571');
    expect(decodeDtcPair(RAW_P0089)).toBe('P0089');
  });
});

describe('saha oracle › generic OBD (Mode 03/07/0A)', () => {
  it('SAYAÇLI Mode 03 gövdesi iki kodu da verir', () => {
    /* `43` (pozitif SID) + `02` (sayaç) + iki DTC çifti. */
    const raw = `4302${RAW_P0571}${RAW_P0089}`;
    const parsed = parseFunctionalDtcResponse({ mode: '03', rawResponse: raw, truncated: false });
    expect(parsed.records.map((r) => r.code)).toEqual(['P0571', 'P0089']);
  });

  it('SAYAÇSIZ (çift baytlı) Mode 03 gövdesi de iki kodu verir', () => {
    /* Bazı ECU'lar sayaç baytı KOYMAZ; çözücü bu biçimi de taşımalıdır. */
    const raw = `43${RAW_P0571}${RAW_P0089}`;
    const parsed = parseFunctionalDtcResponse({ mode: '03', rawResponse: raw, truncated: false });
    expect(parsed.records.map((r) => r.code)).toEqual(['P0571', 'P0089']);
  });

  it('ÜRÜN OTORİTESİ (`resolveFunctionalDtcSource`) aynı gövdeden aynı kodları üretir', () => {
    /* Tarama yolunun GERÇEKTEN çağırdığı kapı budur — parser'ı tek başına
       doğrulamak yetmez, ürünün okuduğu liste de aynı olmalıdır. */
    const src = resolveFunctionalDtcSource({
      mode: '03', rawResponse: `4302${RAW_P0571}${RAW_P0089}`, nativeCodes: null,
    });
    expect(src.codes).toEqual(['P0571', 'P0089']);
  });

  it('Mode 07 (bekleyen) ve Mode 0A (kalıcı) pozitif SID\'leri de doğru soyulur', () => {
    const pending = resolveFunctionalDtcSource({
      mode: '07', rawResponse: `4701${RAW_P0571}`, nativeCodes: null,
    });
    const permanent = resolveFunctionalDtcSource({
      mode: '0A', rawResponse: `4A01${RAW_P0089}`, nativeCodes: null,
    });
    expect(pending.codes).toEqual(['P0571']);
    expect(permanent.codes).toEqual(['P0089']);
  });
});

describe('saha oracle › KWP 0x18 / 0x13 (ISO 14230-3)', () => {
  /* "58" SOYULMUŞ gövde: <sayaç><DTC hi><DTC lo><status> … (kayıt 3 bayt). */
  const body = `02${RAW_P0571}24${RAW_P0089}2F`;

  it('zarf geçerli sayılır (sayaç ↔ kayıt sınırı tutar)', () => {
    const env = validateKwpDtcResponse(body);
    expect(env.valid).toBe(true);
    expect(env.declaredCount).toBe(2);
    expect(env.recordBytes).toBe(3);
  });

  it('iki kod da doğru çözülür ve ham kanıt KAYBOLMAZ', () => {
    const parsed = parseKwpDtcResponse(body);
    expect(parsed.map((d) => d.code)).toEqual(['P0571', 'P0089']);
    expect(parsed.map((d) => d.rawDtc)).toEqual([RAW_P0571, RAW_P0089]);
    expect(parsed.map((d) => d.rawStatus)).toEqual(['24', '2F']);
    /* 2 baytlık klasik kayıtta ALT KOD (FTB) YOKTUR — sahte '00' üretilmez. */
    expect(parsed.every((d) => d.failureType === undefined)).toBe(true);
  });
});

describe('saha oracle › kodlar ÜRÜNE GÖMÜLMEDİ', () => {
  it('P0571/P0089 hiçbir üretim kaynağında sabit olarak geçmez', () => {
    /* Görev kısıtı: "P0571/P0089 hard-code etme." Bu kilit, ileride birinin
       sahayı "çözmek" için kodu tabloya gömmesini yakalar. Katalog/sözlük
       dosyaları bu taramanın DIŞINDADIR: orada kodun AÇIKLAMASI bulunur,
       davranışı değil.

       YORUMLAR SOYULUR: saha vakasını YORUMDA anmak (kök neden kaydı) meşrudur
       ve yasak olan DAVRANIŞA GÖMME'dir. Yorumu da yasaklamak, kanıtı silmeye
       teşvik ederdi. */
    const roots = [
      'src/platform/obd/multiEcuScan.ts',
      'src/platform/obd/kwpDtc.ts',
      'src/platform/obd/udsDtc.ts',
      'src/platform/obd/functionalDtc.ts',
      'src/platform/obd/functionalDtcSource.ts',
      'src/platform/obd/dtcAuthority.ts',
      'src/platform/obd/dtcCoveragePlan.ts',
      'src/platform/obd/kwpAddressingProbe.ts',
      'src/platform/obd/kwpSessionProbe.ts',
    ];
    for (const rel of roots) {
      const src = stripComments(readFileSync(resolve(process.cwd(), rel), 'utf8'));
      expect(src, `${rel} saha kodunu GÖMMÜŞ`).not.toMatch(/P0571|P0089/);
    }
  });
});
