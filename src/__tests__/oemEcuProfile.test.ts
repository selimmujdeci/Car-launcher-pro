/**
 * oemEcuProfile.test — P1-OBD-01 · OEM ECU PROFİL SÖZLEŞMESİ KİLİTLERİ.
 *
 * Bu dosya, profil yolunun SESSİZCE gevşemesini engeller. Kilitlenen davranışlar:
 *  - doğrulanmamış profil ÜRÜN YOLUNA GİREMEZ (fail-closed)
 *  - yazma/aktüatör servisi profil dosyasına YAZILARAK BİLE açılamaz
 *  - adresten rol uydurulamaz (`role: unknown` yasak)
 *  - aynı ECU functional + profile → TEK kayıt (duplicate yok)
 *  - yanlış model / yanlış protokol / VIN yok → profil UYGULANMAZ
 *  - KWP hedefi bilinmiyorsa UNKNOWN kalır ve envantere CAN kipiyle sokulmaz
 *  - 11-bit ve 29-bit adresler ayrı kanıttır
 *  - reconnect (oturum epoch değişimi) eşleşmeyi BAYAT yapar
 */

import { describe, it, expect } from 'vitest';
import {
  validateOemEcuProfile, selectProductEcus, isProductEligibleProfile,
  isVerifiedOemEcu, addressBitsOf,
  type OemEcuEntry, type OemEcuProfile,
} from '../platform/obd/oem/oemEcuProfile';
import {
  matchOemProfile, mergeOemProfileEcus, lookupOemProfileEcu, MAX_PROFILE_ECUS,
} from '../platform/obd/oem/oemProfileMatch';
import {
  OEM_ECU_PROFILES, getProductOemProfiles, validateOemProfileRegistry,
} from '../platform/obd/oem/oemProfileRegistry';
import type { DiscoveredEcu } from '../platform/obd/ecuDiscovery';

/* ── Fikstürler ───────────────────────────────────────────────────────────── */

const PROV = { kind: 'field_observation', source: 'kütük #TEST', license: 'MIT' } as const;

function ecu(over: Partial<OemEcuEntry> = {}): OemEcuEntry {
  return {
    ecuId: 'bcm',
    name: 'Gövde Kontrol Modülü',
    role: 'body_bcm',
    addressing: 'can11',
    tx: '745',
    rx: '765',
    kwpTarget: null,
    session: 'default',
    readServices: ['22'],
    dids: [],
    provenance: PROV,
    verifiedOn: '2026-08-23',
    evidence: 'Gerçek araçta 22F190 pozitif yanıt verdi (62F190 …).',
    ...over,
  };
}

function profile(over: Partial<OemEcuProfile> = {}, ecus: readonly OemEcuEntry[] = [ecu()]): OemEcuProfile {
  return {
    id: 'test-profile',
    note: 'test',
    provenance: PROV,
    vehicle: {
      manufacturer: 'Renault',
      modelFamily: 'Test',
      wmi: ['VF1'],
      vdsPattern: null,
      protocols: ['can'],
    },
    ecus,
    ...over,
  };
}

/** VF1 + VDS 'ABCDEF' + kontrol/seri — 17 hane. */
const VIN_VF1 = 'VF1ABCDEF12345678';
/** Başka üretici (WMI tutmaz). */
const VIN_WVW = 'WVWABCDEF12345678';

/** ELM ATDPN haneleri: '6' = CAN 11/500, '5' = KWP fast init. */
const PROTO_CAN = '6';
const PROTO_KWP = '5';

function discoveredEcu(over: Partial<DiscoveredEcu> = {}): DiscoveredEcu {
  return {
    rxHeader: '7E8', txHeader: '7E0', addressBits: 11,
    role: 'engine', roleEvidence: 'standard', label: 'Motor (ECM)',
    discoverySource: 'functional_0100', probeOutcome: 'responded',
    ...over,
  };
}

/* ── 1 · Doğrulayıcı ──────────────────────────────────────────────────────── */

describe('validateOemEcuProfile — yapısal kapılar', () => {
  it('geçerli profili kabul eder', () => {
    const r = validateOemEcuProfile(profile());
    expect(r.valid).toBe(true);
  });

  it('YAZMA servisi (0x2E) profile YAZILARAK BİLE açılamaz', () => {
    const r = validateOemEcuProfile(profile({}, [ecu({ readServices: ['22', '2E'] as never })]));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/WriteDataByIdentifier|YAZMA/);
  });

  it('SecurityAccess (0x27) reddedilir', () => {
    const r = validateOemEcuProfile(profile({}, [ecu({ readServices: ['27'] as never })]));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/SecurityAccess/);
  });

  it("role: 'unknown' REDDEDİLİR — adresten rol uydurma yasağı", () => {
    const r = validateOemEcuProfile(profile({}, [ecu({ role: 'unknown' as never })]));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/unknown/);
  });

  it('yarım damga (tarih var, kanıt yok) REDDEDİLİR', () => {
    const r = validateOemEcuProfile(profile({}, [ecu({ verifiedOn: '2026-08-23', evidence: null })]));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/evidence/);
  });

  it('kanıtsız kayıt YAPISAL olarak geçerlidir (karantina) ama doğrulanmış SAYILMAZ', () => {
    const p = profile({}, [ecu({ verifiedOn: null, evidence: null })]);
    expect(validateOemEcuProfile(p).valid).toBe(true);
    expect(isVerifiedOemEcu(p.ecus[0]!)).toBe(false);
    expect(isProductEligibleProfile(p)).toBe(false);
  });

  it('kopyaleft lisans REDDEDİLİR (ticari satış kuralı)', () => {
    const r = validateOemEcuProfile(profile({}, [
      ecu({ provenance: { kind: 'oss_licensed', source: 'x', license: 'GPL-3.0' } }),
    ]));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/lisans/i);
  });

  it('11-bit adres 3 hane, 29-bit adres 8 hane olmalı', () => {
    expect(validateOemEcuProfile(profile({}, [ecu({ addressing: 'can11', tx: '18DADAF1', rx: '18DAF1DA' })])).valid).toBe(false);
    expect(validateOemEcuProfile(profile({}, [ecu({ addressing: 'can29', tx: '745', rx: '765' })])).valid).toBe(false);
    expect(validateOemEcuProfile(profile({}, [ecu({ addressing: 'can29', tx: '18DADAF1', rx: '18DAF1DA' })])).valid).toBe(true);
  });

  it('KWP hedefi 2 hex hane veya UNKNOWN olmalı; CAN adreslemede null olmalı', () => {
    const kwpOk = ecu({ addressing: 'kwp', tx: '', rx: '', kwpTarget: 'UNKNOWN', readServices: ['21'] });
    expect(validateOemEcuProfile(profile({ vehicle: { manufacturer: 'R', modelFamily: 'T', wmi: ['VF1'], vdsPattern: null, protocols: ['kwp'] } }, [kwpOk])).valid).toBe(true);

    const kwpBad = ecu({ addressing: 'kwp', tx: '', rx: '', kwpTarget: 'ZZ', readServices: ['21'] });
    expect(validateOemEcuProfile(profile({}, [kwpBad])).valid).toBe(false);

    const canBad = ecu({ kwpTarget: '10' });
    expect(validateOemEcuProfile(profile({}, [canBad])).valid).toBe(false);
  });

  it('readServices ile çelişen DID servisi REDDEDİLİR (ölü kayıt)', () => {
    const r = validateOemEcuProfile(profile({}, [ecu({
      readServices: ['22'],
      dids: [{ id: '80', service: '21', name: 'LID', verifiedOn: null, evidence: null }],
    })]));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors.join(' ')).toMatch(/readServices/);
  });

  it('addressBitsOf: KWP\'de CAN adres kipi YOKTUR', () => {
    expect(addressBitsOf(ecu({ addressing: 'can11' }))).toBe(11);
    expect(addressBitsOf(ecu({ addressing: 'can29', tx: '18DADAF1', rx: '18DAF1DA' }))).toBe(29);
    expect(addressBitsOf(ecu({ addressing: 'kwp', tx: '', rx: '', kwpTarget: 'UNKNOWN', readServices: ['21'] }))).toBeNull();
  });
});

/* ── 2 · Eşleştirme kapıları ──────────────────────────────────────────────── */

describe('matchOemProfile — kanıt kapıları', () => {
  it('PROFİL YOK → no_profile', () => {
    const r = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [] });
    expect(r.outcome).toBe('no_profile');
    expect(r.ecus).toHaveLength(0);
  });

  it('VIN YOK → hiçbir profil denenmez (marka kanıtı yok)', () => {
    const r = matchOemProfile({ vin: null, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [profile()] });
    expect(r.outcome).toBe('no_vin');
    expect(r.ecus).toHaveLength(0);
  });

  it('PROTOKOL BİLİNMİYOR → fail-closed (uygulanmaz)', () => {
    const r = matchOemProfile({ vin: VIN_VF1, protocol: null, sessionEpoch: 1, profiles: [profile()] });
    expect(r.outcome).toBe('protocol_unknown');
    expect(r.ecus).toHaveLength(0);
  });

  it('WMI TUTMAZSA eşleşmez', () => {
    const r = matchOemProfile({ vin: VIN_WVW, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [profile()] });
    expect(r.outcome).toBe('wmi_mismatch');
  });

  it('YANLIŞ MODEL: VDS deseni tutmazsa eşleşmez', () => {
    const p = profile({
      vehicle: { manufacturer: 'Renault', modelFamily: 'Zoe Ph2', wmi: ['VF1'], vdsPattern: '^AG', protocols: ['can'] },
    });
    const r = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [p] });
    expect(r.outcome).toBe('model_mismatch');
    expect(r.ecus).toHaveLength(0);
  });

  it('DOĞRU MODEL: VDS deseni tutarsa eşleşir', () => {
    const p = profile({
      vehicle: { manufacturer: 'Renault', modelFamily: 'Zoe Ph2', wmi: ['VF1'], vdsPattern: '^ABCDEF$', protocols: ['can'] },
    });
    const r = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [p] });
    expect(r.outcome).toBe('matched');
  });

  it('YANLIŞ PROTOKOL: CAN profili KWP hattında uygulanmaz', () => {
    const r = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_KWP, sessionEpoch: 1, profiles: [profile()] });
    expect(r.outcome).toBe('protocol_mismatch');
    expect(r.ecus).toHaveLength(0);
  });

  it('DOĞRULANMAMIŞ PROFİL → fail-closed reddedilir', () => {
    const p = profile({}, [ecu({ verifiedOn: null, evidence: null })]);
    const r = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [p] });
    expect(r.outcome).toBe('unverified_rejected');
    expect(r.ecus).toHaveLength(0);
  });

  it('DOĞRULANMIŞ PROFİL → eşleşir ve yalnız damgalı ECU\'lar gelir', () => {
    const p = profile({}, [
      ecu({ ecuId: 'bcm', rx: '765', tx: '745' }),
      ecu({ ecuId: 'hvac', rx: '764', tx: '744', role: 'hvac', verifiedOn: null, evidence: null }),
    ]);
    const r = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 7, profiles: [p] });
    expect(r.outcome).toBe('matched');
    expect(r.ecus.map((m) => m.entry.ecuId)).toEqual(['bcm']);
    expect(r.sessionEpoch).toBe(7);
    expect(selectProductEcus(p)).toHaveLength(1);
  });

  it('model deseni OLAN profil, genel marka profilinden ÖNCE denenir', () => {
    const generic = profile({ id: 'generic' }, [ecu({ ecuId: 'bcm', rx: '765' })]);
    const specific = profile({
      id: 'specific',
      vehicle: { manufacturer: 'Renault', modelFamily: 'Zoe', wmi: ['VF1'], vdsPattern: '^ABCDEF$', protocols: ['can'] },
    }, [ecu({ ecuId: 'lbc', rx: '766', tx: '746', role: 'engine' })]);
    const r = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [generic, specific] });
    expect(r.profileId).toBe('specific');
  });

  it('OTURUM EPOCH: eşleşme damgalanır — reconnect sonrası eski damga taşınmaz', () => {
    const p = profile();
    const before = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 3, profiles: [p] });
    const after = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 4, profiles: [p] });
    expect(before.sessionEpoch).toBe(3);
    expect(after.sessionEpoch).toBe(4);
    expect(before.sessionEpoch).not.toBe(after.sessionEpoch);
  });
});

/* ── 3 · Keşif zenginleştirme ─────────────────────────────────────────────── */

describe('mergeOemProfileEcus — duplicate yok, uydurma kanıt yok', () => {
  it('profilden gelen ECU eklenir ve YANIT KANITI TAŞIMAZ', () => {
    const p = profile();
    const match = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [p] });
    const m = mergeOemProfileEcus([discoveredEcu()], match);

    expect(m.addedCount).toBe(1);
    expect(m.merged).toHaveLength(2);
    const added = m.merged.find((e) => e.rxHeader === '765')!;
    expect(added.discoverySource).toBe('profile');
    expect(added.probeOutcome).toBe('not_attempted');   // İDDİA — yanıt kanıtı DEĞİL
    expect(added.roleEvidence).toBe('none');            // keşif katmanı 'profile' kanıtı üretmez
    expect(added.role).toBe('body_bcm');
  });

  it('AYNI ECU functional + profile → TEK kayıt (duplicate üretilmez)', () => {
    const p = profile({}, [ecu({ ecuId: 'engine', role: 'engine', tx: '7E0', rx: '7E8' })]);
    const match = matchOemProfile({
      vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [p],
      discovered: [discoveredEcu()],
    });
    const m = mergeOemProfileEcus([discoveredEcu()], match);

    expect(m.addedCount).toBe(0);
    expect(m.duplicateCount).toBe(1);
    expect(m.merged).toHaveLength(1);
    /* Gerçek yanıt kanıtı korunur — profil onu EZMEZ. */
    expect(m.merged[0]!.discoverySource).toBe('functional_0100');
    expect(match.ecus[0]!.alsoDiscovered).toBe(true);
  });

  it('11-bit ve 29-bit AYNI kanıt değildir — ikisi ayrı kayıttır', () => {
    const p = profile({}, [
      ecu({ ecuId: 'bcm', addressing: 'can11', tx: '745', rx: '765' }),
      ecu({ ecuId: 'evc', addressing: 'can29', tx: '18DADAF1', rx: '18DAF1DA', role: 'engine' }),
    ]);
    const match = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [p] });
    const m = mergeOemProfileEcus([], match);

    expect(m.addedCount).toBe(2);
    expect(m.merged.map((e) => e.addressBits).sort()).toEqual([11, 29]);
    expect(lookupOemProfileEcu(match, '18DAF1DA', 29)?.entry.ecuId).toBe('evc');
    /* Aynı rx metni farklı adres kipiyle sorulursa EŞLEŞMEZ. */
    expect(lookupOemProfileEcu(match, '18DAF1DA', 11)).toBeNull();
  });

  it('KWP ECU\'su envantere ALINMAZ (CAN adres kipi yoktur) ve bu dürüstçe raporlanır', () => {
    const p = profile({
      vehicle: { manufacturer: 'Renault', modelFamily: 'Trafic', wmi: ['VF1'], vdsPattern: null, protocols: ['kwp'] },
    }, [ecu({ ecuId: 'engine', role: 'engine', addressing: 'kwp', tx: '', rx: '', kwpTarget: 'UNKNOWN', readServices: ['21'] })]);
    const match = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_KWP, sessionEpoch: 1, profiles: [p] });
    expect(match.outcome).toBe('matched');

    const m = mergeOemProfileEcus([], match);
    expect(m.addedCount).toBe(0);
    expect(m.kwpDeferredCount).toBe(1);
    expect(m.merged).toHaveLength(0);
  });

  it('KWP hedefi bilinmiyorsa UNKNOWN kalır (uydurulmaz)', () => {
    const e = ecu({ addressing: 'kwp', tx: '', rx: '', kwpTarget: 'UNKNOWN', readServices: ['21'] });
    expect(e.kwpTarget).toBe('UNKNOWN');
    expect(e.session === 'UNKNOWN' || e.session === 'default').toBe(true);
  });

  it('MAX_PROFILE_ECUS tavanı SESSİZ kırpmaz — kesilen adet raporlanır', () => {
    const many: OemEcuEntry[] = Array.from({ length: MAX_PROFILE_ECUS + 2 }, (_, i) =>
      ecu({ ecuId: `e${i}`, tx: `7${i}0`, rx: `7${i}1` }));
    const match = matchOemProfile({ vin: VIN_VF1, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [profile({}, many)] });
    const m = mergeOemProfileEcus([], match);
    expect(m.addedCount).toBe(MAX_PROFILE_ECUS);
    expect(m.cappedCount).toBe(2);
  });

  it('eşleşme yoksa liste DEĞİŞMEZ', () => {
    const match = matchOemProfile({ vin: null, protocol: PROTO_CAN, sessionEpoch: 1, profiles: [profile()] });
    const base = [discoveredEcu()];
    const m = mergeOemProfileEcus(base, match);
    expect(m.merged).toBe(base);
    expect(m.addedCount).toBe(0);
  });
});

/* ── 4 · Defter (taşınan kayıtlar) ────────────────────────────────────────── */

describe('oemProfileRegistry — taşınan kayıtlar ve ürün yolu kapısı', () => {
  it('defter yapısal olarak tutarlıdır', () => {
    expect(validateOemProfileRegistry()).toEqual([]);
  });

  it('mevcut Renault/Dacia · Trafic KWP · Zoe Ph2 kayıtları taşındı', () => {
    expect(OEM_ECU_PROFILES.map((p) => p.id).sort())
      .toEqual(['renault-dacia-can', 'renault-trafic-kwp', 'renault-zoe-ph2']);
  });

  it('ÜRÜN YOLU BOŞ: hiçbir kayıt gerçek araçta doğrulanmadı (fail-closed)', () => {
    expect(getProductOemProfiles()).toEqual([]);
    for (const p of OEM_ECU_PROFILES) {
      for (const e of p.ecus) expect(isVerifiedOemEcu(e)).toBe(false);
    }
  });

  it('Zoe Ph2 profili 11-bit ve 29-bit ECU\'ları birlikte taşır', () => {
    const zoe = OEM_ECU_PROFILES.find((p) => p.id === 'renault-zoe-ph2')!;
    const kinds = new Set(zoe.ecus.map((e) => e.addressing));
    expect(kinds.has('can11')).toBe(true);
    expect(kinds.has('can29')).toBe(true);
  });

  it('Trafic KWP profilinde hedef bayt ve oturum UNKNOWN bırakıldı', () => {
    const trafic = OEM_ECU_PROFILES.find((p) => p.id === 'renault-trafic-kwp')!;
    const engine = trafic.ecus[0]!;
    expect(engine.addressing).toBe('kwp');
    expect(engine.kwpTarget).toBe('UNKNOWN');
    expect(engine.session).toBe('UNKNOWN');
  });

  it('hiçbir kayıt yazma/aktüatör servisi beyan etmez', () => {
    const forbidden = new Set(['04', '11', '14', '27', '28', '2E', '2F', '31', '34', '36', '3B', '85']);
    for (const p of OEM_ECU_PROFILES) {
      for (const e of p.ecus) {
        for (const s of e.readServices) expect(forbidden.has(s)).toBe(false);
      }
    }
  });

  it('doğrulanmış kayıt eklendiğinde ürün yoluna GİRER (kapı çalışıyor)', () => {
    const verified = profile({ id: 'x' }, [ecu()]);
    const unverified = profile({ id: 'y' }, [ecu({ verifiedOn: null, evidence: null })]);
    const out = getProductOemProfiles([verified, unverified]);
    expect(out.map((p) => p.id)).toEqual(['x']);
    expect(out[0]!.ecus).toHaveLength(1);
  });
});
