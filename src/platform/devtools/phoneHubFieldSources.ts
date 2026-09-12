/**
 * phoneHubFieldSources.ts — Saha Doğrulama'nın TEK okuma noktası (P0.8).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ getter. `await` YOK.
 *  · Native saha sondası ÖNBELLEKTEN okunur (pull ekranın elle "ÖLÇÜMÜ BAŞLAT"ıyla).
 *  · Eşleştirme · keşif/tarama · BLE scan · RFCOMM · GATT · adapter aç-kapat · SCO ·
 *    ses yolu/modu değişimi · medya/transport komutu · çağrı · SMS · izin isteği ·
 *    vendor bind/broadcast — HİÇBİRİ YOK.
 *  · OBD tarafında YALNIZ mevcut getter'lar okunur (P0.5 kaynak katmanı yeniden
 *    kullanılır) — yeni davranış EKLENMEZ.
 *  · Her kaynak AYRI try/catch → biri patlarsa diğerleri okunur.
 *
 * ── PARALEL SİSTEM KURULMAZ ─────────────────────────────────────────────────
 * Donanım tarafı için P0.5'in `readPhoneHubProbeSnapshot()` fonksiyonu AYNEN
 * çağrılır; ikinci bir Bluetooth okuma katmanı YAZILMAZ.
 */

import { readPhoneHubProbeSnapshot } from './phoneHubProbeSources';
import { getPhoneHubFieldProbe } from '../phoneHub/phoneHubFieldProbe';
import type {
  PhoneHubFieldRaw, PhFieldIdentity, PhFieldCall, PhFieldMedia, Tri,
} from './phoneHubFieldModel';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

function _str(v: unknown, fallback = 'UNKNOWN'): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** -1 sentinel KORUNUR — "okunamadı" ile "0" AYRIDIR. */
function _int(v: unknown, fallback = -1): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function _tri(v: unknown): Tri {
  return v === 'YES' || v === 'NO' ? v : 'UNKNOWN';
}

/**
 * Tek atışlık ham saha gözlemi. Native sonda yoksa `fieldPresent:false` döner ve
 * kimlik/çağrı/medya blokları `null` kalır — SAHTE varsayılan ÜRETİLMEZ.
 */
export function readPhoneHubFieldSnapshot(): PhoneHubFieldRaw {
  const readAt = Date.now();

  /* P0.5 donanım katmanı — AYNEN yeniden kullanılır. */
  const hw = _safe(() => readPhoneHubProbeSnapshot());

  const native = _safe(() => getPhoneHubFieldProbe());
  const fieldPresent = !!(native && native.present === true);

  let identity: PhFieldIdentity | null = null;
  let call: PhFieldCall | null = null;
  let media: PhFieldMedia | null = null;

  if (fieldPresent && native) {
    const i = native.identity;
    if (i) {
      identity = {
        manufacturer:        _str(i.manufacturer),
        model:               _str(i.model),
        device:              _str(i.device),
        product:             _str(i.product),
        androidRelease:      _str(i.androidRelease),
        sdkInt:              _int(i.sdkInt),
        fingerprintSummary:  _str(i.fingerprintSummary),
        fingerprintHash:     _str(i.fingerprintHash),
        automotiveFeature:   _tri(i.automotiveFeature),
        carServicePresent:   _tri(i.carServicePresent),
        telephonyFeature:    _tri(i.telephonyFeature),
        headUnitMarkerCount: _int(i.headUnitMarkerCount),
        phoneOemMarkerCount: _int(i.phoneOemMarkerCount),
        vendorFamily:        _str(i.vendorFamily),
        deviceRoleTechnical: _str(i.deviceRoleTechnical),
        deviceRoleConfidence: _str(i.deviceRoleConfidence, 'NONE'),
      };
    }

    const c = native.call;
    if (c) {
      call = {
        dialerClass:             _str(c.dialerClass, 'UNAVAILABLE'),
        telecomManagerAvailable: _tri(c.telecomManagerAvailable),
        callVendorMarkerCount:   _int(c.callVendorMarkerCount),
      };
    }

    const m = native.media;
    if (m) {
      media = {
        mediaSessionAccess:       _str(m.mediaSessionAccess, 'UNAVAILABLE'),
        activeSessionCount:       _int(m.activeSessionCount),
        ownerLocalCount:          _int(m.ownerLocalCount),
        ownerSystemCount:         _int(m.ownerSystemCount),
        ownerVendorCount:         _int(m.ownerVendorCount),
        ownerOtherCount:          _int(m.ownerOtherCount),
        playbackStatePresent:     _tri(m.playbackStatePresent),
        metadataPresent:          _tri(m.metadataPresent),
        artworkPresent:           _tri(m.artworkPresent),
        transportControlsPresent: _tri(m.transportControlsPresent),
      };
    }
  }

  const errors: string[] = [];
  if (fieldPresent && native && Array.isArray(native.errors)) {
    for (const e of native.errors) {
      if (typeof e === 'string' && e.length > 0 && errors.length < 16) errors.push(e);
    }
  }

  return {
    readAt,
    fieldPresent,
    /* hw okunamadıysa bile model çökmez: P0.5 kaynağı zaten fail-soft bir kayıt
       döndürür; null gelirse "kanıt yok" iskeleti kurulur. */
    hw: hw ?? {
      readAt, present: false, schemaVersion: null, capturedAt: null,
      platformApiLevel: null, bluetooth: null, profiles: null,
      vendor: null, audio: null, obd: null, errors: [],
    },
    identity,
    call,
    media,
    errors,
  };
}
