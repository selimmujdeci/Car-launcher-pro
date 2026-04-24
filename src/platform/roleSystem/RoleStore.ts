import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Role, Permission } from './types';
import { ROLE_PERMISSIONS } from './types';

interface RoleStore {
  role: Role;
  setRole: (role: Role) => void;
  can: (permission: Permission) => boolean;
}

export const useRoleStore = create<RoleStore>()(
  persist(
    (set, get) => ({
      role: 'driver',
      setRole: (role) => set({ role }),
      can: (permission) => (ROLE_PERMISSIONS[get().role] as readonly string[]).includes(permission),
    }),
    { name: 'car-launcher-role' },
  ),
);
