/**
 * obdSimulator.ts — T1: araçsız OBD veri simülatörü (TEST-ONLY).
 *
 * Amaç: araç olmadan RPM / hız / motor sıcaklığı / yakıt / bağlantı-kopması /
 * NO DATA / timeout senaryolarını deterministik üretmek ve obdService + store'un
 * tepkisini doğrulamak.
 *
 * Tasarım kuralları (CLAUDE.md):
 *   - Yalnız src/__tests__ altında → production bundle'a GİRMEZ (tree-shake).
 *   - obdService'e DOKUNMAZ; mevcut public `updateOBDData(Partial<NativeOBDData>)`
 *     üzerinden besler → gerçek sanitize + merge + notify yolundan geçer.
 *   - Native hot-path / gerçek OBD bağlantı davranışı DEĞİŞMEZ.
 */
import type { NativeOBDData } from '../../platform/nativePlugin';

/** Senaryo başından itibaren zaman damgalı tek veri kareği. */
export interface OBDFrame {
  atMs: number;
  data: Partial<NativeOBDData>;
}

export interface OBDScenario {
  name: string;
  description: string;
  frames: OBDFrame[];
  /** Senaryo bittikten sonra veri akışı durur mu (NO DATA / kopma sınıfı). */
  endsSilent: boolean;
}

/** Kareler arası varsayılan aralık (ms) — yalnız zaman damgası içindir. */
const TICK = 100;

/** Bir OBD alanını from→to lineer rampala (steps+1 kare üretir). */
export function ramp(
  field: keyof NativeOBDData,
  from: number,
  to: number,
  steps: number,
  startMs = 0,
): OBDFrame[] {
  const frames: OBDFrame[] = [];
  for (let i = 0; i <= steps; i++) {
    const v = from + ((to - from) * i) / steps;
    frames.push({
      atMs: startMs + i * TICK,
      data: { [field]: Math.round(v) } as Partial<NativeOBDData>,
    });
  }
  return frames;
}

/** Tek sabit veri kareği. */
export function snapshot(data: Partial<NativeOBDData>, atMs = 0): OBDFrame {
  return { atMs, data };
}

/** Önceden tanımlı senaryolar. */
export const SCENARIOS = {
  CRUISE: {
    name: 'CRUISE',
    description: 'Sabit otoyol seyri (hız/rpm/temp/yakıt sabit)',
    endsSilent: false,
    frames: [snapshot({ speed: 110, rpm: 2200, engineTemp: 92, fuelLevel: 60 })],
  },
  RPM_RAMP: {
    name: 'RPM_RAMP',
    description: 'Rölantiden yüksek devire RPM rampası (800→4000)',
    endsSilent: false,
    frames: ramp('rpm', 800, 4000, 8),
  },
  SPEED_RAMP: {
    name: 'SPEED_RAMP',
    description: '0→120 km/h hızlanma',
    endsSilent: false,
    frames: ramp('speed', 0, 120, 12),
  },
  OVERHEAT: {
    name: 'OVERHEAT',
    description: 'Motor sıcaklığı 90→120°C tırmanışı',
    endsSilent: false,
    frames: ramp('engineTemp', 90, 120, 6),
  },
  FUEL_DRAIN: {
    name: 'FUEL_DRAIN',
    description: 'Yakıt seviyesi 80→15% düşüşü',
    endsSilent: false,
    frames: ramp('fuelLevel', 80, 15, 13),
  },
  DISCONNECT: {
    name: 'DISCONNECT',
    description: 'Veri akışı, ardından bağlantı kopması (kopma test tarafında stopOBD ile)',
    endsSilent: true,
    frames: [snapshot({ speed: 60, rpm: 2000, engineTemp: 88, fuelLevel: 55 })],
  },
  NO_DATA: {
    name: 'NO_DATA',
    description: 'Bağlı ama hiçbir veri kareği gelmiyor (NO DATA / timeout)',
    endsSilent: true,
    frames: [],
  },
} as const satisfies Record<string, OBDScenario>;

export type ScenarioKey = keyof typeof SCENARIOS;

/**
 * Senaryo karelerini sırayla `emit`'e geçirir (senkron).
 * obdService.updateOBDData test ortamında debounce'suz işlediği için senkron yeterli.
 */
export function playScenario(
  scenario: OBDScenario,
  emit: (data: Partial<NativeOBDData>) => void,
): void {
  for (const f of scenario.frames) emit(f.data);
}
