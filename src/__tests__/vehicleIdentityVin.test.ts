/**
 * vehicleIdentityVin.test — P0-OBD-09 · VIN KİMLİĞİ kilitleri.
 *
 * Görev şartı: 17 karakter · malformed/partial · birden fazla ECU tutarsızlığı ·
 * reconnect/araç değişimi — hepsi FAIL-CLOSED.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  isVinShapeValid, normalizeVin, decodeVin, vinRegion, vinCheckDigit,
  vinModelYearCandidates, VIN_REGION_LABEL,
} from '../platform/vehicle/vinDecode';
import {
  recordVinObservation, getVehicleIdentity, getCanonicalVin,
  resetVehicleIdentity, VIN_STATE_LABEL, VIN_SOURCE_LABEL,
} from '../platform/vehicle/vehicleIdentity';
import { maskVin, vinResearchPrefix } from '../platform/vehicle/legalVehicleClass';

/** Kuzey Amerika VIN'i — kontrol hanesi GEÇERLİ (49 CFR 565 örneği). */
const VIN_NA = '1HGBH41JXMN109186';
/** Avrupa VIN'i (Renault WMI) — kontrol hanesi uygulanmaz. */
const VIN_EU = 'VF1RJL00X66123456';
const T = 1_700_000_000_000;
const YEAR = 2026;

/* ── 1. BİÇİM: 17 hane, I/O/Q yok ─────────────────────────────────────────── */

describe('P0-OBD-09 · VIN biçimi fail-closed', () => {
  it('geçerli 17 hane kabul edilir', () => {
    expect(isVinShapeValid(VIN_NA)).toBe(true);
    expect(isVinShapeValid(VIN_EU)).toBe(true);
    expect(normalizeVin(`  ${VIN_EU.toLowerCase()}  `)).toBe(VIN_EU);
  });

  it('KISMİ VIN reddedilir — bu turun kapattığı asıl kusur', () => {
    expect(isVinShapeValid('VF1RJL00')).toBe(false);
    expect(normalizeVin('VF1RJL00')).toBeNull();
  });

  it('16 ve 18 hane reddedilir', () => {
    expect(isVinShapeValid(VIN_EU.slice(0, 16))).toBe(false);
    expect(isVinShapeValid(VIN_EU + '7')).toBe(false);
  });

  it('I / O / Q içeren VIN reddedilir (ISO 3779)', () => {
    expect(isVinShapeValid('VF1RJL00I66123456')).toBe(false);
    expect(isVinShapeValid('VF1RJL00O66123456')).toBe(false);
    expect(isVinShapeValid('VF1RJL00Q66123456')).toBe(false);
  });

  it('boş / null / tip dışı reddedilir', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(isVinShapeValid(v as string | null)).toBe(false);
      expect(normalizeVin(v as string | null)).toBeNull();
    }
  });
});

/* ── 2. VIN'DEN ÇIKARILABİLENLER — ve ÇIKARILAMAYANLAR ────────────────────── */

describe('P0-OBD-09 · VIN çözümleme yalnız standarttan', () => {
  it('ISO 3780 bölge 1. haneden çıkar', () => {
    expect(vinRegion('1HGBH41JXMN109186')).toBe('north_america');
    expect(vinRegion('VF1RJL00X66123456')).toBe('europe');
    expect(vinRegion('JHMCM56557C404453')).toBe('asia');
    expect(vinRegion('6H8XX00X00X000000')).toBe('oceania');
    expect(vinRegion('9BWZZZ00Z00000000')).toBe('south_america');
    expect(vinRegion('AAVZZZ00Z00000000')).toBe('africa');
  });

  it('her bölgenin etiketi VARDIR', () => {
    for (const k of Object.keys(VIN_REGION_LABEL)) {
      expect(VIN_REGION_LABEL[k as keyof typeof VIN_REGION_LABEL].length).toBeGreaterThan(2);
    }
  });

  it('kontrol hanesi YALNIZ Kuzey Amerika\'da uygulanır', () => {
    expect(vinCheckDigit(VIN_NA)).toBe('valid');
    /* Avrupa VIN'inde doğrulamak SAHTE BAŞARISIZLIK üretirdi. */
    expect(vinCheckDigit(VIN_EU)).toBe('not_applicable');
  });

  it('bozuk kontrol hanesi (Kuzey Amerika) YAKALANIR', () => {
    const broken = '1HGBH41J1MN109186';   // 9. hane değiştirildi
    expect(vinCheckDigit(broken)).toBe('invalid');
  });

  it('model yılı 30 yıllık döngüde OBD-II kısıtıyla daraltılır', () => {
    /* 10. hane 'M' → 1991 veya 2021. 1991 < 1996 (OBD-II tabanı) → tek aday 2021. */
    expect('1HGBH41JXMN109186'.charAt(9)).toBe('M');
    expect(vinModelYearCandidates('1HGBH41JXMN109186', YEAR)).toEqual([2021]);
    /* 10. hane 'X' → 1999 veya 2029; 2029 gelecek → tek aday 1999. */
    expect(vinModelYearCandidates('1HGBH41JXXN109186', YEAR)).toEqual([1999]);
  });

  it('BELİRSİZ yılda tek yıl UYDURULMAZ', () => {
    /* Yıl kodu 10. HANEDİR (index 9). Burada '9' → 2009 veya 2039; 2050'de
       ikisi de mümkün → iki aday kalır ve model tek yıl UYDURMAZ. */
    const vin = '1HGBH41JX9N109186';
    expect(vin.charAt(9)).toBe('9');
    const facts = decodeVin(vin, 2050);
    expect(facts.modelYearCandidates).toEqual([2009, 2039]);
    expect(facts.modelYear).toBeNull();
  });

  it('bugünkü takvimde aynı kod TEK adaya iner (belirsizlik daralır)', () => {
    /* 2039 henüz gelecek → yalnız 2009 kalır. */
    expect(decodeVin('1HGBH41JX9N109186', YEAR).modelYear).toBe(2009);
  });

  it('tanınmayan yıl kodu aday ÜRETMEZ', () => {
    expect(vinModelYearCandidates('1HGBH41JX0N109186', YEAR)).toEqual([]);
  });

  it('ÇIKARILAMAYANLAR açıkça listelenir', () => {
    const f = decodeVin(VIN_EU, YEAR);
    const joined = f.notDerivable.join(' ');
    expect(joined).toContain('Marka adı');
    expect(joined).toContain('Model');
    expect(joined).toContain('Gövde');
    expect(joined).toContain('Ticari/binek');
  });

  it('geçersiz VIN\'de hiçbir olgu ÜRETİLMEZ', () => {
    const f = decodeVin('VF1RJL00', YEAR);
    expect(f.vin).toBeNull();
    expect(f.wmi).toBeNull();
    expect(f.region).toBe('unknown');
    expect(f.modelYear).toBeNull();
  });
});

/* ── 3. KANONİK KİMLİK ve PROVENANCE ──────────────────────────────────────── */

describe('P0-OBD-09 · kanonik kimlik', () => {
  beforeEach(resetVehicleIdentity);

  it('hiç gözlem yoksa NONE ve kanonik VIN null', () => {
    const s = getVehicleIdentity(1, YEAR);
    expect(s.state).toBe('NONE');
    expect(s.vin).toBeNull();
    expect(getCanonicalVin(1, YEAR)).toBeNull();
  });

  it('tek kaynak → SINGLE, provenance TAŞINIR', () => {
    expect(recordVinObservation(VIN_EU, 'mode09', 1, T, '7E8')).toBe(true);
    const s = getVehicleIdentity(1, YEAR);
    expect(s.state).toBe('SINGLE');
    expect(s.vin).toBe(VIN_EU);
    expect(s.observations[0]!.source).toBe('mode09');
    expect(s.observations[0]!.ecuRx).toBe('7E8');
    expect(s.observations[0]!.epoch).toBe(1);
  });

  it('iki kaynak AYNI VIN → VERIFIED', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    recordVinObservation(VIN_EU, 'uds_f190', 1, T + 10, '7E8');
    const s = getVehicleIdentity(1, YEAR);
    expect(s.state).toBe('VERIFIED');
    expect(s.observations).toHaveLength(2);
    expect(getCanonicalVin(1, YEAR)).toBe(VIN_EU);
  });

  it('KISMİ VIN kimlik OLMAZ ve red NEDENİ sayılır', () => {
    expect(recordVinObservation('VF1RJL00', 'mode09', 1, T)).toBe(false);
    const s = getVehicleIdentity(1, YEAR);
    expect(s.state).toBe('NONE');
    expect(s.rejections).toHaveLength(1);
    expect(s.rejections[0]!.reason).toBe('malformed');
    expect(s.rejections[0]!.length).toBe(8);
  });

  it('reddedilen HAM değer TAŞINMAZ (yalnız uzunluk)', () => {
    recordVinObservation('SECRETVINDATA', 'mode09', 1, T);
    const s = getVehicleIdentity(1, YEAR);
    expect(JSON.stringify(s.rejections)).not.toContain('SECRET');
  });

  it('boş girdi ayrı neden olarak sayılır', () => {
    recordVinObservation('   ', 'uds_f190', 1, T);
    expect(getVehicleIdentity(1, YEAR).rejections[0]!.reason).toBe('empty');
  });

  it('her durum ve kaynak etiketi VARDIR', () => {
    for (const k of Object.keys(VIN_STATE_LABEL)) {
      expect(VIN_STATE_LABEL[k as keyof typeof VIN_STATE_LABEL].length).toBeGreaterThan(2);
    }
    for (const k of Object.keys(VIN_SOURCE_LABEL)) {
      expect(VIN_SOURCE_LABEL[k as keyof typeof VIN_SOURCE_LABEL].length).toBeGreaterThan(2);
    }
  });
});

/* ── 4. ÇOK KAYNAKLI TUTARSIZLIK — fail-closed ───────────────────────────── */

describe('P0-OBD-09 · kaynak çelişkisi', () => {
  beforeEach(resetVehicleIdentity);

  it('iki kaynak FARKLI VIN → CONFLICT ve HİÇBİRİ kanonik değil', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    recordVinObservation(VIN_NA, 'uds_f190', 1, T + 10, '7E9');
    const s = getVehicleIdentity(1, YEAR);
    expect(s.state).toBe('CONFLICT');
    expect(s.vin).toBeNull();
    expect(getCanonicalVin(1, YEAR)).toBeNull();
  });

  it('çelişkide adaylar MASKELİ listelenir (ham VIN sızmaz)', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    recordVinObservation(VIN_NA, 'uds_f190', 1, T + 10);
    const s = getVehicleIdentity(1, YEAR);
    expect(s.conflicting).toHaveLength(2);
    for (const c of s.conflicting) {
      expect(c).toContain('*');
      expect(c).not.toBe(VIN_EU);
      expect(c).not.toBe(VIN_NA);
    }
  });

  it('çelişkide VIN olguları ÜRETİLMEZ', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    recordVinObservation(VIN_NA, 'uds_f190', 1, T + 10);
    expect(getVehicleIdentity(1, YEAR).facts.vin).toBeNull();
  });

  it('"ilk gelen kazanır" DAVRANIŞI YOK', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    recordVinObservation(VIN_NA, 'uds_f190', 1, T + 10);
    expect(getVehicleIdentity(1, YEAR).vin).not.toBe(VIN_EU);
  });

  it('aynı kaynak yeniden okursa çelişki DEĞİL güncelleme olur', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    recordVinObservation(VIN_NA, 'mode09', 1, T + 10);   // aynı kaynak, yeni değer
    const s = getVehicleIdentity(1, YEAR);
    expect(s.state).toBe('SINGLE');
    expect(s.vin).toBe(VIN_NA);
  });
});

/* ── 5. RECONNECT / ARAÇ DEĞİŞİMİ ─────────────────────────────────────────── */

describe('P0-OBD-09 · oturum ve araç değişimi', () => {
  beforeEach(resetVehicleIdentity);

  it('yeni oturumda kimlik BAYAT — kanonik SAYILMAZ', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    expect(getCanonicalVin(1, YEAR)).toBe(VIN_EU);

    /* Adaptör başka araca takılmış olabilir. */
    const s = getVehicleIdentity(2, YEAR);
    expect(s.state).toBe('STALE');
    expect(s.vin).toBeNull();
    expect(getCanonicalVin(2, YEAR)).toBeNull();
  });

  it('BAYAT kimlik silinmez — maskeli olarak görünür kalır', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    const s = getVehicleIdentity(2, YEAR);
    expect(s.maskedVin).not.toBeNull();
    expect(s.observations).toHaveLength(1);
  });

  it('yeni oturumda YENİ okuma gelince kimlik tekrar kanonik olur', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    recordVinObservation(VIN_NA, 'mode09', 2, T + 100);
    expect(getCanonicalVin(2, YEAR)).toBe(VIN_NA);
  });

  it('sıfırlama eski aracın kimliğini TAŞIMAZ', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    resetVehicleIdentity();
    expect(getVehicleIdentity(1, YEAR).state).toBe('NONE');
    expect(getCanonicalVin(1, YEAR)).toBeNull();
  });

  it('oturum bilinmiyorsa (-1) bayatlık kapısı UYGULANMAZ', () => {
    recordVinObservation(VIN_EU, 'mode09', 1, T);
    expect(getCanonicalVin(-1, YEAR)).toBe(VIN_EU);
  });
});

/* ── 6. GİZLİLİK ──────────────────────────────────────────────────────────── */

describe('P0-OBD-09 · gizlilik', () => {
  beforeEach(resetVehicleIdentity);

  it('maskeli VIN yalnız WMI\'yi açar', () => {
    const m = maskVin(VIN_EU)!;
    expect(m.startsWith('VF1')).toBe(true);
    expect(m).not.toContain('123456');
    expect(m.length).toBe(17);
  });

  it('araştırma öneki tekilleştirici haneleri TAŞIMAZ', () => {
    const p = vinResearchPrefix(VIN_EU)!;
    expect(p).toHaveLength(9);
    expect(VIN_EU.endsWith(p)).toBe(false);
  });

  it('geçersiz VIN maskelenmez (uydurma maske YOK)', () => {
    expect(maskVin('VF1RJL00')).toBeNull();
    expect(vinResearchPrefix('VF1RJL00')).toBeNull();
  });
});
