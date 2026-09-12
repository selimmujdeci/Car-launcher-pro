/**
 * navDegradation.ts — NAV v3 · KANONİK BOZULMA SÖZLEŞMESİ (SAF · F0).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0/3 · v2 §9.1 (Bozulma matrisi) ·
 * v2 P9 ("Bozulma isimlidir").
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK ·
 * YENİ ÖLÇÜM YOK. Bu dosya hiçbir şeyin bozuk olup olmadığını TESPİT ETMEZ —
 * yalnız "her bozulma seviyesi HANGİ iddiaları susturur" sorusunun TEK
 * cevabını verir. Seviyeyi seçen (`degradationModel`) F1+'da gelir.
 *
 * ── NEDEN TEK MATRİS ─────────────────────────────────────────────────────
 * "Trafik verisi yok" ile "trafik akıcı" ASLA aynı görünmemelidir. Her
 * yetenek kaybının bir ADI, bir SUSAN İDDİA listesi ve bir kullanıcı mesajı
 * olmalı — ve bu eşleme TEK yerde durmalı, yoksa her yüzey kendi susturma
 * kuralını icat eder (kütük P0-NAV-14 · #332 · #547 deseni).
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · Her `NavDegradation` değerinin bir susturma satırı VARDIR (kilit test).
 *  · Susturma KÜMÜLATİFTİR: daha ağır seviye, daha hafifin susturduklarını da
 *    susturur (`resolveSuppressedClaims` bunu birleştirir).
 *  · Bir iddia sustuysa, o iddiayı taşıyan sayı EKRANDA `—`/rozetle gösterilir;
 *    ASLA eski/uydurma değerle sunulmaz.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) BOZULMA SEVİYELERİ — en hafiften en ağıra
   ══════════════════════════════════════════════════════════════════════════ */

export type NavDegradation =
  | 'FULL'            // her şey çalışıyor
  | 'NO_TRAFFIC'     // trafik anahtarı/verisi yok — rota + statik ETA + rehberlik sürüyor
  | 'NO_NETWORK'     // internet yok ama harita paketi VAR — tam çevrimdışı navigasyon
  | 'STALE_MAP_DATA' // harita paketi var ama sürümü eski/şüpheli — mutlak-doğruluk iddiaları susar
  | 'NO_MAP_DATA'    // bu bölge için harita paketi YOK — rota/manevra/limit üretilemez
  | 'NO_POSITION'    // kullanılabilir konum yok — rehberlik DURDURULUR
  | 'SAFE_STOP';     // güvenli olmayan durum — yalnız "güvenli yerde dur" mesajı

/** En hafiften en ağıra — genel hüküm daima EN AĞIR aktif seviyeye eşittir. */
export const NAV_DEGRADATION_ORDER: readonly NavDegradation[] = [
  'FULL', 'NO_TRAFFIC', 'NO_NETWORK', 'STALE_MAP_DATA', 'NO_MAP_DATA', 'NO_POSITION', 'SAFE_STOP',
] as const;

const _SEVERITY: Readonly<Record<NavDegradation, number>> =
  NAV_DEGRADATION_ORDER.reduce((acc, lvl, i) => {
    acc[lvl] = i;
    return acc;
  }, {} as Record<NavDegradation, number>);

/* ══════════════════════════════════════════════════════════════════════════
   2) İDDİALAR — susturulabilir navigasyon yetenekleri
   ══════════════════════════════════════════════════════════════════════════ */

export type NavClaim =
  | 'LIVE_TRAFFIC'        // "gerçek zamanlı trafik"
  | 'FIRM_ETA'           // güvenilir (trafikli) varış tahmini
  | 'ONLINE_SEARCH'      // canlı adres/POI araması
  | 'ROUTE_OFFER'        // çevrimiçi "daha iyi rota" teklifi
  | 'ROUTE_GUIDANCE'     // rota çizgisi + yol tarifi
  | 'MANEUVER_GUIDANCE'  // sıradaki manevra + zamanlı sesli anons
  | 'SPEED_LIMIT'        // hız limiti (ADAS/ISA)
  | 'CURVE_WARNING'      // viraj riski uyarısı
  | 'ENFORCEMENT_WARNING'// denetim noktası uyarısı
  | 'SLOPE_PROFILE'      // eğim profili
  | 'LANE_GUIDANCE'      // şerit rehberi
  | 'FREE_DRIVE_HORIZON' // rota yokken serbest sürüş ufku
  | 'VEHICLE_PROJECTION' // araç durumu projeksiyonu (termal/menzil)
  | 'POSITION_ON_MAP';   // haritada araç işareti

export const NAV_CLAIMS: readonly NavClaim[] = [
  'LIVE_TRAFFIC', 'FIRM_ETA', 'ONLINE_SEARCH', 'ROUTE_OFFER',
  'ROUTE_GUIDANCE', 'MANEUVER_GUIDANCE', 'SPEED_LIMIT', 'CURVE_WARNING',
  'ENFORCEMENT_WARNING', 'SLOPE_PROFILE', 'LANE_GUIDANCE', 'FREE_DRIVE_HORIZON',
  'VEHICLE_PROJECTION', 'POSITION_ON_MAP',
] as const;

/* ══════════════════════════════════════════════════════════════════════════
   3) SUSTURMA MATRİSİ — TEK OTORİTE (her seviye için "bu seviyede susan iddialar")
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Her seviyenin O SEVİYEDE ilk kez sustuduğu iddialar. Susturma kümülatiftir
 * (`resolveSuppressedClaims` daha hafif seviyeleri de birleştirir), bu yüzden
 * satırlar YALNIZ o seviyenin eklediğini listeler.
 */
export const NAV_DEGRADATION_SUPPRESSION: Readonly<Record<NavDegradation, readonly NavClaim[]>> = {
  FULL: [],
  /* Trafik yok → trafik iddiası ve trafikli ("firm") ETA susar; statik ETA sürer. */
  NO_TRAFFIC: ['LIVE_TRAFFIC', 'FIRM_ETA'],
  /* İnternet yok → canlı arama ve çevrimiçi rota teklifi de susar (trafik zaten sustu). */
  NO_NETWORK: ['ONLINE_SEARCH', 'ROUTE_OFFER'],
  /* Paket eski/şüpheli → mutlak-doğruluk gerektiren ADAS iddiaları susar;
     rota/manevra geometrisi "kusurlu ama kullanılabilir" olarak SÜRER. */
  STALE_MAP_DATA: ['SPEED_LIMIT', 'CURVE_WARNING', 'ENFORCEMENT_WARNING', 'LANE_GUIDANCE', 'SLOPE_PROFILE'],
  /* Paket yok → haritadan türeyen HER ŞEY susar; pusula + kayıtlı POI kalır. */
  NO_MAP_DATA: ['ROUTE_GUIDANCE', 'MANEUVER_GUIDANCE', 'FREE_DRIVE_HORIZON', 'VEHICLE_PROJECTION'],
  /* Konum yok → haritadaki işaret ve konuma bağlı her karar susar; harita gösterimi kalır. */
  NO_POSITION: ['POSITION_ON_MAP'],
  /* Güvenli-dur → tek mesaj dışında HER iddia susar. */
  SAFE_STOP: [],
};

/** Her seviyenin kullanıcıya söyleyeceği tek cümle. */
export const NAV_DEGRADATION_USER_MESSAGE: Readonly<Record<NavDegradation, string>> = {
  FULL: '',
  NO_TRAFFIC: 'Gerçek zamanlı trafik yok — varış tahmini yaklaşık.',
  NO_NETWORK: 'Çevrimdışı harita — canlı arama ve trafik kapalı.',
  STALE_MAP_DATA: 'Harita paketi eski — hız limiti ve viraj uyarıları güvenilir değil.',
  NO_MAP_DATA: 'Bu bölge için harita paketi yok — rota ve manevra üretilemiyor.',
  NO_POSITION: 'Konum yok — rehberlik durduruldu.',
  SAFE_STOP: 'Güvenli bir yerde durun.',
};

/* ══════════════════════════════════════════════════════════════════════════
   4) TÜRETİCİLER — saf
   ══════════════════════════════════════════════════════════════════════════ */

/** İki seviyeden daha ağır olanı. */
export function worstDegradation(a: NavDegradation, b: NavDegradation): NavDegradation {
  return _SEVERITY[a] >= _SEVERITY[b] ? a : b;
}

/** `a`, `b`'den ağır (veya eşit) mi. */
export function isAtLeastAsSevere(a: NavDegradation, b: NavDegradation): boolean {
  return _SEVERITY[a] >= _SEVERITY[b];
}

/**
 * Verilen seviyede susan TÜM iddialar (kümülatif — bu seviye + daha hafif tüm
 * seviyeler). `SAFE_STOP` → tek mesaj dışında her iddia susar.
 */
export function resolveSuppressedClaims(level: NavDegradation): ReadonlySet<NavClaim> {
  if (level === 'SAFE_STOP') return new Set(NAV_CLAIMS);
  const out = new Set<NavClaim>();
  const target = _SEVERITY[level];
  for (const lvl of NAV_DEGRADATION_ORDER) {
    if (_SEVERITY[lvl] > target) break;
    for (const claim of NAV_DEGRADATION_SUPPRESSION[lvl]) out.add(claim);
  }
  return out;
}

/** Bu iddia verilen bozulma seviyesinde GÖSTERİLEBİLİR mi. */
export function isClaimAllowed(level: NavDegradation, claim: NavClaim): boolean {
  return !resolveSuppressedClaims(level).has(claim);
}
