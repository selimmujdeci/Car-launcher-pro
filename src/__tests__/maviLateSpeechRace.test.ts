/**
 * maviLateSpeechRace.test.ts — MAVI-M6-LATE-SPEECH-GATE · GEÇ KONUŞMA YARIŞI.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `commandExecutor` ve `voiceInfoService` bazı cevapları **`await` SONRASI**
 * söylüyordu (hava durumu 5 sn'ye kadar bekliyor, bakım özeti I/O yapıyor,
 * müzik araması dinamik import + arama zinciri koşuyor). Bu çağrılar yalnız
 * global tur durumuna ve M6 cevap defterine güveniyordu:
 *
 *   Kullanıcı A komutunu verir → cevabı beklemeden B komutunu verir →
 *   A'nın GEÇ cevabı konuşur VE `_syncTurn(B)` ile B'nin cevap slotunu açar
 *   → B'nin gerçek cevabı da konuşur = ÜST ÜSTE İKİ SES (M6 ihlali).
 *
 * Kaldırılan ölü stale dalı bunu HİÇBİR ZAMAN korumuyordu (kendini doğruluyordu).
 *
 * KİLİTLENEN SÖZLEŞME:
 *  · Komut girişinde YAKALANMIŞ token, async zincir boyunca taşınır.
 *  · Token eskimişse: TTS YOK · defter DEĞİŞMEZ · UI/toast YOK · hata DEĞİL.
 *  · Token verilmemişse davranış BİREBİR eskisi gibi (geriye uyumlu).
 *  · Tamamlanmış AMA current tur geç M3 sonucunu KONUŞABİLİR.
 *  · Proaktif güvenlik hattı bu sözleşmeye BAĞLI DEĞİLDİR.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({
  spoken: [] as string[],
  safety: [] as string[],
  maintenance: 'Bakım zamanı yaklaştı',
  weather: 'Hava açık, on sekiz derece',
  weatherReady: true,
  dtcState: {
    codes: [] as Array<{ severity: string; description: string }>,
    isReading: false, isClearing: false, lastReadAt: 1, error: null as string | null, isStale: false,
  },
}));

vi.mock('../platform/ttsService', () => ({
  speakFeedback:    (t: string) => { M.spoken.push(t); },
  speakAssistant:   (t: string) => { M.spoken.push(t); },
  speakSafetyAlert: (t: string) => { M.safety.push(t); },
  speakAlert: vi.fn(), ttsCancel: vi.fn(), registerTtsEndListener: () => () => {},
}));
vi.mock('../platform/bridge', () => ({
  isNative: false,
  bridge: { callNumber: vi.fn(), launchMusicSearch: vi.fn(), launchMusicQuery: vi.fn() },
}));
vi.mock('../platform/nativePlugin', () => ({ CarLauncher: {} }));
vi.mock('../platform/errorBus', () => ({ showToast: vi.fn() }));
vi.mock('../platform/dtcService', () => ({
  readDTCCodes: vi.fn(async () => {}),
  clearDTCCodes: vi.fn(async () => ({ allowed: true, userMessage: '' })),
  onDTCState: (cb: (s: unknown) => void) => { cb(M.dtcState); return () => {}; },
}));
/** Bakım özeti — GERÇEK bir `await` noktası (yarışın tetiklendiği yer). */
vi.mock('../platform/vehicleMaintenanceService', () => ({
  getMaintenanceSummaryText: async () => M.maintenance,
}));
vi.mock('../platform/weatherService', () => ({
  getWeatherNarrative: () => (M.weatherReady ? M.weather : 'Hava durumu henüz alınamadı'),
  refreshWeather: async () => {},
  onWeatherState: (cb: (s: unknown) => void) => {
    // Veri GEÇ gelir → `_waitForWeather` await'i gerçek bir pencere açar.
    setTimeout(() => cb({ weather: { tempC: 18 } }), 0);
    return () => {};
  },
  weatherQueryNamesCity: () => false,
}));

import { answerInformational } from '../platform/voiceInfoService';
import { executeIntent, type CommandContext } from '../platform/commandExecutor';
import {
  speakMaviAnswer, getMaviSpeechDiagnostics, _resetMaviSpeechForTest,
} from '../platform/assistant/maviSpeech';
import {
  beginMaviTurn, completeMaviTurn, continueIfTurnCurrent,
  _resetMaviTurnsForTest, type MaviTurnToken,
} from '../platform/assistant/maviTurn';
import { _resetMaviActionTraceForTest } from '../platform/action/maviActionTrace';
import { useUnifiedVehicleStore } from '../platform/vehicleDataLayer/UnifiedVehicleStore';
import type { AppIntent, IntentType } from '../platform/intentEngine';
import type { VehicleContext } from '../platform/aiVoiceService';

/* ── Harness ──────────────────────────────────────────────────────────────── */

const STOPPED = {
  speedKmh: 0, drivingMode: 'idle', isDriving: false, motionState: 'stopped',
} as unknown as VehicleContext;

function ctx(turn: MaviTurnToken | null, over: Partial<CommandContext> = {}): CommandContext {
  return {
    vehicleCtx: STOPPED, actionConfirmed: true, defaultNav: 'maps', defaultMusic: 'spotify',
    launch: vi.fn(), openDrawer: vi.fn(), turn,
    ...over,
  } as unknown as CommandContext;
}

function intent(type: IntentType, payload: Record<string, unknown> = {}): AppIntent {
  return { type, payload, priority: 'high' } as AppIntent;
}

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  _resetMaviActionTraceForTest();
  M.spoken = [];
  M.safety = [];
  M.maintenance = 'Bakım zamanı yaklaştı';
  M.weatherReady = true;
  M.dtcState = { codes: [], isReading: false, isClearing: false, lastReadAt: 1, error: null, isStale: false };
  useUnifiedVehicleStore.setState({ speed: 42, fuel: 60, canCoolantTemp: 90 } as never);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1-4 — Eski turun geç cevabı KONUŞMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LSG · 1-4. eski tur geç cevabı susar', () => {
  it('2. eski tur HAVA DURUMU cevabı konuşmaz (5 sn\'lik pencere)', async () => {
    M.weatherReady = false;                    // veri yok → await yolu açılır
    const t1 = beginMaviTurn();
    const p = answerInformational('show_weather', t1);
    beginMaviTurn();                           // kullanıcı YENİ komut verdi
    await p;
    /* AWAIT ÖNCESİ progress ("bakıyorum") tur HÂLÂ GÜNCELKEN söylendi → meşrudur
       ve susturulmaz. Kapının işi AWAIT SONRASI gelen NİHAİ CEVABI durdurmaktır. */
    expect(M.spoken).toEqual(['Hava durumuna bakıyorum.']);
    expect(M.spoken.join(' ')).not.toContain('on sekiz derece');
  });

  it('3. eski tur ARAÇ DURUMU (bakım await\'li) cevabı konuşmaz', async () => {
    const t1 = beginMaviTurn();
    const p = answerInformational('vehicle_status', t1);
    beginMaviTurn();
    await p;
    expect(M.spoken).toHaveLength(0);
  });

  it('3b. eski tur BAKIM özeti cevabı konuşmaz', async () => {
    const t1 = beginMaviTurn();
    const p = answerInformational('vehicle_maintenance', t1);
    beginMaviTurn();
    await p;
    expect(M.spoken).toHaveLength(0);
  });

  it('1. eski tur SENSÖR/araç okuması (senkron dal) da yeni turu KİRLETMEZ', async () => {
    const t1 = beginMaviTurn();
    beginMaviTurn();                           // t1 zaten eskidi
    await answerInformational('vehicle_speed', t1);
    expect(M.spoken).toHaveLength(0);
  });

  it('3c. eski tur `CHECK_MAINTENANCE` NİHAİ cevabı konuşmaz', async () => {
    const t1 = beginMaviTurn();
    const p = executeIntent(intent('CHECK_MAINTENANCE'), ctx(t1));
    beginMaviTurn();
    await p;
    await flush();
    // Await ÖNCESİ progress meşrudur; await SONRASI özet SUSMALIDIR.
    expect(M.spoken).toEqual(['Araç bakım durumu kontrol ediliyor']);
    expect(M.spoken.join(' ')).not.toContain('Bakım zamanı yaklaştı');
  });

  it('4. eski tur PROGRESS mesajı konuşmaz', async () => {
    const t1 = beginMaviTurn();
    beginMaviTurn();
    expect(speakMaviAnswer('Bakıyorum', { tier: 'progress', turn: t1 })).toBe(false);
    expect(M.spoken).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 — Stale konuşma answer/progress slotunu TÜKETMEZ (asıl kök neden)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LSG · 5. stale konuşma defteri bozmaz', () => {
  it('eski turun geç cevabı YENİ turun `answer` slotunu TÜKETMEZ', async () => {
    const t1 = beginMaviTurn();
    const p = answerInformational('vehicle_maintenance', t1);   // await'li
    const t2 = beginMaviTurn();
    await p;

    // Yeni tur kendi cevabını KONUŞABİLMELİ (slot yanmamış olmalı).
    expect(speakMaviAnswer('yeni turun cevabı', { turn: t2 })).toBe(true);
    expect(M.spoken).toEqual(['yeni turun cevabı']);
  });

  it('stale reddi `answered`/`progressed` bayraklarını DEĞİŞTİRMEZ', () => {
    const t1 = beginMaviTurn();
    const t2 = beginMaviTurn();
    speakMaviAnswer('yeni tur cevabı', { turn: t2 });
    const before = getMaviSpeechDiagnostics();

    speakMaviAnswer('eski turun geç cevabı', { turn: t1 });     // stale → düşer
    const after = getMaviSpeechDiagnostics();

    expect(after.turnId).toBe(before.turnId);
    expect(after.answeredThisTurn).toBe(before.answeredThisTurn);
    expect(after.progressedThisTurn).toBe(before.progressedThisTurn);
    expect(after.suppressedDuplicate).toBe(before.suppressedDuplicate);   // "duplicate" SAYILMAZ
    expect(after.staleLateSpeechSuppressed).toBe(before.staleLateSpeechSuppressed + 1);
  });

  it('stale reddi UI/toast/hata üretmez — yalnız `false` döner', () => {
    const t1 = beginMaviTurn();
    beginMaviTurn();
    expect(() => speakMaviAnswer('geç', { turn: t1 })).not.toThrow();
    expect(speakMaviAnswer('geç', { turn: t1 })).toBe(false);
    expect(M.spoken).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6-8 — Geçerli akışlar BOZULMAZ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LSG · 6-8. geçerli akışlar korunur', () => {
  it('6. yeni tur kendi cevabını BİR KEZ konuşur', async () => {
    const t = beginMaviTurn();
    await answerInformational('vehicle_maintenance', t);
    expect(M.spoken).toEqual(['Bakım zamanı yaklaştı']);
  });

  it('7. TAMAMLANMIŞ ama current tur geç M3 sonucunu konuşabilir', async () => {
    const t = beginMaviTurn();
    const p = executeIntent(intent('HARDWARE_HORN'), ctx(t));   // port yok → unsupported
    completeMaviTurn(t);                                        // tur bitti
    const r = await p;
    expect(r.status).toBe('unsupported');
    // Üretimdeki hook'un yaptığı gibi: `continueIfTurnCurrent` geçer → konuşur.
    expect(continueIfTurnCurrent(t, 'feedback')).toBe(true);
    expect(speakMaviAnswer('Bu araçta korna bağlantısı henüz hazır değil.', { turn: t })).toBe(true);
    expect(M.spoken).toHaveLength(1);
  });

  it('8. AKTİF turun normal async cevabı KONUŞUR (kapı meşru cevabı boğmaz)', async () => {
    const t = beginMaviTurn();
    await answerInformational('vehicle_status', t);
    expect(M.spoken).toHaveLength(1);
    expect(M.spoken[0]).toContain('Bakım zamanı yaklaştı');
  });

  it('8b. token VERİLMEZSE davranış eskisi gibi (geriye uyumlu)', async () => {
    const t1 = beginMaviTurn();
    const p = answerInformational('vehicle_maintenance');       // token YOK
    beginMaviTurn();
    await p;
    expect(M.spoken).toEqual(['Bakım zamanı yaklaştı']);        // eski davranış: konuşur
    void t1;
  });

  it('8c. hava durumu AKTİF turda progress + cevap ikilisini AŞMAZ', async () => {
    M.weatherReady = false;
    const t = beginMaviTurn();
    await answerInformational('show_weather', t);
    expect(M.spoken.length).toBeLessThanOrEqual(2);
    expect(M.spoken[0]).toBe('Hava durumuna bakıyorum.');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9 — Proaktif güvenlik hattı etkilenmez
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LSG · 9. proaktif hat kapsam dışı', () => {
  it('proaktif kritik uyarı, tur eskimiş olsa BİLE konuşur', async () => {
    const { speakSafetyAlert } = await import('../platform/ttsService');
    const t1 = beginMaviTurn();
    beginMaviTurn();
    speakMaviAnswer('eski turun cevabı', { turn: t1 });          // susar
    speakSafetyAlert('Motor sıcaklığı yüksek, güvenli yerde durun.');
    expect(M.spoken).toHaveLength(0);
    expect(M.safety).toHaveLength(1);
  });

  it('`maviSpeech` proaktif/navigasyon kanallarını kapsamaz', () => {
    const code = stripComments(
      readFileSync(join(process.cwd(), 'src', 'platform', 'assistant', 'maviSpeech.ts'), 'utf8'));
    expect(code).not.toMatch(/speakSafetyAlert/);
    expect(code).not.toMatch(/speakNavigation/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 10-11 — Guard: kapı ve token taşıma geri alınamaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-M6-LSG · 10/11. yapısal kilitler', () => {
  const EXEC_SRC = stripComments(
    readFileSync(join(process.cwd(), 'src', 'platform', 'commandExecutor.ts'), 'utf8'));
  const INFO_SRC = stripComments(
    readFileSync(join(process.cwd(), 'src', 'platform', 'voiceInfoService.ts'), 'utf8'));
  const SPEECH_SRC = stripComments(
    readFileSync(join(process.cwd(), 'src', 'platform', 'assistant', 'maviSpeech.ts'), 'utf8'));

  it('10. kapı `maviSpeech`te DURUYOR (kaldırılırsa yarış geri gelir)', () => {
    expect(SPEECH_SRC, 'geç konuşma kapısı kaldırılmış')
      .toMatch(/opts\.turn\s*&&\s*!isMaviTurnCurrent\(\s*opts\.turn\s*\)/);
    // Kapı DEFTER MUTASYONUNDAN (`_syncTurn`) ÖNCE olmalı — sonrasına kayarsa
    // stale konuşma yeni turun slotunu sıfırlar ve M6 sözleşmesi bozulur.
    expect(SPEECH_SRC.indexOf('opts.turn && !isMaviTurnCurrent'))
      .toBeLessThan(SPEECH_SRC.indexOf('_syncTurn(turn.id)'));   // TANIM değil ÇAĞRI
  });

  it('11a. `commandExecutor` içindeki HER konuşma token taşır (tip zorunlu)', () => {
    // `_speak`/`_speakProgress` üçüncü parametreyi ZORUNLU alır → tsc tüm
    // çağrı yerlerini kapsar; imza gevşetilirse bu kilit kırılır.
    expect(EXEC_SRC).toMatch(/function _speak\(text: string, isDriving: boolean, turn: MaviTurnToken \| null\)/);
    expect(EXEC_SRC).toMatch(/function _speakProgress\(text: string, isDriving: boolean, turn: MaviTurnToken \| null\)/);
    // İki argümanlı (korumasız) çağrı KALMAMALI.
    expect(EXEC_SRC).not.toMatch(/_speak\([^;]*?, isDriving\);/);
    expect(EXEC_SRC).not.toMatch(/_speakProgress\([^;]*?, isDriving\);/);
  });

  it('11b. `voiceInfoService` içinde token\'sız `speakMaviAnswer` KALMAZ', () => {
    const calls = [...INFO_SRC.matchAll(/speakMaviAnswer\(([\s\S]*?)\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) {
      expect(c, `token taşımayan konuşma: ${c.slice(0, 60)}`).toMatch(/turn/);
    }
  });

  it('11c. token komut GİRİŞİNDE yakalanır — global aktif tur OKUNMAZ', () => {
    // Her iki modül de `getActiveMaviTurn()` çağırmamalı: token dışarıdan gelir.
    expect(EXEC_SRC).not.toMatch(/getActiveMaviTurn\(/);
    expect(INFO_SRC).not.toMatch(/getActiveMaviTurn\(/);
  });

  it('11d. `dispatchIntent` token\'ı await\'lerden ÖNCE bir kez okur', () => {
    const head = EXEC_SRC.indexOf('async function dispatchIntent');
    expect(head).toBeGreaterThan(-1);
    const at = EXEC_SRC.indexOf('const _turn = ctx.turn ?? null;', head);
    expect(at, 'dispatchIntent token okumuyor').toBeGreaterThan(head);
    // İlk `await`ten önce okunmuş olmalı.
    expect(at).toBeLessThan(EXEC_SRC.indexOf('await', head));
  });
});
