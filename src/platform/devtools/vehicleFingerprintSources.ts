/**
 * vehicleFingerprintSources.ts — Araç Parmak İzi ekranının TEK okuma noktası (Faz A5).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ okuma. Araca HİÇBİR komut gönderilmez.
 *  · Hiçbir servis/tarama BAŞLATILMAZ, hiçbir abonelik veya timer açılmaz.
 *  · Her okuma try/catch içinde; kaynak patlarsa `null` → alan KAYNAK YOK.
 *  · Yeni store/singleton/keşif motoru KURULMAZ.
 *
 * ⚠️ `discovery/discoveryFingerprint.getVehicleFingerprint()` BİLEREK KULLANILMAZ:
 *    o fonksiyon araca GERÇEK bir UDS isteği gönderir (`readObdDid` → DID F190) ve
 *    async'tir. Salt-okunur bir gözlem ekranından araç trafiği üretmek yasaktır.
 *    Bunun yerine ZATEN KAYITLI parmak izleri (`vehicleFingerprintStore`) okunur ve
 *    keşif deposu anahtarı, saklanan VIN'den SAF `hashVin()` ile TÜRETİLİR — bu
 *    hesaplama tamamen yereldir, araca dokunmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 *  Ham VIN ve adaptör MAC'i bu katmandan DIŞARI ÇIKMAZ. `vehicleFingerprintStore`
 *  kayıtları VIN'i düz metin tutar; buradan yalnız `hash` ve VIN'in FNV-1a özeti
 *  (`vinHash`) taşınır. Model ve UI ham VIN'i hiç GÖRMEZ.
 */

import { vehicleFingerprintStore } from '../vehicleFingerprintService';
import { hashVin, loadRecords } from '../obd/discovery/discoveredDataRepository';
import { getSupportedPids } from '../obd/extendedPidService';
import { getAutoDiscoveredDids } from '../obd/autoDidDiscovery';
import type { VfRawSnapshot } from './vehicleFingerprintModel';

/** UI'ya taşınacak azami eleman (Mali-400 render + payload bütçesi). */
export const VF_MAX_PIDS = 24;
export const VF_MAX_DIDS = 24;
export const VF_MAX_ECUS = 12;

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/**
 * Tüm kaynakların TEK seferlik senkron okuması.
 *
 * `null` ile boş koleksiyon AYRI anlamlardır ve burada korunur:
 *   · `supportedPids: null`  → keşif HİÇ yapılmadı (kaynak yok)
 *   · `supportedPids: []`    → keşif yapıldı, sonuç boş
 *   · `records: null`        → kayıtlı araç yok → depo anahtarı bile üretilemez
 *   · `records: []`          → anahtar var, kayıt yok
 */
export function readVehicleFingerprintSnapshot(): VfRawSnapshot {
  const readAt = Date.now();

  /* ── 1. Kayıtlı araç parmak izleri (kalıcı LRU) ───────────────────────── */
  const list = _safe(() => vehicleFingerprintStore.list());
  const active = list && list.length > 0 ? list[0] : null;   // en yeni görülen başta

  /* ── 2. Keşif deposu — anahtar SAKLANAN VIN'den türetilir (araca sorgu YOK) */
  let vinHash: string | null = null;
  if (active && typeof active.vin === 'string' && active.vin.length > 0) {
    vinHash = _safe(() => hashVin(active.vin));
  }
  // vinHash yoksa depo anahtarı üretilemez → `null` (boş dizi DEĞİL).
  const records = vinHash ? _safe(() => loadRecords(vinHash)) : null;

  /* ── 3. Desteklenen PID'ler — null/boş ayrımı KAYNAKTAN gelir ─────────── */
  const pidSet = _safe(() => getSupportedPids());

  /* ── 4. Otomatik keşfedilmiş DID'ler ──────────────────────────────────── */
  const dids = _safe(() => getAutoDiscoveredDids());

  return {
    readAt,

    identity: active ? {
      hash:               String(active.hash ?? ''),
      // Ham VIN ASLA taşınmaz — yalnız yerel özeti.
      vinHash,
      vinPresent:         typeof active.vin === 'string' && active.vin.length > 0,
      protocol:           active.protocol ? String(active.protocol) : null,
      supportedPidBitmap: active.supportedPidBitmap ? String(active.supportedPidBitmap) : null,
      firstSeen:          Number(active.firstSeen) > 0 ? Number(active.firstSeen) : null,
      lastSeen:           Number(active.lastSeen)  > 0 ? Number(active.lastSeen)  : null,
    } : null,

    storedVehicleCount: list ? list.length : null,

    ecuAddresses: active && Array.isArray(active.ecuAddresses)
      ? active.ecuAddresses.slice(0, VF_MAX_ECUS).map(String)
      : null,
    ecuAddressTotal: active && Array.isArray(active.ecuAddresses) ? active.ecuAddresses.length : null,

    supportedPids:      pidSet ? [...pidSet].sort().slice(0, VF_MAX_PIDS) : null,
    supportedPidTotal:  pidSet ? pidSet.size : null,

    autoDids: dids
      ? dids.slice(0, VF_MAX_DIDS).map((d) => ({ did: String(d.did), ecuRx: String(d.ecuRx) }))
      : null,
    autoDidTotal: dids ? dids.length : null,

    recordTotal: records ? records.length : null,
    recordPidCount: records ? records.filter((r) => r.kind === 'pid').length : null,
    recordDidCount: records ? records.filter((r) => r.kind === 'did').length : null,
    /** Depodaki EN YENİ `lastSeenAt` — gerçek damga yoksa null (asla "şimdi" değil). */
    recordLastSeenAt: records && records.length > 0
      ? records.reduce((mx, r) => (Number(r.lastSeenAt) > mx ? Number(r.lastSeenAt) : mx), 0) || null
      : null,
  };
}
