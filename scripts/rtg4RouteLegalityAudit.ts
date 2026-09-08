/**
 * rtg4RouteLegalityAudit.ts — BAĞIMSIZ ROTA YASALLIK DENETİMİ (salt-okunur).
 *
 * ── BU DOSYA ROTA OTORİTESİ DEĞİLDİR ─────────────────────────────────────
 * Rota gerçeği kanonik `routeRtg3EdgeState`tedir. Bu denetleyici o karara
 * HİÇ GÜVENMEZ: yalnız üretilmiş kararlı kimlik dizisini (OSM düğüm + yol
 * kimlikleri) alır, bölge artefaktlarını KENDİSİ okur ve her adımın
 * sürülebilirliğini bağımsız olarak yeniden kontrol eder.
 *
 * Ürün koduna girmez, ürün kararına beslenmez, hiçbir şeyi düzeltmez —
 * yalnız SAYAR. Doğrulanamayan şey "0 ihlal" diye YAZILMAZ; ayrı bir
 * `unverified*` sayacına düşer.
 */
import { readFileSync } from 'node:fs';
import {
  parseRoutingGraph, edgeAccessRole, edgeIsOneway, turnIsAllowed, viaWayStep,
  type RoutingGraphView,
} from '../src/platform/navigation/map/graph/rtg2Reader';

export interface RouteLegalityReport {
  /** Rota üzerindeki ardışık düğüm çifti sayısı. */
  readonly steps: number;
  /** En az bir bölge artefaktında GERÇEK kenar olarak bulunabilen adım. */
  readonly resolvedSteps: number;
  /** Hiçbir bölgede kenar karşılığı olmayan adım — dikiş/uydurma göstergesi. */
  readonly brokenTransitions: number;
  /** Tek yönlü kenarın YASAK yönünde geçiş. */
  readonly wrongWay: number;
  /** Bilinmeyen/izinsiz erişim rolü taşıyan kenar. */
  readonly accessViolations: number;
  /** Destination-only kenarın SON giriş dışında transit kestirme olarak kullanımı. */
  readonly destinationOnlyTransit: number;
  /** Via-node dönüş yasağı ihlali. */
  readonly viaNodeViolations: number;
  /** Via-way zincir yasağı ihlali. */
  readonly viaWayViolations: number;
  /** İki kenarı aynı bölgede birlikte bulunamadığı için denetlenemeyen dönüş. */
  readonly unverifiedTurns: number;
  readonly regionsScanned: number;
  readonly totalViolations: number;
}

interface RegionSource { readonly regionId: string; readonly path: string; }

function _loadView(path: string): RoutingGraphView | null {
  const bytes = readFileSync(path);
  const parsed = parseRoutingGraph(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return parsed.outcome === 'OK' ? parsed.view : null;
}

/**
 * Kenar taraması O(kenar) olduğu için adım başına tarama yapmak ülke ölçeğinde
 * kabul edilemez; bu yüzden `wayId → kenar sıra numaraları` indeksi bir kez kurulur.
 */
function _buildWayIndex(view: RoutingGraphView): Map<bigint, number[]> {
  const index = new Map<bigint, number[]>();
  for (let i = 0; i < view.edgeCount; i++) {
    const bucket = index.get(view.edgeSourceWayId[i]);
    if (bucket) bucket.push(i); else index.set(view.edgeSourceWayId[i], [i]);
  }
  return index;
}

function _resolveStepIndexed(
  view: RoutingGraphView, nodeIndex: Map<bigint, number>, wayIndex: Map<bigint, number[]>,
  fromId: bigint, toId: bigint, wayId: bigint,
): { ordinal: number; wrongWay: boolean } | null {
  const from = nodeIndex.get(fromId), to = nodeIndex.get(toId);
  if (from === undefined || to === undefined) return null;
  let wrongWayCandidate = false;
  for (const i of wayIndex.get(wayId) ?? []) {
    if (view.edgeFrom[i] === from && view.edgeTo[i] === to) return { ordinal: i, wrongWay: false };
    if (view.edgeFrom[i] === to && view.edgeTo[i] === from) {
      if (!edgeIsOneway(view, i)) return { ordinal: i, wrongWay: false };
      wrongWayCandidate = true;
    }
  }
  return wrongWayCandidate ? { ordinal: -1, wrongWay: true } : null;
}

export function auditRouteLegality(
  regions: readonly RegionSource[],
  nodeIds: readonly string[],
  wayIds: readonly string[],
): RouteLegalityReport {
  const steps = Math.max(0, nodeIds.length - 1);
  const ids = nodeIds.map((id) => BigInt(id));
  const ways = wayIds.map((id) => BigInt(id));

  const resolved = new Uint8Array(steps);
  const turnVerified = new Uint8Array(Math.max(0, steps - 1));
  let wrongWay = 0, accessViolations = 0, destinationOnlyTransit = 0;
  let viaNodeViolations = 0, viaWayViolations = 0, regionsScanned = 0;
  const wrongWaySteps = new Set<number>();

  for (const region of regions) {
    const view = _loadView(region.path);
    if (!view) continue;
    regionsScanned++;
    const nodeIndex = new Map<bigint, number>();
    for (let i = 0; i < view.nodeCount; i++) nodeIndex.set(view.nodeSourceId[i], i);
    const wayIndex = _buildWayIndex(view);

    /* Bu bölgede çözülebilen adımların kenar sıra numaraları. */
    const ordinalHere = new Int32Array(steps).fill(-1);
    for (let step = 0; step < steps; step++) {
      const hit = _resolveStepIndexed(view, nodeIndex, wayIndex, ids[step], ids[step + 1], ways[step + 1]);
      if (!hit) continue;
      if (hit.wrongWay) {
        /* Yasak yönde kenar: BAŞKA bir bölgede meşru karşılığı bulunabilir mi
           diye işaretlenir; tur sonunda hâlâ çözülmemişse ihlal sayılır. */
        wrongWaySteps.add(step);
        continue;
      }
      ordinalHere[step] = hit.ordinal;
      if (resolved[step] === 0) {
        resolved[step] = 1;
        wrongWaySteps.delete(step);
        const role = edgeAccessRole(view, hit.ordinal);
        if (role !== 1 && role !== 2) accessViolations++;
        /* Destination-only yalnız SON kenar olabilir (hedefe son giriş). */
        if (role === 2 && step !== steps - 1) destinationOnlyTransit++;
      }
    }

    /* Dönüş kısıtları: yalnız ardışık İKİ kenarın da BU bölgede bulunduğu
       yerlerde denetlenebilir. Via-way maskesi kesintisiz koşu boyunca taşınır;
       koşu başında 0'dan başlar (bölge-yerel zincirler için doğru başlangıç). */
    let mask = 0;
    for (let step = 1; step < steps; step++) {
      const previous = ordinalHere[step - 1], current = ordinalHere[step];
      if (previous < 0 || current < 0) { mask = 0; continue; }
      const viaNode = nodeIndex.get(ids[step]);
      if (viaNode === undefined) { mask = 0; continue; }
      if (turnVerified[step - 1] === 0) {
        turnVerified[step - 1] = 1;
        if (!turnIsAllowed(view, previous, current, viaNode)) viaNodeViolations++;
        const next = viaWayStep(view, previous, mask, viaNode, current);
        if (next < 0) viaWayViolations++;
        mask = next < 0 ? 0 : next;
      } else {
        const next = viaWayStep(view, previous, mask, viaNode, current);
        mask = next < 0 ? 0 : next;
      }
    }
  }

  wrongWay = wrongWaySteps.size;
  let resolvedSteps = 0;
  for (let i = 0; i < steps; i++) if (resolved[i]) resolvedSteps++;
  let unverifiedTurns = 0;
  for (let i = 0; i < turnVerified.length; i++) if (!turnVerified[i]) unverifiedTurns++;
  const brokenTransitions = steps - resolvedSteps - wrongWay;

  return {
    steps, resolvedSteps, brokenTransitions: Math.max(0, brokenTransitions),
    wrongWay, accessViolations, destinationOnlyTransit,
    viaNodeViolations, viaWayViolations, unverifiedTurns, regionsScanned,
    totalViolations: wrongWay + accessViolations + destinationOnlyTransit
      + viaNodeViolations + viaWayViolations + Math.max(0, brokenTransitions),
  };
}
