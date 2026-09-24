/**
 * curveAdvisoryRuntime — öndeki virajın önerisini ekranlara yayınlar ve
 * gerektiğinde BİR KEZ seslendirir.
 *
 * Karar `core/curveAdvisoryModel`de (saf). Burada yalnız:
 *  · güncel öneri (tek kaynak — harita, mini harita ve sürüş ekranı aynı değeri okur),
 *  · "bu viraj söylendi mi" defteri (oturum + rota revizyonu + tepe noktası).
 * Ses kuralı: araç önerinin `CURVE_VOICE_MARGIN_KMH` fazlasından hızlıysa ve
 * viraja `max(150 m, 7 sn)` kaldıysa — yavaş giden sürücü rahatsız edilmez.
 * Besleme yalnız GERÇEK GPS tick'inden (DR tahmini viraj anonsu üretmez).
 */
import { useSyncExternalStore } from 'react';
import { speakNavigation } from '../ttsService';
import { decideCurveAdvisory, type CurveAdvisory } from './core/curveAdvisoryModel';

export const CURVE_VOICE_MARGIN_KMH = 10;
export const CURVE_LOOKAHEAD_MIN_M = 400;
export const CURVE_LOOKAHEAD_S = 15;

let _current: CurveAdvisory | null = null;
const _listeners = new Set<() => void>();
let _routeKey = '';
let _announced = new Set<number>();

function _publish(next: CurveAdvisory | null): void {
  const same = next === _current || (next !== null && _current !== null
    && next.advisoryKmh === _current.advisoryKmh && next.direction === _current.direction
    && Math.round(next.distanceM / 10) === Math.round(_current.distanceM / 10));
  _current = next;
  if (!same) for (const l of [..._listeners]) { try { l(); } catch { /* fail-soft */ } }
}

export interface CurveTickInput {
  readonly sessionId: number;
  readonly routeRevision: number;
  readonly geometry: readonly [number, number][] | null;
  readonly cumulativeDistances: ArrayLike<number> | null;
  readonly vehicleAlongRemainingM: number | null;
  readonly maneuverAlongRemainingM: readonly number[];
  readonly limitKmh: number | null;
  readonly speedKmh: number | null;
}

/** Bir GPS tick'ini işler; anons yapıldıysa metni döndürür. */
export function noteCurveTick(i: CurveTickInput, speak: (t: string) => void = speakNavigation): string | null {
  const key = `${i.sessionId}:${i.routeRevision}`;
  if (key !== _routeKey) { _routeKey = key; _announced = new Set(); }
  const v = i.speedKmh !== null && Number.isFinite(i.speedKmh) ? i.speedKmh : null;
  const lookahead = Math.max(CURVE_LOOKAHEAD_MIN_M, ((v ?? 0) / 3.6) * CURVE_LOOKAHEAD_S);
  const a = decideCurveAdvisory({
    geometry: i.geometry, cumulativeDistances: i.cumulativeDistances,
    vehicleAlongRemainingM: i.vehicleAlongRemainingM, lookaheadM: lookahead,
    maneuverAlongRemainingM: i.maneuverAlongRemainingM, limitKmh: i.limitKmh,
  });
  _publish(a);
  if (!a || v === null) return null;
  const id = Math.round(a.apexAlongRemainingM);
  if (_announced.has(id)) return null;
  const voiceWindow = Math.max(150, (v / 3.6) * 7);
  if (a.distanceM > voiceWindow || v <= a.advisoryKmh + CURVE_VOICE_MARGIN_KMH) return null;
  _announced.add(id);
  const side = a.direction === 'right' ? 'sağ' : 'sol';
  const where = a.distanceM >= 50 ? `${Math.round(a.distanceM / 50) * 50} metre sonra keskin ${side} viraj` : `Keskin ${side} viraj`;
  const text = `${where}, hızınızı ${a.advisoryKmh}'${datSuffix(a.advisoryKmh)} düşürün.`;
  try { speak(text); } catch { /* TTS yoksa sessiz */ }
  return text;
}

/** Onlu sayının yönelme eki (Türkçe ünlü uyumu): 20'ye · 30'a · 40'a · 50'ye · 60'a · 70'e · 80'e. */
export function datSuffix(n: number): string {
  const tens: Record<number, string> = { 1: 'a', 2: 'ye', 3: 'a', 4: 'a', 5: 'ye', 6: 'a', 7: 'e', 8: 'e', 9: 'a' };
  return tens[Math.floor(n / 10) % 10] ?? 'a';
}

/** Navigasyon bitti → öneri kalkar. */
export function resetCurveAdvisory(): void {
  _routeKey = ''; _announced = new Set(); _publish(null);
}

export function getCurveAdvisory(): CurveAdvisory | null { return _current; }

function _subscribe(l: () => void): () => void { _listeners.add(l); return () => { _listeners.delete(l); }; }

/** Ekranlar için: güncel viraj önerisi (yoksa null). */
export function useCurveAdvisory(): CurveAdvisory | null {
  return useSyncExternalStore(_subscribe, getCurveAdvisory, getCurveAdvisory);
}
