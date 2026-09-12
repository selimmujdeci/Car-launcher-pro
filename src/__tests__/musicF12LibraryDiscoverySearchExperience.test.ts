/**
 * musicF12LibraryDiscoverySearchExperience.test.ts — MUSIC F12 · OEM++ Library
 * / Discovery / Search Visual Experience.
 *
 * ÖLÇÜM: Discovery (`MusicDiscoverySurface`/`discoveryModel`) ve Search
 * (`UnifiedSearchView`) F5/F5.1'de ZATEN OEM tonlarında, kanıta-bağlı ve
 * "boş sorgu → keşif → yazınca sonuç → temizleyince keşif" akışıyla
 * kuruluydu — F12 bunları YENİDEN YAZMADI. Ölçülen tek gerçek kopukluk
 * `LocalMusicBrowser` idi: CarOS'un geri kalanından (amber/koyu OEM tonları)
 * KOPUK bir mavi (Tailwind `blue-400`) vurgu rengi kullanıyordu — sıradan bir
 * Android müzik uygulaması izlenimi buradan geliyordu. Bu paket:
 *   · o kopukluğun KAPANDIĞINI kilitler,
 *   · sürüş-farkında sınırlamanın (ikinci otorite KURMADAN) eklendiğini,
 *   · kanonik sınırın (F2 `searchMusicLibrary`) artık DÜRÜSTÇE gösterildiğini,
 *   · Discovery/Search'ün mevcut kanıt/akış sözleşmelerinin KORUNDUĞUNU
 *     doğrular.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const browser = strip(read('src/components/media/LocalMusicBrowser.tsx'));
const discoverySurface = strip(read('src/components/media/MusicDiscoverySurface.tsx'));
const discoveryModel = strip(read('src/platform/media/search/discoveryModel.ts'));
const searchView = strip(read('src/components/media/UnifiedSearchView.tsx'));

/* ══════════════════════════════════════════════════════════════════════════
 * 1–4 · LOCAL MUSIC BROWSER — OEM tutarlılığı (ÖLÇÜLEN kusur kapandı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F12 · LocalMusicBrowser CarOS OEM tonlarına taşındı', () => {
  it('1 · Tailwind mavisi (blue-400/rgb(59,130,246)) geri GELMEDİ', () => {
    expect(browser.length, 'LocalMusicBrowser okunamadı — kilit boş kümeye düştü')
      .toBeGreaterThan(3000);
    expect(browser, 'yabancı mavi vurgu rengi geri gelmiş').not.toMatch(/blue-\d/);
    expect(browser, 'yabancı mavi RGB değeri geri gelmiş').not.toContain('59,130,246');
  });

  it('2 · vurgu rengi diğer Music yüzeyleriyle AYNI OEM token\'ı kullanıyor', () => {
    expect(browser, 'CarOS amber vurgusu kaldırılmış').toContain('var(--oem-amber');
    expect(browser, 'metin tonu OEM ink token\'ından gelmiyor').toContain('var(--oem-ink)');
    expect(browser, 'ikincil metin tonu OEM ink-2 token\'ından gelmiyor').toContain('var(--oem-ink-2)');
  });

  it('3 · mini-çubuk çal/duraklat düğmesi ≥48px dokunma hedefine YÜKSELDİ', () => {
    /* ÖLÇÜLEN KUSUR: düğme 36×36px'ti (Tailwind w-9 h-9) — kritik dokunma
       hedefinin altındaydı. */
    expect(browser, 'eski 36px dokunma hedefi geri gelmiş').not.toMatch(/w-9 h-9 rounded-xl flex items-center justify-center text-white/);
    expect(browser, 'dokunma hedefi tabanı kaldırılmış').toContain('MIN_TOUCH_TARGET_PX');
    expect(browser, 'mini çubuk düğmesi sabit tabana bağlanmamış')
      .toMatch(/width:\s*MIN_TOUCH_TARGET_PX,\s*height:\s*MIN_TOUCH_TARGET_PX/);
  });

  it('4 · kanonik sınır (F2) artık DÜRÜSTÇE gösteriliyor — sessizce gizlenmiyor', () => {
    /* ÖLÇÜLEN KUSUR: `{filtered.length} parça` her zaman gösteriliyordu;
       kütüphanede 5000 parça olsa da yalnız ilk 100'ü gösterip "100 parça"
       yazmak yanıltıcıydı. */
    expect(browser, 'gerçek toplam hesaplanmıyor').toContain('availableTotal');
    expect(browser, 'kırpma durumu hesaplanmıyor').toContain('isTruncated');
    expect(browser, 'kırpma kullanıcıya bildirilmiyor').toMatch(/daraltmak için ara/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5–6 · SÜRÜŞ FARKINDALIĞI — yeni otorite YOK, yalnız var olanın yorumu
 * ════════════════════════════════════════════════════════════════════════ */

describe('F12 · LocalMusicBrowser sürüşte derin gezinmeyi azaltır', () => {
  it('5 · sürüşte sonuç sınırı daralır; ikinci sürüş otoritesi KURULMAZ', () => {
    expect(browser, 'sürüş dalı kaldırılmış').toContain('DRIVING_RESULT_LIMIT');
    expect(browser, "drivingMode === 'driving' dalı kaldırılmış")
      .toMatch(/drivingMode === 'driving'\s*\?\s*DRIVING_RESULT_LIMIT/);
    /* İkinci bir sürüş-durumu otoritesi KURULMAZ: prop dışarıdan gelir. */
    expect(browser, 'kendi sürüş ölçümünü yapmış').not.toContain('smartEngine');
    expect(browser, 'kendi hız/telemetri okuması yapmış').not.toContain('vehicleDataLayer');
  });

  it('6 · sınır F2\'nin KENDİ kanonik sınırıdır — burada TEKRAR icat edilmedi', () => {
    /* `searchMusicLibrary` zaten `limit` parametresi alıyordu (F2); F12 onu
       ÇAĞIRIRKEN geçiriyor, yeni bir sınırlama motoru KURMUYOR. */
    expect(browser, 'searchMusicLibrary çağrısı limit taşımıyor')
      .toMatch(/searchMusicLibrary\(query,\s*limit\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7–8 · AUTHORITY GUARDS — LocalMusicBrowser ikinci otorite DEĞİLDİR
 * ════════════════════════════════════════════════════════════════════════ */

describe('F12 · LocalMusicBrowser ikinci otorite KURMAZ', () => {
  it('7 · native/sağlayıcıya doğrudan komut YOK, kuyruk/kütüphane mutasyonu YOK', () => {
    expect(browser, 'native köprüye doğrudan inmiş').not.toContain('nativeAuthorityBridge');
    expect(browser, 'eski yerel oynatıcı adaptörünü doğrudan çağırmış').not.toContain('playLocalSelection(');
    expect(browser, 'kanonik kuyruğu doğrudan import etmiş')
      .not.toMatch(/from '[^']*session\/playQueue'/);
    expect(browser, 'kanonik kütüphaneyi mutasyona uğratmış').not.toContain('reconcileMusicIndex');
    /* Çalma yalnız kanonik F3 girişinden. */
    expect(browser, 'kanonik F3 girişi kaldırılmış').toContain('startLibraryListening');
  });

  it('8 · kapak YALNIZ ArtworkCache üzerinden — native decode çağrılmaz', () => {
    expect(browser).toContain('resolveArtwork(');
    expect(browser, 'eski native decode yoluna dönülmüş').not.toContain('getMediaArtDataUri');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9–11 · DISCOVERY / SEARCH — mevcut sözleşmeler KORUNDU (yeniden yazılmadı)
 * ════════════════════════════════════════════════════════════════════════ */

describe('F12 · Discovery kanıtsız bölüm ÇİZMEZ (değişmedi, doğrulandı)', () => {
  it('9 · "senin için / önerilen" gibi kanıtsız iddia YOK; kanıt yoksa bölüm yok', () => {
    for (const forbidden of ['Senin için', 'senin için', 'Önerilen', 'Beğenebileceğin']) {
      expect(discoveryModel, `kanıtsız iddia metni sızmış: ${forbidden}`).not.toContain(forbidden);
      expect(discoverySurface, `kanıtsız iddia metni sızmış: ${forbidden}`).not.toContain(forbidden);
    }
    /* Kanıt-yok → bölüm-yok kapısı kaldırılmamış. */
    expect(discoverySurface, 'boş keşif dürüst mesajı kaldırılmış').toContain('data-discovery-empty');
    /* F8 önerisi F5'in İÇİNE karışmaz — ayrı, isteğe bağlı tek satır kalır. */
    expect(discoverySurface, 'F8 önerisi keşfin sıralamasına karışmış')
      .toContain('MusicIntelligenceCard');
  });

  it('10 · Discovery ikinci recommendation/search authority KURMAZ', () => {
    expect(discoverySurface, 'kütüphane taraması bileşene taşınmış')
      .not.toContain('getMusicLibrarySnapshot().tracks.filter');
    expect(discoveryModel, 'saf model React\'e bağlanmış').not.toContain("from 'react'");
    expect(discoveryModel, 'saf model zamana bağlanmış').not.toContain('Date.now');
  });
});

describe('F12 · Search akışı Discovery ile TEK yüzey hissi verir (değişmedi)', () => {
  it('11 · boş sorgu → Discovery · yazınca → sonuçlar · temizleyince → Discovery', () => {
    expect(searchView, 'boşken keşif yüzeyi kaldırılmış').toContain('showDiscovery');
    expect(searchView, 'Discovery bileşeni ayrı bir uygulama gibi kopmuş')
      .toContain('<MusicDiscoverySurface');
    /* Sağlayıcı sonucu kanonik medya katmanına devredilir — UI doğrudan komut vermez. */
    expect(searchView, 'arama sonucu doğrudan sağlayıcıya komut vermiş')
      .not.toMatch(/\bplayYouTube\s*\(/);
    expect(searchView, 'kanonik seçim yolu kaldırılmış').toContain('selectSearchResult');
  });
});
