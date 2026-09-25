/**
 * maviMusicArtistRequest.test — SAHA 2026-09-25: "Ahmet Kaya'dan müzik çal"
 * → Mavi "müzik başlatıldı" deyip rastgele/eski müzik çalıyordu.
 *
 * Kök neden: yerel ayrıştırıcı sanatçıyı doğru çıkarıyordu ama cümle yine de
 * beyne gidiyordu; beyin sorgusuz "müzik aç" öneriyor ya da hiç eylem yapmadan
 * sohbet cevabı veriyordu. Net müzik isteği artık yerelde kalır.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCommandFull } from '../platform/commandParser';
import { isExplicitMusicQueryForLocal } from '../platform/voice/voiceCommandPolicy';
import { resolveMusicIntent } from '../platform/media/intent/musicIntentResolver';

const MIN = 0.7;
const local = (u: string) => isExplicitMusicQueryForLocal(parseCommandFull(u).command, u, MIN);

describe('net sanatçı isteği yerelde çalar (beyne gitmez)', () => {
  it.each([
    ["Ahmet Kaya'dan müzik çal", 'Ahmet Kaya'],
    ["Leyla Göktürk'ten müzik çal", 'Leyla Göktürk'],
    ['leyla göktürkten müzik çal', 'leyla göktürk'],
    ['Ahmet Kaya çal', 'Ahmet Kaya'],
  ])('%s → "%s"', (u, artist) => {
    const cmd = parseCommandFull(u).command!;
    expect(cmd.type).toBe('play_music_query');
    expect((cmd.extra as { query: string }).query).toBe(artist);
    expect(local(u)).toBe(true);
  });

  it('🔒 sorgusuz "müzik aç" beyin/genel yolda kalır', () => {
    expect(local('müzik aç')).toBe(false);
  });
  it('🔒 bileşik cümle beyinde kalır (plan orada)', () => {
    expect(isExplicitMusicQueryForLocal(parseCommandFull('Ahmet Kaya çal').command, 'eve götür ve Ahmet Kaya çal', MIN)).toBe(false);
  });
  it('🔒 düşük güvenli eşleşme bypass edilmez', () => {
    const cmd = { ...parseCommandFull('Ahmet Kaya çal').command!, confidence: 0.5 };
    expect(isExplicitMusicQueryForLocal(cmd, 'Ahmet Kaya çal', MIN)).toBe(false);
  });

  it('🔒 bypass beyin çağrısından ÖNCE, isim onarımı + tur mühürüyle bağlı', () => {
    const src = readFileSync(resolve(__dirname, '../platform/voiceService.ts'), 'utf8');
    const bypass = src.indexOf("route: 'music_query_local_bypass'");
    const brain = src.indexOf('const { provider, apiKey, hasNet, tavilyKey, searchKey, chain } = await _resolveAiKeys();');
    expect(bypass).toBeGreaterThan(0);
    expect(bypass).toBeLessThan(brain);
    const block = src.slice(bypass, bypass + 600);
    expect(block).toContain('_maybeRepairMusicQuery(result.command)');
    expect(block).toContain("continueIfTurnActive(turn, 'action')");
  });
});

describe('F9 anlayıcı ablatif eki aramaz', () => {
  it.each([
    ["Ahmet Kaya'dan müzik çal", 'ahmet kaya'],
    ['Ahmet Kayadan müzik çal', 'ahmet kaya'],
    ["Leyla Göktürk'ten şarkı çal", 'leyla gokturk'],
  ])('%s → %s', (u, q) => {
    expect(resolveMusicIntent(u)?.query).toBe(q);
  });
  it('🔒 müzik kelimesi yoksa apostrofsuz ek silinmez (isim bozulmaz)', () => {
    expect(resolveMusicIntent('Candan çal')?.query).toBe('candan');
  });
});
