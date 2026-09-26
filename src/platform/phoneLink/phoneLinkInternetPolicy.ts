/**
 * phoneLinkInternetPolicy.ts — PHONE LINK F5.3/F5.5/F5.6 · SAF durum türetimi.
 *
 * ── İKİNCİ BİR "İNTERNET VAR MI" OTORİTESİ DEĞİL ────────────────────────────
 * Bu modül `isInternetAvailable()` gibi GLOBAL bir gerçek KURMAZ. Ürettiği şey
 * dar kapsamlı bir KANITTIR: "Phone Link oturumunun internet yolu politika ve
 * OS gözlemine göre hangi durumda". Uygulamanın geri kalanının çevrimiçilik
 * görüşü (kanonik `ConnectivityAuthority`) BU MODÜLE TAŞINMAZ —
 * F5 kapsamında yeni bir global authority açmak yasaktır.
 *
 * ── SAF ─────────────────────────────────────────────────────────────────────
 * Yan etki, IO, timer, native çağrısı YOKTUR. Girdi: (capability kararı +
 * native ağ gerçekleri). Çıktı: durum + kanıt. Bu yüzden tamamen testlenebilir.
 *
 * ── "BAĞLI" ≠ "İNTERNET VAR" (F5.5) ─────────────────────────────────────────
 * Wi-Fi bağlantısı tek başına internet KANITI DEĞİLDİR. `validated`
 * (`NET_CAPABILITY_VALIDATED`) ayrı taşınır ve captive portal ayrı ayırt
 * edilir. Ölçülmemişse `CONNECTED` İDDİA EDİLMEZ.
 */

/** Grant fiziksel ağ DEĞİLDİR — bu iki eksen bilinçli olarak ayrıdır (F5.3). */
export type PhoneInternetState =
  /** Politika izin vermiyor (grant yok / oturum canlı değil). */
  | 'UNAVAILABLE'
  /** Politika izinli ama kullanılabilir bir ağ yolu YOK. */
  | 'AVAILABLE'
  /** Ağ var, doğrulama henüz belirlenmedi — "internet var" İDDİA EDİLMEZ. */
  | 'CONNECTING'
  /** Ağ var + OS doğruladı + captive portal değil. */
  | 'CONNECTED'
  /** Ağ var ama doğrulanmadı veya captive portal arkasında. */
  | 'DEGRADED';

/**
 * Yolun KÖKENİ. `PHONE_HOTSPOT` yalnız KANIT varsa üretilir.
 *
 * ⚠️ Telefonun hotspot'u ile ev/ofis Wi-Fi'ı Android'de AYNI görünür
 * (`TRANSPORT_WIFI`). Phone Link oturumu açık diye mevcut Wi-Fi'ı
 * `PHONE_HOTSPOT` etiketlemek UYDURMA olurdu (F5.6) — bu yüzden Wi-Fi
 * daima `SYSTEM_WIFI`tir. Bugün depoda hotspot kökenini kanıtlayacak bir
 * mekanizma YOKTUR, dolayısıyla `PHONE_HOTSPOT` bu fazda YAPISAL OLARAK
 * ulaşılamazdır — F3'teki `PRIMARY` ile aynı dürüstlük çizgisi.
 */
export type PhoneInternetSource =
  | 'PHONE_HOTSPOT' | 'USB_TETHER' | 'BLUETOOTH_PAN'
  | 'SYSTEM_WIFI' | 'ETHERNET' | 'UNKNOWN';

/** Kaba kalite — ağır ölçüm YOK (F5.13), yalnız OS'un verdiği tahmin. */
export type PhoneInternetQuality = 'UNKNOWN' | 'POOR' | 'USABLE' | 'GOOD';

export type PhoneInternetReason =
  | 'no_grant'
  | 'no_network_path'
  | 'validation_unknown'
  | 'not_validated'
  | 'captive_portal'
  | 'validated';

/** Native'in taşıdığı SINIRLI gerçekler — yorum İÇERMEZ. */
export interface PhoneNetworkFacts {
  readonly present: boolean;
  readonly transport: 'WIFI' | 'ETHERNET' | 'CELLULAR' | 'BLUETOOTH' | 'USB' | 'VPN' | 'UNKNOWN';
  readonly hasInternetCapability: boolean;
  /** `null` = OS henüz söylemedi. ASLA `false` varsayılmaz. */
  readonly validated: boolean | null;
  readonly captivePortal: boolean | null;
  /** `null` = bilinmiyor. **ÜCRETSİZ SAYILMAZ** (F5.12). */
  readonly metered: boolean | null;
  /** `-1`/`0` = ölçülmedi. */
  readonly downstreamKbps: number;
  readonly upstreamKbps: number;
}

export const NO_NETWORK_FACTS: PhoneNetworkFacts = Object.freeze({
  present: false, transport: 'UNKNOWN', hasInternetCapability: false,
  validated: null, captivePortal: null, metered: null,
  downstreamKbps: -1, upstreamKbps: -1,
});

export interface PhoneInternetEvidence {
  readonly state: PhoneInternetState;
  readonly reason: PhoneInternetReason;
  readonly source: PhoneInternetSource;
  /** `null` = bilinmiyor; çağıran bunu ÜCRETSİZ SAYAMAZ. */
  readonly metered: boolean | null;
  readonly quality: PhoneInternetQuality;
  /** Politika (capability) izin veriyor mu — fiziksel ağdan BAĞIMSIZ. */
  readonly policyAllowed: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Köken
 * ════════════════════════════════════════════════════════════════════════ */

export function deriveInternetSource(facts: PhoneNetworkFacts): PhoneInternetSource {
  if (!facts.present) return 'UNKNOWN';
  switch (facts.transport) {
    case 'ETHERNET': return 'ETHERNET';
    /* USB/Bluetooth taşıması gerçekten tethering kanıtıdır — head unit'in
       kendi USB/BT ağı yoktur, bu arayüzler bağlı bir cihazdan gelir. */
    case 'USB': return 'USB_TETHER';
    case 'BLUETOOTH': return 'BLUETOOTH_PAN';
    /* Wi-Fi köken kanıtı DEĞİLDİR — bkz. `PhoneInternetSource` notu. */
    case 'WIFI': return 'SYSTEM_WIFI';
    case 'CELLULAR':
    case 'VPN':
    case 'UNKNOWN':
    default: return 'UNKNOWN';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kalite — yalnız OS tahmini, ölçüm YOK
 * ════════════════════════════════════════════════════════════════════════ */

const POOR_CEILING_KBPS = 1_000;
const USABLE_CEILING_KBPS = 5_000;

/**
 * Kaba kalite. Ping/speedtest/HTTP indirme YAPILMAZ (F5.13); tek girdi
 * OS'un `getLinkDownstreamBandwidthKbps()` tahminidir. Ölçülmemişse
 * `UNKNOWN` — uydurma bir sınıf ÜRETİLMEZ.
 */
export function deriveInternetQuality(facts: PhoneNetworkFacts): PhoneInternetQuality {
  if (!facts.present) return 'UNKNOWN';
  const kbps = facts.downstreamKbps;
  if (!Number.isFinite(kbps) || kbps <= 0) return 'UNKNOWN';
  if (kbps < POOR_CEILING_KBPS) return 'POOR';
  if (kbps < USABLE_CEILING_KBPS) return 'USABLE';
  return 'GOOD';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Maliyet
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Büyük/toplu transfer (OTA, harita indirme) bu yol üzerinden OTOMATİK
 * başlatılabilir mi.
 *
 * YALNIZ açıkça ölçülü-DEĞİL (`metered === false`) bir yol güvenlidir.
 * `null` (bilinmiyor) ÜCRETSİZ SAYILMAZ — F5.12. Bu fonksiyon bir KANIT
 * üretir; OTA/indirme politikasının kendisi bu fazın KAPSAMI DIŞINDADIR.
 */
export function isBulkTransferCostSafe(metered: boolean | null): boolean {
  return metered === false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Durum — TEK türetim noktası
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Politika kararı + ağ gerçekleri → durum.
 *
 * `policyAllowed` capability hattından gelir (`authorize()` → ALLOW) ve
 * fiziksel ağdan BAĞIMSIZDIR. İki ekseni ayrı tutmak F5.3'ün pazarlıksız
 * kuralıdır: grant fiziksel ağ değildir.
 */
export function derivePhoneInternetEvidence(input: {
  readonly policyAllowed: boolean;
  readonly facts: PhoneNetworkFacts;
}): PhoneInternetEvidence {
  const { policyAllowed, facts } = input;
  const source = deriveInternetSource(facts);
  const quality = deriveInternetQuality(facts);
  const metered = facts.present ? facts.metered : null;

  const base = { source, metered, quality, policyAllowed } as const;

  if (!policyAllowed) {
    return Object.freeze({ ...base, state: 'UNAVAILABLE', reason: 'no_grant' });
  }
  if (!facts.present || !facts.hasInternetCapability) {
    /* Politika izinli ama taşıyacak yol YOK — "CONNECTED" İDDİA EDİLMEZ. */
    return Object.freeze({ ...base, state: 'AVAILABLE', reason: 'no_network_path' });
  }
  if (facts.captivePortal === true) {
    /* Bağlı ama giriş sayfası bekliyor: bu internet DEĞİLDİR. */
    return Object.freeze({ ...base, state: 'DEGRADED', reason: 'captive_portal' });
  }
  if (facts.validated === true) {
    return Object.freeze({ ...base, state: 'CONNECTED', reason: 'validated' });
  }
  if (facts.validated === false) {
    return Object.freeze({ ...base, state: 'DEGRADED', reason: 'not_validated' });
  }
  /* `validated === null`: OS henüz hüküm vermedi. "Bağlı = internet var"
     varsayımı YAPILMAZ; dürüst ara durum CONNECTING'tir. */
  return Object.freeze({ ...base, state: 'CONNECTING', reason: 'validation_unknown' });
}

/** `CONNECTED` dışında hiçbir durum "internet kullanılabilir" DEMEZ. */
export function isPhoneInternetUsable(evidence: PhoneInternetEvidence): boolean {
  return evidence.state === 'CONNECTED';
}
