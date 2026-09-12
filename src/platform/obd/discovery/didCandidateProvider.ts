/**
 * didCandidateProvider — P0 Deep PID/DID Explorer Faz-1 · DID ADAY KAYNAKLARI (§B, SAF).
 *
 * BU TURDA 0000–FFFF KÖR TARAMA YOK. Aday DID'ler yalnız ÜÇ meşru kaynaktan toplanır:
 *   1. Mevcut üretici profilleri (`profiles/index.ts` — MANUFACTURER_DID_PROFILES), protokol
 *      sınıfına göre FİLTRELİ (VehicleDidProfile.protocols — yanlış transporta CAN header'ı
 *      göndermek COMM_ERROR fırtınası üretir, PR-OBD-KWP-1 dersi).
 *   2. Aynı VIN için DAHA ÖNCE otomatik keşfedilmiş (autoDidDiscovery.ts) ham DID'ler —
 *      decoder BİLİNMİYOR (yalnız DISCOVERED_UNKNOWN adayı olabilirler).
 *   3. Bu modülün KENDİ kalıcı deposunda (discoveredDataRepository) önceki oturumlardan
 *      kayıtlı adaylar (repository recall — aynı DID'i tekrar tekrar "keşfetmeye" gerek yok).
 *
 * SAF: girdiler DI ile verilir (native/I/O YOK) — canlı toplama `discoveryCoordinator`'da
 * gerçek kaynaklarla (MANUFACTURER_DID_PROFILES, getAutoDiscoveredDids, loadRecords) sarılır.
 */

import { compileVehicleDidProfile, type VehicleDidProfile, type CompiledDidDef } from '../vehicleDidProfile';
import type { ProtocolClass } from '../protocolProfile';
import type { DiscoveredDataRecord } from './discoveredDataRepository';

export interface DidCandidate {
  did: string;
  service: '22' | '21';
  ecuId: string;
  tx: string;
  rx: string;
  name: string | null;
  hasKnownDecoder: boolean;
  compiledDef: CompiledDidDef | null;
  source: 'profile' | 'auto_did_cache' | 'repository_recall';
}

/** autoDidDiscovery.AutoDidRecord ile UYUMLU minimal şekil (döngüsel import yok — yerel tip). */
export interface AutoDiscoveredDidLike {
  did: string;
  dataHex: string;
  ecuRx: string;
}

export interface CandidateProviderDeps {
  protocolClass: ProtocolClass;
  profiles?: readonly VehicleDidProfile[];
  autoDiscovered?: readonly AutoDiscoveredDidLike[];
  repositoryRecords?: readonly DiscoveredDataRecord[];
  /** Aday tavanı (bounded — DoS gibi davranmasın). Varsayılan 24. */
  maxCandidates?: number;
}

const DEFAULT_MAX_CANDIDATES = 24;

/** Profil + auto-discovered cache + kalıcı depodan birleşik, DEDUPLE, PROTOKOL-FİLTRELİ aday listesi. */
export function gatherDidCandidates(deps: CandidateProviderDeps): DidCandidate[] {
  const out: DidCandidate[] = [];
  const seen = new Set<string>();
  const cap = deps.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  // 1. Üretici profilleri — protokol sınıfı uyuşmuyorsa profil TÜMÜYLE atlanır.
  for (const profile of deps.profiles ?? []) {
    if (out.length >= cap) break;
    if (profile.protocols && !profile.protocols.includes(deps.protocolClass)) continue;
    const compiled = compileVehicleDidProfile(profile);
    for (const def of compiled.values()) {
      if (out.length >= cap) break;
      if (def.service !== '22' && def.service !== '21') continue;
      // NOT: dedup anahtarı `ecuId` üzerinden — repository (discoveredDataRepository) kaydı
      // AYNI kimliği (`candidate.ecuId` → `ecuAddress`) kullanır; `tx` kullanılsaydı profil
      // ve repository-recall adayları AYNI ECU/DID için YANLIŞLIKLA iki ayrı aday sayılırdı.
      const key = `${def.service}:${def.did}:${def.ecuId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        did: def.did, service: def.service, ecuId: def.ecuId, tx: def.tx, rx: def.rx,
        name: def.name, hasKnownDecoder: true, compiledDef: def, source: 'profile',
      });
    }
  }

  // 2. Otomatik keşfedilmiş (decoder bilinmiyor) — servis her zaman 22 (autoDidDiscovery sözleşmesi).
  for (const rec of deps.autoDiscovered ?? []) {
    if (out.length >= cap) break;
    const key = `22:${rec.did}:${rec.ecuRx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      did: rec.did, service: '22', ecuId: rec.ecuRx, tx: rec.ecuRx, rx: rec.ecuRx,
      name: null, hasKnownDecoder: false, compiledDef: null, source: 'auto_did_cache',
    });
  }

  // 3. Kalıcı depo geri-çağrısı — kalıcı REJECTED/UNSUPPORTED tekrar aday YAPILMAZ.
  for (const rec of deps.repositoryRecords ?? []) {
    if (out.length >= cap) break;
    if (rec.kind !== 'did') continue;
    if (rec.validationStatus === 'UNSUPPORTED' || rec.validationStatus === 'REJECTED') continue;
    if (rec.service !== '22' && rec.service !== '21') continue;
    const key = `${rec.service}:${rec.identifier}:${rec.ecuAddress}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      did: rec.identifier, service: rec.service, ecuId: rec.ecuAddress, tx: rec.ecuAddress, rx: rec.ecuAddress,
      name: null, hasKnownDecoder: rec.decoderId != null, compiledDef: null, source: 'repository_recall',
    });
  }

  return out;
}
