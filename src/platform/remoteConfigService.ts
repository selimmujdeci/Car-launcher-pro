/**
 * remoteConfigService — Bulut Kaynaklı Konfigürasyon Köprüsü
 *
 * Super Admin panelinden Supabase'e yazılan feature_flags ve runtime_policies
 * kayıtlarını çekerek araç içi sisteme enjekte eder.
 *
 * Akış:
 *   1. start() çağrılır (SystemOrchestrator içinde)
 *   2. İlk fetch: Supabase REST API ile feature_flags tablosu okunur
 *   3. Her flag, FLAG_STORE_MAP aracılığıyla useStore'a veya modül-düzeyi
 *      global'e enjekte edilir
 *   4. 10 dakikada bir poll tekrarlanır
 *   5. stop() tüm kaynakları serbest bırakır
 *
 * Zero-Leak: stop() interval'ı iptal eder, unsub fonksiyonları çağrılır.
 *
 * Güvenlik:
 *   - Supabase anon key kullanılır (feature_flags SELECT izni gerekir)
 *   - Hata durumunda varsayılan değerler kullanılmaya devam eder
 *   - Network yoksa sessizce devam eder (offline-first)
 */

import { signalWithTimeout } from '../utils/abortCompat';
import { useStore } from '../store/useStore';

// ── Sabitler ──────────────────────────────────────────────────────────────────

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const POLL_INTERVAL_MS  = 10 * 60_000; // 10 dakika

// ── Varsayılan flag değerleri (Supabase'e ulaşılamazsa) ───────────────────────

const DEFAULT_FLAGS: Record<string, boolean> = {
  crm:                     true,
  hazard_intelligence:     true,
  safety_copilot:          true,
  predictive_intelligence: false,
  voice_extras:            false,
};

// ── Modül-düzeyi flag state ───────────────────────────────────────────────────

let _flags: Record<string, boolean> = { ...DEFAULT_FLAGS };
const _subscribers: Array<(flags: Record<string, boolean>) => void> = [];

function _notify(): void {
  for (const cb of _subscribers) {
    try { cb({ ..._flags }); } catch { /* noop */ }
  }
}

// ── Flag → Store Eşleme ───────────────────────────────────────────────────────

/**
 * Her flag değiştiğinde useStore'a ne yazılacağını tanımlar.
 * Tüm store yazmaları `updateSettings()` üzerinden geçer — persist garantili.
 */
function _applyFlagToStore(key: string, enabled: boolean): void {
  switch (key) {
    case 'crm':
      // CRM kapalıysa topluluk özelliklerini (radar paylaşımı) durdur
      useStore.getState().updateSettings({ smartContextEnabled: enabled });
      break;
    case 'voice_extras':
      // Voice extras kapalıysa wake-word'ü de kapat
      if (!enabled) {
        useStore.getState().updateSettings({ wakeWordEnabled: false });
      }
      break;
    // hazard_intelligence, safety_copilot, predictive_intelligence:
    // Bu özellikler modül-düzeyinde kontrol edilir; getFlag() API'si kullanılır.
    default:
      break;
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function _fetchAndApply(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Supabase yapılandırılmamış — varsayılanlarla devam et
    return;
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/feature_flags?select=key,enabled`,
      {
        headers: {
          apikey:        SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        signal: signalWithTimeout(8_000),
      },
    );

    if (!res.ok) return;

    const rows = (await res.json()) as Array<{ key: string; enabled: boolean }>;
    if (!Array.isArray(rows) || rows.length === 0) return;

    let changed = false;
    for (const row of rows) {
      if (typeof row.key !== 'string' || typeof row.enabled !== 'boolean') continue;
      if (_flags[row.key] !== row.enabled) {
        _flags[row.key] = row.enabled;
        _applyFlagToStore(row.key, row.enabled);
        changed = true;
      }
    }

    if (changed) {
      _notify();
      if (import.meta.env.DEV) {
        console.info('[RemoteConfig] Flag güncellendi:', { ..._flags });
      }
    }
  } catch {
    // Network hatası veya timeout — mevcut değerlerle devam et
    if (import.meta.env.DEV) {
      console.warn('[RemoteConfig] Fetch başarısız, varsayılanlar kullanılıyor');
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Bir flag'in mevcut değerini döner. Supabase güncellendiğinde otomatik yenilenir. */
export function getFlag(key: string): boolean {
  return _flags[key] ?? DEFAULT_FLAGS[key] ?? false;
}

/** Flag değişimlerini dinle. Cleanup fonksiyonu döner. */
export function onFlagChange(cb: (flags: Record<string, boolean>) => void): () => void {
  _subscribers.push(cb);
  return () => {
    const idx = _subscribers.indexOf(cb);
    if (idx !== -1) _subscribers.splice(idx, 1);
  };
}

// ── Yaşam Döngüsü ─────────────────────────────────────────────────────────────

let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * Remote config servisini başlat.
 * İdempotent — çift çağrı güvenlidir.
 * @returns cleanup fonksiyonu
 */
export function startRemoteConfigService(): () => void {
  if (_running) return () => { /* noop */ };
  _running = true;

  // İlk fetch — açılışta anlık konfigürasyonu çek
  void _fetchAndApply();

  // 10 dakikada bir poll
  _pollTimer = setInterval(() => {
    void _fetchAndApply();
  }, POLL_INTERVAL_MS);

  if (import.meta.env.DEV) {
    console.info('[RemoteConfig] Başlatıldı — 10dk polling aktif');
  }

  return () => {
    _running = false;
    if (_pollTimer !== null) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    _subscribers.length = 0;
    _flags = { ...DEFAULT_FLAGS };

    if (import.meta.env.DEV) {
      console.info('[RemoteConfig] Durduruldu');
    }
  };
}
