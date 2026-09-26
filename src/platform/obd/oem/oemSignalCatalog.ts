/**
 * oemSignalCatalog — OEM DISCOVERY FAZ 1 · ÜRETİCİ SİNYAL KATALOĞU (SAF VERİ + DOĞRULAYICI).
 *
 * ── NE İŞE YARAR ──────────────────────────────────────────────────────────
 * Bugün ürün bir üretici verisini YALNIZ ham kimliğiyle tanıyor: `vehicleDidProfile`
 * bir DID'e Türkçe ad + birim + çözücü veriyor ama KARARLI bir ANLAM kimliği YOK.
 * Yani "DPF kurum yükünü ver" diye soran bir tüketici (UI · Mavi · teşhis) markaya
 * özgü hex kimliği BİLMEK ZORUNDA. Bu katalog o boşluğu kapatır: her fiziksel kavramın
 * TEK kararlı kimliği (`OemSignalId`) burada tanımlanır, hex kimlik ise KANIT olduğunda
 * doldurulur.
 *
 * ── NE DEĞİLDİR (pazarlıksız) ─────────────────────────────────────────────
 *  · YENİ bir çözücü DSL'i DEĞİL — `vehicleDidProfile.DidDecodeSpec` AYNEN kullanılır
 *    ve derleme mevcut `compileVehicleDidProfile` ile yapılır (ikinci çözücü otoritesi YOK).
 *  · YENİ bir adres defteri DEĞİL — ECU adresi `oem/oemProfileRegistry` + `oemProfileMatch`
 *    otoritesinde KALIR; bu katalog yalnız ECU ROLÜNÜ (`engine`…) beyan eder.
 *  · Uydurma DID/PID deposu DEĞİL — kanıt yoksa `identifier: 'UNKNOWN'`. Kanıtsız kayıt
 *    `isOemSignalProbeable()` kapısından GEÇMEZ, yani araca TEK BAYT gönderilmez.
 *  · Yazma/aktüatör/güvenlik erişimi YOK — servis kümesi yalnız {'22','21'} (salt-okuma).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 */

import type { EcuRole } from '../ecuRoleModel';
import type { CanonicalObdKey } from '../canonicalObdSignals';
import type { DidDecodeSpec, CompiledDidDef, VehicleDidProfile } from '../vehicleDidProfile';
import { validateVehicleDidProfile, compileVehicleDidProfile } from '../vehicleDidProfile';
import type { OemProvenance, OemAddressing, OemDiagSession, OemProtocolClass } from './oemEcuProfile';
import { MIN_EVIDENCE_LEN } from './oemEcuProfile';
import { HARD_FORBIDDEN_SERVICES } from '../discovery/discoverySafetyPolicy';
import type { DidCandidate } from '../discovery/didCandidateProvider';

/* ══════════════════════════════════════════════════════════════════════════
 * 1) SÖZLEŞME
 * ════════════════════════════════════════════════════════════════════════ */

/** Kararlı anlam kimliği. Tüketici (UI/Mavi/teşhis) YALNIZ bunu bilir, hex kimliği ASLA. */
export type OemSignalId =
  // ── DPF ────────────────────────────────────────────────────────────────
  | 'DPF_SOOT_LOAD'
  | 'DPF_DIFFERENTIAL_PRESSURE'
  | 'DPF_INLET_TEMP'
  | 'DPF_OUTLET_TEMP'
  | 'DPF_REGEN_STATUS'
  | 'DPF_DISTANCE_SINCE_REGEN'
  // ── Turbo / dolgu ──────────────────────────────────────────────────────
  | 'TURBO_BOOST_PRESSURE'
  // ── Yakıt ──────────────────────────────────────────────────────────────
  | 'FUEL_RAIL_PRESSURE_OEM'
  | 'FUEL_TEMPERATURE_OEM'
  | 'INJECTION_QUANTITY'
  // ── Silindir düzeltmeleri ──────────────────────────────────────────────
  | 'CYLINDER_CORRECTION_CYL1'
  | 'CYLINDER_CORRECTION_CYL2'
  | 'CYLINDER_CORRECTION_CYL3'
  | 'CYLINDER_CORRECTION_CYL4';

/** Gruplama — LAB listesi ve ileride tüketici filtresi için. */
export type OemSignalGroup = 'dpf' | 'boost' | 'fuel' | 'injection';

/**
 * SALT-OKUMA veri servisleri. `'UNKNOWN'` = hangi servisle okunduğu ÖLÇÜLMEDİ.
 * Bu kümenin dışına (2E/31/27/11/04…) katalog KAPALIDIR — doğrulayıcı reddeder.
 */
export type OemSignalService = '22' | '21' | 'UNKNOWN';

/** İzin verilen veri-okuma servisleri (savunma derinliği — tek yerde). */
export const OEM_READ_DATA_SERVICES: ReadonlySet<string> = Object.freeze(new Set(['22', '21']));

/**
 * Sinyalin güven/provenance seviyesi — AUTHOR TARAFINDAN YAZILMAZ, alanlardan TÜRETİLİR
 * (`oemSignalConfidence`). Böylece "kanıt yokken güven yazma" ihlali yapısal olarak imkânsızdır.
 */
export type OemSignalConfidence =
  /** Hex kimlik ya da çözücü bilinmiyor → sorgulanamaz/çözülemez. */
  | 'UNKNOWN'
  /** Kimlik + çözücü BEYAN edildi ama BU ÜRÜNDE gerçek araçta doğrulanmadı. */
  | 'DECLARED'
  /** Gerçek araçta okunup kanıtı kütüğe yazıldı (`verifiedOn` + `evidence`). */
  | 'FIELD_CONFIRMED';

export const OEM_SIGNAL_CONFIDENCE_LABEL: Readonly<Record<OemSignalConfidence, string>> = {
  UNKNOWN:         'BİLİNMİYOR — kimlik/çözücü kanıtı yok',
  DECLARED:        'BEYAN — kaynak var, gerçek araçta doğrulanmadı',
  FIELD_CONFIRMED: 'SAHA DOĞRULANDI — gerçek araç kanıtı var',
};

/** Hex kimliğin gerçek araç kanıtı. İkisi birlikte var ya da birlikte yok. */
export interface OemIdentifierEvidence {
  /** YYYY-AA-GG; okunmadıysa `null`. */
  readonly verifiedOn: string | null;
  /** Ne gözlendi (ham hex ↔ bilinen gösterge eşleşmesi); yoksa `null`. */
  readonly evidence: string | null;
}

/** Bu sinyalin hangi araçlara uygulanabileceği. */
export interface OemSignalScope {
  readonly manufacturer: string;
  /** Model/aile; ayırt edilmiyorsa `'UNKNOWN'` (marka geneli). */
  readonly modelFamily: string;
  /** ISO 3779 WMI önekleri — boş dizi = marka filtresi UYGULANMAZ (yalnız protokol + rol). */
  readonly wmi: readonly string[];
  /** Uygulanabilir protokol sınıfları — boş olamaz. */
  readonly protocols: readonly OemProtocolClass[];
}

export interface OemSignalDef {
  readonly signalId: OemSignalId;
  /** Türkçe kısa ad — LAB/asistan bunu gösterir. */
  readonly name: string;
  readonly group: OemSignalGroup;
  readonly scope: OemSignalScope;
  /** Hangi ECU'dan okunur. `unknown` YASAK — rolü bilinmeyen sinyal profile değil keşfe aittir. */
  readonly ecuRole: Exclude<EcuRole, 'unknown'>;
  readonly service: OemSignalService;
  /** Servis 22 → 4 hex hane · Servis 21 → 2 hex hane · kanıt yoksa `'UNKNOWN'`. */
  readonly identifier: string | 'UNKNOWN';
  /** İstek adreslemesi GEREKSİNİMİ (adresin KENDİSİ `oemProfileRegistry`de). */
  readonly addressing: OemAddressing | 'UNKNOWN';
  /** Gereken tanı oturumu — hepsi salt-okuma oturum komutu (SecurityAccess DEĞİL). */
  readonly session: OemDiagSession;
  /** Çözücü — mevcut `DidDecodeSpec` ailesi. `null` = çözücü BİLİNMİYOR. */
  readonly decode: DidDecodeSpec | null;
  /** Beklenen data bayt sayısı; `null` = bilinmiyor (çözücü ile birlikte gelir). */
  readonly bytes: number | null;
  readonly unit: string;
  /**
   * FİZİKSEL makullük bandı. Mühendislik fiziğidir, marka iddiası DEĞİLDİR — bu yüzden
   * kimlik UNKNOWN olsa bile beyan edilir. Yalnız DEĞER ELER, asla değer ÜRETMEZ.
   */
  readonly plausibility: { readonly min: number; readonly max: number };
  /** Sinyal TANIMININ kaynağı (kimlik kanıtı ayrı alanda). */
  readonly provenance: OemProvenance;
  readonly identifierEvidence: OemIdentifierEvidence;
  /** Güvenlik sınıfı — bu katalogda TEK değer. Yazma/aktüatör kaydı GİREMEZ. */
  readonly access: 'read_only';
  /**
   * Aynı fiziksel büyüklüğü ZATEN sahiplenen standart OBD sinyali (varsa).
   * `null` değilse standart sinyal KANONİK SAHİPTİR: standart yol destekliyorken
   * OEM sinyali poll edilmez (`oemCapabilityEvidence.decideOemPoll`) — çift otorite yasağı.
   */
  readonly standardEquivalent: CanonicalObdKey | null;
  /** Dürüstlük notu — neden UNKNOWN, hangi saha adımı gerekiyor. */
  readonly note: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2) TÜRETİLMİŞ KARARLAR (uydurma yok — alanlardan çıkar)
 * ════════════════════════════════════════════════════════════════════════ */

/** Sinyal araca SORULABİLİR mi? Kimlik + servis + adresleme kanıtı gerekir (fail-closed). */
export function isOemSignalProbeable(def: OemSignalDef): boolean {
  return def.identifier !== 'UNKNOWN'
    && def.service !== 'UNKNOWN'
    && def.addressing !== 'UNKNOWN'
    && OEM_READ_DATA_SERVICES.has(def.service);
}

/** Yanıt ÇÖZÜLEBİLİR mi? Çözücü yoksa pozitif yanıt yalnız YETENEK kanıtıdır, DEĞER değil. */
export function isOemSignalDecodable(def: OemSignalDef): boolean {
  return def.decode !== null && def.bytes !== null && def.bytes >= 1;
}

/** Güven seviyesi — yazılmaz, TÜRETİLİR. */
export function oemSignalConfidence(def: OemSignalDef): OemSignalConfidence {
  if (!isOemSignalProbeable(def) || !isOemSignalDecodable(def)) return 'UNKNOWN';
  const { verifiedOn, evidence } = def.identifierEvidence;
  if (verifiedOn !== null && evidence !== null && evidence.trim().length >= MIN_EVIDENCE_LEN) {
    return 'FIELD_CONFIRMED';
  }
  return 'DECLARED';
}

/** Sinyal bu araca uygulanabilir mi (marka/WMI + protokol kapısı). */
export function oemSignalMatchesScope(
  def: OemSignalDef,
  scope: { readonly wmi: string | null; readonly protocolClass: OemProtocolClass | null },
): boolean {
  if (scope.protocolClass === null) return false;          // protokol bilinmiyorsa UYGULANMAZ
  if (!def.scope.protocols.includes(scope.protocolClass)) return false;
  if (def.scope.wmi.length === 0) return true;             // marka filtresi yok
  if (scope.wmi === null) return false;                    // filtre var ama WMI ölçülmedi → fail-closed
  return def.scope.wmi.includes(scope.wmi.toUpperCase());
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) DOĞRULAMA — bozuk/tehlikeli kayıt katalogda DURAMAZ
 * ════════════════════════════════════════════════════════════════════════ */

export type OemSignalCatalogValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

const DID22_RE = /^[0-9A-F]{4}$/;
const LID21_RE = /^[0-9A-F]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIGNAL_ID_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/**
 * Katalog bütünlüğü. Tek bir kayıt bile düşerse TÜM katalog geçersizdir (kilit testi
 * bunu çağırır) — "kısmen güvenli katalog" diye bir şey yoktur.
 */
export function validateOemSignalCatalog(defs: readonly OemSignalDef[]): OemSignalCatalogValidation {
  const errors: string[] = [];
  const seenId = new Set<string>();
  /** Çift otorite kilidi: aynı (marka · rol · servis · kimlik) iki kez tanımlanamaz. */
  const seenIdentity = new Set<string>();

  defs.forEach((d, i) => {
    const at = `signals[${i}] (${String(d.signalId)})`;

    if (typeof d.signalId !== 'string' || !SIGNAL_ID_RE.test(d.signalId)) {
      errors.push(`${at}.signalId: BÜYÜK_HARF_ALT_ÇİZGİ biçiminde olmalı`);
    } else if (seenId.has(d.signalId)) {
      errors.push(`${at}.signalId: YİNELENEN kimlik — çift sinyal otoritesi yasak`);
    } else {
      seenId.add(d.signalId);
    }

    if (typeof d.name !== 'string' || d.name.trim().length === 0) errors.push(`${at}.name: boş olamaz`);
    if (typeof d.note !== 'string' || d.note.trim().length === 0) errors.push(`${at}.note: boş olamaz`);
    if (d.access !== 'read_only') errors.push(`${at}.access: yalnız 'read_only' — yazma/aktüatör kaydı giremez`);
    // Tip zaten 'unknown'ı dışlar; bu kontrol RUNTIME girdisi için (ileride OTA/kullanıcı
    // kataloğu gelirse tip güvencesi yoktur) — bu yüzden string üzerinden bakılır.
    if ((d.ecuRole as string) === 'unknown') {
      errors.push(`${at}.ecuRole: 'unknown' yasak — rolsüz sinyal keşfe aittir`);
    }

    // Servis kapısı — savunma derinliği: hem kara liste hem beyaz liste.
    if (d.service !== 'UNKNOWN') {
      if (HARD_FORBIDDEN_SERVICES.has(d.service)) {
        errors.push(`${at}.service: '${d.service}' AÇIKÇA YASAK (yazma/aktüatör/güvenlik)`);
      } else if (!OEM_READ_DATA_SERVICES.has(d.service)) {
        errors.push(`${at}.service: yalnız '22' | '21' | 'UNKNOWN'`);
      }
    }

    // Kimlik ↔ servis tutarlılığı.
    if (d.identifier === 'UNKNOWN') {
      if (d.identifierEvidence.verifiedOn !== null || d.identifierEvidence.evidence !== null) {
        errors.push(`${at}: kimlik UNKNOWN iken doğrulama damgası olamaz`);
      }
    } else {
      if (d.service === 'UNKNOWN') {
        errors.push(`${at}: kimlik biliniyorsa servis de bilinmeli`);
      } else if (d.service === '22' && !DID22_RE.test(d.identifier)) {
        errors.push(`${at}.identifier: servis 22 → 4 hex hane (büyük harf)`);
      } else if (d.service === '21' && !LID21_RE.test(d.identifier)) {
        errors.push(`${at}.identifier: servis 21 → 2 hex hane (büyük harf)`);
      }
      if (d.addressing === 'UNKNOWN') {
        errors.push(`${at}: kimlik biliniyorsa adresleme kipi de bilinmeli (fail-closed)`);
      }
      const key = `${d.scope.manufacturer}|${d.ecuRole}|${d.service}|${d.identifier}`;
      if (seenIdentity.has(key)) {
        errors.push(`${at}: aynı (marka·rol·servis·kimlik) ikinci kez tanımlandı — çift otorite`);
      } else {
        seenIdentity.add(key);
      }
    }

    // Kanıt çifti bütünlüğü.
    const { verifiedOn, evidence } = d.identifierEvidence;
    if ((verifiedOn === null) !== (evidence === null)) {
      errors.push(`${at}.identifierEvidence: verifiedOn ve evidence BİRLİKTE dolu ya da BİRLİKTE boş olmalı`);
    }
    if (verifiedOn !== null && !DATE_RE.test(verifiedOn)) errors.push(`${at}.identifierEvidence.verifiedOn: YYYY-AA-GG olmalı`);
    if (evidence !== null && evidence.trim().length < MIN_EVIDENCE_LEN) {
      errors.push(`${at}.identifierEvidence.evidence: en az ${MIN_EVIDENCE_LEN} karakter gerçek gözlem olmalı`);
    }

    // Çözücü ↔ bayt ikilisi.
    if ((d.decode === null) !== (d.bytes === null)) {
      errors.push(`${at}: decode ve bytes BİRLİKTE tanımlı ya da BİRLİKTE null olmalı`);
    }
    if (d.bytes !== null && (!Number.isInteger(d.bytes) || d.bytes < 1)) {
      errors.push(`${at}.bytes: pozitif tam sayı olmalı`);
    }

    // Makullük bandı — her zaman zorunlu (fizik, marka iddiası değil).
    const p = d.plausibility;
    if (!p || !Number.isFinite(p.min) || !Number.isFinite(p.max) || p.min > p.max) {
      errors.push(`${at}.plausibility: sonlu min ≤ max olmalı`);
    }

    if (!Array.isArray(d.scope.protocols) || d.scope.protocols.length === 0) {
      errors.push(`${at}.scope.protocols: en az 1 protokol sınıfı olmalı`);
    }
    if (typeof d.provenance?.source !== 'string' || d.provenance.source.trim().length === 0) {
      errors.push(`${at}.provenance.source: boş olamaz`);
    }
  });

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4) MEVCUT BORU HATTINA KÖPRÜ — yeni transport/çözücü YOK
 * ════════════════════════════════════════════════════════════════════════ */

/** Sinyalin okunacağı ECU — adres otoritesi `oemProfileRegistry`dedir, buraya ÇÖZÜLMÜŞ gelir. */
export interface OemSignalEcuBinding {
  readonly ecuId: string;
  readonly ecuName: string;
  readonly tx: string;
  readonly rx: string;
}

/**
 * Sinyali MEVCUT `CompiledDidDef` sözleşmesine derler (çözücü + makullük bandı dâhil).
 * Derleme mevcut `validateVehicleDidProfile` + `compileVehicleDidProfile` ile yapılır:
 * ikinci bir çözücü/doğrulayıcı otoritesi KURULMAZ. Sorgulanamaz/çözülemez sinyal `null`.
 */
export function compileOemSignal(def: OemSignalDef, ecu: OemSignalEcuBinding): CompiledDidDef | null {
  if (!isOemSignalProbeable(def) || !isOemSignalDecodable(def)) return null;

  const profile: VehicleDidProfile = {
    brand: def.scope.manufacturer,
    source: def.provenance.source,
    protocols: [...def.scope.protocols],
    ecus: [{ id: ecu.ecuId, name: ecu.ecuName, tx: ecu.tx, rx: ecu.rx }],
    dids: [{
      did: def.identifier,
      service: def.service === '21' ? '21' : '22',
      ecu: ecu.ecuId,
      name: def.name,
      unit: def.unit,
      bytes: def.bytes as number,
      min: def.plausibility.min,
      max: def.plausibility.max,
      category: def.group,
      decode: def.decode as DidDecodeSpec,
    }],
  };

  const validation = validateVehicleDidProfile(profile);
  if (!validation.valid) return null;           // bozuk kayıt araca GÖNDERİLMEZ
  const compiled = compileVehicleDidProfile(validation.profile);
  return compiled.get(def.identifier.toUpperCase()) ?? null;
}

/**
 * Sinyali mevcut keşif tarayıcısının (`readOnlyDidScanner.scanDidCandidates`) anladığı
 * adaya çevirir. Yeni tarayıcı/transport YAZILMAZ — aynı native primitifi kullanılır.
 * Çözücüsü olmayan sorgulanabilir sinyal de aday OLABİLİR: pozitif yanıt YETENEK kanıtıdır,
 * ama `compiledDef: null` olduğu için DEĞER ÜRETİLMEZ (fail-closed).
 */
export function oemSignalToDidCandidate(def: OemSignalDef, ecu: OemSignalEcuBinding): DidCandidate | null {
  if (!isOemSignalProbeable(def)) return null;
  const compiledDef = compileOemSignal(def, ecu);
  return {
    did: def.identifier.toUpperCase(),
    service: def.service === '21' ? '21' : '22',
    ecuId: ecu.ecuId,
    tx: ecu.tx,
    rx: ecu.rx,
    name: def.name,
    hasKnownDecoder: compiledDef !== null,
    compiledDef,
    source: 'oem_catalog',
  };
}
