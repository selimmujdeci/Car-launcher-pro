import { useLayoutEffect, type ReactNode } from 'react';
import { recordNowPlayingCommit } from '../../platform/media/musicUiPerf';

/** F1 boundary: the existing player presentation lives behind the canonical Now Playing surface. */
export function NowPlayingSurface({ children }: { readonly children: ReactNode }) {
  useLayoutEffect(() => { recordNowPlayingCommit(); });
  return <section data-music-surface="now-playing" className="h-full">{children}</section>;
}
