/**
 * deprecatedPairingRoutes.ts — KULLANIMDAN KALDIRILAN EŞLEŞTİRME YOLLARI (SAF).
 *
 * TEK OTORİTE: head unit `register_vehicle` → 6 haneli kısa ömürlü kod →
 * Fleet panosu → `POST /api/vehicle/link` → `pair_vehicle_to_user()`.
 *
 * Bu dosya, kapatılan yolları TEK YERDE listeler ki (a) rotalar aynı gövdeyi
 * dönsün, (b) CAROS LAB `deprecatedPairingRoutes` alanını gerçek veriden
 * üretsin, (c) kilit testi yeni bir ikinci otoritenin sessizce açılmasını
 * yakalayabilsin.
 *
 * SAF: I/O YOK · React YOK · global durum YOK.
 */

export const CANONICAL_PAIRING_FLOW =
  'HEAD_UNIT_register_vehicle → 6_HANELI_KOD → /api/vehicle/link → pair_vehicle_to_user' as const;

export interface DeprecatedRoute {
  /** Rota yolu. */
  readonly path: string;
  /** HTTP durum kodu — kalıcı kaldırma için 410. */
  readonly status: 410;
  /** Makine-okur sebep kodu (kullanıcıya teknik detay sızdırmaz). */
  readonly code: 'PAIRING_FLOW_UNAVAILABLE' | 'ROUTE_DEPRECATED';
  /** Neden kapatıldı — kod kanıtıyla. */
  readonly reason: string;
}

export const DEPRECATED_PAIRING_ROUTES: readonly DeprecatedRoute[] = [
  {
    path: '/api/pwa/pair',
    status: 410,
    code: 'PAIRING_FLOW_UNAVAILABLE',
    reason:
      'pair_vehicle(text) RPC hiçbir migration\'da tanımlı değil · ' +
      'vehicles.pairing_code kolonu oluşturulmuyor · oturumsuz çalışıp raw api_key döndürüyordu',
  },
  {
    path: '/api/vehicle/register',
    status: 410,
    code: 'ROUTE_DEPRECATED',
    reason:
      'Head unit bu rotayı HİÇ çağırmıyor (register_vehicle RPC\'sini doğrudan kullanır) · ' +
      'api_key_hash kolon şemasıyla çalışıyor · yanıtta raw apiKey dönüyordu',
  },
  {
    path: '/api/vehicle/code',
    status: 410,
    code: 'ROUTE_DEPRECATED',
    reason:
      'Head unit bu rotayı HİÇ çağırmıyor (refresh_linking_code RPC\'sini doğrudan kullanır) · ' +
      'api_key_hash kolon şemasıyla çalışıyor',
  },
];

/** Rota gövdesi — tek tip, teknik detay sızdırmaz. */
export function deprecatedRouteBody(route: DeprecatedRoute): {
  error: string; code: string; canonicalFlow: string;
} {
  /* #631 — mesaj GÜNCELLENDİ: eşleştirme artık YALNIZ filo panosundan değil,
     uygulamanın kendi "Eşleştir" ekranından da yapılır (ikisi de aynı kanonik
     rotayı kullanır: `/api/vehicle/link` → `pair_vehicle_to_user`, bireysel
     hesap için `company_id` null). Kullanıcıyı var olmayan bir zorunluluğa
     yönlendirmek YANLIŞ bilgidir. */
  return {
    error:
      'Bu uç nokta kullanımdan kaldırıldı. Araç bağlamak için uygulamadaki ' +
      '"Eşleştir" ekranından (ya da filo hesabıysanız Filo panosu → "Araç Ekle") ' +
      'araç ekranında görünen 6 haneli kodu girin.',
    code: route.code,
    canonicalFlow: 'VEHICLE_LINK_6_DIGIT_CODE',
  };
}

/** LAB gözlemi için özet (hassas veri taşımaz). */
export function deprecatedRoutesSummary(): {
  canonicalPairingFlow: string;
  deprecatedCount: number;
  paths: readonly string[];
} {
  return {
    canonicalPairingFlow: CANONICAL_PAIRING_FLOW,
    deprecatedCount: DEPRECATED_PAIRING_ROUTES.length,
    paths: DEPRECATED_PAIRING_ROUTES.map((r) => r.path),
  };
}
