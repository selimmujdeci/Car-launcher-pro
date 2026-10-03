/**
 * vehicleAccess — CAN erişim seviyesi + araç profili + özellik keşfi (SALT OKUMA projeksiyonu).
 *
 * Hibrit ilke (ürün kararı 2026-10-02): hiçbir özellik root'a bağlı değildir.
 *  · TEMEL (BASIC): NWD SDK — klima · kapılar · direksiyon açısı (her NWD ünitesi).
 *  · TAM (FULL): + ham çerçeve (lastik · yol bilgisayarı · masaj/ambiyans durumu, aracın
 *    yankısıyla onay). Tek seferlik KURULUM adımı ister (READ_LOGS + NWD canapp_debug) —
 *    kurulumu yapan kişi bilerek uygular; uygulama yetki ALMAZ, yalnız durumu OKUR.
 *
 * Bu modül yeni bir doğruluk deposu KURMAZ: girdi native durum (izin/ayar) + store'da
 * görülmüş veri; çıktı her çağrıda yeniden hesaplanır. Bilinmeyen → UNKNOWN (sahte "var" yok).
 */

import { CarLauncher, type CanAccessNative } from '../nativePlugin';
import { useUnifiedVehicleStore } from './UnifiedVehicleStore';

export type VehicleAccessTier = 'FULL' | 'BASIC' | 'NONE' | 'UNKNOWN';

/**
 * CAN akışı canlı mı. Native yaşı TEKRAR SÜZGECİNDEN ÖNCE ölçer: kutu ~3 sn'de bir
 * nabız çerçevesi gönderir (sahada 0x71/0x73/0x7D) → değer değişmese de yaş tazelenir.
 * Sessizlik bu pencereyi aşarsa store'daki CAN değerleri "şu an" DEĞİL, "son bilinen"dir.
 */
export const CAN_STREAM_LIVE_MS = 15_000;
export type CanStreamFreshness = 'LIVE' | 'STALE' | 'UNKNOWN';

/** Tam erişim için eksik kurulum adımları. */
export type AccessSetupStep = 'READ_LOGS' | 'CANAPP_DEBUG';

export type VehicleFeature = 'climate' | 'doors' | 'steering' | 'tpms' | 'trip' | 'massage' | 'ambient';

export type FeatureAvailability =
  /** Araçtan bu oturumda veri geldi. */
  | 'AVAILABLE'
  /** Kaynak açık ama araç henüz bildirmedi (yok olduğu KANITLANMADI). */
  | 'NOT_SEEN'
  /** Tam erişim (kurulum) gerekiyor. */
  | 'LOCKED'
  /** Bu cihazda CAN kaynağı yok. */
  | 'NO_SOURCE';

export interface VehicleProfile {
  readonly brand: string | null;
  readonly model: string | null;
  readonly years: string | null;
  /** NWD paket anahtarı son eki: üst / orta / alt (+ manuel klima). */
  readonly trim: 'high' | 'mid' | 'low' | null;
  readonly manualClimate: boolean;
  /** CAN kutusu üreticisi (Raise, Hiworld…). */
  readonly box: string | null;
  readonly versionKey: string | null;
}

export interface VehicleAccessState {
  readonly tier: VehicleAccessTier;
  readonly missingSetup: readonly AccessSetupStep[];
  readonly profile: VehicleProfile | null;
  readonly features: Readonly<Record<VehicleFeature, FeatureAvailability>>;
  /** Ham çerçeveler GERÇEKTEN geliyor (ayarlar açık + dinleyici YAKIN zamanda çerçeve gördü). */
  readonly rawFlowing: boolean;
  /** CAN akışı (SDK ya da ham) canlı mı; store değerleri buna göre "şu an" / "son bilinen". */
  readonly stream: CanStreamFreshness;
  /** En taze kaynağın yaşı (ms); bilinmiyor/hiç veri yok → null. */
  readonly streamAgeMs: number | null;
}

/** Yaş → tazelik. -1/undefined = hiç gelmedi. Native alan yoksa (eski sürüm) UNKNOWN. */
export function streamFreshness(
  native: CanAccessNative | null,
): { stream: CanStreamFreshness; ageMs: number | null } {
  if (!native || (native.sdkAgeMs === undefined && native.rawAgeMs === undefined)) {
    return { stream: 'UNKNOWN', ageMs: null };
  }
  const ages = [native.sdkAgeMs, native.rawAgeMs].filter((a): a is number => typeof a === 'number' && a >= 0);
  if (ages.length === 0) return { stream: 'STALE', ageMs: null };
  const age = Math.min(...ages);
  return { stream: age <= CAN_STREAM_LIVE_MS ? 'LIVE' : 'STALE', ageMs: age };
}

/** Bu oturumda araçtan gelmiş veri grupları. */
export type SeenFeatures = Readonly<Record<VehicleFeature, boolean>>;

const RAW_FEATURES: ReadonlySet<VehicleFeature> = new Set(['tpms', 'trip', 'massage', 'ambient']);

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** NWD `can_config_app_cartype_json` → profil. Bozuk/boş → null. */
export function parseNwdProfile(json: string | null | undefined): VehicleProfile | null {
  if (!json) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(json) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const str = (k: string): string | null => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : null);
  const bandKey = str('carBandKey');          // carband_renault
  const typeKey = str('carTypeKey');          // cartype_renault_megane
  const versionKey = str('carVersionKey');    // carversion_renault_megana_2015_15_now_h
  const brandRaw = bandKey ? bandKey.replace(/^carband_/, '') : null;
  const brand = brandRaw ? cap(brandRaw) : str('carBandName');
  let model: string | null = null;
  if (typeKey) {
    const rest = typeKey.replace(/^cartype_/, '');
    model = cap((brandRaw && rest.startsWith(`${brandRaw}_`) ? rest.slice(brandRaw.length + 1) : rest).replace(/_/g, ' '));
  }
  const suffix = versionKey ? /_(h|m|l)(_manual)?$/.exec(versionKey) : null;
  const trim = suffix ? ({ h: 'high', m: 'mid', l: 'low' } as const)[suffix[1] as 'h' | 'm' | 'l'] : null;
  return Object.freeze({
    brand,
    model,
    years: str('carYearName'),
    trim,
    manualClimate: !!versionKey && /_manual$/.test(versionKey),
    box: str('canProviderName'),
    versionKey,
  });
}

/** Erişim seviyesi + özellik durumları — SAF. `native === null` → durum okunamadı (UNKNOWN). */
export function decideVehicleAccess(
  native: CanAccessNative | null, seen: SeenFeatures, canAlive: boolean,
): VehicleAccessState {
  const profile = native ? parseNwdProfile(native.nwdProfile) : null;
  let tier: VehicleAccessTier;
  const missing: AccessSetupStep[] = [];
  if (!native) {
    tier = 'UNKNOWN';
  } else if (!profile && !canAlive) {
    tier = 'NONE';
  } else {
    if (!native.readLogs) missing.push('READ_LOGS');
    if (native.canappDebug !== 1) missing.push('CANAPP_DEBUG');
    tier = missing.length === 0 ? 'FULL' : 'BASIC';
  }
  const features = {} as Record<VehicleFeature, FeatureAvailability>;
  for (const f of ['climate', 'doors', 'steering', 'tpms', 'trip', 'massage', 'ambient'] as const) {
    if (seen[f]) features[f] = 'AVAILABLE';
    else if (tier === 'NONE') features[f] = 'NO_SOURCE';
    else if (RAW_FEATURES.has(f) && tier === 'BASIC') features[f] = 'LOCKED';
    else features[f] = 'NOT_SEEN';
  }
  const rawAge = native?.rawAgeMs;
  const rawFlowing = tier === 'FULL' && !!native && native.rawTap && native.rawFrames > 0
    && (rawAge === undefined || (rawAge >= 0 && rawAge <= CAN_STREAM_LIVE_MS));
  const { stream, ageMs } = tier === 'NONE' ? { stream: 'UNKNOWN' as const, ageMs: null } : streamFreshness(native);
  return Object.freeze({
    tier, missingSetup: Object.freeze(missing), profile, features: Object.freeze(features), rawFlowing,
    stream, streamAgeMs: ageMs,
  });
}

/** Store'da bu oturumda görülmüş veri grupları. */
export function seenFeaturesFromStore(): SeenFeatures {
  const s = useUnifiedVehicleStore.getState();
  return {
    climate: s.canClimate !== null, doors: s.canDoors !== null, steering: s.canSteeringAngle !== null,
    tpms: s.canTpms !== null, trip: s.canTrip !== null, massage: s.canMassage !== null, ambient: s.canAmbient !== null,
  };
}

/** Native durumu okur (fail-soft: okunamazsa UNKNOWN — eski davranış korunur). */
export async function readVehicleAccess(): Promise<VehicleAccessState> {
  let native: CanAccessNative | null = null;
  try { native = (await CarLauncher.getCanAccess?.()) ?? null; } catch { native = null; }
  const seen = seenFeaturesFromStore();
  const canAlive = Object.values(seen).some(Boolean);
  return decideVehicleAccess(native, seen, canAlive);
}

/** Profilin kısa Türkçe adı: "Renault Megane · üst paket · Raise kutusu". */
export function describeVehicleProfile(p: VehicleProfile | null): string | null {
  if (!p || (!p.brand && !p.model)) return null;
  const parts = [[p.brand, p.model].filter(Boolean).join(' ')];
  if (p.trim) parts.push(`${{ high: 'üst', mid: 'orta', low: 'alt' }[p.trim]} paket`);
  if (p.box) parts.push(`${p.box} kutusu`);
  return parts.join(' · ');
}
