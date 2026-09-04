/**
 * mediaSkipNoFakeAck.test.ts — "SONRAKİ/ÖNCEKİ PARÇA" SAHTE ONAY KİLİDİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SAHA (2026-08-08, Xiaomi 23090RA98I): kullanıcı "müzik değiştir" dedi,
 * Mavi "sonraki parça" dedi, PARÇA DEĞİŞMEDİ.
 *
 * ÖLÇÜLEN KÖK — gerçek BİLİNİYORDU ve ATILIYORDU:
 *   mediaCommandGateway.next() → CommandTruth{outcome, failureCode}   ← gerçek
 *        ↓ void import(...).then(gw => gw.next())                     ← ATILDI
 *   _routeToAuthority(): boolean  → koşulsuz `true`
 *        ↓
 *   mediaService.next(): void                                          ← kayboldu
 *        ↓
 *   commandExecutor: next(); _speak('Sonraki parça')                   ← KOŞULSUZ
 *
 * Cihaz kanıtı (LAB → Medya Otoritesi): `Aktif kaynak (native)=NONE`,
 * `OYNATMA GERÇEĞİ=BOŞTA`, `Ses kanıtı=HAYIR`; `dumpsys audio` → tüm
 * player'lar `state:idle`. Yani atlanacak parça YOKTU ama onay verildi.
 *
 * Bu dosya CLAUDE.md'nin "SAHTE ONAY YASAK" kuralını KODA bağlar.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const codeOf = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const mediaSrc = codeOf(read('src/platform/mediaService.ts'));
const localSrc = codeOf(read('src/platform/localMusicService.ts'));
const execSrc  = codeOf(read('src/platform/commandExecutor.ts'));

/* ══════════════ 1) GERÇEK ARTIK TAŞINIYOR ══════════════ */

describe('Medya komut sonucu — gerçek kaybolmuyor', () => {
  it('_routeToAuthority SONUCU DÖNDÜRÜR (void ile atmaz)', () => {
    expect(mediaSrc, 'otorite sonucu hâlâ void ile atılıyor')
      .toMatch(/async function _routeToAuthority[\s\S]{0,200}Promise<MediaCommandResult \| null>/);
    /* Eski kusurlu desen geri gelmesin: `void import(...)` + koşulsuz true. */
    const fn = mediaSrc.slice(
      mediaSrc.indexOf('async function _routeToAuthority'),
      mediaSrc.indexOf('export async function next'),
    );
    expect(fn, 'sonuç yine ateşle-unut yapılmış').not.toMatch(/void import\(/);
    expect(fn, 'koşulsuz true geri gelmiş').not.toMatch(/\n\s*return true;/);
  });

  it('next/previous SONUÇ döndürür', () => {
    /* MUSIC F7.3: imzaya opsiyonel `requester` (yalnız kanıt/provenance)
       eklendi; SONUÇ sözleşmesi DEĞİŞMEDİ — kilit dönüş tipine bağlandı. */
    expect(mediaSrc)
      .toMatch(/export async function next\([^)]*\): Promise<MediaCommandResult>/);
    expect(mediaSrc)
      .toMatch(/export async function previous\([^)]*\): Promise<MediaCommandResult>/);
  });

  it('YALNIZ doğrulanmış sonuç başarı sayılır', () => {
    /* `ACCEPTED_UNVERIFIED` backend'in doğrulama SAĞLAYAMADIĞI durumdur ve
       başarı olarak sunulamaz — aksi hâlde sahte onay geri gelir. */
    expect(mediaSrc).toMatch(/verified:\s*truth\.outcome === 'VERIFIED'/);
  });

  it('Harici oturum "doğrulandı" SAYILMAZ', () => {
    expect(mediaSrc).toMatch(/_MEDIA_SENT_UNVERIFIED[\s\S]{0,120}verified:\s*false/);
    const nextFn = mediaSrc.slice(
      mediaSrc.indexOf('export async function next'),
      mediaSrc.indexOf('export async function previous'),
    );
    expect(nextFn, 'harici gönderim doğrulanmış sayılmış').toContain('_MEDIA_SENT_UNVERIFIED');
  });
});

/* ══════════════ 2) SESSİZ NO-OP KAPANDI ══════════════ */

describe('Yerel kuyruk — sessiz no-op yok', () => {
  it('localNext/localPrev SONUÇ döndürür', () => {
    expect(localSrc).toMatch(/export function localNext\(\): MediaCommandResult/);
    expect(localSrc).toMatch(/export function localPrev\(\): MediaCommandResult/);
  });

  it('BOŞ kuyruk ve kuyruk SONU ayrı gerekçe verir', () => {
    expect(localSrc).toMatch(/failureCode:\s*'empty_queue'/);
    expect(localSrc).toMatch(/failureCode:\s*'end_of_queue'/);
    expect(localSrc).toMatch(/failureCode:\s*'start_of_queue'/);
  });

  it('Kuyruk sonunda BAŞA SARMA eklenmedi (davranış değişmedi)', () => {
    /* Bu PR yalnız DÜRÜSTLÜK ekler; çalma sırası politikası DEĞİŞMEZ. */
    const fn = localSrc.slice(
      localSrc.indexOf('export function localNext'),
      localSrc.indexOf('export function localPrev'),
    );
    expect(fn, 'başa sarma davranışı sessizce eklenmiş').not.toMatch(/playAtIndex\(0\)/);
  });
});

/* ══════════════ 3) SAHTE ONAY YASAĞI ══════════════ */

describe('🔒 commandExecutor — doğrulanmadan başarı İDDİA ETMEZ', () => {
  it('MEDIA_NEXT/PREV sonucu BEKLER', () => {
    /* MUSIC F9'da YENİDEN BAĞLANDI: korunan değişmez aynı — atlama sonucu
       BEKLENİR ve cümle ondan doğar. Değişen tek şey, atlamanın artık F7.3
       KUYRUK-FARKINDA tek girişinden geçmesidir (`mediaService`e doğrudan
       inen eski yol sağlayıcı kuyruklarında düşüyordu). */
    expect(execSrc).toMatch(/case 'MEDIA_NEXT':[\s\S]{0,160}await _queueAwareNext\(\)/);
    expect(execSrc).toMatch(/case 'MEDIA_PREV':[\s\S]{0,160}await _queueAwarePrevious\(\)/);
  });

  it('🔒 KOŞULSUZ "Sonraki parça" cümlesi KALDIRILDI', () => {
    /* Eski kusur: `next(); _speak('Sonraki parça', ...)` — sonucu beklemeden. */
    expect(execSrc, 'koşulsuz başarı cümlesi geri gelmiş')
      .not.toMatch(/next\(\);\s*_speak\('Sonraki parça'/);
    expect(execSrc)
      .not.toMatch(/previous\(\);\s*_speak\('Önceki parça'/);
  });

  it('Cevap TEK karar noktasından üretilir', () => {
    expect(execSrc).toContain('_mediaSkipReply(r,');
    expect(execSrc).toMatch(/function _mediaSkipReply\(r: MediaCommandResult, okText: string\): string/);
  });

  it('Doğrulanmamış sonuçta BAŞARI cümlesi kurulmaz', () => {
    const fn = execSrc.slice(
      execSrc.indexOf('function _mediaSkipReply'),
      execSrc.indexOf('async function dispatchIntent'),
    );
    /* İlk satır kapısı: `verified` değilse okText DÖNMEZ. */
    expect(fn).toMatch(/if \(r\.verified\) return okText;/);
    /* Bilinmeyen sebep bile "yaptım" DEMEZ. */
    expect(fn).toMatch(/default:[\s\S]{0,80}değiştiremedim/);
  });

  it('Bilinen sebepler AYRI ve eyleme dönük cevap alır', () => {
    for (const code of ['empty_queue', 'end_of_queue', 'start_of_queue', 'unverified_backend']) {
      expect(execSrc, `${code} için cevap yok`).toContain(`'${code}'`);
    }
  });

  it('🔒 Harici oturumda "değişti" DENMEZ', () => {
    expect(execSrc).toMatch(/unverified_backend[\s\S]{0,160}doğrulayamıyorum/);
  });
});

/* ══════════════ 4) KAYNAKSIZ "MÜZİK AÇ" → GÖMÜLÜ (PR-2) ══════════════ */

describe('🔒 OPEN_MUSIC — kaynak söylenmediyse GÖMÜLÜ katman', () => {
  const block = execSrc.slice(
    execSrc.indexOf("case 'OPEN_MUSIC'"),
    execSrc.indexOf("case 'PLAY_MUSIC_SEARCH'"),
  );

  /* MUSIC F9'da YENİDEN BAĞLANDI: korunan değişmez aynı — kaynak SÖYLENDİYSE
     o kaynak tercih edilir ve çalma denenir. Değişen tek şey, çalmanın artık
     KANIT döndüren yoldan geçmesidir (`play()` ateşle-unut değil). */
  it('Kaynak SÖYLENDİYSE tercih uygulanır ve çalma KANITLA denenir', () => {
    expect(block).toMatch(/if \(pkg\) \{[\s\S]{0,320}setMediaPreferredPackage\(pkg\)[\s\S]{0,400}await playWithResult\(\)/);
    /* Kanıtsız "açılıyor" iddiası geri gelmemeli. */
    expect(block, 'koşulsuz açılıyor iddiası geri gelmiş')
      .not.toMatch(/_speak\('Müzik açılıyor'/);
  });

  it('🔒 Kaynak YOKKEN doğrudan play() ÇAĞRILMAZ (harici oturum devralınmaz)', () => {
    /* Eski kusur: pkg boş olsa da `play()` çağrılıyor ve harici MediaSession
       devralınıyordu — sürücü uygulamadan kopuyordu. */
    const noPkgPath = block.slice(block.indexOf('ctx.openDrawer'));
    expect(noPkgPath, 'kaynaksız yolda hâlâ play() var').not.toMatch(/\bplay\(\)/);
    expect(noPkgPath).toContain('_openEmbeddedMusic()');
  });

  it('Gömülü açılış sırası: kaldığı yer → gömülü arama → DÜRÜST red', () => {
    const fn = execSrc.slice(
      execSrc.indexOf('async function _openEmbeddedMusic'),
      execSrc.indexOf('const EMBEDDED_MUSIC_SEED'),
    );
    /* MUSIC F9'da YENİDEN BAĞLANDI: sıra AYNI (kaldığı yer → gömülü arama →
       dürüst red); değişen tek şey her iki adımın da KANONİK niyet
       yönlendiricisinden geçmesi ve cümlenin kanıttan doğmasıdır. */
    expect(fn).toMatch(/CONTINUE_LISTENING/);
    expect(fn).toMatch(/PLAY_QUERY[\s\S]{0,120}EMBEDDED_MUSIC_SEED/);
    /* Hiçbiri olmazsa harici uygulamaya SESSİZCE gidilmez. */
    expect(fn, 'gömülü başarısızken harici uygulamaya kaçılmış')
      .not.toMatch(/bridge\.launchMusic|ctx\.launch\(/);
    expect(fn).toMatch(/bulamadım/);
  });

  it('🔒 Gömülü başlatılamadıysa "açılıyor" DENMEZ', () => {
    const fn = execSrc.slice(
      execSrc.indexOf('async function _openEmbeddedMusic'),
      execSrc.indexOf('const EMBEDDED_MUSIC_SEED'),
    );
    /* MUSIC F9: kilit GÜÇLENDİ. Artık sabit "Müzik açılıyor" cümlesi HİÇ
       yoktur; cümle kanıt derecesinden (`speakMusicOutcome`) doğar ve
       başlatılamayan durumda dürüst red döner. */
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');
    expect(code, 'sabit "açılıyor" iddiası geri gelmiş').not.toMatch(/'Müzik açılıyor'/);
    expect(code, 'cümle kanıttan doğmuyor').toMatch(/speakMusicOutcome/);
    const tail = code.slice(code.lastIndexOf('return'));
    expect(tail, 'başarısızlıkta yine "açılıyor" deniyor').not.toMatch(/açılıyor/);
  });

  it('Sabit çalma listesi UYDURULMADI', () => {
    /* Tohum mevcut arama altyapısına verilir; gömülü video/liste kimliği
       kodda sabitlenmez (içerik uydurma YOK). */
    expect(execSrc).toMatch(/const EMBEDDED_MUSIC_SEED = '[^']+';/);
    expect(execSrc, 'sabit videoId/playlistId gömülmüş')
      .not.toMatch(/videoId:\s*'[A-Za-z0-9_-]{11}'|playlistId/);
  });

  it('Arama/sorgu yolları DEĞİŞMEDİ (yalnız kaynaksız yol hizalandı)', () => {
    expect(execSrc).toMatch(/case 'PLAY_MUSIC_SEARCH'[\s\S]{0,400}_playMusicInAppOrFallback/);
    expect(execSrc).toMatch(/case 'PLAY_MUSIC_QUERY'[\s\S]{0,600}_playMusicInAppOrFallback/);
  });
});

/* ══════════════ 5) KAPSAM ══════════════ */

describe('🔒 YAPISAL — yönlendirme ve politika değişmedi', () => {
  it('AUTHORITY_PACKAGES kümesi DEĞİŞMEDİ', () => {
    expect(mediaSrc).toMatch(
      /AUTHORITY_PACKAGES = new Set\(\['com\.cockpitos\.pro', 'com\.cockpitos\.pro\.stream'\]\)/);
  });

  it('togglePlayPause davranışı ateşle-unut KALDI', () => {
    const fn = mediaSrc.slice(
      mediaSrc.indexOf('export function togglePlayPause'),
      mediaSrc.indexOf('export function togglePlayPause') + 400,
    );
    expect(fn).toMatch(/void _routeToAuthority\(/);
  });

  it('Yeni ağ/timer eklenmedi', () => {
    /* `mediaService`te medya hub yoklayıcısı ZATEN vardı (2 adet) — bu tur
       hiçbirine dokunmadı. Kilit "timer yok" değil "SAYI DEĞİŞMEDİ" der;
       yoksa mevcut meşru zamanlayıcı yanlış alarm üretir. */
    expect((mediaSrc.match(/setInterval\(/g) ?? []).length,
      'mediaService\'e yeni zamanlayıcı eklenmiş').toBe(2);
    expect((localSrc.match(/setInterval\(/g) ?? []).length,
      'localMusicService\'e zamanlayıcı eklenmiş').toBe(0);
    for (const [src, name] of [[mediaSrc, 'mediaService'], [localSrc, 'localMusic']] as const) {
      expect(src, `${name}: yeni ağ çağrısı`).not.toMatch(/fetch\(|XMLHttpRequest/);
    }
  });
});
