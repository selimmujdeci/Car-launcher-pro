/**
 * commandListener.ts — Launcher Realtime Komut Dinleyici
 *
 * Automotive Grade:
 * - Zero-Leak:        _alive flag ile async connect/disconnect race önlenir
 * - Idempotency:      executedIds (command ID bazlı) ile aynı komut iki kez çalışmaz
 * - TTL Guard:        5 dakikadan eski komutları reddeder
 * - Retry + Backoff:  max 3 retry, exponential backoff (1s → 2s → 4s)
 * - Tehlikeli komut:  sürüş sırasında lock/unlock reddi (>5 km/h)
 * - Offline recovery: reconnect'te pending komutları FIFO sırayla işler
 * - Push notify:      tamamlanan komutlar için Edge Function tetiklenir
 */

import {
  isE2EPayload, decryptE2EPayload, getCarPrivateKey, loadOrCreateDeviceKey,
  isEncryptedPayload, decryptPayload,
} from './commandCrypto';
import { sensitiveKeyStore }                       from './sensitiveKeyStore';
import { connectivityService }                     from './connectivityService';
import { executeMcuCommand, checkCrossChannelNonceReplay } from './nativeCommandBridge';
import { executeReadDtc, executeReadVoltage, executeClearDtc } from './remoteDiagnosticCommands';
import { applySpeedAlertConfig, getSpeedAlertConfig } from './speedAlertRuntime';
import { logInfo }                                 from './debug';
import { useLayoutStore }                          from '../store/useLayoutStore';
import { applyIncomingThemeManifest, applyThemeManifest } from './theme/themeRuntime';
import { migrateLegacyThemeVars, THEME_BASE_IDS, type ThemeBaseId } from './theme/themeManifest';
import { useCarTheme, baseOf } from '../store/useCarTheme';

/** Araçta o an geçerli baz tema (manifest desteği olmayan legacy tema → 'expedition'). */
function currentCarThemeBase(): ThemeBaseId {
  try {
    const b = baseOf(useCarTheme.getState().theme);
    return (THEME_BASE_IDS as readonly string[]).includes(b) ? (b as ThemeBaseId) : 'expedition';
  } catch {
    return 'expedition';
  }
}

// buildNavIntent — website/ fork bağımlılığından koparıldı; ana app içinde (navIntent.ts).
import { buildNavIntent } from './navIntent';

// ── Supabase client — statik import (dynamic import INEFFECTIVE_DYNAMIC_IMPORT uyarısını tetikler)
// remoteCommandService ve weatherService zaten statik import yaptığı için
// bu modül de aynı chunk'a düşmeli.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';

function getSupabase() {
  return getSupabaseClient();
}

// ── Sabitler ─────────────────────────────────────────────────────────────────

const MAX_RETRY         = 3;
const RECONNECT_DELAY   = 3_000;   // ms — bağlantı kopunca bekleme
const PUSH_EDGE_FN_URL  = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-notify`
  : null;

// ── Tipler ────────────────────────────────────────────────────────────────────

export type CommandType =
  | 'lock' | 'unlock' | 'horn' | 'alarm_on' | 'alarm_off'
  | 'lights_on' | 'route_send' | 'navigation_start' | 'theme_change' | 'layout_change'
  // Teşhis komutları (2026-08-14): PWA bunları ÖNCEDEN gönderiyordu ama araç
  // tarafında tip hiç tanımlı değildi → `default: rejected`. Ölü uç kapatıldı.
  | 'read_dtc' | 'clear_dtc' | 'read_voltage'
  // Hız uyarısı eşiği (2026-08-14): aynı ölü uç — telefon "Kaydedildi ✓" diyordu
  // ama ayar araca hiç ulaşmıyordu.
  | 'set_speed_alert';

interface VehicleCommand {
  id:              string;
  vehicle_id:      string;
  type:            CommandType;
  payload:         Record<string, unknown>;
  status:          string;
  nonce:           string;
  ttl:             string;
  created_at:      string;
  retry_count?:    number;
  last_attempt_at?: string | null;
  error_reason?:   string | null;
}

// ── Tehlikeli komut koruması ──────────────────────────────────────────────────

const DANGEROUS_WHILE_MOVING: CommandType[] = ['lock', 'unlock'];
const SPEED_THRESHOLD_KMH = 5;

// Fiziksel (MCU/CAN) komutlar — yalnız E2E ile gelmelidir (CommandService.java MCU_COMMANDS ile birebir).
const MCU_COMMANDS: CommandType[] = ['lock', 'unlock', 'horn', 'alarm_on', 'alarm_off', 'lights_on'];

/**
 * E2E şifreleme ZORUNLU olan komutlar. MCU listesi native tarafla birebir eşleşmek
 * zorunda olduğu için genişletilmez; yıkıcı teşhis yazması (`clear_dtc`) buraya
 * eklenir — ECU'dan kod silmek fiziksel komut kadar geri döndürülemezdir.
 */
const E2E_REQUIRED_COMMANDS: CommandType[] = [...MCU_COMMANDS, 'clear_dtc'];

/**
 * Hız ölçümünün geçerli sayıldığı en uzun yaş. Bundan eskisi **ölçüm değil,
 * hatıradır**: OBD koptuktan sonra donmuş "0 km/h" ile kapı açık tutulursa
 * araç 100 km/h giderken uzaktan kilit açılabilirdi (kütük #574'ün ikinci ucu).
 *
 * 10 s: ürünün en yavaş hız kaynağı olan OBD'nin sahada ölçülmüş kadansı
 * ~4,3 s'tir (kütük #549) — iki kaçırılmış paket hâlâ tolere edilir, üçüncüsü
 * "bilinmiyor" der.
 */
const SPEED_MAX_AGE_MS = 10_000;

/**
 * Son ölçüm — **`null` = hiç ölçülmedi**. Eskiden `0` ile başlıyordu ve bu
 * sahte sıfır "araç duruyor" anlamına geliyordu; ölçüm hiç gelmese bile kapı
 * kendini beslenmiş sanıyordu.
 */
let currentSpeedKmh: number | null = null;
let currentSpeedAtMs = 0;

/**
 * Kapının hız otoritesini besler. İKİ besleyicisi vardır (füzyon hız akışı ve
 * yedek doğrudan OBD akışı), bu yüzden **eski damgalı örnek taze örneği
 * EZEMEZ** — yoksa yedek kaynak, birincil kaynağın yeni ölçümünü geri alırdı.
 */
export function updateCurrentSpeed(speedKmh: number, atMs: number = Date.now()): void {
  if (currentSpeedKmh !== null && atMs < currentSpeedAtMs) return;
  currentSpeedKmh = speedKmh;
  currentSpeedAtMs = atMs;
}

/** Sürüş güvenliği kapısının üç hükmü — "bilinmiyor" ayrı bir sonuçtur. */
export type MovingGateVerdict = 'ALLOW' | 'BLOCK' | 'SPEED_UNKNOWN';

/**
 * Kapı hükmü — SAF (girdiler dışarıdan; `Date.now` · global durum YOK).
 *
 * `SPEED_UNKNOWN` bilinçli olarak `BLOCK` DEĞİLDİR: kapalı otoparkta (GPS yok,
 * kontak kapalı → OBD yok) kullanıcının aracını uzaktan açamaması ürünü kırardı.
 * Ama bu kabul **kanıtsızdır** ve öyle sayılır: ayrı sayaçla defterlenir ve
 * CAROS LAB'da görünür — "güvenlik kapısı çalışıyor" iddiası ÜRETİLMEZ.
 */
export function judgeMovingGate(
  isDangerous: boolean,
  speedKmh:    number | null,
  ageMs:       number | null,
  maxAgeMs:    number,
  thresholdKmh: number,
): MovingGateVerdict {
  if (!isDangerous) return 'ALLOW';
  if (speedKmh === null || ageMs === null || !Number.isFinite(speedKmh)) return 'SPEED_UNKNOWN';
  if (ageMs > maxAgeMs) return 'SPEED_UNKNOWN';
  return speedKmh > thresholdKmh ? 'BLOCK' : 'ALLOW';
}

function movingGateVerdict(type: CommandType, nowMs: number): MovingGateVerdict {
  return judgeMovingGate(
    DANGEROUS_WHILE_MOVING.includes(type),
    currentSpeedKmh,
    currentSpeedKmh === null ? null : nowMs - currentSpeedAtMs,
    SPEED_MAX_AGE_MS,
    SPEED_THRESHOLD_KMH,
  );
}

/** Hız kapısının salt-okunur durumu (CAROS LAB). Ölçüm yoksa `null` alanlar. */
export interface SpeedGateState {
  readonly lastSpeedKmh: number | null;
  readonly lastAtMs:     number | null;
  readonly maxAgeMs:     number;
  readonly thresholdKmh: number;
}

export function getSpeedGateState(): SpeedGateState {
  return {
    lastSpeedKmh: currentSpeedKmh,
    lastAtMs:     currentSpeedKmh === null ? null : currentSpeedAtMs,
    maxAgeMs:     SPEED_MAX_AGE_MS,
    thresholdKmh: SPEED_THRESHOLD_KMH,
  };
}

// ── Executor ─────────────────────────────────────────────────────────────────

/* ── Kanıt defteri (CAROS LAB gözlemi) ───────────────────────────────────────
 *
 * ZORUNLU GÖZLEMLENEBİLİRLİK (CLAUDE.md): "gözlemlenemeyen özellik tamamlanmış
 * değildir." Uzak komut zinciri bugüne dek HİÇ gözlenemiyordu — bir komut
 * çalışmadığında "araç almadı mı · reddetti mi · şifre çözülemedi mi · tip
 * bilinmiyor mu" AYIRT EDİLEMİYORDU.
 *
 * GİZLİLİK (kural 6): payload · nonce · api_key · komut kimliği · araç kimliği ·
 * koordinat BURAYA GİRMEZ. Yalnız SAYILAR, komut TİPİ ve zaman damgaları tutulur.
 * Sayaçlar doyar (saturating) — sınırsız büyüme yok.
 */

export interface CommandEvidence {
  /** Realtime kanalından alınan komut sayısı. */
  received:        number;
  completed:       number;
  rejected:        number;
  failed:          number;
  /** E2E şifre çözme/eksik şifreleme nedeniyle REDDEDİLENLER (güvenlik kapısı). */
  cryptoFailed:    number;
  /** Bilinmeyen komut tipi — DB tipi ile ürün tipi ayrışmasının doğrudan izi. */
  unknownType:     number;
  /** Sürüş güvenliği kapısı (>5 km/h lock/unlock) kaç kez devreye girdi. */
  movingBlocked:   number;
  /**
   * Tehlikeli komutun TAZE hız kanıtı OLMADAN kabul edildiği durumlar.
   * Bu sayaç sıfırdan büyükse "sürüş güvenliği kapısı korudu" DENEMEZ —
   * o komutlar kapıdan değil, kapının körlüğünden geçmiştir.
   */
  movingUnverified: number;
  /** TTL aşımıyla düşen komutlar. */
  ttlExpired:      number;
  /** Retry sayısı (toplam yeniden deneme). */
  retries:         number;
  /** Son işlenen komutun TİPİ (kimliği DEĞİL) ve sonucu. */
  lastType:        string | null;
  lastOutcome:     string | null;
  /** Son işlem anı (epoch ms) — `null` = hiç komut işlenmedi. */
  lastAt:          number | null;
}

const MAX_COUNT = 9_999_999;
const _evidence: CommandEvidence = {
  received: 0, completed: 0, rejected: 0, failed: 0, cryptoFailed: 0,
  unknownType: 0, movingBlocked: 0, movingUnverified: 0, ttlExpired: 0, retries: 0,
  lastType: null, lastOutcome: null, lastAt: null,
};

function bump(k: keyof CommandEvidence): void {
  const v = _evidence[k];
  if (typeof v === 'number' && v < MAX_COUNT) (_evidence[k] as number) = v + 1;
}

/** Salt-okunur kopya — LAB bu nesneyi MUTASYONA UĞRATAMAZ. */
export function getCommandEvidence(): CommandEvidence {
  return { ..._evidence };
}

/** Yalnız test içindir. */
export function _resetCommandEvidenceForTest(): void {
  Object.assign(_evidence, {
    received: 0, completed: 0, rejected: 0, failed: 0, cryptoFailed: 0,
    unknownType: 0, movingBlocked: 0, movingUnverified: 0, ttlExpired: 0, retries: 0,
    lastType: null, lastOutcome: null, lastAt: null,
  });
}

/**
 * Yürütme sonucu. `result` yalnız ÖLÇÜM YAPAN komutlarda doludur (teşhis) ve
 * `vehicle_commands.result` kolonuna yazılır — telefon onu okur. `reason`,
 * genel gerekçe metnini komuta özel gerçek nedenle DEĞİŞTİRİR (fail-closed:
 * yoksa eski davranış birebir korunur).
 */
type ExecResult = {
  outcome: 'completed' | 'rejected' | 'failed' | 'crypto_failed';
  result?: Record<string, unknown>;
  reason?: string;
};

async function executeCommand(cmd: VehicleCommand): Promise<ExecResult> {
  let payload = cmd.payload;

  // ── C1 fix: Kritik (MCU/CAN) komut E2E olmadan ASLA icra edilmez ────────────
  // Plaintext fiziksel komut = kategorik red. Yalnız başarılı E2E decrypt icra kapısıdır
  // (decrypt aşağıda; başarısızsa crypto_failed). Çift-dinleyici (C3) nonce-replay ile
  // doğal korunur: ilk decrypt nonce'u tüketir, ikinci dinleyici 'Replay Attack' alır.
  if (E2E_REQUIRED_COMMANDS.includes(cmd.type) && !isE2EPayload(payload)) {
    console.error(`[CmdListener] Kritik komut E2E olmadan reddedildi: ${cmd.type}`);
    return { outcome: 'crypto_failed' };
  }

  // ── E2E (ECDH) deşifreleme — yeni yol, önce kontrol edilir ──────────────────
  if (isE2EPayload(payload)) {
    const privKey = getCarPrivateKey();
    if (!privKey) {
      // Anahtar henüz yüklenmemiş — bu kritik bir başlangıç sorunudur
      console.error('[CmdListener] E2E private key yüklenmemiş; komut reddedildi.');
      return { outcome: 'crypto_failed' };
    }
    try {
      payload = await decryptE2EPayload(payload, privKey, {
        crossChannelNonceCheck: checkCrossChannelNonceReplay,
      });
    } catch (err) {
      // Zero-Plaintext: hata mesajını logla, komutu ASLA icra etme
      const reason = err instanceof Error ? err.message : 'Decryption Error';
      console.error(`[CmdListener] E2E deşifreleme başarısız: ${reason}`);
      return { outcome: 'crypto_failed' };
    }

  // ── Legacy PBKDF2 deşifreleme — geriye dönük uyumluluk ──────────────────────
  } else if (isEncryptedPayload(payload)) {
    try {
      const apiKey = await sensitiveKeyStore.get('veh_api_key');
      if (apiKey) {
        payload = await decryptPayload(
          payload as unknown as import('./commandCrypto').EncryptedPayload,
          apiKey,
        );
      } else {
        console.warn('[CmdListener] Şifreli payload alındı fakat api_key bulunamadı.');
        return { outcome: 'rejected' };
      }
    } catch (err) {
      console.error('[CmdListener] PBKDF2 deşifreleme başarısız:', err);
      return { outcome: 'failed' };
    }
  }

  const gate = movingGateVerdict(cmd.type, Date.now());
  if (gate === 'BLOCK') {
    bump('movingBlocked');
    console.warn(`[CmdListener] ${cmd.type} sürüş sırasında reddedildi (${currentSpeedKmh} km/h)`);
    return { outcome: 'rejected' };
  }
  if (gate === 'SPEED_UNKNOWN') {
    /* Tehlikeli komut TAZE hız kanıtı OLMADAN geçiyor. Reddedilmez (bkz.
       `judgeMovingGate`), ama sessizce "güvenli" de sayılmaz — sayılır. */
    bump('movingUnverified');
    console.warn(`[CmdListener] ${cmd.type} taze hız ölçümü olmadan kabul edildi.`);
  }

  try {
    switch (cmd.type) {
      case 'lock':
      case 'unlock':
      case 'horn':
      case 'alarm_on':
      case 'alarm_off':
      case 'lights_on':
        // H-4: nativeCommandBridge → CarLauncherPlugin → McuCommandFactory → CAN bus
        return { outcome: await executeMcuCommand(cmd.type) };

      // ── Teşhis okumaları — sonuç `vehicle_commands.result`'a yazılır ────────
      // Araç bağlı değilse "arıza yok"/"0 V" DENMEZ; yürütücü fail-closed davranır.
      case 'read_dtc':
        return await executeReadDtc();

      case 'read_voltage':
        return await executeReadVoltage();

      case 'clear_dtc':
        // Yıkıcı: write-gate (hız · rpm · bağlantı) kararı burada EZİLMEZ.
        return await executeClearDtc();

      case 'set_speed_alert': {
        // Zero-trust: eşik UZAKTAN gelir. Doğrulama düşerse ayar DEĞİŞMEZ ve
        // komut `failed` olur — sessizce "kaydedildi" denmez (eski yalanın kökü).
        const ok = applySpeedAlertConfig(payload.speed_alert ?? payload);
        if (!ok) {
          return { outcome: 'failed', reason: 'Geçersiz hız uyarısı ayarı (eşik 30–250 km/h olmalı)' };
        }
        const cfg = getSpeedAlertConfig();
        return {
          outcome: 'completed',
          result: {
            speedAlert: cfg,
            appliedAt:  new Date().toISOString(),
          },
        };
      }

      case 'route_send':
      case 'navigation_start': {
        const route = (payload.route ?? payload) as {
          lat: number; lng: number;
          address_name?: string;
          provider_intent?: string;
        };
        const lat  = Number(route.lat);
        const lng  = Number(route.lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
            !Number.isFinite(lng) || lng < -180 || lng > 180) {
          console.error('[CmdListener] Geçersiz koordinat:', lat, lng);
          return { outcome: 'failed' };
        }
        const intentUri = buildNavIntent(lat, lng, route.address_name ?? '',
          (route.provider_intent ?? 'google_maps') as 'google_maps' | 'yandex' | 'waze' | 'apple_maps');
        // Android'de intent URI'yi window.open ile aç
        window.open(intentUri, '_blank');
        return { outcome: 'completed' };
      }

      case 'theme_change': {
        /* Tema Manifesti v2 — TEK kapı, fail-CLOSED.
         *
         * SAHA KUSURU (kapatıldı): eskiden `payload.theme` yoksa `data-theme`
         * doğrudan "dark" yapılıyordu. 'dark' geçerli bir CarTheme DEĞİLDİR →
         * tüm `[data-theme="pro|tesla|…"]` CSS kuralları ıskalıyor, üstelik
         * useCarTheme store'u güncellenmediği için React layout eski temada
         * kalıyordu (yarı bozuk ekran). Artık baz tema YALNIZ store üzerinden
         * (useCarTheme.setTheme) değişir ve yalnız BİLİNEN tema id'leri kabul edilir.
         */
        if (payload.manifest !== undefined) {
          const r = applyIncomingThemeManifest(payload.manifest, 'command');
          if (!r.ok) {
            console.warn('[CmdListener] Tema manifesti reddedildi:', r.reason);
            return { outcome: 'failed', reason: `Tema manifesti reddedildi: ${r.reason ?? 'bilinmeyen'}` };
          }
          return {
            outcome: 'completed',
            result: { themeId: r.themeId, themeVersion: r.themeVersion, appliedAt: new Date().toISOString() },
          };
        }

        // Geri-uyum: manifest'siz eski PWA sürümü yalnız `themeVars` yollar.
        const legacyTheme = typeof payload.theme === 'string' ? payload.theme : null;
        const baseId: ThemeBaseId | null =
          legacyTheme && (THEME_BASE_IDS as readonly string[]).includes(legacyTheme)
            ? (legacyTheme as ThemeBaseId)
            : null;
        const themeVars = payload.themeVars as Record<string, unknown> | undefined;
        if (!baseId && (!themeVars || typeof themeVars !== 'object')) {
          return { outcome: 'failed', reason: 'theme_change: manifest yok, tanınan tema/themeVars da yok' };
        }
        const migrated = migrateLegacyThemeVars(themeVars, baseId ?? currentCarThemeBase());
        applyThemeManifest(migrated, 'command', { setBaseTheme: baseId !== null, persist: true });
        return {
          outcome: 'completed',
          result: { themeId: migrated.themeId, schemaVersion: 1, migrated: true },
        };
      }

      case 'layout_change': {
        // Tema Stüdyo ekran düzeni niyeti — zero-trust normalize + store'a uygula.
        // ProLayout store'u okuyup solveLayout ile yeniden render eder (fail-soft: bozuksa varsayılan).
        useLayoutStore.getState().applyIntent(payload.layout);
        return { outcome: 'completed' };
      }

      default:
        bump('unknownType');
        console.warn('[CmdListener] Bilinmeyen komut tipi:', cmd.type);
        return { outcome: 'rejected' };
    }
  } catch (err) {
    console.error('[CmdListener] Execute hatası:', err);
    return { outcome: 'failed' };
  }
}

// ── Durum güncelleme ─────────────────────────────────────────────────────────

async function updateCommandStatus(
  commandId:   string,
  status:      'accepted' | 'executing' | 'completed' | 'failed' | 'rejected',
  errorReason?: string,
  /**
   * Ölçüm sonucu (yalnız teşhis komutlarında). YAZILMAZSA kolon `NULL` kalır —
   * "sonuç okunmadı" ile "sonuç boş" ayrımı korunur; sahte `{}` gönderilmez.
   */
  result?: Record<string, unknown>,
): Promise<void> {
  const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
  const SUPABASE_ANON    = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!SUPABASE_URL || !SUPABASE_ANON) return;

  const now     = new Date().toISOString();
  const updates: Record<string, unknown> = { status };
  if (status === 'accepted')  updates.accepted_at = now;
  if (status === 'executing') updates.last_attempt_at = now;
  if (['completed', 'failed', 'rejected'].includes(status)) updates.finished_at = now;
  if (errorReason) updates.error_reason = errorReason;
  if (result !== undefined) updates.result = result;

  // Komut durumu kritik — kuyruğa al, at-least-once garantisi
  await connectivityService.enqueue(
    `${SUPABASE_URL}/rest/v1/vehicle_commands?id=eq.${commandId}`,
    'PATCH',
    {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
      'Prefer':        'return=minimal',
    },
    updates,
    'high',
    'cmd_status',
  );
}

// ── Retry increment (RPC üzerinden — atomik) ─────────────────────────────────

async function incrementRetry(commandId: string, errorReason: string): Promise<void> {
  const supabase = await getSupabase();
  if (!supabase) return;
  // increment_command_retry RPC: retry_count artırır, max 3'te failed'a çeker
  await supabase.rpc('increment_command_retry', {
    p_command_id: commandId,
    p_error:      errorReason,
  });
}

// ── Push bildirim — Edge Function tetikle ────────────────────────────────────

async function triggerPushNotify(
  event:     string,
  vehicleId: string,
  payload:   Record<string, unknown>,
): Promise<void> {
  if (!PUSH_EDGE_FN_URL) return;
  try {
    await fetch(PUSH_EDGE_FN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ event, vehicleId, payload }),
    });
  } catch { /* fire-and-forget — bildirim hatası ana akışı etkilemez */ }
}

// ── Ana Listener Sınıfı ───────────────────────────────────────────────────────

export class CommandListener {
  private vehicleId:      string;
  private _alive =        false;
  private channel:        RealtimeChannel | null = null;
  private executedIds:    Set<string> = new Set(); // ID bazlı dedup (nonce değil)
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimers:    Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(vehicleId: string) {
    this.vehicleId = vehicleId;
  }

  /** Bildirim hedefi — `notifyVehicleEvent` için salt-okunur erişim. */
  getVehicleId(): string {
    return this.vehicleId;
  }

  async connect(): Promise<void> {
    this._alive = true;
    const supabase = await getSupabase();
    if (!supabase || !this._alive) return;

    // ── E2E Anahtar Init + Supabase'e Public Key Yayını ─────────────────────
    // loadOrCreateDeviceKey RAM'i önbelleğe alır; ilk çağrı ~10–20ms, sonraki <1 μs.
    // Bağlantı kurulmadan önce anahtar hazır olmalı — komutlar gelmeden önce init tam olsun.
    try {
      const { pubKeyB64 } = await loadOrCreateDeviceKey();
      // vehicles tablosuna e2e_public_key yaz — telefon bu key ile şifreler
      await supabase
        .from('vehicles')
        .upsert({
          id:             this.vehicleId,
          e2e_public_key: pubKeyB64,
          e2e_key_alg:    'ECDH-P256-AES-GCM-256',
        });
    } catch (e) {
      // Non-fatal: anahtar publish başarısız olursa eski key ile devam
      console.warn('[CmdListener] E2E public key publish başarısız:', e);
    }

    // Reconnect'te bekleyen + retry-eligible komutları işle
    await this.processPendingCommands(supabase);

    this.channel = supabase
      .channel(`vehicle-cmds:${this.vehicleId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'vehicle_commands',
          filter: `vehicle_id=eq.${this.vehicleId}`,
        },
        ({ new: row }: { new: Record<string, unknown> }) => {
          if (!this._alive) return;
          void this.handleCommand(row as unknown as VehicleCommand);
        },
      )
      .subscribe((status: string) => {
        if (!this._alive) return;
        if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          this.scheduleReconnect();
        }
      });
  }

  /**
   * Bekleyen komutları DB'den anlık çeker — Realtime gap koruması için.
   * Push-to-Wake sinyali geldiğinde, listener zaten canlıyken çağrılır.
   */
  async triggerPendingPoll(): Promise<void> {
    if (!this._alive) return;
    const supabase = await getSupabase();
    if (!supabase) return;
    await this.processPendingCommands(supabase);
  }

  disconnect(): void {
    this._alive = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Bekleyen retry timer'ları temizle
    this.retryTimers.forEach((t) => clearTimeout(t));
    this.retryTimers.clear();

    if (this.channel) {
      const ch = this.channel;
      this.channel = null;
      getSupabase()?.removeChannel(ch);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this._alive) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this._alive) await this.connect();
    }, RECONNECT_DELAY);
  }

  // ── Offline recovery ────────────────────────────────────────────────────────
  // Bağlantı kurulunca:
  //   1. TTL'i geçmemiş pending komutları çek
  //   2. retry_count < MAX_RETRY olanları dahil et
  //   3. FIFO sırayla işle

  private async processPendingCommands(
    supabase: NonNullable<Awaited<ReturnType<typeof getSupabase>>>,
  ): Promise<void> {
    const now = new Date().toISOString();

    const { data: cmds } = await supabase
      .from('vehicle_commands')
      .select('*')
      .eq('vehicle_id', this.vehicleId)
      .eq('status', 'pending')
      .gt('ttl', now)                         // TTL geçmemiş
      .lt('retry_count', MAX_RETRY)           // max retry aşılmamış
      .order('created_at', { ascending: true })
      .limit(10);

    for (const cmd of cmds ?? []) {
      if (!this._alive) break;
      // ID dedup: zaten bu session'da işlenmiş olanları atla
      if (this.executedIds.has(cmd.id as string)) continue;
      await this.handleCommand(cmd as unknown as VehicleCommand);
    }
  }

  // ── Komut işleyici ──────────────────────────────────────────────────────────

  private async handleCommand(cmd: VehicleCommand): Promise<void> {
    // 1. TTL kontrolü
    bump('received');
    if (cmd.ttl && new Date(cmd.ttl) < new Date()) {
      bump('ttlExpired');
      _evidence.lastType = cmd.type; _evidence.lastOutcome = 'ttl_expired';
      _evidence.lastAt = Date.now();
      await updateCommandStatus(cmd.id, 'failed', 'TTL aşıldı');
      return;
    }

    // 2. Idempotency — aynı komut ID'si bu session'da tekrar işlenmez
    if (this.executedIds.has(cmd.id)) return;
    this.executedIds.add(cmd.id);

    // Set büyümesin (max 500 kayıt)
    if (this.executedIds.size > 500) {
      const first = this.executedIds.values().next().value;
      if (first) this.executedIds.delete(first);
    }

    // 3. Kabul et → yürüt
    await updateCommandStatus(cmd.id, 'accepted');
    await updateCommandStatus(cmd.id, 'executing');

    const { outcome, result, reason } = await executeCommand(cmd);

    /* Kanıt: hangi tip, hangi sonuç, ne zaman. Komut KİMLİĞİ ve payload
       defterlere GİRMEZ (gizlilik kuralı 6). */
    _evidence.lastType = cmd.type;
    _evidence.lastOutcome = outcome;
    _evidence.lastAt = Date.now();
    if (outcome === 'completed')          bump('completed');
    else if (outcome === 'rejected')      bump('rejected');
    else if (outcome === 'crypto_failed') bump('cryptoFailed');

    if (outcome === 'completed') {
      // `result` yalnız ölçüm yapan komutlarda doludur → diğerlerinde kolon NULL kalır.
      await updateCommandStatus(cmd.id, 'completed', undefined, result);
      // Push bildirim: komut tamamlandı
      void triggerPushNotify('command_completed', cmd.vehicle_id, {
        command_id:    cmd.id,
        command_label: cmd.type,
      });
      return;
    }

    if (outcome === 'rejected') {
      // Güvenlik reddi — retry yok. Yürütücü gerçek gerekçe verdiyse o kullanılır
      // (write-gate mesajı gibi); vermediyse eski genel metin BİREBİR korunur.
      await updateCommandStatus(
        cmd.id, 'rejected', reason ?? 'Sürüş güvenliği: komut reddedildi',
      );
      return;
    }

    if (outcome === 'crypto_failed') {
      // E2E deşifreleme hatası — retry yok, komut kalıcı olarak geçersiz
      await updateCommandStatus(cmd.id, 'failed', 'Decryption Error: komut reddedildi');
      return;
    }

    // 'failed' — retry değerlendirmesi
    const retryCount = cmd.retry_count ?? 0;

    if (retryCount < MAX_RETRY) {
      // Exponential backoff: 2^retry saniye (1s, 2s, 4s)
      const backoffMs = Math.pow(2, retryCount) * 1_000;
      logInfo(`[CmdListener] Retry ${retryCount + 1}/${MAX_RETRY} — ${backoffMs}ms sonra: ${cmd.id}`);

      // DB'yi güncelle (retry_count++ ve status pending kalır)
      bump('retries');
      await incrementRetry(cmd.id, `Attempt ${retryCount + 1} failed`);

      // ID dedup'tan çıkar — bir sonraki retry'da tekrar işlenebilsin
      this.executedIds.delete(cmd.id);

      // Timer ile retry — araç online'sa bu session'da dene
      const timer = setTimeout(async () => {
        this.retryTimers.delete(cmd.id);
        if (!this._alive) return;
        // Güncel cmd'yi DB'den çek (retry_count güncellenmiş olabilir)
        const supabase = await getSupabase();
        if (!supabase) return;
        const { data } = await supabase
          .from('vehicle_commands')
          .select('*')
          .eq('id', cmd.id)
          .eq('status', 'pending')
          .single();
        if (data) await this.handleCommand(data as unknown as VehicleCommand);
      }, backoffMs);

      this.retryTimers.set(cmd.id, timer);
    } else {
      // Max retry aşıldı → kalıcı failed. Yürütücünün gerçek gerekçesi varsa
      // ("adaptörden ATRV gelmiyor" gibi) sayı yerine O gösterilir.
      bump('failed');
      const finalReason = reason ?? `${MAX_RETRY} denemede başarısız`;
      await updateCommandStatus(cmd.id, 'failed', finalReason);
      void triggerPushNotify('command_failed', cmd.vehicle_id, {
        command_id:   cmd.id,
        error_reason: finalReason,
      });
    }
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _instance: CommandListener | null = null;

export function startCommandListener(vehicleId: string): () => void {
  stopCommandListener();
  _instance = new CommandListener(vehicleId);
  void _instance.connect();
  return stopCommandListener;
}

export function stopCommandListener(): void {
  _instance?.disconnect();
  _instance = null;
}

/** Listener canlı mı? pushService wake kararı için. */
export function isCommandListenerActive(): boolean {
  return _instance !== null;
}

/**
 * Araç kaynaklı bir olayı eşleşmiş telefona bildirir (hız uyarısı gibi).
 * Bildirim yolu TEK OTORİTEDİR — `triggerPushNotify` burada kalır, çağıranlar
 * kendi `fetch`ini kurmaz. Araç eşleştirilmemişse (listener yok) sessizce
 * hiçbir şey yapılmaz: kime bildirileceği bilinmez, uydurma hedef seçilmez.
 */
export function notifyVehicleEvent(
  event:   string,
  payload: Record<string, unknown>,
): void {
  const vehicleId = _instance?.getVehicleId();
  if (!vehicleId) return;
  void triggerPushNotify(event, vehicleId, payload);
}

/**
 * Aktif listener üzerinde DB poll'u anında tetikler.
 * Push-to-Wake: listener canlıysa Realtime gap'ını kapatmak için çağrılır.
 */
export function triggerPendingPoll(): void {
  void _instance?.triggerPendingPoll();
}
