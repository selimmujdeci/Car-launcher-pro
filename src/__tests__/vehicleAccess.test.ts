/**
 * vehicleAccess — erişim seviyesi + NWD araç profili + özellik keşfi (salt okuma).
 * Profil girdisi kullanıcının ünitesindeki GERÇEK `can_config_app_cartype_json`dur (2026-10-02).
 */
import { describe, it, expect } from 'vitest';
import {
  parseNwdProfile, decideVehicleAccess, describeVehicleProfile, streamFreshness, type SeenFeatures,
} from '../platform/vehicleDataLayer/vehicleAccess';
import type { CanAccessNative } from '../platform/nativePlugin';

const MEGANE = JSON.stringify({
  canManagerClassName: 'com.nwd.can.service.impl.carcase.renault.raise.CanManager',
  canProviderKey: 'canprovider_raise_2e', canProviderName: 'Raise',
  carBandKey: 'carband_renault', carBandName: 'Renault',
  carTypeKey: 'cartype_renault_megane', carTypeName: 'Magane',
  carVersionKey: 'carversion_renault_megana_2015_15_now_h',
  carYearKey: 'caryear_renault_megane_2016_2025', carYearName: '2016-2025(4Gen)',
  carversionName: 'ile yüksek', hasAir: true,
});

const NONE_SEEN: SeenFeatures = {
  climate: false, doors: false, steering: false, tpms: false, trip: false, massage: false, ambient: false,
};
const native = (o: Partial<CanAccessNative> = {}): CanAccessNative => ({
  readLogs: false, canappDebug: 0, rawTap: false, rawFrames: 0, nwdProfile: MEGANE, nwdMenus: '', ...o,
});

describe('NWD araç profili', () => {
  it('gerçek Megane ayarı → marka · model · üst paket · Raise', () => {
    const p = parseNwdProfile(MEGANE)!;
    expect(p).toMatchObject({ brand: 'Renault', model: 'Megane', trim: 'high', box: 'Raise', manualClimate: false });
    expect(describeVehicleProfile(p)).toBe('Renault Megane · üst paket · Raise kutusu');
  });

  it('manuel klimalı paket ve bozuk girdi', () => {
    expect(parseNwdProfile(JSON.stringify({ carVersionKey: 'carversion_renault_megana_2015_15_now_l_manual' }))!)
      .toMatchObject({ trim: 'low', manualClimate: true });
    expect(parseNwdProfile('')).toBeNull();
    expect(parseNwdProfile('bozuk')).toBeNull();
  });
});

describe('erişim seviyesi (root GEREKMEZ — yalnız okunur)', () => {
  it('kurulum yok → TEMEL: SDK özellikleri açık, ham özellikler KİLİTLİ', () => {
    const a = decideVehicleAccess(native(), { ...NONE_SEEN, climate: true }, true);
    expect(a.tier).toBe('BASIC');
    expect(a.missingSetup).toEqual(['READ_LOGS', 'CANAPP_DEBUG']);
    expect(a.features.climate).toBe('AVAILABLE');
    expect(a.features.doors).toBe('NOT_SEEN');
    expect(a.features.tpms).toBe('LOCKED');
    expect(a.features.massage).toBe('LOCKED');
    expect(a.rawFlowing).toBe(false);
  });

  it('kurulum tamam + çerçeve akıyor → TAM', () => {
    const a = decideVehicleAccess(native({ readLogs: true, canappDebug: 1, rawTap: true, rawFrames: 12 }),
      { ...NONE_SEEN, tpms: true }, true);
    expect(a.tier).toBe('FULL');
    expect(a.features.tpms).toBe('AVAILABLE');
    expect(a.features.massage).toBe('NOT_SEEN');     // yok olduğu KANITLANMADI
    expect(a.rawFlowing).toBe(true);
  });

  it('NWD profili de CAN verisi de yok → NONE; native okunamadı → UNKNOWN', () => {
    expect(decideVehicleAccess(native({ nwdProfile: '' }), NONE_SEEN, false).tier).toBe('NONE');
    expect(decideVehicleAccess(native({ nwdProfile: '' }), NONE_SEEN, false).features.climate).toBe('NO_SOURCE');
    expect(decideVehicleAccess(null, NONE_SEEN, false).tier).toBe('UNKNOWN');
  });
});

describe('CAN akışı tazeliği (süzgeçten ÖNCE ölçülen yaş)', () => {
  it('15 sn içinde veri → canlı; aşarsa bayat; native alanı yoksa bilinmiyor', () => {
    expect(streamFreshness(native({ sdkAgeMs: 3_000, rawAgeMs: -1 }))).toEqual({ stream: 'LIVE', ageMs: 3_000 });
    expect(streamFreshness(native({ sdkAgeMs: 40_000, rawAgeMs: 20_000 }))).toEqual({ stream: 'STALE', ageMs: 20_000 });
    expect(streamFreshness(native({ sdkAgeMs: -1, rawAgeMs: -1 }))).toEqual({ stream: 'STALE', ageMs: null });
    expect(streamFreshness(native())).toEqual({ stream: 'UNKNOWN', ageMs: null });
    expect(streamFreshness(null).stream).toBe('UNKNOWN');
  });

  it('ham çerçeve sustuysa "akıyor" sayılmaz (yokluk çıkarımı yapılmaz)', () => {
    const full = { readLogs: true, canappDebug: 1, rawTap: true, rawFrames: 50 };
    expect(decideVehicleAccess(native({ ...full, rawAgeMs: 2_000, sdkAgeMs: 2_000 }), NONE_SEEN, true).rawFlowing).toBe(true);
    expect(decideVehicleAccess(native({ ...full, rawAgeMs: 60_000, sdkAgeMs: 60_000 }), NONE_SEEN, true)).toMatchObject({
      rawFlowing: false, stream: 'STALE',
    });
  });
});
