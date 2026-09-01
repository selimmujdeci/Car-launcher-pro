/**
 * devtoolsCapture.ts — geliştirici ekranlarının YAKALAMA yaşam döngüsü (ref-count · zero-leak).
 *
 * NEDEN: OBD ham trafiği ve CAN kütüğü yalnız bir panel AÇIKKEN toplanır (normal sürüşte
 * sıfır ek yük). Bu mantık daha önce yalnız `DebugPanel` içindeydi; CAROS LAB de aynı
 * kanalı kullandığı için TEK yere alındı. İki panel aynı anda açıksa REF-COUNT sayesinde
 * yakalama iki kez açılmaz ve biri kapanınca diğerininki KAPANMAZ.
 *
 * İKİNCİ MOTOR YOK: burada yeni bir polling/timer başlatılmaz — yalnız MEVCUT native
 * yakalama bayrağı açılır/kapanır ve olaylar mevcut debug store'a köprülenir.
 *
 * DI: tüm dış temaslar `deps` üzerinden → jsdom testinde Capacitor/native gerekmez.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { useDebugStore } from '../debug';
/* ARCH-06/F1 — T0 sayaç (tek tamsayı artırımı). Bu satır hiçbir kararı,
   kadansı ya da sahipliği DEĞİŞTİRMEZ. */
import { bumpPerf } from '../perf/perfCounters';

export interface ObdTrafficEvent {
  readonly ts?:   number;
  readonly cmd:   string;
  readonly resp:  string;
  readonly ms:    number;
}

export interface ObdTrafficCaptureDeps {
  readonly isNative:    () => boolean;
  readonly setCapture:  (enable: boolean) => void;
  readonly addListener: (cb: (e: ObdTrafficEvent) => void) => Promise<{ remove: () => void }>;
  readonly onEntry:     (e: { ts: number; cmd: string; resp: string; ms: number }) => void;
}

/* ── Varsayılan (gerçek) bağımlılıklar ───────────────────────────────────── */

const DEFAULT_OBD_DEPS: ObdTrafficCaptureDeps = {
  isNative:   () => { try { return Capacitor.isNativePlatform(); } catch { return false; } },
  setCapture: (enable) => { try { void CarLauncher.setObdTrafficCapture?.({ enable })?.catch(() => {}); } catch { /* fail-soft */ } },
  addListener: (cb) => CarLauncher.addListener('obdTraffic', (e) => {
    bumpPerf('bridge.obdTraffic.received');
    cb(e as ObdTrafficEvent);
  }),
  onEntry:    (e) => { try { useDebugStore.getState().pushObdTraffic(e); } catch { /* fail-soft */ } },
};

/* ── OBD ham trafik yakalama (ref-count) ─────────────────────────────────── */

let _obdRefs = 0;
let _obdHandle: { remove: () => void } | null = null;
let _obdCancelled = false;
let _obdDeps: ObdTrafficCaptureDeps = DEFAULT_OBD_DEPS;

/**
 * Native OBD trafik yakalamayı açar (ilk çağıran) ve olayları debug store'a köprüler.
 * @returns release — son bırakan yakalamayı KAPATIR (zero-leak). İdempotent.
 */
export function acquireObdTrafficCapture(deps?: Partial<ObdTrafficCaptureDeps>): () => void {
  if (_obdRefs === 0 && deps) _obdDeps = { ...DEFAULT_OBD_DEPS, ...deps };
  const d = _obdDeps;

  _obdRefs++;
  if (_obdRefs === 1) {
    if (!d.isNative()) {
      // Native değil → yakalama yok; yine de ref sayacı simetrik kalsın (release no-op).
      return _makeObdRelease();
    }
    _obdCancelled = false;
    d.setCapture(true);
    d.addListener((e) => {
      d.onEntry({ ts: e.ts || Date.now(), cmd: e.cmd, resp: e.resp, ms: e.ms });
    })
      .then((h) => { if (_obdCancelled) h.remove(); else _obdHandle = h; })
      .catch(() => { /* fail-soft: yakalama yoksa panel yine açılır */ });
  }
  return _makeObdRelease();
}

function _makeObdRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;          // idempotent — çift cleanup ref sayacını bozmaz
    released = true;
    _obdRefs = Math.max(0, _obdRefs - 1);
    if (_obdRefs > 0) return;      // başka tüketici var → kapatma
    _obdCancelled = true;
    _obdHandle?.remove();
    _obdHandle = null;
    try { _obdDeps.setCapture(false); } catch { /* fail-soft */ }
    _obdDeps = DEFAULT_OBD_DEPS;
  };
}

/* ── CAN ham kütük toplama (ref-count) ───────────────────────────────────── */

export interface CanCollectDeps {
  readonly setCollecting: (v: boolean) => void;
}

const DEFAULT_CAN_DEPS: CanCollectDeps = {
  setCollecting: (v) => { try { useDebugStore.getState().setCollecting(v); } catch { /* fail-soft */ } },
};

let _canRefs = 0;
let _canDeps: CanCollectDeps = DEFAULT_CAN_DEPS;

/**
 * CAN ham kütük toplamayı açar; son bırakan KAPATIR. Panel kapalıyken halka tampon
 * dolmaz (normal sürüşte sıfır ek yük).
 */
export function acquireCanCollect(deps?: Partial<CanCollectDeps>): () => void {
  if (_canRefs === 0 && deps) _canDeps = { ...DEFAULT_CAN_DEPS, ...deps };
  _canRefs++;
  if (_canRefs === 1) _canDeps.setCollecting(true);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    _canRefs = Math.max(0, _canRefs - 1);
    if (_canRefs > 0) return;
    try { _canDeps.setCollecting(false); } catch { /* fail-soft */ }
    _canDeps = DEFAULT_CAN_DEPS;
  };
}

/** @internal testler için — modül durumunu sıfırlar. */
export function _resetDevtoolsCaptureForTest(): void {
  _obdRefs = 0; _obdHandle = null; _obdCancelled = false; _obdDeps = DEFAULT_OBD_DEPS;
  _canRefs = 0; _canDeps = DEFAULT_CAN_DEPS;
}

/** @internal teşhis — açık tüketici sayıları. */
export function _devtoolsCaptureRefs(): { obd: number; can: number } {
  return { obd: _obdRefs, can: _canRefs };
}

/**
 * Yakalama kanallarının SALT-OKUNUR durumu (Session Inspector okur).
 * Yan etkisiz: hiçbir kanalı açmaz/kapatmaz, yalnız ref sayaçlarını yansıtır.
 */
export function getDevtoolsCaptureStatus(): { obdRefs: number; canRefs: number } {
  return { obdRefs: _obdRefs, canRefs: _canRefs };
}
