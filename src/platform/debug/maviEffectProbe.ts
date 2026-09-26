/**
 * maviEffectProbe — YALNIZ geliştirici derlemesi (Mavi smoke testi).
 *
 * Mavi'nin ne SÖYLEDİĞİ değil ne YAPTIĞI: komuttan önce/sonra okunan salt
 * durum özeti. Hiçbir şey yazmaz, yeni otorite kurmaz; mevcut sahiplerin
 * snapshot getter'larını okur.
 */
import { getNavigationState } from '../navigationService';
import { getRouteState } from '../routingService';
import { getMediaState } from '../mediaService';
import { useStore } from '../../store/useStore';
import { getOwnTrail } from '../diagnosticTrailCore';
import { useCarTheme } from '../../store/useCarTheme';
import { getActiveSource } from '../media/authority/mediaCommandGateway';

export function readMaviEffects(): Record<string, unknown> {
  const nav = getNavigationState();
  const route = getRouteState();
  const media = getMediaState();
  const s = useStore.getState().settings;
  return {
    navStatus: nav.status,
    navDest: nav.destination?.name ?? null,
    routePts: route.geometry?.length ?? 0,
    routeLoading: route.loading,
    routeError: route.error,
    playing: media.playing,
    track: media.track?.title ?? null,
    positionSec: Number.isFinite(media.track?.positionSec) ? Math.round(media.track.positionSec) : null,
    source: media.source,
    activePackage: media.activePackage,
    hasSession: media.hasSession,
    gatewaySource: getActiveSource(),
    mediaTrail: getOwnTrail().filter((e) => e.kind === 'action' && /medya/i.test(e.label)).slice(-4).map((e) => `${e.label}${e.detail ? ':' + e.detail : ''}`),
    volume: s.volume,
    brightness: s.brightness,
    theme: s.theme,
    themePack: s.themePack,
    dayNight: s.dayNightMode,
    carTheme: useCarTheme.getState().theme,
    sleepMode: s.sleepMode,
    screens: getOwnTrail().filter((e) => e.kind === 'screen').slice(-3).map((e) => `${e.ts}:${e.label}`),
  };
}
