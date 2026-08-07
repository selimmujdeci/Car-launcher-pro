/**
 * ownershipSnapshot.ts — SON DOĞRULANMIŞ SAHİPLİK/ŞİRKET ANLIK GÖRÜNTÜSÜ.
 *
 * Snapshot YALNIZ sunucuda doğrulanmış erişimi temsil eder. Çevrimdışıyken
 * YENİ YETKİ UYDURULMAZ; süresi geçmiş snapshot kritik yazma işlemlerine
 * izin VERMEZ (fail-closed).
 */

import { type Capability, type FleetRole, capabilitiesOf, isFleetRole } from '../fleet/roles';

export interface OwnershipSnapshot {
  userId:              string;
  companyId:           string | null;
  companyRole:         FleetRole;
  ownedVehicleIds:     readonly string[];
  accessibleVehicleIds:readonly string[];
  permissions:         readonly Capability[];
  serverRevision:      number;
  verifiedAt:          number;
  expiresAt:           number;
}

/** Snapshot ömrü: 24 saat. Sonrasında yalnız OKUMA amaçlı bilgi taşır. */
export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Kritik (yazma) yetkiler — süresi geçmiş snapshot ile ASLA kullanılamaz.
 * Okuma yetkileri bayat snapshot'la gösterilebilir (kullanıcıya "bayat"
 * olduğu ayrıca bildirilir), ama yazma fail-closed reddedilir.
 */
const CRITICAL_CAPABILITIES: readonly Capability[] = [
  'company.update',
  'company.delete',
  'member.invite',
  'member.role.update',
  'member.remove',
  'vehicle.assign',
  'vehicle.remove',
  'vehicle.command',
  'vehicle.settings.update',
];

export function isCriticalCapability(capability: Capability): boolean {
  return CRITICAL_CAPABILITIES.includes(capability);
}

export function buildSnapshot(input: {
  userId:               string;
  companyId:            string | null;
  companyRole:          unknown;
  ownedVehicleIds:      readonly string[];
  accessibleVehicleIds: readonly string[];
  serverRevision:       number;
  verifiedAt:           number;
  ttlMs?:               number;
}): OwnershipSnapshot {
  // Bilinmeyen rol → fail-closed 'individual' (en dar yetki).
  const role: FleetRole = isFleetRole(input.companyRole) ? input.companyRole : 'individual';
  return {
    userId:               input.userId,
    companyId:            input.companyId,
    companyRole:          role,
    ownedVehicleIds:      input.ownedVehicleIds,
    accessibleVehicleIds: input.accessibleVehicleIds,
    permissions:          capabilitiesOf(role),
    serverRevision:       input.serverRevision,
    verifiedAt:           input.verifiedAt,
    expiresAt:            input.verifiedAt + (input.ttlMs ?? SNAPSHOT_TTL_MS),
  };
}

export function isExpired(snapshot: OwnershipSnapshot, now: number): boolean {
  return snapshot.expiresAt <= now;
}

/**
 * Çevrimdışı yetki kararı — TEK KAPI.
 *
 * Fail-closed kurallar:
 *   · snapshot yok                     → reddet
 *   · snapshot başka kullanıcıya ait   → reddet (hesap değişimi izolasyonu)
 *   · rol yetkiye sahip değil          → reddet (observer admin işlemi YAPAMAZ)
 *   · snapshot süresi geçmiş + kritik  → reddet
 */
export function canOffline(
  snapshot: OwnershipSnapshot | null,
  userId: string,
  capability: Capability,
  now: number,
): boolean {
  if (!snapshot) return false;
  if (snapshot.userId !== userId) return false;
  if (!snapshot.permissions.includes(capability)) return false;
  if (isExpired(snapshot, now) && isCriticalCapability(capability)) return false;
  return true;
}

/** Aracın snapshot kapsamında olup olmadığı (cross-tenant sızıntı kapısı). */
export function canAccessVehicleOffline(
  snapshot: OwnershipSnapshot | null,
  userId: string,
  vehicleId: string,
): boolean {
  if (!snapshot) return false;
  if (snapshot.userId !== userId) return false;
  return (
    snapshot.ownedVehicleIds.includes(vehicleId) ||
    snapshot.accessibleVehicleIds.includes(vehicleId)
  );
}

/* ── Kalıcılık ─────────────────────────────────────────────────────────── */

const KEY_PREFIX = 'caros.fleet.snapshot.';

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function saveSnapshot(snapshot: OwnershipSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(keyFor(snapshot.userId), JSON.stringify(snapshot));
  } catch {
    /* fail-soft */
  }
}

/** Yalnız ISTENEN kullanıcının snapshot'ı okunur — başkasınınki OKUNAMAZ. */
export function loadSnapshot(userId: string): OwnershipSnapshot | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(keyFor(userId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OwnershipSnapshot;
    // Kimlik uyuşmazlığı → fail-closed
    if (!parsed || parsed.userId !== userId) return null;
    if (!isFleetRole(parsed.companyRole)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Çıkış / hesap değişimi — TÜM snapshot'lar silinir. */
export function clearAllSnapshots(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* fail-soft */
  }
}
