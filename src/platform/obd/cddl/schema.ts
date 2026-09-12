/**
 * cddl/schema — P0-VDK-F3B · CAROS DIAGNOSTIC DEFINITION LAYER v1 (SÖZLEŞME).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Bugün tanı bilgisi BEŞ AYRI yerde, BEŞ AYRI biçimde duruyor:
 *
 *   `oem/oemEcuProfile`      → ECU adresi · rol · oturum · okuma servisleri · DID kimliği
 *   `oem/oemProfileMatch`    → araç ↔ profil eşleşmesi (VIN WMI/VDS)
 *   `vehicleDidProfile`      → DID tanımı + çözüm formülü
 *   `protocolProfile`        → protokol sınıfı + zaman aşımı bütçeleri
 *   `data/dtcExtendedCatalog`→ DTC açıklamaları
 *
 * Her biri kendi sorusunu doğru yanıtlıyor ama **"bu araçta bu ECU'ya hangi
 * servisi nasıl sorarım"** sorusunu hiçbiri tek başına yanıtlayamıyor. Yeni
 * bir araç/ECU eklemek bugün BEŞ dosyaya dokunmayı gerektiriyor — yani
 * **veri eklemek bir KOD değişikliği.**
 *
 * CDDL bu beşini TEK sözleşmede birleştirir. Mevcut sistemler SİLİNMEZ:
 * `legacyAdapter` onları CDDL olarak okunabilir kılar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ PROFİL MOTORU DEĞİLDİR.** `matchOemProfile` · `mergeOemProfileEcus`
 *     · `compileVehicleDidProfile` OTORİTE OLARAK KALIR. CDDL onların ÜSTÜNE
 *     geçmez; okuma sözleşmesi sunar.
 * (2) **ÇALIŞTIRMAZ.** `ProcedureDef` bu turda YALNIZ bildirimdir — executor
 *     YAZILMADI ve yazılmayacağı testle kilitlenir.
 * (3) **RUNTIME AYARI DEĞİŞTİRMEZ.** `ComParam` zaman aşımlarını VERİ olarak
 *     temsil eder; `protocolProfile`/`obdService` otoriteleri DEĞİŞMEZ.
 * (4) **ÖĞRENMEZ.** Discovery · Learning · Self-Healing bu turun DIŞINDADIR.
 * (5) **TELİFLİ VERİ İÇERMEZ.** BYOD içe aktarımı YAZILMADI; yalnız kaynak
 *     güven sınıfı modelde tanımlıdır.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok.
 */

import type { EcuRole } from '../ecuRoleModel';

/* ══════════════════════════════════════════════════════════════════════════
   1) ŞEMA SÜRÜMÜ — fail-closed
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Şema sürümü. **BİLİNMEYEN SÜRÜM REDDEDİLİR** (`traceExport` ile aynı ilke):
 * tanımadığımız bir şemayı kabul etmek, alan anlamlarını TAHMİN etmektir.
 */
export const CDDL_SCHEMA_VERSION = 'caros.cddl.v1';

/* ══════════════════════════════════════════════════════════════════════════
   2) KAYNAK GÜVEN SINIFLARI
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Tanımın NEREDEN geldiği — güven sınıfı.
 *
 * ⚠️ BU TURDA YALNIZ `builtin` ÜRÜN YOLUNA GİRER. `learned` ve `byod` modelde
 * BUGÜNDEN tanımlıdır çünkü sonradan eklenen bir güven sınıfı, önceden
 * yazılmış tüm kayıtların güvenini belirsiz bırakırdı. Ama ikisi de ürün
 * yoluna YAZILMAZ ve bu `isProductTrusted` ile kilitlenir.
 */
export type CddlSource =
  /** Ürünle gelen, incelenmiş, lisansı doğrulanmış tanım. */
  | 'builtin'
  /** Araçtan ÖLÇÜLEREK türetilmiş tanım (Discovery/Learning — F4). */
  | 'learned'
  /** Kullanıcı/servis tarafından içe aktarılmış tanım (BYOD — F4). */
  | 'byod';

export const CDDL_SOURCE_LABEL: Readonly<Record<CddlSource, string>> = {
  builtin: 'ürünle gelen (incelenmiş)',
  learned: 'araçtan ÖLÇÜLEREK öğrenilmiş — ürün yoluna GİRMEZ (F4)',
  byod:    'dışarıdan içe aktarılmış — ürün yoluna GİRMEZ (F4)',
} as const;

/**
 * Bu kaynak ÜRÜN yolunda kullanılabilir mi.
 *
 * Fail-closed: yalnız `builtin`. `learned`/`byod` bugün gözlem ve gelecek
 * planı içindir; ürün kararına girmeleri ayrı bir fazın (ve ayrı bir
 * doğrulama zincirinin) işidir.
 */
export function isProductTrusted(source: CddlSource): boolean {
  return source === 'builtin';
}

/** Doğrulanabilir kaynak künyesi — `oemEcuProfile.OemProvenance` ile aynı dil. */
export interface CddlProvenance {
  readonly source: CddlSource;
  /** Standart/belge/gözlem referansı — boş OLAMAZ. */
  readonly reference: string;
  /** Ticari satış kuralı (CLAUDE.md): lisans AÇIKÇA yazılır. */
  readonly license: string;
  /** Gerçek araçta doğrulandığı tarih; doğrulanmadıysa `null` (uydurulmaz). */
  readonly verifiedOn: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ServiceDef — SERVİS TANIMI (PDU ÜRETİR, TAŞIMA BİLMEZ)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Servisin ürün üzerindeki ETKİ SINIFI.
 *
 * `destructive` varsayılan olarak REDDEDİLİR: bir tanımın "bu servis
 * güvenlidir" demesi yetmez; yazma/aktüatör/reset yolları ayrı bir Safety
 * Kernel'in işidir ve bu turda AÇILMAMIŞTIR.
 */
export type ServiceEffect = 'read_only' | 'session' | 'destructive';

export const SERVICE_EFFECT_LABEL: Readonly<Record<ServiceEffect, string>> = {
  read_only:   'salt okuma — ECU’ya yazmaz',
  session:     'oturum yönetimi — veri yazmaz',
  destructive: 'YAZMA/AKTÜATÖR — varsayılan REDDEDİLİR',
} as const;

/** Servis argümanının nasıl kodlanacağı — hepsi HAM HEX üretir. */
export type ServiceArgKind =
  /** Sabit gövde (tanımda yazılı). */
  | 'literal'
  /** Çağıranın verdiği DID/LID kimliği (`22 F190` · `21 80`). */
  | 'data_identifier'
  /** Durum maskesi (`19 02 FF`). */
  | 'status_mask'
  /** Kayıt kimliği + maske (`19 06 <dtc> FF`). */
  | 'dtc_record';

/**
 * SERVİS TANIMI.
 *
 * ⚠️ **TAŞIMA BİLMEZ.** Bu tanım `CarLauncher`, ELM327, DoIP ya da herhangi
 * bir köprüden habersizdir; ürettiği tek şey F3-A `DiagnosticPdu`sudur.
 * Taşımanın onu gönderip gönderemeyeceği `pduTransport`ın sorunudur.
 */
export interface ServiceDef {
  /** Kararlı kimlik (`uds_read_dtc_by_status` gibi kebab/snake). */
  readonly id: string;
  /** Servis baytı, 2 hane hex (`19` · `22` · `03`). */
  readonly service: string;
  /** Sabit alt fonksiyon; servisin alt fonksiyonu yoksa `null`. */
  readonly subFunction: string | null;
  readonly name: string;
  readonly effect: ServiceEffect;
  readonly argKind: ServiceArgKind;
  /** `argKind: 'literal'` için sabit gövde; diğerlerinde `''`. */
  readonly literalPayload: string;
  /** Bu servisin geçerli olduğu protokol sınıfları; boş = kısıt yok. */
  readonly protocols: readonly ProtocolClassName[];
  /**
   * P0-VDK-F4A — YANITTA YANKILANAN İSTEK BAYTI SAYISI.
   *
   * Genel PDU köprüsü servis kimliğine göre DAL SEÇMEZ; olumlu yanıt öneki
   * `SID + 0x40` evrensel kuralından üretilir ve kaç baytın yankılandığı
   * **burada VERİ olarak** durur (`19-02` → 1 · `18` → 0 · `22` → 2).
   *
   * Bu alanın CDDL'de olması, F4A'nın kabul ölçütünün ta kendisidir:
   * yeni bir salt-okunur servis eklemek yalnız TANIM eklemektir.
   */
  readonly responseEchoBytes: number;
  readonly provenance: CddlProvenance;
}

export type ProtocolClassName = 'can' | 'kwp' | 'iso9141' | 'j1850';

/* ══════════════════════════════════════════════════════════════════════════
   4) DataObjectProp — VERİ NESNESİ
   ══════════════════════════════════════════════════════════════════════════ */

/** Çözüm biçimi — `vehicleDidProfile.DidDecodeFn` ile BİREBİR aynı sözlük. */
export type DopDecodeFn = 'A' | 'AB' | 'temp40' | 'pct' | 'linear' | 'div' | 'ascii';

export interface DopDecode {
  readonly fn: DopDecodeFn;
  readonly a: number | null;
  readonly b: number | null;
}

/**
 * VERİ NESNESİ TANIMI (DID/LID + çözüm).
 *
 * `vehicleDidProfile.VehicleDidDef`in CDDL karşılığıdır; o dosya OTORİTE
 * olarak kalır ve `legacyAdapter` ile buraya OKUNUR.
 */
export interface DataObjectProp {
  readonly id: string;
  /** Servis 22 → 4 hane; servis 21 → 2 hane. */
  readonly identifier: string;
  /** Bu veriyi okuyan `ServiceDef.id`. */
  readonly serviceRef: string;
  /** Hangi `EcuVariant.id` üzerinde okunur. */
  readonly ecuRef: string;
  readonly name: string;
  readonly unit: string;
  readonly byteLength: number;
  readonly min: number;
  readonly max: number;
  readonly category: string;
  readonly decode: DopDecode;
  readonly provenance: CddlProvenance;
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ComParam — İLETİŞİM PARAMETRELERİ (VERİ; RUNTIME'I DEĞİŞTİRMEZ)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * İLETİŞİM PARAMETRESİ.
 *
 * ⚠️ **BU TURDA YALNIZ TEMSİLDİR.** Değerler `protocolProfile` ve
 * `diagnosticSessionLease` gibi MEVCUT otoritelerden OKUNUR; hiçbir runtime
 * davranışı buradan SÜRÜLMEZ. Bir `ComParam` değiştirmek bugün hiçbir şeyi
 * değiştirmez ve bu bilinçlidir: zaman aşımı otoritesini veriye devretmek
 * ayrı bir fazın (ve ayrı bir saha doğrulamasının) işidir.
 */
export interface ComParam {
  readonly id: string;
  readonly name: string;
  /** Uygulandığı protokol sınıfı; `null` = tüm sınıflar. */
  readonly protocol: ProtocolClassName | null;
  readonly valueMs: number;
  /** Değerin ÖLÇÜLDÜĞÜ/tanımlandığı mevcut otorite — izlenebilirlik. */
  readonly authority: string;
  readonly provenance: CddlProvenance;
}

/* ══════════════════════════════════════════════════════════════════════════
   6) EcuVariant + VariantPattern
   ══════════════════════════════════════════════════════════════════════════ */

/** Adresleme kipi — `pdu.PduAddressing` ile hizalı (`unknown` YOK: fail-closed). */
export type CddlAddressing = 'functional' | 'can11' | 'can29' | 'kwp';

/**
 * Tanı oturumu — `oemEcuProfile.OemDiagSession` ile AYNI sözlük.
 * `UNKNOWN` bir ÖLÇÜM sonucudur, varsayım değil.
 */
export type CddlSession =
  | 'default' | 'uds_extended_1003' | 'kwp_standard_1081' | 'kwp_extended_10C0' | 'UNKNOWN';

/**
 * ECU VARYANTI — bir araçtaki BİR ECU'nun tanımı.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── `role: 'unknown'` — BELGEDE YASAK, ÖLÇÜMDE SERBEST (P0-VDK-F6A) ───────
 * ══════════════════════════════════════════════════════════════════════════
 * Kural DEĞİŞMEDİ, yalnız DOĞRU KATMANDA uygulanıyor:
 *
 *  · **BELGE** (`CddlDocument` içindeki profil tanımı) rolsüz adres
 *    TANIMLAYAMAZ — bunu `cddl/validate` `ROLE_UNKNOWN_FORBIDDEN` ile
 *    reddeder ve o kapı OLDUĞU GİBİ DURUYOR. "Rolü bilinmeyen bir adres
 *    profile değil, keşfe aittir" cümlesi hâlâ geçerlidir.
 *
 *  · **ÖLÇÜM** (keşfin bulduğu canlı uç nokta) rolsüz OLABİLİR ve bu
 *    ölçülmüş bir gerçektir. Tip düzeyinde yasaklamak, rolü henüz
 *    çözülmemiş bir uç noktanın F4-B keşfine ve F4-C öğrenmesine
 *    GİREMEMESİ demekti — ürünün "yalnız motor ECU'sunu tanıyor" olmasının
 *    yapısal sebebi tam olarak buydu (görev §5/§11).
 *
 * Bu alan taşımadadır KULLANILMAZ: `buildPduFromServiceDef` · `pdu` ·
 * `cddlPduRead` · `serviceDiscoveryRuntime` `role`u OKUMAZ, dolayısıyla
 * gevşetme hatta çıkan hiçbir baytı DEĞİŞTİRMEZ.
 */
export interface EcuVariant {
  readonly id: string;
  readonly name: string;
  readonly role: EcuRole;
  readonly addressing: CddlAddressing;
  /** İstek adresi; `''` = varsayılan oturum adreslemesi (native header'a dokunmaz). */
  readonly txHeader: string;
  readonly rxHeader: string;
  /** KWP hedef baytı; CAN'de `null`, bilinmiyorsa `'UNKNOWN'` (uydurulmaz). */
  readonly kwpTarget: string | 'UNKNOWN' | null;
  readonly session: CddlSession;
  /** Bu ECU'da kullanılabilir `ServiceDef.id` listesi. */
  readonly serviceRefs: readonly string[];
  readonly provenance: CddlProvenance;
}

/**
 * Bir varyantın araca UYUP UYMADIĞINI ölçen kanıt türü.
 *
 * ⚠️ **ADRESTEN ROL UYDURULMAZ.** Bir ECU'nun 7E0'da olması onun motor ECU'su
 * OLDUĞUNU KANITLAMAZ — bu ürünün defalarca ödediği kusur sınıfıdır. Bu
 * yüzden eşleşme yalnız ÖLÇÜLMÜŞ kanıtla kurulur.
 */
export type VariantEvidenceKind =
  /** VIN'in ilk 3 hanesi (WMI) — üreticinin tek kanıtlanabilir işareti. */
  | 'vin_wmi'
  /** VIN 4-9 (VDS) desen eşleşmesi — model ayrımı. */
  | 'vin_vds'
  /** Bir DID'in ÖLÇÜLMÜŞ yanıtı belirtilen desene uyuyor. */
  | 'did_response'
  /** Belirtilen ECU adresi fonksiyonel taramada CEVAP VERDİ. */
  | 'ecu_responded';

export const VARIANT_EVIDENCE_LABEL: Readonly<Record<VariantEvidenceKind, string>> = {
  vin_wmi:       'VIN üretici kodu (WMI)',
  vin_vds:       'VIN model deseni (VDS)',
  did_response:  'ÖLÇÜLMÜŞ DID yanıtı',
  ecu_responded: 'ECU taramada CEVAP VERDİ',
} as const;

export interface VariantEvidence {
  readonly kind: VariantEvidenceKind;
  /** WMI listesi · VDS regex kaynağı · DID kimliği · ECU tx adresi. */
  readonly selector: string;
  /**
   * `did_response` için beklenen yanıt deseni (regex kaynağı).
   * Diğer türlerde `null` — ölçüm zaten "cevap verdi mi" sorusudur.
   */
  readonly expect: string | null;
}

/**
 * VARYANT DESENİ — hangi araçta hangi ECU varyantları geçerli.
 *
 * Eşleşme `matchOemProfile` OTORİTESİNİ EZMEZ; onun ürettiği sonucu CDDL
 * diline çevirmek için vardır (bkz. `legacyAdapter`).
 */
export interface VariantPattern {
  readonly id: string;
  readonly manufacturer: string;
  /** Ayırt edilemiyorsa `'UNKNOWN'`. */
  readonly modelFamily: string;
  readonly protocols: readonly ProtocolClassName[];
  /** Eşleşme için gereken kanıtlar — BOŞ OLAMAZ (kanıtsız eşleşme YOK). */
  readonly evidence: readonly VariantEvidence[];
  /** Bu desen eşleşirse geçerli olan `EcuVariant.id` listesi. */
  readonly variantRefs: readonly string[];
  readonly provenance: CddlProvenance;
}

/* ══════════════════════════════════════════════════════════════════════════
   7) ProcedureDef — BİLDİRİM (ÇALIŞTIRICI YOK)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Prosedür adımı — bir `ServiceDef` çağrısının BİLDİRİMİ.
 *
 * ⚠️ Adımların hiçbiri BU TURDA çalıştırılmaz. `procedureDef` bir plan
 * DİLİDİR; onu yürütecek Procedure Engine ayrı bir fazın işidir ve
 * yazılmadığı testle kilitlenir.
 */
export interface ProcedureStep {
  readonly id: string;
  readonly serviceRef: string;
  /** Hedef `EcuVariant.id`. */
  readonly ecuRef: string;
  /** Servise verilecek argüman (DID kimliği · durum maskesi); yoksa `null`. */
  readonly argument: string | null;
  /** Adımın başarısız olması prosedürü DURDURUR mu. */
  readonly required: boolean;
}

export interface ProcedureDef {
  readonly id: string;
  readonly name: string;
  /**
   * Prosedürün ETKİ SINIFI. `destructive` bir prosedür TANIMLANABİLİR ama
   * doğrulayıcı onu ürün yolu için REDDEDER — bugün hiçbir yürütücü yoktur
   * ve olmayacağı da kilitlidir.
   */
  readonly effect: ServiceEffect;
  readonly steps: readonly ProcedureStep[];
  readonly provenance: CddlProvenance;
}

/* ══════════════════════════════════════════════════════════════════════════
   8) DtcCatalogEntry
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * DTC KATALOG KAYDI.
 *
 * `dtcDataSource.DtcCatalog` OTORİTE olarak kalır; bu tip onun CDDL
 * karşılığıdır ve **açıklama UYDURMAZ**: kaynağı olmayan bir kod katalogda
 * yer ALMAZ (mevcut `dtcExtendedCatalog` dürüstlük kuralı korundu).
 */
export interface DtcCatalogEntry {
  /** SAE J2012 künyesi (`P0301`). */
  readonly code: string;
  /** ISO 14229 alt kodu (FTB, `11`); yoksa `null`. */
  readonly failureType: string | null;
  readonly description: string;
  readonly system: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly provenance: CddlProvenance;
}

/* ══════════════════════════════════════════════════════════════════════════
   9) BELGE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * CDDL BELGESİ — tanımların taşınabilir kabı.
 *
 * `schemaVersion` bilinmiyorsa belge REDDEDİLİR; tanımadığımız alanlar da
 * reddedilir (`unknown field` fail-closed). "İleri uyumluluk" adına
 * tanımadığımız bir alanı yok saymak, anlamını TAHMİN etmektir.
 */
export interface CddlDocument {
  readonly schemaVersion: string;
  readonly id: string;
  readonly services: readonly ServiceDef[];
  readonly variants: readonly EcuVariant[];
  readonly patterns: readonly VariantPattern[];
  readonly dataObjects: readonly DataObjectProp[];
  readonly comParams: readonly ComParam[];
  readonly procedures: readonly ProcedureDef[];
  readonly dtcCatalog: readonly DtcCatalogEntry[];
}

/** Belge kabuğunun tanınan alanları — fazlası `UNKNOWN_FIELD` ile reddedilir. */
export const CDDL_DOCUMENT_FIELDS: readonly string[] = Object.freeze([
  'schemaVersion', 'id', 'services', 'variants', 'patterns',
  'dataObjects', 'comParams', 'procedures', 'dtcCatalog',
]);

/** Boş belge — "tanım yok" ile "belge okunamadı" ayrımı için. */
export const EMPTY_CDDL_DOCUMENT: CddlDocument = Object.freeze({
  schemaVersion: CDDL_SCHEMA_VERSION,
  id: 'empty',
  services: Object.freeze([]),
  variants: Object.freeze([]),
  patterns: Object.freeze([]),
  dataObjects: Object.freeze([]),
  comParams: Object.freeze([]),
  procedures: Object.freeze([]),
  dtcCatalog: Object.freeze([]),
});
