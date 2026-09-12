/**
 * musicF73QueueAwareTransport.test.ts — MUSIC F7.3 · Kuyruk-farkında atlama.
 *
 * ÖLÇÜLEN KUSUR (F7.3 öncesi):
 *   `transportControlsFor` sonraki/önceki düğmelerini YALNIZ
 *   `capabilities.supportsQueue` ile açıyordu. YouTube IFrame'de bu alan
 *   (doğru biçimde) `false`tur — backend'in kendi zaman çizelgesi YOKTUR.
 *   Sonuç: kullanıcı bir arama sonucu LİSTESİNDEN çalmaya başlasa ve gerçek
 *   bir sıra VAR olsa bile Now Playing'de atlama düğmeleri ÇİZİLMİYORDU;
 *   donanım/bildirim tuşları da kapının `next()`ine gidip
 *   `unsupported_capability` ile düşüyordu.
 *
 * Bu paket "sıra ya backend'in ya üst katmanın" modelini kilitler ve
 * KARŞILIKSIZ düğme çizilmediğini doğrular.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transportControlsFor } from '../components/media/nowPlayingModel';
import { getSource } from '../platform/media/authority/sourceCapabilities';
import { createMusicViewModel } from '../components/media/MusicViewModel';
import type { MediaState } from '../platform/mediaService';
import type { NativeAuthoritySnapshot } from '../platform/nativePlugin';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
const strip = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const YOUTUBE = getSource('YOUTUBE').capabilities;
const LOCAL = getSource('LOCAL').capabilities;

describe('F7.3 · atlama meşruiyeti: sıra backendin VEYA üst katmanın', () => {
  it('YouTube backendinin kuyruğu YOKTUR — bu gerçek DEĞİŞMEZ', () => {
    expect(YOUTUBE.supportsQueue, 'sahte kuyruk yeteneği üretilmiş').toBe(false);
    expect(LOCAL.supportsQueue).toBe(true);
  });

  it('üst katman sırası YOKKEN YouTube atlama düğmesi ÇİZİLMEZ', () => {
    const c = transportControlsFor(YOUTUBE, true, 'idle', false);
    expect(c.next, 'karşılıksız düğme çizilmiş').toBe(false);
    expect(c.previous).toBe(false);
    expect(c.playPause, 'çal/duraklat backendde var — gizlenmemeli').toBe(true);
  });

  it('üst katman sırası VARSA YouTube atlama düğmesi ÇİZİLİR', () => {
    const c = transportControlsFor(YOUTUBE, true, 'idle', true);
    expect(c.next).toBe(true);
    expect(c.previous).toBe(true);
  });

  it('backend kuyruğu varsa üst katman sırası GEREKMEZ', () => {
    const c = transportControlsFor(LOCAL, true, 'idle', false);
    expect(c.next).toBe(true);
    expect(c.previous).toBe(true);
  });

  it('bağlam yoksa hiçbir kontrol çizilmez (sıra iddiası da yok)', () => {
    const c = transportControlsFor(YOUTUBE, false, 'idle', true);
    expect(c.next).toBe(false);
    expect(c.previous).toBe(false);
    expect(c.playPause).toBe(false);
  });

  it('sürüşte ikincil kontroller kapalı kalır — atlama etkilenmez', () => {
    const c = transportControlsFor(LOCAL, true, 'driving', true);
    expect(c.shuffle).toBe(false);
    expect(c.repeat).toBe(false);
    expect(c.next).toBe(true);
  });
});

describe('F7.3 · tek atlama girişi', () => {
  it('Now Playing atlama düğmeleri KUYRUK-FARKINDA katmandan geçer', () => {
    const src = strip(read('src/components/media/MediaScreen.tsx'));
    expect(src.length, 'ekran okunamadı — kilit boş kümeye düştü').toBeGreaterThan(5000);
    expect(src, 'atlama yine doğrudan kapıya bağlanmış').toContain('queueAwareNext');
    expect(src, 'atlama yine doğrudan kapıya bağlanmış').toContain('queueAwarePrevious');
    /* Kapıdan `next`/`previous` İTHAL EDİLMEMELİ (kuyruksuz backendde düşerdi). */
    expect(
      src,
      'kapının next/previous fonksiyonu ekrana geri sızmış',
    ).not.toMatch(/import\s*\{[^}]*\bnext\b[^}]*\}\s*from\s*'[^']*mediaCommandGateway'/);
  });

  it('donanım/bildirim tuşları da AYNI kuyruk-farkında girişten geçer', () => {
    const src = strip(read('src/platform/mediaService.ts'));
    const setup = src.slice(
      src.indexOf('function _setupMediaSession'),
      src.indexOf('function _teardownMediaSession'),
    );
    expect(setup.length, 'MediaSession kurulumu okunamadı').toBeGreaterThan(200);
    expect(setup, 'donanım atlaması kuyruk-farkında katmandan geçmiyor')
      .toContain('carosMediaLayer');
    /* Çal/duraklat KAPIDA kalmalı — orada backend dağıtımı zaten var. */
    expect(setup, 'çal/duraklat kanonik kapıdan çıkarılmış')
      .toContain('mediaCommandGateway');
  });

  it('kuyruk-farkında giriş her parçayı yine KANONİK kapıdan başlatır', () => {
    const layer = strip(read('src/platform/media/carosMediaLayer.ts'));
    /* Üst katman sırası ilerlerken çalma yine `_playTrack` → kapı yolundan
       gider; ikinci bir çalma yolu açılmaz. */
    expect(layer, 'kuyruk ilerletme kendi çalma yolunu kurmuş').toContain('_playTrack');
    expect(layer, 'kanonik kapı kullanılmıyor').toContain('mediaCommandGateway');
    expect(layer, 'doğrudan IFrame başlatma geri gelmiş')
      .not.toMatch(/\bplayYouTube\s*\(/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F7.5 · Gömülü IFrame kaynağında duraklat düğmesi
 * ════════════════════════════════════════════════════════════════════════ */

describe('F7.5 · IFrame kaynağında transport sunumu', () => {
  const media = (o: Partial<MediaState> = {}): MediaState => ({
    playing: false, source: 'local', activePackage: 'com.cockpitos.pro',
    activeAppName: 'Cihaz Müziği', hasSession: true, shuffle: false, repeat: 'off',
    permissionRequired: false, albumAccentRgb: '1, 2, 3',
    track: { title: 'Parça', artist: 'Sanatçı', positionSec: 3, durationSec: 100 },
    ...o,
  });
  const snap = (o: Partial<NativeAuthoritySnapshot> = {}): NativeAuthoritySnapshot => ({
    authorityAvailable: false, activeSource: 'NONE', focusState: 'NONE',
    audioRoute: 'UNKNOWN', playing: false, renderingVerified: false, queueLength: 0, ...o,
  });

  it('IFrame PLAYING olayı transportu PLAYING yapar — duraklat düğmesi çalışır', () => {
    const vm = createMusicViewModel(
      media({ source: 'youtube', activePackage: 'com.cockpitos.pro.youtube', playing: true }),
      snap(),
    );
    expect(vm.sourceClass).toBe('YOUTUBE');
    expect(vm.transport).toBe('PLAYING');
    expect(vm.isAudiblyPlaying).toBe(true);
  });

  it('IFrame duraklıyken PAUSED — sahte PLAYING yok', () => {
    const vm = createMusicViewModel(
      media({ source: 'youtube', activePackage: 'com.cockpitos.pro.youtube', playing: false }),
      snap(),
    );
    expect(vm.transport).toBe('PAUSED');
  });

  it('NATIVE kaynakta kural DEĞİŞMEDİ: doğrulanmamış playing PLAYING sayılmaz', () => {
    const vm = createMusicViewModel(
      media({ playing: true }),
      snap({ authorityAvailable: true, activeSource: 'LOCAL', playing: true, queueLength: 1 }),
    );
    expect(vm.transport, 'F0 dürüstlük kuralı gevşetilmiş').toBe('UNKNOWN');
  });

  it('Spotify/harici kaynak DEĞİŞMEDİ — kanıtsız PLAYING üretilmez', () => {
    const vm = createMusicViewModel(media({ source: 'spotify', playing: true }), snap());
    expect(vm.transport).toBe('UNKNOWN');
  });
});
