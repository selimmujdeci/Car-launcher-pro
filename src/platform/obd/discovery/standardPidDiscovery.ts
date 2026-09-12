/**
 * standardPidDiscovery — P0 Deep PID/DID Explorer Faz-1 · Mode 01 KEŞİF ORKESTRASYONU (§A).
 *
 * YENİDEN YAZMAZ — ORKESTRE EDER: gerçek bitmap zinciri (00→20→40→60→80→A0→C0→E0,
 * devam-biti mantığı) ZATEN `extendedPidService.ts`'te var (Mali-400 sıfır-maliyet
 * sözleşmesiyle). Bu modül yalnız keşfi TETİKLER ve YAKINSAMAYI bekler — rastgele
 * brute-force veya paralel bir bitmap okuyucu İCAT ETMEZ.
 *
 * TETİKLEME TRIKI: `watchPid('0C', …)` gibi bir ÇEKİRDEK PID (core:true) izlemek,
 * extendedPidService'in `_ensureListener()`+`_ensureDiscovery()` yolunu açar AMA
 * `_buildNativeList()` core PID'leri native listeye HİÇ EKLEMEZ (bkz. extendedPidService.ts
 * `if (STANDARD_PID_MAP.get(pid)!.core) continue;`) → keşif SIFIR EK native trafikle başlar.
 *
 * YAKINSAMA: `getSupportedPids()` boyutu bir süre (settleMs) DEĞİŞMEDEN kalınca zincirin
 * bittiği varsayılır (bounded toplam timeout — sonsuz beklemez). Bu, extendedPidService'in
 * "keşif tamamlandı" olayı DIŞARI VERMEMESİNİN (Faz-1 kapsamında değiştirilemeyen dosya)
 * bilinen bir sınırlamasıdır — Faz-2'de event-tabanlı tamamlanma sinyali önerilir (rapor).
 */

import { watchPid, getSupportedPids, getPidValue, type ExtendedPidValue } from '../extendedPidService';
import { STANDARD_PID_MAP } from '../StandardPidRegistry';
import type { DiscoveryStatus } from './discoveryState';

export interface StandardPidDiscoveryResult {
  pid: string;
  name: string;
  /** Zaten canlı bir örnek varsa VERIFIED (gerçek değer görüldü); yoksa DECODER_KNOWN. */
  status: DiscoveryStatus;
}

export interface StandardPidDiscoveryDeps {
  watchPid: (pid: string, cb: (v: ExtendedPidValue) => void) => () => void;
  getSupportedPids: () => Set<string> | null;
  getPidValue: (pid: string) => ExtendedPidValue | undefined;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const DEFAULT_DEPS: StandardPidDiscoveryDeps = {
  watchPid, getSupportedPids, getPidValue, sleep: defaultSleep, now: Date.now,
};

/** Çekirdek (core:true) tetikleyici PID — native trafiği ARTIRMAZ (bkz. dosya üstü not). */
const TRIGGER_PID = '0C';
const POLL_INTERVAL_MS = 200;
/** Boyut bu kadar süre değişmeden kalırsa zincir "yakınsadı" sayılır. */
const SETTLE_MS = 1_200;

export interface RunStandardPidDiscoveryOptions {
  signal?: AbortSignal;
  /** Azami toplam bekleme (ms) — bounded, sonsuz döngü YOK. Varsayılan 8000. */
  timeoutMs?: number;
  deps?: Partial<StandardPidDiscoveryDeps>;
}

/**
 * Mode 01 bitmap keşfini tetikler, yakınsamayı bekler, sonucu StandardPidRegistry ile
 * çapraz eşleyip döner. Registry'de tanımı OLMAYAN "desteklenen" PID'ler SESSİZCE atlanır
 * (rastgele PID uydurma YOK — yalnız formülü bilinen PID'ler raporlanır).
 */
export async function runStandardPidDiscovery(
  opts: RunStandardPidDiscoveryOptions = {},
): Promise<StandardPidDiscoveryResult[]> {
  const deps: StandardPidDiscoveryDeps = { ...DEFAULT_DEPS, ...opts.deps };
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const deadline = deps.now() + timeoutMs;

  let unsub: (() => void) | null = null;
  try {
    unsub = deps.watchPid(TRIGGER_PID, () => { /* yalnız tetikleyici — değer kullanılmaz */ });

    let lastSize = -1;
    let stableSince = deps.now();
    while (deps.now() < deadline) {
      if (opts.signal?.aborted) break;
      const supported = deps.getSupportedPids();
      const size = supported ? supported.size : -1;
      if (size !== lastSize) {
        lastSize = size;
        stableSince = deps.now();
      } else if (size >= 0 && deps.now() - stableSince >= SETTLE_MS) {
        break; // yakınsadı
      }
      await deps.sleep(POLL_INTERVAL_MS);
    }
  } finally {
    if (unsub) unsub();
  }

  const supported = deps.getSupportedPids();
  if (!supported) return [];

  const out: StandardPidDiscoveryResult[] = [];
  for (const pid of supported) {
    const def = STANDARD_PID_MAP.get(pid);
    if (!def) continue; // registry'de yok → rapor edilmez (uydurma yasak)
    const cached = deps.getPidValue(pid);
    out.push({ pid, name: def.name, status: cached ? 'VERIFIED' : 'DECODER_KNOWN' });
  }
  return out;
}
