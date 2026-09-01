/**
 * cddlV1.test.ts — P0-VDK-F3B · CDDL v1 KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * PASS ÖLÇÜTÜ (görevin kendi cümlesi)
 * ══════════════════════════════════════════════════════════════════════════
 * "Mevcut en az bir GERÇEK OEM profil, adapter üzerinden CDDL `EcuVariant`a
 *  çevrilip `ServiceDef` → `DiagnosticPdu` üretmeli ve mevcut ürün davranışı
 *  DEĞİŞMEMELİ. Yeni örnek bir read-only servis tanımı YALNIZ VERİ eklenerek
 *  oluşturulabilmeli; yeni TS control-flow gerektirmemeli."
 *
 * Bu dosya her iki yarıyı da ölçer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from './helpers';

import {
  CDDL_SCHEMA_VERSION, EMPTY_CDDL_DOCUMENT, isProductTrusted,
  type CddlDocument, type CddlProvenance, type EcuVariant, type ServiceDef,
} from '../platform/obd/cddl/schema';
import { validateCddlDocument } from '../platform/obd/cddl/validate';
import {
  buildPduFromServiceDef, PDU_BUILD_REJECTION_LABEL,
} from '../platform/obd/cddl/serviceDef';
import {
  cddlDocumentFromLegacy, builtinServiceDefs, serviceDefIdFor,
  ecuVariantFromOem, variantPatternFromOem, comParamsFromProtocolProfile,
} from '../platform/obd/cddl/legacyAdapter';
import { OEM_ECU_PROFILES } from '../platform/obd/oem/oemProfileRegistry';
import { getProtocolProfile } from '../platform/obd/protocolProfile';
import { encodePduRequest } from '../platform/obd/pdu';
import {
  readCddlInventorySnapshot,
} from '../platform/devtools/cddlInventorySources';
import {
  buildCddlInventoryView, deriveCddlVerdict,
} from '../platform/devtools/cddlInventoryModel';
import { getCarosLabTool } from '../platform/devtools/carosLabCatalog';

const BUILTIN: CddlProvenance = {
  source: 'builtin', reference: 'iso_standard: ISO 14229-1',
  license: 'Standart referansı', verifiedOn: null,
};

function doc(p: Partial<CddlDocument> = {}): CddlDocument {
  return { ...EMPTY_CDDL_DOCUMENT, id: 'test', ...p };
}

/* ═══════════════════════════════════════════════════════════════════════════
   A) ŞEMA — FAIL-CLOSED
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3B · A) şema doğrulama', () => {
  it('🔒 BİLİNMEYEN sürüm REDDEDİLİR', () => {
    const r = validateCddlDocument({ ...doc(), schemaVersion: 'caros.cddl.v9' });
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues[0]!.rejection).toBe('UNKNOWN_SCHEMA_VERSION');
  });

  it('🔒 BİLİNMEYEN alan REDDEDİLİR — yok sayma YOK', () => {
    const r = validateCddlDocument({ ...doc(), gelecekAlani: 42 });
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues.some((i) => i.rejection === 'UNKNOWN_FIELD')).toBe(true);
  });

  it('🔒 boş belge GEÇERLİDİR — "tanım yok" ile "okunamadı" AYRI', () => {
    expect(validateCddlDocument(doc()).valid).toBe(true);
  });

  it('🔒 eksik koleksiyon REDDEDİLİR', () => {
    const bad = { ...doc() } as Record<string, unknown>;
    delete bad.services;
    const r = validateCddlDocument(bad);
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues[0]!.rejection).toBe('MISSING_COLLECTION');
  });

  it('🔒 ÇÖZÜLEMEYEN referans REDDEDİLİR', () => {
    const r = validateCddlDocument(doc({
      variants: [{
        id: 'v1', name: 'ECU', role: 'engine', addressing: 'can11',
        txHeader: '7E0', rxHeader: '7E8', kwpTarget: null, session: 'default',
        serviceRefs: ['olmayan_servis'], provenance: BUILTIN,
      }],
    }));
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues.some((i) => i.rejection === 'UNRESOLVED_SERVICE_REF')).toBe(true);
  });

  it('🔒 rolü BİLİNMEYEN ECU profile giremez (keşfe aittir)', () => {
    const r = validateCddlDocument(doc({
      variants: [{
        id: 'v1', name: 'ECU', role: 'unknown' as never, addressing: 'can11',
        txHeader: '7E0', rxHeader: '7E8', kwpTarget: null, session: 'default',
        serviceRefs: [], provenance: BUILTIN,
      }],
    }));
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues.some((i) => i.rejection === 'ROLE_UNKNOWN_FORBIDDEN')).toBe(true);
  });

  it('🔒 ANA KİLİT: KANITSIZ desen REDDEDİLİR — adresten rol UYDURULAMAZ', () => {
    const r = validateCddlDocument(doc({
      patterns: [{
        id: 'p1', manufacturer: 'X', modelFamily: 'Y', protocols: ['can'],
        evidence: [], variantRefs: [], provenance: BUILTIN,
      }],
    }));
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues.some((i) => i.rejection === 'EVIDENCE_REQUIRED')).toBe(true);
  });

  it('🔒 DESTRUCTIVE servis ürün yoluna GİREMEZ', () => {
    const r = validateCddlDocument(doc({
      services: [{
        id: 'write', service: '2E', subFunction: null, name: 'Yazma',
        effect: 'destructive', argKind: 'data_identifier', literalPayload: '',
        protocols: [], provenance: BUILTIN,
      }],
    }));
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues.some((i) => i.rejection === 'DESTRUCTIVE_NOT_ALLOWED')).toBe(true);
  });

  it('🔒 learned/BYOD kaynak ÜRÜN YOLUNA giremez (F4)', () => {
    const learned: CddlProvenance = { ...BUILTIN, source: 'learned' };
    const d = doc({
      services: [{
        id: 's', service: '22', subFunction: null, name: 'Oku',
        effect: 'read_only', argKind: 'data_identifier', literalPayload: '',
        protocols: [], provenance: learned,
      }],
    });
    const strict = validateCddlDocument(d);
    expect(strict.valid).toBe(false);
    if (strict.valid) throw new Error('unreachable');
    expect(strict.issues.some((i) => i.rejection === 'UNTRUSTED_SOURCE')).toBe(true);

    /* Analiz/gözlem için açıkça izin verilirse GEÇER — ama bu ürün yolu DEĞİL. */
    expect(validateCddlDocument(d, { allowUntrustedSource: true }).valid).toBe(true);
    expect(isProductTrusted('learned')).toBe(false);
    expect(isProductTrusted('byod')).toBe(false);
    expect(isProductTrusted('builtin')).toBe(true);
  });

  it('🔒 kopyaleft/NC lisans REDDEDİLİR (ticari satış kuralı)', () => {
    for (const lic of ['GPL-3.0', 'AGPL', 'CC-BY-NC 4.0', 'SSPL']) {
      const r = validateCddlDocument(doc({
        services: [{
          id: 's', service: '22', subFunction: null, name: 'Oku',
          effect: 'read_only', argKind: 'data_identifier', literalPayload: '',
          protocols: [], provenance: { ...BUILTIN, license: lic },
        }],
      }));
      expect(r.valid, lic).toBe(false);
      if (r.valid) throw new Error('unreachable');
      expect(r.issues.some((i) => i.rejection === 'BLOCKED_LICENSE'), lic).toBe(true);
    }
  });

  it('🔒 tekrarlı kimlik REDDEDİLİR', () => {
    const s: ServiceDef = {
      id: 'dup', service: '22', subFunction: null, name: 'Oku',
      effect: 'read_only', argKind: 'data_identifier', literalPayload: '',
      protocols: [], provenance: BUILTIN,
    };
    const r = validateCddlDocument(doc({ services: [s, s] }));
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues.some((i) => i.rejection === 'DUPLICATE_ID')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) PASS YARISI 1 — GERÇEK OEM PROFİL → CDDL → PDU
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3B · B) gerçek profil → CDDL → PDU', () => {
  it('🔒 mevcut OEM profilleri CDDL belgesine çevrilir ve DOĞRULANIR', () => {
    const d = cddlDocumentFromLegacy({
      documentId: 'legacy-oem', oemProfiles: OEM_ECU_PROFILES,
    });
    const r = validateCddlDocument(d);
    expect(r.valid,
      r.valid ? '' : r.issues.slice(0, 5).map((i) => `${i.path}: ${i.detail}`).join(' · '),
    ).toBe(true);
    expect(d.variants.length).toBeGreaterThan(0);
    expect(d.patterns.length).toBe(OEM_ECU_PROFILES.length);
  });

  it('🔒 PASS KİLİDİ: gerçek EcuVariant + ServiceDef → DiagnosticPdu', () => {
    const d = cddlDocumentFromLegacy({
      documentId: 'legacy-oem', oemProfiles: OEM_ECU_PROFILES,
    });
    /* UDS 0x19 taşıyan GERÇEK bir CAN ECU'su bul. */
    const udsId = serviceDefIdFor('19');
    const ecu = d.variants.find(
      (v) => v.serviceRefs.includes(udsId) && v.addressing === 'can11',
    );
    expect(ecu, 'gerçek profillerde UDS 0x19 taşıyan CAN ECU yok').toBeDefined();

    const svc = d.services.find((s) => s.id === udsId)!;
    const built = buildPduFromServiceDef({
      service: svc, ecu: ecu!, argument: 'FF', protocol: '6', protocolClass: 'can',
    });
    expect(built.ok, built.ok ? '' : built.detail).toBe(true);
    if (!built.ok) throw new Error('unreachable');

    /* Üretilen PDU F3-A sözleşmesine tam uyar ve künyesi ürünün kullandığıyla AYNI. */
    expect(built.pdu.service).toBe('19');
    expect(built.pdu.subFunction).toBe('02');
    expect(built.pdu.payload).toBe('FF');
    expect(built.pdu.target.txHeader).toBe(ecu!.txHeader);
    expect(built.pdu.target.addressing).toBe('physical_can11');
    expect(encodePduRequest(built.pdu)).toBe('1902FF');
  });

  it('🔒 KWP ECU’su KWP servisiyle PDU üretir (protokol ayrımı korunur)', () => {
    const d = cddlDocumentFromLegacy({
      documentId: 'legacy-oem', oemProfiles: OEM_ECU_PROFILES,
    });
    const kwpId = serviceDefIdFor('18');
    const ecu = d.variants.find((v) => v.serviceRefs.includes(kwpId));
    if (ecu === undefined) return;   // KWP profili yoksa bu kilit uygulanmaz

    const svc = d.services.find((s) => s.id === kwpId)!;
    const built = buildPduFromServiceDef({
      service: svc, ecu, protocol: '5', protocolClass: 'kwp',
    });
    expect(built.ok, built.ok ? '' : built.detail).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(encodePduRequest(built.pdu)).toBe('1800FF00');
  });

  it('🔒 ANA KİLİT: MEVCUT PROFİL SİSTEMİ DEĞİŞMEDİ (silinmedi/taşınmadı)', () => {
    /* Adapter TEK YÖNLÜDÜR: legacy → CDDL. Ters yön iki otorite arasında
       senkron zorunluluğu doğururdu ve biri sessizce eskirdi. */
    const src = stripComments(
      readFileSync(resolve(__dirname, '../platform/obd/cddl/legacyAdapter.ts'), 'utf8'));
    expect(src).not.toMatch(/OEM_ECU_PROFILES\s*=/);
    expect(src).not.toMatch(/function\s+\w*ToOem|cddlToLegacy|writeOemProfile/);

    /* Mevcut kayıt sayısı ve ürün kapısı olduğu gibi duruyor. */
    expect(OEM_ECU_PROFILES.length).toBe(3);
  });

  it('🔒 ürün kapısı DEĞİŞMEDİ: doğrulanmamış profil ürün yoluna girmez', async () => {
    const { getProductOemProfiles } = await import('../platform/obd/oem/oemProfileRegistry');
    /* Bu kapı F3-B'den ÖNCE de boş dönüyordu; CDDL onu GEVŞETMEDİ. */
    expect(getProductOemProfiles(OEM_ECU_PROFILES)).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) PASS YARISI 2 — YENİ SERVİS YALNIZ VERİYLE
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3B · C) yeni servis yalnız VERİYLE', () => {
  /**
   * UDS 0x19-0A (reportSupportedDTC) — ürün kodunda AYRI bir dal olarak
   * yaşayan bir okuma. Burada YALNIZ VERİ olarak tanımlanır: hiçbir yeni
   * TypeScript control-flow, hiçbir `switch` dalı, hiçbir köprü metodu YOK.
   */
  const supportedDtcService: ServiceDef = {
    id: 'uds_report_supported_dtc',
    service: '19',
    subFunction: '0A',
    name: 'UDS desteklenen DTC listesi (0x19-0A)',
    effect: 'read_only',
    argKind: 'literal',
    literalPayload: '',
    protocols: ['can'],
    provenance: {
      source: 'builtin',
      reference: 'iso_standard: ISO 14229-1 §11.3.5.10 reportSupportedDTC',
      license: 'Standart referansı — metin kopyalanmadı',
      verifiedOn: null,
    },
  };

  const ecu: EcuVariant = {
    id: 'demo.ecm', name: 'Motor', role: 'engine', addressing: 'can11',
    txHeader: '7E0', rxHeader: '7E8', kwpTarget: null,
    session: 'uds_extended_1003',
    serviceRefs: ['uds_report_supported_dtc'],
    provenance: BUILTIN,
  };

  it('🔒 PASS KİLİDİ: yeni servis tanımı DOĞRULANIR ve PDU üretir', () => {
    const d = doc({ services: [supportedDtcService], variants: [ecu] });
    expect(validateCddlDocument(d).valid).toBe(true);

    const built = buildPduFromServiceDef({
      service: supportedDtcService, ecu, protocol: '6', protocolClass: 'can',
    });
    expect(built.ok, built.ok ? '' : built.detail).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    expect(encodePduRequest(built.pdu)).toBe('190A');
  });

  it('🔒 KİLİT: yeni servis için TS control-flow EKLENMEDİ', () => {
    /* `serviceDef.ts` argüman türüne göre çalışır; servis kimliğine göre
       ÖZEL DAL İÇERMEZ. Servis adına göre `if/switch` yazmak, "veriyle
       eklenebilir" iddiasını çürütürdü. */
    const src = stripComments(
      readFileSync(resolve(__dirname, '../platform/obd/cddl/serviceDef.ts'), 'utf8'));
    expect(src).not.toMatch(/uds_report_supported_dtc|uds_read_dtc_information|obd_stored_dtc/);
    expect(src).not.toMatch(/case\s*'19'|case\s*'22'|case\s*'03'/);
  });

  it('🔒 servis argüman türleri veriyle sürülür (kimlik ile DEĞİL)', () => {
    const didService: ServiceDef = {
      ...supportedDtcService, id: 'demo_read_did', service: '22',
      subFunction: null, argKind: 'data_identifier', literalPayload: '',
    };
    const e2: EcuVariant = { ...ecu, serviceRefs: ['demo_read_did'] };
    const r = buildPduFromServiceDef({
      service: didService, ecu: e2, argument: 'F190', protocolClass: 'can',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(encodePduRequest(r.pdu)).toBe('22F190');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) PDU ÜRETİMİ — FAIL-CLOSED
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3B · D) PDU üretimi fail-closed', () => {
  const base: EcuVariant = {
    id: 'e', name: 'ECU', role: 'engine', addressing: 'can11',
    txHeader: '7E0', rxHeader: '7E8', kwpTarget: null, session: 'default',
    serviceRefs: ['s'], provenance: BUILTIN,
  };
  const svc: ServiceDef = {
    id: 's', service: '22', subFunction: null, name: 'Oku',
    effect: 'read_only', argKind: 'data_identifier', literalPayload: '',
    protocols: ['can'], provenance: BUILTIN,
  };

  it('🔒 DESTRUCTIVE servis PDU ÜRETMEZ', () => {
    const r = buildPduFromServiceDef({
      service: { ...svc, effect: 'destructive', service: '2E' }, ecu: base, argument: 'F190',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('DESTRUCTIVE_DENIED');
    expect(PDU_BUILD_REJECTION_LABEL[r.rejection]).toMatch(/REDDEDİLDİ/);
  });

  it('🔒 ECU servisi SAYMIYORSA istek KURULMAZ', () => {
    const r = buildPduFromServiceDef({
      service: svc, ecu: { ...base, serviceRefs: [] }, argument: 'F190',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('SERVICE_NOT_ON_ECU');
  });

  it('🔒 PROTOKOL uygun değilse istek KURULMAZ', () => {
    const r = buildPduFromServiceDef({
      service: svc, ecu: base, argument: 'F190', protocolClass: 'kwp',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('PROTOCOL_NOT_APPLICABLE');
  });

  it('🔒 ARGÜMAN eksik/bozuksa istek KURULMAZ', () => {
    const missing = buildPduFromServiceDef({ service: svc, ecu: base, argument: null });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('unreachable');
    expect(missing.rejection).toBe('ARGUMENT_REQUIRED');

    for (const bad of ['ZZZZ', 'F1', 'F190AA']) {
      const r = buildPduFromServiceDef({ service: svc, ecu: base, argument: bad });
      if (bad === 'F1') { expect(r.ok, bad).toBe(true); continue; }  // 2 hane = KWP LID
      expect(r.ok, bad).toBe(false);
      if (r.ok) throw new Error('unreachable');
      expect(r.rejection).toBe('ARGUMENT_MALFORMED');
    }
  });

  it('🔒 SABİT gövdeli servis argüman KABUL ETMEZ (sessizce atmaz)', () => {
    const lit: ServiceDef = { ...svc, argKind: 'literal', literalPayload: '00FF00' };
    const r = buildPduFromServiceDef({ service: lit, ecu: base, argument: 'FF' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('ARGUMENT_MALFORMED');
  });

  it('🔒 TANINMAYAN adres istek KURDURMAZ', () => {
    const r = buildPduFromServiceDef({
      service: svc, ecu: { ...base, txHeader: 'ZZ' }, argument: 'F190',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('ECU_NOT_ADDRESSABLE');
  });

  it('🔒 `txHeader: ""` FONKSİYONEL hedefe düşer (native header’a dokunmaz)', () => {
    const r = buildPduFromServiceDef({
      service: { ...svc, argKind: 'literal', literalPayload: '' },
      ecu: { ...base, addressing: 'functional', txHeader: '', rxHeader: '' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.pdu.target.addressing).toBe('functional');
    expect(r.pdu.target.txHeader).toBeNull();
  });

  it('🔒 serviceDef TAŞIMA katmanını BİLMEZ (import etmez)', () => {
    const src = stripComments(
      readFileSync(resolve(__dirname, '../platform/obd/cddl/serviceDef.ts'), 'utf8'));
    expect(src).not.toMatch(/CarLauncher|nativePlugin|pduTransport|vdkTransport|Capacitor/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) ComParam / ProcedureDef — TEMSİL, YÜRÜTME YOK
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3B · E) ComParam ve ProcedureDef sınırları', () => {
  it('🔒 ComParam mevcut otoriteden OKUR ve otoriteyi ADIYLA söyler', () => {
    const params = comParamsFromProtocolProfile('can', getProtocolProfile('6'));
    expect(params.length).toBeGreaterThan(0);
    expect(params.every((p) => p.authority.includes('protocolProfile'))).toBe(true);
    expect(params.every((p) => p.valueMs > 0)).toBe(true);
  });

  it('🔒 ANA KİLİT: ComParam runtime davranışını DEĞİŞTİRMEZ', () => {
    /* CDDL katmanı hiçbir yerde zaman aşımı SÜRMEZ — yalnız temsil eder. */
    const files = ['schema.ts', 'legacyAdapter.ts', 'serviceDef.ts', 'validate.ts'];
    for (const f of files) {
      const src = stripComments(
        readFileSync(resolve(__dirname, `../platform/obd/cddl/${f}`), 'utf8'));
      expect(src, f).not.toMatch(/setTimeout|setInterval|obdService|diagnosticSessionLease/);
    }
  });

  it('🔒 ANA KİLİT: ProcedureDef YÜRÜTÜCÜSÜ YOK', () => {
    /* Bu fazda prosedür bir PLAN DİLİDİR. Yürütücü yazmak, doğrulanmamış bir
       akışı araca göndermek demekti. */
    for (const f of ['schema.ts', 'validate.ts', 'serviceDef.ts', 'legacyAdapter.ts']) {
      const src = stripComments(
        readFileSync(resolve(__dirname, `../platform/obd/cddl/${f}`), 'utf8'));
      expect(src, f).not.toMatch(/executeProcedure|runProcedure|ProcedureEngine|ProcedureExecutor/);
    }
  });

  it('🔒 prosedür BİLDİRİMİ doğrulanır (referanslar çözülmeli)', () => {
    const svc: ServiceDef = {
      id: 's', service: '22', subFunction: null, name: 'Oku',
      effect: 'read_only', argKind: 'data_identifier', literalPayload: '',
      protocols: [], provenance: BUILTIN,
    };
    const ecu: EcuVariant = {
      id: 'e', name: 'ECU', role: 'engine', addressing: 'can11',
      txHeader: '7E0', rxHeader: '7E8', kwpTarget: null, session: 'default',
      serviceRefs: ['s'], provenance: BUILTIN,
    };
    const ok = validateCddlDocument(doc({
      services: [svc], variants: [ecu],
      procedures: [{
        id: 'p', name: 'Kimlik oku', effect: 'read_only',
        steps: [{ id: 'st1', serviceRef: 's', ecuRef: 'e', argument: 'F190', required: true }],
        provenance: BUILTIN,
      }],
    }));
    expect(ok.valid).toBe(true);

    const bad = validateCddlDocument(doc({
      services: [svc], variants: [ecu],
      procedures: [{
        id: 'p', name: 'Bozuk', effect: 'read_only',
        steps: [{ id: 'st1', serviceRef: 'yok', ecuRef: 'e', argument: null, required: true }],
        provenance: BUILTIN,
      }],
    }));
    expect(bad.valid).toBe(false);
  });

  it('🔒 DESTRUCTIVE prosedür ürün yoluna GİREMEZ', () => {
    const r = validateCddlDocument(doc({
      procedures: [{
        id: 'p', name: 'Sil', effect: 'destructive', steps: [], provenance: BUILTIN,
      }],
    }));
    expect(r.valid).toBe(false);
    if (r.valid) throw new Error('unreachable');
    expect(r.issues.some((i) => i.rejection === 'DESTRUCTIVE_NOT_ALLOWED')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) SERVİS BEYAZ LİSTESİ SENKRONU
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3B · F) beyaz liste senkronu', () => {
  it('🔒 CDDL servis tablosu mevcut READ_SERVICES ile BİREBİR', () => {
    const src = readFileSync(
      resolve(__dirname, '../platform/obd/oem/oemEcuProfile.ts'), 'utf8');
    const m = /const READ_SERVICES: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(src);
    expect(m, 'READ_SERVICES bulunamadı').not.toBeNull();
    const legacy = [...m![1]!.matchAll(/'([0-9A-F]{2})'/g)].map((x) => x[1]!).sort();
    const cddl = builtinServiceDefs().map((s) => s.service).sort();
    expect(cddl, 'iki yerde tutulan izin listesi AYRIŞTI').toEqual(legacy);
  });

  it('🔒 tüm builtin servisler read_only ve DOĞRULANIR', () => {
    const defs = builtinServiceDefs();
    expect(defs.every((s) => s.effect === 'read_only')).toBe(true);
    expect(validateCddlDocument(doc({ services: defs })).valid).toBe(true);
  });

  it('🔒 adapter builtin damgası dışına ÇIKMAZ', () => {
    const d = cddlDocumentFromLegacy({
      documentId: 'x', oemProfiles: OEM_ECU_PROFILES,
    });
    const all: CddlProvenance[] = [
      ...d.services.map((s) => s.provenance),
      ...d.variants.map((v) => v.provenance),
      ...d.patterns.map((p) => p.provenance),
      ...d.dataObjects.map((o) => o.provenance),
    ];
    expect(all.every((p) => p.source === 'builtin'),
      'adapter olmayan bir kaynağı "öğrenilmiş" diye damgaladı').toBe(true);
  });

  it('🔒 şema sürümü sabit ve belge onu taşır', () => {
    expect(CDDL_SCHEMA_VERSION).toBe('caros.cddl.v1');
    expect(cddlDocumentFromLegacy({ documentId: 'x', oemProfiles: [] }).schemaVersion)
      .toBe(CDDL_SCHEMA_VERSION);
  });

  it('🔒 varyant/desen kimlikleri profil kimliğiyle ÖNEKLENİR (çakışma yok)', () => {
    const p = OEM_ECU_PROFILES[0]!;
    const v = ecuVariantFromOem(p.id, p.ecus[0]!);
    expect(v.id.startsWith(`${p.id}.`)).toBe(true);
    expect(variantPatternFromOem(p).id).toBe(`${p.id}.pattern`);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) CAROS LAB — CDDL ENVANTERI (zorunlu gozlemlenebilirlik)
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F3B · G) LAB envanteri', () => {
  it('KILIT: kaynak katmani ASLA firlatmaz ve gercek kayitlari okur', () => {
    expect(() => readCddlInventorySnapshot()).not.toThrow();
    const s = readCddlInventorySnapshot();
    expect(s.documentBuilt).toBe(true);
    expect(s.schemaVersion).toBe(CDDL_SCHEMA_VERSION);
    expect(s.legacyProfileCount).toBe(OEM_ECU_PROFILES.length);
  });

  it('KILIT: gercek belge DOGRULANIR ve hukum GECERLI', () => {
    const s = readCddlInventorySnapshot();
    expect(s.valid, (s.issues ?? []).map((i) => `${i.path}: ${i.detail}`).join(' · ')).toBe(true);
    expect(deriveCddlVerdict(s)).toBe('VALID');
  });

  it('KILIT: yalniz builtin kaynak — learned/byod SIFIR', () => {
    const s = readCddlInventorySnapshot();
    expect(s.sourceCounts?.learned ?? 0).toBe(0);
    expect(s.sourceCounts?.byod ?? 0).toBe(0);
    expect((s.sourceCounts?.builtin ?? 0)).toBeGreaterThan(0);
  });

  it('KILIT: learned/byod gorulurse hukum UYARIYA duser (PASS degil)', () => {
    const s = readCddlInventorySnapshot();
    expect(deriveCddlVerdict({ ...s, sourceCounts: { builtin: 5, learned: 1 } }))
      .toBe('UNTRUSTED_SOURCE_PRESENT');
  });

  it('KILIT: belge kurulamazsa sayaclar 0 DEGIL KAYNAK YOK', () => {
    const v = buildCddlInventoryView({
      schemaVersion: null, documentBuilt: false, counts: null, valid: null,
      issues: null, sourceCounts: null, legacyProfileCount: null,
      productEligibleCount: null, serviceBytes: null,
    });
    expect(v.verdict).toBe('UNAVAILABLE');
    const inv = v.sections.find((x) => x.id === 'inventory')!;
    expect(inv.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
    expect(inv.fields.some((f) => f.value === '0')).toBe(false);
  });

  it('KILIT: yedi CDDL turu de envanterde GORUNUR', () => {
    const v = buildCddlInventoryView(readCddlInventorySnapshot());
    const labels = v.sections.find((x) => x.id === 'inventory')!.fields.map((f) => f.label);
    for (const kind of ['ServiceDef', 'EcuVariant', 'VariantPattern',
      'DataObjectProp', 'ComParam', 'ProcedureDef', 'DtcCatalogEntry']) {
      expect(labels, kind).toContain(kind);
    }
  });

  it('KILIT: urun kapisinin GEVSEMEDIGI ekranda gorunur', () => {
    const v = buildCddlInventoryView(readCddlInventorySnapshot());
    const f = v.sections.find((x) => x.id === 'legacy')!
      .fields.find((x) => x.id === 'legacy-product')!;
    expect(f.value).toBe('0');
    expect(f.note).toMatch(/GEVSETMEZ|GEVŞETMEZ/);
  });

  it('KILIT: ekran TIMER kurmaz, profil yuklemez, prosedur calistirmaz', () => {
    const src = stripComments(readFileSync(
      resolve(__dirname, '../components/devtools/screens/CddlInventoryScreen.tsx'), 'utf8'));
    expect(src).not.toMatch(/setInterval|setTimeout|addListener|subscribe\(/);
    expect(src).not.toMatch(/CarLauncher|executeProcedure|runProcedure|importProfile/);
    expect(src).toMatch(/mountedRef\.current = false/);
  });

  it('KILIT: katalogda AVAILABLE ve sinirlari beyan edilmis', () => {
    const e = getCarosLabTool('cddl-inventory');
    expect(e).not.toBeNull();
    expect(e!.status).toBe('AVAILABLE');
    expect(e!.note).toMatch(/PROFIL SISTEMI SILINMEDI|PROFİL SİSTEMİ SİLİNMEDİ/);
    expect(e!.note).toMatch(/yurutucu YAZILMADI|yürütücü YAZILMADI/);
  });
});
