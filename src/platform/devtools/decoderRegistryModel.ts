/**
 * decoderRegistryModel.ts — Çözücü Kayıtları'nın SAF modeli (Faz A8).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React importu yok.
 * Servis/registry importu YOK — girdi tipi YAPISALDIR (mock'suz test edilir).
 *
 * ── BU EKRAN NE DEĞİLDİR ────────────────────────────────────────────────────
 * STATİK bir decoder KATALOĞUdur. Araçta hangi PID/DID'in DESTEKLENDİĞİNİ
 * BİLMEZ ve iddia ETMEZ — bunu bilmek ECU sorgusu gerektirir, bu ekran sorgu
 * YAPMAZ. `supportStatus` alanı yalnız KAYIT DEFTERİNDEKİ rolü anlatır.
 *
 * ── GİZLİLİK (YAPISAL) ──────────────────────────────────────────────────────
 * Girdi tipinde fonksiyon referansı, VIN, araç parmak izi, kullanıcı aracı,
 * anahtar/token, dosya yolu veya çalışma-zamanı ECU cevabı TAŞIYAN ALAN YOKTUR.
 * Formül özeti VERİDEN (fn adı + katsayı) üretilir; `toString()` KULLANILMAZ.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sınırlar (bounded)
 * ════════════════════════════════════════════════════════════════════════ */

export const MAX_DECODER_RECORDS = 400;
/** Ekranda tek seferde gösterilecek azami satır. */
export const MAX_DECODER_ROWS_RENDERED = 200;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham girdi — YAPISAL tip (registry importu YOK)
 * ════════════════════════════════════════════════════════════════════════ */

export interface RawPidRecord {
  readonly pid:        string;
  readonly name:       string;
  readonly unit:       string;
  readonly bytes:      number | null;
  readonly min:        number | null;
  readonly max:        number | null;
  readonly category:   string;
  readonly core:       boolean;
  /** Çözücü fonksiyonun VARLIĞI — referansı DEĞİL. */
  readonly hasDecoder: boolean;
}

export interface RawDidRecord {
  readonly profileId: string;
  readonly did:       string;
  readonly service:   string;
  readonly ecu:       string;
  /** `ecus[]` içinde bu id gerçekten var mı (derleme bunu şart koşar). */
  readonly ecuKnown:  boolean;
  readonly name:      string;
  readonly unit:      string;
  readonly bytes:     number | null;
  readonly min:       number | null;
  readonly max:       number | null;
  readonly category:  string;
  /** `decode.fn` adı — VERİ, fonksiyon gövdesi DEĞİL. */
  readonly decodeFn:  string | null;
  readonly decodeA:   number | null;
  readonly decodeB:   number | null;
  /** Derlenmiş Map'te bu DID hayatta kaldı mı. */
  readonly compiled:  boolean;
}

export interface RawProfileRecord {
  readonly profileId:    string;
  readonly brand:        string;
  readonly source:       string;
  readonly note:         string | null;
  readonly protocols:    readonly string[] | null;
  readonly ecuCount:     number;
  readonly declaredDids: number;
  /** `null` = derleme okunamadı (0 DEĞİL). */
  readonly compiledDids: number | null;
}

export interface DecoderRegistryRaw {
  readonly readAt:     number;
  /** `null` = registry OKUNAMADI · `[]` = gerçekten boş. */
  readonly pids:       readonly RawPidRecord[] | null;
  readonly pidInvalid: number;
  readonly profiles:   readonly RawProfileRecord[] | null;
  readonly dids:       readonly RawDidRecord[] | null;
  readonly didInvalid: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Normalize edilmiş kayıt
 * ════════════════════════════════════════════════════════════════════════ */

export type DecoderKind = 'PID' | 'DID';

/**
 * Çözücü sınıfı — YALNIZ kanıta dayanır.
 *  · DID'lerde `decode.fn` repoda SABİT bir kümedir (A · AB · temp40 · pct ·
 *    linear · div · ascii) → sınıflandırma kesindir.
 *  · Standart PID'lerde çözücü bir JS KAPANIŞIDIR; makine-okunur spec YOKTUR ve
 *    gövdesini okumak YASAKTIR → sınıf `CUSTOM` (= "repo tanımlı JS formülü"),
 *    formül özeti `null`. Uydurma yapılmaz.
 */
export type DecoderType = 'LINEAR' | 'ENUM' | 'BITFIELD' | 'ASCII' | 'HEX' | 'CUSTOM' | 'UNKNOWN';

/** Kayıt defterindeki ROL — aracın desteği DEĞİL. */
export type DecoderSupport =
  | 'CORE' | 'EXTENDED_CANDIDATE' | 'PROFILE_DEFINED' | 'DROPPED_UNKNOWN_ECU' | 'UNKNOWN';

/** Aynı kimliğin kayıt defteri içindeki durumu. */
export type DecoderCollision = 'UNIQUE' | 'OVERRIDDEN' | 'COLLISION' | 'UNKNOWN';

export interface DecoderRecord {
  readonly kind:            DecoderKind;
  readonly id:              string;
  /** Büyük harf, boşluksuz hex. */
  readonly normalizedId:    string;
  readonly displayName:     string;
  /** PID'lerde null (marka bağımsız standart). */
  readonly manufacturer:    string | null;
  readonly profile:         string | null;
  /** PID → '01' (Mode 01) · DID → '22' | '21'. */
  readonly service:         string;
  readonly unit:            string | null;
  readonly decoderType:     DecoderType;
  /** Bounded, VERİDEN üretilmiş özet. Kanıt yoksa null. */
  readonly formulaSummary:  string | null;
  readonly min:             number | null;
  readonly max:             number | null;
  readonly bytes:           number | null;
  readonly category:        string | null;
  readonly sourceRegistry:  string;
  readonly supportStatus:   DecoderSupport;
  readonly collision:       DecoderCollision;
  readonly notes:           string;
}

export const DECODER_TYPE_LABEL: Readonly<Record<DecoderType, string>> = {
  LINEAR:  'DOĞRUSAL',
  ENUM:    'ENUM',
  BITFIELD:'BİT ALANI',
  ASCII:   'METİN (ASCII)',
  HEX:     'HEX',
  CUSTOM:  'ÖZEL (JS formülü)',
  UNKNOWN: 'BİLİNMİYOR',
} as const;

export const DECODER_SUPPORT_LABEL: Readonly<Record<DecoderSupport, string>> = {
  CORE:                'ÇEKİRDEK AKIŞ',
  EXTENDED_CANDIDATE:  'EXTENDED ADAYI',
  PROFILE_DEFINED:     'PROFİLDE TANIMLI',
  DROPPED_UNKNOWN_ECU: 'DERLEMEDE DÜŞTÜ (ECU yok)',
  UNKNOWN:             'BİLİNMİYOR',
} as const;

export const DECODER_COLLISION_LABEL: Readonly<Record<DecoderCollision, string>> = {
  UNIQUE:     'TEKİL',
  OVERRIDDEN: 'ÜZERİNE YAZILDI',
  COLLISION:  'ÇAKIŞMA',
  UNKNOWN:    'BİLİNMİYOR',
} as const;

const SRC_PID  = 'obd/StandardPidRegistry.STANDARD_PIDS';
const SRC_DID  = 'obd/profiles.MANUFACTURER_DID_PROFILES';

/* ── Savunmacı kayıt doğrulama (null/bozuk kayıt ASLA satır üretmez) ───────── */

function _validPid(p: RawPidRecord | null | undefined): p is RawPidRecord {
  return !!p && typeof p === 'object' && typeof p.pid === 'string' && p.pid.length > 0;
}

function _validDid(d: RawDidRecord | null | undefined): d is RawDidRecord {
  return !!d && typeof d === 'object' && typeof d.did === 'string' && d.did.length > 0;
}

/**
 * Türkçe-güvenli katlama. `'DEVRİ'.toLowerCase()` JS'te `'devri'` DEĞİL
 * `'devri' + U+0307 (COMBINING DOT ABOVE)` üretir — bu yüzden düz `toLowerCase`
 * ile arama Türkçe adlarda SESSİZCE başarısız olur (kendi testimiz yakaladı).
 * Ayrıca 'ı' ile 'i' aramada eşdeğer sayılır (geliştirici kolaylığı).
 */
function _fold(s: string): string {
  return s.toLowerCase().replace(/̇/g, '').replace(/ı/g, 'i');
}

/* ── Kimlik normalizasyonu ─────────────────────────────────────────────────── */

/** Büyük harf + boşluk/0x ön eki temizliği. Hex olmayan girdi AYNEN döner. */
export function normalizeDecoderId(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().toUpperCase();
  if (s.indexOf('0X') === 0) s = s.slice(2);
  s = s.replace(/\s+/g, '');
  return s;
}

/* ── DID formül özeti — VERİDEN üretilir, toString() YOK ───────────────────── */

function _didFormula(fn: string | null, a: number | null, b: number | null, bytes: number | null): string | null {
  if (fn === null) return null;
  // `raw`: 1 bayt → A · 2 bayt → AB · ≥3 bayt → ABC (repo `rawFor` kuralı).
  const raw = bytes === null ? 'raw' : bytes <= 1 ? 'A' : bytes === 2 ? 'AB' : 'ABC';
  switch (fn) {
    case 'A':      return 'A';
    case 'AB':     return 'AB';
    case 'temp40': return 'A − 40';
    case 'pct':    return 'A ÷ 2.55';
    case 'ascii':  return 'ASCII metin (yazdırılabilir baytlar)';
    case 'linear': {
      const m = a === null ? 1 : a;
      const c = b === null ? 0 : b;
      return c === 0 ? `${raw} × ${m}` : `${raw} × ${m} ${c < 0 ? '−' : '+'} ${Math.abs(c)}`;
    }
    case 'div':    return `${raw} ÷ ${a === null ? 1 : a}`;
    default:       return null;   // repoda tanımsız fn → uydurma yok
  }
}

function _didType(fn: string | null): DecoderType {
  if (fn === null) return 'UNKNOWN';
  if (fn === 'ascii') return 'ASCII';
  // A · AB · temp40 · pct · linear · div → hepsi ham değer üzerinde AFFİNE dönüşümdür.
  if (fn === 'A' || fn === 'AB' || fn === 'temp40' || fn === 'pct' || fn === 'linear' || fn === 'div') {
    return 'LINEAR';
  }
  return 'UNKNOWN';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Normalize
 * ════════════════════════════════════════════════════════════════════════ */

function _pidRecords(s: DecoderRegistryRaw): DecoderRecord[] {
  if (!s.pids) return [];

  // Çakışma tespiti: aynı PID birden fazla kez tanımlıysa Map kurulumunda SON yazan kazanır.
  const counts = new Map<string, number>();
  for (const p of s.pids) {
    if (!_validPid(p)) continue;
    const k = normalizeDecoderId(p.pid);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const out: DecoderRecord[] = [];
  for (const p of s.pids) {
    /* SAVUNMACI: kaynak katmanı bozuk kaydı zaten eler, ama model DOĞRUDAN da
       (test/başka çağıran) beslenebilir — null/eksik kayıt ATLANIR, sahte satır
       ÜRETİLMEZ. Sayımı ham `pidInvalid` alanı taşır. */
    if (!_validPid(p)) continue;
    const nid = normalizeDecoderId(p.pid);
    const dup = (counts.get(nid) ?? 0) > 1;
    out.push({
      kind: 'PID',
      id: p.pid,
      normalizedId: nid,
      displayName: p.name || nid,
      manufacturer: null,
      profile: null,
      service: '01',
      unit: p.unit === '' ? null : p.unit,
      /* Standart PID çözücüsü bir JS kapanışıdır — makine-okunur spec YOK,
         gövdesi OKUNMADI (toString YASAK) → CUSTOM, formül özeti null. */
      decoderType: p.hasDecoder ? 'CUSTOM' : 'UNKNOWN',
      formulaSummary: null,
      min: p.min,
      max: p.max,
      bytes: p.bytes,
      category: p.category === '' ? null : p.category,
      sourceRegistry: SRC_PID,
      supportStatus: p.core ? 'CORE' : 'EXTENDED_CANDIDATE',
      collision: dup ? 'OVERRIDDEN' : 'UNIQUE',
      notes: p.hasDecoder
        ? 'Çözücü repo içinde JS fonksiyonudur; gövdesi bu ekranda GÖSTERİLMEZ ve okunmaz.'
        : 'Kayıtta çözücü fonksiyonu YOK.',
    });
  }
  return out;
}

function _didRecords(s: DecoderRegistryRaw): DecoderRecord[] {
  if (!s.dids) return [];

  const profileById = new Map<string, RawProfileRecord>();
  for (const p of s.profiles ?? []) profileById.set(p.profileId, p);

  // Profil İÇİ çakışma: derleme Map'i YALNIZ `did` ile anahtarlanır → aynı hex
  // iki kez geçerse SON yazan kazanır (ECU farkı çakışmayı ÖNLEMEZ).
  const inProfileCounts = new Map<string, number>();
  for (const d of s.dids) {
    if (!_validDid(d)) continue;
    const k = `${d.profileId}|${normalizeDecoderId(d.did)}`;
    inProfileCounts.set(k, (inProfileCounts.get(k) ?? 0) + 1);
  }

  const out: DecoderRecord[] = [];
  for (const d of s.dids) {
    if (!_validDid(d)) continue;                 // bozuk kayıt → sahte satır YOK
    const nid = normalizeDecoderId(d.did);
    const prof = profileById.get(d.profileId) ?? null;
    const dupInProfile = (inProfileCounts.get(`${d.profileId}|${nid}`) ?? 0) > 1;

    const support: DecoderSupport = d.ecuKnown ? 'PROFILE_DEFINED' : 'DROPPED_UNKNOWN_ECU';
    const notes: string[] = [];
    if (!d.ecuKnown) {
      notes.push(`ECU referansı "${d.ecu}" profilin ecus[] listesinde YOK — derleme bu DID'i SESSİZCE ATLAR.`);
    }
    if (!d.compiled && d.ecuKnown) {
      notes.push('Derlenmiş haritada bulunamadı — aynı kimlik başka bir kayıtla üzerine yazılmış olabilir.');
    }
    if (d.decodeFn === null) notes.push('Çözücü spec\'i okunamadı.');

    out.push({
      kind: 'DID',
      id: d.did,
      normalizedId: nid,
      displayName: d.name || nid,
      manufacturer: prof ? (prof.brand || null) : null,
      profile: d.profileId,
      service: d.service,
      unit: d.unit === '' ? null : d.unit,
      decoderType: _didType(d.decodeFn),
      formulaSummary: _didFormula(d.decodeFn, d.decodeA, d.decodeB, d.bytes),
      min: d.min,
      max: d.max,
      bytes: d.bytes,
      category: d.category === '' ? null : d.category,
      sourceRegistry: `${SRC_DID}['${d.profileId}']`,
      supportStatus: support,
      collision: dupInProfile ? 'OVERRIDDEN' : 'UNIQUE',
      notes: notes.join(' '),
    });
  }
  return out;
}

/** Tüm kayıtlar — PID'ler önce, sonra DID'ler. Bounded. */
export function buildDecoderRecords(s: DecoderRegistryRaw): DecoderRecord[] {
  if (!s) return [];
  const all = [..._pidRecords(s), ..._didRecords(s)];
  return all.length <= MAX_DECODER_RECORDS ? all : all.slice(0, MAX_DECODER_RECORDS);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Özet
 * ════════════════════════════════════════════════════════════════════════ */

export interface DecoderRegistrySummary {
  /** `null` = registry okunamadı (0 DEĞİL). */
  readonly pidCount:          number | null;
  readonly didCount:          number | null;
  readonly profileCount:      number | null;
  readonly manufacturerCount: number | null;
  /** Profil İÇİNDE aynı kimliğin birden fazla kez tanımlanması. */
  readonly overriddenCount:   number;
  /** ECU referansı çözülemediği için derlemede DÜŞEN DID sayısı. */
  readonly droppedCount:      number;
  /**
   * AYNI kimliğin BİRDEN FAZLA profilde bulunması. Bu bir ÇAKIŞMA DEĞİLDİR:
   * repo aynı anda TEK profil yükler (syncManufacturerDidProfile), profiller
   * birleştirilmez. Bilgi amaçlı ayrı sayılır.
   */
  readonly crossProfileDuplicates: number;
  /** Bozuk/atlanan ham kayıt sayısı (sahte kayıt üretilmez, SAYILIR). */
  readonly invalidCount:      number;
}

export function buildDecoderSummary(
  s: DecoderRegistryRaw,
  records: readonly DecoderRecord[],
): DecoderRegistrySummary {
  const pidRecs = records.filter((r) => r.kind === 'PID');
  const didRecs = records.filter((r) => r.kind === 'DID');

  const manufacturers = new Set<string>();
  for (const p of s.profiles ?? []) if (p.brand) manufacturers.add(p.brand);

  // Aynı normalizedId birden fazla PROFİLDE geçiyor mu (birleştirme YOK — bilgi amaçlı).
  const byId = new Map<string, Set<string>>();
  for (const r of didRecs) {
    if (!r.profile) continue;
    const set = byId.get(r.normalizedId) ?? new Set<string>();
    set.add(r.profile);
    byId.set(r.normalizedId, set);
  }
  let cross = 0;
  for (const set of byId.values()) if (set.size > 1) cross++;

  return {
    pidCount:          s.pids === null ? null : pidRecs.length,
    didCount:          s.dids === null ? null : didRecs.length,
    profileCount:      s.profiles === null ? null : s.profiles.length,
    manufacturerCount: s.profiles === null ? null : manufacturers.size,
    overriddenCount:   records.filter((r) => r.collision === 'OVERRIDDEN').length,
    droppedCount:      records.filter((r) => r.supportStatus === 'DROPPED_UNKNOWN_ECU').length,
    crossProfileDuplicates: cross,
    invalidCount:      (s.pidInvalid ?? 0) + (s.didInvalid ?? 0),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Arama + filtre — SAF, client-side, timer YOK
 * ════════════════════════════════════════════════════════════════════════ */

export interface DecoderFilter {
  /** Boş sorgu → TÜM kayıtlar. Büyük/küçük harf duyarsız. */
  readonly query?: string;
  readonly kind?: DecoderKind | 'ALL';
  readonly manufacturer?: string | 'ALL';
  readonly unit?: string | 'ALL';
  readonly decoderType?: DecoderType | 'ALL';
  readonly supportStatus?: DecoderSupport | 'ALL';
}

/**
 * Arama alanları: id · normalizedId · displayName · manufacturer · profile · unit.
 * Hex sorgusu için sorgu da normalize edilir ('0x0c' → '0C' eşleşir).
 */
export function filterDecoderRecords(
  records: readonly DecoderRecord[],
  filter: DecoderFilter | null | undefined,
): DecoderRecord[] {
  if (!Array.isArray(records)) return [];
  if (!filter) return records.slice();

  const qRaw = typeof filter.query === 'string' ? _fold(filter.query.trim()) : '';
  const qId  = qRaw ? normalizeDecoderId(filter.query!.trim()) : '';

  const out: DecoderRecord[] = [];
  for (const r of records) {
    if (!r) continue;
    if (filter.kind && filter.kind !== 'ALL' && r.kind !== filter.kind) continue;
    if (filter.manufacturer && filter.manufacturer !== 'ALL' && r.manufacturer !== filter.manufacturer) continue;
    if (filter.unit && filter.unit !== 'ALL' && r.unit !== filter.unit) continue;
    if (filter.decoderType && filter.decoderType !== 'ALL' && r.decoderType !== filter.decoderType) continue;
    if (filter.supportStatus && filter.supportStatus !== 'ALL' && r.supportStatus !== filter.supportStatus) continue;

    if (qRaw) {
      const hay = _fold([
        r.id, r.normalizedId, r.displayName,
        r.manufacturer ?? '', r.profile ?? '', r.unit ?? '',
      ].join(' '));
      const idHit = qId.length > 0 && r.normalizedId.indexOf(qId) >= 0;
      if (hay.indexOf(qRaw) < 0 && !idHit) continue;
    }
    out.push(r);
  }
  return out;
}

/** Filtre açılır listeleri için mevcut değerler (saf, sıralı, tekil). */
export function collectDecoderFacets(records: readonly DecoderRecord[]): {
  manufacturers: string[]; units: string[]; types: DecoderType[]; supports: DecoderSupport[];
} {
  const man = new Set<string>();
  const unit = new Set<string>();
  const type = new Set<DecoderType>();
  const sup = new Set<DecoderSupport>();
  for (const r of records ?? []) {
    if (!r) continue;
    if (r.manufacturer) man.add(r.manufacturer);
    if (r.unit) unit.add(r.unit);
    type.add(r.decoderType);
    sup.add(r.supportStatus);
  }
  return {
    manufacturers: Array.from(man).sort(),
    units: Array.from(unit).sort(),
    types: Array.from(type).sort(),
    supports: Array.from(sup).sort(),
  };
}
