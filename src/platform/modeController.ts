/**
 * ModeController — Navigation mode state machine.
 *
 * Modes:
 *   STANDARD_NAVIGATION  — Map always full-opacity background, standard HUD.
 *   HYBRID_AR_NAVIGATION — Camera feed background, map semi-transparent, AR canvas overlay.
 *
 * Transition rule (evaluated whenever VisionState changes or user preference changes):
 *   IF visionState === 'active'
 *      AND userPreference ≠ 'standard'
 *     → HYBRID_AR_NAVIGATION
 *   ELSE
 *     → STANDARD_NAVIGATION
 *
 * 'degraded' vision (camera up but detection failing) stays in HYBRID so the camera
 * feed remains visible — the last good detection result is reused.
 *
 * Transition is smooth: only CSS opacity values change, nothing is unmounted.
 * A `transitioning` flag is true for 500ms so components can suppress pointer events.
 */

import { create } from 'zustand';
import { useEffect } from 'react';
import { useVisionStore, type VisionState } from './visionStore';

/* ─────────────────────────────────────────────────────────────── */
/* TYPES                                                           */
/* ─────────────────────────────────────────────────────────────── */

export type NavMode = 'STANDARD_NAVIGATION' | 'HYBRID_AR_NAVIGATION';
export type UserVisionPref = 'auto' | 'standard' | 'hybrid';

interface ModeStore {
  mode: NavMode;
  /** True during the CSS cross-fade window (≤500ms) */
  transitioning: boolean;
  userPreference: UserVisionPref;
}

/* ─────────────────────────────────────────────────────────────── */
/* STORE                                                           */
/* ─────────────────────────────────────────────────────────────── */

const useModeStore = create<ModeStore>(() => ({
  mode: 'STANDARD_NAVIGATION',
  transitioning: false,
  userPreference: 'standard',
}));

/* ─────────────────────────────────────────────────────────────── */
/* TRANSITION LOGIC                                                */
/* ─────────────────────────────────────────────────────────────── */

const TRANSITION_MS = 500;   // must match CSS transition duration
let _transitionTimer: ReturnType<typeof setTimeout> | null = null;

function _resolveMode(
  visionState: VisionState,
  pref: UserVisionPref,
  confidence: number,
): NavMode {
  if (pref === 'standard') return 'STANDARD_NAVIGATION';

  const visionReady = visionState === 'active' || visionState === 'degraded';

  /* ── KULLANICI AÇIKÇA İSTEDİ → KAMERA GÖSTERİLİR ────────────────────────
   * SAHA KUSURU (cihazda ölçüldü 2026-08-03): kullanıcı AR'a bastığında
   * kamera GERÇEKTEN açılıyordu (video: srcObject var · track 'live' ·
   * 1280×720 · readyState 4) ama ekranda hiçbir şey görünmüyordu, çünkü
   * `confidence < 0.5` kapısı modu STANDARD'a çeviriyor ve video katmanının
   * opacity'si 0 kalıyordu. Kullanıcı kamerayı açıyor, pil/ısı harcanıyor,
   * karşılığında hiçbir şey görmüyordu — üstelik nedeni de söylenmiyordu.
   *
   * Dahası kapı YAPISAL olarak aşılamıyordu: güven formülü
   * `0.60·şerit + 0.25·kare + 0.15·tabela` olduğundan şerit çizgisi
   * GÖRÜLMEYEN bir yolda skor en fazla ~0.40'a çıkabilir. Türkiye'de
   * mahalle sokaklarının çoğunda şerit çizgisi YOKTUR → AR o yollarda
   * hiçbir zaman açılamazdı.
   *
   * AYRIM: "kamerayı görmek" ile "AR çiziminin doğruluğu" AYRI şeylerdir.
   * Güven kapısı yalnız AR ÇİZİMİNİ (canvas) ilgilendirir — o zaten ayrıca
   * `canvasOpacity` ile güvene bağlıdır (bkz. VisionOverlay). Kamera
   * görüntüsü, tespit çalışmasa bile sürücüye faydalıdır ve kullanıcının
   * AÇIK tercihidir; otomatik bir kalite ölçütü bu tercihi EZEMEZ. */
  if (pref === 'hybrid') return visionReady ? 'HYBRID_AR_NAVIGATION' : 'STANDARD_NAVIGATION';

  /* ── OTOMATİK mod MUHAFAZAKÂRDIR ────────────────────────────────────────
   * Kendiliğinden kameraya geçmek için tespit güveni yeterli olmalı;
   * güvenilmez AR'ı kullanıcı istemeden açmak yanıltıcı olur. */
  if (confidence < 0.5) return 'STANDARD_NAVIGATION';
  if (pref === 'auto' && visionState === 'active') return 'HYBRID_AR_NAVIGATION';

  return 'STANDARD_NAVIGATION';
}

/** Called whenever VisionState, confidence, or user preference changes. */
export function applyModeUpdate(visionState: VisionState): void {
  const { mode: current, userPreference } = useModeStore.getState();
  const confidence = useVisionStore.getState().confidence;
  const target = _resolveMode(visionState, userPreference, confidence);

  if (target === current) return;

  // Start transition
  if (_transitionTimer) clearTimeout(_transitionTimer);
  useModeStore.setState({ mode: target, transitioning: true });

  _transitionTimer = setTimeout(() => {
    useModeStore.setState({ transitioning: false });
    _transitionTimer = null;
  }, TRANSITION_MS);
}

/* ─────────────────────────────────────────────────────────────── */
/* PUBLIC API                                                      */
/* ─────────────────────────────────────────────────────────────── */

/** Set user preference and immediately re-evaluate mode. */
export function setUserVisionPreference(pref: UserVisionPref): void {
  useModeStore.setState({ userPreference: pref });
  applyModeUpdate(useVisionStore.getState().state);
}

/* ─────────────────────────────────────────────────────────────── */
/* REACT HOOKS                                                     */
/* ─────────────────────────────────────────────────────────────── */

export function useNavMode(): NavMode {
  return useModeStore((s) => s.mode);
}

export function useTransitioning(): boolean {
  return useModeStore((s) => s.transitioning);
}

export function useUserVisionPref(): UserVisionPref {
  return useModeStore((s) => s.userPreference);
}

/**
 * Sync hook — subscribes to VisionState and forwards every change
 * to applyModeUpdate(). Mount this ONCE inside FullMapView when
 * navigation is active.
 */
export function useModeSync(): void {
  const visionState  = useVisionStore((s) => s.state);
  const confidence   = useVisionStore((s) => s.confidence);
  useEffect(() => {
    applyModeUpdate(visionState);
  }, [visionState, confidence]);
}

/* ─────────────────────────────────────────────────────────────── */
/* HMR CLEANUP                                                     */
/* ─────────────────────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_transitionTimer) clearTimeout(_transitionTimer);
    useModeStore.setState({ mode: 'STANDARD_NAVIGATION', transitioning: false });
  });
}
