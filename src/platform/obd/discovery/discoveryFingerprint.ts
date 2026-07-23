/**
 * discoveryFingerprint — P0 Deep PID/DID Explorer Faz-1 · araç kimliği (VIN→hash) okuyucu.
 *
 * NEDEN AYRI/KÜÇÜK KOPYA: `autoDidDiscovery.ts` (DOKUNULMAZ, korumalı dosya) VIN'i F190'dan
 * okuyup FNV-1a ile hash'leyen bir `readVin()`/`hashVin()` çiftini ZATEN taşıyor ama HİÇBİRİ
 * dışa aktarılmıyor (private). Bu modül AYNI algoritmayı (discoveredDataRepository.hashVin —
 * birebir aynı FNV-1a) ve AYNI okuma deseni (F190, engine 7E0/7E8, yazdırılabilir ASCII süzme,
 * ≥8 karakter toleransı) ile YENİDEN uygular — autoDidDiscovery.ts DEĞİŞTİRİLMEDEN aynı
 * VIN → aynı hash → aynı anahtar uzayı elde edilir (bkz. discoveredDataRepository.ts başlığı).
 *
 * Oturum başına BİR kez okunur ve önbelleklenir (gereksiz tekrar VIN sorgusu YOK).
 */

import { hashVin } from './discoveredDataRepository';

export interface FingerprintReaderDeps {
  readObdDid: (opts: { tx: string; rx: string; did: string; service: '22' | '21' }) => Promise<{
    data: string | null; supported: boolean;
  }>;
}

let _cachedFingerprint: string | null = null;
let _cacheAttempted = false;

/** Ham F190 hex yanıtını yazdırılabilir ASCII VIN'e çevirir (autoDidDiscovery ile AYNI süzme). */
function parseVinAscii(dataHex: string): string | null {
  const clean = dataHex.replace(/[^0-9A-Fa-f]/g, '');
  let vin = '';
  for (let i = 0; i + 2 <= clean.length; i += 2) {
    const code = parseInt(clean.substring(i, i + 2), 16);
    if (code >= 32 && code < 127) vin += String.fromCharCode(code);
  }
  vin = vin.trim();
  return vin.length >= 8 ? vin : null;
}

/**
 * Oturumluk araç fingerprint'ini (VIN hash) döner; okunamazsa null (kalıcı tarama fingerprint
 * OLMADAN yapılamaz — çağıran fingerprint'e bağlı adımları atlar, tarama tamamen durmaz).
 */
export async function getVehicleFingerprint(deps: FingerprintReaderDeps): Promise<string | null> {
  if (_cacheAttempted) return _cachedFingerprint;
  _cacheAttempted = true;
  try {
    const r = await deps.readObdDid({ tx: '7E0', rx: '7E8', did: 'F190', service: '22' });
    if (!r.supported || !r.data) return null;
    const vin = parseVinAscii(r.data);
    if (!vin) return null;
    _cachedFingerprint = hashVin(vin);
    return _cachedFingerprint;
  } catch {
    return null; // fail-soft — fingerprint'siz devam (repository adımları atlanır)
  }
}

/** @internal — testler arası izolasyon. */
export function _resetFingerprintCacheForTest(): void {
  _cachedFingerprint = null;
  _cacheAttempted = false;
}
