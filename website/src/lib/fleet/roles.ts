/**
 * roles.ts — FİLO ROL / CAPABILITY MATRİSİ (saf, I/O yok).
 *
 * Tek otorite: bir rolün ne yapabileceği YALNIZ burada tanımlanır. Hem sunucu
 * rotaları hem UI aynı matrisi okur — ama **UI görünürlüğü güvenlik DEĞİLDİR**:
 * her rota `assertCapability()` ile sunucu tarafında ayrıca doğrular.
 *
 * Saf modül: React importu YOK · I/O YOK · timer YOK · `Date.now()` YOK.
 */

/** Şirket üyelik rolleri. `individual` = şirketi olmayan bireysel kullanıcı. */
export const FLEET_ROLES = ['individual', 'observer', 'member', 'admin'] as const;
export type FleetRole = (typeof FLEET_ROLES)[number];

/** Sunucuda `profiles.role` başka değer taşıyabilir (ör. super_admin). */
export function isFleetRole(value: unknown): value is FleetRole {
  return typeof value === 'string' && (FLEET_ROLES as readonly string[]).includes(value);
}

export const CAPABILITIES = [
  'company.read',
  'company.update',
  'company.delete',
  'member.read',
  'member.invite',
  'member.role.update',
  'member.remove',
  'vehicle.read',
  'vehicle.assign',
  'vehicle.remove',
  'vehicle.command',
  'vehicle.location.read',
  'vehicle.diagnostics.read',
  'vehicle.settings.update',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Rol → yetki matrisi.
 *
 * · individual : şirketi yok. Şirket/üyelik yetkisi SIFIR; kendi aracını yönetir.
 *                (Kendi aracına erişim `owner_id` ile sağlanır, rolle değil.)
 * · observer   : SALT-OKUNUR. Hiçbir yazma yetkisi yok — komut bile gönderemez.
 * · member     : şirket araçlarını okur ve komut gönderir; üyelik/şirket yönetemez.
 * · admin      : şirket ve üyelik yönetimi dahil tam yetki.
 */
const MATRIX: Readonly<Record<FleetRole, readonly Capability[]>> = {
  individual: [
    'vehicle.read',
    'vehicle.command',
    'vehicle.location.read',
    'vehicle.diagnostics.read',
    'vehicle.settings.update',
  ],
  observer: [
    'company.read',
    'member.read',
    'vehicle.read',
    'vehicle.location.read',
    'vehicle.diagnostics.read',
  ],
  member: [
    'company.read',
    'member.read',
    'vehicle.read',
    'vehicle.command',
    'vehicle.location.read',
    'vehicle.diagnostics.read',
  ],
  admin: [
    'company.read',
    'company.update',
    'company.delete',
    'member.read',
    'member.invite',
    'member.role.update',
    'member.remove',
    'vehicle.read',
    'vehicle.assign',
    'vehicle.remove',
    'vehicle.command',
    'vehicle.location.read',
    'vehicle.diagnostics.read',
    'vehicle.settings.update',
  ],
} as const;

/** Rolün yetkisi var mı. Bilinmeyen rol → fail-closed `false`. */
export function can(role: unknown, capability: Capability): boolean {
  if (!isFleetRole(role)) return false;
  return MATRIX[role].includes(capability);
}

/** Rolün tüm yetkileri (UI görünürlüğü ve snapshot için). */
export function capabilitiesOf(role: unknown): readonly Capability[] {
  if (!isFleetRole(role)) return [];
  return MATRIX[role];
}

/** `add_company_member` ile atanabilecek roller — `individual` atanamaz. */
export const ASSIGNABLE_ROLES = ['observer', 'member', 'admin'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === 'string' && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}
