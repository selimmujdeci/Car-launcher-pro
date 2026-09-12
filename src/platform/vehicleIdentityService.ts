/**
 * vehicleIdentityService — Android device identity + Supabase vehicle registration.
 *
 * Responsibilities:
 *   1. Generate/persist a stable deviceId (UUID stored encrypted)
 *   2. Register device with Supabase backend on first launch (idempotent)
 *   3. Store api_key securely after registration — never sent back again
 *   4. Generate/refresh 6-digit linking codes shown to the user
 *   5. Push realtime telemetry events (fire-and-forget, api_key auth)
 *
 * When VITE_SUPABASE_URL is not set → demo mode (mock codes, no network).
 */

import { Capacitor }              from '@capacitor/core';
import { sensitiveKeyStore }      from './sensitiveKeyStore';
import { connectivityService }    from './connectivityService';
import { CarLauncher }            from './nativePlugin';

const SK_DEVICE_ID  = 'veh_device_id'  as const;
const SK_API_KEY    = 'veh_api_key'    as const;
const SK_VEHICLE_ID = 'veh_vehicle_id' as const;

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const RPC_BASE          = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/rpc` : null;

/* ── Types ──────────────────────────────────────────────────── */

export interface VehicleIdentity {
  vehicleId: string;
  deviceId:  string;
}

export interface LinkingCodeInfo {
  code:      string;
  expiresAt: number; // epoch ms
}

/* ── Module state (in-memory cache) ────────────────────────── */

let _identity: VehicleIdentity | null = null;
let _apiKey:   string | null = null;

/* ── Internal helpers ───────────────────────────────────────── */

/**
 * Rastgele UUID v4 — KRİPTOGRAFİK kaynaktan.
 *
 * Eskiden `Math.random()` kullanılıyordu. Bu değer bir araç kaydını temsil eder
 * ve sunucuda `device_name` olarak aranır; tahmin edilebilir olması, bir
 * saldırganın var olan kayıtlara denk gelmesini kolaylaştırırdı.
 *
 * FAIL-SOFT: çok eski WebView'larda `crypto.getRandomValues` bulunmayabilir.
 * O durumda kimlik ÜRETİLEMEZ demek cihazı hiç açılamaz hâle getirirdi; eski
 * yola düşülür ve bu durum `getDeviceIdentityStatus()` ile GÖRÜNÜR kılınır —
 * sessizce zayıf rastgelelik kullanmak, kullanılmadığını sanmaktan kötüdür.
 */
let _weakRandomUsed = false;

function _uuid(): string {
  try {
    const g = globalThis.crypto;
    if (g && typeof g.getRandomValues === 'function') {
      const b = new Uint8Array(16);
      g.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;   // sürüm 4
      b[8] = (b[8] & 0x3f) | 0x80;   // varyant 10x
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
  } catch {
    /* aşağıdaki zayıf yola düşülür */
  }
  _weakRandomUsed = true;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function _mockCode(): LinkingCodeInfo {
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  return { code, expiresAt: Date.now() + 60_000 };
}

async function _rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) throw new Error('Supabase not configured');
  const res = await fetch(`${RPC_BASE}/${fn}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `RPC ${fn} failed`);
  return data;
}

/* ══════════════════════════════════════════════════════════════════════════
 * CİHAZ KİMLİĞİNİN KALICILIĞI — P0-001C
 *
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
 * `veh_device_id` rastgele üretilip `sensitiveKeyStore`a yazılıyordu. O depo
 * native tarafta EncryptedSharedPreferences'tır ve şifreleme anahtarı Android
 * Keystore'dadır: **uygulama kaldırılınca Keystore anahtarı da silinir**, depo
 * çözülemez hâle gelir. Reinstall sonrası cihaz kendini yeni sanıp yeni bir
 * UUID üretiyor, sunucu da onu YENİ BİR ARAÇ olarak açıyordu.
 * Üretim izi: 838 araç satırı · 822 tekil `device_name` · **837'si SAHİPSİZ**.
 *
 * ── NEDEN "YEDEKLE" DEĞİL, "TÜRET" ───────────────────────────────────────
 * Akla ilk gelen çözüm kimliği bir yedek dosyasına yazmaktır. Depoda böyle bir
 * katman zaten var (`deviceKeyBackupWrite` → paylaşımlı harici depolama) ama
 * oraya cihaz kimliği KOYULMADI, çünkü:
 *   · o dosya `/sdcard`'tadır ve şifreleme anahtarı SSAID'den türer — SSAID
 *     gizli değildir, yani dosya "kilitli" değil yalnızca "gözden uzak"tır;
 *   · bir yedek, kimliği KOPYALANABİLİR BİR VARLIĞA çevirir: kopyalayan kişi
 *     `register_vehicle` çağırıp o araç için taze eşleştirme kodu üretebilir.
 * Türetmede yazılan hiçbir şey yoktur → çalınacak dosya da yoktur.
 *
 * ── SIRA BAĞLAYICIDIR ────────────────────────────────────────────────────
 * ① SAKLI değer → varsa AYNEN korunur. Sahadaki cihazların kimliği DEĞİŞMEZ;
 *    bu kural olmasaydı bu düzeltmenin kendisi 838 aracın hepsini yeni araç
 *    açmaya zorlardı — düzeltmek istediği felaketin aynısı.
 * ② TÜRETİLMİŞ (SSAID) → yalnız saklı değer YOKKEN. Reinstall tam olarak bu
 *    daldan geçer ve aynı kimliği geri bulur.
 * ③ RASTGELE → SSAID de yoksa (web/demo, SSAID'i boş dönen ROM'lar).
 *
 * ── NE ÇÖZÜLMEZ ──────────────────────────────────────────────────────────
 * Bu, `veh_api_key`i geri getirmez — o HAM KİMLİK BİLGİSİDİR ve bilinçli
 * olarak yalnız Keystore'da tutulur. Reinstall sonrası cihaz kendini doğru
 * araçla eşleştirir ama anahtarsız kalır. Kazanç yine de büyüktür: sunucu
 * kirlenmez ve sahiplik korunur. Anahtarın geri kazanımı sunucu tarafında bir
 * yeniden-provisioning yolu ister (P0-001D/K) ve bu turun kapsamı DIŞINDADIR.
 * Durum uydurulmaz, `getDeviceIdentityStatus()` ile GÖRÜNÜR kılınır.
 * ══════════════════════════════════════════════════════════════════════════ */

export type DeviceIdSource =
  | 'STORED'           // güvenli depodan okundu (normal çalışma)
  | 'DERIVED_SSAID'    // SSAID'den türetildi (ilk kurulum ya da reinstall)
  | 'RANDOM_FALLBACK'  // SSAID yok → rastgele üretildi
  | 'UNKNOWN';         // henüz hiç çözülmedi

let _deviceIdSource: DeviceIdSource = 'UNKNOWN';

/** Sunucuda kayıtlı ama YEREL ANAHTAR YOK — reinstall'ın çözülemeyen yarısı. */
let _registeredWithoutKey = false;

/**
 * SSAID'den türetilmiş kararlı kimlik. Ham SSAID JS'e ÇIKMAZ; native taraf
 * yalnız `sha256(salt|ssaid)` döner.
 *
 * Eski APK'larda bu native metot yoktur → çağrı hata verir → `null` döner ve
 * çağıran rastgele yola düşer (davranış bugünküyle aynı kalır).
 */
async function _deriveStableDeviceId(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const res = await CarLauncher.getStableDeviceId();
    const id = res?.deviceId;
    /* Biçim DOĞRULANIR: native taraf bozuk/kısa bir değer dönerse onu kimlik
       diye kabul etmek, birden çok cihazı aynı araca çökertebilir. */
    return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function _getOrCreateDeviceId(): Promise<string> {
  // ① SAKLI — sahadaki cihazlar için TEK doğru cevap.
  const stored = await sensitiveKeyStore.get(SK_DEVICE_ID);
  if (stored) {
    _deviceIdSource = 'STORED';
    return stored;
  }

  // ② TÜRETİLMİŞ — reinstall bu daldan geçer ve aynı kimliği geri bulur.
  const derived = await _deriveStableDeviceId();
  if (derived) {
    await sensitiveKeyStore.set(SK_DEVICE_ID, derived);
    _deviceIdSource = 'DERIVED_SSAID';
    return derived;
  }

  // ③ RASTGELE — son çare. Bu dalda reinstall hâlâ yeni araç açar.
  const id = _uuid();
  await sensitiveKeyStore.set(SK_DEVICE_ID, id);
  _deviceIdSource = 'RANDOM_FALLBACK';
  return id;
}

export interface DeviceIdentityStatus {
  /** Kimliğin NEREDEN geldiği — reinstall dayanıklılığının tek dürüst ölçüsü. */
  source: DeviceIdSource;
  /** true → kimlik reinstall'a dayanıklı (saklı ya da türetilebilir). */
  reinstallSafe: boolean;
  /** true → sunucu aracı tanıyor ama yerel anahtar yok (P0-001D/K bekliyor). */
  registeredWithoutKey: boolean;
  /** true → `crypto.getRandomValues` yoktu, zayıf rastgelelik kullanıldı. */
  weakRandomUsed: boolean;
}

/**
 * Kimlik katmanının durumu — senkron, ucuz, yan etkisiz.
 * Bilinmeyen alan UYDURULMAZ: kimlik henüz çözülmediyse `source: 'UNKNOWN'`
 * döner ve `reinstallSafe` false olur ("bilmiyoruz" ≠ "güvenli").
 */
export function getDeviceIdentityStatus(): DeviceIdentityStatus {
  return {
    source:               _deviceIdSource,
    reinstallSafe:        _deviceIdSource === 'STORED' || _deviceIdSource === 'DERIVED_SSAID',
    registeredWithoutKey: _registeredWithoutKey,
    weakRandomUsed:       _weakRandomUsed,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetDeviceIdentityStateForTest(): void {
  _deviceIdSource = 'UNKNOWN';
  _registeredWithoutKey = false;
  _weakRandomUsed = false;
  _identity = null;
  _apiKey = null;
}

/* ── Public API ─────────────────────────────────────────────── */

/**
 * Returns a stable anonymous device identifier for community features
 * (radar reports, traffic data). Does NOT require vehicle registration —
 * the ID is created and persisted on first call.
 *
 * Used by radarCommunityService to:
 *   a) Attribute outgoing reports (spam prevention on the server)
 *   b) Suppress Realtime echoes of our own inserts
 */
export async function getReporterDeviceId(): Promise<string> {
  return _getOrCreateDeviceId();
}

/** Returns cached identity from SecureStorage, or null if not yet registered. */
export async function getVehicleIdentity(): Promise<VehicleIdentity | null> {
  if (_identity) return _identity;
  const [vehicleId, deviceId] = await Promise.all([
    sensitiveKeyStore.get(SK_VEHICLE_ID),
    sensitiveKeyStore.get(SK_DEVICE_ID),
  ]);
  if (vehicleId && deviceId) {
    _identity = { vehicleId, deviceId };
    return _identity;
  }
  return null;
}

/**
 * Register this device with the backend (idempotent).
 * Returns a fresh 6-digit linking code to display to the user (60s TTL).
 * Call once on first launch; call again whenever the user asks to re-link.
 */
export async function registerVehicle(name = 'Araç'): Promise<LinkingCodeInfo> {
  const deviceId = await _getOrCreateDeviceId();

  if (!RPC_BASE) return _mockCode();

  try {
    const data = await _rpc('register_vehicle', { p_device_id: deviceId, p_name: name }) as {
      vehicle_id:           string;
      api_key?:             string;
      /** P0-001A: sunucu bu cihazı ZATEN tanıyor → ham anahtar DÖNMEZ. */
      already_provisioned?: boolean;
      linking_code?:        string;
      expires_at?:          string;
    };

    await sensitiveKeyStore.set(SK_VEHICLE_ID, data.vehicle_id);
    if (data.api_key) {
      await sensitiveKeyStore.set(SK_API_KEY, data.api_key);
      _apiKey = data.api_key;
      _registeredWithoutKey = false;
    } else if (data.already_provisioned === true) {
      /* Sunucu aracı tanıyor ama ham anahtarı bir daha VERMEZ (P0-001A).
         Yerelde de anahtar yoksa cihaz "kayıtlı ama anahtarsız"dır: doğru
         araca bağlıdır, yeni araç AÇMAZ, ama telemetri gönderemez.
         Bu durum SESSİZ BIRAKILMAZ — ölçülür ve raporlanır. */
      _registeredWithoutKey = !(await isDevicePaired());
    }
    _identity = { vehicleId: data.vehicle_id, deviceId };

    const rawCode = (data.linking_code ?? '').trim();
    const hasCode = rawCode.length === 6;
    return {
      code:      hasCode ? rawCode : '',
      expiresAt:
        hasCode && data.expires_at
          ? new Date(data.expires_at).getTime()
          : hasCode
            ? Date.now() + 60_000
            : 0,
    };
  } catch {
    // Sunucu ulaşılamıyor veya RPC hatası → çevrimdışı mod, mock kod göster
    return _mockCode();
  }
}

/**
 * Request a new linking code (previous one expired or already used).
 * Authenticated by the stored api_key — no user JWT required.
 */
export async function refreshLinkingCode(): Promise<LinkingCodeInfo> {
  if (!RPC_BASE) return _mockCode();

  const apiKey = _apiKey ?? (await sensitiveKeyStore.get(SK_API_KEY));
  if (!apiKey) return _mockCode();

  try {
    const data = await _rpc('refresh_linking_code', { p_api_key: apiKey }) as {
      linking_code: string;
      expires_at:   string;
    };
    return {
      code:      data.linking_code,
      expiresAt: new Date(data.expires_at).getTime(),
    };
  } catch {
    return _mockCode();
  }
}

/**
 * Remote komut işlenince durumu günceller. Fire-and-forget — hatalar sessizce yutulur.
 * Spec §3.4: push_vehicle_event ile aynı api_key auth pattern'ini kullanır.
 */
/**
 * Komut yaşam döngüsü durumları:
 *   accepted  : araç komutu aldı, sıraya koydu
 *   executing : executeIntent() başladı
 *   completed : komut başarıyla icra edildi (kapı kilitlendi vb.)
 *   failed    : yürütme hatası — error mesajı ile birlikte
 *   rejected  : güvenlik reddi (sürüş sırasında lock/unlock vb.)
 */
export type CommandLifecycleStatus =
  | 'received'   // araç komutu aldı — TTL kontrolünden önce
  | 'accepted'   // (legacy alias — received ile eş anlamlı, backward compat)
  | 'executing'  // executeIntent() başladı
  | 'completed'  // komut başarıyla icra edildi
  | 'expired'    // TTL aşıldı, komut çalıştırılmadı
  | 'queued'     // çevrimdışı — kritik komut retry kuyruğunda bekliyor
  | 'failed'     // yürütme hatası
  | 'rejected';  // güvenlik reddi (sürüş sırasında lock/unlock vb.)

export async function updateRemoteCommandStatus(
  commandId: string,
  status:    CommandLifecycleStatus,
  error?:    string,
  /**
   * Araç tarafının ÖLÇÜM sonucu (DTC listesi, voltaj…). YALNIZ ölçen komutlarda
   * doludur; verilmezse `result` kolonu OLDUĞU GİBİ kalır (migration 070'te
   * `coalesce(p_result, result)`) — sahte `{}` yazılmaz, "okunmadı ≠ boş".
   */
  result?:   Record<string, unknown>,
): Promise<void> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) return;
  const apiKey = _apiKey ?? (await sensitiveKeyStore.get(SK_API_KEY));
  if (!apiKey) return;

  const now = new Date().toISOString();

  // Durum → timestamp eşlemesi
  const body: Record<string, unknown> = {
    p_api_key:    apiKey,
    p_command_id: commandId,
    p_status:     status,
  };
  if (status === 'received' || status === 'accepted')  body.p_accepted_at  = now;
  if (status === 'executing')                          body.p_executed_at  = now;
  if (status === 'completed' || status === 'failed' ||
      status === 'rejected'  || status === 'expired')  body.p_finished_at  = now;
  if (error)                                          body.p_error        = error;
  if (result !== undefined)                           body.p_result       = result;

  // Yüksek öncelik — at-least-once garantisi (connectivityService kuyruğu)
  await connectivityService.enqueue(
    `${RPC_BASE}/update_command_status`,
    'POST',
    { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body,
    'high',
    `cmd_status_${commandId}`,  // Benzersiz dedup key: aynı komut birden fazla kez queue'a girmez
  );
}

/* ── Event pipeline görünürlüğü (saha hatası 2026-06-11) ──────────────────
 * Eskiden env/api_key yokken pushVehicleEvent SESSİZCE return ediyordu →
 * tüm voice_diag/system_health/obd_diag eventleri hiçbir iz bırakmadan
 * kayboluyor, admin tablosu boş kalıyor, neden anlaşılamıyordu. */

const DROP_WARN_THROTTLE_MS = 60_000;
let _dropWarnAt        = 0;    // son console.warn zamanı (Date.now)
let _droppedNoKeyCount = 0;    // bu oturumda yutulan event sayısı
let _lastDropAt: number | null = null;

export interface VehicleEventPipelineStatus {
  /** VITE_SUPABASE_URL/ANON_KEY build'e gömülü mü (build-time gate) */
  configured: boolean;
  /** Eşlenmemiş cihaz yüzünden bu oturumda düşürülen event sayısı */
  droppedNoKeyCount: number;
  /** Son düşürme zamanı (Date.now) — null = hiç düşmedi */
  lastDropAt: number | null;
}

/** Dev Inspector / tanı ekranları için pipeline durumu (senkron, ucuz). */
export function getVehicleEventPipelineStatus(): VehicleEventPipelineStatus {
  return {
    configured:        !!(RPC_BASE && SUPABASE_ANON_KEY),
    droppedNoKeyCount: _droppedNoKeyCount,
    lastDropAt:        _lastDropAt,
  };
}

/** Cihaz backend'e eşlenmiş mi (veh_api_key mevcut mu). */
export async function isDevicePaired(): Promise<boolean> {
  if (_apiKey) return true;
  try {
    return !!(await sensitiveKeyStore.get(SK_API_KEY));
  } catch {
    return false;
  }
}

/* ── Otomatik eşleştirme (saha veri toplama fazı) ─────────────────────────
 * SORUN: Eşlenmemiş cihaz hiçbir tanı/telemetri gönderemiyordu — "Tanı
 * Gönder" not_paired dönüyor, system_health/obd_diag/critical_error api_key
 * yok diye düşüyor, admin tablosu boş kalıyordu. Geliştirme/saha fazında
 * kullanıcı elle "Mobil Bağlantı"dan eşleştirmediği için uzak tanı ölüydü.
 *
 * ÇÖZÜM: boot'ta bir kez sessiz self-pair. register_vehicle RPC zaten
 * idempotent — cihaz api_key alınca MEVCUT hat (pushVehicleEvent → RPC →
 * vehicle_events) hiçbir sunucu değişikliği olmadan uçtan uca akar. */

/** Boot-time otomatik eşleştirme sadece bir kez denensin (idempotent guard). */
let _autoPairTried = false;

/**
 * Cihaz henüz eşlenmemişse (veh_api_key yok) sessizce register_vehicle
 * çağırıp api_key'i saklar. Linking code GÖSTERMEZ — kullanıcı akışı yok.
 *
 *  - Supabase yapılandırılmamışsa (BYOK/env yok) → no-op (müşteri telemetri
 *    istemiyorsa env'i boş bırakır; bu fonksiyon zorlamaz).
 *  - Zaten eşliyse → dokunmaz, true döner.
 *  - Offline/RPC hatası → false; _autoPairTried sıfırlanır, sonraki boot dener.
 *
 * Dönüş: eşleşme mevcut/sağlandıysa true.
 */
export async function ensureDeviceRegistered(): Promise<boolean> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) return false; // BYOK yok → no-op
  if (await isDevicePaired()) return true;           // zaten eşli
  if (_autoPairTried) return false;                  // bu oturumda bir kez dene
  _autoPairTried = true;

  try {
    await registerVehicle();                         // idempotent; api_key saklanır
    const paired = await isDevicePaired();
    if (!paired) _autoPairTried = false;             // api_key gelmedi → tekrar denenebilir
    return paired;
  } catch {
    _autoPairTried = false;                          // offline → sonraki boot yeniden dener
    return false;
  }
}

/** Düşen event'i say + throttle'lı uyar (60sn'de 1 — logcat spam'i yok). */
function _noteDroppedEvent(reason: string, type: string): void {
  _droppedNoKeyCount++;
  _lastDropAt = Date.now();
  if (Date.now() - _dropWarnAt < DROP_WARN_THROTTLE_MS) return;
  _dropWarnAt = Date.now();
  console.warn(`[VehicleEvent] ${reason} — event düşürüldü: ${type} ` +
    `(toplam ${_droppedNoKeyCount}). Ayarlar → Mobil Bağlantı'dan cihazı eşleştirin.`);
}

/** @internal — testler arası izolasyon. */
export function _resetVehicleEventGuardForTest(): void {
  _dropWarnAt = 0;
  _droppedNoKeyCount = 0;
  _lastDropAt = null;
}

/**
 * Push a telemetry event to Supabase.
 * Artık fire-and-forget değil — connectivityService kuyruğu aracılığıyla at-least-once.
 * Gönderilemeyen event SESSİZCE YUTULMAZ: sayaç + throttle'lı console.warn.
 */
export async function pushVehicleEvent(
  type: string,
  payload: Record<string, unknown>,
  reportId?: string,
): Promise<string | null> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) {
    _noteDroppedEvent('Supabase env eksik (VITE_SUPABASE_URL/ANON_KEY build\'e gömülmemiş)', type);
    return null;
  }
  const apiKey = _apiKey ?? (await sensitiveKeyStore.get(SK_API_KEY));
  if (!apiKey) {
    _noteDroppedEvent('missing veh_api_key; device not paired', type);
    return null;
  }

  // Alarm/kaza eventi kritik — önce işlenir
  const isCritical = type === 'alarm' || type === 'crash' || type === 'sos';
  const priority   = isCritical ? 'critical' : 'normal';

  // reportId verilmişse teslimat defterine bağlanır (kullanıcı-tetikli raporlar);
  // verilmezse (bulk telemetri) izlenmez — kuyruk davranışı aynı. Dönüş: kuyruk id'si.
  return connectivityService.enqueue(
    `${RPC_BASE}/push_vehicle_event`,
    'POST',
    { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    { p_api_key: apiKey, p_type: type, p_payload: payload },
    priority,
    'telemetry',
    reportId,
  );
}

/**
 * SUNUCU YANITI GEREKEN RPC ÇAĞRISI (kimlik bildirimi için).
 *
 * `pushVehicleEvent` at-least-once kuyruğa yazar ve KUYRUK ID'si döner —
 * sunucunun kararını (çakışma / güven puanı) taşımaz. Kimlik bildirimi ise
 * sunucunun hükmünü okumak zorundadır, bu yüzden doğrudan çağrılır.
 *
 * GÜVENLİK:
 *   · `api_key` YALNIZ istek gövdesine konur; loglanmaz, hataya sızdırılmaz.
 *   · Yanıt gövdesi ham olarak döner; çağıran tarafta daraltılır.
 *   · Hata durumunda `null` — çağıran fail-soft davranır.
 *
 * NADİR ÇAĞRI: kimlik değişimi seyrektir, hot-path'e GİRMEZ.
 */
export async function callVehicleRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!RPC_BASE || !SUPABASE_ANON_KEY) return null;
  const apiKey = _apiKey ?? (await sensitiveKeyStore.get(SK_API_KEY));
  if (!apiKey) return null;

  try {
    const res = await fetch(`${RPC_BASE}/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ p_api_key: apiKey, ...args }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    /* Ağ hatası — gizli anahtar İÇEREBİLECEĞİ için hata nesnesi LOGLANMAZ. */
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * ELM327 Komut Sekansları — OBD2 / UDS araç kontrol placeholder'ları
 *
 * ELM327 adapter üzerinden araç kontrolü iki katmanda çalışır:
 *   1. Standart OBD2 (J1979 Mode 01): rpm, speed, coolant — evrensel
 *   2. UDS (ISO 14229-1) via broadcast 7DF: lock/unlock — manufacturer-specific
 *
 * lock/unlock sekansları PLACEHOLDER'dır. Gerçek araç entegrasyonu için
 * OEM DBC / ODX veritabanından InputOutputControlByIdentifier (2Fh)
 * parametreleri alınıp override edilmelidir.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Tek bir ELM327 komut sekansının metadata'sı */
export interface Elm327Sequence {
  /** Adapter'a sırayla gönderilecek AT veya OBD2 hex komutları */
  commands:  readonly string[];
  /**
   * true → her komutun yanıtı 'OK' içermeli (AT komutları için).
   * false → numeric response beklenir (OBD2 PID yanıtları).
   */
  expectOk:  boolean;
  /** Komut başına maksimum bekleme süresi (ms) */
  timeoutMs: number;
}

export type Elm327CommandRole =
  | 'init'     // adapter sıfırlama + protokol kurulumu
  | 'rpm'      // motor devir sayısı (OBD2 PID 01 0C)
  | 'speed'    // araç hızı (OBD2 PID 01 0D)
  | 'coolant'  // soğutucu sıcaklığı (OBD2 PID 01 05)
  | 'lock'     // kapı kilitleme (UDS 2Fh — manufacturer-specific)
  | 'unlock';  // kapı açma   (UDS 2Fh — manufacturer-specific)

/**
 * Uygulama geneli ELM327 sekans tablosu.
 *
 * Komut formatları:
 *   AT*  → ELM327 konfigürasyon komutu (adapter kendi işler)
 *   010C → OBD2: mode 01 (show current data), PID 0Ch (Engine RPM)
 *   7DF  → J1979 functional broadcast CAN ID (tüm ECU'lar yanıtlar)
 *   2F   → UDS Service: InputOutputControlByIdentifier (ISO 14229-1 §11)
 *   10   → UDS Service: DiagnosticSessionControl (ISO 14229-1 §9.4)
 */
export const ELM327_SEQUENCES: Readonly<Record<Elm327CommandRole, Elm327Sequence>> = {

  // ── Adapter kurulumu ────────────────────────────────────────────────────
  // ATZ   : full reset (ELM327 §4.1)
  // ATE0  : echo off — yanıt gürültüsünü azaltır
  // ATL0  : line feeds off
  // ATSP0 : auto-detect protocol (ATSP 0 = J1979 otomatik)
  // ATH1  : headers on — CAN ID'yi yanıta ekle
  // ATCAF1: CAN auto-format on — 8-byte CAN frame'i OBD2 biçiminde gönder
  init: {
    commands:  ['ATZ', 'ATE0', 'ATL0', 'ATSP0', 'ATH1', 'ATCAF1'],
    expectOk:  true,
    timeoutMs: 1000,
  },

  // ── Standart OBD2 PID'leri (J1979 / ISO 15031-5) ───────────────────────
  // Format: <mode_hex><pid_hex> — boşluksuz
  // Yanıt: 4X <pid> <byte_A> [<byte_B>] — X = mode+0x40
  rpm: {
    commands:  ['010C'], // Motor RPM: (byteA * 256 + byteB) / 4
    expectOk:  false,
    timeoutMs: 500,
  },
  speed: {
    commands:  ['010D'], // Araç hızı km/h: byteA
    expectOk:  false,
    timeoutMs: 500,
  },
  coolant: {
    commands:  ['0105'], // Soğutucu sıcaklığı: byteA - 40 (°C)
    expectOk:  false,
    timeoutMs: 500,
  },

  // ── Kapı kilidi — ISO 14229-1 UDS placeholder ──────────────────────────
  // 1. AT SH 7DF   : header = J1979 functional broadcast (tüm ECU'lar)
  // 2. 02 10 03    : DiagnosticSessionControl → extendedDiagnosticSession
  //                  (bazı ECU'lar 2Fh için extended session gerektirir)
  // 3. 04 2F 20 03 01 : InputOutputControlByIdentifier
  //                     dataIdentifier=0x2003 (kapı kontrol — OEM-specific)
  //                     controlParameter=0x03 shortTermAdjustment
  //                     controlState=0x01 LOCKED
  // 4. 02 10 01    : DiagnosticSessionControl → defaultSession (oturumu kapat)
  //
  // ⚠ BU KOMUTLAR PLACEHOLDER'DIR. Gerçek değerler OEM ODX/DBC'den alınır.
  lock: {
    commands:  ['AT SH 7DF', '02 10 03', '04 2F 20 03 01', '02 10 01'],
    expectOk:  false,
    timeoutMs: 500,
  },
  unlock: {
    commands:  ['AT SH 7DF', '02 10 03', '04 2F 20 03 00', '02 10 01'],
    expectOk:  false,
    timeoutMs: 500,
  },
} as const;

/**
 * Belirtilen rol için ELM327 sekansını döndürür.
 * İleride araç VIN'ine göre manufacturer-specific override burada yapılır.
 */
export function getElm327Sequence(role: Elm327CommandRole): Elm327Sequence {
  return ELM327_SEQUENCES[role];
}
