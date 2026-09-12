/**
 * fleetLabModel.ts — CAROS LAB · FİLO/ÇEVRİMDIŞI SAF MODEL.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK · React YOK.
 * Zaman dışarıdan `now` ile verilir.
 *
 * Bilinmeyen alanlar `UNKNOWN` / `UNAVAILABLE` döner — sahte değer ÜRETİLMEZ.
 */

import type { FleetLabRawReading, PairingClaimCounts } from './fleetLabSources';
import { countByStatus, countByOperation, type Observability } from './fleetLabSources';
import type { OperationType, SyncStatus } from '@/lib/offline/types';
import {
  OFFLINE_CLASSES, offlineClassLabel, operationsByClass, type OfflineClass,
} from '@/lib/offline/offlineClassification';
import { isTrustworthy, realtimeStateLabel } from '@/lib/realtime/realtimeSyncAuthority';
import { toLabExport } from '@/lib/validation/phoneValidationScenarios';

export const UNKNOWN = 'UNKNOWN' as const;
export const UNAVAILABLE = 'UNAVAILABLE' as const;

export interface LabField {
  label:  string;
  value:  string;
  origin: Observability;
}

export interface FleetLabModel {
  identity:    readonly LabField[];
  permissions: readonly LabField[];
  queue:       readonly LabField[];
  byOperation: readonly LabField[];
  sync:        readonly LabField[];
  /** Hesap izolasyonu ve çevrimdışı politika kanıtı. */
  isolation:   readonly LabField[];
  /** İşlem türlerinin çevrimdışı sınıfı (politika şeffaflığı). */
  offlinePolicy: readonly LabField[];
  /** Realtime boşluk tespiti ve yeniden eşitleme kanıtı. */
  realtime:      readonly LabField[];
  /** Telefon doğrulama ilerlemesi (redacted — cihaz kimliği YOK). */
  phoneValidation: readonly LabField[];
  /** Panelin bütünsel okunabilirliği — biri bile false ise DEGRADED. */
  health: 'OK' | 'DEGRADED' | 'UNAVAILABLE';
}

function field(label: string, value: string, origin: Observability): LabField {
  return { label, value, origin };
}

function num(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : UNKNOWN;
}

function ts(value: number | null | undefined, now: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return UNKNOWN;
  const ageSec = Math.max(0, Math.floor((now - value) / 1000));
  return `${new Date(value).toISOString()} (${ageSec} sn önce)`;
}

export function buildFleetLabModel(reading: FleetLabRawReading, now: number): FleetLabModel {
  const snap = reading.snapshot;
  const snapOrigin: Observability = !reading.snapshotReadable
    ? 'UNAVAILABLE'
    : !snap
      ? 'UNAVAILABLE'
      : snap.expiresAt <= now
        ? 'STALE'
        : 'OBSERVED';

  const queueOrigin: Observability = reading.queueReadable ? 'OBSERVED' : 'UNAVAILABLE';
  const statuses = countByStatus(reading.queueItems);
  const ops      = countByOperation(reading.queueItems);

  // Son senkron = en yeni SYNCED öğenin oluşturulma anı (türetilmiş).
  const lastSynced = reading.queueItems
    .filter((i) => i.status === 'SYNCED')
    .reduce<number | null>((acc, i) => (acc === null || i.createdAt > acc ? i.createdAt : acc), null);

  const lastFailure = reading.queueItems
    .filter((i) => i.failureCode !== null)
    .reduce<{ at: number; code: string } | null>(
      (acc, i) => (acc === null || i.createdAt > acc.at
        ? { at: i.createdAt, code: i.failureCode as string }
        : acc),
      null,
    );

  const pendingPairing = reading.queueItems.filter(
    (i) => (i.operationType === 'VEHICLE_PAIR' || i.operationType === 'OWNERSHIP_CLAIM') &&
           (i.status === 'PENDING' || i.status === 'BLOCKED_BY_DEPENDENCY' || i.status === 'RETRYABLE_FAILED'),
  ).length;

  const expiredPairing = reading.queueItems.filter(
    (i) => (i.operationType === 'VEHICLE_PAIR' || i.operationType === 'OWNERSHIP_CLAIM') &&
           i.status === 'EXPIRED',
  ).length;

  const identity: LabField[] = [
    field('Aktif kullanıcı', reading.userId ? 'VAR' : 'YOK', reading.userId ? 'OBSERVED' : 'UNAVAILABLE'),
    field('Profil durumu',
      !reading.snapshotReadable ? UNAVAILABLE : snap ? 'DOĞRULANMIŞ' : 'DOĞRULANMAMIŞ',
      snapOrigin),
    field('Şirket kimliği', snap ? (snap.companyId ? 'VAR' : 'YOK') : UNKNOWN, snapOrigin),
    field('Şirket rolü', snap ? snap.companyRole : UNKNOWN, snapOrigin),
    field('Bağlantı', reading.online === null ? UNKNOWN : reading.online ? 'ÇEVRİMİÇİ' : 'ÇEVRİMDIŞI',
      reading.online === null ? 'UNAVAILABLE' : 'OBSERVED'),
  ];

  const permissions: LabField[] = [
    field('Yetki anlık görüntü revizyonu', snap ? num(snap.serverRevision) : UNKNOWN, snapOrigin),
    field('Yetki sayısı', snap ? num(snap.permissions.length) : UNKNOWN, snapOrigin),
    field('Sahip olunan araç', snap ? num(snap.ownedVehicleIds.length) : UNKNOWN, snapOrigin),
    field('Erişilebilir araç', snap ? num(snap.accessibleVehicleIds.length) : UNKNOWN, snapOrigin),
    field('Son sahiplik doğrulaması', snap ? ts(snap.verifiedAt, now) : UNKNOWN, snapOrigin),
    field('Anlık görüntü geçerlilik sonu', snap ? ts(snap.expiresAt, now) : UNKNOWN, snapOrigin),
    field('Anlık görüntü bayat mı', snap ? (snap.expiresAt <= now ? 'EVET' : 'HAYIR') : UNKNOWN, snapOrigin),
  ];

  const queue: LabField[] = [
    field('Kuyruk boyutu', reading.queueReadable ? num(reading.queueItems.length) : UNAVAILABLE, queueOrigin),
    field('Bağımlılıkla engellenen', reading.queueReadable ? num(statuses.BLOCKED_BY_DEPENDENCY) : UNAVAILABLE, queueOrigin),
    field('Yeniden denenebilir hata', reading.queueReadable ? num(statuses.RETRYABLE_FAILED) : UNAVAILABLE, queueOrigin),
    field('Kalıcı hata', reading.queueReadable ? num(statuses.PERMANENT_FAILED) : UNAVAILABLE, queueOrigin),
    field('Çakışma', reading.queueReadable ? num(statuses.CONFLICT) : UNAVAILABLE, queueOrigin),
    field('Süresi dolmuş', reading.queueReadable ? num(statuses.EXPIRED) : UNAVAILABLE, queueOrigin),
    field('Bozuk kayıt (karantina)', num(reading.corruptRecords), reading.corruptRecords === null ? 'UNAVAILABLE' : 'OBSERVED'),
  ];

  const byOperation: LabField[] = (Object.keys(ops) as OperationType[])
    .sort()
    .map((op) => field(op, num(ops[op]), queueOrigin));

  const sync: LabField[] = [
    field('Son senkron (SYNCED)', lastSynced === null ? UNKNOWN : ts(lastSynced, now),
      lastSynced === null ? 'UNAVAILABLE' : 'DERIVED'),
    field('Son hata kodu', lastFailure?.code ?? UNKNOWN, lastFailure ? 'DERIVED' : 'UNAVAILABLE'),
    field('Bekleyen eşleştirme (kuyruk)', reading.queueReadable ? num(pendingPairing) : UNAVAILABLE, queueOrigin),
    field('Süresi dolmuş eşleştirme (kuyruk)', reading.queueReadable ? num(expiredPairing) : UNAVAILABLE, queueOrigin),
    ...pairingClaimFields('Çevrimdışı eşleştirme talebi', reading.pairingClaims),
    ...pairingClaimFields('Cihaz kapsamı eşleştirme talebi', reading.devicePairingClaims),
    field('Son sunucu revizyonu', snap ? num(snap.serverRevision) : UNKNOWN, snapOrigin),
    field('Son yerel revizyon',
      reading.queueItems.length > 0
        ? num(Math.max(...reading.queueItems.map((i) => i.clientRevision)))
        : UNKNOWN,
      reading.queueItems.length > 0 ? 'DERIVED' : 'UNAVAILABLE'),
    field('Senkron durumu', deriveSyncState(statuses, reading.online), 'DERIVED'),
  ];

  /* ── Hesap izolasyonu ve kuşak kanıtı ──────────────────────────────── */

  const boundOrigin: Observability = reading.accountScopeBound === null ? 'UNAVAILABLE' : 'OBSERVED';

  const isolation: LabField[] = [
    field('Kuyruk hesap kapsamına bağlı',
      reading.accountScopeBound === null ? UNAVAILABLE : reading.accountScopeBound ? 'EVET' : 'HAYIR',
      boundOrigin),
    field('Yabancı hesap kaydı reddi',
      num(reading.foreignAccountRejected),
      reading.foreignAccountRejected === null ? 'UNAVAILABLE' : 'OBSERVED'),
    field('Bilinmeyen şema reddi',
      num(reading.schemaRejected),
      reading.schemaRejected === null ? 'UNAVAILABLE' : 'OBSERVED'),
    field('Senkron kuşağı',
      num(reading.syncGeneration),
      reading.syncGeneration === null ? 'UNAVAILABLE' : 'OBSERVED'),
    field('Bayat sonuç reddi',
      num(reading.staleRejects),
      reading.staleRejects === null ? 'UNAVAILABLE' : 'OBSERVED'),
    field('Senkron turu çalışıyor',
      reading.syncRunning === null ? UNAVAILABLE : reading.syncRunning ? 'EVET' : 'HAYIR',
      reading.syncRunning === null ? 'UNAVAILABLE' : 'OBSERVED'),
  ];

  /* ── Çevrimdışı politika (saf sözleşme — okuma gerektirmez) ─────────── */

  const byClass = operationsByClass();
  const offlinePolicy: LabField[] = (OFFLINE_CLASSES as readonly OfflineClass[]).map((klass) =>
    field(offlineClassLabel(klass), byClass[klass].join(', ') || 'YOK', 'DERIVED'),
  );

  /* ── Realtime ───────────────────────────────────────────────────────── */

  // Otorite kayıtlı DEĞİLSE tek bir dürüst satır: sahte sayaç ÜRETİLMEZ.
  // `!rt` bilinçli olarak GEVŞEKTİR: alan `null` (otorite yok) ya da
  // `undefined` (okuma katmanı bu alanı hiç üretmedi) olabilir. İkisi de
  // UNAVAILABLE'dır — eksik alan yüzünden panel ÇÖKMEZ (fail-closed).
  const rt = reading.realtime;
  const realtime: LabField[] = !rt
    ? [field('Realtime otoritesi', UNAVAILABLE, 'UNAVAILABLE')]
    : [
        field('Durum', `${rt.state} — ${realtimeStateLabel(rt.state)}`, 'OBSERVED'),
        field('Güvenilir mi (LIVE)', isTrustworthy(rt.state) ? 'EVET' : 'HAYIR', 'DERIVED'),
        field('Kapsam kuşağı', num(rt.scopeGeneration), rt.scopeGeneration === null ? 'UNAVAILABLE' : 'OBSERVED'),
        field('Son sunucu revizyonu', num(rt.lastServerRevision), rt.lastServerRevision === null ? 'UNAVAILABLE' : 'OBSERVED'),
        field('Son olay revizyonu', num(rt.lastEventRevision), rt.lastEventRevision === null ? 'UNAVAILABLE' : 'OBSERVED'),
        field('Son boşluk sebebi', rt.lastGapReason ?? UNKNOWN, rt.lastGapReason === null ? 'UNAVAILABLE' : 'OBSERVED'),
        field('Yeniden bağlanma', num(rt.counters.reconnectCount), 'OBSERVED'),
        field('Boşluk şüphesi', num(rt.counters.suspectedGapCount), 'OBSERVED'),
        field('Doğrulanmış boşluk', num(rt.counters.confirmedGapCount), 'OBSERVED'),
        field('Eşitleme denemesi', num(rt.counters.resyncAttemptCount), 'OBSERVED'),
        field('Eşitleme başarısı', num(rt.counters.resyncSuccessCount), 'OBSERVED'),
        field('Eşitleme başarısızlığı', num(rt.counters.resyncFailureCount), 'OBSERVED'),
        field('Bayat olay reddi', num(rt.counters.staleCallbackRejectCount), 'OBSERVED'),
        field('Yinelenen olay', num(rt.counters.duplicateEventCount), 'OBSERVED'),
        field('Snapshot varlık sayısı', num(rt.counters.snapshotEntityCount), 'OBSERVED'),
        field('Uzlaştırma çakışması', num(rt.counters.reconciliationConflictCount), 'OBSERVED'),
        field('Son eşitleme süresi (ms)', num(rt.lastResyncDurationMs), rt.lastResyncDurationMs === null ? 'UNAVAILABLE' : 'OBSERVED'),
      ];

  /* ── Telefon doğrulama (redacted) ───────────────────────────────────── */

  // Kayıt yoksa `toLabExport([])` dürüst sıfır tablosu döner: 15 NOT_RUN ve
  // `phoneValidated=false`. Bu "kötü" bir sonuç DEĞİL, doğru olanıdır —
  // koşulmamış doğrulama geçmiş SAYILMAZ.
  const validation = toLabExport(reading.validationRuns ?? []);
  const phoneValidation: LabField[] = [
    field('Telefon doğrulaması', validation.phoneValidated ? 'TAMAM' : 'TAMAMLANMADI', 'DERIVED'),
    field('Toplam senaryo', num(validation.total), 'OBSERVED'),
    field('Geçen (kanıtlı)', num(validation.passed), 'OBSERVED'),
    field('Düşen', num(validation.failed), 'OBSERVED'),
    field('Koşulmayan', num(validation.notRun), 'OBSERVED'),
    field('Bloklu / kanıtsız', num(validation.blocked), 'OBSERVED'),
    field('Kanıt eksiksizliği', num(validation.evidenceComplete), 'OBSERVED'),
    field('Son derleme', validation.lastBuild ?? UNKNOWN,
      validation.lastBuild === null ? 'UNAVAILABLE' : 'OBSERVED'),
  ];

  const health: FleetLabModel['health'] =
    !reading.userId ? 'UNAVAILABLE'
    // Hesap kapsamı bağlı DEĞİLSE panel "OK" diyemez — izolasyon kanıtsızdır.
    : reading.accountScopeBound === false ? 'DEGRADED'
    // Realtime kayıtlıysa ve güvenilir DEĞİLSE panel "OK" diyemez.
    : rt && !isTrustworthy(rt.state) ? 'DEGRADED'
    : reading.queueReadable && reading.snapshotReadable ? 'OK'
    : 'DEGRADED';

  return {
    identity, permissions, queue, byOperation, sync,
    isolation, offlinePolicy, realtime, phoneValidation, health,
  };
}

/**
 * Çevrimdışı eşleştirme talebi ADETLERİ.
 * Kod, araç kimliği ve ham içerik TAŞINMAZ — yalnız sayı (CLAUDE.md §Gözlem-6).
 * Okunamayan kapsam UNAVAILABLE olur; sahte 0 YAZILMAZ.
 */
function pairingClaimFields(
  prefix: string,
  counts: PairingClaimCounts | null | undefined,
): LabField[] {
  // Alan hiç okunamadıysa (null) ya da okuma katmanı bu alanı üretmediyse
  // (undefined) fail-closed UNAVAILABLE — sahte 0 ASLA yazılmaz.
  if (!counts) {
    return [field(`${prefix} · durum`, UNAVAILABLE, 'UNAVAILABLE')];
  }
  return [
    field(`${prefix} · doğrulama bekleyen`, num(counts.pending),  'OBSERVED'),
    field(`${prefix} · doğrulanmış`,        num(counts.verified), 'OBSERVED'),
    field(`${prefix} · reddedilmiş`,        num(counts.rejected), 'OBSERVED'),
    field(`${prefix} · süresi dolmuş`,      num(counts.expired),  'OBSERVED'),
  ];
}

function deriveSyncState(statuses: Record<SyncStatus, number>, online: boolean | null): string {
  if (statuses.CONFLICT > 0)                 return 'CONFLICT';
  if (statuses.PERMANENT_FAILED > 0)         return 'PERMANENT_FAILED';
  if (statuses.SYNCING > 0)                  return 'SYNCING';
  if (statuses.BLOCKED_BY_DEPENDENCY > 0)    return 'BLOCKED_BY_DEPENDENCY';
  if (statuses.RETRYABLE_FAILED > 0)         return 'RETRYABLE_FAILED';
  if (statuses.PENDING > 0)                  return online === false ? 'PENDING (çevrimdışı)' : 'PENDING';
  return 'IDLE';
}
