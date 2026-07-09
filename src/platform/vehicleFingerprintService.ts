/**
 * vehicleFingerprintService — Araç Parmak İzi TEMEL katmanı (PR-25, foundation-only).
 *
 * AMAÇ (VİZYON — "aracın ikinci beyni"): bilinmeyen aftermarket araçları ÖĞRENMEK için
 * her aracı deterministik, tekrar-üretilebilir bir kimlikle (fingerprint) tanımak. Aynı
 * araç tekrar bağlandığında — VIN olsun olmasın — onu güvenle tanıyıp önceki bağlamı
 * (profil/keşif/ayar) geri getirebilmenin temeli budur.
 *
 * KAPSAM (SADECE FOUNDATION):
 *   - SAF normalize + builder + deterministik hash (React/native/DOM importu YOK).
 *   - safeStorage tabanlı bounded (max 8) LRU kalıcı önbellek.
 *   - Matcher TEMELİ (confidence 1.0 / 0.80 / 0.30).
 *
 * BU PR'DA YAPILMAYANLAR (bilinçli):
 *   - OBD poll / hot-path'e DOKUNULMAZ (bu servis hiçbir polling'e abone olmaz).
 *   - useVidStore / herhangi bir store'a subscribe BAĞLANMAZ (yalnız saf API + kalıcılık).
 *   - Discovery Pipeline / native / SQL-Supabase mantığı DEĞİŞMEZ.
 *
 * ZERO-TRUST: girdi telemetrisi güvenilmez (aftermarket) → tüm alanlar normalize edilir,
 * eksik alanlar güvenli boşa (''/[]/{}) düşer, "imkânsız" değer hash'i patlatmaz.
 * V8/JIT: template-literal tam-şekilli objeler (hidden-class kararlılığı), delete YOK.
 */

import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Serbest metadata — hash'e GİRMEZ (yalnız görüntü/eşleşme ipuçları). adapterMac düşük-güven
 * (0.30) matcher tarafından kullanılır; firmware/label salt-bilgi.
 */
export interface VehicleFingerprintMetadata {
  /** OBD adaptörünün Bluetooth MAC'i — yalnız düşük-güven (0.30) eşleşme ipucu. */
  adapterMac?:      string;
  /** ECU firmware/kalibrasyon sürümü (biliniyorsa). */
  firmwareVersion?: string;
  /** Kullanıcı/otomatik etiket (görüntü). */
  label?:           string;
}

/** buildFingerprint girdisi — bilinen alanlar geçilir, gerisi güvenli boşa düşer. */
export interface VehicleFingerprintInput {
  vin?:                string;
  protocol?:           string;
  ecuAddresses?:       readonly string[];
  /** Desteklenen PID bitmap'i (hex string, ör. Mode 01 PID 00/20/40… birleşimi). */
  supportedPidBitmap?: string;
  metadata?:           VehicleFingerprintMetadata;
}

/** Kalıcı araç parmak izi kaydı — hash kimliktir; zaman alanları yalnız LRU/gösterim. */
export interface VehicleFingerprint {
  /** Deterministik kimlik (VIN+protocol+ECU+bitmap türevi; metadata/zaman DAHİL DEĞİL). */
  hash:               string;
  vin:                string;
  protocol:           string;
  /** Normalize + tekilleştirilmiş + SIRALI (sıra hash'i değiştirmez). */
  ecuAddresses:       string[];
  /** Normalize + trailing-zero temizlenmiş PID bitmap. */
  supportedPidBitmap: string;
  metadata:           VehicleFingerprintMetadata;
  firstSeen:          number;
  lastSeen:           number;
}

/** Matcher sonucu — dürüst güven + gerekçe. */
export type VehicleMatchReason = 'vin' | 'signature' | 'adapter-mac' | 'none';

export interface VehicleMatchResult {
  confidence: number;            // 1.0 | 0.80 | 0.30 | 0
  reason:     VehicleMatchReason;
  /** Eşleşen kayıt hash'i (varsa). */
  hash:       string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Normalize edilebilir yardımcılar (SAF)
 * ════════════════════════════════════════════════════════════════════════ */

/** VIN: trim + büyük harf + tüm boşlukları kaldır. Bilinmiyorsa ''. */
export function normalizeVin(vin: string | undefined | null): string {
  return (vin ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * ECU adresi: büyük harf hex, boşluksuz, '0X' öneki temizlenir. Ör. ' 0x7e8 ' → '7E8'.
 * Baştaki anlamlı sıfırlar KORUNUR (11-bit '7E8' vs 29-bit '18DAF110' ayrımı).
 */
export function normalizeEcuAddress(addr: string | undefined | null): string {
  return (addr ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
}

/**
 * Bir hex string'in SONUNDAKİ tam sıfır bayt ('00') dolgusunu temizler.
 * '00' dolgusu farklı uzunlukta bitmap'lerin AYNI parmak izini vermesini sağlar
 * (aftermarket adaptörler bitmap'i değişken uzunlukta sıfır-dolgulu döndürebilir).
 * Örn. 'BE1FA813' ↔ 'BE1FA81300' ↔ 'BE1FA8130000' → hepsi 'BE1FA813'.
 */
export function stripTrailingZeroBytes(hex: string): string {
  let out = hex;
  // Çift-haneli tam sıfır bayt olduğu sürece sondan kırp.
  while (out.length >= 2 && out.slice(-2) === '00') {
    out = out.slice(0, -2);
  }
  return out;
}

/**
 * PID bitmap: hex-dışı karakterleri at, büyük harf, tek-hane kalırsa başa sıfır ekleyip
 * bayt-hizala, sonra trailing '00' bayt dolgusunu temizle. Boş/hex-yoksa ''.
 */
export function normalizePidBitmap(bitmap: string | undefined | null): string {
  let hex = (bitmap ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
  if (hex.length === 0) return '';
  if (hex.length % 2 === 1) hex = `0${hex}`; // bayt-hizala (tek hane → 0X)
  return stripTrailingZeroBytes(hex);
}

/** ECU adres listesini normalize + boşları at + tekilleştir + SIRALA (sıra-bağımsız kimlik). */
export function normalizeEcuAddresses(addresses: readonly string[] | undefined | null): string[] {
  const seen = new Set<string>();
  for (const a of addresses ?? []) {
    const n = normalizeEcuAddress(a);
    if (n) seen.add(n);
  }
  return [...seen].sort();
}

/* ══════════════════════════════════════════════════════════════════════════
 * Deterministik hash (SAF — harici bağımlılık yok)
 * ════════════════════════════════════════════════════════════════════════ */

/** FNV-1a 32-bit — taşma-güvenli (Math.imul); tohumla varyant üretilebilir. */
function fnv1a32(str: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Bir parmak izinin KANONİK kimlik metni — hash yalnız bundan türer.
 * DAHİL: VIN, protocol, SIRALI ECU adresleri, normalize PID bitmap.
 * HARİÇ: metadata (adapterMac/firmware/label) ve zaman alanları (kimlik oynamasın).
 */
export function canonicalFingerprintKey(fp: {
  vin: string; protocol: string; ecuAddresses: readonly string[]; supportedPidBitmap: string;
}): string {
  return `V:${fp.vin}|P:${fp.protocol.toUpperCase()}|E:${fp.ecuAddresses.join(',')}|B:${fp.supportedPidBitmap}`;
}

/**
 * Kanonik metinden deterministik 16-haneli hex kimlik. İki farklı tohumla FNV-1a
 * birleştirilerek çakışma olasılığı düşürülür (kriptografik değil — yalnız kimlik).
 */
export function fingerprintHash(key: string): string {
  const a = fnv1a32(key, 0x811c9dc5);
  const b = fnv1a32(key, 0x01000193);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/* ══════════════════════════════════════════════════════════════════════════
 * Builder
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Ham girdiden TAM-şekilli, normalize edilmiş, deterministik-hash'li parmak izi üretir.
 * @param now zaman damgası (test için enjekte edilebilir) — kimliğe DAHİL DEĞİL.
 */
export function buildFingerprint(input: VehicleFingerprintInput, now: number = Date.now()): VehicleFingerprint {
  const vin                = normalizeVin(input.vin);
  const protocol           = (input.protocol ?? '').trim().toUpperCase();
  const ecuAddresses       = normalizeEcuAddresses(input.ecuAddresses);
  const supportedPidBitmap = normalizePidBitmap(input.supportedPidBitmap);
  const metadata: VehicleFingerprintMetadata = {
    adapterMac:      input.metadata?.adapterMac      ? input.metadata.adapterMac.trim().toUpperCase() : undefined,
    firmwareVersion: input.metadata?.firmwareVersion ?? undefined,
    label:           input.metadata?.label           ?? undefined,
  };
  const hash = fingerprintHash(
    canonicalFingerprintKey({ vin, protocol, ecuAddresses, supportedPidBitmap }),
  );
  return {
    hash,
    vin,
    protocol,
    ecuAddresses,
    supportedPidBitmap,
    metadata,
    firstSeen: now,
    lastSeen:  now,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Matcher TEMELİ
 * ════════════════════════════════════════════════════════════════════════ */

/** İki parmak izinin imza (protocol + ECU + bitmap) çekirdeği aynı mı. */
function signatureEquals(a: VehicleFingerprint, b: VehicleFingerprint): boolean {
  return a.protocol === b.protocol &&
         a.supportedPidBitmap === b.supportedPidBitmap &&
         a.ecuAddresses.length === b.ecuAddresses.length &&
         a.ecuAddresses.every((e, i) => e === b.ecuAddresses[i]); // ikisi de sıralı
}

/**
 * İki parmak izini eşleştirir (dürüst güven):
 *   - Aynı (boş-olmayan) VIN                         → 1.00 ('vin')
 *   - VIN yok (birinde) ama protocol+ECU+bitmap aynı → 0.80 ('signature')
 *   - Yalnız OBD adaptör MAC'i aynı                  → 0.30 ('adapter-mac')
 *   - Aksi halde                                     → 0    ('none')
 */
export function matchFingerprint(a: VehicleFingerprint, b: VehicleFingerprint): VehicleMatchResult {
  if (a.vin && b.vin && a.vin === b.vin) {
    return { confidence: 1.0, reason: 'vin', hash: b.hash };
  }
  // İmza eşleşmesi: en az birinde VIN yoksa (VIN varsa ve farklıysa aynı araç sayılmaz).
  if ((!a.vin || !b.vin) && signatureEquals(a, b) && a.supportedPidBitmap !== '') {
    return { confidence: 0.8, reason: 'signature', hash: b.hash };
  }
  const macA = a.metadata.adapterMac;
  const macB = b.metadata.adapterMac;
  if (macA && macB && macA === macB) {
    return { confidence: 0.3, reason: 'adapter-mac', hash: b.hash };
  }
  return { confidence: 0, reason: 'none', hash: null };
}

/** Aday parmak izine bir liste içindeki EN YÜKSEK güvenli eşleşmeyi döndürür. */
export function findBestMatch(
  candidate: VehicleFingerprint,
  known: readonly VehicleFingerprint[],
): VehicleMatchResult {
  let best: VehicleMatchResult = { confidence: 0, reason: 'none', hash: null };
  for (const k of known) {
    const m = matchFingerprint(candidate, k);
    if (m.confidence > best.confidence) best = m;
    if (best.confidence >= 1.0) break; // daha iyisi yok
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded (max 8) LRU kalıcı depo — safeStorage
 * ════════════════════════════════════════════════════════════════════════ */

/** safeStorage LRU_PROTECTED anahtarı (kota dolunca SİLİNMEZ — bkz. safeStorage.ts). */
export const VEHICLE_FINGERPRINT_STORAGE_KEY = 'car-vehicle-fingerprints';
/** En fazla bu kadar araç saklanır; taşınca en az-yakın-zamanda-görülen düşer. */
export const MAX_FINGERPRINTS = 8;

/**
 * Araç parmak izi deposu — bounded (max 8) LRU, safeStorage ile kalıcı, ağ YOK.
 * En yeni-görülen BAŞTA tutulur; save() kaydı öne taşır (LRU recency); taşınca kuyruğun
 * SONU (en eski görülen) düşer. Bozuk veri → fail-soft boş liste (zero-trust disk).
 */
export class VehicleFingerprintStore {
  private _items: VehicleFingerprint[] = [];
  private _loaded = false;
  private readonly storageKey: string;
  private readonly maxItems: number;

  constructor(storageKey = VEHICLE_FINGERPRINT_STORAGE_KEY, maxItems = MAX_FINGERPRINTS) {
    this.storageKey = storageKey;
    this.maxItems = maxItems;
  }

  private _ensureLoaded(): void {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const raw = safeGetRaw(this.storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) this._items = parsed as VehicleFingerprint[];
      }
    } catch {
      this._items = []; // bozuk JSON → dürüstçe boş
    }
  }

  private _persist(): void {
    try {
      safeSetRaw(this.storageKey, JSON.stringify(this._items));
    } catch {
      /* kota/serileştirme — bellek listesi korunur, fail-soft */
    }
  }

  /**
   * Kaydı ekler/günceller (hash kimliğiyle upsert) ve LRU önüne taşır. Var olan kaydın
   * firstSeen'i korunur, lastSeen güncellenir. Taşınca en eski-görülen düşer.
   * @returns saklanan (güncel) kayıt.
   */
  save(fp: VehicleFingerprint): VehicleFingerprint {
    this._ensureLoaded();
    const idx = this._items.findIndex((x) => x.hash === fp.hash);
    let stored: VehicleFingerprint;
    if (idx >= 0) {
      const prev = this._items[idx];
      stored = { ...fp, firstSeen: prev.firstSeen, lastSeen: fp.lastSeen };
      this._items.splice(idx, 1); // eskiyi çıkar, öne taşınacak
    } else {
      stored = fp;
    }
    this._items.unshift(stored); // en yeni-görülen başta
    if (this._items.length > this.maxItems) {
      this._items.length = this.maxItems; // en eski-görülen(ler) düşer (LRU evict)
    }
    this._persist();
    return stored;
  }

  /** hash ile kaydı getirir (kopya) veya null. */
  load(hash: string): VehicleFingerprint | null {
    this._ensureLoaded();
    const found = this._items.find((x) => x.hash === hash);
    return found ? { ...found } : null;
  }

  /** Tüm kayıtların kopyası (en yeni-görülen başta). */
  list(): VehicleFingerprint[] {
    this._ensureLoaded();
    return this._items.map((x) => ({ ...x }));
  }

  /** hash ile kaydı siler. @returns silindi mi. */
  remove(hash: string): boolean {
    this._ensureLoaded();
    const idx = this._items.findIndex((x) => x.hash === hash);
    if (idx < 0) return false;
    this._items.splice(idx, 1);
    this._persist();
    return true;
  }

  /** Depoyu ve kalıcı kaydı tamamen temizler. */
  clear(): void {
    this._items = [];
    this._loaded = true;
    try { safeRemoveRaw(this.storageKey); } catch { /* yoksay */ }
  }

  /** Saklanan araç sayısı. */
  get size(): number {
    this._ensureLoaded();
    return this._items.length;
  }
}

/** Uygulama geneli tekil depo (foundation wiring). Testler kendi örneğini kurar. */
export const vehicleFingerprintStore = new VehicleFingerprintStore();
