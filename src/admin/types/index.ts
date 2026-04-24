// ── Roles ──────────────────────────────────────────────────────
export type Role = 'super_admin' | 'admin' | 'operator' | 'viewer'

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Süper Admin',
  admin:       'Admin',
  operator:    'Operatör',
  viewer:      'Görüntüleyici',
}

/** Büyük sayı = daha fazla yetki */
export const ROLE_RANK: Record<Role, number> = {
  super_admin: 100,
  admin:       70,
  operator:    40,
  viewer:      10,
}

export function hasRole(userRole: Role, required: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[required]
}

// ── Auth ───────────────────────────────────────────────────────
export interface AuthUser {
  id:           string
  email:        string
  full_name:    string
  role:         Role
  institution?: string
  avatar_url?:  string
}

// ── User ───────────────────────────────────────────────────────
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending'

export interface User {
  id:           string
  full_name:    string
  email:        string
  phone?:       string
  role:         Role
  status:       UserStatus
  institution?: string
  last_login?:  string
  created_at:   string
}

export type CreateUserDTO = Pick<User, 'full_name' | 'email' | 'role'> & {
  phone?: string
  institution?: string
}

// ── Vehicle ────────────────────────────────────────────────────
export type VehicleStatus = 'active' | 'idle' | 'maintenance' | 'offline'
export type FuelType      = 'diesel' | 'gasoline' | 'electric' | 'hybrid'
export type VehicleLinkRole = 'owner' | 'viewer'

export interface Vehicle {
  id:             string
  plate:          string
  brand:          string
  model:          string
  year:           number
  fuel_type:      FuelType
  status:         VehicleStatus
  current_km:     number
  driver_name?:   string
  institution?:   string
  speed?:         number
  last_seen?:     string
  ins_expiry?:    string
  created_at:     string
}

// ── Device Linking ─────────────────────────────────────────────

export interface VehicleUser {
  id:         string
  user_id:    string
  vehicle_id: string
  role:       VehicleLinkRole
  created_at: string
}

/** Returned by link_vehicle RPC on success. */
export interface LinkResult {
  vehicle_id: string
  name:       string
  plate?:     string
  brand?:     string
  model?:     string
  device_id?: string
}

/** Returned by register_vehicle RPC on first launch. */
export interface RegisterResult {
  vehicle_id:    string
  api_key:       string
  linking_code:  string
  expires_at:    string
}

export interface VehicleEvent {
  id:         string
  vehicle_id: string
  type:       string
  payload:    Record<string, unknown>
  created_at: string
}
