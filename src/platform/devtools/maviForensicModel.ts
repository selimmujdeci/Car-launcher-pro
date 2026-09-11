/**
 * maviForensicModel.ts — Mavi ÇAPRAZ-KESEN anomali tespiti + olay zaman çizelgesi.
 *
 * ── NE ÇÖZER ────────────────────────────────────────────────────────────────
 * Her Mavi alt sistemi (wake/turn/speech/tts/latency/action) kendi tanı yüzeyini
 * ZATEN yayınlıyor (bkz. `maviConsoleModel`/`maviLatencyModel`/`maviActionTrace`).
 * Ama "bu sinyaller BİRLİKTE ne anlama geliyor" sorusunu cevaplayan TEK bir yer
 * yoktu — kullanıcı LAB'da 6 ayrı ekrana bakıp kendisi bağlamak zorundaydı.
 * Bu dosya YENİ ölçüm YAPMAZ: yalnız zaten toplanmış `MaviRawSnapshot`ı okuyup
 * adı konmuş, kanıt gerektiren sonuçlar çıkarır.
 *
 * ── YENİ OTORİTE DEĞİLDİR ───────────────────────────────────────────────────
 *  · SAF: I/O yok · timer yok · `Date.now()` yok · React importu yok.
 *  · Hiçbir state YAZMAZ, hiçbir kararı DEĞİŞTİRMEZ — salt-okunur projeksiyon.
 *  · Girdi tipleri (`MaviRawSnapshot`) TİP-ONLY import edilir (çalışma zamanı
 *    bağımlılığı yoktur).
 *
 * ── KAPSAM DÜRÜSTLÜĞÜ ───────────────────────────────────────────────────────
 * Aşağıdaki anomali listesi "istenebilecek her şey" değil, GERÇEK bir karar
 * noktası/sayaç ile desteklenen sınıflardır. Native-only sinyaller (mikrofon
 * izni kaybı, duplicate wake listener, audio focus çakışması, wake modeli
 * hazır-ama-recorder-durmuş) JS'ten GÖZLEMLENEMEZ — bu dosya onları UYDURMAZ,
 * tespit etmez. Yeni bir native sayaç eklenirse bu dosya genişletilir.
 */

import type { MaviRawSnapshot } from './maviConsoleModel';
import { computeStat, type LatencyStat } from './maviLatencyModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Anomali tespiti
 * ════════════════════════════════════════════════════════════════════════ */

export type MaviAnomalySeverity = 'info' | 'warn' | 'critical';

export type MaviAnomalyId =
  /** SLA sınıfının p95'i kendi hedefini AŞTI (mevcut hedef/istatistikten). */
  | 'FIRST_AUDIO_TOO_SLOW'
  /** TTS motoru "bitti" dedi ama süre cümlenin fiziksel alt sınırının ALTINDA. */
  | 'TTS_DONE_BEFORE_LAST_SEGMENT'
  /** TTS motoru emniyet süresi boyunca HİÇ cevap vermedi. */
  | 'TTS_ENGINE_SILENT'
  /** Wake kabul edildi ama komuta/cevaba DÖNMEDİ (sessiz kayıp). */
  | 'WAKE_ACCEPTED_INTENT_NOT_REACHED'
  /** Eylem kapısı "allowed" dedi ama zincirde sonuç (result) aşaması YOK. */
  | 'ACTION_DISPATCH_NO_RESULT'
  /** AI devre kesici bloke — sağlayıcıya YENİ istek gitmiyor. */
  | 'AI_PROVIDER_CIRCUIT_BLOCKED'
  /** Eskimiş nesil sonucu/eylemi GUARD tarafından yakalandı (bilgi amaçlı). */
  | 'STALE_GENERATION_CALLBACK'
  /** TTS çalarken mikrofon açık VE echo referansı KANITLANMAMIŞ (self-echo riski). */
  | 'TTS_CAPTURE_OPEN_UNPROTECTED';

export interface MaviAnomalyRecord {
  readonly id: MaviAnomalyId;
  readonly severity: MaviAnomalySeverity;
  /** Makine-okur kanıt özeti — SERBEST METİN DEĞİL (yalnız sayı/kod). */
  readonly evidence: string;
}

function _push(
  out: MaviAnomalyRecord[], id: MaviAnomalyId, severity: MaviAnomalySeverity, evidence: string,
): void {
  out.push(Object.freeze({ id, severity, evidence }));
}

/**
 * `MaviRawSnapshot`ı okuyup bounded anomali listesi üretir. Kanıt yoksa o
 * sınıf listeye HİÇ GİRMEZ (susma = "gözlemlenmedi", "sağlıklı" İDDİA EDİLMEZ).
 */
export function detectMaviAnomalies(s: MaviRawSnapshot | null | undefined): readonly MaviAnomalyRecord[] {
  const out: MaviAnomalyRecord[] = [];
  if (!s) return Object.freeze(out);

  const tts = s.ttsEngine;
  if (tts) {
    if (tts.suspectInstantDone > 0) {
      _push(out, 'TTS_DONE_BEFORE_LAST_SEGMENT', 'warn', `suspectInstantDone=${tts.suspectInstantDone}`);
    }
    if (tts.noEngineReport > 0) {
      _push(out, 'TTS_ENGINE_SILENT', 'critical', `noEngineReport=${tts.noEngineReport}`);
    }
  }

  const wf = s.wakeForensics;
  if (wf && (wf.acceptedNoIntent > 0 || wf.pendingAcceptAgeMs !== null)) {
    _push(
      out, 'WAKE_ACCEPTED_INTENT_NOT_REACHED', wf.pendingAcceptAgeMs !== null ? 'critical' : 'warn',
      `acceptedNoIntent=${wf.acceptedNoIntent}`
      + (wf.pendingAcceptAgeMs !== null ? ` pendingAcceptAgeMs=${Math.round(wf.pendingAcceptAgeMs)}` : ''),
    );
  }

  const ai = s.aiHealth;
  if (ai && (ai.healthy === false || ai.blockedForMs > 0)) {
    _push(
      out, 'AI_PROVIDER_CIRCUIT_BLOCKED', 'warn',
      `healthy=${ai.healthy} blockedForMs=${ai.blockedForMs} `
      + `consecFails=${ai.consecFails} consecTimeouts=${ai.consecTimeouts}`,
    );
  }

  const turn = s.turn;
  if (turn && (turn.staleProviderResultsDropped > 0 || turn.staleActionsPrevented > 0)) {
    _push(
      out, 'STALE_GENERATION_CALLBACK', 'info',
      `staleProviderResultsDropped=${turn.staleProviderResultsDropped} `
      + `staleActionsPrevented=${turn.staleActionsPrevented}`,
    );
  }

  const b = s.bargeIn;
  if (b && b.captureOpenDuringTts === true && b.echoReferenceWired === false) {
    _push(
      out, 'TTS_CAPTURE_OPEN_UNPROTECTED', 'warn',
      `duplexClass=${b.duplexClass} captureOpenDuringTts=true echoReferenceWired=false`,
    );
  }

  const lat = s.latency;
  if (lat) {
    for (const cls of lat.slaClasses) {
      if (cls.meetsTarget === false) {
        _push(
          out, 'FIRST_AUDIO_TOO_SLOW', cls.slaClass === 'CLOUD' ? 'warn' : 'critical',
          `slaClass=${cls.slaClass} evidence=${cls.evidence} `
          + `p95Ms=${cls.p95Ms} targetP95Ms=${cls.targetP95Ms}`,
        );
      }
    }
  }

  const at = s.actionTrace;
  if (at && at.dispatchWithoutResult > 0) {
    _push(out, 'ACTION_DISPATCH_NO_RESULT', 'critical', `dispatchWithoutResult=${at.dispatchWithoutResult}`);
  }

  return Object.freeze(out);
}

/* ══════════════════════════════════════════════════════════════════════════
 * EYLEM/ARAÇ TUR SÜRESİ — P0-MAVI-FORENSIC-DEVICE-1
 * ════════════════════════════════════════════════════════════════════════
 * SAHA (2026-09-11): `maviLatencyTrace`in ince damga zinciri bu cihazda/yolda
 * boştu (`speech_end` kanıtı YOK — bkz. `deriveLatencyBottleneck` başlığı),
 * ama `maviActionTrace`in ZATEN yazdığı `turn_started`/`speech` aşamaları
 * turn_id ile eşleşiyor ve TAMAMEN BAĞIMSIZ bir kanıt veriyor: elle hesaplanan
 * saha örneğinde tur1 9,8 sn · tur2 21,0 sn · tur3 16,6 sn sürdü. Bu fonksiyon
 * o hesabı KALICI hale getirir — yeni ölçüm YAPMAZ, var olan iki aşamanın
 * zaman farkını alır.
 */
export interface MaviActionTurnLatencyInput {
  readonly stage: string;
  readonly turnId: number | null;
  readonly atMs: number;
}

/**
 * `turn_started → speech` (aynı turnId) toplam süresi. `maviLatencyTrace`
 * damgalarından BAĞIMSIZDIR — ince zincir boş olsa bile çalışır.
 */
export function deriveActionTurnLatency(
  records: readonly MaviActionTurnLatencyInput[] | null | undefined,
): LatencyStat {
  if (!Array.isArray(records)) return computeStat([]);
  const started = new Map<number, number>();
  const samples: number[] = [];
  for (const r of records) {
    if (!r || typeof r.turnId !== 'number' || typeof r.atMs !== 'number' || !Number.isFinite(r.atMs)) continue;
    if (r.stage === 'turn_started') {
      // Aynı turnId için İLK gerçekleşme korunur (M5 tek otorite — mükerrer beklenmez,
      // ama savunmacı davranış fail-closed'dır).
      if (!started.has(r.turnId)) started.set(r.turnId, r.atMs);
    } else if (r.stage === 'speech' && started.has(r.turnId)) {
      const t0 = started.get(r.turnId) as number;
      const d = r.atMs - t0;
      if (d >= 0) samples.push(d);
      started.delete(r.turnId); // her tur TEK örnek üretir
    }
  }
  return computeStat(samples);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Olay zaman çizelgesi — SAF BİRLEŞTİRME (yeni kayıt YOK)
 * ════════════════════════════════════════════════════════════════════════
 * Yalnız `Date.now()` tabanlı defterler (wake · action) birleştirilir. Gecikme
 * damgaları (`maviLatencyTrace`) `performance.now()` (MONOTONİK) kullanır —
 * FARKLI saat düzlemidir; buraya KARIŞTIRILMAZ (yanlış kronoloji üretilmez).
 * Ayrı bir "iz" ihtiyacı için mevcut `buildFieldTraceLines`/`buildMarkRows`
 * (maviLatencyModel) kullanılır.
 */

export type MaviTimelineSource = 'wake' | 'action';

export interface MaviTimelineEvent {
  readonly atMs: number;
  readonly source: MaviTimelineSource;
  /** Bounded kod birleşimi — serbest metin/transkript TAŞIMAZ. */
  readonly label: string;
}

export interface MaviTimelineWakeInput {
  readonly atMs: number;
  readonly reason: string;
  readonly path: string;
}

export interface MaviTimelineActionInput {
  readonly atMs: number;
  readonly stage: string;
  readonly status: string;
  readonly reason: string;
  readonly turnId: number | null;
}

export const MAVI_TIMELINE_MAX = 80;

/** En yeni olay BAŞTA — diğer tüm Mavi tablo/iz çıktılarıyla AYNI kural. */
export function buildMaviEventTimeline(
  wake: readonly MaviTimelineWakeInput[] | null | undefined,
  actions: readonly MaviTimelineActionInput[] | null | undefined,
  limit: number = MAVI_TIMELINE_MAX,
): readonly MaviTimelineEvent[] {
  const rows: MaviTimelineEvent[] = [];
  if (Array.isArray(wake)) {
    for (const w of wake) {
      if (!w || typeof w.atMs !== 'number' || !Number.isFinite(w.atMs)) continue;
      rows.push(Object.freeze({
        atMs: w.atMs, source: 'wake' as const,
        label: `wake:${w.reason || 'UNKNOWN'}@${w.path || 'UNKNOWN'}`,
      }));
    }
  }
  if (Array.isArray(actions)) {
    for (const a of actions) {
      if (!a || typeof a.atMs !== 'number' || !Number.isFinite(a.atMs)) continue;
      const turnPart = a.turnId !== null ? ` turn=${a.turnId}` : '';
      const reasonPart = a.reason ? `(${a.reason})` : '';
      rows.push(Object.freeze({
        atMs: a.atMs, source: 'action' as const,
        label: `${a.stage}:${a.status}${reasonPart}${turnPart}`,
      }));
    }
  }
  rows.sort((x, y) => y.atMs - x.atMs);
  return Object.freeze(rows.slice(0, Math.max(0, limit)));
}
