/**
 * tunnelNightRuntime — tünel kanıtını harita gün/gece örtüsüne bağlayan KÖPRÜ.
 *
 * Bu dosya bir DEDEKTÖR DEĞİLDİR ve bir OTORİTE DEĞİLDİR. İki mevcut sahibi
 * birbirine bağlar, o kadar:
 *
 *   `autoBrightnessService`  (tünel kanıtı — far + güneş fazı)
 *            │  onTunnelModeChange
 *            ▼
 *   `mapSourceManager`       (gün/gece otoritesi — örtü `setMapNight` hunisinde)
 *            │  değişim VARSA
 *            ▼
 *   `applyMapDayNight`       (canlı boyama — mevcut tek geçiş yolu)
 *
 * ── YAPMADIKLARI (pazarlıksız) ────────────────────────────────────────────
 *  · Yeni tünel dedektörü YOK — karar `autoBrightnessService`in.
 *  · GPS kaybı tünel kanıtı SAYILMAZ — bu dosya GPS'e HİÇ dokunmaz.
 *  · `settings.dayNightMode` YAZILMAZ — örtü ayarın ÜSTÜNDEDİR
 *    (`useDayNightManager.checkTime()` 60 sn'de ayarı geri zorlar; ayara
 *    yazmak flicker döngüsü demekti).
 *  · Yeni timer / polling / abonelik çoğaltma YOK — tek dinleyici, yayın
 *    mevcut OBD far callback'inde gerçekleşir.
 *  · Rota rengine dokunulmaz: PR-3b `resolveLightBasemap()` zaten
 *    `getMapNight()` okur ve o değer artık ETKİN değerdir → gece paleti
 *    kendiliğinden ve DEĞİŞTİRİLMEDEN uygulanır.
 */

import { onTunnelModeChange } from '../autoBrightnessService';
import { setTunnelNightOverride, getRequestedMapNight } from '../mapSourceManager';
import { applyMapDayNight } from './MapLayerManager';

let _unsub: (() => void) | null = null;
let _started = false;
/** Kaç kez GERÇEK bir geçiş uygulandı (gözlem — gereksiz boyama sayılmaz). */
let _transitions = 0;

function _onTunnel(active: boolean): void {
  try {
    /* İdempotent kapı: durum aynıysa ya da etkin gece zaten doğruysa
       (ör. gerçek gece vaktinde tünele girmek) `false` döner → BOYAMA YOK. */
    const changed = setTunnelNightOverride(active);
    if (!changed) return;
    _transitions++;
    /* Boyama İSTEK değeriyle çağrılır; etkin değer huninin içinde yeniden
       hesaplanır (örtü uygulanır). Böylece örtü kalkınca kullanıcının/saatin
       istediği duruma DÖNÜLÜR — ayrı bir "eski değeri hatırla" defteri YOK. */
    applyMapDayNight(getRequestedMapNight());
  } catch { /* köprü hatası parlaklığı ve haritayı ASLA bozmaz */ }
}

/** İdempotent. TEK dinleyici kurar (yeni timer YOK). */
export function startTunnelNightRuntime(): void {
  if (_started) return;
  _started = true;
  try {
    _unsub = onTunnelModeChange(_onTunnel);
  } catch { /* fail-soft — köprü kurulamazsa harita bugünkü gibi çalışır */ }
}

/** Aboneliği söker ve örtüyü KALDIRIR (asılı gece haritası bırakmaz). */
export function stopTunnelNightRuntime(): void {
  if (!_started) return;
  _started = false;
  if (_unsub) { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  try {
    if (setTunnelNightOverride(false)) applyMapDayNight(getRequestedMapNight());
  } catch { /* ignore */ }
}

/** Gözlem — köprü ayakta mı. */
export function isTunnelNightRuntimeRunning(): boolean { return _started; }

/** Gözlem — uygulanan GERÇEK geçiş sayısı (tekrarlı bildirimler sayılmaz). */
export function getTunnelNightTransitionCount(): number { return _transitions; }

/** @internal testler için. */
export function _resetTunnelNightRuntimeForTest(): void {
  _started = false;
  if (_unsub) { try { _unsub(); } catch { /* ignore */ } _unsub = null; }
  _transitions = 0;
}
