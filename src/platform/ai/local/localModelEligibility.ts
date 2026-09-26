/**
 * localModelEligibility.ts — HYBRID-F1 · Yerel LLM Runtime UYGUNLUK KARARI (SAF).
 *
 * ── TEK SORU ─────────────────────────────────────────────────────────────────
 * "Bu cihaz CarOS yerel LLM runtime'ı için uygun mu?" Bu modül BAŞKA HİÇBİR ŞEY
 * yapmaz: model indirmez, JNI/llama.cpp/provider çalıştırmaz, routing üretmez,
 * Mavi davranışını değiştirmez. Yalnız DIŞARIDAN verilen kanıtı değerlendirip
 * `eligible` / `ineligible` / `unknown` döner (HYBRID-F0 repo denetimi §5-7).
 *
 * ── SAFLIK (semanticEndpointer/duplexCapability ile AYNI sözleşme) ──────────
 *  · I/O · timer · `Date.now` · `Math.random` · global mutable durum YOK.
 *  · **ÖLÇÜM YAPMAZ.** Native API çağırmaz, `fetch` yapmaz, hiçbir platform
 *    modülünü (voiceService, maviActionAuthority, CarLauncher, thermalWatchdog,
 *    memoryWatchdog) import ETMEZ. Kanıt (`LocalModelEligibilityEvidence`)
 *    TAMAMEN çağıran tarafından DI ile verilir — bu dosya onu nereden aldığını
 *    bilmez (yaprak modül).
 *  · Aynı girdi → HER ZAMAN aynı çıktı (deterministik, test edilebilir).
 *
 * ── TEK İSTİSNA: `DeviceTier` TİPİ ──────────────────────────────────────────
 * `deviceTier` alanı `../../deviceCapabilities`'in KANONİK `DeviceTier` tipini
 * type-only import eder (`capabilityRegistry.ts` ile AYNI desen). Bu, tipi
 * KOPYALAMAK yerine PAYLAŞMAKTIR — `verbatimModuleSyntax` sayesinde derlenmiş
 * çıktıda hiçbir iz bırakmaz (sıfır runtime bağı). `getDeviceTier()` FONKSİYONU
 * bu dosyada ASLA çağrılmaz/taşınmaz/kopyalanmaz — tier kararı DIŞARIDAN, zaten
 * hesaplanmış olarak gelir.
 *
 * ── OTORİTE KURALI (CLAUDE.md §6 TEK OTORİTE) ───────────────────────────────
 * `deviceCapabilities.ts:getDeviceTier()` cihaz sınıfının TEK otoritesidir ve
 * bu modül onu EZMEZ, yeniden hesaplamaz, ikinci bir cihaz sınıflandırması
 * KURMAZ. Burada üretilen "eligibility" YALNIZ yerel-model-özel bir karardır;
 * `deviceTier` bu kararın bir GİRDİSİDİR, kendisi değil.
 *
 * ── FAIL-CLOSED (EN ÖNEMLİ KURAL) ───────────────────────────────────────────
 * **`unknown` ASLA `eligible` anlamına gelmez.** Eksik/geçersiz kanıt → ilgili
 * alan için `unknown` döner; "muhtemelen uygun" gibi iyimser bir varsayım
 * YAPILMAZ. `eligible` YALNIZ tüm zorunlu kanıt mevcut VE eşikleri geçtiyse
 * üretilir.
 *
 * ── KARAR ÖNCELİĞİ (deterministik, TEK sıralı geçiş) ────────────────────────
 * Alanlar SABİT bir sırada, biri biri ardına değerlendirilir; İLK tetiklenen
 * kural sonucu belirler (en açıklayıcı/en temel sinyal ÖNCE — `maviModelOrchestrator`
 * "en açıklayıcı gerekçe kazanır" ilkesiyle aynı ruh):
 *
 *   1. deviceTier ('high' değilse)         → ineligible(device_tier_low/mid)
 *   2. isLowRamDevice (bilinmiyor/true)     → unknown veya ineligible(low_ram_device)
 *   3. supportedAbis (bilinmiyor/arm64 yok) → unknown veya ineligible(abi_unsupported)
 *   4. totalRamMb (bilinmiyor/yetersiz)     → unknown veya ineligible(total_ram_insufficient)
 *   5. usableStorageMb (bilinmiyor/yetersiz)→ unknown veya ineligible(storage_insufficient)
 *   6. thermalLevel (VARSA ve bloklarsa)    → ineligible(thermal_blocked)
 *   7. memoryPressureLevel (VARSA CRITICAL) → ineligible(memory_pressure_blocked)
 *   8. hepsi geçti                          → eligible('small_local_llm')
 *
 * Her alan için ÖNCE "bilinmiyor mu" sorulur, SONRA "eşiği geçiyor mu" — yani
 * bir alanın `unknown` durumu, o alanın "kötü değer" kontrolünden ÖNCE gelir.
 * Bu, aynı alan için hem unknown hem ineligible testinin AYNI konumda ve
 * öngörülebilir şekilde çalışmasını sağlar.
 *
 * ── BU FAZIN İLK REFERANS POLİTİKASI (konservatif, model YOK) ───────────────
 * Henüz gerçek runtime/model olmadığı için eşikler kasıtlı KATIDIR:
 *   - deviceTier === 'high' ZORUNLU
 *   - supportedAbis 'arm64-v8a' İÇERMELİ
 *   - totalRamMb >= 6144 MB
 *   - isLowRamDevice === false
 *   - usableStorageMb >= 4096 MB (gelecekte gerçek model boyutu belirlenince
 *     bu sayı GÖZDEN GEÇİRİLİR — bu fazda model-spesifik hesap YAPILMAZ)
 *   - thermalLevel/memoryPressureLevel OPSİYONELDİR: yalnız VARSA ve BLOKLUYORSA
 *     eligible engellenir; yoksa (ölçülmediyse) eligible'ı ENGELLEMEZ.
 *
 * `available_ram_insufficient` ve `sdk_unsupported` sebep değerleri KULLANICI
 * TARAFINDAN önerilen sözleşmenin parçası olarak tipte TUTULUR (API kararlılığı
 * — sonraki fazda gerçek model belleği/SDK gereksinimi netleşince değerlendirmeye
 * alınabilir) ama BU FAZ onları HİÇBİR ZAMAN ÜRETMEZ (availMemMb/sdkInt kanıt
 * olarak taşınır, gözlem amaçlıdır — eşik uygulanmaz).
 */

import type { DeviceTier } from '../../deviceCapabilities';

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç profili (bu fazda TEK profil — gelecekte model boyutuna göre çoğalabilir)
 * ════════════════════════════════════════════════════════════════════════ */

export type LocalModelProfile = 'small_local_llm';

/* ══════════════════════════════════════════════════════════════════════════
 * Sebep tipleri (açık union — kullanıcı sözleşmesiyle BİREBİR)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Uygunsuzluk sebebi. `available_ram_insufficient` ve `sdk_unsupported` bu
 * fazda ÜRETİLMEZ (yukarıdaki dosya başlığına bkz.) — tip sözleşmesinde API
 * kararlılığı için tutulur.
 */
export type LocalModelIneligibilityReason =
  | 'device_tier_low'
  | 'device_tier_mid'
  | 'low_ram_device'
  | 'abi_unsupported'
  | 'total_ram_insufficient'
  | 'available_ram_insufficient'   // reserved — bu fazda üretilmez
  | 'storage_insufficient'
  | 'sdk_unsupported'              // reserved — bu fazda üretilmez
  | 'thermal_blocked'
  | 'memory_pressure_blocked';

/** Karar için kanıt eksik/geçersiz olduğunda üretilen sebep. */
export type LocalModelUnknownReason =
  | 'total_ram_unknown'
  | 'abi_unknown'
  | 'storage_unknown'
  | 'capability_evidence_incomplete';

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt sözleşmesi (girdi — bu modül HİÇBİRİNİ ÖLÇMEZ, yalnız DEĞERLENDİRİR)
 * ════════════════════════════════════════════════════════════════════════ */

export interface LocalModelEligibilityEvidence {
  /** Kanonik cihaz sınıfı — `deviceCapabilities.getDeviceTier()`ın SONUCUDUR, burada YENİDEN HESAPLANMAZ. */
  readonly deviceTier: DeviceTier;
  /** `ActivityManager.isLowRamDevice()` (HYBRID-F0: `NativeResourceEvidence.isLowRamDevice`). `undefined` = bilinmiyor. */
  readonly isLowRamDevice?: boolean;
  /** `Build.SUPPORTED_ABIS` (HYBRID-F0: `NativeResourceEvidence.supportedAbis`). Boş/`undefined` = bilinmiyor. */
  readonly supportedAbis?: readonly string[];
  /** Toplam RAM (MB) — HYBRID-F0: `NativeResourceEvidence.totalRamMb`. `undefined`/≤0/NaN = bilinmiyor. */
  readonly totalRamMb?: number;
  /**
   * Anlık kullanılabilir RAM (MB) — HYBRID-F0: `NativeResourceEvidence.availMemMb`.
   * GÖZLEM amaçlı taşınır; bu fazda EŞİK UYGULANMAZ (model boyutu henüz bilinmiyor).
   */
  readonly availMemMb?: number;
  /** Boş depolama (MB) — HYBRID-F0: `NativeResourceEvidence.usableStorageMb`. `undefined`/≤0/NaN = bilinmiyor. */
  readonly usableStorageMb?: number;
  /** CPU çekirdek sayısı — GÖZLEM amaçlı taşınır; `deviceTier` zaten bu sinyali kapsar, ayrı eşik UYGULANMAZ. */
  readonly cpuCoreCount?: number;
  /** `Build.VERSION.SDK_INT` — GÖZLEM amaçlı taşınır; bu fazda EŞİK UYGULANMAZ. */
  readonly sdkInt?: number;
  /**
   * Termal seviye (0-3, `thermalWatchdog.ThermalLevel` ile AYNI ölçek — tip
   * BAĞIMSIZ tanımlanır, modül import ETMEZ). OPSİYONEL: yoksa eligible'ı
   * ENGELLEMEZ; varsa VE ≥2 (MODERATE/SEVERE) ise bloklar.
   */
  readonly thermalLevel?: 0 | 1 | 2 | 3;
  /**
   * Bellek baskısı (`memoryWatchdog.MemoryPressureLevel` ile AYNI ölçek — tip
   * BAĞIMSIZ tanımlanır). OPSİYONEL: yoksa eligible'ı ENGELLEMEZ; `'CRITICAL'`
   * ise bloklar. `'MODERATE'` bu fazda BLOKLAMAZ (yalnız CRITICAL — SAFE_MODE
   * eşdeğeri gerçek risk sinyali; MODERATE'ta değerlendirme sonraki faza kalır).
   */
  readonly memoryPressureLevel?: 'MODERATE' | 'CRITICAL';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

export interface LocalModelEligibilityEligible {
  readonly status:   'eligible';
  readonly profile:  LocalModelProfile;
  readonly evidence: LocalModelEligibilityEvidence;
}

export interface LocalModelEligibilityIneligible {
  readonly status:   'ineligible';
  readonly reason:   LocalModelIneligibilityReason;
  readonly evidence: LocalModelEligibilityEvidence;
}

export interface LocalModelEligibilityUnknown {
  readonly status:   'unknown';
  readonly reason:   LocalModelUnknownReason;
  readonly evidence: LocalModelEligibilityEvidence;
}

export type LocalModelEligibility =
  | LocalModelEligibilityEligible
  | LocalModelEligibilityIneligible
  | LocalModelEligibilityUnknown;

/* ══════════════════════════════════════════════════════════════════════════
 * Eşikler (bu fazın konservatif İLK REFERANS POLİTİKASI — provizyonel)
 * ════════════════════════════════════════════════════════════════════════ */

/** Zorunlu ABI — bu fazda yalnız arm64-v8a uygun sayılır (armeabi-v7a hariç). */
const REQUIRED_ABI = 'arm64-v8a';

/** Toplam RAM alt sınırı (MB) — kullanıcı tarafından açıkça verilen ilk eşik. */
const MIN_TOTAL_RAM_MB = 6144;

/**
 * Kullanılabilir depolama alt sınırı (MB) — PROVİZYONEL: henüz gerçek model
 * boyutu bilinmiyor (F6'da model indirme fazına kadar). 4096 MB, gelecekteki
 * küçük bir yerel model paketi + runtime + makul bir pay için konservatif bir
 * ilk referanstır; model boyutu netleşince BU SAYI GÖZDEN GEÇİRİLMELİDİR.
 */
const MIN_USABLE_STORAGE_MB = 4096;

/** Bu seviyeden itibaren (dahil) termal durum yerel model yüklemesini bloklar. */
const THERMAL_BLOCK_LEVEL = 2;

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar (saf, dışa açılmaz)
 * ════════════════════════════════════════════════════════════════════════ */

function isKnownPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Karar fonksiyonu — TEK giriş noktası
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Saf karar fonksiyonu. ASLA throw etmez, ASLA I/O yapmaz. Aynı `evidence` →
 * her zaman aynı sonuç. Kanıt eksikse `unknown`; hiçbir koşulda `unknown` bir
 * `eligible` sonucuna DÖNÜŞMEZ.
 */
export function decideLocalModelEligibility(
  evidence: LocalModelEligibilityEvidence,
): LocalModelEligibility {
  const ineligible = (reason: LocalModelIneligibilityReason): LocalModelEligibilityIneligible =>
    Object.freeze({ status: 'ineligible', reason, evidence });
  const unknown = (reason: LocalModelUnknownReason): LocalModelEligibilityUnknown =>
    Object.freeze({ status: 'unknown', reason, evidence });

  /* 1) Kanonik cihaz sınıfı — TEK otoriteden gelen, burada YENİDEN HESAPLANMAYAN
        girdi. 'high' değilse yerel model bu fazda hiçbir koşulda uygun değildir. */
  if (evidence.deviceTier !== 'high') {
    return ineligible(evidence.deviceTier === 'low' ? 'device_tier_low' : 'device_tier_mid');
  }

  /* 2) İşletim sisteminin KENDİ "düşük RAM cihazı" beyanı — Android'in kendi
        sinyali, tier'dan bağımsız ek bir güvence. */
  if (typeof evidence.isLowRamDevice !== 'boolean') {
    return unknown('capability_evidence_incomplete');
  }
  if (evidence.isLowRamDevice === true) {
    return ineligible('low_ram_device');
  }

  /* 3) ABI — llama.cpp sınıfı bir runtime için 64-bit zorunlu (bu fazda armeabi-v7a
        yapısal olarak dışarıda; bkz. HYBRID-F0 repo denetimi §8). */
  const abis = evidence.supportedAbis;
  if (!Array.isArray(abis) || abis.length === 0) {
    return unknown('abi_unknown');
  }
  if (!abis.includes(REQUIRED_ABI)) {
    return ineligible('abi_unsupported');
  }

  /* 4) Toplam RAM. */
  if (!isKnownPositiveNumber(evidence.totalRamMb)) {
    return unknown('total_ram_unknown');
  }
  if (evidence.totalRamMb < MIN_TOTAL_RAM_MB) {
    return ineligible('total_ram_insufficient');
  }

  /* 5) Kullanılabilir depolama. */
  if (!isKnownPositiveNumber(evidence.usableStorageMb)) {
    return unknown('storage_unknown');
  }
  if (evidence.usableStorageMb < MIN_USABLE_STORAGE_MB) {
    return ineligible('storage_insufficient');
  }

  /* 6) Termal durum — OPSİYONEL gate: yalnız VARSA ve BLOKLUYORSA engeller. */
  if (typeof evidence.thermalLevel === 'number' && evidence.thermalLevel >= THERMAL_BLOCK_LEVEL) {
    return ineligible('thermal_blocked');
  }

  /* 7) Bellek baskısı — OPSİYONEL gate: yalnız CRITICAL engeller. */
  if (evidence.memoryPressureLevel === 'CRITICAL') {
    return ineligible('memory_pressure_blocked');
  }

  /* 8) Tüm zorunlu kanıt mevcut VE eşikleri geçti → uygun. */
  return Object.freeze({ status: 'eligible', profile: 'small_local_llm', evidence });
}
