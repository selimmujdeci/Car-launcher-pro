/**
 * fleetDebugBridge.ts — SAHA DOĞRULAMA KANCASI (YALNIZ DEBUG DERLEMESİ).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────
 * Telefon doğrulama senaryolarının üçü (P5 uzlaştırma ara durumları,
 * P12 bayat realtime bildirimi) tarayıcıda **geçici** durumlar üretir:
 * LAB ekranı elle yenilenen tek okuma yaptığı için bu ara durumlar
 * gözlemlenemez. Bu köprü o ara durumları *okunabilir* kılar.
 *
 * ── SINIRLAR (pazarlıksız) ────────────────────────────────────────────
 *   · `FLEET_DEBUG_ENABLED` production derlemesinde `false` sabitine
 *     indirgenir → köprü kurulmaz ve gövdesi ölü koda dönüşür.
 *   · Köprü GÜVENLİK KAPISI GEVŞETMEZ: yalnız (a) snapshot okumasına
 *     gecikme ekler, (b) mevcut otoritenin salt-okunur görünümünü döner,
 *     (c) gerçek kuşak kapısına BİLE BİLE bayat bir olay verir.
 *   · Hiçbir yetki, rol, RLS veya çevrimdışı sınıflandırma atlanmaz.
 *   · Hassas veri taşımaz: hesap kimliği yalnız kuşak sayısıyla temsil edilir.
 */

import {
  peekRealtimeAuthority,
  type AuthoritySnapshotView,
  type RealtimeEvent,
} from '@/lib/realtime/realtimeSyncAuthority';

/**
 * Kanca yalnız non-production derlemede etkindir.
 *
 * Next.js `process.env.NODE_ENV`'i derleme anında sabitler; production
 * derlemesinde bu ifade `false` olur ve aşağıdaki gövdeler minifier
 * tarafından atılır (rapor için `next build` çıktısında `__carosFleetDebug`
 * dizesi aranarak doğrulanır).
 */
export const FLEET_DEBUG_ENABLED: boolean = process.env.NODE_ENV !== 'production';

/** Snapshot okumasına eklenen yapay gecikme (ms). Debug dışında DAİMA 0. */
let _snapshotDelayMs = 0;

export function debugSnapshotDelayMs(): number {
  return FLEET_DEBUG_ENABLED ? _snapshotDelayMs : 0;
}

/** LAB'a taşınabilir, PII içermeyen salt-okunur realtime görünümü. */
export interface DebugRealtimeView {
  state:            AuthoritySnapshotView['state'];
  scopeGeneration:  number | null;
  lastServerRevision: number | null;
  lastEventRevision:  number | null;
  lastGapReason:    string | null;
  resyncAttempt:    number;
  counters:         AuthoritySnapshotView['counters'];
}

function readView(): DebugRealtimeView | null {
  const authority = peekRealtimeAuthority();
  if (!authority) return null;
  const view = authority.view();
  return {
    state:              view.state,
    scopeGeneration:    view.scope?.generation ?? null,
    lastServerRevision: view.lastServerRevision,
    lastEventRevision:  view.lastEventRevision,
    lastGapReason:      view.lastGapReason,
    resyncAttempt:      view.resyncAttempt,
    counters:           view.counters,
  };
}

/**
 * Mevcut kapsamın BİR ÖNCEKİ kuşağından bir olay üretip otoriteye verir.
 *
 * Gerçek kapıyı sınar: kuşak uyuşmazlığı reddi. Sahte sayaç ARTIRMAZ —
 * sayaç yalnız otoritenin kendi kararıyla artar.
 */
function injectStaleEvent(): { injected: boolean; accepted: boolean | null; reason: string | null } {
  const authority = peekRealtimeAuthority();
  if (!authority) return { injected: false, accepted: null, reason: 'NO_AUTHORITY' };
  const scope = authority.view().scope;
  if (!scope) return { injected: false, accepted: null, reason: 'NO_SCOPE' };

  const staleEvent: RealtimeEvent = {
    revision:   1,
    entityId:   '00000000-0000-0000-0000-000000000000',
    entityKind: 'vehicle',
    action:     'UPDATE',
    scope:      { ...scope, generation: scope.generation - 1 },
    receivedAt: Date.now(),
  };
  const outcome = authority.onEvent(staleEvent);
  return { injected: true, accepted: outcome.accepted, reason: outcome.reason };
}

interface FleetDebugSurface {
  setSnapshotDelayMs(ms: number): number;
  realtimeView(): DebugRealtimeView | null;
  injectStaleEvent(): { injected: boolean; accepted: boolean | null; reason: string | null };
}

/** Köprüyü `window.__carosFleetDebug` altına kurar (yalnız debug). */
export function installFleetDebugBridge(): void {
  if (!FLEET_DEBUG_ENABLED) return;
  if (typeof window === 'undefined') return;

  const surface: FleetDebugSurface = {
    setSnapshotDelayMs(ms: number): number {
      const safe = Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 30_000) : 0;
      _snapshotDelayMs = safe;
      return safe;
    },
    realtimeView: readView,
    injectStaleEvent,
  };

  (window as unknown as Record<string, unknown>).__carosFleetDebug = surface;
}
