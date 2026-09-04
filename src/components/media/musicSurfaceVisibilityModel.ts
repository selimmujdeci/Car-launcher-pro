import type { MusicViewModel } from './MusicViewModel';

export interface MusicSurfaceVisibilityContext {
  readonly drawerOpen: boolean;
  readonly criticalSurfaceOpen: boolean;
  readonly nowPlayingOpen: boolean;
}

/** One policy for every shell; components do not make scattered visibility guesses. */
export function musicSurfaceVisibilityModel(
  music: MusicViewModel,
  context: MusicSurfaceVisibilityContext,
): boolean {
  return music.hasListeningContext && !context.drawerOpen && !context.criticalSurfaceOpen && !context.nowPlayingOpen;
}
