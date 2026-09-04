/**
 * LyricsPanel.tsx — MUSIC F16 · Şarkı sözleri yüzeyi (SALT PROJEKSİYON).
 *
 * SINIRLAR (Cross-Domain §14, `PlaylistDetailPanel`/F15 ile AYNI ilke):
 *   · Kendi lyrics gerçeğini TUTMAZ — kaynak `musicLyricsAuthority`dir.
 *   · Native köprüyü/sağlayıcıyı DOĞRUDAN ÇAĞIRMAZ — otorite yalnız gömülü
 *     etiket okuması ister (`primeLyricsForCurrentItem`), dispatch YOK.
 *   · İKİNCİ bir playback clock/timer KURMAZ: `positionSec` çağırandan
 *     (Now Playing'in ZATEN sahip olduğu F7.3 interpolasyon döngüsünden)
 *     PARAMETRE olarak gelir; aktif satır her render turunda AYNI saf
 *     `getActiveLyricsLine` fonksiyonuyla türetilir (ikili arama, O(log n)).
 *   · Sürüşte (`drivingMode==='driving'`) yalnız TEK aktif satır (SENKRON
 *     varsa) veya dürüst bir kısıtlama notu gösterilir — tam metin
 *     gezinme/scroll dikkat dağıtıcıdır (spec §7). Bu İKİNCİ bir sürüş
 *     otoritesi DEĞİLDİR; mevcut `drivingMode`i OKUR.
 *   · Söz yoksa/aranıyorsa boş panel yerine DÜRÜST durum metni gösterilir
 *     (spec §6) — hiçbir koşulda söz UYDURULMAZ.
 *   · Toy karaoke efekti YOK: aktif satır yalnız CSS geçişiyle (`transition-all`)
 *     büyür/parlar, kelime bazlı animasyon/kayan renk YOKTUR.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ChevronDown, Captions } from 'lucide-react';

import { getListeningSession, subscribeListeningSession } from '../../platform/media/session/listeningSession';
import {
  peekLyrics, primeLyricsForCurrentItem, subscribeLyricsCache, getActiveLyricsLine,
} from '../../platform/media/lyrics/musicLyricsAuthority';
import type { DrivingMode } from './nowPlayingModel';

/** Kritik dokunma hedefi tabanı — 800×480 aftermarket ekran, hiçbir yoğunlukta altına inilmez. */
const MIN_TOUCH_TARGET_PX = 48;

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly drivingMode: DrivingMode;
  /** Now Playing'in ZATEN sahip olduğu playback pozisyonu — İKİNCİ zamanlayıcı YOK. */
  readonly positionSec: number;
}

function subscribeBoth(listener: () => void): () => void {
  const stopSession = subscribeListeningSession(listener);
  const stopLyrics = subscribeLyricsCache(listener);
  return () => { stopSession(); stopLyrics(); };
}

export function LyricsPanel({ open, onClose, drivingMode, positionSec }: Props) {
  const session = useSyncExternalStore(subscribeBoth, getListeningSession, getListeningSession);
  const identity = session?.currentItem ?? null;
  const sourceClass = session?.currentSource ?? null;

  const query = useSyncExternalStore(
    subscribeLyricsCache,
    () => peekLyrics(identity),
    () => peekLyrics(identity),
  );

  /* Panel açıkken ve kanıt henüz bilinmiyorsa BİR KEZ native'e sor — aynı
     kimlik için tekrar tekrar ÇAĞIRMAZ (marker değişmeden `primeKeyRef` aynı
     kalır). Bu bir zamanlayıcı DEĞİLDİR: yalnız açılış/parça değişimi
     tetikler. */
  const primedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !identity) return;
    if (query.availability !== 'UNKNOWN') return;
    const marker = `${identity.libraryId ?? ''}|${identity.providerNamespace ?? ''}|${identity.providerId ?? ''}`;
    if (primedKeyRef.current === marker) return;
    primedKeyRef.current = marker;
    void primeLyricsForCurrentItem(identity, sourceClass, Date.now());
  }, [open, identity, sourceClass, query.availability]);

  const lines = query.result?.lines ?? null;
  const format = query.result?.format ?? null;
  const activeLine = format === 'SYNCED' && lines ? getActiveLyricsLine(lines, positionSec) : null;
  const activeIndex = format === 'SYNCED' && lines && activeLine ? lines.indexOf(activeLine) : -1;

  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  if (!open) return null;

  const restricted = drivingMode === 'driving';

  return (
    <section
      data-music-surface="lyrics-panel"
      aria-label="Şarkı sözleri"
      className="absolute inset-0 z-20 flex flex-col"
      style={{ background: 'var(--oem-surface-0, #171a20)' }}
    >
      <header
        className="flex flex-shrink-0 items-center gap-3 px-4"
        style={{ minHeight: 64, borderBottom: '1px solid var(--oem-line, rgba(255,255,255,.14))' }}
      >
        <Captions aria-hidden className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--oem-ink-2)' }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black" style={{ color: 'var(--oem-ink, #fff)' }}>Sözler</div>
          {identity?.title && (
            <div className="truncate text-xs" style={{ color: 'var(--oem-ink-2, #b9bec8)' }}>{identity.title}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Sözler panelini kapat"
          data-music-lyrics-close="true"
          className="flex flex-shrink-0 items-center justify-center rounded-full border bg-transparent"
          style={{
            width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX,
            borderColor: 'var(--oem-line, rgba(255,255,255,.14))', color: 'var(--oem-ink)',
          }}
        >
          <ChevronDown aria-hidden className="h-5 w-5" />
        </button>
      </header>

      {!identity ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-sm" style={{ color: 'var(--oem-ink-2)' }}>
          Şu an çalan bir şey yok.
        </p>
      ) : query.availability === 'UNAVAILABLE' ? (
        <p data-lyrics-unavailable="true" className="flex flex-1 items-center justify-center px-6 text-center text-sm" style={{ color: 'var(--oem-ink-2)' }}>
          Bu parça için şarkı sözü bulunamadı.
        </p>
      ) : query.availability === 'UNKNOWN' ? (
        <p data-lyrics-loading="true" className="flex flex-1 items-center justify-center px-6 text-center text-sm" style={{ color: 'var(--oem-ink-2)' }}>
          Sözler aranıyor…
        </p>
      ) : format === 'SYNCED' && lines ? (
        restricted ? (
          <div data-lyrics-restricted="true" className="flex flex-1 items-center justify-center px-6 text-center">
            <p className="text-2xl font-black leading-snug transition-all" style={{ color: 'var(--oem-ink, #fff)' }}>
              {activeLine?.text || '…'}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-none px-6 py-8" style={{ overscrollBehavior: 'contain' }}>
            {lines.map((l, i) => (
              <p
                key={i}
                ref={i === activeIndex ? activeLineRef : undefined}
                className="py-2 text-center transition-all"
                style={i === activeIndex
                  ? { color: 'var(--oem-ink, #fff)', fontSize: '1.35rem', fontWeight: 800 }
                  : { color: 'var(--oem-ink-3, rgba(240,235,224,0.42))', fontSize: '1rem', fontWeight: 500 }}
              >
                {l.text || ' '}
              </p>
            ))}
          </div>
        )
      ) : lines ? (
        restricted ? (
          <p data-lyrics-restricted="true" className="flex flex-1 items-center justify-center px-6 text-center text-sm" style={{ color: 'var(--oem-ink-2)' }}>
            Sürüşte tam metin gizli — güvenlik için yalnız senkron aktif satır gösterilir, bu parçada o yok.
          </p>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-none px-6 py-6" style={{ overscrollBehavior: 'contain' }}>
            {lines.map((l, i) => (
              <p key={i} className="py-1 text-center text-base" style={{ color: 'var(--oem-ink-2, #d7dae0)' }}>
                {l.text || ' '}
              </p>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
