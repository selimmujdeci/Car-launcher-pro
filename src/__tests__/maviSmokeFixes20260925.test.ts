/**
 * Mavi smoke testi (telefon, 2026-09-25) bulgularının kilitleri.
 * Her satır sahada yanlış davranan bir komuttur.
 */
import { describe, it, expect } from 'vitest';
import { parseCommandFull, matchDeterministicWholeInput } from '../platform/commandParser';
import { stopNavigationResult, routeIntent, type AppIntent, type RouterContext } from '../platform/intentEngine';
import { isResultAckCommand } from '../platform/voice/voiceCommandPolicy';
import { describeSettingResult } from '../platform/settingsVoice';
import { isNarrowSafeMusicKind } from '../platform/media/intent/musicIntent';
import { resolveMusicIntent } from '../platform/media/intent/musicIntentResolver';
import { isGeminiLiveEnabled, _resetGeminiLiveFlagForTest, GEMINI_LIVE_LOCAL_FLAG } from '../platform/ai/live/geminiLiveFlag';

const cmd = (t: string) => parseCommandFull(t).command;

describe('Mavi smoke 2026-09-25', () => {
  it('"navigasyonu iptal et" rota BAŞLATMAZ — yerel iptal komutudur', () => {
    expect(cmd('navigasyonu iptal et')?.type).toBe('stop_navigation');
    expect(matchDeterministicWholeInput('navigasyonu iptal et')?.type).toBe('stop_navigation');
    expect(cmd('haritayı aç')?.type).toBe('open_maps');
  });

  it('aktif rota yokken iptal dürüstçe "rota yok" der', () => {
    const r = stopNavigationResult();
    expect(r.reason).toBe('nothing_active');
    expect(r.detail).toMatch(/aktif bir rota yok/);
  });

  it('"önceki şarkıya geç" müzik açmaz, önceki parçaya geçer', () => {
    expect(cmd('önceki şarkıya geç')?.type).toBe('music_prev');
    expect(matchDeterministicWholeInput('önceki şarkıya geç')?.type).toBe('music_prev');
  });

  it('"uyku moduna al" yerelde çözülür', () => {
    expect(matchDeterministicWholeInput('uyku moduna al')?.type).toBe('toggle_sleep_mode');
  });

  it('"geri görüş kamerasını aç" tam ifade olarak tanınır', () => {
    const r = parseCommandFull('geri görüş kamerasını aç');
    expect(r.command?.type).toBe('hw_rear_camera');
    expect(r.safetyDecision?.blocked).not.toBe(true);
  });

  it('asistanın adı ve "kaç" tek başına komut üretmez', () => {
    expect(cmd('merhaba mavi')?.type).not.toBe('open_maps');
    expect(cmd('yüz yirmi bölü dört kaç')?.type).not.toBe('vehicle_speed');
    expect(cmd('hızım kaç')?.type).toBe('vehicle_speed');
  });

  it('müzik sorgusundan niceleyici ve iyelik eki temizlenir', () => {
    const q = (t: string) => cmd(t)?.extra?.query;
    expect(q("Sezen Aksu'dan bir şarkı aç")).toBe('Sezen Aksu');
    expect(q("Tarkan'ın Şımarık şarkısını çal")).toBe('Tarkan Şımarık');
    expect(q("Barış Manço'nun şarkılarını aç")).toBe('Barış Manço');
    expect(q("Ahmet Kaya'dan müzik çal")).toBe('Ahmet Kaya');
  });

  it('ruh hâli / sözler istekleri serbest arama değil, ayrık F9 niyetidir', () => {
    for (const t of ['daha sakin bir şey çal', 'şarkı sözlerini göster']) {
      const mi = resolveMusicIntent(t);
      expect(mi, t).not.toBeNull();
      expect(isNarrowSafeMusicKind(mi!.kind), t).toBe(true);
    }
    expect(isNarrowSafeMusicKind(resolveMusicIntent('Ahmet Kaya çal')?.kind ?? 'PLAY_QUERY')).toBe(false);
  });

  it('ev adresi yokken "eve götür" TEK dürüst sonuç verir (parser metni susar)', async () => {
    expect(isResultAckCommand('navigate_home')).toBe(true);
    expect(isResultAckCommand('stop_navigation')).toBe(true);
    const ctx = { launch: () => {}, openDrawer: () => {}, setTheme: () => {}, playMedia: () => {}, pauseMedia: () => {} } as unknown as RouterContext;
    const r = await routeIntent({ type: 'OPEN_NAVIGATION', payload: { destination: 'home' } } as AppIntent, ctx);
    expect(r.status).toBe('failed');
    expect((r.detail ?? '').length).toBeGreaterThan(0);
  });

  it('"ana sayfa" eve ROTA değil, ana ekrana dönüş komutudur', () => {
    for (const t of ['ana ekrana dön', 'ana sayfa', 'anasayfa', 'ana ekran']) {
      expect(cmd(t)?.type, t).toBe('go_home_screen');
      expect(matchDeterministicWholeInput(t)?.type, t).toBe('go_home_screen');
    }
    expect(cmd('eve götür')?.type).toBe('navigate_home');
  });

  it('tek asistan sesi: Gemini Live varsayılan KAPALI, yalnız bilinçli açılır', () => {
    localStorage.removeItem(GEMINI_LIVE_LOCAL_FLAG); _resetGeminiLiveFlagForTest();
    expect(isGeminiLiveEnabled()).toBe(false);
    localStorage.setItem(GEMINI_LIVE_LOCAL_FLAG, 'true'); _resetGeminiLiveFlagForTest();
    expect(isGeminiLiveEnabled()).toBe(true);
    localStorage.removeItem(GEMINI_LIVE_LOCAL_FLAG); _resetGeminiLiveFlagForTest();
  });

  it('"Kral FM aç" istasyon adını taşır (F9 radyo araması)', () => {
    expect(cmd('radyodan Kral FM aç')?.type).toBe('open_radio');
    expect(resolveMusicIntent('radyodan Kral FM aç')?.query).toBe('kral fm');
    expect(resolveMusicIntent('radyo aç')?.query ?? null).toBeNull();
  });

  it('ses yüzdesi yazıyla söylenince de anlaşılır ("kırk beş" → 45)', () => {
    const v = (t: string) => cmd(t)?.extra?.settingValue;
    expect(v('sesi yüzde kırk beş yap')).toBe('45');
    expect(v('sesi yüzde elli yap')).toBe('50');
    expect(v('sesi yüzde yüz yap')).toBe('100');
    expect(cmd('sesi aç')?.type).toBe('volume_up');
  });

  it('değişmeyen ayar "uygulandı" denmez', () => {
    expect(describeSettingResult('brightness', 'inc', undefined, { kind: 'REJECTED', key: 'brightness', reason: 'at_max' }).text)
      .toBe('Parlaklık zaten en yüksek seviyede.');
    expect(describeSettingResult('volume', 'set', '', { kind: 'REJECTED', key: 'volume', reason: 'missing_value' }).status).toBe('failed');
    expect(describeSettingResult('volume', 'set', '45', { kind: 'APPLIED', key: 'volume' }).text).toBe('Ses yüzde 45 yapıldı');
    expect(isResultAckCommand('screen_brightness_up')).toBe(true);
  });
});
