/**
 * deprecatedApiKeyRoutes.ts — HAM `api_key` İLE KİMLİK DOĞRULAYAN ÖLÜ UÇLAR (SAF).
 *
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────────
 * `deprecatedPairingRoutes.ts` EŞLEŞTİRME yollarını kapatır ve CAROS LAB'ın
 * `deprecatedPairingRoutes` alanını besler; bir kilit testi de o listeyi
 * dondurur. Bu üç rota eşleştirme değil KOMUT/TELEMETRİ ucudur ve farklı bir
 * nedenle ölüdür — aynı listeye karıştırmak iki kavramı tek isim altında
 * toplardı. Desen birebir aynıdır, liste ayrıdır.
 *
 * ── ÖLÇÜLEN KUSUR (2026-08-22) ────────────────────────────────────────────
 * Üçü de `verifyApiKey(rawKey, vehicles.api_key_hash)` çağırır; bu işlev
 * `sha256(rawKey) === kolon` karşılaştırması yapar. Ama kolon bir hash
 * TUTMAZ: `register_vehicle` `gen_random_uuid()::text` üretip AYNEN yazar
 * (üretim ölçümü: 834/834 satır UUID biçimli, SHA-256 biçimli 0).
 * → Eşleşme MATEMATİKSEL OLARAK İMKÂNSIZDIR; rotalar HER ZAMAN 401 döner.
 *
 * İkinci ölçüm: çağıran taraf anahtarı zaten SAKLAMIYOR. Kanonik eşleştirme
 * (#631) `api_key` döndürmez; `pairingService.storeLocalVehicle` boş dize
 * yazar ve `getStoredApiKey` boş dizeyi `null`a çevirir. Yani istek çoğu
 * durumda `Authorization` başlığı OLMADAN gider ve 400 alır.
 *
 * Sonuç: bu uçlar "bazen çalışıyordu" değil, HİÇ çalışmadı.
 *
 * ── NEDEN ONARILMADI ──────────────────────────────────────────────────────
 * Onarmak, düz metin anahtarı bearer secret olarak MEŞRULAŞTIRMAK olurdu.
 * Doğru sıra terstir: önce anahtar gerçekten hash'lenir (P0-001H), sonra bu
 * uçlar tek doğrulama otoritesine bağlanır (P0-001I). O zamana kadar
 * fail-closed ve AÇIK GEREKÇELİ kapalı dururlar — sessiz 401 yanlış teşhis
 * üretir ("anahtarım mı bozuk?"), 410 + kod gerçeği söyler.
 *
 * SAF: I/O YOK · React YOK · global durum YOK.
 */

/** Bu uçların yerine geçen, ÇALIŞAN yol. */
export const CANONICAL_COMMAND_FLOW =
  'SUPABASE_JWT_OTURUMU → vehicle_commands (RLS) → arac: fetch_pending_vehicle_commands' as const;

export interface DeprecatedApiKeyRoute {
  /** Rota yolu. */
  readonly path: string;
  /** 410 — kalıcı kaldırma ("geçici arıza" izlenimi vermez). */
  readonly status: 410;
  /** Makine-okur sebep kodu. */
  readonly code: 'API_KEY_AUTH_DISABLED';
  /** Neden kapatıldı — kod kanıtıyla. */
  readonly reason: string;
}

export const DEPRECATED_API_KEY_ROUTES: readonly DeprecatedApiKeyRoute[] = [
  {
    path: '/api/pwa/command',
    status: 410,
    code: 'API_KEY_AUTH_DISABLED',
    reason:
      'verifyApiKey sha256(raw) ile duz metin kolonu karsilastiriyor — eslesme imkansiz · ' +
      'oturumsuz PWA yolu anahtari zaten saklamiyor (#631) · ' +
      'critical_auth_verified istemcinin gonderdigi pinHash varligindan turetiliyordu',
  },
  {
    path: '/api/pwa/dtc-result',
    status: 410,
    code: 'API_KEY_AUTH_DISABLED',
    reason:
      'Ayni imkansiz dogrulama · cagiran DiagnosticsPanel anahtar bulamadigi icin ' +
      'Authorization basligi olmadan istek atiyor (HTTP 400)',
  },
  {
    path: '/api/vehicle/update',
    status: 410,
    code: 'API_KEY_AUTH_DISABLED',
    reason:
      'Ayni imkansiz dogrulama · kod tabaninda GERCEK cagiran YOK ' +
      '(realtimeEngine yalnizca yorumda anar) · kalicilastirma zaten push_vehicle_event RPC icinde',
  },
];

/** Rota gövdesi — tek tip, teknik detay sızdırmaz, sebebi MAKİNE-OKUR verir. */
export function deprecatedApiKeyRouteBody(route: DeprecatedApiKeyRoute): {
  error: string; code: string; canonicalFlow: string;
} {
  return {
    error:
      'Bu uç nokta kullanımdan kaldırıldı. Araç komutları ve teşhis sonuçları ' +
      'artık yalnızca hesabınızla giriş yaptığınızda çalışır. Lütfen uygulamada ' +
      'oturum açın ve aracınızı hesabınıza bağlayın.',
    code: route.code,
    canonicalFlow: CANONICAL_COMMAND_FLOW,
  };
}

/** LAB gözlemi için özet (hassas veri taşımaz). */
export function deprecatedApiKeyRoutesSummary(): {
  canonicalCommandFlow: string;
  deprecatedCount: number;
  paths: readonly string[];
} {
  return {
    canonicalCommandFlow: CANONICAL_COMMAND_FLOW,
    deprecatedCount: DEPRECATED_API_KEY_ROUTES.length,
    paths: DEPRECATED_API_KEY_ROUTES.map((r) => r.path),
  };
}
