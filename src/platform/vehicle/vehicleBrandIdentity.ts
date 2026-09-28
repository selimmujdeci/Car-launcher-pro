/**
 * vehicleBrandIdentity — OBD'siz araç kimliği (marka/model/yıl) yazımı ve
 * VIN WMI ile karşılaştırma.
 *
 * Yeni otorite DEĞİL: kimlik, mevcut kanonik sahibin (`useStore` aktif
 * `VehicleProfile`) alanlarına yazılır. VIN tarafı `vehicleIdentity`
 * (getCanonicalVin) kapısından okunur — bayat/çelişkili VIN karşılaştırılmaz.
 *
 * Kural: kullanıcı seçimi VIN kanıtı gibi sunulmaz; VIN seçimle çelişirse
 * sessizce ezilmez, `conflict` döner ve UI kullanıcıya sorar.
 */

import { useStore, type VehicleProfile } from '../../store/useStore';
import { brandFromWmi, getBrand, type CarBrand, type VehicleIdentitySource } from './brandCatalog';
import { getCanonicalVin, currentVinEpoch } from './vehicleIdentity';

export type VinBrandCheck =
  | { kind: 'no_vin' }
  /** VIN var ama WMI tabloda yok — marka bilinmiyor, çelişki de yok. */
  | { kind: 'unknown_wmi'; wmi: string }
  | { kind: 'match'; brand: CarBrand }
  /** Kullanıcı marka seçmemiş; VIN bir marka gösteriyor (öneri). */
  | { kind: 'suggest'; vinBrand: CarBrand }
  | { kind: 'conflict'; vinBrand: CarBrand; selected: CarBrand | null };

/** Saf karşılaştırma — `vin` doğrulanmış kanonik VIN olmalı (ya da null). */
export function checkBrandAgainstVin(
  vin: string | null,
  profile: Pick<VehicleProfile, 'brandId' | 'vinBrandConflictDismissedFor'> | null,
): VinBrandCheck {
  if (!vin) return { kind: 'no_vin' };
  const vinBrand = brandFromWmi(vin);
  if (!vinBrand) return { kind: 'unknown_wmi', wmi: vin.slice(0, 3) };
  if (!profile?.brandId) return { kind: 'suggest', vinBrand };
  if (profile.brandId === vinBrand.id) return { kind: 'match', brand: vinBrand };
  if (profile.vinBrandConflictDismissedFor === vin) return { kind: 'no_vin' };
  return { kind: 'conflict', vinBrand, selected: getBrand(profile.brandId) };
}

/** Şu anki kanonik VIN (yoksa/bayatsa/çelişkiliyse null). */
export function currentCanonicalVin(): string | null {
  return getCanonicalVin(currentVinEpoch(), new Date().getFullYear());
}

export function getActiveVehicleProfile(): VehicleProfile | null {
  const s = useStore.getState().settings;
  return s.vehicleProfiles.find((p) => p.id === s.activeVehicleProfileId) ?? null;
}

export interface VehicleIdentityInput {
  brandId: string | null;
  model?: string;
  modelYear?: number | null;
  source: VehicleIdentitySource;
}

/**
 * Aktif araç profiline marka/model/yıl yazar; aktif profil yoksa bir tane
 * oluşturup aktif yapar (mevcut `addVehicleProfile`/`setActiveVehicleProfile`).
 */
export function saveVehicleIdentity(input: VehicleIdentityInput): void {
  const st = useStore.getState();
  const brand = getBrand(input.brandId);
  const model = input.model?.trim().slice(0, 40) || undefined;
  const year = input.modelYear && input.modelYear >= 1950 && input.modelYear <= new Date().getFullYear() + 1
    ? Math.round(input.modelYear) : undefined;
  const patch: Partial<VehicleProfile> = {
    brandId: brand?.id, model, modelYear: year,
    identitySource: brand ? input.source : undefined,
  };
  const active = getActiveVehicleProfile();
  if (active) { st.updateVehicleProfile(active.id, patch); return; }

  const now = Date.now();
  const id = `vp-${now}`;
  const name = [brand?.name, model].filter(Boolean).join(' ') || 'Aracım';
  st.addVehicleProfile({ id, name, createdAt: new Date(now).toISOString(), lastUsedAt: null, ...patch });
  st.setActiveVehicleProfile(id);
}

/** VIN çelişkisinde kullanıcı "VIN'e göre düzelt" dedi. */
export function acceptVinBrand(vinBrand: CarBrand): void {
  const active = getActiveVehicleProfile();
  if (!active) return;
  useStore.getState().updateVehicleProfile(active.id, {
    brandId: vinBrand.id, identitySource: 'vin_proven', vinBrandConflictDismissedFor: undefined,
  });
}

/** Kullanıcı "seçimim doğru" dedi — aynı VIN için tekrar sorulmaz. */
export function dismissVinBrandConflict(vin: string): void {
  const active = getActiveVehicleProfile();
  if (active) useStore.getState().updateVehicleProfile(active.id, { vinBrandConflictDismissedFor: vin });
}
