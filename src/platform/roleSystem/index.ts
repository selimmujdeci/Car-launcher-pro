export { useRoleStore } from './RoleStore';
export type { Role, Permission } from './types';
export { ROLE_PERMISSIONS } from './types';

import { useRoleStore } from './RoleStore';
import type { Permission } from './types';

/** Mevcut rolün verilen izne sahip olup olmadığını döner. */
export function usePermission(permission: Permission): boolean {
  return useRoleStore((s) => s.can(permission));
}
