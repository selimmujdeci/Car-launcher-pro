/**
 * remoteCommandService — Supabase Realtime üzerinden PWA → araç komut kanalı.
 *
 * Tunnel-Proof Command Engine (Spec §3 Resiliency):
 *
 * TTL (Time-To-Live):
 *   Her komut satırında isteğe bağlı `ttl_ms` alanı bulunur (varsayılan 30s).
 *   `now - created_at > ttl_ms` ise komut "expired" olarak reddedilir.
 *   Tünelden çıkınca 10dk önceki korna komutunun çalmasını engeller.
 *
 * Critical Retry Queue:
 *   LOCK / UNLOCK gibi kritik komutlar çevrimdışıyken RetryQueue'ya alınır.
 *   Bağlantı geldiğinde (online event) TTL kontrolüyle sırayla yürütülür.
 *   Queue safeStorage'a persist edilir → uygulama yeniden başlasa da kaybolmaz.
 *
 * Status Phases (RECEIVED → EXECUTING → COMPLETED/EXPIRED/FAILED):
 *   received  : komut araca ulaştı, TTL geçerliyse işleme alındı
 *   executing : executeIntent() başladı
 *   completed : başarıyla tamamlandı
 *   expired   : TTL doldu, çalıştırılmadı
 *   queued    : çevrimdışı kritik komut — bağlantıda işlenecek
 *   failed    : yürütme hatası
 *   rejected  : güvenlik reddi
 *
 * Zero-Leak (CLAUDE.md §1):
 *   stopRemoteCommands() her zaman channel.unsubscribe() + online listener temizler.
 *
 * Data Integrity (CLAUDE.md §4):
 *   Tüm durum geçişleri connectivityService.enqueue ile at-least-once garantili.
 */

import type { RealtimeChannel }               from '@supabase/supabase-js';
import { getSupabaseClient }                   from './supabaseClient';
import { subscribeConnectivity }               from './connectivity/connectivityAuthority';
import { allowsConnectivity }                  from './connectivity/connectivityGate';
import { logInfo }                             from './debug';
import { getVehicleIdentity }                  from './vehicleIdentityService';
import { updateRemoteCommandStatus,
         pushVehicleEvent }                    from './vehicleIdentityService';
import { sensitiveKeyStore }                   from './sensitiveKeyStore';
import { fromAIResponse }                      from './intentEngine';
import { executeIntent }                       from './commandExecutor';
import type { CommandContext }                  from './commandExecutor';
import { applyVars }                           from './liveStyleEngine';
import { isE2EPayload, decryptE2EPayload,
         getCarPrivateKey, loadOrCreateDeviceKey } from './commandCrypto';
import { checkCrossChannelNonceReplay }            from './nativeCommandBridge';
import { safeGetRaw, safeSetRaw }              from '../utils/safeStorage';

// ── TTL Sabitleri ─────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60_000; // 60 saniye — güvenlik kritik (park/şehir içi senaryo)

/**
 * Komut satırının TTL değerini döner.
 * DB satırında `ttl_ms` varsa kullanılır; yoksa 30s varsayılan.
 */
function _ttlMs(row: Record<string, unknown>): number {
  const t = row['ttl_ms'];
  return typeof t === 'number' && t > 0 ? t : DEFAULT_TTL_MS;
}

/** Komutun created_at'ten itibaren geçen ms */
function _ageMs(row: Record<string, unknown>): number {
  const createdAt = row['created_at'] as string | undefined;
  if (!createdAt) return 0;
  return Date.now() - new Date(createdAt).getTime();
}

/** TTL aşıldı mı? */
function _isExpired(row: Record<string, unknown>): boolean {
  return _ageMs(row) > _ttlMs(row);
}

// ── Hardware ACK (Acknowledge) Mekanizması ────────────────────────────────
//
// Fiziksel donanım komutları (kapı kilidi, CAN bus) için iki aşamalı onay:
//   1. executeIntent() çağrısı → komutu native plugin'e iletir
//   2. Native CAN bus handler → acknowledgeCommand(id) çağırır → 'completed'
//
// ACK_TIMEOUT_MS içinde yanıt gelmezse → 'failed' (ack_timeout).
// Araç bağlantısı kesilirse timeout tetiklenir; telefon "başarısız" görür.
//
// Native entegrasyon: CarLauncherPlugin'deki CAN bus geri bildirimi
//   carPlugin.addListener('hardwareAck', ({ commandId }) => acknowledgeCommand(commandId));

const ACK_TIMEOUT_MS = 10_000; // 10 saniye — CAN bus yanıt bekleme süresi

/** Donanım onayı gerektiren komut tipleri (kapı kilidi, CAN bus kritik) */
const COMMANDS_REQUIRING_ACK = new Set([
  'lock', 'unlock',
  'hw_lock_doors', 'hw_unlock_doors',
  'HARDWARE_LOCK', 'HARDWARE_UNLOCK',
]);

interface PendingAck {
  timer:   ReturnType<typeof setTimeout>;
  resolve: (acked: boolean) => void;
}
/** commandId → bekleyen ACK kaydı */
const _pendingAcks = new Map<string, PendingAck>();

/**
 * Donanım ACK'ını teslim al — native CAN bus handler tarafından çağrılır.
 * Zamanında gelirse komutu 'completed' olarak işaretler; yoksa timeout tetikler.
 */
export function acknowledgeCommand(commandId: string): void {
  const pending = _pendingAcks.get(commandId);
  if (!pending) return; // zaten tamamlandı veya timeout oldu
  clearTimeout(pending.timer);
  _pendingAcks.delete(commandId);
  pending.resolve(true);
}

/**
 * ACK zaman aşımını manuel tetikle (test veya native bridge kopması için).
 * Normal akışta acknowledgeCommand çağrılmazsa ACK_TIMEOUT_MS sonra otomatik tetikler.
 */
export function timeoutCommandAck(commandId: string): void {
  const pending = _pendingAcks.get(commandId);
  if (!pending) return;
  clearTimeout(pending.timer);
  _pendingAcks.delete(commandId);
  pending.resolve(false);
}

/** ACK bekle — timeout → false, zamanında → true */
function _awaitHardwareAck(commandId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      _pendingAcks.delete(commandId);
      resolve(false); // timeout — donanım yanıt vermedi
    }, ACK_TIMEOUT_MS);
    _pendingAcks.set(commandId, { timer, resolve });
  });
}

// ── Critical Retry Queue ──────────────────────────────────────────────────

/**
 * Kritik komut tipleri — internet yokken kuyruğa alınır.
 * Semantik yükler (lock/unlock), DB type alanı adları ve AppIntent tipleri.
 */
const CRITICAL_TYPES = new Set([
  'lock', 'unlock',
  // C7: TÜM fiziksel MCU komutları E2E-kritik — commandListener MCU_COMMANDS ile birebir
  // tutarlı. E2E'siz (örn. admin paneli plaintext) horn/alarm/lights araç tarafında reddedilir;
  // hiçbir fiziksel komut şifresiz geçemez (güvenlik modeli tutarlı).
  'horn', 'alarm_on', 'alarm_off', 'lights_on',
  'hw_lock_doors', 'hw_unlock_doors',
  'HARDWARE_LOCK', 'HARDWARE_UNLOCK',
]);

const QUEUE_STORAGE_KEY = 'cmd-retry-queue-v1';
const QUEUE_MAX         = 50; // memory overflow koruması

interface RetryEntry {
  row:     Record<string, unknown>;
  savedAt: number; // Date.now() — eviction için
}

/** Queue'yu safeStorage'dan yükle; expired entry'leri at. */
function _loadQueue(): RetryEntry[] {
  try {
    const raw = safeGetRaw(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RetryEntry[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((e) => !_isExpired(e.row));
  } catch { return []; }
}

function _saveQueue(q: RetryEntry[]): void {
  try { safeSetRaw(QUEUE_STORAGE_KEY, JSON.stringify(q)); } catch { /* quota */ }
}

let _retryQueue: RetryEntry[] = _loadQueue();

function _enqueueRetry(row: Record<string, unknown>): void {
  if (_retryQueue.length >= QUEUE_MAX) {
    // En eski (veya zaten expired) entry'yi çıkar
    _retryQueue.shift();
  }
  _retryQueue.push({ row, savedAt: Date.now() });
  _saveQueue(_retryQueue);
}

function _dequeueAll(): RetryEntry[] {
  const snapshot = [..._retryQueue];
  _retryQueue = [];
  _saveQueue([]);
  return snapshot;
}

/** Çevrimdışı kritik komutları bağlantı gelince yürüt. */
async function _drainRetryQueue(): Promise<void> {
  if (!_active) return;
  const entries = _dequeueAll();
  if (entries.length === 0) return;

  if (import.meta.env.DEV) {
    logInfo(`[RemoteCommand] Draining ${entries.length} queued command(s)`);
  }

  for (const entry of entries) {
    if (_isExpired(entry.row)) {
      // TTL doldu — bildir ve at
      const id = entry.row['id'] as string | undefined;
      if (id) await updateRemoteCommandStatus(id, 'expired').catch(() => {});
    } else {
      await _processCommand(entry.row, /* fromQueue */ true).catch(() => {});
    }
  }
}

// ── Command-ID De-duplication ─────────────────────────────────────────────
//
// Realtime INSERT eventi ile _fetchMissedCommands() aynı anda tetiklenirse
// aynı commandId iki kez _processCommand'a gidebilir.
// Bu Map, 2 dakikalık bir pencerede işlenen ID'leri kaydeder.

const _processedIds = new Map<string, number>(); // commandId → processedAt ms
const DEDUP_WINDOW_MS = 120_000;

function _isDuplicate(commandId: string): boolean {
  const now = Date.now();
  // GC: süresi dolmuş kayıtları temizle
  _processedIds.forEach((ts, id) => { if (now - ts > DEDUP_WINDOW_MS) _processedIds.delete(id); });
  if (_processedIds.has(commandId)) return true;
  _processedIds.set(commandId, now);
  return false;
}

// ── Deferred UI context ───────────────────────────────────────────────────

const _ctxRef: { current: CommandContext | null } = { current: null };

export function setRemoteCommandContext(ctx: CommandContext): void {
  _ctxRef.current = ctx;
}

// ── Core dispatcher ───────────────────────────────────────────────────────

/**
 * F0.2 · KANONİK UZAK KOMUT YÜRÜTME OTORİTESİ = `commandListener`.
 *
 * ── ÖLÇÜLEN KUSUR (2026-09-17) ───────────────────────────────────────────
 * Bu servis ile `commandListener` AYNI `vehicle_commands` satırını birbirinden
 * habersiz işliyordu (bu servis `remote-commands:<vid>` kanalı, o `vehicle-cmds:<vid>`
 * kanalı + 15 sn yoklama). Dedup her ikisinde de KENDİ RAM'indeydi, ortak bir DB
 * claim/lease YOKTU. Sonuç, sahada iki farklı yanlış üretiyordu:
 *   (a) Aynı fiziksel komut İKİ KEZ yürütülebiliyordu.
 *   (b) Aynı satıra çelişen durum yazılıyordu: Arabam Cebimde INSERT'i yalnız
 *       `type` kolonunu yazar (`website/src/lib/commandService.ts`), `intent`
 *       YAZMAZ; bu servis ise satırı `intent` üzerinden okuyup
 *       `fromAIResponse` null dönünce "Unknown intent" ile `failed` yazarken
 *       `commandListener` aynı komutu `type` üzerinden YÜRÜTÜP `completed`
 *       yazıyordu. Kullanıcı kapı kilitlendiği hâlde "Hata" görebiliyordu.
 *
 * ── NEDEN `commandListener` KANONİK ──────────────────────────────────────
 *   1. Fiziksel komutlarda E2E'yi ZORUNLU kılan tek tüketici odur
 *      (`commandListener.ts` MCU_COMMANDS / E2E_REQUIRED_COMMANDS) ve bu küme
 *      native `CommandService.java` ile birebir aynıdır.
 *   2. Üretimdeki yazıcı `type` kolonunu yazar — `commandListener` o kolonu okur.
 *   3. Taşıması güvenilirdir: 15 sn yoklama ASIL yoldur, realtime yalnız
 *      hızlandırıcıdır; bu servis yoklama YAPMAZ.
 *   4. Hareket kapısı (`movingGateVerdict`) ve kanallar arası nonce replay
 *      koruması ondadır.
 *   5. Eşleşmiş her native cihazda açılması GARANTİDİR
 *      (`pushService.ts` → `_ensureCommandListener`, push durumundan bağımsız).
 *
 * ── BU SERVİSİN YENİ ROLÜ ────────────────────────────────────────────────
 * Fiziksel yürütme yetkisi YOK. Kalan sorumluluklar: çevrimdışı retry kuyruğu
 * defteri, bağlantı gözlemi, TTL sabitleri ve UI'nin beslediği `CommandContext`.
 * ÜÇÜNCÜ bir executor KURULMADI; mevcut olan tek otoriteye devredildi.
 */
let _delegatedCount = 0;

/** Devredilen (yürütülmeyen) komut sayısı — LAB/teşhis gözlemi. */
export function getDelegatedCommandCount(): number { return _delegatedCount; }

/**
 * TEK OTORİTE KAPISI (F0.2).
 *
 * Bu servisteki ÜÇ çağıranın (realtime · `_fetchMissedCommands` ·
 * `_drainRetryQueue`) ortak darboğazı budur; kapı burada olduğu için hangi
 * yoldan gelinirse gelinsin fiziksel yürütme İMKÂNSIZDIR.
 *
 * DURUM DA YAZILMAZ: `received`/`expired` yazmak bile kanonik otoriteyle aynı
 * satır üzerinde yarış üretirdi. Satırın yaşam döngüsünün TEK sahibi
 * `commandListener`dır.
 */
async function _processCommand(
  row: Record<string, unknown>,
  fromQueue = false,
): Promise<void> {
  _delegatedCount += 1;

  const commandId = row['id'] as string | undefined;
  if (!commandId) return;
  if (_isDuplicate(commandId)) return;

  /* ── KALAN TEK SORUMLULUK: ÇEVRİMDIŞI KRİTİK KOMUT DEFTERİ ────────────
     Yürütme yoktur; DURUM YAZILMAZ. Yalnız "araç çevrimdışıyken gelen
     kritik komut" yerel deftere alınır ki bağlantı dönünce kanonik otorite
     (`commandListener`) yoklamasında kaybolmuş sayılmasın. Bu yerel bir
     kayıttır — DB satırına DOKUNMAZ, dolayısıyla yarış üretmez. */
  if (!allowsConnectivity('BACKGROUND_SYNC') && !fromQueue) {
    /* Kritiklik KANONİK AYRIM `type` ÜZERİNDEN okunur (F0.2). `intent` de
       kabul edilir çünkü bu YALNIZ yerel defter kararıdır: iki alanın
       ayrışması burada yürütme semantiği üretmez, yalnız daha geniş bir
       küme deftere girer (fail-safe yön). */
    const rowType    = row['type']   as string | undefined;
    const intentType = row['intent'] as string | undefined;
    if (CRITICAL_TYPES.has(rowType ?? '') || CRITICAL_TYPES.has(intentType ?? '')) {
      _enqueueRetry(row);
    }
  }
}

/**
 * ⚠️ DEVRE DIŞI — ESKİ YÜRÜTÜCÜ GÖVDESİ (F0.2'de çağrısı KESİLDİ).
 *
 * Silinmedi: bu turun kapsamı ölü kod temizliği DEĞİLDİR ve silme, TTL/retry/
 * E2E/ACK ayrıntılarının kaybolma riskini taşır. Hiçbir yerden ÇAĞRILMAZ;
 * yürütme kanonik otoritededir. Bu gövdeyi yeniden bağlamak, ikinci fiziksel
 * yürütücüyü geri getirir ve `remoteCommandSingleAuthority` guard testi düşer.
 */
async function _legacyExecuteCommandDisabled(
  row: Record<string, unknown>,
  fromQueue = false,
): Promise<void> {
  const commandId = row['id']     as string | undefined;
  const status    = row['status'] as string | undefined;

  if (!commandId) return;

  // ── De-duplication: aynı commandId iki kez işlenmesin ─────────────────
  // Realtime + fetchMissedCommands yarış koşulu veya ağ yeniden iletimi.
  if (_isDuplicate(commandId)) {
    if (import.meta.env.DEV) {
      console.warn('[RemoteCommand] Duplicate suppressed:', commandId);
    }
    return;
  }

  // Idempotent guard — yalnızca pending/queued komutları işle
  if (!fromQueue && status !== 'pending') return;

  // ── Phase 1: RECEIVED ACK — komut araca ulaştı ──────────────────────────
  await updateRemoteCommandStatus(commandId, 'received');

  // TTL kontrolü — expired ise çalıştırma
  if (_isExpired(row)) {
    await updateRemoteCommandStatus(commandId, 'expired');
    if (import.meta.env.DEV) {
      console.warn(`[RemoteCommand] Expired (${_ageMs(row)}ms > ${_ttlMs(row)}ms):`, commandId);
    }
    return;
  }

  // SET_STYLE: CSS custom property live sync — context gerekmez, kritik değil
  const rowType = row['type'] as string | undefined;
  if (rowType === 'set_style') {
    const vars = (row['payload'] as Record<string, unknown> | undefined)?.['vars'];
    if (vars && typeof vars === 'object') {
      applyVars(vars as Record<string, string>);
    }
    await updateRemoteCommandStatus(commandId, 'completed');
    return;
  }

  // ── Kritik donanım komutları → E2E şifreleme zorunluluğu ─────────────────
  // lock/unlock gibi fiziksel komutlar yalnızca decryptE2EPayload üzerinden
  // gelmelidir. Payload `ecdh_v1` formatında değilse → güvenlik reddi.
  // Bu önlem commandListener ↔ remoteCommandService çift kanal karmaşasını giderir:
  // iki servis de aynı DB satırını işleyebilir; E2E kontrolü burada da tekrar yapılır.
  const intentType = row['intent'] as string | undefined;
  const isCritical = CRITICAL_TYPES.has(rowType ?? '') || CRITICAL_TYPES.has(intentType ?? '');

  if (isCritical) {
    const payloadField = row['payload'] as unknown;

    // 1. Format kontrolü — `ecdh_v1` değilse anında red (plaintext kritik komut).
    if (!isE2EPayload(payloadField)) {
      const msg = 'Security: critical command requires E2E encryption (ecdh_v1)';
      await updateRemoteCommandStatus(commandId, 'rejected', msg).catch(() => {});
      await pushVehicleEvent('remote_command_rejected', {
        commandId,
        reason: 'e2e_required',
        rowType,
      }).catch(() => {});
      if (import.meta.env.DEV) {
        console.error('[RemoteCommand] SECURITY BLOCK — unencrypted critical cmd:', commandId);
      }
      return;
    }

    // 2. C2 fix: GERÇEK deşifreleme — format-spoof'u eler. Private key yalnız araçta
    //    olduğundan saldırgan geçerli ciphertext üretemez → decrypt başarısı = TEK icra
    //    kapısı. Decrypt edilmiş temiz payload row'a yazılır; artık plaintext `intent`
    //    alanına değil doğrulanmış içeriğe güvenilir. (Nonce-replay çift-icrayı engeller.)
    let privKey = getCarPrivateKey();
    if (!privKey) {
      await loadOrCreateDeviceKey().catch(() => {});
      privKey = getCarPrivateKey();
    }
    if (!privKey) {
      await updateRemoteCommandStatus(commandId, 'rejected', 'Security: E2E private key unavailable').catch(() => {});
      return;
    }
    try {
      const clear = await decryptE2EPayload(payloadField, privKey, {
        crossChannelNonceCheck: checkCrossChannelNonceReplay,
      });
      row['payload'] = clear; // fromAIResponse/executeIntent doğrulanmış payload'ı görür
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Decryption Error';
      await updateRemoteCommandStatus(commandId, 'rejected', `Security: ${reason}`).catch(() => {});
      await pushVehicleEvent('remote_command_rejected', {
        commandId,
        reason: 'e2e_decrypt_failed',
        rowType,
      }).catch(() => {});
      if (import.meta.env.DEV) {
        console.error('[RemoteCommand] SECURITY BLOCK — E2E decrypt failed:', commandId, reason);
      }
      return;
    }
  }

  /* F7-B: komut durumunu backend'e yazabilmek arka plan senkronudur. */
  if (!allowsConnectivity('BACKGROUND_SYNC') && !fromQueue) {
    if (isCritical) {
      // Kritik komut: TTL içinde bağlantı gelince yeniden denenir
      _enqueueRetry(row);
      await updateRemoteCommandStatus(commandId, 'queued').catch(() => {});
      if (import.meta.env.DEV) {
        logInfo(`[RemoteCommand] Queued critical command (offline):`, commandId);
      }
    } else {
      // Kritik olmayan komut: queue'ya alma — süresi dolmuş olabilir, telefonu uyar
      await updateRemoteCommandStatus(commandId, 'failed', 'vehicle_unreachable').catch(() => {});
      await pushVehicleEvent('remote_command_unreachable', {
        commandId,
        reason: 'offline_non_critical',
        ttlMs: _ttlMs(row),
      }).catch(() => {});
      if (import.meta.env.DEV) {
        console.warn(`[RemoteCommand] Ulaşılamıyor (offline, non-critical):`, commandId);
      }
    }
    return;
  }

  const ctx = _ctxRef.current;
  if (!ctx) {
    await updateRemoteCommandStatus(commandId, 'failed', 'CommandContext not ready');
    return;
  }

  const intent = fromAIResponse(row, (row['intent'] as string | undefined) ?? 'Remote Command');

  if (!intent) {
    await updateRemoteCommandStatus(commandId, 'failed', 'Unknown intent');
    await pushVehicleEvent('remote_command_rejected', { commandId, row });
    return;
  }

  // ── Phase 2: EXECUTING ACK ───────────────────────────────────────────────
  await updateRemoteCommandStatus(commandId, 'executing');

  // Uzaktan komut bayrağı — commandExecutor güvenlik bariyerlerini bu flag'e göre tetikler
  const remoteCtx: CommandContext = { ...ctx, isRemote: true };
  const requiresAck = COMMANDS_REQUIRING_ACK.has(rowType ?? '') ||
                      COMMANDS_REQUIRING_ACK.has(intentType ?? '');

  try {
    await executeIntent(intent, remoteCtx);

    if (requiresAck) {
      // ── Phase 2b: PENDING_ACK — donanımdan onay bekle ─────────────────
      // Status 'executing' olarak kalır; ACK gelince veya timeout'ta sonuçlanır.
      // Telefon 'executing' görürken araç CAN bus yanıtı bekler.
      if (import.meta.env.DEV) {
        logInfo(`[RemoteCommand] Awaiting hardware ACK (${ACK_TIMEOUT_MS / 1000}s):`, commandId);
      }
      const acked = await _awaitHardwareAck(commandId);
      if (!acked) {
        // Donanım zamanında yanıt vermedi — telefona başarısız bildir
        const timeoutMsg = 'Hardware ACK timeout — donanım yanıt vermedi';
        await updateRemoteCommandStatus(commandId, 'failed', timeoutMsg);
        await pushVehicleEvent('remote_command_error', { commandId, error: timeoutMsg });
        return;
      }
    }

    // ── Phase 3: COMPLETED — hem intent hem ACK (varsa) onaylandı ─────────
    await updateRemoteCommandStatus(commandId, 'completed');
    await pushVehicleEvent('remote_command_completed', {
      commandId,
      intent: intentType ?? 'unknown',
      fromQueue,
      ackRequired: requiresAck,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // SafetyReject → 'rejected' statüsü; diğer hatalar → 'failed'
    const finalStatus = msg.startsWith('SafetyReject') ? 'rejected' : 'failed';
    _pendingAcks.get(commandId)?.resolve(false); // Bekleyen ACK varsa iptal et
    _pendingAcks.delete(commandId);
    await updateRemoteCommandStatus(commandId, finalStatus, msg);
    await pushVehicleEvent('remote_command_error', { commandId, error: msg, status: finalStatus });
  }
}

/* Yalnız `noUnusedLocals` içindir: fonksiyon DEĞERİ okunur, ÇAĞRILMAZ.
   `void f;` bir ifade deyimidir; `void f();` olsaydı yürütücü geri gelirdi.
   Guard testi tam olarak bu ayrımı kilitler. */
void _legacyExecuteCommandDisabled;

// ── Module state ──────────────────────────────────────────────────────────

let _active:  boolean         = false;
let _channel: RealtimeChannel | null = null;
/** Kanonik bağlantı aboneliğini söken thunk (eski pencere `online` olayı yerine). */
let _connectivityUnsub: (() => void) | null = null;

// ── "Ulaşılamıyor" — Çevrimdışı Komut Fetch ──────────────────────────────
//
// Araç çevrimdışıyken telefon `vehicle_commands` tablosuna komut ekler.
// Supabase Realtime o sırada araçta bağlı olmadığı için INSERT eventi teslim edilmez.
// Araç tekrar bağlandığında (SUBSCRIBED) 'pending' komutları DB'den çeker;
//   TTL geçerliyse işler, süresi dolmuşsa 'expired' olarak işaretler.
// Telefon 'expired' statüsünü okuyunca "Ulaşılamıyor" uyarısını gösterir.

async function _fetchMissedCommands(): Promise<void> {
  if (!_active) return;
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const identity = await getVehicleIdentity();
  if (!identity) return;

  // Yalnızca TTL penceresi içindeki pending komutları getir
  const cutoff = new Date(Date.now() - DEFAULT_TTL_MS).toISOString();
  const { data } = await supabase
    .from('vehicle_commands')
    .select('*')
    .eq('vehicle_id', identity.vehicleId)
    .eq('status', 'pending')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(20); // memory overflow koruması

  if (!data?.length) return;

  if (import.meta.env.DEV) {
    logInfo(`[RemoteCommand] Fetching ${data.length} missed command(s) after reconnect`);
  }

  for (const row of data) {
    await _processCommand(row as Record<string, unknown>).catch(() => {});
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function startRemoteCommands(): Promise<void> {
  if (_active) return;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  const identity = await getVehicleIdentity();
  if (!identity) return;

  const apiKey = await sensitiveKeyStore.get('veh_api_key' as const);
  if (!apiKey) return;

  _active = true;

  /* Kanonik bağlantı geri geldi → retry queue'yu boşalt + kaçırılan komutları çek.
     F7-B: tarayıcının `online` olay dinleyicisi KALDIRILDI — tarayıcı ipucu otorite
     değildir (§16) ve ikinci bir ağ gözlemcisi açılmaz (§29). Geçiş KENARI
     (izinsiz → izinli) eskisiyle aynı anlamı taşır. */
  let _wasAllowed = allowsConnectivity('BACKGROUND_SYNC');
  _connectivityUnsub = subscribeConnectivity(() => {
    const allowed = allowsConnectivity('BACKGROUND_SYNC');
    if (allowed && !_wasAllowed) {
      void _drainRetryQueue();
      void _fetchMissedCommands();
    }
    _wasAllowed = allowed;
  });

  // Başlangıçta izinliyse queue'yu hemen boşalt (restart recovery)
  if (allowsConnectivity('BACKGROUND_SYNC') && _retryQueue.length > 0) {
    setTimeout(() => { void _drainRetryQueue(); }, 500);
  }

  /* ── F0.2 · BU ABONELİK ARTIK YALNIZ TESLİMAT/DEFTER YOLUDUR ────────────
     Kanal KORUNDU ama tükettiği `_processCommand` artık YÜRÜTMEZ: yalnız
     çevrimdışı kritik komutu retry defterine yazar. Görev sözleşmesi bunu
     açıkça serbest bırakır — "realtime/polling/FCM taşıma olabilir, ama
     bağımsız fiziksel executor olamaz". */
  _channel = supabase
    .channel(`remote-commands:${identity.vehicleId}`)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'vehicle_commands',
        filter: `vehicle_id=eq.${identity.vehicleId}`,
      },
      (evt) => {
        if (!_active) return;
        const row = evt.new as Record<string, unknown>;
        _processCommand(row).catch(() => {});
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        if (import.meta.env.DEV) {
          logInfo('[RemoteCommand] Defter aboneliği — yürütme commandListener\'da. TTL:', DEFAULT_TTL_MS / 1000, 's');
        }
        void _fetchMissedCommands();
      }
    });
}

export function stopRemoteCommands(): void {
  _active = false;

  if (_connectivityUnsub) {
    _connectivityUnsub();
    _connectivityUnsub = null;
  }
  if (_channel) {
    _channel.unsubscribe();
    _channel = null;
  }
  _ctxRef.current = null;
  // RetryQueue kalıcı — stop sonrasında persist edilmeye devam eder
}
