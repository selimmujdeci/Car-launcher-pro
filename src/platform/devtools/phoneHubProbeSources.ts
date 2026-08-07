/**
 * phoneHubProbeSources.ts — Phone Hub Probe'un TEK okuma noktası (P0.5).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ getter. `await` YOK.
 *  · Native probe ÖNBELLEKTEN okunur (pull ekranın tek atışlık YENİLE'siyle yapılır).
 *  · Bluetooth keşfi/taraması · eşleştirme · bağlantı · SCO · route değişimi ·
 *    medya komutu · çağrı · izin isteği · vendor bind — HİÇBİRİ YOK.
 *  · OBD tarafında YALNIZ mevcut getter'lar okunur; yeni davranış EKLENMEZ.
 *  · Her kaynak AYRI try/catch → biri patlarsa diğerleri okunur.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Native sözleşmesi zaten PII taşımaz. Bu katman ek olarak hiçbir cihaz adı/adres
 * alanına DOKUNMAZ ve dışarı yalnız sayım + sabit enum verir.
 */

import { getPhoneHubProbe } from '../phoneHub/phoneHubHardwareProbe';
import { getTransportStats, getObdSessionHealth, getObdConnLifecycle } from '../obdService';
import { getObdHealth } from '../obd/ObdHealthMonitor';
import type {
  PhoneHubProbeRaw, PhNativeBluetooth, PhNativeProfiles, PhNativeVendor,
  PhNativeAudio, PhObdRaw,
} from './phoneHubProbeModel';

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

function _int(v: unknown, fallback = -1): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Duvar-saati damgası; 0/negatif/NaN → null ("şimdi" UYDURULMAZ). */
function _wallTs(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

export function readPhoneHubProbeSnapshot(): PhoneHubProbeRaw {
  const readAt = Date.now();

  const native = _safe(() => getPhoneHubProbe());
  const present = !!(native && native.present === true);

  let bluetooth: PhNativeBluetooth | null = null;
  let profiles:  PhNativeProfiles  | null = null;
  let vendor:    PhNativeVendor    | null = null;
  let audio:     PhNativeAudio     | null = null;

  if (present && native) {
    const b = native.bluetooth;
    if (b) {
      bluetooth = {
        adapterAvailable:      b.adapterAvailable === true,
        adapterEnabled:        b.adapterEnabled === true,
        adapterNamePresent:    b.adapterNamePresent === true,
        permConnect:           _str(b.permConnect),
        permScan:              _str(b.permScan),
        permLegacy:            _str(b.permLegacy),
        discoveryActive:       _str(b.discoveryActive),
        // -1 sentinel AYNEN korunur — "okunamadı" ile "0 cihaz" AYRIDIR.
        bondedDeviceCount:     _int(b.bondedDeviceCount),
        phoneLikeCount:        _int(b.phoneLikeCount),
        audioLikeCount:        _int(b.audioLikeCount),
        obdLikeCandidateCount: _int(b.obdLikeCandidateCount),
        unknownClassCount:     _int(b.unknownClassCount),
        evidence:              _str(b.evidence),
      };
    }
    const p = native.profiles;
    if (p) {
      profiles = {
        a2dpConnectionState:    _str(p.a2dpConnectionState),
        headsetConnectionState: _str(p.headsetConnectionState),
        gattConnectionState:    _str(p.gattConnectionState),
        a2dpControlAuthority:   _str(p.a2dpControlAuthority),
        hfpControlAuthority:    _str(p.hfpControlAuthority),
        evidence:               _str(p.evidence),
      };
    }
    const v = native.vendor;
    if (v) {
      vendor = {
        knownVendorPackageDetected:   v.knownVendorPackageDetected === true,
        knownVendorBroadcastObserved: v.knownVendorBroadcastObserved === true,
        vendorFamily:                 _str(v.vendorFamily),
        lastEvidenceAgeMs:            _int(v.lastEvidenceAgeMs),
        evidence:                     _str(v.evidence),
      };
    }
    const a = native.audio;
    if (a) {
      audio = {
        audioMode:               _int(a.audioMode),
        musicActive:             a.musicActive === true,
        communicationDeviceType: _str(a.communicationDeviceType),
        routeAuthority:          _str(a.routeAuthority),
        evidence:                _str(a.evidence),
      };
    }
  }

  /* OBD: YALNIZ MEVCUT getter'lar. Yeni native kod veya davranış EKLENMEDİ. */
  const trans  = _safe(() => getTransportStats());
  const sess   = _safe(() => getObdSessionHealth());
  const life   = _safe(() => getObdConnLifecycle());
  const health = _safe(() => getObdHealth());

  let obd: PhObdRaw | null = null;
  if (trans || sess || health) {
    obd = {
      transport:          trans && typeof trans.transport === 'string' ? trans.transport : null,
      transportConnected: trans ? trans.connected === true : false,
      pollingActive:      sess ? sess.pollingActive === true : false,
      dataFresh:          sess ? sess.dataFresh === true : false,
      // -1 sentinel korunur (hiç paket yok ≠ 0 ms).
      lastPacketAgeMs:    health && typeof health.lastPacketAgeMs === 'number'
        ? health.lastPacketAgeMs : -1,
      /* "Sıfırlama sürüyor" için ayrı bayrak YOK; mevcut yaşam döngüsü sayaçlarından
         istek > tamamlanan ise süreç AÇIK kabul edilir (mevcut veriden türetme). */
      resetInProgress: !!(life
        && _int(life.resetRequestedCount, 0) > _int(life.resetCompletedCount, 0)),
    };
  }

  const errors: string[] = [];
  if (present && native && Array.isArray(native.errors)) {
    for (const e of native.errors) {
      if (typeof e === 'string' && e.length > 0 && errors.length < 16) errors.push(e);
    }
  }

  return {
    readAt,
    present,
    schemaVersion:    present && native ? _int(native.schemaVersion, -1) >= 0 ? _int(native.schemaVersion) : null : null,
    capturedAt:       present && native ? _wallTs(native.capturedAt) : null,
    platformApiLevel: present && native ? (_int(native.platformApiLevel, -1) > 0 ? _int(native.platformApiLevel) : null) : null,
    bluetooth,
    profiles,
    vendor,
    audio,
    obd,
    errors,
  };
}
