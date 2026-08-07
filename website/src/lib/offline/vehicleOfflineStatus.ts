/**
 * vehicleOfflineStatus.ts — ARAÇ ÇEVRİMDIŞI DENEYİMİ · SAF MODEL.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK · React YOK.
 * Zaman daima dışarıdan `now` ile verilir.
 *
 * NEDEN AYRI DOSYA: araç kartı "çevrimdışı" derken üç FARKLI şeyi karıştırmamalı:
 *   1. ARAÇ çevrimdışı (son telemetri eski),
 *   2. KULLANICI çevrimdışı (tarayıcıda ağ yok → filo işlemi kuyrukta),
 *   3. KOMUT teslim edilmedi (araç kuyruğunda bekliyor).
 * Bunlar tek "bekliyor" rozetinde birleştirilirse kullanıcı yapılmamış bir işi
 * yapılmış sanar. Model üçünü AYRI döndürür.
 *
 * Okunamayan alan `UNAVAILABLE` olur — sahte 0 / sahte tarih / sahte "sağlıklı"
 * ÜRETİLMEZ (CLAUDE.md §Gözlemlenebilirlik-5).
 */

import type { QueueItem } from './types';

/* ── Komut yaşam döngüsü ───────────────────────────────────────────────── */

/**
 * ÜRÜN SEVİYESİ komut evreleri. Veritabanı enum'ı (`commands.status`)
 * DEĞİŞTİRİLMEZ — araç tarafı onu yazar. Burada yalnız eşleme yapılır ki
 * "gönderildi" ile "araç gerçekten yaptı" ASLA aynı rozete düşmesin.
 */
export const COMMAND_PHASES = [
  'QUEUED',       // araç çevrimdışı — komut sunucuda bekliyor, teslim EDİLMEDİ
  'SENT',         // araca iletildi, henüz onay yok
  'ACKNOWLEDGED', // araç komutu aldığını bildirdi
  'EXECUTED',     // araç yürütmeye başladı
  'VERIFIED',     // sonuç sunucuda doğrulandı
  'FAILED',       // reddedildi / başarısız
  'EXPIRED',      // TTL doldu, uygulanmadı
] as const;
export type CommandPhase = (typeof COMMAND_PHASES)[number];

/** Henüz sonuçlanmamış evreler — "bekleyen komut" sayımı bunlardır. */
export const ACTIVE_COMMAND_PHASES: readonly CommandPhase[] = [
  'QUEUED', 'SENT', 'ACKNOWLEDGED', 'EXECUTED',
];

/**
 * Veritabanı durumu → ürün evresi.
 *
 * `pending` TEK BAŞINA yeterli değildir: araç çevrimdışıyken de, komut yeni
 * iletilmişken de `pending`'dir. Ayrımı araç bağlantısı yapar → QUEUED vs SENT.
 *
 * BİLİNMEYEN durum `null` döner (fail-closed) — tanınmayan bir durumu
 * "tamamlandı" saymak sessiz veri kaybıdır.
 */
export function commandPhaseOf(
  status: string,
  vehicleReachable: boolean,
): CommandPhase | null {
  switch (status) {
    case 'pending':   return vehicleReachable ? 'SENT' : 'QUEUED';
    case 'accepted':  return 'ACKNOWLEDGED';
    case 'executing': return 'EXECUTED';
    case 'completed': return 'VERIFIED';
    case 'failed':
    case 'rejected':  return 'FAILED';
    case 'expired':   return 'EXPIRED';
    default:          return null;
  }
}

/* ── Girdi ─────────────────────────────────────────────────────────────── */

/** Araç komut satırının gözlem için gereken EN AZ alanı (ham payload TAŞINMAZ). */
export interface VehicleCommandRow {
  id:     string;
  status: string;
}

export interface VehicleOfflineInput {
  vehicleId: string;
  /** ISO tarih; bilinmiyorsa null. */
  lastSeen:  string | null;
  ownerId:   string | null;
  viewerId:  string | null;
  /** Okunamadıysa `null` — boş dizi ile KARIŞTIRILMAZ. */
  queueItems: readonly QueueItem[] | null;
  /** Okunamadıysa `null`. */
  commands:   readonly VehicleCommandRow[] | null;
  now: number;
  /** Araç bu süre içinde görüldüyse çevrimiçi sayılır. */
  onlineWindowMs?: number;
}

/* ── Çıktı ─────────────────────────────────────────────────────────────── */

export type Connectivity = 'ONLINE' | 'OFFLINE' | 'NEVER_CONNECTED' | 'UNKNOWN';

export type OwnershipVerification =
  | 'VERIFIED_YOURS'   // sunucu doğruladı: sizin
  | 'VERIFIED_OTHER'   // sunucu doğruladı: başkasının
  | 'UNOWNED'          // sahibi yok
  | 'UNKNOWN';

export type PairingVerification =
  | 'NONE'
  | 'PENDING_SERVER_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'UNAVAILABLE';

export type VehicleSyncState =
  | 'CONFLICT' | 'PERMANENT_FAILED' | 'BLOCKED_BY_DEPENDENCY'
  | 'RETRYABLE_FAILED' | 'PENDING' | 'UP_TO_DATE' | 'UNAVAILABLE';

export interface VehicleOfflineStatus {
  vehicleId:    string;
  connectivity: Connectivity;
  /** Epoch ms; bilinmiyorsa null. */
  lastSeenAt:   number | null;
  ownership:    OwnershipVerification;
  pairing:      PairingVerification;
  /** Filo işlemleri (atama/çıkarma vb.) — konum/olay HARİÇ. */
  pendingFleetOps:       number | null;
  /** Bekleyen konum kayıtları. */
  pendingLocationEvents: number | null;
  /** Bekleyen araç olayları. */
  pendingVehicleEvents:  number | null;
  /** Evre → adet. Okunamadıysa null. */
  commandsByPhase:       Readonly<Record<CommandPhase, number>> | null;
  /** Sonuçlanmamış komut adedi (QUEUED+SENT+ACKNOWLEDGED+EXECUTED). */
  activeCommands:        number | null;
  /** Tanınmayan durumdaki komutlar — sessizce yutulmaz. */
  unknownCommands:       number | null;
  conflicts:             number | null;
  syncState:             VehicleSyncState;
}

const PENDING_STATUSES = ['PENDING', 'BLOCKED_BY_DEPENDENCY', 'RETRYABLE_FAILED'] as const;

function isPending(item: QueueItem): boolean {
  return (PENDING_STATUSES as readonly string[]).includes(item.status);
}

function emptyPhases(): Record<CommandPhase, number> {
  // Şablon nesne — tüm anahtarlar başta tanımlı (V8 hidden-class kararlılığı).
  return {
    QUEUED: 0, SENT: 0, ACKNOWLEDGED: 0, EXECUTED: 0,
    VERIFIED: 0, FAILED: 0, EXPIRED: 0,
  };
}

/** ISO tarihi epoch ms'e çevirir; geçersizse null (uydurma tarih YOK). */
export function parseLastSeen(lastSeen: string | null): number | null {
  if (!lastSeen) return null;
  const ts = Date.parse(lastSeen);
  return Number.isNaN(ts) ? null : ts;
}

export const DEFAULT_ONLINE_WINDOW_MS = 11 * 60 * 1000;

export function buildVehicleOfflineStatus(
  input: VehicleOfflineInput,
): VehicleOfflineStatus {
  const windowMs   = input.onlineWindowMs ?? DEFAULT_ONLINE_WINDOW_MS;
  const lastSeenAt = parseLastSeen(input.lastSeen);

  const connectivity: Connectivity =
    input.lastSeen === null ? 'NEVER_CONNECTED'
    : lastSeenAt === null   ? 'UNKNOWN'
    : input.now - lastSeenAt <= windowMs ? 'ONLINE'
    : 'OFFLINE';

  const ownership: OwnershipVerification =
    input.ownerId === null ? 'UNOWNED'
    : input.viewerId === null ? 'UNKNOWN'
    : input.ownerId === input.viewerId ? 'VERIFIED_YOURS'
    : 'VERIFIED_OTHER';

  /* ── Kuyruk kırılımı ─────────────────────────────────────────────────── */

  let pendingFleetOps: number | null = null;
  let pendingLocationEvents: number | null = null;
  let pendingVehicleEvents: number | null = null;
  let conflicts: number | null = null;
  let syncState: VehicleSyncState = 'UNAVAILABLE';

  if (input.queueItems !== null) {
    const mine = input.queueItems.filter((i) => i.vehicleId === input.vehicleId);
    pendingLocationEvents = mine.filter((i) => i.operationType === 'LOCATION_EVENT' && isPending(i)).length;
    pendingVehicleEvents  = mine.filter((i) => i.operationType === 'VEHICLE_EVENT'  && isPending(i)).length;
    pendingFleetOps       = mine.filter(
      (i) => isPending(i) && i.operationType !== 'LOCATION_EVENT' && i.operationType !== 'VEHICLE_EVENT',
    ).length;
    conflicts = mine.filter((i) => i.status === 'CONFLICT').length;

    syncState =
      conflicts > 0 ? 'CONFLICT'
      : mine.some((i) => i.status === 'PERMANENT_FAILED')      ? 'PERMANENT_FAILED'
      : mine.some((i) => i.status === 'BLOCKED_BY_DEPENDENCY') ? 'BLOCKED_BY_DEPENDENCY'
      : mine.some((i) => i.status === 'RETRYABLE_FAILED')      ? 'RETRYABLE_FAILED'
      : mine.some((i) => i.status === 'PENDING')               ? 'PENDING'
      : 'UP_TO_DATE';
  }

  /* ── Komut kırılımı ──────────────────────────────────────────────────── */

  let commandsByPhase: Record<CommandPhase, number> | null = null;
  let activeCommands:  number | null = null;
  let unknownCommands: number | null = null;

  if (input.commands !== null) {
    const phases = emptyPhases();
    let unknown = 0;
    // Araç ulaşılabilir DEĞİLSE `pending` komut teslim edilmemiştir → QUEUED.
    const reachable = connectivity === 'ONLINE';
    for (const row of input.commands) {
      const phase = commandPhaseOf(row.status, reachable);
      if (phase === null) { unknown += 1; continue; }
      phases[phase] += 1;
    }
    commandsByPhase = phases;
    unknownCommands = unknown;
    activeCommands  = ACTIVE_COMMAND_PHASES.reduce((sum, p) => sum + phases[p], 0);
  }

  /* ── Eşleştirme doğrulaması ──────────────────────────────────────────── */
  //
  // ÖNEMLİ: Çevrimdışı eşleştirme talebi (`PendingPairing`) araç kimliği
  // TAŞIMAZ — kod sunucuda doğrulanana kadar hangi araç olduğu BİLİNMEZ.
  // Bu yüzden araç-bazlı eşleştirme durumu YALNIZ kuyruktaki araç kimliği
  // taşıyan VEHICLE_PAIR / OWNERSHIP_CLAIM öğelerinden türetilir.
  // Namespace düzeyindeki claim adetleri eşleştirme ekranında ve LAB'dadır.

  let pairing: PairingVerification = 'UNAVAILABLE';
  if (input.queueItems !== null) {
    const claims = input.queueItems.filter(
      (i) => i.vehicleId === input.vehicleId &&
             (i.operationType === 'VEHICLE_PAIR' || i.operationType === 'OWNERSHIP_CLAIM'),
    );
    pairing =
      claims.length === 0                                  ? 'NONE'
      : claims.some(isPending)                             ? 'PENDING_SERVER_VERIFICATION'
      : claims.some((i) => i.status === 'CONFLICT' || i.status === 'PERMANENT_FAILED') ? 'REJECTED'
      : claims.some((i) => i.status === 'EXPIRED')         ? 'EXPIRED'
      : claims.some((i) => i.status === 'SYNCED')          ? 'VERIFIED'
      : 'NONE';
  }

  return {
    vehicleId: input.vehicleId,
    connectivity,
    lastSeenAt,
    ownership,
    pairing,
    pendingFleetOps,
    pendingLocationEvents,
    pendingVehicleEvents,
    commandsByPhase,
    activeCommands,
    unknownCommands,
    conflicts,
    syncState,
  };
}

/* ── Kullanıcıya dönük etiketler (düz Türkçe, teknik terim YOK) ────────── */

export function connectivityLabel(c: Connectivity): string {
  switch (c) {
    case 'ONLINE':          return 'Çevrimiçi';
    case 'OFFLINE':         return 'Çevrimdışı';
    case 'NEVER_CONNECTED': return 'Hiç bağlanmadı';
    case 'UNKNOWN':         return 'Bilinmiyor';
  }
}

/** Son görülme → dürüst metin. Bilinmiyorsa uydurma tarih ÜRETİLMEZ. */
export function lastSeenLabel(lastSeenAt: number | null, now: number): string {
  if (lastSeenAt === null) return 'Bilinmiyor';
  const diffMin = Math.floor((now - lastSeenAt) / 60000);
  if (diffMin < 1)  return 'Az önce';
  if (diffMin < 60) return `${diffMin} dakika önce`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)   return `${diffH} saat önce`;
  return `${Math.floor(diffH / 24)} gün önce`;
}

export function ownershipLabel(o: OwnershipVerification): string {
  switch (o) {
    case 'VERIFIED_YOURS': return 'Sunucuda doğrulandı — size ait';
    case 'VERIFIED_OTHER': return 'Sunucuda doğrulandı — filodaki başka bir üyeye ait';
    case 'UNOWNED':        return 'Sahibi yok';
    case 'UNKNOWN':        return 'Bilinmiyor';
  }
}

export function pairingLabel(p: PairingVerification): string {
  switch (p) {
    case 'NONE':                        return 'Bekleyen eşleştirme yok';
    case 'PENDING_SERVER_VERIFICATION': return 'Sunucu doğrulaması bekleniyor';
    case 'VERIFIED':                    return 'Doğrulandı';
    case 'REJECTED':                    return 'Reddedildi';
    case 'EXPIRED':                     return 'Süresi doldu';
    case 'UNAVAILABLE':                 return 'Okunamadı';
  }
}

export function syncStateLabel(s: VehicleSyncState): string {
  switch (s) {
    case 'CONFLICT':              return 'Çakışma var — kararınız gerekiyor';
    case 'PERMANENT_FAILED':      return 'Gönderilemedi';
    case 'BLOCKED_BY_DEPENDENCY': return 'Önceki bir işlem tamamlanmayı bekliyor';
    case 'RETRYABLE_FAILED':      return 'Gönderilemedi, tekrar denenecek';
    case 'PENDING':               return 'Gönderilmeyi bekliyor';
    case 'UP_TO_DATE':            return 'Güncel';
    case 'UNAVAILABLE':           return 'Okunamadı';
  }
}

export function commandPhaseLabel(phase: CommandPhase): string {
  switch (phase) {
    case 'QUEUED':       return 'Sırada (araca ulaşmadı)';
    case 'SENT':         return 'Gönderildi';
    case 'ACKNOWLEDGED': return 'Araç aldı';
    case 'EXECUTED':     return 'Araç uyguluyor';
    case 'VERIFIED':     return 'Doğrulandı';
    case 'FAILED':       return 'Başarısız';
    case 'EXPIRED':      return 'Süresi doldu';
  }
}
