/**
 * attachRealtimeSyncRuntime.ts — ÜRETİM BAĞLAMA KATMANI.
 *
 * `useRealtime` bu tek fonksiyonu çağırır; Supabase istemcisi, bekleyen
 * mutation kaynağı ve uzlaştırma tüketicisi burada bağlanır. Böylece hook
 * bu bağımlılıkları TANIMAZ ve boşluk kararı hook'a sızmaz.
 *
 * Yapılandırma eksikse (Supabase yok, SSR) runtime yine kurulur ama snapshot
 * başarısız olur → otorite `DEGRADED` kalır ve UI "güncel" DEMEZ. Sessizce
 * LIVE'a geçmek yerine dürüst şekilde bozuk kalmak tercih edilir.
 */

import { supabaseBrowser } from '@/lib/supabase';
import {
  startRealtimeRuntime,
  SupabaseVehicleSnapshotReader,
  type RealtimeSyncRuntime,
  type VehicleSnapshotReader,
  type SupabaseLikeClient,
} from './realtimeSyncRuntime';
import type { PendingLocalEntity, RealtimeScope, ReconciliationItem } from './realtimeSyncAuthority';
import { activeQueueAccountId, getQueue } from '@/lib/offline/fleetOffline';
import type { QueueItem } from '@/lib/offline/types';
import { classifyOffline } from '@/lib/offline/offlineClassification';
import {
  FLEET_DEBUG_ENABLED,
  debugSnapshotDelayMs,
  installFleetDebugBridge,
} from '@/lib/debug/fleetDebugBridge';

/** Snapshot okunamayan ortam — DEGRADED üretir, sahte başarı YOK. */
class UnavailableSnapshotReader implements VehicleSnapshotReader {
  async readVehicles(): Promise<readonly { id: string; revision: number | null }[]> {
    throw new Error('supabase_not_configured');
  }
}

/**
 * SAHA DOĞRULAMA SARMALAYICISI — yalnız debug derlemesinde.
 *
 * Uzlaştırma ara durumları (`RESYNCING` / `RECONCILING`) gerçek ağda
 * milisaniyeler sürer; P5 senaryosu bu geçişleri gözlemeyi gerektirir.
 * Sarmalayıcı YALNIZ gecikme ekler — okunan veriyi DEĞİŞTİRMEZ.
 * Production derlemesinde `FLEET_DEBUG_ENABLED` sabiti `false` olduğu için
 * sarmalayıcı hiç kurulmaz.
 */
function withDebugLatency(reader: VehicleSnapshotReader): VehicleSnapshotReader {
  if (!FLEET_DEBUG_ENABLED) return reader;
  return {
    async readVehicles() {
      const delay = debugSnapshotDelayMs();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      return reader.readVehicles();
    },
  };
}

/**
 * Bekleyen yerel mutation'ları uzlaştırma girdisine çevirir.
 *
 * `authoritative` bayrağı çevrimdışı sınıflandırmasından türetilir:
 * `ONLINE_REQUIRED` bir işlem güvenlik/sahiplik işlemidir → çakışmada
 * ASLA local-wins olamaz.
 */
function toPendingEntity(item: QueueItem): PendingLocalEntity | null {
  if (!item.vehicleId) return null;
  return {
    entityId:      item.vehicleId,
    entityKind:    'vehicle',
    baseRevision:  item.clientRevision,
    authoritative: classifyOffline(item.operationType) === 'ONLINE_REQUIRED',
  };
}

/** Kuyruk okunamıyorsa BOŞ liste döner — uzlaştırma yine de yapılır. */
function readPendingEntities(): readonly PendingLocalEntity[] {
  try {
    const accountId = activeQueueAccountId();
    if (!accountId) return [];
    // `all()` async; senkron sözleşme için son bilinen anlık görüntü kullanılır.
    // Kuyruk henüz yüklenmediyse boş liste döner (fail-soft, sahte veri YOK).
    const queue = getQueue(accountId);
    const snapshot = queue.peekLoadedItems();
    const out: PendingLocalEntity[] = [];
    for (const item of snapshot) {
      const entity = toPendingEntity(item);
      if (entity) out.push(entity);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Uzlaştırma sonucu tüketicisi.
 *
 * Şu an YALNIZ gözlem içindir: sahiplik değişimi/silinme gibi sonuçlar LAB'da
 * sayaç olarak görünür. Store'a otomatik yazma BİLİNÇLİ olarak yapılmaz —
 * uzlaştırma sonucu "sunucu ne diyor" bilgisidir; ekranın onu nasıl
 * yansıtacağı ilgili ekranın kendi yenileme akışına aittir (çift otorite YOK).
 */
function onReconciled(_items: readonly ReconciliationItem[]): void {
  void _items;
}

/**
 * Runtime'ı kurar ve döndürür.
 *
 * Kapsam: hesap kimliği kuyruktan okunur. Yoksa `anonymous` kapsamı kullanılır
 * — bu durumda snapshot RLS gereği boş döner ve otorite yine dürüst kalır.
 */
export function attachRealtimeSyncRuntime(): RealtimeSyncRuntime {
  const accountId = activeQueueAccountId() ?? 'anonymous';

  const scope: RealtimeScope = {
    accountId,
    companyId: null,
    // Kuşak: her bağlama yeni bir kuşaktır. Hesap değişiminde `useRealtime`
    // efekti yeniden koşar → yeni runtime + yeni kuşak; eski uçuştaki
    // snapshot sonucu ARTIK UYGULANAMAZ.
    generation: nextGeneration(),
    subscriptionId: `rt-${accountId}`,
  };

  const reader: VehicleSnapshotReader = withDebugLatency(
    supabaseBrowser
      ? new SupabaseVehicleSnapshotReader(supabaseBrowser as unknown as SupabaseLikeClient)
      : new UnavailableSnapshotReader(),
  );

  // Köprü otoriteden SONRA değil, ÖNCE kurulur: `startRealtimeRuntime` çağrısı
  // otoriteyi kaydeder, köprü de yalnız kayıtlı otoriteyi OKUR.
  installFleetDebugBridge();

  return startRealtimeRuntime(scope, {
    now: () => Date.now(),
    reader,
    readPending: readPendingEntities,
    onReconciled,
  });
}

/** Monoton kuşak sayacı — `Math.random` YOK, tekrar üretilebilir. */
let _generation = 0;
function nextGeneration(): number {
  _generation += 1;
  return _generation;
}
