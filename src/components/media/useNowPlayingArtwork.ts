/**
 * useNowPlayingArtwork.ts — F4 · Now Playing kapak kancası.
 *
 * SINIR: kapak otoritesi F2 `ArtworkCache`'tir. Bu kanca native köprüyü ÇAĞIRMAZ,
 * ikinci bir önbellek KURMAZ ve kapak baytı SAKLAMAZ — yalnız kanonik çözücüyü
 * `now-playing` kullanımıyla çağırır ve sonucu bileşene verir.
 *
 * DAVRANIŞ: kapak geç gelirse kontrollü yerleşir — çözülene kadar ÖNCEKİ kapak
 * ekranda kalır, böylece parça geçişinde boş kareye düşüp geri dolan bir "flash"
 * olmaz. Kapak yoksa `null` döner ve çağıran F1 fallback'ini çizer.
 *
 * Zero-Leak: her çözüm bir kuşak (generation) taşır; sökülen veya eskiyen istek
 * durumu YAZMAZ (Cross-Domain §17).
 */
import { useEffect, useRef, useState } from 'react';
import { resolveArtwork } from '../../platform/media/artworkCache';
import { markMusicArtworkReady } from '../../platform/media/musicUiPerf';

export interface NowPlayingArtwork {
  /** Çizilecek kaynak; `null` ise fallback kullanılır. */
  readonly url: string | null;
  /** Bu URL istenen kimliğe mi ait — `false` iken önceki kapak gösteriliyordur. */
  readonly settled: boolean;
}

const EMPTY: NowPlayingArtwork = Object.freeze({ url: null, settled: true });

export function useNowPlayingArtwork(identity: string | null): NowPlayingArtwork {
  const [state, setState] = useState<NowPlayingArtwork>(EMPTY);
  const generation = useRef(0);
  const lastIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (identity === lastIdentity.current) return;
    lastIdentity.current = identity;
    const myGeneration = ++generation.current;

    if (!identity) {
      setState(EMPTY);
      return;
    }
    // Yeni kimlik çözülene kadar ÖNCEKİ kapak durur (sert boşluk/flash olmaz).
    setState((prev) => ({ url: prev.url, settled: false }));

    let cancelled = false;
    void resolveArtwork(identity, 'now-playing')
      .then((out) => {
        if (cancelled || myGeneration !== generation.current) return;
        if (out.url) markMusicArtworkReady();
        setState({ url: out.url, settled: true });
      })
      .catch(() => {
        if (cancelled || myGeneration !== generation.current) return;
        // Çözülemedi: uydurma kapak YOK — fallback'e düşülür.
        setState({ url: null, settled: true });
      });

    return () => { cancelled = true; };
  }, [identity]);

  return state;
}
