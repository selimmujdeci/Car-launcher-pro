/**
 * vehicleDidProfile — Patch 12B: üretici-özel UDS DID profil şeması + doğrulayıcı + derleyici.
 *
 * KAYNAK KURALI: her profilin `source` alanı ZORUNLUDUR (kamu doküman referansı) — ticari
 * lisans kuralı (CLAUDE.md): kitle-kaynaklı/telifli marka veritabanları KOPYALANAMAZ, yalnız
 * doğrulanabilir kamu kaynaklarına dayanan profiller eklenir.
 *
 * TASARIM: keyfi formül DSL'i / eval YASAK — `decode.fn` önceden tanımlı, test edilmiş bir
 * çözücü adı + katsayılardır (StandardPidRegistry'deki `pct`/`temp`/`A`/`AB` yardımcılarıyla
 * AYNI aile). Şema doğrulayıcı bozuk/eksik profili YÜKLEMEZ — dürüst hata listesi döner
 * (ileride kullanıcı/OTA profili gelebileceği için giriş güvenliği şart).
 *
 * Profil `compileVehicleDidProfile` ile bir Map'e derlenir (V8 dostu — hot-path'te (watchDid
 * tur döngüsü) alokasyon yok, yalnız yükleme anında bir kerelik dönüşüm).
 */

/* ── Şema tipleri ─────────────────────────────────────────────────────────── */

/** Önceden tanımlı çözücü adları — DSL/eval YOK, yalnız bu sabit küme. */
export type DidDecodeFn = 'A' | 'AB' | 'temp40' | 'pct' | 'linear' | 'div';

/** `linear`/`div` için katsayılar; diğer fn'ler a/b'yi yoksayar. */
export interface DidDecodeSpec {
  fn: DidDecodeFn;
  /** `linear`: çarpan (varsayılan 1). `div`: bölen (varsayılan 1, 0 OLAMAZ). */
  a?: number;
  /** `linear`: toplanan sabit (varsayılan 0). */
  b?: number;
}

export interface VehicleEcuDef {
  /** DID kayıtlarının referans verdiği kısa kimlik (ör. 'engine', 'transmission'). */
  id: string;
  /** Türkçe ad (ör. 'Motor ECU'su'). */
  name: string;
  /** İstek header'ı hex (ör. '7E0'). */
  tx: string;
  /** Yanıt filtre adresi hex (ör. '7E8'). */
  rx: string;
}

export interface VehicleDidDef {
  /** 4 hex haneli DID (ör. 'F190' = VIN). */
  did: string;
  /** `ecus[].id` referansı. */
  ecu: string;
  /** Türkçe kısa ad — UI/sesli asistan bu adı kullanır. */
  name: string;
  /** Birim ('°C', '%'…) — boş string birimsiz demek. */
  unit: string;
  /** Beklenen minimum data bayt sayısı (1 → A baz alınır, ≥2 → AB baz alınır). */
  bytes: number;
  min: number;
  max: number;
  /** Serbest metin gruplama kategorisi (StandardPidRegistry'nin sabit union'ından bilinçli
   *  olarak ayrık — üretici DID'leri 'sanziman'/'karoser' gibi yeni kategoriler gerektirebilir). */
  category: string;
  decode: DidDecodeSpec;
}

export interface VehicleDidProfile {
  brand: string;
  note?: string;
  /** ZORUNLU — kamu doküman referansı (ör. "ISO 14229-1 Tablo A.1" / servis kılavuzu adı). */
  source: string;
  ecus: VehicleEcuDef[];
  dids: VehicleDidDef[];
}

/* ── Doğrulama sonucu ─────────────────────────────────────────────────────── */

export type VehicleDidProfileValidation =
  | { valid: true; profile: VehicleDidProfile }
  | { valid: false; errors: string[] };

const VALID_DECODE_FNS: ReadonlySet<string> = new Set(['A', 'AB', 'temp40', 'pct', 'linear', 'div']);
const DID_HEX_RE = /^[0-9A-Fa-f]{4}$/;
const ECU_ADDR_RE = /^[0-9A-Fa-f]{3,8}$/;

/**
 * Profili doğrular. Bozuk/eksik/tutarsız profil YÜKLENMEZ — `valid:false` + insan-okur
 * hata listesi döner (eval/DSL yok, yalnız alan/tip/referans bütünlüğü kontrolü).
 */
export function validateVehicleDidProfile(input: unknown): VehicleDidProfileValidation {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: ['profil bir nesne olmalı'] };
  }
  const p = input as Record<string, unknown>;

  if (typeof p.brand !== 'string' || p.brand.trim().length === 0) {
    errors.push('brand: boş olmayan string olmalı');
  }
  if (typeof p.source !== 'string' || p.source.trim().length === 0) {
    errors.push('source: ZORUNLU — kamu doküman referansı (boş olamaz)');
  }
  if (p.note !== undefined && typeof p.note !== 'string') {
    errors.push('note: string olmalı (opsiyonel)');
  }

  const ecuIds = new Set<string>();
  if (!Array.isArray(p.ecus) || p.ecus.length === 0) {
    errors.push('ecus: en az 1 öğeli dizi olmalı');
  } else {
    p.ecus.forEach((raw, i) => {
      if (typeof raw !== 'object' || raw === null) { errors.push(`ecus[${i}]: nesne olmalı`); return; }
      const e = raw as Record<string, unknown>;
      if (typeof e.id !== 'string' || e.id.trim().length === 0) {
        errors.push(`ecus[${i}].id: boş olmayan string olmalı`);
      } else if (ecuIds.has(e.id)) {
        errors.push(`ecus[${i}].id: yinelenen id '${e.id}'`);
      } else {
        ecuIds.add(e.id);
      }
      if (typeof e.name !== 'string' || e.name.trim().length === 0) errors.push(`ecus[${i}].name: boş olmayan string olmalı`);
      if (typeof e.tx !== 'string' || !ECU_ADDR_RE.test(e.tx)) errors.push(`ecus[${i}].tx: geçersiz hex adres`);
      if (typeof e.rx !== 'string' || !ECU_ADDR_RE.test(e.rx)) errors.push(`ecus[${i}].rx: geçersiz hex adres`);
    });
  }

  if (!Array.isArray(p.dids) || p.dids.length === 0) {
    errors.push('dids: en az 1 öğeli dizi olmalı');
  } else {
    const didSeen = new Set<string>();
    p.dids.forEach((raw, i) => {
      if (typeof raw !== 'object' || raw === null) { errors.push(`dids[${i}]: nesne olmalı`); return; }
      const d = raw as Record<string, unknown>;

      if (typeof d.did !== 'string' || !DID_HEX_RE.test(d.did)) {
        errors.push(`dids[${i}].did: 4 hex haneli olmalı (ör. 'F190')`);
      } else {
        const key = d.did.toUpperCase();
        if (didSeen.has(key)) errors.push(`dids[${i}].did: yinelenen DID '${key}'`);
        else didSeen.add(key);
      }

      if (typeof d.ecu !== 'string' || d.ecu.trim().length === 0) {
        errors.push(`dids[${i}].ecu: boş olmayan string olmalı`);
      } else if (ecuIds.size > 0 && !ecuIds.has(d.ecu)) {
        errors.push(`dids[${i}].ecu: '${d.ecu}' ecus listesinde tanımlı değil`);
      }

      if (typeof d.name !== 'string' || d.name.trim().length === 0) errors.push(`dids[${i}].name: boş olmayan string olmalı`);
      if (typeof d.unit !== 'string') errors.push(`dids[${i}].unit: string olmalı (birimsiz için boş string)`);
      if (typeof d.bytes !== 'number' || !Number.isInteger(d.bytes) || d.bytes < 1) {
        errors.push(`dids[${i}].bytes: pozitif tam sayı olmalı`);
      }
      if (typeof d.min !== 'number' || !Number.isFinite(d.min)) errors.push(`dids[${i}].min: sonlu sayı olmalı`);
      if (typeof d.max !== 'number' || !Number.isFinite(d.max)) errors.push(`dids[${i}].max: sonlu sayı olmalı`);
      if (typeof d.min === 'number' && typeof d.max === 'number' && d.min > d.max) {
        errors.push(`dids[${i}]: min (${d.min}) > max (${d.max})`);
      }
      if (typeof d.category !== 'string' || d.category.trim().length === 0) {
        errors.push(`dids[${i}].category: boş olmayan string olmalı`);
      }

      if (typeof d.decode !== 'object' || d.decode === null) {
        errors.push(`dids[${i}].decode: nesne olmalı`);
      } else {
        const dec = d.decode as Record<string, unknown>;
        if (typeof dec.fn !== 'string' || !VALID_DECODE_FNS.has(dec.fn)) {
          errors.push(`dids[${i}].decode.fn: geçersiz — izin verilen: ${[...VALID_DECODE_FNS].join(', ')}`);
        } else {
          if (dec.a !== undefined && typeof dec.a !== 'number') errors.push(`dids[${i}].decode.a: sayı olmalı`);
          if (dec.b !== undefined && typeof dec.b !== 'number') errors.push(`dids[${i}].decode.b: sayı olmalı`);
          if (dec.fn === 'div' && dec.a === 0) errors.push(`dids[${i}].decode: 'div' fonksiyonunda a=0 olamaz (sıfıra bölme)`);
        }
      }
    });
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, profile: input as VehicleDidProfile };
}

/* ── Derleme (Map'e — hot-path alokasyonsuz) ─────────────────────────────── */

export interface CompiledDidDef {
  did: string;
  ecuId: string;
  tx: string;
  rx: string;
  name: string;
  unit: string;
  bytes: number;
  min: number;
  max: number;
  category: string;
  /** Ham data baytları → fiziksel değer. Geçersiz girişte NaN (StandardPidRegistry ile aynı sözleşme). */
  decode: (b: number[]) => number;
}

const A = (b: number[]) => b[0]!;
const AB = (b: number[]) => b[0]! * 256 + b[1]!;
/** `linear`/`div` için "raw" seçimi: 1 bayt → A, ≥2 bayt → AB (StandardPidRegistry formülleriyle tutarlı). */
const rawFor = (bytes: number, b: number[]): number => (bytes <= 1 ? A(b) : AB(b));

function compileDidDecoder(spec: DidDecodeSpec, bytes: number): (b: number[]) => number {
  switch (spec.fn) {
    case 'A': return (b) => A(b);
    case 'AB': return (b) => AB(b);
    case 'temp40': return (b) => A(b) - 40;
    case 'pct': return (b) => A(b) / 2.55;
    case 'linear': {
      const a = spec.a ?? 1;
      const bb = spec.b ?? 0;
      return (b) => rawFor(bytes, b) * a + bb;
    }
    case 'div': {
      const a = spec.a ?? 1;
      return (b) => rawFor(bytes, b) / a;
    }
    default:
      return () => NaN; // validateVehicleDidProfile bunu zaten reddeder — savunmacı sınır
  }
}

/**
 * Doğrulanmış profili çalışma-zamanı Map'ine derler (DID → tanım, ecu tx/rx çözülmüş).
 * Doğrulanmamış profil ile çağrılırsa (çağıran validateVehicleDidProfile'ı atladıysa)
 * referansı bozuk DID'ler sessizce ATLANIR (savunmacı — asıl doğrulama yükleme noktasında olmalı).
 */
export function compileVehicleDidProfile(profile: VehicleDidProfile): ReadonlyMap<string, CompiledDidDef> {
  const ecuMap = new Map(profile.ecus.map((e) => [e.id, e] as const));
  const out = new Map<string, CompiledDidDef>();
  for (const d of profile.dids) {
    const ecu = ecuMap.get(d.ecu);
    if (!ecu) continue;
    const did = d.did.toUpperCase();
    out.set(did, {
      did,
      ecuId: ecu.id,
      tx: ecu.tx,
      rx: ecu.rx,
      name: d.name,
      unit: d.unit,
      bytes: d.bytes,
      min: d.min,
      max: d.max,
      category: d.category,
      decode: compileDidDecoder(d.decode, d.bytes),
    });
  }
  return out;
}

/**
 * Ham hex data string'ini derlenmiş DID tanımıyla çözer (StandardPidRegistry.decodeStandardPid
 * ile AYNI sözleşme): bayt sayısı yetersiz / sınır dışı / NaN → NaN (çağıran atlar, fail-soft).
 */
export function decodeCompiledDid(def: CompiledDidDef, dataHex: string): number {
  const clean = dataHex.replace(/[^0-9A-Fa-f]/g, '');
  if (clean.length < def.bytes * 2) return NaN;
  const bytes: number[] = [];
  for (let i = 0; i < def.bytes; i++) {
    bytes.push(parseInt(clean.substring(i * 2, i * 2 + 2), 16));
  }
  if (bytes.some((x) => Number.isNaN(x))) return NaN;
  const value = def.decode(bytes);
  if (!Number.isFinite(value) || value < def.min || value > def.max) return NaN;
  return value;
}
