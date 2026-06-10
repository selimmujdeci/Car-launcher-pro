/**
 * otaUpdateService.ts — OTA v1 / Commit 6: güncelleme orkestrasyon servisi
 *
 * Sorumluluk: ota_releases sorgusu (anon + RLS, yalnız status='active'),
 * kanal + sürüm filtresi, park kapısı ve Commit 4-5 native fonksiyonlarının
 * (downloadOtaApk / installOtaApk) durum makinesiyle yönetimi.
 * Telemetri/ota_event raporlama YOK (Commit 7).
 *
 * Durum makinesi:
 *   idle → checking → available → downloading → verified
 *        → install_prompted → installed_waiting_reboot
 *   herhangi bir adım → failed (sonraki poll'da idle'a sıfırlanıp yeniden denenir)
 *
 * Kurallar:
 *   - Aynı anda TEK OTA işlemi (_busy kilidi — duplicate poll engeli)
 *   - Park kapısı: hız > 0 iken indirme/kurulum BAŞLAMAZ (available'da bekler);
 *     hız sensörü yoksa (null) park kabul edilir (tezgah/test fail-soft)
 *   - settings_opened: kullanıcı izin ekranından dönünce installVerifiedApk
 *     yeniden çağrılır (awaitingPermission bayrağı)
 *   - Kalıcılık: safeStorage 'ota-state-v1' (boot'ta uzlaştırma: hedef sürüme
 *     ulaşıldıysa idle; yarım indirme → idle; reboot bekleyen ama sürüm
 *     değişmemiş → verified'a geri düşer, yeniden kurulabilir)
 *
 * Zero-Leak (CLAUDE.md §1): startOtaService() ↔ stopOtaService() simetrik.
 */

import { create } from 'zustand';
import { getSupabaseClient } from './supabaseClient';
import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import {
  getAppVersionInfo,
  downloadOtaApk,
  installOtaApk,
} from './nativeCommandBridge';
import { pushVehicleEvent } from './vehicleIdentityService';
import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';
import { logInfo } from './debug';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS  = 6 * 60 * 60 * 1_000; // 6 saat
const STATE_KEY         = 'ota-state-v1';
const CHANNEL_KEY       = 'ota-channel';       // internal|pilot|production (cihaz ataması)
const TELEMETRY_KEY     = 'ota-telemetry-v1';  // spam-engeli dedup durumu
const VALID_CHANNELS    = ['internal', 'pilot', 'production'] as const;

export type OtaChannel = (typeof VALID_CHANNELS)[number];

export type OtaState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verified'
  | 'install_prompted'
  | 'installed_waiting_reboot'
  | 'failed';

export interface OtaRelease {
  versionCode: number;
  versionName: string;
  channel: string;
  apkPath: string;
  apkSize: number;
  sha256: string;
}

export interface OtaSnapshot {
  state: OtaState;
  release: OtaRelease | null;
  /** İndirme ilerlemesi 0-100 (yalnız downloading'de anlamlı) */
  progressPercent: number;
  /** files/ota altındaki doğrulanmış dosya adı (verified+ sonrası) */
  fileName: string | null;
  errorCode: string | null;
  awaitingPermission: boolean;
  lastCheckTs: number | null;
}

// Hidden-class kararlılığı: tüm alanlar tek şablonda (CLAUDE.md V8 §1)
const INITIAL: OtaSnapshot = {
  state: 'idle',
  release: null,
  progressPercent: 0,
  fileName: null,
  errorCode: null,
  awaitingPermission: false,
  lastCheckTs: null,
};

export const useOtaStore = create<OtaSnapshot>(() => ({ ...INITIAL }));

// ── Modül durumu ──────────────────────────────────────────────────────────────

let _busy = false;                                   // tek-işlem kilidi
let _pollTimer: ReturnType<typeof setInterval> | null = null;

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _set(patch: Partial<OtaSnapshot>): void {
  useOtaStore.setState(patch);
  _persist();
}

/** Kalıcı alt küme — UI/geçici alanlar (progress) diske yazılmaz. */
function _persist(): void {
  const s = useOtaStore.getState();
  safeSetRaw(STATE_KEY, JSON.stringify({
    state: s.state,
    release: s.release,
    fileName: s.fileName,
    awaitingPermission: s.awaitingPermission,
    lastCheckTs: s.lastCheckTs,
  }), undefined, true); // immediate: OTA geçişleri nadir + kritik
}

function _loadPersisted(): Partial<OtaSnapshot> | null {
  try {
    const raw = safeGetRaw(STATE_KEY);
    return raw ? (JSON.parse(raw) as Partial<OtaSnapshot>) : null;
  } catch {
    return null;
  }
}

// ── Telemetri (OTA v1 / Commit 7 — rollout circuit-breaker beslemesi) ────────
//
// vehicle_events'e 'ota_event' tipiyle gider (pushVehicleEvent →
// push_vehicle_event RPC → connectivityService at-least-once kuyruğu).
// Admin tarafı (superadmin.service getRolloutHealth) aynı vehicle_events
// tablosunu okur — OTA başarı/başarısızlık verisi rollout sağlığını besler.
//
// Spam engeli: aynı sürümün success'i ve aynı (errorCode, versionCode)
// çiftinin fail'i YALNIZ BİR KEZ gönderilir (safeStorage dedup, reboot
// dayanıklı). Yeni sürüm/yeni hata → yeniden gönderilir.

interface OtaTelemetryDedup {
  lastSuccessVc: number | null;
  lastFailKey: string | null; // `${errorCode}:${versionCode}`
}

function _loadTelemetryDedup(): OtaTelemetryDedup {
  try {
    const raw = safeGetRaw(TELEMETRY_KEY);
    if (raw) return JSON.parse(raw) as OtaTelemetryDedup;
  } catch { /* bozuk kayıt → sıfırdan */ }
  return { lastSuccessVc: null, lastFailKey: null };
}

function _saveTelemetryDedup(d: OtaTelemetryDedup): void {
  safeSetRaw(TELEMETRY_KEY, JSON.stringify(d), undefined, true);
}

/** Güncelleme kuruldu — sürüm başına TEK success eventi. */
function _emitOtaSuccess(versionCode: number, versionName: string): void {
  const dedup = _loadTelemetryDedup();
  if (dedup.lastSuccessVc === versionCode) return; // aynı sürüm tekrar gönderilmez
  dedup.lastSuccessVc = versionCode;
  _saveTelemetryDedup(dedup);
  void pushVehicleEvent('ota_event', {
    event: 'ota_success',
    versionCode,
    versionName,
  }).catch(() => { /* fire-and-forget — kuyruk zaten at-least-once */ });
}

/** OTA hatası — aynı (errorCode, hedef sürüm) çifti TEK kez gönderilir. */
function _emitOtaFail(errorCode: string, versionCode: number): void {
  const key = `${errorCode}:${versionCode}`;
  const dedup = _loadTelemetryDedup();
  if (dedup.lastFailKey === key) return; // aynı hata spam'lenmez
  dedup.lastFailKey = key;
  _saveTelemetryDedup(dedup);
  void pushVehicleEvent('ota_event', {
    event: 'ota_fail',
    errorCode,
    versionCode,
  }).catch(() => { /* fire-and-forget */ });
}

/** failed geçişlerinin tek kapısı: durum + telemetri birlikte. */
function _fail(errorCode: string, extra?: Partial<OtaSnapshot>): void {
  const target = useOtaStore.getState().release?.versionCode ?? 0;
  _set({ state: 'failed', errorCode, ...extra });
  _emitOtaFail(errorCode, target);
}

export function getOtaChannel(): OtaChannel {
  const raw = safeGetRaw(CHANNEL_KEY);
  return (VALID_CHANNELS as readonly string[]).includes(raw ?? '')
    ? (raw as OtaChannel)
    : 'production';
}

export function setOtaChannel(ch: OtaChannel): void {
  if ((VALID_CHANNELS as readonly string[]).includes(ch)) {
    safeSetRaw(CHANNEL_KEY, ch, undefined, true);
  }
}

/** Park kapısı: hız > 0 → OTA bekler. Sensör yok (null) → park kabul (fail-soft). */
export function isParkedForOta(): boolean {
  const speed = useUnifiedVehicleStore.getState().speed;
  return (speed ?? 0) <= 0;
}

/** Kurulu versionCode: native gerçek > build-time enjeksiyon (Commit 1 zinciri). */
export async function getCurrentVersionCode(): Promise<number> {
  const native = await getAppVersionInfo();
  if (native?.versionCode && native.versionCode > 0) return native.versionCode;
  const injected = Number.parseInt(
    (import.meta.env.VITE_APP_VERSION_CODE as string | undefined) ?? '', 10);
  return Number.isInteger(injected) && injected > 0 ? injected : 0;
}

// ── Sorgu — yeni release var mı? ─────────────────────────────────────────────

async function _queryLatestRelease(currentCode: number): Promise<OtaRelease | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null; // env yok (demo/offline) — sessiz geç

  const { data, error } = await supabase
    .from('ota_releases')
    .select('version_code, version_name, channel, apk_path, apk_size, sha256')
    .eq('status', 'active')            // RLS de zorlar; sorgu netliği için tekrar
    .eq('channel', getOtaChannel())
    .gt('version_code', currentCode)
    .order('version_code', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const row = data[0] as Record<string, unknown>;
  return {
    versionCode: row['version_code'] as number,
    versionName: row['version_name'] as string,
    channel:     row['channel'] as string,
    apkPath:     row['apk_path'] as string,
    apkSize:     row['apk_size'] as number,
    sha256:      row['sha256'] as string,
  };
}

// ── Akış adımları ─────────────────────────────────────────────────────────────

/**
 * Yeni sürüm kontrolü + (park halindeyse) otomatik indirme.
 * Duplicate poll engeli: _busy iken sessizce atlanır.
 */
export async function checkForUpdate(): Promise<void> {
  if (_busy) return;
  const st = useOtaStore.getState().state;
  // Aktif bir kurulum/indirme döngüsünün üzerine yazma
  if (st === 'downloading' || st === 'install_prompted') return;
  _busy = true;
  try {
    if (st === 'failed') _set({ state: 'idle', errorCode: null }); // yeniden dene
    _set({ state: 'checking', lastCheckTs: Date.now() });

    const current = await getCurrentVersionCode();
    if (current <= 0) {
      _fail('ERR_VERSION_UNKNOWN');
      return;
    }
    const release = await _queryLatestRelease(current);
    if (!release) {
      _set({ state: 'idle', release: null });
      return;
    }
    logInfo(`[OTA] Yeni sürüm: v${release.versionName} (vc=${release.versionCode})`);
    _set({ state: 'available', release });

    // Park kapısı: araç hareketliyse available'da bekle (sonraki poll/tap dener)
    if (isParkedForOta()) {
      await _downloadAvailableRelease();
    }
  } catch (err) {
    _fail('ERR_CHECK', { release: null });
    console.warn('[OTA] checkForUpdate hatası:', err);
  } finally {
    _busy = false;
  }
}

/** available → downloading → verified. Park kapısı burada da zorlanır. */
async function _downloadAvailableRelease(): Promise<void> {
  const { release } = useOtaStore.getState();
  if (!release) return;
  if (!isParkedForOta()) return; // kapı: hareket halinde indirme başlamaz

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) {
    _fail('ERR_NO_ENV');
    return;
  }
  const fileName = release.apkPath.split('/').pop() ?? '';

  _set({ state: 'downloading', progressPercent: 0 });
  const result = await downloadOtaApk(
    {
      url: `${url}/storage/v1/object/ota_apks/${release.apkPath}`,
      expectedSha256: release.sha256,
      expectedSize: release.apkSize,
      fileName,
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    },
    (ev) => { useOtaStore.setState({ progressPercent: ev.percent }); }, // geçici — persist yok
  );

  if (result.ok) {
    _set({ state: 'verified', fileName, progressPercent: 100 });
  } else {
    _fail(result.errorCode ?? 'ERR_DOWNLOAD'); // ERR_HASH/ERR_HTTP/ERR_IO/... telemetriye
  }
}

/**
 * verified → install_prompted → installed_waiting_reboot.
 * settings_opened → awaitingPermission=true + verified'da kalır; kullanıcı
 * izin verip döndüğünde bu fonksiyon YENİDEN çağrılır (kart butonu).
 */
export async function installVerifiedApk(): Promise<void> {
  if (_busy) return;
  const { state, fileName } = useOtaStore.getState();
  if (state !== 'verified' || !fileName) return;
  if (!isParkedForOta()) return; // park kapısı: sürüşte kurulum diyaloğu açılmaz

  _busy = true;
  try {
    _set({ state: 'install_prompted' });
    const r = await installOtaApk(fileName);
    if (r.ok && r.action === 'install_prompted') {
      _set({ state: 'installed_waiting_reboot', awaitingPermission: false });
    } else if (r.action === 'settings_opened') {
      // İzin akışı: ayar ekranı açıldı — verified'a dön, bayrağı kaldır
      // (telemetri YOK — hata değil, beklenen kullanıcı akışı)
      _set({ state: 'verified', awaitingPermission: true });
    } else {
      _fail(r.errorCode ?? 'ERR_INSTALL'); // ERR_SIGNATURE/ERR_PACKAGE/ERR_DOWNGRADE/...
    }
  } catch (err) {
    _fail('ERR_INSTALL');
    console.warn('[OTA] installVerifiedApk hatası:', err);
  } finally {
    _busy = false;
  }
}

// ── Boot uzlaştırma + yaşam döngüsü ──────────────────────────────────────────

/** Boot'ta kalıcı durumla gerçeği uzlaştırır (yarım iş temizliği). */
export async function reconcileOnBoot(): Promise<void> {
  const persisted = _loadPersisted();
  if (!persisted) return;

  const current = await getCurrentVersionCode();
  const target = persisted.release?.versionCode ?? 0;

  if (target > 0 && current >= target) {
    // Güncelleme KURULMUŞ — sürüm başına tek ota_success (circuit breaker
    // beslemesi), sonra temiz başlangıç.
    _emitOtaSuccess(target, persisted.release?.versionName ?? '');
    _set({ ...INITIAL });
    return;
  }
  switch (persisted.state) {
    case 'checking':
    case 'downloading':
    case 'available':
      // Yarım iş — temiz başla, sonraki poll yeniden bulur
      _set({ ...INITIAL });
      break;
    case 'installed_waiting_reboot':
      // Reboot oldu ama sürüm DEĞİŞMEMİŞ (kullanıcı diyaloğu iptal etti?)
      // → APK hâlâ doğrulanmış durumda, yeniden kurulabilir
      _set({
        ...INITIAL,
        state: 'verified',
        release: persisted.release ?? null,
        fileName: persisted.fileName ?? null,
      });
      break;
    case 'verified':
    case 'failed':
      _set({
        ...INITIAL,
        state: persisted.state,
        release: persisted.release ?? null,
        fileName: persisted.fileName ?? null,
        awaitingPermission: persisted.awaitingPermission ?? false,
        errorCode: persisted.state === 'failed' ? 'ERR_PERSISTED' : null,
      });
      break;
    default:
      _set({ ...INITIAL });
  }
}

/** Boot kontrolü + 6 saatlik poll. Idempotent. */
export function startOtaService(): void {
  if (_pollTimer) return;
  void reconcileOnBoot().then(() => checkForUpdate());
  _pollTimer = setInterval(() => { void checkForUpdate(); }, POLL_INTERVAL_MS);
}

/** Zero-Leak: timer temizliği. */
export function stopOtaService(): void {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/** UI kartı: kullanıcı dokunuşuyla akışı sürdür (duruma göre doğru adım). */
export async function resumeOtaFlow(): Promise<void> {
  const { state } = useOtaStore.getState();
  if (state === 'available') {
    if (_busy) return;
    _busy = true;
    try { await _downloadAvailableRelease(); } finally { _busy = false; }
  } else if (state === 'verified') {
    await installVerifiedApk();
  } else if (state === 'idle' || state === 'failed') {
    await checkForUpdate();
  }
}

// ── Test yardımcısı (yalnız vitest) ──────────────────────────────────────────

/** @internal — testlerde modül durumunu sıfırlar. */
export function _resetOtaServiceForTest(): void {
  stopOtaService();
  _busy = false;
  useOtaStore.setState({ ...INITIAL });
}
