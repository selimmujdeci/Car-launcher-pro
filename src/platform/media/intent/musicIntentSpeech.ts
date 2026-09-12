/**
 * musicIntentSpeech.ts — MUSIC F9 · Sonuç → SÖYLENEBİLİR cümle (SAF).
 *
 * TEK KURAL: cümlenin gücü kanıtın gücünü AŞAMAZ.
 *   `CONFIRMED`    → "çalıyor / durdurdum / geçtim"
 *   `ATTEMPTED`    → "başlatmayı deniyorum" (ASLA "çalıyor" DEĞİL)
 *   `NEEDS_CHOICE` → "hangisi?" (hiçbir şey başlatılmadı)
 *   `DECLINED`     → yapılamadı + anlaşılır neden
 *
 * TEKNİK KOD OKUNMAZ (§14): `unsupported_capability` gibi kodlar LAB'da kalır;
 * kullanıcı yalnız insan diliyle bir açıklama duyar.
 *
 * GÜÇLÜ KİŞİSEL İDDİA YOKTUR (§12): "sen bunu seversin · ruh hâlin · her gece
 * bunu dinliyorsun" gibi cümleler bu modülde ÜRETİLEMEZ; F8 kanıtı yalnız
 * "bu sürüşte daha önce tercih ettiğin" düzeyinde ifade edilir.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import type { MusicIntentOutcome } from './musicIntent';

/** Neden kodu → insan dili. Kod EŞLEŞMEZSE genel bir cümle döner (kod okunmaz). */
const REASON_SPEECH: Readonly<Record<string, string>> = Object.freeze({
  no_result: 'Aradığın müziği bulamadım.',
  sources_unavailable: 'Müzik kaynaklarına şu an ulaşamıyorum.',
  provider_unavailable: 'Bu kaynak şu anda kullanılamıyor.',
  provider_no_results: 'Bu kaynakta sonuç bulamadım.',
  stale_reference: 'O parça artık cihazda yok.',
  queue_unsupported: 'Bu kaynakta sırayı değiştiremiyorum.',
  no_active_queue: 'Şu an bir çalma sırası yok.',
  no_active_source: 'Şu an çalan bir şey yok.',
  authority_unavailable: 'Müzik altyapısı henüz hazır değil.',
  unsupported_capability: 'Bu kaynak bu komutu desteklemiyor.',
  no_next_item: 'Sırada başka parça yok.',
  index_out_of_range: 'Sıranın sonundayız.',
  empty_queue: 'Çalma listesi boş.',
  spotify_not_connected: "Spotify'a bağlı değilsin.",
  network_error: 'Bağlantı sorunu var.',
  no_context_evidence: 'Bu sürüş için yeterli bilgim yok.',
  mood_evidence_unavailable: 'Parçaların havasını ölçebilecek bir bilgim yok.',
  no_resume_context: 'Kaldığın bir yer bulamadım.',
  volume_unavailable: 'Ses seviyesini şu an değiştiremiyorum.',
  intent_unresolved: 'Bunu müzik komutu olarak anlayamadım.',
  /* MUSIC F18 · kesintisiz akış — kurulamadığında dürüst neden. */
  radio_library_empty: 'Cihazda çalabileceğim bir kütüphane bulamadım.',
  radio_no_candidate: 'Akışı sürdürecek uygun bir parça bulamadım.',
  radio_execution_rejected: 'Sırayı bu kaynağa uygulayamadım.',
  radio_kind_unsupported: 'Bu akış isteğini şu an karşılayamıyorum.',
  /* MUSIC F10 · karakter (mood/energy) yönlü istekler. Kanıt yoksa KESİN dil
     kurulmaz; kullanıcıya neyin eksik olduğu dürüstçe söylenir. */
  trait_reference_unavailable: 'Şu an çalanın karakterini ölçemediğim için kıyaslayamıyorum.',
  trait_evidence_unavailable: 'Parçaların havasını ölçebilecek bir bilgim yok.',
  trait_no_candidate: 'Kütüphanende bu yönde uygun bir şey bulamadım.',
  trait_start_rejected: 'Seçtiğim parçayı başlatamadım.',
  /* MUSIC F13 · favori/koleksiyon — reddedilme/kullanılamama nedenleri. */
  no_current_item: 'Şu an çalan bir şey yok.',
  favorite_identity_unresolved: 'Bu parçayı favorilere eklenecek şekilde tanıyamadım.',
  favorite_collection_full: 'Favori listen dolu.',
  favorite_unresolved: 'Favorilerindeki bu parçaya artık ulaşamıyorum.',
  no_playable_favorite: 'Çalınabilir bir favorin yok.',
  favorite_start_rejected: 'Favorini başlatamadım.',
  /* MUSIC F15 · playlist — reddedilme/kullanılamama nedenleri. */
  playlist_name_required: 'Listeye ne isim vermek istediğini söyler misin?',
  playlist_limit_reached: 'Playlist sınırına ulaştın.',
  playlist_name_invalid: 'Bu playlist adını kullanamadım.',
  playlist_not_found: 'Böyle bir playlist bulamadım.',
  playlist_item_identity_unresolved: 'Bu parçayı playlist\'e eklenecek şekilde tanıyamadım.',
  playlist_create_failed: 'Playlist oluşturamadım.',
  playlist_empty_or_unresolved: 'Bu playlist\'te çalınabilir bir şey yok.',
  playlist_start_rejected: 'Playlist\'i başlatamadım.',
  /* MUSIC F16 · sözler — yalnız `FAILED`/`REJECTED` (DECLINED) dallarında
     kullanılır; `VERIFIED` sonuçlar `lyricsSpeech`in kendi eşlemesinden geçer. */
  lyrics_query_failed: 'Bunun sözü var mı, şu an kontrol edemedim.',
});

const CONFIRMED_SPEECH: Readonly<Partial<Record<string, string>>> = Object.freeze({
  PLAY: 'Çalıyor.',
  TOGGLE: 'Tamam.',
  PAUSE: 'Duraklattım.',
  STOP: 'Durdurdum.',
  NEXT: 'Sonraki parçaya geçtim.',
  PREVIOUS: 'Önceki parçaya geçtim.',
  SEEK: 'İstediğin yere aldım.',
  RESTART_TRACK: 'Baştan aldım.',
  JUMP_TO: 'İleri aldım.',
  PLAY_NEXT: 'Sıradakine aldım.',
  ADD_TO_QUEUE: 'Sıraya ekledim.',
  REMOVE_CURRENT: 'Sıradan çıkardım.',
  CLEAR_UPCOMING: 'Sırayı temizledim.',
  VOLUME_UP: 'Sesi açtım.',
  VOLUME_DOWN: 'Sesi kıstım.',
  MUTE: 'Sesi kapattım.',
  UNMUTE: 'Sesi geri açtım.',
});

const ATTEMPTED_SPEECH: Readonly<Partial<Record<string, string>>> = Object.freeze({
  PLAY: 'Başlatmayı deniyorum.',
  TOGGLE: 'Komutu gönderdim.',
  PAUSE: 'Duraklatma komutunu gönderdim.',
  STOP: 'Durdurma komutunu gönderdim.',
  NEXT: 'Sonrakine geçmeyi deniyorum.',
  PREVIOUS: 'Öncekine geçmeyi deniyorum.',
  SEEK: 'Konum komutunu gönderdim.',
  RESTART_TRACK: 'Baştan almayı deniyorum.',
});

/**
 * MUSIC F10 · Karakter yönlü cevabın metni.
 *
 * `confident=false` iken KESİN fiil kullanılmaz ("deneyeyim"): kanıt sezgisel
 * olduğunda kullanıcıya kesinlik satmak yalan olur.
 */
function traitDirectionSpeech(outcome: MusicIntentOutcome, confident: boolean): string {
  const calmer = outcome.intent.kind === 'PLAY_SOMETHING_CALMER';
  const energetic = outcome.intent.kind === 'PLAY_SOMETHING_MORE_ENERGETIC';
  const what = calmer ? 'daha sakin' : energetic ? 'daha hareketli' : 'yolculuğuna uygun';
  return confident
    ? `${what.charAt(0).toLocaleUpperCase('tr-TR')}${what.slice(1)} bir şey açıyorum.`
    : `${what.charAt(0).toLocaleUpperCase('tr-TR')}${what.slice(1)} olabilecek bir şey deneyeyim.`;
}

/**
 * MUSIC F13 · Favori mutasyonu cümlesi.
 *
 * "Ekledim/çıkardım" TEK BAŞINA çalma iddiası KURDURMAZ (`claimIsHonest`
 * yalnız CONFIRMED derecesinde bu fiillere izin verir — bu fonksiyon YALNIZ
 * `outcome.claim === 'CONFIRMED'` iken, yani mutasyon senkron DOĞRULANMIŞKEN
 * çağrılır). Genel "X çalıyor." dalına ASLA düşmez — favori olmak çalıyor
 * olmak DEĞİLDİR.
 */
function favoriteMutationSpeech(outcome: MusicIntentOutcome, subject: string | null): string {
  const withSubject = (suffix: string, fallback: string): string =>
    subject !== null ? `${subject} ${suffix}` : fallback;
  switch (outcome.reasonCode) {
    case 'favorite_added':
      return withSubject('favorilere eklendi.', 'Favorilere ekledim.');
    case 'favorite_already_present':
      return withSubject('zaten favorilerinde.', 'Bu zaten favorilerindeydi.');
    case 'favorite_removed':
      return withSubject('favorilerden çıkarıldı.', 'Favorilerden çıkardım.');
    case 'favorite_already_absent':
      return withSubject('zaten favorilerinde değildi.', 'Bu zaten favorilerinde değildi.');
    default:
      return 'Tamam.';
  }
}

/**
 * MUSIC F15 · Playlist mutasyonu cümlesi — F13 `favoriteMutationSpeech`
 * ile AYNI ilke: yalnız `outcome.claim === 'CONFIRMED'` iken çağrılır,
 * genel "X çalıyor." dalına ASLA düşmez (playlist'te olmak çalıyor
 * olmak DEĞİLDİR). `outcome.intent.playlistName` liste adını, `subject`
 * (bağlama göre) parça VEYA yeni playlist adını taşır.
 */
function playlistMutationSpeech(outcome: MusicIntentOutcome, subject: string | null): string {
  const listName = outcome.intent.playlistName;
  switch (outcome.reasonCode) {
    case 'playlist_created':
      return subject ? `${subject} adında bir playlist oluşturdum.` : 'Playlist oluşturdum.';
    case 'playlist_item_added':
      return subject && listName
        ? `${subject}, ${listName} listesine eklendi.`
        : subject ? `${subject} playlist'e eklendi.` : 'Playlist\'e eklendi.';
    case 'playlist_created_and_item_added':
      return subject && listName
        ? `${listName} listesini oluşturup ${subject} ekledim.`
        : 'Yeni playlist oluşturup ekledim.';
    case 'playlist_item_already_present':
      return subject && listName
        ? `${subject} zaten ${listName} listesindeydi.`
        : 'Bu zaten playlist\'teydi.';
    case 'playlist_item_removed':
      return subject && listName
        ? `${subject}, ${listName} listesinden çıkarıldı.`
        : subject ? `${subject} playlist'ten çıkarıldı.` : 'Playlist\'ten çıkarıldı.';
    case 'playlist_item_already_absent':
      return subject && listName
        ? `${subject} zaten ${listName} listesinde değildi.`
        : 'Bu zaten playlist\'te değildi.';
    default:
      return 'Tamam.';
  }
}

/**
 * MUSIC F16 · Sözler cümlesi — yalnız `outcome.claim === 'CONFIRMED'` iken
 * çağrılır. Türkçe iyelik/durum eki uyumu SORUN yaratmasın diye değişken
 * parça adı ASLA doğrudan çekim ekiyle birleştirilmez (iki nokta üst üste
 * ile ayrılır — F13/F15'in `withSubject` desenindeki AYNI temkin).
 * "Buldum/gösteriyorum" iddiası YALNIZ gerçekten bulunduğunda kurulur —
 * `lyrics_panel_shown_no_lyrics`/`lyrics_query_unavailable` dürüstçe "yok" der.
 */
function lyricsSpeech(outcome: MusicIntentOutcome, subject: string | null): string {
  switch (outcome.reasonCode) {
    case 'lyrics_panel_hidden':
      return 'Sözleri kapattım.';
    case 'lyrics_panel_shown':
      return subject ? `Sözleri açıyorum: ${subject}.` : 'Sözleri açıyorum.';
    case 'lyrics_panel_shown_unknown':
      return 'Sözleri kontrol ediyorum, panelde göreceksin.';
    case 'lyrics_panel_shown_no_lyrics':
      return subject ? `Söz bulamadım: ${subject}.` : 'Bu parça için söz bulamadım.';
    case 'lyrics_query_available':
      return subject ? `Evet, sözü var: ${subject}.` : 'Evet, bu parçanın sözü var.';
    case 'lyrics_query_unavailable':
      return subject ? `Hayır, söz bulamadım: ${subject}.` : 'Hayır, bu parça için söz bulamadım.';
    default:
      return 'Tamam.';
  }
}

function subjectPhrase(outcome: MusicIntentOutcome): string | null {
  const s = outcome.subject;
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Sonucu söylenebilir Türkçe cümleye çevirir.
 *
 * Kısa tutulur: sürüşte uzun cümle güvenlik sorunudur (ISO 15008 ilkesiyle
 * aynı yön). "Bakıyorum · düşünüyorum" gibi dolgu ÜRETİLMEZ (§9).
 */
export function speakMusicOutcome(outcome: MusicIntentOutcome): string {
  const subject = subjectPhrase(outcome);

  switch (outcome.claim) {
    case 'CONFIRMED': {
      /* MUSIC F13 · favori mutasyonu bir ÇALMA iddiası DEĞİLDİR — genel
         "X çalıyor." dalına asla düşmez (bkz. `favoriteMutationSpeech`). */
      if (outcome.intent.kind === 'ADD_FAVORITE' || outcome.intent.kind === 'REMOVE_FAVORITE') {
        return favoriteMutationSpeech(outcome, subject);
      }
      /* MUSIC F15 · playlist mutasyonu da bir ÇALMA iddiası DEĞİLDİR. */
      if (
        outcome.intent.kind === 'CREATE_PLAYLIST' || outcome.intent.kind === 'ADD_TO_PLAYLIST'
        || outcome.intent.kind === 'REMOVE_FROM_PLAYLIST'
      ) {
        return playlistMutationSpeech(outcome, subject);
      }
      /* MUSIC F16 · sözler UI görünürlüğü/sorgu cümlesidir — bir ÇALMA
         iddiası DEĞİLDİR, genel "X çalıyor." dalına asla düşmez. */
      if (
        outcome.intent.kind === 'SHOW_LYRICS' || outcome.intent.kind === 'HIDE_LYRICS'
        || outcome.intent.kind === 'QUERY_LYRICS_AVAILABILITY'
      ) {
        return lyricsSpeech(outcome, subject);
      }
      /* İçerik başlatıldıysa NE çaldığını söyle — kullanıcı yanlış anlaşılmayı
         burada yakalar. Aksi hâlde kısa onay yeter. */
      if (subject !== null) return `${subject} çalıyor.`;
      return CONFIRMED_SPEECH[outcome.intent.kind] ?? 'Tamam.';
    }
    case 'ATTEMPTED': {
      /* MUSIC F10 · kanıt gücü cümlenin gücünü belirler:
           güçlü kanıt → "daha sakin bir şey açıyorum"
           zayıf kanıt → "daha sakin olabilecek bir şey deneyeyim"
         Zayıf kanıttan KESİN dil DOĞMAZ. */
      if (outcome.reasonCode === 'trait_selected_confident') {
        return traitDirectionSpeech(outcome, true);
      }
      if (outcome.reasonCode === 'trait_selected_tentative') {
        return traitDirectionSpeech(outcome, false);
      }
      /* MUSIC F18 · akış (Smart Radio). Cümle KANIT SINIFINI izler:
           `measured` → gerçek ses ölçümüne dayalı benzerlik ("benzerlerini")
           `weak`     → yalnız etiket/sezgisel kanıt ("devam edeyim")
           `fallback` → kanıt YOK; kişiselleştirme İDDİA EDİLMEZ.
         Hiçbir dalda "sana özel/seversin" gibi güçlü kişisel iddia yoktur (§12). */
      if (outcome.reasonCode.startsWith('radio_')) {
        return radioSpeech(outcome);
      }
      if (subject !== null) return `${subject} için başlatmayı deniyorum.`;
      return ATTEMPTED_SPEECH[outcome.intent.kind] ?? 'Komutu gönderdim.';
    }
    case 'NEEDS_CHOICE': {
      if (outcome.choices.length === 0) return 'Hangisini istediğini netleştirelim.';
      const names = outcome.choices
        .slice(0, 3)
        .map((c) => (c.artist ? `${c.title} — ${c.artist}` : c.title));
      return `Hangisi: ${names.join(', ')}?`;
    }
    default: {
      const base = REASON_SPEECH[outcome.reasonCode] ?? 'Bunu şu an yapamıyorum.';
      /* Kanıt düzeyine uygun TEKLİF: güçlü kişisel iddia yok, yalnız seçenek. */
      if (outcome.reasonCode === 'no_context_evidence'
        || outcome.reasonCode === 'mood_evidence_unavailable') {
        return `${base} İstersen kaldığın yerden devam edebilirim.`;
      }
      if (outcome.reasonCode === 'provider_no_results'
        || outcome.reasonCode === 'provider_unavailable') {
        return subject !== null
          ? `${base} ${subject} başka bir kaynakta var, açmamı ister misin?`
          : `${base} Başka bir kaynakta aramamı ister misin?`;
      }
      return base;
    }
  }
}

/**
 * MUSIC F18 · akış cümlesi — iddia KANIT SINIFINI aşamaz.
 *
 * `reasonCode` şu biçimdedir: `radio_<appended|started>_<claimClass>`.
 * Ölçüm yoksa "benzer/sana özel" DENMEZ; yalnız akışın sürdüğü söylenir.
 * Hiçbir dalda tamamlanmış eylem iddiası (`çalıyor`) kurulmaz — çünkü bu
 * yol `ATTEMPTED` derecesindedir.
 */
function radioSpeech(outcome: MusicIntentOutcome): string {
  const appended = outcome.reasonCode.includes('_appended_');
  if (outcome.reasonCode.endsWith('_measured')) {
    return appended
      ? 'Buna benzeyenleri sıranın devamına ekliyorum.'
      : 'Buna benzeyenlerden bir akış başlatmayı deniyorum.';
  }
  if (outcome.reasonCode.endsWith('_weak')) {
    return appended
      ? 'Sırayı uzatıyorum; benzerlik için elimde yeterli ölçüm yok.'
      : 'Bir akış başlatmayı deniyorum; benzerlik için elimde yeterli ölçüm yok.';
  }
  /* FALLBACK: kişiselleştirme İDDİA EDİLMEZ. */
  return appended
    ? 'Kütüphanenden sırayı uzatıyorum.'
    : 'Kütüphanenden bir akış başlatmayı deniyorum.';
}

/**
 * Kilit yardımcısı: bu cümle bu kanıt derecesiyle kurulabilir mi.
 *
 * `CONFIRMED` dışındaki hiçbir derece "çalıyor · durdurdum · geçtim" gibi
 * TAMAMLANMIŞ bir eylem iddiası taşıyamaz. Test bu fonksiyonu kilitler.
 */
export function claimIsHonest(outcome: MusicIntentOutcome, spoken: string): boolean {
  const s = spoken.toLocaleLowerCase('tr-TR');
  const asserts = /(çalıyor|başlattım|duraklattım|durdurdum|geçtim|ekledim|çıkardım|temizledim|aldım|açtım|kıstım|kapattım)/u
    .test(s);
  return outcome.claim === 'CONFIRMED' ? true : !asserts;
}
