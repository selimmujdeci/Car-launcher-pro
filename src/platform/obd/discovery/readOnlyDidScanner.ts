/**
 * readOnlyDidScanner — P0 Deep PID/DID Explorer Faz-1 · SALT-OKUNUR DID TARAYICI (§B/mimari).
 *
 * `didDiscoveryService.ts`'i SARAR (native'e DOKUNMAZ — yalnız `CarLauncher.readObdDid`
 * çağrılır, aynı native primitive). `didDiscoveryService.startDiscovery` ARALIK taraması
 * için tasarlanmıştır (from..to); bu modül ise ÖNCEDEN BELİRLENMİŞ, allowlist'li ADAY
 * listesini (didCandidateProvider) TEK TEK okur — 0000–FFFF kör tarama YOK, yalnız meşru
 * kaynaklardan gelen adaylar sorgulanır. Aynı DoS-önleme aralığını (`DISCOVERY_INTER_DID_DELAY_MS`)
 * paylaşır (didDiscoveryService'ten AYNEN import edilir — iki farklı bekleme sabiti icat edilmez).
 *
 * GÜVENLİK: her adayın `service` alanı `isReadOnlyServiceAllowed` ile TEKRAR doğrulanır
 * (savunma derinliği — didCandidateProvider zaten yalnız '22'/'21' üretir, ama bu katman
 * BAĞIMSIZ olarak da reddeder). Allowlist dışı bir aday asla native'e gönderilmez.
 */

import { DISCOVERY_INTER_DID_DELAY_MS } from '../didDiscoveryService';
import { classifyNrc, type CapabilityOutcome } from '../capabilityOutcome';
import { isReadOnlyServiceAllowed } from './discoverySafetyPolicy';
import type { DidCandidate } from './didCandidateProvider';

export interface ReadObdDidResult {
  data: string | null;
  supported: boolean;
  kind?: 'OK' | 'NO_DATA' | 'NEG_7F';
  nrc?: number | null;
}

export interface DidScanOutcome {
  candidate: DidCandidate;
  outcome: CapabilityOutcome;
  dataHex: string | null;
  latencyMs: number;
}

export interface DidScannerDeps {
  readObdDid: (opts: { tx: string; rx: string; did: string; service: '22' | '21' }) => Promise<ReadObdDidResult>;
  now?: () => number;
  interDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Ham `readObdDid` yanıtını (PR-CAP-2 kind/nrc kanıtı öncelikli) capabilityOutcome'a çevirir. */
function classifyReadObdDidResult(r: ReadObdDidResult): CapabilityOutcome {
  if (r.kind === 'NO_DATA') return 'no_data';
  if (r.kind === 'NEG_7F') return classifyNrc(r.nrc ?? -1) ?? 'condition_required';
  if (r.kind === 'OK') return r.data ? 'working' : 'parse_error';
  // Eski APK (kind/nrc yok) → geriye dönük: supported/data alanlarına düş (muhafazakâr).
  if (r.supported && r.data) return 'working';
  return 'unsupported';
}

/**
 * Aday listesini SIRAYLA tarar (inter-candidate delay ile). AbortSignal her adaydan önce
 * kontrol edilir. Allowlist dışı bir aday native'e HİÇ gönderilmeden atlanır.
 */
export async function scanDidCandidates(
  candidates: readonly DidCandidate[],
  deps: DidScannerDeps,
  opts: { signal?: AbortSignal } = {},
): Promise<DidScanOutcome[]> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const interDelay = deps.interDelayMs ?? DISCOVERY_INTER_DID_DELAY_MS;
  const out: DidScanOutcome[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (opts.signal?.aborted) break;
    const candidate = candidates[i]!;

    if (!isReadOnlyServiceAllowed(candidate.service)) {
      continue; // savunma derinliği — asla gönderilmez, sessizce atlanır
    }

    const t0 = now();
    try {
      const r = await deps.readObdDid({
        tx: candidate.tx, rx: candidate.rx, did: candidate.did, service: candidate.service,
      });
      out.push({ candidate, outcome: classifyReadObdDidResult(r), dataHex: r.data ?? null, latencyMs: now() - t0 });
    } catch {
      // Bağlantı koptu/native reject — araç hakkında KANIT DEĞİL (zero-trust).
      out.push({ candidate, outcome: 'timeout', dataHex: null, latencyMs: now() - t0 });
    }

    if (i < candidates.length - 1 && !opts.signal?.aborted) {
      await sleep(interDelay);
    }
  }

  return out;
}
