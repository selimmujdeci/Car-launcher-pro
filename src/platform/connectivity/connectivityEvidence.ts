/**
 * connectivityEvidence.ts — CAROS F7 · kanonik bağlantı KANIT modeli (SAF).
 *
 * ── TEK GERÇEK, ÇOK KAYNAK ──────────────────────────────────────────────────
 * F7'nin ana yasası: internet gerçeğinin TEK sahibi vardır. Wi-Fi, Ethernet,
 * Phone Link, Capacitor ve tarayıcı katmanları AUTHORITY DEĞİL, yalnız KANIT
 * üretir. Bu dosya o kanıtları ve onlardan tek hükmün nasıl çıkarıldığını
 * tanımlar — yan etkisiz, IO'suz, timer'sız.
 *
 * ── "BAĞLI" ≠ "İNTERNET VAR" (§6) ───────────────────────────────────────────
 * Pazarlıksız: Wi-Fi bağlı, Bluetooth bağlı, Phone Link bağlı,
 * `NET_CAPABILITY_INTERNET` var ya da `navigator.onLine === true` olması
 * TEK BAŞINA `ONLINE` ÜRETMEZ. `ONLINE` için doğrulanmış (validated) kanıt
 * gerekir ve captive portal varsa asla üretilmez.
 *
 * ── ZAMAN AŞIMI YALNIZ TEK-ATIŞLIK KANIT İÇİNDİR (§13) ──────────────────────
 * Callback tabanlı (sürekli) kanıt ZAMANLA BAYATLAMAZ: bir `NetworkCallback`
 * gözlemi, YENİSİ GELENE KADAR geçerlidir — sabit bir ağda saatlerce olay
 * gelmemesi normaldir ve bunu "bilinmiyor"a düşürmek YANLIŞ olurdu. Yalnız
 * tek-atışlık (pull) kanıt yaşlanır. Böylece hiçbir timer/scheduler'a ihtiyaç
 * kalmaz; yaş OKUMA ANINDA hesaplanır (O(1)).
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Kanonik durum
 * ════════════════════════════════════════════════════════════════════════ */

export type ConnectivityState =
  /** Yeterli güncel kanıt YOK — fail-closed başlangıç. */
  | 'UNKNOWN'
  /** Geçerli bir ağ yolu yok. */
  | 'OFFLINE'
  /** Yerel ağ var ama dış internet kanıtı YOK (ör. internet yeteneği olmayan yol). */
  | 'LOCAL_ONLY'
  /** Captive portal kanıtı var — giriş sayfası internet DEĞİLDİR. */
  | 'CAPTIVE'
  /** İnternet yolu var ama doğrulama/kalite güveni yetersiz. */
  | 'DEGRADED'
  /** Dış internet erişimi yeterince güçlü kanıtla DOĞRULANDI. */
  | 'ONLINE';

/**
 * Kanıt kaynağı. İsim GERÇEĞİ AŞMAZ: F5'in kuralı burada da geçerlidir —
 * Wi-Fi'ın telefon hotspot'u olduğu KANITLANAMIYORSA `SYSTEM_WIFI` denir,
 * `PHONE_HOTSPOT` UYDURULMAZ.
 */
export type ConnectivityEvidenceSource =
  /** Android `ConnectivityManager.NetworkCallback` — validated/captive/metered taşır. */
  | 'ANDROID_NETWORK_CALLBACK'
  /** F5 Phone Internet Gateway — telefonla ilişkili yolun politika+durum kanıtı. */
  | 'PHONE_LINK_GATEWAY'
  /** Capacitor Network eklentisi — bağlı/değil, doğrulama garantisi YOK. */
  | 'CAPACITOR_NETWORK'
  /** `navigator.onLine` — YALNIZ uyumluluk ipucu, otorite DEĞİL (§8). */
  | 'BROWSER_ONLINE_HINT'
  | 'UNKNOWN';

export type ConnectivityTransport =
  | 'WIFI' | 'ETHERNET' | 'CELLULAR' | 'BLUETOOTH' | 'USB' | 'VPN' | 'UNKNOWN';

/** F5'in kaba kalite sınıfı AYNEN yeniden kullanılır — yeni speedtest YOK. */
export type ConnectivityQuality = 'UNKNOWN' | 'POOR' | 'USABLE' | 'GOOD';

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt
 * ════════════════════════════════════════════════════════════════════════ */

export interface ConnectivityEvidence {
  readonly source: ConnectivityEvidenceSource;
  /** Bu kaynağın TEK BAŞINA desteklediği en yüksek hüküm. */
  readonly state: ConnectivityState;
  readonly observedAt: number;
  /**
   * Callback tabanlı mı? `true` ise YENİSİ GELENE KADAR geçerlidir
   * (zamanla bayatlamaz — bkz. dosya üstü not).
   */
  readonly continuous: boolean;
  /** `null` = ölçülmedi. ASLA `false` VARSAYILMAZ. */
  readonly validated: boolean | null;
  readonly captivePortal: boolean | null;
  /** `null` = bilinmiyor. **ÜCRETSİZ SAYILMAZ** (F5 kuralı korunur). */
  readonly metered: boolean | null;
  readonly transport: ConnectivityTransport;
  readonly quality: ConnectivityQuality;
}

/**
 * Kaynak güveni (§8). Sayılar SIRALAMA içindir, olasılık değildir.
 *
 * Sıralama ölçüme dayanır:
 *  · `ANDROID_NETWORK_CALLBACK` doğrulama/captive/metered'ı OS'tan getirir —
 *    elimizdeki EN GÜÇLÜ kanıt.
 *  · `PHONE_LINK_GATEWAY` aynı OS gerçeğini taşır ama KAPSAMI dardır (yalnız
 *    telefonla ilişkili yol) → bir basamak altta.
 *  · `CAPACITOR_NETWORK` yalnız "bağlı mı" der; doğrulama GARANTİSİ YOK.
 *  · `BROWSER_ONLINE_HINT` yalnız uyumluluk ipucudur ve otorite OLAMAZ.
 */
export const EVIDENCE_CONFIDENCE: Readonly<Record<ConnectivityEvidenceSource, number>> =
  Object.freeze({
    ANDROID_NETWORK_CALLBACK: 100,
    PHONE_LINK_GATEWAY: 70,
    CAPACITOR_NETWORK: 50,
    BROWSER_ONLINE_HINT: 10,
    UNKNOWN: 0,
  });

/** Tek-atışlık (pull) kanıt için üst yaş sınırı — sürekli kanıta UYGULANMAZ. */
export const ONE_SHOT_EVIDENCE_MAX_AGE_MS = 60_000;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham ağ gerçeğinden kanıt üretimi
 * ════════════════════════════════════════════════════════════════════════ */

/** Adaptörlerin taşıdığı SINIRLI ağ gerçekleri (F5'in şekliyle uyumlu). */
export interface NetworkFacts {
  readonly present: boolean;
  readonly transport: ConnectivityTransport;
  readonly hasInternetCapability: boolean;
  readonly validated: boolean | null;
  readonly captivePortal: boolean | null;
  readonly metered: boolean | null;
  readonly downstreamKbps: number;
  readonly upstreamKbps: number;
}

const POOR_CEILING_KBPS = 1_000;
const USABLE_CEILING_KBPS = 5_000;

/** Kaba kalite — ölçüm YOK, yalnız OS tahmini. Ölçülmediyse `UNKNOWN`. */
export function deriveQuality(downstreamKbps: number): ConnectivityQuality {
  if (!Number.isFinite(downstreamKbps) || downstreamKbps <= 0) return 'UNKNOWN';
  if (downstreamKbps < POOR_CEILING_KBPS) return 'POOR';
  if (downstreamKbps < USABLE_CEILING_KBPS) return 'USABLE';
  return 'GOOD';
}

/**
 * Ağ gerçeklerinden TEK kaynağın desteklediği hükmü çıkarır.
 *
 * Sıra kasıtlıdır ve fail-closed'dur:
 *   yol yok            → OFFLINE
 *   internet yeteneği yok → LOCAL_ONLY   (yerel ağ var, dış internet kanıtı yok)
 *   captive portal      → CAPTIVE        (doğrulanmış olsa BİLE internet değildir)
 *   validated === true  → ONLINE
 *   aksi                → DEGRADED       (yol var, doğrulama güveni yetersiz)
 */
export function deriveStateFromFacts(facts: NetworkFacts): ConnectivityState {
  if (!facts.present) return 'OFFLINE';
  if (!facts.hasInternetCapability) return 'LOCAL_ONLY';
  if (facts.captivePortal === true) return 'CAPTIVE';
  if (facts.validated === true) return 'ONLINE';
  return 'DEGRADED';
}

/** Ham gerçekleri kanonik kanıta çevirir. */
export function evidenceFromFacts(input: {
  readonly source: ConnectivityEvidenceSource;
  readonly facts: NetworkFacts;
  readonly observedAt: number;
  readonly continuous: boolean;
}): ConnectivityEvidence {
  const { source, facts, observedAt, continuous } = input;
  return Object.freeze({
    source,
    state: deriveStateFromFacts(facts),
    observedAt,
    continuous,
    validated: facts.present ? facts.validated : null,
    captivePortal: facts.present ? facts.captivePortal : null,
    metered: facts.present ? facts.metered : null,
    transport: facts.present ? facts.transport : 'UNKNOWN',
    quality: facts.present ? deriveQuality(facts.downstreamKbps) : 'UNKNOWN',
  });
}

/**
 * `navigator.onLine` ipucu (§8/§20).
 *
 * ── NEDEN `true` HİÇBİR ŞEY KANITLAMAZ ──────────────────────────────────────
 * Tarayıcı bayrağı yalnız "bir ağ arayüzü var" der; captive portal, doğrulama
 * ve dış erişim hakkında HİÇBİR bilgi taşımaz. Bu yüzden `true` → `UNKNOWN`
 * (hüküm üretmez), `false` → `OFFLINE` (arayüz yokluğu anlamlı bir negatif
 * kanıttır). Bu ipucu ASLA `ONLINE` üretemez.
 */
export function evidenceFromBrowserHint(
  online: boolean, observedAt: number,
): ConnectivityEvidence {
  return Object.freeze({
    source: 'BROWSER_ONLINE_HINT' as const,
    state: (online ? 'UNKNOWN' : 'OFFLINE') as ConnectivityState,
    observedAt,
    continuous: true,
    validated: null,
    captivePortal: null,
    metered: null,
    transport: 'UNKNOWN' as const,
    quality: 'UNKNOWN' as const,
  });
}

/**
 * Capacitor Network kanıtı.
 *
 * `connected === true` DOĞRULAMA GARANTİSİ VERMEZ — bu yüzden en fazla
 * `DEGRADED` üretir, ASLA `ONLINE` değil.
 */
export function evidenceFromCapacitorNetwork(input: {
  readonly connected: boolean;
  readonly transport: ConnectivityTransport;
  readonly observedAt: number;
}): ConnectivityEvidence {
  return Object.freeze({
    source: 'CAPACITOR_NETWORK' as const,
    state: (input.connected ? 'DEGRADED' : 'OFFLINE') as ConnectivityState,
    observedAt: input.observedAt,
    continuous: true,
    validated: null,
    captivePortal: null,
    metered: null,
    transport: input.connected ? input.transport : 'UNKNOWN',
    quality: 'UNKNOWN' as const,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hüküm — kanıtlardan TEK gerçek
 * ════════════════════════════════════════════════════════════════════════ */

export interface ConnectivitySnapshot {
  readonly state: ConnectivityState;
  readonly source: ConnectivityEvidenceSource;
  readonly transport: ConnectivityTransport;
  readonly validated: boolean | null;
  readonly captivePortal: boolean | null;
  readonly metered: boolean | null;
  readonly quality: ConnectivityQuality;
  /** Hükmü veren kanıtın yaşı (ms); kanıt yoksa `null`. */
  readonly evidenceAgeMs: number | null;
  /** Kaç kaynaktan kanıt var (gözlemlenebilirlik). */
  readonly evidenceCount: number;
}

export const UNKNOWN_SNAPSHOT: ConnectivitySnapshot = Object.freeze({
  state: 'UNKNOWN',
  source: 'UNKNOWN',
  transport: 'UNKNOWN',
  validated: null,
  captivePortal: null,
  metered: null,
  quality: 'UNKNOWN',
  evidenceAgeMs: null,
  evidenceCount: 0,
});

/** Tek-atışlık kanıt yaşlandı mı (sürekli kanıt ASLA yaşlanmaz). */
export function isEvidenceStale(
  evidence: ConnectivityEvidence, nowMs: number,
): boolean {
  if (evidence.continuous) return false;
  return nowMs - evidence.observedAt >= ONE_SHOT_EVIDENCE_MAX_AGE_MS;
}

/**
 * Kanıt kümesinden KANONİK hükmü üretir. SAF.
 *
 * ── SEÇİM ───────────────────────────────────────────────────────────────────
 *  1. Bayat tek-atışlık kanıtlar ELENİR (fail-closed).
 *  2. Hüküm ÜRETMEYEN kanıtlar (`UNKNOWN`) hükmü BELİRLEMEZ — ama sayılır.
 *  3. Kalanlardan EN YÜKSEK güvenli kaynak kazanır; eşitlikte EN TAZE olan.
 *  4. Hiç hüküm üreten kanıt yoksa → `UNKNOWN` (asla "herhalde online").
 *
 * ── ZAYIF/BAYAT KANIT GÜÇLÜYÜ EZEMEZ ────────────────────────────────────────
 * Sıralama yalnız güven + tazelik ile yapılır; düşük güvenli bir kaynak
 * (ör. `navigator.onLine`) yüksek güvenli taze bir kanıtı ASLA geçemez.
 */
export function deriveConnectivitySnapshot(
  evidences: readonly ConnectivityEvidence[], nowMs: number,
): ConnectivitySnapshot {
  const usable = evidences.filter((e) => !isEvidenceStale(e, nowMs));
  const deciding = usable.filter((e) => e.state !== 'UNKNOWN');

  if (deciding.length === 0) {
    return Object.freeze({ ...UNKNOWN_SNAPSHOT, evidenceCount: usable.length });
  }

  let best = deciding[0];
  for (const candidate of deciding) {
    const bestRank = EVIDENCE_CONFIDENCE[best.source];
    const candidateRank = EVIDENCE_CONFIDENCE[candidate.source];
    if (candidateRank > bestRank) { best = candidate; continue; }
    if (candidateRank === bestRank && candidate.observedAt > best.observedAt) {
      best = candidate;
    }
  }

  return Object.freeze({
    state: best.state,
    source: best.source,
    transport: best.transport,
    validated: best.validated,
    captivePortal: best.captivePortal,
    metered: best.metered,
    quality: best.quality,
    evidenceAgeMs: Math.max(0, nowMs - best.observedAt),
    evidenceCount: usable.length,
  });
}

/** Dış internetin DOĞRULANMIŞ olduğu tek durum. */
export function isInternetProven(snapshot: ConnectivitySnapshot): boolean {
  return snapshot.state === 'ONLINE';
}
