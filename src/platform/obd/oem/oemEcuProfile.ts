/**
 * oemEcuProfile — P1-OBD-01 · OEM ECU PROFİL SÖZLEŞMESİ (SAF VERİ + DOĞRULAYICI).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Mevcut ECU keşfi TEK yoldan çalışır: fonksiyonel `0100` (7DF) isteğine yanıt
 * veren ECU'lar envantere girer (`ecuDiscovery.parseEcuProbe`). Bu yol ISO
 * 15765-4'ün garanti ettiği kadarını bulur — ve YALNIZCA onu. OBD-II kapsamı
 * DIŞINDAKİ birimler (BCM · HVAC · BMS · gösterge · gövde) fonksiyonel isteği
 * çoğu araçta HİÇ yanıtlamaz; onlara ulaşmanın tek yolu FİZİKSEL adrestir ve
 * fiziksel adres araç-özeldir. Bu modül o adreslerin taşınacağı ORTAK, kanıt
 * zorunlu sözleşmedir.
 *
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * (1) İKİNCİ KEŞİF OTORİTESİ DEĞİLDİR. Envanterin sahibi hâlâ
 *     `multiEcuScan.discoverEcus` → `ecuDiscovery`'dir. Profil yalnız o listeye
 *     ADAY ekler (`oemProfileMatch.mergeOemProfileEcus`) ve kendi tarama
 *     döngüsü · timer'ı · native köprüsü YOKTUR.
 * (2) İKİNCİ ÇÖZÜCÜ (decode) OTORİTESİ DEĞİLDİR. DID/LID kayıtları burada
 *     yalnız KİMLİK ve İSİM taşır; formül/ölçek `vehicleDidProfile` şemasında
 *     kalır. İki yerde formül tutmak, birinin güncellenmeden kalması demektir.
 * (3) ROL ÇIKARIM MOTORU DEĞİLDİR. Rol `ecuRoleModel.deriveEcuRole` ile
 *     çıkar; profil yalnız `profile` kanıt sınıfına GİRDİ sağlar ve bu kanıt
 *     sınıfı beyandan (declared) ve standart adres garantisinden (standard)
 *     SONRA gelir.
 *
 * ── FAIL-CLOSED KANIT KURALI (bu dosyanın asıl işi) ───────────────────────
 * Bir ECU kaydı ÜRÜN YOLUNA ancak `verifiedOn` (YYYY-MM-DD) VE `evidence`
 * (gerçek araçta ne gözlendiği) ile girer. Kanıtsız kayıt yapısal olarak
 * GEÇERLİ olabilir ama `selectProductEcus` onu ELER — yani "profil dosyada
 * duruyor" ile "profil araca komut adresliyor" ASLA aynı şey değildir.
 * Gerekçe: adres tablosu uydurmak ya da kamu forumundan kopyalamak, yanlış
 * bir birime istek göndermek demektir; yanlış hedefe giden istek en iyi
 * ihtimalle COMM_ERROR gürültüsü, en kötü ihtimalle başka bir modülün oturum
 * durumunu bozmaktır.
 *
 * ── SALT-OKUNUR SINIR ─────────────────────────────────────────────────────
 * `readServices` yalnız OKUMA servislerini kabul eder. SecurityAccess (0x27),
 * WriteDataByIdentifier (0x2E), RoutineControl (0x31), ClearDiagnosticInformation
 * (0x14), Mode 04, ECUReset (0x11), CommunicationControl (0x28) ve benzeri her
 * yazma/aktüatör servisi doğrulayıcı tarafından REDDEDİLİR — profil dosyasına
 * yazılarak bile açılamaz.
 */

import type { EcuRole } from '../ecuRoleModel';

/* ── Adresleme ────────────────────────────────────────────────────────────── */

/**
 * ECU'ya nasıl ulaşıldığı.
 *  - `can11`: ISO 15765-4 standart 11-bit CAN (tx '7E0' gibi 3 hex hane)
 *  - `can29`: ISO 15765-4 genişletilmiş 29-bit CAN (tx '18DADAF1' gibi 8 hane)
 *  - `kwp`  : ISO 14230 K-line — CAN adres kipi YOKTUR (`kwpTarget` ayrı alan)
 */
export type OemAddressing = 'can11' | 'can29' | 'kwp';

/** `protocolProfile.classifyProtocol` sınıfları — `unknown` BİLİNÇLİ olarak yok:
 *  protokolü bilinmeyen bir bağlantıya profil UYGULANMAZ (fail-closed). */
export type OemProtocolClass = 'can' | 'kwp' | 'iso9141' | 'j1850';

/**
 * Gerekli tanı oturumu — HEPSİ SALT-OKUNUR oturum komutudur (ECU'ya veri yazmaz,
 * SecurityAccess değildir). Bilinmiyorsa `UNKNOWN`: "varsayılan oturum yeter"
 * demek bir ÖLÇÜM sonucudur, varsayım değildir.
 *   `uds_extended_1003`  → 10 03 (ISO 14229 extended diagnostic session)
 *   `kwp_standard_1081`  → 10 81 (ISO 14230-4 standart tanı oturumu)
 *   `kwp_extended_10C0`  → 10 C0 (birçok Renault/PSA KWP ECU'sunun genişletilmişi)
 */
export type OemDiagSession =
  | 'default' | 'uds_extended_1003' | 'kwp_standard_1081' | 'kwp_extended_10C0' | 'UNKNOWN';

/** İzin verilen SALT-OKUMA servisleri. Bu kümenin dışı doğrulayıcıda düşer. */
export type OemReadService =
  | '01'   // Mode 01 — canlı veri (SAE J1979)
  | '03'   // Mode 03 — saklı DTC
  | '06'   // Mode 06 — onboard monitör test sonuçları
  | '07'   // Mode 07 — bekleyen DTC
  | '09'   // Mode 09 — araç bilgisi (VIN/CALID)
  | '0A'   // Mode 0A — kalıcı DTC
  | '18'   // KWP ReadDtcByStatus (ISO 14230)
  | '19'   // UDS ReadDTCInformation (ISO 14229)
  | '21'   // KWP ReadDataByLocalIdentifier
  | '22';  // UDS ReadDataByIdentifier

const READ_SERVICES: ReadonlySet<string> = new Set([
  '01', '03', '06', '07', '09', '0A', '18', '19', '21', '22',
]);

/**
 * Açıkça YASAKLI servisler — yalnızca "beyaz listede yok" demek yetmez; bu küme
 * doğrulayıcının hata mesajında NEDEN reddedildiğini söyleyebilmesi içindir
 * (sessiz eleme, yarın birinin aynı satırı tekrar yazmasına yol açar).
 */
const FORBIDDEN_SERVICE_REASON: Readonly<Record<string, string>> = {
  '04': 'Mode 04 (DTC sil) — YAZMA',
  '10': 'DiagnosticSessionControl — oturum ayrı alanda (`session`) beyan edilir',
  '11': 'ECUReset — YAZMA/AKTÜATÖR',
  '14': 'ClearDiagnosticInformation — YAZMA',
  '27': 'SecurityAccess — kapsam DIŞI',
  '28': 'CommunicationControl — YAZMA',
  '2E': 'WriteDataByIdentifier — YAZMA',
  '2F': 'InputOutputControlByIdentifier — AKTÜATÖR',
  '31': 'RoutineControl — AKTÜATÖR',
  '34': 'RequestDownload — YAZMA',
  '36': 'TransferData — YAZMA',
  '3B': 'WriteDataByLocalIdentifier (KWP) — YAZMA',
  '3E': 'TesterPresent — oturum yönetimi native tarafta, profilde beyan edilmez',
  '85': 'ControlDTCSetting — YAZMA',
};

/* ── Kanıt / kaynak ───────────────────────────────────────────────────────── */

export type OemProvenanceKind =
  /** Uluslararası standardın kendisi (ISO 14229 / 15765-4 / 14230, SAE J1979).
   *  Marka İDDİASI İÇERMEZ — bu yüzden tek başına ürün yolu için YETMEZ. */
  | 'iso_standard'
  /** İzin verici lisanslı açık kaynak (MIT/Apache/BSD) — atıf ZORUNLU. */
  | 'oss_licensed'
  /** Kamuya açık üretici/servis belgesi. */
  | 'oem_document'
  /** BU ÜRÜNDE gerçek araçta ölçülmüş gözlem (kütük maddesi). */
  | 'field_observation';

export interface OemProvenance {
  readonly kind: OemProvenanceKind;
  /** Doğrulanabilir kaynak referansı — boş olamaz. */
  readonly source: string;
  /** Ticari satış kuralı (CLAUDE.md): lisans AÇIKÇA yazılır; kopyaleft/NC girmez. */
  readonly license: string;
}

/** Ticari satışı engelleyen lisans imzaları — profil dosyasına giremez. */
const BLOCKED_LICENSE_RE = /\b(GPL|AGPL|LGPL|SSPL|EUPL|NON[- ]?COMMERCIAL|CC[- ]BY[- ]NC)\b/i;

/* ── Veri tanımlayıcı (KİMLİK — formül DEĞİL) ─────────────────────────────── */

export interface OemDataIdentifier {
  /** Servis 22 → 4 hex hane (ör. '2006'); Servis 21 → 2 hex hane (ör. '80'). */
  readonly id: string;
  readonly service: '22' | '21';
  /** Türkçe kısa ad — LAB listesi ve kapsam raporu bunu kullanır. */
  readonly name: string;
  /** Bu kimliğin GERÇEK ARAÇTA okunduğu tarih; okunmadıysa `null`. */
  readonly verifiedOn: string | null;
  /** Ne gözlendiği (ham hex ↔ bilinen gösterge değeri eşleşmesi); yoksa `null`. */
  readonly evidence: string | null;
}

/* ── ECU kaydı ────────────────────────────────────────────────────────────── */

export interface OemEcuEntry {
  /** Profil içi kısa kimlik (ör. 'lbc') — LAB ve DID referansı. */
  readonly ecuId: string;
  /** Türkçe ad (ör. 'Batarya Yönetim Sistemi'). */
  readonly name: string;
  /**
   * ECU'nun ROLÜ. `unknown` YASAKTIR: rolü bilinmeyen bir adresi profile yazmak,
   * "adresten rol uydurma" yasağını başka bir dosyaya taşımaktır — böyle bir
   * satır varsa profile değil, keşfe aittir.
   */
  readonly role: Exclude<EcuRole, 'unknown'>;
  readonly addressing: OemAddressing;
  /** İstek adresi. can11: 3 hane · can29: 8 hane · kwp: '' (varsayılan oturum) veya 6 hane. */
  readonly tx: string;
  /** Yanıt filtre adresi; `tx` boşsa bu da boş olmalı. */
  readonly rx: string;
  /**
   * KWP hedef baytı (ISO 14230 3-bayt header'ın hedefi, ör. '10').
   * YALNIZ `addressing === 'kwp'` için anlamlı; bilinmiyorsa `'UNKNOWN'`
   * (uydurulmaz — yanlış hedef baytı K-line'da başka modülü uyandırır).
   * CAN adreslemede `null`.
   */
  readonly kwpTarget: string | 'UNKNOWN' | null;
  readonly session: OemDiagSession;
  readonly readServices: readonly OemReadService[];
  readonly dids: readonly OemDataIdentifier[];
  readonly provenance: OemProvenance;
  /** Bu ADRESİN gerçek araçta doğrulandığı tarih; doğrulanmadıysa `null`. */
  readonly verifiedOn: string | null;
  /** Doğrulama kanıtı (ne gözlendi); yoksa `null`. En az `MIN_EVIDENCE_LEN` karakter. */
  readonly evidence: string | null;
}

/* ── Araç eşleşme ölçütü ──────────────────────────────────────────────────── */

export interface OemVehicleMatch {
  readonly manufacturer: string;
  /** Model/aile adı; ayırt edilemiyorsa `'UNKNOWN'`. */
  readonly modelFamily: string;
  /** VIN'in ilk 3 hanesi (WMI) — üreticinin TEK kanıtlanabilir işareti. Boş olamaz. */
  readonly wmi: readonly string[];
  /**
   * VIN'in 4-9. hanelerine (VDS) uygulanacak regex KAYNAĞI. `null` → model ayrımı
   * YAPILMAZ (profil markanın tümüne uygulanır). Model ayrımı gerektiğinde bu
   * desen doldurulur; uymayan araçta profil eşleşmez ("yanlış model" kapısı).
   */
  readonly vdsPattern: string | null;
  /** Uygulanabilir protokol sınıfları — boş olamaz. */
  readonly protocols: readonly OemProtocolClass[];
}

export interface OemEcuProfile {
  /** Kararlı kimlik (kebab-case) — LAB ve testler bunu kullanır. */
  readonly id: string;
  readonly vehicle: OemVehicleMatch;
  readonly note: string;
  readonly provenance: OemProvenance;
  readonly ecus: readonly OemEcuEntry[];
}

/* ── Doğrulama ────────────────────────────────────────────────────────────── */

export type OemEcuProfileValidation =
  | { readonly valid: true; readonly profile: OemEcuProfile }
  | { readonly valid: false; readonly errors: readonly string[] };

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WMI_RE = /^[0-9A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CAN11_RE = /^[0-9A-F]{3}$/;
const CAN29_RE = /^[0-9A-F]{8}$/;
const KWP_HDR_RE = /^(?:|[0-9A-F]{6})$/;
const KWP_TARGET_RE = /^[0-9A-F]{2}$/;
const DID22_RE = /^[0-9A-F]{4}$/;
const LID21_RE = /^[0-9A-F]{2}$/;

const VALID_ROLES: ReadonlySet<string> = new Set([
  'engine', 'transmission', 'abs_esp', 'airbag_srs', 'body_bcm',
  'eps', 'hvac', 'tpms', 'gateway', 'instrument',
]);
const VALID_ADDRESSING: ReadonlySet<string> = new Set(['can11', 'can29', 'kwp']);
const VALID_PROTOCOLS: ReadonlySet<string> = new Set(['can', 'kwp', 'iso9141', 'j1850']);
const VALID_SESSIONS: ReadonlySet<string> = new Set([
  'default', 'uds_extended_1003', 'kwp_standard_1081', 'kwp_extended_10C0', 'UNKNOWN',
]);
const VALID_PROVENANCE: ReadonlySet<string> = new Set([
  'iso_standard', 'oss_licensed', 'oem_document', 'field_observation',
]);

/** Asgari kanıt uzunluğu — "ok" / "test" gibi içi boş damgalar kanıt DEĞİLDİR. */
export const MIN_EVIDENCE_LEN = 12;

function _validateProvenance(p: unknown, where: string, errors: string[]): void {
  if (typeof p !== 'object' || p === null) { errors.push(`${where}.provenance: nesne olmalı`); return; }
  const v = p as Record<string, unknown>;
  if (typeof v.kind !== 'string' || !VALID_PROVENANCE.has(v.kind)) {
    errors.push(`${where}.provenance.kind: geçersiz — izin verilen: ${[...VALID_PROVENANCE].join(', ')}`);
  }
  if (typeof v.source !== 'string' || v.source.trim().length === 0) {
    errors.push(`${where}.provenance.source: ZORUNLU — doğrulanabilir kaynak referansı`);
  }
  if (typeof v.license !== 'string' || v.license.trim().length === 0) {
    errors.push(`${where}.provenance.license: ZORUNLU — ticari satış kuralı (CLAUDE.md)`);
  } else if (BLOCKED_LICENSE_RE.test(v.license)) {
    errors.push(`${where}.provenance.license: ticari satışı engelleyen lisans REDDEDİLDİ ('${v.license}')`);
  }
}

/** `verifiedOn` + `evidence` çifti — ikisi birlikte var ya da birlikte yok. */
function _validateStamp(verifiedOn: unknown, evidence: unknown, where: string, errors: string[]): void {
  if (verifiedOn === null) {
    if (evidence !== null) errors.push(`${where}: verifiedOn null iken evidence de null olmalı (yarım damga)`);
    return;
  }
  if (typeof verifiedOn !== 'string' || !DATE_RE.test(verifiedOn)) {
    errors.push(`${where}.verifiedOn: YYYY-MM-DD biçiminde string veya null olmalı`);
    return;
  }
  if (typeof evidence !== 'string' || evidence.trim().length < MIN_EVIDENCE_LEN) {
    errors.push(`${where}.evidence: verifiedOn varsa ZORUNLU ve en az ${MIN_EVIDENCE_LEN} karakter (ne gözlendi?)`);
  }
}

/**
 * Yapısal doğrulama. `verifiedOn`/`evidence` `null` OLABİLİR ve bu bir hata
 * DEĞİLDİR — doğrulanmamış profil dosyada durabilir (karantina); ürün yoluna
 * girmesini `selectProductEcus` engeller. Ama `verifiedOn` VARSA biçimi ve
 * yanındaki `evidence` ZORUNLUDUR: yarım damga, damgasızdan tehlikelidir.
 */
export function validateOemEcuProfile(input: unknown): OemEcuProfileValidation {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: ['profil bir nesne olmalı'] };
  }
  const p = input as Record<string, unknown>;

  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) {
    errors.push(`id: kebab-case boş olmayan string olmalı ('${String(p.id)}')`);
  }
  if (typeof p.note !== 'string' || p.note.trim().length === 0) errors.push('note: boş olmayan string olmalı');
  _validateProvenance(p.provenance, 'profil', errors);

  /* ── Araç eşleşme ölçütü ── */
  const veh = p.vehicle;
  if (typeof veh !== 'object' || veh === null) {
    errors.push('vehicle: nesne olmalı');
  } else {
    const v = veh as Record<string, unknown>;
    if (typeof v.manufacturer !== 'string' || v.manufacturer.trim().length === 0) {
      errors.push('vehicle.manufacturer: boş olmayan string olmalı');
    }
    if (typeof v.modelFamily !== 'string' || v.modelFamily.trim().length === 0) {
      errors.push("vehicle.modelFamily: boş olmayan string olmalı (bilinmiyorsa 'UNKNOWN')");
    }
    if (!Array.isArray(v.wmi) || v.wmi.length === 0) {
      errors.push("vehicle.wmi: en az 1 öğeli dizi olmalı — VIN'siz araçta profil DENENMEZ");
    } else {
      v.wmi.forEach((w, i) => {
        if (typeof w !== 'string' || !WMI_RE.test(w)) errors.push(`vehicle.wmi[${i}]: 3 haneli büyük harf/rakam olmalı`);
      });
    }
    if (v.vdsPattern !== null && typeof v.vdsPattern !== 'string') {
      errors.push('vehicle.vdsPattern: string veya null olmalı');
    } else if (typeof v.vdsPattern === 'string') {
      if (v.vdsPattern.trim().length === 0) errors.push('vehicle.vdsPattern: boş string yerine null kullan');
      else {
        try { new RegExp(v.vdsPattern); } catch { errors.push('vehicle.vdsPattern: geçersiz düzenli ifade'); }
      }
    }
    if (!Array.isArray(v.protocols) || v.protocols.length === 0) {
      errors.push('vehicle.protocols: en az 1 öğeli dizi olmalı');
    } else {
      v.protocols.forEach((c, i) => {
        if (typeof c !== 'string' || !VALID_PROTOCOLS.has(c)) {
          errors.push(`vehicle.protocols[${i}]: geçersiz — izin verilen: ${[...VALID_PROTOCOLS].join(', ')}`);
        }
      });
    }
  }

  /* ── ECU kayıtları ── */
  if (!Array.isArray(p.ecus) || p.ecus.length === 0) {
    errors.push('ecus: en az 1 öğeli dizi olmalı');
  } else {
    const seenIds = new Set<string>();
    const seenAddr = new Set<string>();
    p.ecus.forEach((raw, i) => {
      const where = `ecus[${i}]`;
      if (typeof raw !== 'object' || raw === null) { errors.push(`${where}: nesne olmalı`); return; }
      const e = raw as Record<string, unknown>;

      if (typeof e.ecuId !== 'string' || !ID_RE.test(e.ecuId)) {
        errors.push(`${where}.ecuId: kebab-case boş olmayan string olmalı`);
      } else if (seenIds.has(e.ecuId)) {
        errors.push(`${where}.ecuId: yinelenen '${e.ecuId}'`);
      } else seenIds.add(e.ecuId);

      if (typeof e.name !== 'string' || e.name.trim().length === 0) errors.push(`${where}.name: boş olmayan string olmalı`);

      if (typeof e.role !== 'string' || !VALID_ROLES.has(e.role)) {
        errors.push(`${where}.role: geçersiz — 'unknown' YASAK (rolü bilinmeyen adres profile YAZILMAZ)`);
      }

      const addressing = e.addressing;
      if (typeof addressing !== 'string' || !VALID_ADDRESSING.has(addressing)) {
        errors.push(`${where}.addressing: 'can11' | 'can29' | 'kwp' olmalı`);
      } else if (typeof e.tx !== 'string' || typeof e.rx !== 'string') {
        errors.push(`${where}: tx ve rx string olmalı`);
      } else {
        const tx = e.tx;
        const rx = e.rx;
        if (addressing === 'can11') {
          if (!CAN11_RE.test(tx)) errors.push(`${where}.tx: 11-bit için 3 hex hane olmalı (ör. '7E0') — '${tx}'`);
          if (!CAN11_RE.test(rx)) errors.push(`${where}.rx: 11-bit için 3 hex hane olmalı (ör. '7E8') — '${rx}'`);
        } else if (addressing === 'can29') {
          if (!CAN29_RE.test(tx)) errors.push(`${where}.tx: 29-bit için 8 hex hane olmalı (ör. '18DADAF1') — '${tx}'`);
          if (!CAN29_RE.test(rx)) errors.push(`${where}.rx: 29-bit için 8 hex hane olmalı — '${rx}'`);
        } else {
          if (!KWP_HDR_RE.test(tx)) errors.push(`${where}.tx: KWP için '' (varsayılan oturum) veya 6 hex hane olmalı — '${tx}'`);
          if (!KWP_HDR_RE.test(rx)) errors.push(`${where}.rx: KWP için '' veya 6 hex hane olmalı — '${rx}'`);
          if (tx === '' && rx !== '') errors.push(`${where}: tx boşken (varsayılan oturum) rx de boş olmalı`);
        }

        /* KWP hedef baytı — CAN'de anlamsız, KWP'de bilinmiyorsa UNKNOWN. */
        if (addressing === 'kwp') {
          if (e.kwpTarget !== 'UNKNOWN' && (typeof e.kwpTarget !== 'string' || !KWP_TARGET_RE.test(e.kwpTarget))) {
            errors.push(`${where}.kwpTarget: 2 hex hane veya 'UNKNOWN' olmalı (uydurma YASAK)`);
          }
        } else if (e.kwpTarget !== null) {
          errors.push(`${where}.kwpTarget: CAN adreslemede null olmalı (KWP hedefi CAN'de anlamsızdır)`);
        }

        const key = `${addressing}:${rx}`;
        if (seenAddr.has(key)) errors.push(`${where}: yinelenen adres ${key}`);
        seenAddr.add(key);
      }

      if (typeof e.session !== 'string' || !VALID_SESSIONS.has(e.session)) {
        errors.push(`${where}.session: geçersiz — izin verilen: ${[...VALID_SESSIONS].join(', ')}`);
      }

      if (!Array.isArray(e.readServices) || e.readServices.length === 0) {
        errors.push(`${where}.readServices: en az 1 öğeli dizi olmalı`);
      } else {
        e.readServices.forEach((s, j) => {
          if (typeof s !== 'string') { errors.push(`${where}.readServices[${j}]: string olmalı`); return; }
          const up = s.toUpperCase();
          if (up !== s) {
            errors.push(`${where}.readServices[${j}]: büyük harf hex olmalı ('${s}')`);
          } else if (FORBIDDEN_SERVICE_REASON[up] !== undefined) {
            errors.push(`${where}.readServices[${j}]: REDDEDİLDİ — ${FORBIDDEN_SERVICE_REASON[up]}`);
          } else if (!READ_SERVICES.has(up)) {
            errors.push(`${where}.readServices[${j}]: salt-okuma servisi değil ('${s}')`);
          }
        });
      }

      if (!Array.isArray(e.dids)) {
        errors.push(`${where}.dids: dizi olmalı (boş olabilir)`);
      } else {
        const seenDid = new Set<string>();
        const services = Array.isArray(e.readServices) ? e.readServices : [];
        e.dids.forEach((rawD, j) => {
          const dw = `${where}.dids[${j}]`;
          if (typeof rawD !== 'object' || rawD === null) { errors.push(`${dw}: nesne olmalı`); return; }
          const d = rawD as Record<string, unknown>;
          const svc = d.service;
          if (svc !== '22' && svc !== '21') { errors.push(`${dw}.service: '22' veya '21' olmalı`); return; }
          const re = svc === '21' ? LID21_RE : DID22_RE;
          if (typeof d.id !== 'string' || !re.test(d.id)) {
            errors.push(svc === '21'
              ? `${dw}.id: servis 21 için 2 hex hane olmalı (büyük harf)`
              : `${dw}.id: servis 22 için 4 hex hane olmalı (büyük harf)`);
          } else {
            const k = `${svc}:${d.id}`;
            if (seenDid.has(k)) errors.push(`${dw}.id: yinelenen '${d.id}' (servis ${svc})`);
            seenDid.add(k);
          }
          if (typeof d.name !== 'string' || d.name.trim().length === 0) errors.push(`${dw}.name: boş olmayan string olmalı`);
          _validateStamp(d.verifiedOn, d.evidence, dw, errors);
          /* Profil kendi içinde çelişemez: LID var ama servis 21 beyan edilmemişse
             o kimlik hiçbir zaman okunamaz — sessiz ölü kayıt olurdu. */
          if (!services.includes(svc)) {
            errors.push(`${dw}: servis ${svc} bu ECU'nun readServices listesinde yok`);
          }
        });
      }

      _validateProvenance(e.provenance, where, errors);
      _validateStamp(e.verifiedOn, e.evidence, where, errors);
    });
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, profile: input as unknown as OemEcuProfile };
}

/* ── Ürün yolu kapısı (FAIL-CLOSED) ───────────────────────────────────────── */

/** Bir ECU kaydı gerçek araçta doğrulanmış mı (ürün yoluna girebilir mi)? */
export function isVerifiedOemEcu(e: OemEcuEntry): boolean {
  return typeof e.verifiedOn === 'string' && DATE_RE.test(e.verifiedOn)
    && typeof e.evidence === 'string' && e.evidence.trim().length >= MIN_EVIDENCE_LEN;
}

/**
 * Profilin ÜRÜN YOLUNA girebilen ECU kayıtları. Doğrulanmamış olanlar ELENİR —
 * profilin tamamı reddedilmez, çünkü bir profilin bir ECU'su doğrulanmışken
 * diğeri doğrulanmamış olabilir ve doğrulanmışı cezalandırmak kanıtı çöpe atardı.
 */
export function selectProductEcus(profile: OemEcuProfile): readonly OemEcuEntry[] {
  return profile.ecus.filter(isVerifiedOemEcu);
}

/** Profil ürün yolunda kullanılabilir mi (en az bir doğrulanmış ECU)? */
export function isProductEligibleProfile(profile: OemEcuProfile): boolean {
  return selectProductEcus(profile).length > 0;
}

/** ECU'nun adresleme kipinden CAN adres bit sayısı; KWP'de `null`. */
export function addressBitsOf(e: OemEcuEntry): 11 | 29 | null {
  return e.addressing === 'can11' ? 11 : e.addressing === 'can29' ? 29 : null;
}
