/**
 * ThermalJournal — Termal Seviye Dairesel Günlüğü
 *
 * Amaç: Gerçek cihazda uzun süreli termal davranışı post-mortem analiz için
 * kayıt altına alır. Son 50 girdi dairesel buffer'da tutulur; 1 dakikada bir
 * 'thermal_history' anahtarına debounce'suz yazılır.
 *
 * Kullanım (SystemOrchestrator entegrasyonu):
 *   thermalJournal.start();           // sistem başlangıcında
 *   thermalJournal.record(level);     // her termal seviye değişiminde
 *   thermalJournal.stop();            // cleanup'ta
 *
 * Zero-Leak: stop() tüm interval'ları iptal eder ve final persist yapar.
 */

import { safeSetRaw } from '../../utils/safeStorage';

// ── Tipler ────────────────────────────────────────────────────────────────────

export interface ThermalEntry {
  level:      0 | 1 | 2 | 3;
  ts:         number;   // Unix ms — giriş başlangıcı
  durationMs: number;   // Bu seviyede geçirilen süre (ms) — stop() veya sonraki record() anında güncellenir
  /** Opsiyonel panik işareti — UI donması veya escalation esnasında eklenir */
  marker?:    string;
}

// ── Sabitler ──────────────────────────────────────────────────────────────────

const PERSIST_KEY       = 'thermal_history';
const BUFFER_CAPACITY   = 50;
const PERSIST_INTERVAL  = 60_000; // 1 dakika

// ── ThermalJournal ────────────────────────────────────────────────────────────

class ThermalJournal {
  private _buffer:        ThermalEntry[] = [];
  private _persistTimer:  ReturnType<typeof setInterval> | null = null;
  private _lastLevel:     0|1|2|3 = 0;
  private _lastTs:        number   = 0;

  /**
   * Termal seviye değişimini kaydet.
   * Önceki girdinin durationMs'i güncellenir; yeni girdi buffer'a eklenir.
   *
   * @param level  Mevcut termal seviye (0–3)
   */
  record(level: 0 | 1 | 2 | 3): void {
    const now = Date.now();

    // Önceki girdi varsa süresini kapat
    if (this._buffer.length > 0 && this._lastTs > 0) {
      const prev = this._buffer[this._buffer.length - 1];
      prev.durationMs = now - this._lastTs;
    }

    // Dairesel buffer: kapasite aşılınca en eski girdi silinir
    if (this._buffer.length >= BUFFER_CAPACITY) {
      this._buffer.shift();
    }

    this._buffer.push({ level, ts: now, durationMs: 0 });
    this._lastLevel = level;
    this._lastTs    = now;
  }

  /** Kayıt ve persist döngüsünü başlat. */
  start(): void {
    if (this._persistTimer) return; // idempotent
    this._lastTs    = Date.now();
    this._lastLevel = 0;

    this._persistTimer = setInterval(() => {
      this._persist();
    }, PERSIST_INTERVAL);

    if (import.meta.env.DEV) {
      console.info('[ThermalJournal] Başlatıldı — 1dk persist intervali aktif');
    }
  }

  /** Tüm kaynakları temizle; son durumu diske yaz. */
  stop(): void {
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
      this._persistTimer = null;
    }

    // Final: son girdinin durationMs'ini kapat
    if (this._buffer.length > 0 && this._lastTs > 0) {
      const last = this._buffer[this._buffer.length - 1];
      last.durationMs = Date.now() - this._lastTs;
    }

    this._persist();

    if (import.meta.env.DEV) {
      console.info('[ThermalJournal] Durduruldu — final snapshot yazıldı');
    }
  }

  /**
   * Kritik olay işareti ekler.
   * Mevcut termal seviyeyle aynı anda dairesel buffer'a özel girdi olarak eklenir.
   * Escalation veya UI donması gibi non-termal olayları zaman çizelgesine sabitler.
   *
   * @param reason  Kısa açıklama — dev log ve post-mortem analiz için
   */
  addPanicMarker(reason: string): void {
    const now = Date.now();
    if (this._buffer.length >= BUFFER_CAPACITY) {
      this._buffer.shift();
    }
    this._buffer.push({
      level:      this._lastLevel,
      ts:         now,
      durationMs: 0,
      marker:     `PANIC_MARKER:${reason}`,
    });
    if (import.meta.env.DEV) {
      console.warn(`[ThermalJournal] PANIC_MARKER kayıt edildi: ${reason}`);
    }
  }

  /** Son N girdiyi döner (varsayılan: tamamı). */
  getEntries(count = BUFFER_CAPACITY): readonly ThermalEntry[] {
    return this._buffer.slice(-count);
  }

  /** Şu anki (son kaydedilen) termal seviyeyi döner. */
  getLastLevel(): 0|1|2|3 {
    return this._lastLevel;
  }

  private _persist(): void {
    if (this._buffer.length === 0) return;
    try {
      safeSetRaw(PERSIST_KEY, JSON.stringify(this._buffer));
    } catch {
      // Persist hatası sessiz — watchdog veya logger zaten kapsar
    }
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const thermalJournal = new ThermalJournal();
