/**
 * ecuIdentity.test — P0-OBD-08 · ECU KİMLİĞİ ve ROLÜ kilitleri.
 *
 * Görev şartı: yanlış rol atama · unknown fallback · çoklu ECU · reconnect ·
 * aynı adresin farklı protokol/araç bağlamı · provenance kaybı.
 */

import { describe, it, expect } from 'vitest';

import {
  deriveEcuRole, roleFromDeclaredName, roleFromStandardAddress,
  ecuAddressKey, ecuIdentityKey, foldAscii,
  ECU_ROLE_LABEL, ECU_EVIDENCE_LABEL, type EcuRole,
} from '../platform/obd/ecuRoleModel';
import {
  ECU_ROLE_PROFILES, validateEcuRoleProfiles, lookupProfileRole,
  type EcuRoleProfileEntry,
} from '../platform/obd/ecuRoleProfiles';
import { decodeDidText } from '../platform/obd/ecuIdentityService';
import { parseEcuProbe } from '../platform/obd/ecuDiscovery';

/* ── 1. ADRESTEN ROL UYDURULMAZ ───────────────────────────────────────────── */

describe('P0-OBD-08 · adres tek başına rol vermez', () => {
  it('SAE garantisi YALNIZ 7E8 içindir', () => {
    expect(roleFromStandardAddress('7E8', 11)).toBe('engine');
    for (const rx of ['7E9', '7EA', '7EB', '7EC', '7ED', '7EE', '7EF']) {
      expect(roleFromStandardAddress(rx, 11), `${rx} için rol uydurulmuş`).toBeNull();
    }
  });

  it('29-bit adreslemede standart rol garantisi YOKTUR', () => {
    expect(roleFromStandardAddress('18DAF110', 29)).toBeNull();
    /* 7E8 metni bile 29-bit bağlamda garanti DEĞİLDİR. */
    expect(roleFromStandardAddress('7E8', 29)).toBeNull();
  });

  it('7E1 "şanzıman" SAYILMAZ — yaygın gelenek kural değildir', () => {
    const d = deriveEcuRole({
      rxHeader: '7E9', addressBits: 11, declaredName: null, profileRole: null,
    });
    expect(d.role).toBe('unknown');
    expect(d.evidence).toBe('none');
    expect(d.reason).toContain('yanlış teşhise');
  });

  it('keşif katmanı da yalnız 7E8 için rol yazar ve KANITI taşır', () => {
    const ecus = parseEcuProbe('7E8064100BE3FA813\n7E9064100BE3FA813');
    expect(ecus).toHaveLength(2);
    const eng = ecus.find((e) => e.rxHeader === '7E8')!;
    const other = ecus.find((e) => e.rxHeader === '7E9')!;
    expect(eng.role).toBe('engine');
    expect(eng.roleEvidence).toBe('standard');
    expect(other.role).toBe('unknown');
    expect(other.roleEvidence).toBe('none');
  });

  it('29-bit keşifte rol unknown ve kanıt none', () => {
    const ecus = parseEcuProbe('18DAF110064100BE3FA813');
    expect(ecus[0]!.addressBits).toBe(29);
    expect(ecus[0]!.role).toBe('unknown');
    expect(ecus[0]!.roleEvidence).toBe('none');
  });
});

/* ── 2. BEYAN EDİLEN AD → rol (yerelden bağımsız) ─────────────────────────── */

describe('P0-OBD-08 · ECU kendi adını bildirince rol çıkar', () => {
  const cases: ReadonlyArray<[string, EcuRole]> = [
    ['Engine Control Module', 'engine'],
    ['ECM',                   'engine'],
    ['EDC17C42',              'engine'],
    ['Transmission Control',  'transmission'],
    ['TCU',                   'transmission'],
    ['ABS/ESP Control Unit',  'abs_esp'],
    ['Airbag Control Unit',   'airbag_srs'],
    ['SRS',                   'airbag_srs'],
    ['Body Control Module',   'body_bcm'],
    ['Electric Power Steering', 'eps'],
    ['HVAC Controller',       'hvac'],
    ['TPMS Receiver',         'tpms'],
    ['Central Gateway',       'gateway'],
    ['Instrument Cluster',    'instrument'],
  ];

  for (const [name, role] of cases) {
    it(`"${name}" → ${role}`, () => {
      expect(roleFromDeclaredName(name)).toBe(role);
    });
  }

  it('TÜRKÇE YEREL AYAR TUZAĞI: küçük "i" içeren ad da eşleşir', () => {
    /* `toUpperCase()` tr-TR'de i → İ üretir ve eşleşme SESSİZCE başarısız olur
       (kütükte kayıtlı fail-open deseni). ASCII katlama bunu engeller. */
    expect(foldAscii('abs')).toBe('ABS');
    expect(foldAscii('İnstrument')).toBe('INSTRUMENT');
    expect(foldAscii('ısıtıcı')).toBe('ISITICI');
    expect(roleFromDeclaredName('instrument cluster')).toBe('instrument');
    expect(roleFromDeclaredName('şanzıman kontrol')).toBe('transmission');
  });

  it('TANINMAYAN ad rol ÜRETMEZ ama metin KAYBOLMAZ', () => {
    const d = deriveEcuRole({
      rxHeader: '7E9', addressBits: 11, declaredName: 'XZ-9931', profileRole: null,
    });
    expect(d.role).toBe('unknown');
    expect(d.evidence).toBe('none');
    expect(d.reason).toContain('XZ-9931');
    expect(d.reason).toContain('UYDURULMADI');
  });

  it('belirsiz/jenerik sözcükler rol ÜRETMEZ', () => {
    for (const n of ['Control Unit', 'Module', 'ECU', 'CTRL', 'UNIT']) {
      expect(roleFromDeclaredName(n), `${n} yanlış eşleşti`).toBeNull();
    }
  });

  it('boş/kısa/geçersiz ad rol ÜRETMEZ', () => {
    expect(roleFromDeclaredName(null)).toBeNull();
    expect(roleFromDeclaredName('')).toBeNull();
    expect(roleFromDeclaredName('A')).toBeNull();
    expect(roleFromDeclaredName(undefined)).toBeNull();
  });
});

/* ── 3. KANIT SIRASI: beyan > standart > profil > yok ─────────────────────── */

describe('P0-OBD-08 · kanıt sırası', () => {
  it('BEYAN standart adresi EZER — 7E8\'deki birim kendini TCM derse şanzımandır', () => {
    const d = deriveEcuRole({
      rxHeader: '7E8', addressBits: 11, declaredName: 'TCM', profileRole: null,
    });
    expect(d.role).toBe('transmission');
    expect(d.evidence).toBe('declared');
  });

  it('beyan yoksa standart adres kazanır', () => {
    const d = deriveEcuRole({
      rxHeader: '7E8', addressBits: 11, declaredName: null, profileRole: 'abs_esp',
    });
    expect(d.role).toBe('engine');
    expect(d.evidence).toBe('standard');
  });

  it('beyan ve standart yoksa profil kullanılır — ama KANIT olarak işaretlenir', () => {
    const d = deriveEcuRole({
      rxHeader: '18DAF17A', addressBits: 29, declaredName: null, profileRole: 'abs_esp',
    });
    expect(d.role).toBe('abs_esp');
    expect(d.evidence).toBe('profile');
    expect(d.reason).toContain('STANDART GARANTİSİ DEĞİL');
  });

  it('profil "unknown" verirse rol yine unknown kalır', () => {
    const d = deriveEcuRole({
      rxHeader: '18DAF17A', addressBits: 29, declaredName: null, profileRole: 'unknown',
    });
    expect(d.role).toBe('unknown');
    expect(d.evidence).toBe('none');
  });

  it('her rol ve kanıt sınıfının etiketi VARDIR (ekranda boş kalmaz)', () => {
    for (const r of Object.keys(ECU_ROLE_LABEL) as EcuRole[]) {
      expect(ECU_ROLE_LABEL[r].length).toBeGreaterThan(2);
    }
    for (const e of ['declared', 'standard', 'profile', 'none'] as const) {
      expect(ECU_EVIDENCE_LABEL[e].length).toBeGreaterThan(2);
    }
  });
});

/* ── 4. ÜRETİCİ PROFİLİ AYRI KATMAN ───────────────────────────────────────── */

describe('P0-OBD-08 · üretici profili veri katmanı', () => {
  it('varsayılan tablo BOŞ — doğrulanmamış eşleme YOK', () => {
    expect(ECU_ROLE_PROFILES).toHaveLength(0);
  });

  it('tablo doğrulayıcısı temiz (boş tablo geçerlidir)', () => {
    expect(validateEcuRoleProfiles()).toEqual([]);
  });

  it('DAMGASIZ eşleme REDDEDİLİR — tahmin başka dosyaya taşınamaz', () => {
    const bad = [{
      wmi: 'VF1', rxHeader: '18DAF17A', addressBits: 29 as const, role: 'abs_esp' as const,
      verifiedOn: '', evidenceNote: 'çoğu Renault böyle',
    }];
    const errs = validateEcuRoleProfiles(bad);
    expect(errs.some((e) => e.includes('verifiedOn'))).toBe(true);
  });

  it('biçimsiz / yinelenen / anlamsız satırlar REDDEDİLİR', () => {
    const e = (o: Partial<EcuRoleProfileEntry>): EcuRoleProfileEntry => ({
      wmi: 'VF1', rxHeader: '7E9', addressBits: 11, role: 'abs_esp',
      verifiedOn: '2026-08-23', evidenceNote: 'servis belgesiyle doğrulandı', ...o,
    });
    expect(validateEcuRoleProfiles([e({ wmi: 'vf' })]).length).toBeGreaterThan(0);
    expect(validateEcuRoleProfiles([e({ rxHeader: 'ZZZ' })]).length).toBeGreaterThan(0);
    expect(validateEcuRoleProfiles([e({ role: 'unknown' })]).length).toBeGreaterThan(0);
    expect(validateEcuRoleProfiles([e({ evidenceNote: 'kısa' })]).length).toBeGreaterThan(0);
    expect(validateEcuRoleProfiles([e({}), e({})]).some((x) => x.includes('yinelenen'))).toBe(true);
  });

  it('ÜRETİCİ BİLİNMİYORSA profil HİÇ denenmez', () => {
    const table: EcuRoleProfileEntry[] = [{
      wmi: 'VF1', rxHeader: '7E9', addressBits: 11, role: 'abs_esp',
      verifiedOn: '2026-08-23', evidenceNote: 'gerçek araçta doğrulandı',
    }];
    expect(lookupProfileRole(null, '7E9', 11, table)).toBeNull();
    expect(lookupProfileRole('', '7E9', 11, table)).toBeNull();
    expect(lookupProfileRole('VF', '7E9', 11, table)).toBeNull();
  });

  it('WMI + adres + adresleme kipi TAM tutmalı', () => {
    const table: EcuRoleProfileEntry[] = [{
      wmi: 'VF1', rxHeader: '7E9', addressBits: 11, role: 'abs_esp',
      verifiedOn: '2026-08-23', evidenceNote: 'gerçek araçta doğrulandı',
    }];
    expect(lookupProfileRole('VF1RJL00123456789', '7E9', 11, table)).toBe('abs_esp');
    expect(lookupProfileRole('WVW1234567890', '7E9', 11, table)).toBeNull();   // farklı üretici
    expect(lookupProfileRole('VF1RJL00123456789', '7EA', 11, table)).toBeNull(); // farklı adres
    expect(lookupProfileRole('VF1RJL00123456789', '7E9', 29, table)).toBeNull(); // farklı kip
  });
});

/* ── 5. KARARLI KİMLİK ────────────────────────────────────────────────────── */

describe('P0-OBD-08 · kararlı kimlik', () => {
  const base = { rxHeader: '7E8', txHeader: '7E0', addressBits: 11 as const };

  it('aynı ECU yeniden bulunduğunda adres anahtarı AYNI', () => {
    expect(ecuAddressKey(base)).toBe(ecuAddressKey({ ...base }));
    expect(ecuAddressKey({ rxHeader: '7e8', addressBits: 11 })).toBe(ecuAddressKey(base));
  });

  it('ADRESLEME KİPİ anahtara girer — 11-bit ve 29-bit karışmaz', () => {
    expect(ecuAddressKey({ rxHeader: '7E8', addressBits: 11 }))
      .not.toBe(ecuAddressKey({ rxHeader: '7E8', addressBits: 29 }));
  });

  it('AYNI adres FARKLI araçta FARKLI kimlik üretir', () => {
    const a = ecuIdentityKey({ ...base, protocol: '6', vehicleKey: 'VIN-A' });
    const b = ecuIdentityKey({ ...base, protocol: '6', vehicleKey: 'VIN-B' });
    expect(a).not.toBe(b);
  });

  it('AYNI adres FARKLI protokolde FARKLI kimlik üretir', () => {
    const a = ecuIdentityKey({ ...base, protocol: '6', vehicleKey: 'VIN-A' });
    const b = ecuIdentityKey({ ...base, protocol: '7', vehicleKey: 'VIN-A' });
    expect(a).not.toBe(b);
  });

  it('aynı araç + aynı protokol + aynı adres → AYNI kimlik (kararlılık)', () => {
    const a = ecuIdentityKey({ ...base, protocol: '6', vehicleKey: 'VIN-A' });
    const b = ecuIdentityKey({ ...base, protocol: '6', vehicleKey: 'VIN-A' });
    expect(a).toBe(b);
  });

  it('BİLİNMEYEN bağlam AÇIKÇA işaretlenir (sessizce boş bırakılmaz)', () => {
    const k = ecuIdentityKey({ ...base, protocol: null, vehicleKey: null });
    expect(k.startsWith('?|?|')).toBe(true);
  });
});

/* ── 6. DID metni çözümleme ───────────────────────────────────────────────── */

describe('P0-OBD-08 · kimlik DID metni', () => {
  it('yazdırılabilir ASCII çıkarılır', () => {
    // "ABS" = 41 42 53
    expect(decodeDidText('414253')).toBe('ABS');
  });

  it('dolgu baytları (0x00/0xFF) metne KATILMAZ', () => {
    expect(decodeDidText('414253000000')).toBe('ABS');
    expect(decodeDidText('FFFF414253FF')).toBe('ABS');
  });

  it('çok kısa sonuç ad SAYILMAZ (dolgudan artan tek harf)', () => {
    expect(decodeDidText('41')).toBeNull();
    expect(decodeDidText('4142')).toBeNull();
    expect(decodeDidText('00000000')).toBeNull();
  });

  it('geçersiz girdi null döner', () => {
    expect(decodeDidText(null)).toBeNull();
    expect(decodeDidText(undefined)).toBeNull();
    expect(decodeDidText('')).toBeNull();
  });
});

/* ── 7. ÇOKLU ECU + PROVENANCE KAYBI ──────────────────────────────────────── */

describe('P0-OBD-08 · çoklu ECU ve provenance', () => {
  it('çok ECU\'lu prob yanıtı ayrı kayıtlara ayrılır ve adresler karışmaz', () => {
    const ecus = parseEcuProbe(
      '7E8 06 41 00 BE 3F A8 13\n7E9 06 41 00 80 00 00 00\n18DAF110 06 41 00 80 00 00 00',
    );
    expect(ecus).toHaveLength(3);
    expect(ecus.map((e) => e.rxHeader).sort()).toEqual(['18DAF110', '7E8', '7E9']);
    /* tx adresleri KENDİ kurallarıyla türetilir; karışmaz. */
    expect(ecus.find((e) => e.rxHeader === '7E8')!.txHeader).toBe('7E0');
    expect(ecus.find((e) => e.rxHeader === '7E9')!.txHeader).toBe('7E1');
    expect(ecus.find((e) => e.rxHeader === '18DAF110')!.txHeader).toBe('18DA10F1');
  });

  it('aynı ECU birden çok satırda görünse bile TEK kayıt olur', () => {
    const ecus = parseEcuProbe('7E8 10 14 41 00\n7E8 21 BE 3F A8 13');
    expect(ecus).toHaveLength(1);
  });

  it('her ECU kendi kimlik anahtarını üretir — iki ECU aynı anahtarı ALMAZ', () => {
    const ecus = parseEcuProbe('7E8 06 41 00\n7E9 06 41 00');
    const keys = ecus.map((e) => ecuAddressKey(e));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gürültü satırları envantere GİRMEZ', () => {
    expect(parseEcuProbe('SEARCHING...\nNO DATA\n?\n>\nOK')).toHaveLength(0);
  });
});
