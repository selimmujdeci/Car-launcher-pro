/**
 * navFailureMatrixModel — NAVİGASYONUN DÜRÜST ARIZA TABLOSU (SAF · P0-NAV-20).
 *
 * SAF: I/O YOK · TIMER YOK · `Date.now` YOK · React YOK · ağ YOK ·
 * **YENİ VERİ KAYNAĞI YOK.** Bu modül hiçbir şey ÖLÇMEZ — bu gece kurulan
 * otoritelerin ZATEN ölçtüğü hükümleri tek tabloda TOPLAR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (P0-NAV-20 · 2026-08-24) ────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * P0-NAV-08…19 turları her arıza sınıfı için AYRI bir dürüst hüküm üretti:
 * arama zinciri · rota sağlayıcı zinciri · geometri · ilerleme · reroute
 * sağlığı · HUD durumu. Ama **hiçbir yerde \"navigasyon şu an genel olarak ne
 * hâlde\" sorusunun tek cevabı yoktu.** Sürüş sırasında bakılacak tek satır
 * budur; onsuz teşhis altı ayrı karta bakmayı gerektirir.
 *
 * ── ÖLÇÜLEN VE KİLİTLENEN GERÇEK: NAVİGASYON OBD'DEN BAĞIMSIZDIR ──────────
 * NAV-20'nin açık şartı: *\"OBD kopması navigasyonu gereksiz yere öldürmemeli.
 * GPS ve navigation authority OBD'den bağımsız kalmalı.\"* ÖLÇÜLDÜ (koddan):
 * `routingService` ve `navigationService` OBD katmanından **HİÇBİR ŞEY import
 * ETMİYOR**; hız `UnifiedVehicleStore`dan (füzyonlanmış) gelir. OBD'ye dokunan
 * tek yer `navigation/guardian/**`tır ve o da bilinçli olarak bir PORT ardında
 * yalıtılmıştır. Bu tablo o bağımsızlığı **girdi listesiyle** mühürler:
 * **OBD durumu bu modelin girdisi DEĞİLDİR** ve olmamalıdır.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · KARAR ÜRETMEZ: hiçbir katmanı kapatmaz, yeniden deneme tetiklemez.
 *  · Kanıt yoksa `UNKNOWN` — \"sağlıklı\" VARSAYILMAZ (fail-honest).
 *  · Genel hüküm EN KÖTÜ eksene eşittir: bir eksen çökmüşken \"iyi\" demek
 *    sürücüye yalan söylemektir.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1) EKSENLER VE DURUMLAR
   ══════════════════════════════════════════════════════════════════════════ */

/** Arıza tablosunun ekseni — her biri AYRI bir otoritenin hükmünden gelir. */
export type NavFailureAxis =
  /** Konum kalitesi (fix var mı, doğruluk karar sınırında mı). */
  | 'GPS'
  /** Ağ erişimi (çevrimiçi mi). */
  | 'NETWORK'
  /** Adres/POI arama zinciri. */
  | 'SEARCH'
  /** Rota sağlayıcı merdiveni. */
  | 'ROUTE_PROVIDER'
  /** Uygulanan rota geometrisi. */
  | 'GEOMETRY'
  /** Rota üzerindeki ilerleme tutarlılığı. */
  | 'PROGRESS'
  /** Sapma → yeniden rota zinciri. */
  | 'REROUTE';

export const NAV_AXIS_LABEL: Readonly<Record<NavFailureAxis, string>> = {
  GPS:            'konum',
  NETWORK:        'ağ',
  SEARCH:         'arama',
  ROUTE_PROVIDER: 'rota sağlayıcı',
  GEOMETRY:       'rota geometrisi',
  PROGRESS:       'ilerleme',
  REROUTE:        'yeniden rota',
} as const;

/**
 * Bir eksenin dürüst durumu.
 *
 * `RECOVERING` ile `DEGRADED` AYRI TUTULUR: birincisi \"düzeliyor, bekle\",
 * ikincisi \"çalışıyor ama eksik\" demektir ve sürücüye/teşhise farklı şey
 * söylerler.
 */
export type NavAxisState =
  | 'HEALTHY'
  /** Çalışıyor ama eksik/kusurlu — ürün kullanılabilir. */
  | 'DEGRADED'
  /** Kendi kendine düzelme yolunda (istek uçuyor · yeniden bağlanıyor). */
  | 'RECOVERING'
  /** Bu eksen şu an iş göremiyor. */
  | 'FAILED'
  /** Kanıt yok — hüküm iddia EDİLMEZ. */
  | 'UNKNOWN';

export const NAV_AXIS_STATE_LABEL: Readonly<Record<NavAxisState, string>> = {
  HEALTHY:    'sağlıklı',
  DEGRADED:   'kusurlu ama çalışıyor',
  RECOVERING: 'düzeliyor',
  FAILED:     'iş göremiyor',
  UNKNOWN:    'kanıt yok',
} as const;

/** Kötülük sırası — genel hüküm EN KÖTÜ eksene eşittir. */
const _SEVERITY: Readonly<Record<NavAxisState, number>> = {
  HEALTHY: 0, UNKNOWN: 1, RECOVERING: 2, DEGRADED: 3, FAILED: 4,
};

/* ══════════════════════════════════════════════════════════════════════════
   2) GİRDİ — YALNIZ MEVCUT HÜKÜMLER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ **OBD DURUMU BİLİNÇLİ OLARAK YOKTUR.**
 * NAV-20 şartı: navigasyon otoritesi OBD'den bağımsızdır. Buraya bir OBD alanı
 * eklemek o bağımsızlığı sessizce kırardı; kilit testi bunu denetler.
 */
export interface NavFailureMatrixInput {
  /** Navigasyon sürüyor mu — sürmüyorsa çoğu eksen ANLAMSIZDIR. */
  readonly navActive: boolean;

  /* ── GPS (hudPresentationModel / offRouteModel ile aynı çizgi) ── */
  readonly gpsUsable: boolean;
  /** Fix yaşı (ms). Ölçülemezse `null`. */
  readonly fixAgeMs: number | null;
  /** Konum karar kalitesinde mi (`isGpsDecisionGrade` sonucu). */
  readonly gpsDecisionGrade: boolean;

  /* ── Ağ ── */
  /** `navigator.onLine`. Bildirilmediyse `null`. */
  readonly online: boolean | null;

  /* ── Arama (geo/searchChainModel hükmü) ── */
  readonly searchVerdict: string | null;

  /* ── Rota sağlayıcı (routeProviderLedger hükmü) ── */
  readonly routeChainOutcome: string | null;

  /* ── Geometri (routeGeometryModel hükmü) ── */
  readonly geometryIntegrity: string | null;

  /* ── İlerleme (routeProgressLedger son hükmü) ── */
  readonly progressVerdict: string | null;

  /* ── Reroute (rerouteStarvationModel hükmü) ── */
  readonly rerouteHealth: string | null;
  /** Rota isteği şu an uçuyor mu. */
  readonly routeRequestPending: boolean;
}

/** Fix bu yaştan eskiyse konum kararı verilemez (`mapMatchModel` ile aynı). */
export const MATRIX_FIX_STALE_MS = 5_000;

/* ══════════════════════════════════════════════════════════════════════════
   3) EKSEN HÜKÜMLERİ
   ══════════════════════════════════════════════════════════════════════════ */

export interface NavAxisVerdict {
  readonly axis: NavFailureAxis;
  readonly state: NavAxisState;
  readonly why: string;
}

function _gps(i: NavFailureMatrixInput): NavAxisVerdict {
  const mk = (state: NavAxisState, why: string): NavAxisVerdict =>
    ({ axis: 'GPS', state, why });
  if (!i.gpsUsable) return mk('FAILED', 'kullanılabilir konum yok');
  if (i.fixAgeMs !== null && i.fixAgeMs > MATRIX_FIX_STALE_MS) {
    /* Bayat fix bir ARIZA değil, bir BEKLEYİŞTİR: bir sonraki fix gelince
       kendiliğinden düzelir (tünel · köprü altı). */
    return mk('RECOVERING', `fix ${Math.round(i.fixAgeMs / 1000)} sn bayat — yeni fix bekleniyor`);
  }
  if (!i.gpsDecisionGrade) return mk('DEGRADED', 'doğruluk karar sınırının dışında');
  return mk('HEALTHY', 'konum karar kalitesinde');
}

function _network(i: NavFailureMatrixInput): NavAxisVerdict {
  const mk = (state: NavAxisState, why: string): NavAxisVerdict =>
    ({ axis: 'NETWORK', state, why });
  if (i.online === null) return mk('UNKNOWN', 'ağ durumu bildirilmedi');
  /* Çevrimdışı olmak bir ÇÖKME DEĞİLDİR: cihaz-içi POI ve çevrimdışı graf
     çalışmaya devam eder. Ürün kullanılabilir → `DEGRADED`. */
  return i.online
    ? mk('HEALTHY', 'çevrimiçi')
    : mk('DEGRADED', 'çevrimdışı — cihaz-içi kaynaklar devrede');
}

function _search(i: NavFailureMatrixInput): NavAxisVerdict {
  const mk = (state: NavAxisState, why: string): NavAxisVerdict =>
    ({ axis: 'SEARCH', state, why });
  switch (i.searchVerdict) {
    case null:                    return mk('UNKNOWN', 'bu oturumda arama yapılmadı');
    case 'RESULTS':               return mk('HEALTHY', 'sonuç üretildi');
    case 'TRUE_ZERO':             return mk('DEGRADED', 'gerçek 0 sonuç — veri boşluğu');
    case 'FILTERED_OUT':          return mk('DEGRADED', 'adaylar geldi, kapılar eledi');
    case 'OFFLINE_NO_COVERAGE':   return mk('DEGRADED', 'çevrimdışı — cihaz-içi kapsamda yok');
    case 'TIMEOUT':               return mk('RECOVERING', 'sağlayıcı beklenmedi — tekrar denenebilir');
    case 'NETWORK_UNAVAILABLE':   return mk('DEGRADED', 'ağ yok');
    case 'PROVIDER_ERROR':        return mk('FAILED', 'sağlayıcı hata verdi');
    case 'PARSE_FAILURE':         return mk('FAILED', 'yanıt çözümlenemedi — KOD kusuru olabilir');
    default:                      return mk('UNKNOWN', 'arama hükmü tanınmadı');
  }
}

function _routeProvider(i: NavFailureMatrixInput): NavAxisVerdict {
  const mk = (state: NavAxisState, why: string): NavAxisVerdict =>
    ({ axis: 'ROUTE_PROVIDER', state, why });
  if (i.routeRequestPending) return mk('RECOVERING', 'rota isteği uçuyor');
  switch (i.routeChainOutcome) {
    case null:                      return mk('UNKNOWN', 'bu oturumda rota istenmedi');
    case 'PRIMARY_SUCCESS':         return mk('HEALTHY', 'birincil sağlayıcı cevapladı');
    /* Yedek kurtardıysa ürün çalışıyor AMA gizli bir gecikme ödeniyor. */
    case 'FALLBACK_SUCCESS':        return mk('DEGRADED', 'yedek katman kurtardı — gizli degradasyon');
    case 'DEGRADED_STRAIGHT_LINE':  return mk('FAILED', 'düz hat devrede — GERÇEK ROTA YOK');
    case 'ALL_FAILED':              return mk('FAILED', 'hiçbir katman rota üretemedi');
    default:                        return mk('UNKNOWN', 'zincir hükmü tanınmadı');
  }
}

function _geometry(i: NavFailureMatrixInput): NavAxisVerdict {
  const mk = (state: NavAxisState, why: string): NavAxisVerdict =>
    ({ axis: 'GEOMETRY', state, why });
  switch (i.geometryIntegrity) {
    case null:       return mk('UNKNOWN', 'uygulanmış rota yok');
    case 'VALID':    return mk('HEALTHY', 'geometri sağlam');
    case 'DEGRADED': return mk('DEGRADED', 'geometri kusurlu ama kullanılabilir');
    case 'INVALID':  return mk('FAILED', 'geometri bozuk');
    default:         return mk('UNKNOWN', 'geometri hükmü tanınmadı');
  }
}

function _progress(i: NavFailureMatrixInput): NavAxisVerdict {
  const mk = (state: NavAxisState, why: string): NavAxisVerdict =>
    ({ axis: 'PROGRESS', state, why });
  switch (i.progressVerdict) {
    case null:                   return mk('UNKNOWN', 'ilerleme örneği yok');
    case 'PLAUSIBLE':            return mk('HEALTHY', 'ilerleme makul');
    case 'STATIONARY':           return mk('HEALTHY', 'araç duruyor');
    /* Gerçek U dönüşü bir ARIZA DEĞİLDİR — sürücünün kararıdır. */
    case 'REAL_BACKTRACK':       return mk('HEALTHY', 'gerçek geri dönüş (yön kanıtlı)');
    case 'ROUTE_CHANGED':        return mk('RECOVERING', 'rota değişti — yeni ölçüm bekleniyor');
    case 'UNKNOWN':              return mk('UNKNOWN', 'eşleşme güvenilir değil');
    case 'IMPLAUSIBLE_FORWARD':  return mk('DEGRADED', 'aşırı ileri sıçrama');
    case 'IMPLAUSIBLE_BACKWARD': return mk('DEGRADED', 'kanıtsız geri kayma');
    default:                     return mk('UNKNOWN', 'ilerleme hükmü tanınmadı');
  }
}

function _reroute(i: NavFailureMatrixInput): NavAxisVerdict {
  const mk = (state: NavAxisState, why: string): NavAxisVerdict =>
    ({ axis: 'REROUTE', state, why });
  switch (i.rerouteHealth) {
    case null:                return mk('UNKNOWN', 'reroute hükmü okunamadı');
    case 'HEALTHY':           return mk('HEALTHY', 'sapma yok ya da rota kuruldu');
    case 'REROUTING':         return mk('RECOVERING', 'rota isteği yolda');
    case 'BLOCKED_TRANSIENT': return mk('RECOVERING', 'engel var, süre normal sınırlarda');
    case 'STARVED':           return mk('FAILED', 'uzun süredir rota kurulamıyor');
    case 'UNKNOWN':           return mk('UNKNOWN', 'kanıt yetersiz');
    default:                  return mk('UNKNOWN', 'reroute hükmü tanınmadı');
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) TABLO
   ══════════════════════════════════════════════════════════════════════════ */

export interface NavFailureMatrix {
  readonly axes: readonly NavAxisVerdict[];
  /** EN KÖTÜ eksene eşit genel hüküm. */
  readonly overall: NavAxisState;
  /** Genel hükmü belirleyen eksen; hepsi sağlıklıysa `null`. */
  readonly worstAxis: NavFailureAxis | null;
  /** Tek cümlelik özet — sürüş sırasında bakılacak satır. */
  readonly summary: string;
}

/**
 * Mevcut hükümleri tek tabloya toplar. **SAF · YENİ ÖLÇÜM YAPMAZ.**
 *
 * Navigasyon sürmüyorken yalnız GPS ve AĞ eksenleri anlamlıdır; rota/ilerleme/
 * reroute eksenleri `UNKNOWN` kalır — rota yokken "rota bozuk" demek uydurmadır.
 */
export function buildNavFailureMatrix(i: NavFailureMatrixInput): NavFailureMatrix {
  const axes: NavAxisVerdict[] = [_gps(i), _network(i), _search(i)];

  if (i.navActive) {
    axes.push(_routeProvider(i), _geometry(i), _progress(i), _reroute(i));
  } else {
    /* Rota yokken bu eksenler hakkında hüküm VERİLMEZ. */
    for (const axis of ['ROUTE_PROVIDER', 'GEOMETRY', 'PROGRESS', 'REROUTE'] as const) {
      axes.push({ axis, state: 'UNKNOWN', why: 'navigasyon sürmüyor' });
    }
  }

  let worst: NavAxisVerdict | null = null;
  for (const a of axes) {
    if (a.state === 'HEALTHY') continue;
    if (worst === null || _SEVERITY[a.state] > _SEVERITY[worst.state]) worst = a;
  }

  const overall: NavAxisState = worst === null ? 'HEALTHY' : worst.state;
  const summary = worst === null
    ? 'tüm eksenler sağlıklı'
    : `${NAV_AXIS_LABEL[worst.axis]}: ${NAV_AXIS_STATE_LABEL[worst.state]} — ${worst.why}`;

  return { axes, overall, worstAxis: worst?.axis ?? null, summary };
}
