/**
 * extendedElimination — extended PID ELEME durumunun okuma katmanı (kütük #524).
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * Sahada (2026-08-10) izlenen PID sayısı 10-12'den **6'ya** düşüyordu ve hayatta
 * kalanlar yalnız çekirdek PID'lerdi. "Hangi PID neden sorulmuyor" sorusunun
 * cevabı hiçbir yerde YOKTU: native `ExtendedNoDataTracker.demotedCount()`
 * yazılmıştı ama **tek bir çağıranı bile yoktu**. Eleme görünmezdi.
 *
 * ── SÖZLEŞME ───────────────────────────────────────────────────────────────
 * `getExtendedElimination()` SENKRONDUR ve yalnız önbelleği okur; önbelleği
 * dolduran tek şey ASYNC `refreshExtendedElimination()`tir. Kopya/rapor yolu
 * senkron olduğu için bu ayrım zorunludur (aynı desen: `extendedPollEvidence`).
 *
 * `null` = OKUNMADI. "Eleme yok" ANLAMINA GELMEZ — sahte 0 üretilmez.
 */
import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';

/** Native'den gelen ham eleme durumu. */
export interface ExtendedEliminationSnapshot {
  /** Güncel poll turu — duraklatma merdiveni tur cinsindendir. */
  readonly cycle: number;
  /** Native'in izlediği extended PID sayısı. */
  readonly watchedCount: number;
  /** Oturum-içi KALICI elenmiş (hiç OK dönmemiş) PID sayısı. */
  readonly permanentCount: number;
  /** Şu an GEÇİCİ duraklatılmış PID sayısı. */
  readonly pausedCount: number;
  /** En az bir kez veri vermiş PID sayısı — kalıcı elenemezler. */
  readonly everOkCount: number;
  /** Kaç kez toplu eleme (HAT OLAYI) tespit edilip eleme sıfırlandı. */
  readonly bulkResetCount: number;
  /** Son hat olayının tur numarası; -1 = hiç olmadı. */
  readonly lastBulkCycle: number;
  /** Stabilizasyon penceresi hâlâ açık mı (NO_DATA eleme kanıtı sayılmaz). */
  readonly stabilizing: boolean;
  readonly stabilizeCycles: number;
  /** Stabilizasyon penceresinde kanıt sayılmayan NO_DATA adedi. */
  readonly suppressedDuringStabilize: number;
  readonly demoteThreshold: number;
  /** Kalıcı elenmiş PID'ler. */
  readonly permanentPids: readonly string[];
  /** Duraklatılmış PID → kalan tur sayısı. */
  readonly pausedRemainingCycles: Readonly<Record<string, number>>;
  /** Duraklatma merdiveni (tur). */
  readonly pauseLadder: readonly number[];
  /** Eleme sebebi metinleri — LAB'da "neden" cevapsız kalmasın. */
  readonly reasonNeverOk: string;
  readonly reasonPaused: string;
}

let _cached: ExtendedEliminationSnapshot | null = null;
/** 'never' = hiç denenmedi · 'unsupported' = eski APK/web · 'ok' · 'error'. */
let _state: 'never' | 'unsupported' | 'ok' | 'error' = 'never';

export function getExtendedEliminationState(): typeof _state {
  return _state;
}

/**
 * Senkron okuma — `null` = OKUNMADI (eleme yok DEĞİL).
 */
export function getExtendedElimination(): ExtendedEliminationSnapshot | null {
  return _cached;
}

function _num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Native'den tazeler. Fail-soft: hata durumunda önbellek DÜŞÜRÜLÜR (bayat veri sunulmaz). */
export async function refreshExtendedElimination(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !CarLauncher.getObdExtendedElimination) {
    _cached = null;
    _state = 'unsupported';
    return;
  }
  try {
    const r = await CarLauncher.getObdExtendedElimination();
    if (!r || typeof r !== 'object') {
      _cached = null;
      _state = 'error';
      return;
    }
    const paused: Record<string, number> = {};
    const rawPaused = r.pausedRemainingCycles;
    if (rawPaused && typeof rawPaused === 'object') {
      for (const [k, v] of Object.entries(rawPaused as Record<string, unknown>)) {
        paused[k] = _num(v);
      }
    }
    _cached = {
      cycle:          _num(r.cycle),
      watchedCount:   _num(r.watchedCount),
      permanentCount: _num(r.permanentCount),
      pausedCount:    _num(r.pausedCount),
      everOkCount:    _num(r.everOkCount),
      bulkResetCount: _num(r.bulkResetCount),
      lastBulkCycle:  typeof r.lastBulkCycle === 'number' ? r.lastBulkCycle : -1,
      stabilizing:    r.stabilizing === true,
      stabilizeCycles: _num(r.stabilizeCycles),
      suppressedDuringStabilize: _num(r.suppressedDuringStabilize),
      demoteThreshold: _num(r.demoteThreshold),
      permanentPids:  Array.isArray(r.permanentPids) ? r.permanentPids.map(String) : [],
      pausedRemainingCycles: paused,
      pauseLadder:    Array.isArray(r.pauseLadder) ? r.pauseLadder.map(_num) : [],
      reasonNeverOk:  typeof r.reasonNeverOk === 'string' ? r.reasonNeverOk : '',
      reasonPaused:   typeof r.reasonPaused === 'string' ? r.reasonPaused : '',
    };
    _state = 'ok';
  } catch (e) {
    logError('OBD:ExtElimRead', e);
    _cached = null;
    _state = 'error';
  }
}

/** Yalnız testler için. */
export function _resetExtendedEliminationForTest(): void {
  _cached = null;
  _state = 'never';
}
