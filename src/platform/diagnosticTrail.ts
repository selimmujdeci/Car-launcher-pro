/**
 * diagnosticTrail.ts — merkezi olay izi (breadcrumb) · "soruna ne yol açtı".
 *
 * GENİŞLİK BACKBONE'U (kullanıcı: rapor herhangi bir sınıf sorunu yakalayacak
 * genişlikte olsun). Tanı raporuna, sorunun ÖNCESİNDEKİ olayların KRONOLOJİK
 * hikâyesini ekler — böylece "modal zamansız açıldı", "sürüşe geçince kasma
 * oldu", "OBD kopunca hata patladı" gibi NEDEN-SONUÇ zincirleri görülebilir.
 *
 * MERKEZİ + DÜŞÜK-TEMAS: her alt sisteme dokunmaz. Kendi halka tamponuna
 * doğrudan yazılanlar (mod/ekran/aksiyon) + snapshot anında BİRLEŞTİRİLEN
 * mevcut kaynaklar (crashLogger hataları + uiActivityRecorder modal olayları).
 * Hepsi Date.now damgalı → tek zaman çizgisinde harmanlanır.
 *
 * PII yok: yalnız olay türü + kısa etiket (konum/VIN/plaka/MAC yok).
 */

import { useUnifiedVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { getOBDStatusSnapshot }   from './obdService';
import { getErrorLog }            from './crashLogger';
import { getUiActivitySnapshot }  from './uiActivityRecorder';
import {
  type TrailEvent, pushOwn, getOwnTrail, resetOwnTrail,
} from './diagnosticTrailCore';

// Yazma yolu (pushTrail) çekirdekten re-export edilir — geriye dönük uyumluluk;
// AMA üreticiler (voiceService/media) doğrudan `diagnosticTrailCore`'dan import
// etmeli ki ağır obd/store zinciri modül grafiğine girmesin.
export { pushTrail } from './diagnosticTrailCore';
export type { TrailEvent, TrailKind } from './diagnosticTrailCore';

/* ── Modül durumu ───────────────────────────────────────────── */

const MAX_OUT = 60;   // dışa verilen birleşik iz uzunluğu
// 🔴 HİSTEREZİS + DWELL (SAHA 2026-07-06): tek eşik (speed>5) hız 5 civarı
// titreyince (GPS gürültüsü / durağan araç) ~1-2sn'de bir "sürüş↔park" satırı
// üretip izi BOĞUYORDU (sinyal kaybı). Bant (ON≥8, OFF≤3) küçük jitter'ı yutar;
// min-dwell son mod-logundan bu yana 4sn geçmeden yeni geçiş YAZMAZ → iz
// yalnız ANLAMLI mod değişimini gösterir.
const DRIVE_ON_KMH  = 8;
const DRIVE_OFF_KMH = 3;
const MODE_DWELL_MS = 4_000;

let _installed = false;
let _unsub: (() => void) | null = null;

// Geçiş tespiti için önceki durum
let _prevReverse = false;
let _prevDriving = false;
let _lastModeMono = Number.NEGATIVE_INFINITY;  // son mod-logunun monotonik damgası (dwell throttle)

function _mono(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now() : Date.now();
}
let _prevObdSource = 'none';

/* ── Kurulum ────────────────────────────────────────────────── */

/**
 * İzi başlatır. SystemBoot Wave 1'de çağrılır. Store'a abone olup mod/OBD
 * geçişlerini kaydeder. İdempotent; dönen cleanup aboneliği söker (zero-leak).
 */
export function startDiagnosticTrail(): () => void {
  if (_installed) return () => { /* zaten kurulu */ };
  _installed = true;
  pushOwn('boot', 'boot başladı');

  try {
    const st = useUnifiedVehicleStore.getState();
    _prevReverse = st.reverse;
    _prevDriving = (st.speed ?? 0) >= DRIVE_ON_KMH;
    _prevObdSource = safeObdSource();
  } catch { /* fail-soft */ }

  try {
    _unsub = useUnifiedVehicleStore.subscribe((state) => {
      // Geri vites geçişi
      if (state.reverse !== _prevReverse) {
        _prevReverse = state.reverse;
        pushOwn('mode', state.reverse ? 'geri vitese geçildi' : 'geri vites bırakıldı');
      }
      // Sürüş/park geçişi — histerezis bandı (ON≥8, OFF≤3) + min-dwell throttle
      // (eşik jitter'ı izi boğmasın; yalnız SÜRDÜRÜLEN geçiş yazılır).
      const spd = state.speed ?? 0;
      let driving = _prevDriving;
      if (!_prevDriving && spd >= DRIVE_ON_KMH)      driving = true;
      else if (_prevDriving && spd <= DRIVE_OFF_KMH) driving = false;
      if (driving !== _prevDriving) {
        const now = _mono();
        if (now - _lastModeMono >= MODE_DWELL_MS) {
          _prevDriving  = driving;
          _lastModeMono = now;
          pushOwn('mode', driving ? 'sürüşe geçildi' : 'durdu/park');
        }
        // dwell dolmadıysa geçişi YAZMA + _prevDriving'i çevirme → titreme yutulur
      }
      // OBD kaynak değişimi (bağlan/kopma) — getOBDStatusSnapshot ucuz (cache)
      const src = safeObdSource();
      if (src !== _prevObdSource) {
        pushOwn('obd', `OBD kaynak: ${_prevObdSource} → ${src}`);
        _prevObdSource = src;
      }
    });
  } catch { /* fail-soft — abonelik kurulamazsa iz yine manuel/merge çalışır */ }

  return () => {
    if (_unsub) { _unsub(); _unsub = null; }
    resetOwnTrail();
    _lastModeMono = Number.NEGATIVE_INFINITY;
    _installed = false;
  };
}

function safeObdSource(): string {
  try { return getOBDStatusSnapshot().source; } catch { return 'none'; }
}

/* ── Okuma: birleşik kronolojik iz (tanı payload'ı) ──────────── */

/**
 * Kendi izini + crashLogger hatalarını + modal olaylarını TEK zaman çizgisinde
 * harmanlar, son MAX_OUT olayı döndürür (kronolojik).
 */
export function getDiagnosticTrail(): TrailEvent[] {
  const merged: TrailEvent[] = getOwnTrail();

  // Hatalar (tümü — critical dışı dahil)
  try {
    for (const e of getErrorLog()) {
      merged.push({
        ts: e.ts, kind: 'error',
        label: `[${e.severity ?? 'error'}] ${String(e.ctx).slice(0, 40)}`,
        detail: String(e.msg).slice(0, 120),
      });
    }
  } catch { /* fail-soft */ }

  // Modal/overlay olayları (uiActivityRecorder)
  try {
    for (const m of getUiActivitySnapshot().recent) {
      merged.push({
        ts: m.ts, kind: 'modal',
        label: `${m.action === 'open' ? 'modal açıldı' : 'modal kapandı'}${m.untimely ? ' ⚠ZAMANSIZ' : ''}`,
        detail: `${m.desc}${m.reasons.length ? ' [' + m.reasons.join(',') + ']' : ''}`,
      });
    }
  } catch { /* fail-soft */ }

  merged.sort((a, b) => a.ts - b.ts);
  return merged.slice(-MAX_OUT);
}

/** @internal testler için. */
export function _resetDiagnosticTrailForTest(): void {
  resetOwnTrail();
  _prevReverse = false;
  _prevDriving = false;
  _lastModeMono = Number.NEGATIVE_INFINITY;
  _prevObdSource = 'none';
}
