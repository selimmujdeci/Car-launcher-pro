/**
 * cddl/legacyAdapter — P0-VDK-F3B · MEVCUT PROFİLLERİ CDDL OLARAK OKUR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ CÜMLE ───────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * **HİÇBİR MEVCUT PROFİL SİSTEMİ SİLİNMEDİ, TAŞINMADI YA DA DEĞİŞTİRİLMEDİ.**
 *
 * `oemEcuProfile` · `oemProfileMatch` · `oemProfileRegistry` ·
 * `vehicleDidProfile` · `protocolProfile` OTORİTE OLARAK KALIR ve ürün yolu
 * onları kullanmaya DEVAM EDER. Bu dosya tek yönlü bir OKUMA köprüsüdür:
 * mevcut veriyi CDDL sözleşmesinde ifade eder.
 *
 * Neden böyle: çalışan ve sahada doğrulanmış bir profil sistemini yeni bir
 * katman uğruna taşımak, kanıtlanmış davranışı kanıtlanmamışla değiştirmektir.
 * CDDL önce OKUMA tarafında kanıtlanır; yazma tarafı (yeni araç tanımının
 * yalnız CDDL'e eklenmesi) ayrı ve ölçülmüş bir adımdır.
 *
 * ── TEK YÖN ───────────────────────────────────────────────────────────────
 * Bu dosya CDDL → legacy dönüşümü YAPMAZ. Ters yön, iki otorite arasında
 * senkron tutma zorunluluğu doğururdu ve biri sessizce eskirdi.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

import type {
  OemAddressing, OemDiagSession, OemEcuEntry, OemEcuProfile, OemProvenance,
  OemReadService,
} from '../oem/oemEcuProfile';
import type { VehicleDidProfile } from '../vehicleDidProfile';
import type { ProtocolTimeoutProfile } from '../protocolProfile';
import {
  CDDL_SCHEMA_VERSION,
  type CddlAddressing, type CddlDocument, type CddlProvenance, type CddlSession,
  type ComParam, type DataObjectProp, type EcuVariant, type ProtocolClassName,
  type ServiceDef, type VariantEvidence, type VariantPattern,
} from './schema';

/* ══════════════════════════════════════════════════════════════════════════
   1) KAYNAK KÜNYESİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `OemProvenance` → `CddlProvenance`.
 *
 * Mevcut profiller ÜRÜNLE GELİR ve incelenmiştir → `builtin`. `learned`/`byod`
 * bu köprüden ASLA çıkmaz: bu turda öğrenilmiş tanım YOKTUR ve olmayan bir
 * şeyi "öğrenilmiş" diye damgalamak kanıt uydurmaktır.
 */
function provenanceFrom(p: OemProvenance, verifiedOn: string | null): CddlProvenance {
  return {
    source: 'builtin',
    reference: `${p.kind}: ${p.source}`,
    license: p.license,
    verifiedOn,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SERVİS TANIMLARI — mevcut beyaz listeden türetilir
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `OemReadService` beyaz listesinin CDDL karşılıkları.
 *
 * ⚠️ Bu tablo mevcut `READ_SERVICES` kümesiyle BİREBİR aynı olmalıdır ve
 * testle kilitlenir — iki yerde tutulan bir izin listesi, birinin
 * güncellenmeden kalması demektir. Hepsi `read_only`dir; `oemEcuProfile`
 * doğrulayıcısı zaten yazma servislerini profile SOKMAZ.
 */
const READ_SERVICE_DEFS: Readonly<Record<OemReadService, {
  readonly id: string; readonly name: string;
  readonly subFunction: string | null;
  readonly argKind: ServiceDef['argKind'];
  readonly literalPayload: string;
  readonly protocols: readonly ProtocolClassName[];
  /** Bkz. `ServiceDef.responseEchoBytes` — mevcut native önekleriyle BİREBİR. */
  readonly echo: number;
}>> = {
  '01': { id: 'obd_live_data', name: 'Canlı veri (Mode 01)', subFunction: null, argKind: 'data_identifier', literalPayload: '', protocols: [] , echo: 1 },
  '03': { id: 'obd_stored_dtc', name: 'Saklı DTC (Mode 03)', subFunction: null, argKind: 'literal', literalPayload: '', protocols: [] , echo: 0 },
  '06': { id: 'obd_monitor_results', name: 'Monitör test sonuçları (Mode 06)', subFunction: null, argKind: 'data_identifier', literalPayload: '', protocols: [] , echo: 1 },
  '07': { id: 'obd_pending_dtc', name: 'Bekleyen DTC (Mode 07)', subFunction: null, argKind: 'literal', literalPayload: '', protocols: [] , echo: 0 },
  '09': { id: 'obd_vehicle_info', name: 'Araç bilgisi (Mode 09)', subFunction: null, argKind: 'data_identifier', literalPayload: '', protocols: [] , echo: 1 },
  '0A': { id: 'obd_permanent_dtc', name: 'Kalıcı DTC (Mode 0A)', subFunction: null, argKind: 'literal', literalPayload: '', protocols: [] , echo: 0 },
  '18': { id: 'kwp_read_dtc_by_status', name: 'KWP DTC oku (0x18)', subFunction: '18', argKind: 'literal', literalPayload: '00FF00', protocols: ['kwp', 'iso9141'] , echo: 0 },
  '19': { id: 'uds_read_dtc_information', name: 'UDS DTC oku (0x19)', subFunction: '02', argKind: 'status_mask', literalPayload: 'FF', protocols: ['can'] , echo: 1 },
  '21': { id: 'kwp_read_data_by_local_id', name: 'KWP yerel veri oku (0x21)', subFunction: null, argKind: 'data_identifier', literalPayload: '', protocols: ['kwp', 'iso9141'] , echo: 1 },
  '22': { id: 'uds_read_data_by_identifier', name: 'UDS veri oku (0x22)', subFunction: null, argKind: 'data_identifier', literalPayload: '', protocols: ['can'] , echo: 2 },
};

const STANDARD_PROVENANCE: CddlProvenance = Object.freeze({
  source: 'builtin' as const,
  reference: 'iso_standard: ISO 14229-1 / ISO 14230-3 / SAE J1979',
  license: 'Standart referansı — metin kopyalanmadı',
  verifiedOn: null,
});

/** Beyaz listedeki servis kimliğinin CDDL `ServiceDef.id` karşılığı. */
export function serviceDefIdFor(service: OemReadService): string {
  return READ_SERVICE_DEFS[service].id;
}

/**
 * P0-VDK-F4A — SALT VERİ İLE EKLENEN SALT-OKUNUR SERVİSLER.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU TABLONUN VAR OLMA SEBEBİ, F4A'NIN KABUL ÖLÇÜTÜDÜR ──────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `READ_SERVICE_DEFS` servis BAYTINA göre anahtarlıdır; aynı servisin farklı
 * alt fonksiyonları oraya sığmaz. Bu tablo onları taşır ve **tek işlevi bir
 * iddiayı kanıtlamaktır**: yeni bir salt-okunur servis eklemek için
 *
 *   · yeni bir `CarLauncher` metodu YAZILMADI,
 *   · `ElmProtocol`/`OBDManager`de yeni bir dal AÇILMADI,
 *   · `pduTransport`/`genericPduTransport` DEĞİŞTİRİLMEDİ,
 *   · yalnız AŞAĞIYA BİR SATIR EKLENDİ.
 *
 * Eklenen her satır native `DiagnosticServiceGate` kapısından geçmek
 * ZORUNDADIR; bu tablo bir izin listesi DEĞİLDİR, bir tanım listesidir.
 */
const EXTRA_READ_SERVICE_DEFS: readonly {
  readonly id: string; readonly name: string;
  readonly service: string; readonly subFunction: string | null;
  readonly argKind: ServiceDef['argKind'];
  readonly literalPayload: string;
  readonly protocols: readonly ProtocolClassName[];
  readonly echo: number;
}[] = Object.freeze([
  {
    /* GÖREVİN ADIYLA İSTEDİĞİ TANIM: `uds_report_supported_dtc = 190A`.
       Olumlu yanıt `59 0A …` → yankı 1 bayttır (alt fonksiyon). */
    id: 'uds_report_supported_dtc', name: 'UDS desteklenen DTC listesi (0x19-0A)',
    service: '19', subFunction: '0A', argKind: 'literal', literalPayload: '',
    protocols: ['can'], echo: 1,
  },
  {
    /* Var olan native 0x13 yolunun CDDL karşılığı; olumlu yanıt `53 …`. */
    id: 'kwp_read_dtc_13', name: 'KWP DTC oku — eski nesil (0x13)',
    service: '13', subFunction: null, argKind: 'literal', literalPayload: '',
    protocols: ['kwp', 'iso9141'], echo: 0,
  },
  {
    /* KWP ECU kimliği; olumlu yanıt `5A <LID>` → yankı 1 bayt. */
    id: 'kwp_read_ecu_identification', name: 'KWP ECU kimliği (0x1A)',
    service: '1A', subFunction: null, argKind: 'data_identifier', literalPayload: '',
    protocols: ['kwp', 'iso9141'], echo: 1,
  },
]);

/** Salt veri ile eklenen salt-okunur servislerin `ServiceDef` karşılığı. */
export function extraReadOnlyServiceDefs(): readonly ServiceDef[] {
  return EXTRA_READ_SERVICE_DEFS.map((d) => ({
    id: d.id,
    service: d.service,
    subFunction: d.subFunction,
    name: d.name,
    effect: 'read_only' as const,
    argKind: d.argKind,
    literalPayload: d.literalPayload,
    protocols: d.protocols,
    responseEchoBytes: d.echo,
    provenance: STANDARD_PROVENANCE,
  }));
}

/** Mevcut okuma servisi beyaz listesinin TAMAMINI `ServiceDef` olarak verir. */
export function builtinServiceDefs(): readonly ServiceDef[] {
  return (Object.keys(READ_SERVICE_DEFS) as OemReadService[]).map((svc) => {
    const d = READ_SERVICE_DEFS[svc];
    return {
      id: d.id,
      service: svc,
      subFunction: d.subFunction,
      name: d.name,
      effect: 'read_only' as const,
      argKind: d.argKind,
      literalPayload: d.literalPayload,
      protocols: d.protocols,
      responseEchoBytes: d.echo,
      provenance: STANDARD_PROVENANCE,
    };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ECU VARYANTI
   ══════════════════════════════════════════════════════════════════════════ */

function addressingFrom(a: OemAddressing): CddlAddressing {
  return a === 'can11' ? 'can11' : a === 'can29' ? 'can29' : 'kwp';
}

function sessionFrom(s: OemDiagSession): CddlSession { return s; }

/**
 * `OemEcuEntry` → `EcuVariant`.
 *
 * ⚠️ `tx: ''` (varsayılan oturum adreslemesi) `functional` adreslemeye
 * çevrilir — native header'a HİÇ dokunulmayan mevcut davranışın CDDL
 * karşılığı budur. Uydurma bir adres ÜRETİLMEZ.
 */
export function ecuVariantFromOem(
  profileId: string, e: OemEcuEntry,
): EcuVariant {
  const functionalAddressing = e.tx.length === 0;
  return {
    id: `${profileId}.${e.ecuId}`,
    name: e.name,
    role: e.role,
    addressing: functionalAddressing ? 'functional' : addressingFrom(e.addressing),
    txHeader: e.tx,
    rxHeader: e.rx,
    kwpTarget: e.kwpTarget,
    session: sessionFrom(e.session),
    serviceRefs: e.readServices.map(serviceDefIdFor),
    provenance: provenanceFrom(e.provenance, e.verifiedOn),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) VARYANT DESENİ — KANIT ZORUNLU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `OemVehicleMatch` → `VariantPattern`.
 *
 * Kanıt YALNIZ ölçülebilir işaretlerden kurulur: VIN WMI (üreticinin tek
 * kanıtlanabilir imzası) ve varsa VDS deseni. **Adresten rol türetilmez** —
 * `ecu_responded`/`did_response` kanıtları ancak GERÇEK ölçüm varsa eklenir
 * ve mevcut profil sisteminde böyle bir ölçüm alanı YOKTUR, bu yüzden
 * buradan ÜRETİLMEZ.
 */
export function variantPatternFromOem(p: OemEcuProfile): VariantPattern {
  const evidence: VariantEvidence[] = [
    { kind: 'vin_wmi', selector: p.vehicle.wmi.join(','), expect: null },
  ];
  if (p.vehicle.vdsPattern !== null) {
    evidence.push({ kind: 'vin_vds', selector: p.vehicle.vdsPattern, expect: null });
  }
  return {
    id: `${p.id}.pattern`,
    manufacturer: p.vehicle.manufacturer,
    modelFamily: p.vehicle.modelFamily,
    protocols: p.vehicle.protocols,
    evidence,
    variantRefs: p.ecus.map((e) => `${p.id}.${e.ecuId}`),
    provenance: provenanceFrom(p.provenance, null),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) VERİ NESNELERİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * OEM profilindeki DID KİMLİKLERİNİ `DataObjectProp` olarak verir.
 *
 * ⚠️ `OemDataIdentifier` bir KİMLİKTİR, formül TAŞIMAZ (bu bilinçli bir
 * `oemEcuProfile` kuralıdır). Bu yüzden çözüm alanı `fn: 'A'` ile en
 * muhafazakâr biçimde doldurulur ve `min/max` **ölçülmediği için** `0` yerine
 * bilinçli olarak `Number.NaN` DEĞİL, sıfır aralık verilir — bu tanımlar
 * ürün yolunda okunmaz, yalnız envanterdir.
 */
export function dataObjectsFromOem(
  profileId: string, e: OemEcuEntry,
): readonly DataObjectProp[] {
  return e.dids.map((d) => ({
    id: `${profileId}.${e.ecuId}.${d.id}`,
    identifier: d.id,
    serviceRef: serviceDefIdFor(d.service),
    ecuRef: `${profileId}.${e.ecuId}`,
    name: d.name,
    unit: '',
    byteLength: 0,
    min: 0,
    max: 0,
    category: 'oem',
    decode: { fn: 'A', a: null, b: null },
    provenance: provenanceFrom(e.provenance, d.verifiedOn),
  }));
}

/**
 * `VehicleDidProfile` → `DataObjectProp[]`.
 *
 * Burada çözüm formülü GERÇEKTEN vardır (`vehicleDidProfile` onu taşır) ve
 * aynen aktarılır — ikinci bir çözüm sözlüğü TANIMLANMAZ.
 */
export function dataObjectsFromDidProfile(
  profile: VehicleDidProfile, profileId: string,
): readonly DataObjectProp[] {
  return profile.dids.map((d) => ({
    id: `${profileId}.${d.ecu}.${d.did}`,
    identifier: d.did,
    serviceRef: serviceDefIdFor((d.service ?? '22') as OemReadService),
    ecuRef: `${profileId}.${d.ecu}`,
    name: d.name,
    unit: d.unit,
    byteLength: d.bytes,
    min: d.min,
    max: d.max,
    category: d.category,
    decode: {
      fn: d.decode.fn,
      a: d.decode.a ?? null,
      b: d.decode.b ?? null,
    },
    provenance: {
      source: 'builtin',
      reference: profile.source,
      license: 'Kamu doküman referansı',
      verifiedOn: null,
    },
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   6) İLETİŞİM PARAMETRELERİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * `ProtocolTimeoutProfile` → `ComParam[]`.
 *
 * ⚠️ **YALNIZ TEMSİL.** Bu kayıtları değiştirmek hiçbir runtime davranışını
 * değiştirmez; otorite `protocolProfile`dedir ve `authority` alanı bunu
 * açıkça söyler. Zaman aşımı otoritesini veriye devretmek ayrı bir fazın işidir.
 */
export function comParamsFromProtocolProfile(
  protocolClass: ProtocolClassName, p: ProtocolTimeoutProfile,
): readonly ComParam[] {
  const mk = (id: string, name: string, valueMs: number): ComParam => ({
    id: `${protocolClass}.${id}`,
    name,
    protocol: protocolClass,
    valueMs,
    authority: 'obd/protocolProfile.getProtocolProfile',
    provenance: STANDARD_PROVENANCE,
  });
  return [
    mk('connectTimeout', 'Bağlantı üst sınırı', p.connectTimeoutMs),
    mk('dataGateTimeout', 'İlk veri bekleme', p.dataGateTimeoutMs),
    mk('staleThreshold', 'Bayatlık eşiği', p.staleThresholdMs),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   7) BELGE ÜRETİMİ
   ══════════════════════════════════════════════════════════════════════════ */

export interface LegacyBridgeInput {
  readonly documentId: string;
  readonly oemProfiles: readonly OemEcuProfile[];
  readonly didProfiles?: readonly { readonly profile: VehicleDidProfile; readonly id: string }[];
  readonly comParams?: readonly ComParam[];
}

/**
 * Mevcut profilleri TEK bir CDDL belgesinde toplar.
 *
 * Üretilen belge `validateCddlDocument` ile doğrulanabilir olmalıdır —
 * yani köprü, mevcut verinin CDDL kurallarına UYDUĞUNU da kanıtlar. Uymayan
 * bir legacy kayıt varsa bu bir CDDL kusuru değil, o kaydın eksikliğidir ve
 * doğrulayıcı onu adıyla söyler.
 */
export function cddlDocumentFromLegacy(input: LegacyBridgeInput): CddlDocument {
  const variants: EcuVariant[] = [];
  const patterns: VariantPattern[] = [];
  const dataObjects: DataObjectProp[] = [];

  for (const p of input.oemProfiles) {
    patterns.push(variantPatternFromOem(p));
    for (const e of p.ecus) {
      variants.push(ecuVariantFromOem(p.id, e));
      dataObjects.push(...dataObjectsFromOem(p.id, e));
    }
  }

  for (const d of input.didProfiles ?? []) {
    dataObjects.push(...dataObjectsFromDidProfile(d.profile, d.id));
  }

  return {
    schemaVersion: CDDL_SCHEMA_VERSION,
    id: input.documentId,
    services: builtinServiceDefs(),
    variants,
    patterns,
    dataObjects,
    comParams: input.comParams ?? [],
    /* Prosedür bildirimi bu turda legacy'den TÜRETİLMEZ: mevcut sistemde
       çok adımlı akışlar TypeScript fonksiyonlarındadır ve onları veriye
       çevirmek yürütücü olmadan doğrulanamaz. */
    procedures: [],
    dtcCatalog: [],
  };
}
