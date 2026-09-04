/**
 * searchSelection.ts — F5 · Arama sonucundan KANONİK çalma yoluna geçiş.
 *
 * PAZARLIKSIZ AKIŞ (§8):
 *   `SearchResult → kanonik MediaRef/MediaIdentity → ListeningIntent +
 *    DesiredQueue → F3 oturum yolu → MediaCommandGateway → F0 authority`
 *
 * Arama backend SEÇMEZ. Kullanıcı bir sonuç seçtiğinde bu modül yalnız o sonucu
 * kanonik kimliğe çevirir ve mevcut oturum/komut otoritesine devreder. Bir sonuç
 * birden fazla kaynakta bulunduysa (dedup `alternates`) tercih, sonucun KENDİ
 * birincil provenance'ıdır — arama katmanı kendi başına "şuradan çal" demez.
 *
 * BAYATLIK: yerel sonuç seçildiğinde `musicIndex` yeniden doğrulanır. Arama
 * sonucu bir anlık görüntüdür; USB çıkmış olabilir. Bayat referans REDDEDİLİR
 * ve sahte başarı üretilmez.
 */
import { startLibraryListening } from '../session/listeningSessionRuntime';
import type { StartListeningResult } from '../session/listeningSessionRuntime';
import { noteSelection } from './searchTelemetry';
import { resolveLocalSelection } from './searchSources';
import { rememberPlayed } from './recentlyPlayed';
import type { SearchResult } from './searchResult';

export type SelectionOutcome =
  | 'STARTED'
  /** Yerel referans kütüphanede yok/erişilemiyor — çalma DENENMEDİ. */
  | 'STALE_REFERENCE'
  /** Sağlayıcı sonucu: çalma mevcut sağlayıcı yolundan yürür. */
  | 'PROVIDER_PATH'
  | 'REJECTED';

export interface SelectionResult {
  readonly outcome: SelectionOutcome;
  readonly reason: string;
  /** F3 oturum sonucu — yalnız yerel yolda dolar. */
  readonly listening: StartListeningResult | null;
}

const result = (
  outcome: SelectionOutcome, reason: string, listening: StartListeningResult | null = null,
): SelectionResult => Object.freeze({ outcome, reason, listening });

/**
 * Yerel bir arama sonucunu çalar — kanonik F3 yolundan.
 *
 * `queueContext` verilirse kuyruk o listeden kurulur (kullanıcının gördüğü sonuç
 * listesi kuyruk olur); verilmezse yalnız seçilen parça çalar.
 */
export async function selectSearchResult(
  selected: SearchResult,
  queueContext: readonly SearchResult[] = [],
): Promise<SelectionResult> {
  if (selected.provenance.origin === 'PROVIDER') {
    /* Sağlayıcı sonucu bu fazda mevcut sağlayıcı çalma yolunu kullanır; arama
       katmanı sağlayıcıya DOĞRUDAN komut göndermez ve yeni bir çalma otoritesi
       kurmaz. Çağıran (UI) kanonik medya katmanına devreder. */
    noteSelection(true);
    /* Geçmiş kaydı: "çalma BAŞLATILDI" kanıtıdır, playback truth DEĞİLDİR.
       Yalnız kimlik + kaynak + zaman tutulur (başlık/URI saklanmaz). */
    rememberPlayed({
      libraryTrackId: null,
      providerRef: selected.identity.providerId ?? selected.resultId,
      providerId: selected.provenance.providerId,
    });
    return result('PROVIDER_PATH', 'Sağlayıcı sonucu kanonik medya katmanına devredildi.');
  }

  const track = resolveLocalSelection(selected);
  if (!track) {
    noteSelection(false);
    return result('STALE_REFERENCE',
      'Bu parça kütüphanede artık yok veya erişilemiyor — çalma denenmedi.');
  }

  /* Kuyruk bağlamı: kullanıcının gördüğü YEREL sonuçlar kuyruk olur. Bayat veya
     sağlayıcıya ait satırlar kuyruğa alınmaz (F3 zaten reddeder, ama buraya da
     bayat referans GÖNDERMEYİZ). */
  const localContext = queueContext.filter(
    (r) => r.provenance.origin === 'LOCAL_INDEX'
      && r.libraryTrackId !== null
      && r.availability === 'AVAILABLE',
  );
  const trackIds = localContext.length > 0
    ? localContext.map((r) => r.libraryTrackId!)
    : [track.id];

  const listening = await startLibraryListening({
    kind: 'TRACKS', trackIds, startTrackId: track.id,
  });
  noteSelection(listening.started);
  if (listening.started) {
    rememberPlayed({ libraryTrackId: track.id, providerRef: null, providerId: 'local' });
  }
  return listening.started
    ? result('STARTED', listening.reason, listening)
    : result('REJECTED', listening.reason, listening);
}
