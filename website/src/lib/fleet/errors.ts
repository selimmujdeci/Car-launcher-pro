/**
 * errors.ts — TYPED ve STABİL filo hata kodları (saf, I/O yok).
 *
 * Kodlar API sözleşmesinin parçasıdır: istemci bunlara göre dallanır ve
 * conflict motoru bunları conflict türüne çevirir. **Kod adı DEĞİŞTİRİLMEZ**
 * (yalnız eklenir) — aksi hâlde eski istemciler sessizce bozulur.
 */

export const FLEET_ERROR_CODES = [
  'unauthenticated',
  'permission_denied',
  'not_company_admin',
  'no_company',
  'already_member_of_company',
  'user_belongs_to_another_company',
  'target_user_not_found',
  'invalid_role',
  'invalid_company_name',
  'invalid_request',
  'last_admin_protected',
  'cannot_modify_self_role',
  'vehicle_not_found',
  'vehicle_in_another_company',
  'vehicle_owned_by_another_user',
  'vehicle_belongs_to_another_company',
  'pairing_code_expired',
  'pairing_code_already_used',
  'invalid_or_expired_code',
  'individual_vehicle_limit_reached',
  'stale_client_revision',
  'duplicate_operation',
  'company_deleted',
  /** Çevrimdışıyken kuyruğa ALINAMAYAN güvenlik/sahiplik işlemi (istemci tarafı). */
  'requires_online',
  /** Kuyruk sınırı doldu — işlem sessizce kaybedilmedi, açıkça reddedildi. */
  'offline_queue_full',
  /** Hesap temizliği/recovery sürerken account-scoped iş başlatılamaz. */
  'account_cleanup_in_progress',
  'supabase_not_configured',
  'server_error',
] as const;

export type FleetErrorCode = (typeof FLEET_ERROR_CODES)[number];

export function isFleetErrorCode(value: unknown): value is FleetErrorCode {
  return typeof value === 'string' && (FLEET_ERROR_CODES as readonly string[]).includes(value);
}

/** Kod → HTTP durumu. Bilinmeyen kod fail-closed 500 döner. */
const HTTP_STATUS: Readonly<Record<FleetErrorCode, number>> = {
  unauthenticated:                    401,
  permission_denied:                  403,
  not_company_admin:                  403,
  no_company:                         404,
  already_member_of_company:          409,
  user_belongs_to_another_company:    409,
  target_user_not_found:              404,
  invalid_role:                       400,
  invalid_company_name:               400,
  invalid_request:                    400,
  last_admin_protected:               409,
  cannot_modify_self_role:            409,
  vehicle_not_found:                  404,
  vehicle_in_another_company:         409,
  vehicle_owned_by_another_user:      409,
  vehicle_belongs_to_another_company: 409,
  pairing_code_expired:               410,
  pairing_code_already_used:          409,
  invalid_or_expired_code:            400,
  individual_vehicle_limit_reached:   403,
  stale_client_revision:              409,
  duplicate_operation:                409,
  company_deleted:                    410,
  requires_online:                    503,
  offline_queue_full:                 507,
  account_cleanup_in_progress:        423,
  supabase_not_configured:            503,
  server_error:                       500,
};

export function httpStatusFor(code: FleetErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}

/** Kullanıcıya gösterilecek Türkçe mesaj — teknik yığın ASLA sızmaz. */
const MESSAGES: Readonly<Record<FleetErrorCode, string>> = {
  unauthenticated:                    'Oturum açmanız gerekiyor.',
  permission_denied:                  'Bu işlem için yetkiniz yok.',
  not_company_admin:                  'Bu işlemi yalnızca filo yöneticisi yapabilir.',
  no_company:                         'Henüz bir filonuz yok.',
  already_member_of_company:          'Zaten bir filoya bağlısınız. Yeni filo kuramazsınız.',
  user_belongs_to_another_company:    'Bu kullanıcı başka bir filoya bağlı.',
  target_user_not_found:              'Kullanıcı bulunamadı.',
  invalid_role:                       'Geçersiz rol.',
  invalid_company_name:               'Filo adı 2-120 karakter olmalı.',
  invalid_request:                    'İstek geçersiz.',
  last_admin_protected:               'Son yöneticiyi kaldıramaz veya rolünü düşüremezsiniz.',
  cannot_modify_self_role:            'Kendi rolünüzü değiştiremezsiniz.',
  vehicle_not_found:                  'Araç bulunamadı.',
  vehicle_in_another_company:         'Bu araç başka bir filoya bağlı.',
  vehicle_owned_by_another_user:      'Bu araç başka bir kullanıcıya ait.',
  vehicle_belongs_to_another_company: 'Bu araç başka bir filoya bağlı.',
  pairing_code_expired:               'Eşleştirme kodunun süresi dolmuş.',
  pairing_code_already_used:          'Bu eşleştirme kodu daha önce kullanılmış.',
  invalid_or_expired_code:            'Kod geçersiz veya süresi dolmuş.',
  individual_vehicle_limit_reached:   'Bireysel hesapla en fazla 3 araç bağlayabilirsiniz.',
  stale_client_revision:              'Veriler değişmiş. Sayfayı yenileyip tekrar deneyin.',
  duplicate_operation:                'Bu işlem zaten kaydedilmiş.',
  company_deleted:                    'Bu filo silinmiş.',
  requires_online:                    'Bu işlem için internet bağlantısı gerekli. Güvenlik ve yetki değişiklikleri çevrimdışı kaydedilemez.',
  offline_queue_full:                 'Bekleyen işlem sayısı sınıra ulaştı. Bağlantı sağlanıp mevcut işlemler gönderilmeden yenisi eklenemez.',
  account_cleanup_in_progress:        'Güvenli oturum temizliği sürüyor. Filo işlemleri geçici olarak kilitlendi.',
  supabase_not_configured:            'Sunucu yapılandırılmamış.',
  server_error:                       'Beklenmeyen bir hata oluştu.',
};

export function messageFor(code: FleetErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.server_error;
}

/**
 * Postgres RPC hata metnini typed koda çevirir.
 *
 * Fail-closed: tanınmayan hata `server_error` olur — ASLA "başarılı" sayılmaz
 * ve ham Postgres metni istemciye SIZDIRILMAZ.
 */
export function mapRpcError(rawMessage: string | null | undefined): FleetErrorCode {
  const raw = (rawMessage ?? '').toLowerCase();
  if (!raw) return 'server_error';
  for (const code of FLEET_ERROR_CODES) {
    if (raw.includes(code)) return code;
  }
  return 'server_error';
}

export interface FleetErrorBody {
  error: string;
  code:  FleetErrorCode;
}

export function errorBody(code: FleetErrorCode): FleetErrorBody {
  return { error: messageFor(code), code };
}
