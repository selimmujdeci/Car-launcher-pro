/**
 * Mavi smoke testi (telefon, 2026-09-25) bulgularının kilitleri.
 * Her satır sahada yanlış davranan bir komuttur.
 */
import { describe, it, expect } from 'vitest';
import { parseCommandFull, matchDeterministicWholeInput } from '../platform/commandParser';
import { stopNavigationResult } from '../platform/intentEngine';
import { isNarrowSafeMusicKind } from '../platform/media/intent/musicIntent';
import { resolveMusicIntent } from '../platform/media/intent/musicIntentResolver';

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
});
