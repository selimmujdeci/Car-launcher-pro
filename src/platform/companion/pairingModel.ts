/**
 * pairingModel.ts — YEREL eşleştirme modeli (P1-PREP · SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok (zaman DAİMA parametre).
 *
 * ── "PAIRING" BURADA NE DEMEK ───────────────────────────────────────────────
 * Bu model BLUETOOTH EŞLEŞTİRMESİ DEĞİLDİR. `createBond` ÇAĞRILMAZ, keşif
 * BAŞLATILMAZ, hiçbir sistem eşleştirmesi tetiklenmez. Burada tutulan şey
 * CAROS'un KENDİ uygulama seviyesindeki güven kaydıdır: "bu karşı tarafı daha
 * önce gördüm ve kullanıcı onayladı".
 *
 * Sistem eşleştirmesi (varsa) kullanıcı tarafından aracın kendi Bluetooth
 * ekranından yapılır — P0.8 saha aracında bu kural birebir aynıdır.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Kayıtta cihaz ADI · MAC · telefon numarası · kişi · pairing key TAŞIYAN ALAN
 * YOKTUR. Kimlik yalnız `peerKeyHash` (geri çevrilemez) ile taşınır; kullanıcıya
 * gösterilecek etiket bile SINIF (rol) düzeyindedir.
 */

import {
  clampText, fnv1aHex, MAX_KNOWN_DEVICES, normalizePeerRole, normalizeTransportType,
  type CompanionPeerRole, type CompanionTransportType,
} from './companionDomain';

/* ══════════════════════════════════════════════════════════════════════════
 * Model
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Güven durumu.
 *  UNKNOWN  : hiç görülmedi.
 *  SEEN     : görüldü ama kullanıcı ONAYLAMADI → bağlanma İZNİ YOK.
 *  TRUSTED  : kullanıcı açıkça onayladı.
 *  REVOKED  : kullanıcı geri aldı → yeniden onay ŞART.
 */
export type PairingTrust = 'UNKNOWN' | 'SEEN' | 'TRUSTED' | 'REVOKED';

export const PAIRING_TRUST_LABEL: Readonly<Record<PairingTrust, string>> = {
  UNKNOWN: 'BİLİNMİYOR',
  SEEN:    'GÖRÜLDÜ (onaysız)',
  TRUSTED: 'GÜVENİLİR',
  REVOKED: 'GERİ ALINDI',
} as const;

export interface KnownDeviceRecord {
  /** Geri çevrilemez kimlik — ham cihaz kimliği ASLA saklanmaz. */
  readonly peerKeyHash: string;
  readonly trust: PairingTrust;
  readonly role: CompanionPeerRole;
  /** En son GÖRÜLDÜĞÜ taşıma; kanıt yoksa UNKNOWN. */
  readonly lastTransportType: CompanionTransportType;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  /** Kullanıcının onay verdiği an; onay yoksa null (0 DEĞİL). */
  readonly trustedAt: number | null;
  readonly connectCount: number;
}

/**
 * Ham karşı-taraf kimliğinden (adres, seri, UUID — ne olursa) YEREL anahtar üretir.
 * Ham değer BU FONKSİYONDAN DIŞARI ÇIKMAZ ve hiçbir yere yazılmaz.
 */
export function derivePeerKeyHash(rawIdentity: unknown): string | null {
  if (typeof rawIdentity !== 'string' || rawIdentity.length === 0) return null;
  return fnv1aHex(`companion:${rawIdentity}`);
}

export function createKnownDevice(
  peerKeyHash: string, nowMs: number, role: CompanionPeerRole = 'UNKNOWN',
  transportType: CompanionTransportType = 'UNKNOWN',
): KnownDeviceRecord {
  return {
    peerKeyHash: clampText(peerKeyHash, 16),
    trust: 'SEEN',
    role: normalizePeerRole(role),
    lastTransportType: normalizeTransportType(transportType),
    firstSeenAt: nowMs,
    lastSeenAt: nowMs,
    trustedAt: null,
    connectCount: 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Saf dönüşümler
 * ════════════════════════════════════════════════════════════════════════ */

export function withSeen(
  rec: KnownDeviceRecord, nowMs: number, transportType?: CompanionTransportType,
): KnownDeviceRecord {
  return {
    ...rec,
    /* Saat geriye giderse `lastSeenAt` GERİLETİLMEZ. */
    lastSeenAt: Math.max(rec.lastSeenAt, nowMs),
    lastTransportType: transportType === undefined
      ? rec.lastTransportType : normalizeTransportType(transportType),
  };
}

/** Kullanıcı onayı — TEK yükseltme yolu. Kod kendi kendine TRUSTED yazamaz. */
export function withUserTrust(rec: KnownDeviceRecord, nowMs: number): KnownDeviceRecord {
  return { ...rec, trust: 'TRUSTED', trustedAt: nowMs };
}

/** Onayı geri al — `trustedAt` SIFIRLANIR (eski onay kanıtı taşınmaz). */
export function withRevokedTrust(rec: KnownDeviceRecord): KnownDeviceRecord {
  return { ...rec, trust: 'REVOKED', trustedAt: null };
}

export function withConnectCount(rec: KnownDeviceRecord): KnownDeviceRecord {
  return { ...rec, connectCount: rec.connectCount + 1 };
}

/**
 * Bağlanmaya İZİN var mı — FAIL-CLOSED.
 * YALNIZ `TRUSTED`. Kayıt yoksa, SEEN ise veya REVOKED ise izin YOKTUR.
 */
export function isPairingAllowed(rec: KnownDeviceRecord | null): boolean {
  return rec !== null && rec.trust === 'TRUSTED';
}

export function pairingDenialReason(rec: KnownDeviceRecord | null): 'PAIRING_RECORD_MISSING' | 'PAIRING_NOT_TRUSTED' | null {
  if (rec === null) return 'PAIRING_RECORD_MISSING';
  return rec.trust === 'TRUSTED' ? null : 'PAIRING_NOT_TRUSTED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Defter (bounded, saf işlemler)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kayıt ekler/günceller. Tavan aşılırsa EN ESKİ GÖRÜLEN ve GÜVENİLİR OLMAYAN
 * kayıt düşürülür — güvenilir kayıt asla sessizce atılmaz.
 */
export function upsertKnownDevice(
  list: readonly KnownDeviceRecord[],
  rec: KnownDeviceRecord,
): readonly KnownDeviceRecord[] {
  const others = list.filter((r) => r.peerKeyHash !== rec.peerKeyHash);
  const next = [...others, rec];
  if (next.length <= MAX_KNOWN_DEVICES) return Object.freeze(next);

  const trusted = next.filter((r) => r.trust === 'TRUSTED');
  const untrusted = next.filter((r) => r.trust !== 'TRUSTED')
    .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
  while (trusted.length + untrusted.length > MAX_KNOWN_DEVICES && untrusted.length > 0) {
    untrusted.shift();
  }
  const merged = [...trusted, ...untrusted];
  /* Hepsi güvenilirse yine tavan uygulanır — en eski görülen düşer. */
  merged.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
  return Object.freeze(merged.slice(Math.max(0, merged.length - MAX_KNOWN_DEVICES)));
}

export function findKnownDevice(
  list: readonly KnownDeviceRecord[], peerKeyHash: string | null,
): KnownDeviceRecord | null {
  if (typeof peerKeyHash !== 'string' || peerKeyHash.length === 0) return null;
  for (const r of list) if (r.peerKeyHash === peerKeyHash) return r;
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Göç (fail-soft)
 * ════════════════════════════════════════════════════════════════════════ */

function _num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

function _trust(v: unknown): PairingTrust {
  return v === 'SEEN' || v === 'TRUSTED' || v === 'REVOKED' ? v : 'UNKNOWN';
}

/** Tek kaydı göç ettirir; anahtarı olmayan gövde → null. ASLA throw etmez. */
export function migrateKnownDevice(v: unknown): KnownDeviceRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.peerKeyHash !== 'string' || o.peerKeyHash.length === 0) return null;
  const trust = _trust(o.trust);
  return {
    peerKeyHash: clampText(o.peerKeyHash, 16),
    trust,
    role: normalizePeerRole(o.role),
    lastTransportType: normalizeTransportType(o.lastTransportType),
    firstSeenAt: _num(o.firstSeenAt, 0),
    lastSeenAt: _num(o.lastSeenAt, 0),
    /* Güven TRUSTED değilse onay damgası TAŞINMAZ (çelişkili kayıt üretmeyiz). */
    trustedAt: trust === 'TRUSTED'
      ? (_num(o.trustedAt, 0) > 0 ? _num(o.trustedAt, 0) : null)
      : null,
    connectCount: Math.max(0, _num(o.connectCount, 0)),
  };
}

export function migrateKnownDevices(v: unknown): readonly KnownDeviceRecord[] {
  const out: KnownDeviceRecord[] = [];
  if (!Array.isArray(v)) return Object.freeze(out);
  for (const item of v) {
    const rec = migrateKnownDevice(item);
    if (rec !== null && out.length < MAX_KNOWN_DEVICES) out.push(rec);
  }
  return Object.freeze(out);
}
