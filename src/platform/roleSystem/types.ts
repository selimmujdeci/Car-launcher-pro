export type Role = 'driver' | 'technician' | 'admin' | 'super_admin' | 'guest';

export type Permission =
  | 'reverseCamera'     // geri görüş kamerası
  | 'obdData'           // OBD veri okuma
  | 'canDebug'          // CAN debug paneli
  | 'settingsFull'      // tüm ayarlara erişim
  | 'accessAdminPanel'; // süper admin yönetim paneli

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  guest:       [],
  driver:      ['reverseCamera', 'obdData'],
  technician:  ['reverseCamera', 'obdData', 'canDebug'],
  admin:       ['reverseCamera', 'obdData', 'canDebug', 'settingsFull'],
  super_admin: ['reverseCamera', 'obdData', 'canDebug', 'settingsFull', 'accessAdminPanel'],
} as const;

/** Supabase app_metadata.role değeri — super_admin için beklenen claim */
export const SUPER_ADMIN_ROLE_CLAIM = 'super_admin' as const;

/** E-posta tabanlı ikinci güvenlik katmanı — beyaz liste */
export const SUPER_ADMIN_EMAIL_ALLOWLIST: readonly string[] = [
  'admin@carospro.com',
  'selimmujdeci1@gmail.com',
] as const;
