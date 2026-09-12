/**
 * voiceSearchIntent.ts — F5.1 · Sesli "şunu çal" niyetinin KANONİK hattı.
 *
 * ═══ NEDEN VAR ═══
 * Sesli komut, `carosMediaLayer.playByQuery` üzerinden AYRI bir arama
 * orkestrasyonu, AYRI bir sıralama (sağlayıcı popülerlik tablosu) ve tekilleştirme
 * OLMAYAN bir yol kullanıyordu. İki arama otoritesi demek, kullanıcının ekranda
 * gördüğü sıra ile sesle çalınan parçanın FARKLI kurallarla seçilmesi demektir.
 *
 * ═══ KANONİK AKIŞ ═══
 *   `voice intent → MusicSearchCoordinator.searchOnce() → canonical SearchResult
 *      → güvenli seçim politikası → selectSearchResult()
 *      → F3 ListeningSession/DesiredQueue → MediaCommandGateway → F0`
 *
 * ═══ PAZARLIKSIZ ═══
 *   · Sağlayıcıya DOĞRUDAN çalma komutu gönderilmez.
 *   · Sese özel sıralama/normalizasyon ÜRETİLMEZ — kanonik modüller kullanılır.
 *   · Bayatlık kapısı atlanmaz (`searchOnce` aynı kuşak kuralına tabidir).
 *   · **Belirsiz sonuçta kafasına göre çalma YOKTUR**: araçta yanlış parça
 *     başlatmak, hiç başlatmamaktan daha kötüdür.
 */
import type { ProviderId } from '../providers';
import { searchOnce, type SearchSnapshot } from './musicSearchCoordinator';
import { selectSearchResult, type SelectionResult } from './searchSelection';
import type { SearchResult } from './searchResult';
import {
  noteVoiceAmbiguousHeld, noteVoiceSearch, noteVoiceSelection,
} from './searchTelemetry';

export type VoicePlayOutcome =
  /** Kanonik yoldan çalma başlatıldı (yerel kütüphane). */
  | 'STARTED'
  /** Sağlayıcı sonucu seçildi; çalma kanonik medya katmanına devredildi. */
  | 'PROVIDER_PATH'
  /** Sonuç var ama hangisi olduğu KANITLANAMADI — otomatik çalma YAPILMADI. */
  | 'AMBIGUOUS'
  /** Hiç sonuç yok. */
  | 'NO_RESULT'
  /** Kaynaklara ulaşılamadı / hepsi düştü. */
  | 'SOURCES_UNAVAILABLE'
  /** Seçilen sonuç artık geçerli değil (bayat kütüphane referansı). */
  | 'STALE'
  | 'REJECTED';

export interface VoicePlayResult {
  readonly outcome: VoicePlayOutcome;
  readonly reason: string;
  /** Seçilen sonuç — çalma yapılmadıysa da teşhis için döner. */
  readonly selected: SearchResult | null;
  readonly snapshot: SearchSnapshot;
  readonly selection: SelectionResult | null;
}

const result = (
  outcome: VoicePlayOutcome, reason: string, snapshot: SearchSnapshot,
  selected: SearchResult | null = null, selection: SelectionResult | null = null,
): VoicePlayResult => Object.freeze({ outcome, reason, selected, snapshot, selection });

/**
 * Otomatik çalma için gereken EN AZ kanıt.
 *
 * Sürüş bağlamında yanlış parça başlatmak, "bulamadım" demekten daha kötüdür.
 * Bu yüzden yalnız metin kanıtı GERÇEKTEN bir eşleşme gösteren sonuçlar
 * otomatik çalınır; `NONE` derecesi (hiçbir metin sinyali tutmadı) reddedilir.
 */
export function isConfidentEnoughToAutoPlay(top: SearchResult | undefined): boolean {
  if (!top) return false;
  return top.evidence.matchKind !== 'NONE' && top.evidence.score > 0;
}

/** Tercih edilen kaynak filtresi — sonuç YOKSA kanonik sıraya düşülür. */
function preferProvider(
  results: readonly SearchResult[], preferred: ProviderId | null,
): SearchResult | undefined {
  if (!preferred) return results[0];
  /* Kullanıcı "Spotify'dan çal" dediyse önce orada aranır; ama tercih edilen
     kaynakta sonuç yoksa arama BAŞARISIZ sayılmaz — kanonik sıralamanın en
     üstü kullanılır (mevcut voice davranışının korunması). */
  return results.find((r) => r.provenance.providerId === preferred) ?? results[0];
}

/**
 * Sesli sorguyu kanonik hattan çalar.
 *
 * @param preferredProvider kullanıcı bir kaynak belirttiyse (ör. "Spotify'dan").
 *        Sıralamayı DEĞİŞTİRMEZ; yalnız eşit derecede iyi sonuçlar arasından
 *        tercih yapar.
 */
export async function playByVoiceQuery(
  rawQuery: string,
  preferredProvider: ProviderId | null = null,
): Promise<VoicePlayResult> {
  const query = (rawQuery ?? '').trim();
  const startedAt = performance.now();
  if (!query) {
    const empty = await searchOnce('');
    return result('NO_RESULT', 'Boş sorgu — arama yapılmadı.', empty);
  }

  const snapshot = await searchOnce(query);
  noteVoiceSearch(performance.now() - startedAt, snapshot.results.length);

  if (snapshot.results.length === 0) {
    const unavailable = snapshot.emptyReason === 'ALL_SOURCES_UNAVAILABLE'
      || snapshot.emptyReason === 'ALL_SOURCES_FAILED'
      || snapshot.emptyReason === 'NO_ELIGIBLE_SOURCE';
    return unavailable
      ? result('SOURCES_UNAVAILABLE', 'Müzik kaynaklarına şu an ulaşılamıyor.', snapshot)
      : result('NO_RESULT', 'Aradığın müzik bulunamadı.', snapshot);
  }

  const top = preferProvider(snapshot.results, preferredProvider);
  if (!isConfidentEnoughToAutoPlay(top)) {
    /* Sonuç VAR ama hangisinin istendiği kanıtlanamadı: otomatik çalma YOK.
       Çağıran kullanıcıya listeyi gösterebilir. */
    noteVoiceAmbiguousHeld();
    return result('AMBIGUOUS',
      'Hangi parçanın istendiği kesinleşmedi — otomatik çalma yapılmadı.',
      snapshot, top ?? null);
  }

  const selectionStartedAt = performance.now();
  const selection = await selectSearchResult(top!, snapshot.results);
  noteVoiceSelection(performance.now() - selectionStartedAt, selection.outcome === 'STARTED');

  switch (selection.outcome) {
    case 'STARTED':
      return result('STARTED', selection.reason, snapshot, top!, selection);
    case 'PROVIDER_PATH':
      return result('PROVIDER_PATH', selection.reason, snapshot, top!, selection);
    case 'STALE_REFERENCE':
      return result('STALE', selection.reason, snapshot, top!, selection);
    default:
      return result('REJECTED', selection.reason, snapshot, top!, selection);
  }
}
