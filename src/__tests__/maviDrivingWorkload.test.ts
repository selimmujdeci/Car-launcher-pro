/**
 * maviDrivingWorkload.test.ts — **MAVİ F8 KİLİTLERİ.**
 *
 * F8'in sözleşmesini kilitler:
 *  · workload bounded bir DURUM modelidir (tek boolean DEĞİL),
 *  · **safety/execution authority DEĞİLDİR** — aracı kontrol etmez, navigasyon
 *    kararını değiştirmez, capability kapatmaz,
 *  · yalnız TAVAN koyar — mevcut ISO 15008 kısıtını ASLA gevşetmez,
 *  · `UNKNOWN` dürüsttür: NORMAL bütçesini alır ama LOW İDDİA ETMEZ,
 *  · presence (F1) ile workload AYRI eksendir,
 *  · güvenlik uyarıları ve navigasyon anonsu ASLA susturulmaz,
 *  · erteleme bir DURUMDUR (F2: kalıp cümle üretilmez) ve stale olunca DÜŞER,
 *  · akış sırasında iş yükü yükselirse kelime ortasından KESİLMEZ,
 *  · F0–F7 invariant'ları BOZULMAZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M = vi.hoisted(() => ({ feedback: vi.fn(), assistant: vi.fn(), alert: vi.fn(), safety: vi.fn() }));

vi.mock('../platform/ttsService', () => ({
  speakFeedback:    (...a: unknown[]) => M.feedback(...a),
  speakAssistant:   (...a: unknown[]) => M.assistant(...a),
  speakAlert:       (...a: unknown[]) => M.alert(...a),
  speakSafetyAlert: (...a: unknown[]) => M.safety(...a),
  ttsCancel: vi.fn(),
  registerTtsEndListener: () => () => {},
}));

import {
  MAVI_DEFERRAL_TTL_MS, MAVI_WORKLOAD_MANEUVER_M, MAVI_WORKLOAD_FAST_KMH,
  MAVI_WORKLOAD_SHORT_WORDS, MAVI_WORKLOAD_MINIMAL_WORDS,
  applyResponseBudget, clearDeferredResponse, currentMaviResponseBudget,
  currentMaviWorkload, getMaviWorkloadDiagnostics, peekDeferredResponse,
  recordDeferredResponse, resolveMaviWorkload, responseBudgetFor,
  setMaviWorkloadSnapshotSource, _resetMaviWorkloadForTest,
  type MaviWorkloadLevel, type MaviWorkloadSnapshot,
} from '../platform/assistant/maviWorkload';
import {
  speakMaviAnswer, trimForDriving, MAVI_DRIVING_MAX_WORDS,
  _resetMaviSpeechForTest,
} from '../platform/assistant/maviSpeech';
import { beginMaviTurn, _resetMaviTurnsForTest } from '../platform/assistant/maviTurn';
/* MAVI-F9: güvenlik sınıfının dokunulmazlığı artık BU tablodan doğrulanır. */
import { PROACTIVE_CLASS_RULES } from '../platform/assistant/proactivePolicyEngine';
import { buildMaviSections } from '../platform/devtools/maviConsoleModel';
import type { MaviRawSnapshot } from '../platform/devtools/maviConsoleModel';

const src = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const WORKLOAD = 'platform/assistant/maviWorkload.ts';
const WORKLOAD_SRC = 'platform/assistant/maviWorkloadSource.ts';

/** Kanıtsız taban snapshot — testler yalnız ilgilendikleri alanı ezer. */
const snap = (p: Partial<MaviWorkloadSnapshot> = {}): MaviWorkloadSnapshot => ({
  motionState: 'unknown',
  speedKmh: null,
  reverseActive: null,
  guidanceActive: null,
  maneuverDistanceM: null,
  maneuverDistanceSource: null,
  safetyCritical: null,
  cognitiveLoad: null,
  ...p,
});

const levelOf = (p: Partial<MaviWorkloadSnapshot>): MaviWorkloadLevel =>
  resolveMaviWorkload(snap(p), 1_000).level;

beforeEach(() => {
  _resetMaviWorkloadForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
  M.feedback.mockClear(); M.assistant.mockClear(); M.alert.mockClear(); M.safety.mockClear();
});
afterEach(() => {
  _resetMaviWorkloadForTest();
  _resetMaviTurnsForTest();
  _resetMaviSpeechForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * A — Bounded durum modeli (tek boolean DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · A · workload bounded bir DURUM modelidir', () => {
  it('1. **LOW ↔ HIGH GEÇİŞİ**: aynı kaynaklardan iki uç seviye de üretilebilir', () => {
    expect(levelOf({ motionState: 'stopped' })).toBe('LOW');
    expect(levelOf({ motionState: 'moving', speedKmh: MAVI_WORKLOAD_FAST_KMH })).toBe('HIGH');
  });

  it('2. altı seviyenin tamamı ULAŞILABİLİRDİR (ölü seviye yok)', () => {
    const seen = new Set<MaviWorkloadLevel>([
      levelOf({ motionState: 'stopped' }),                                   // LOW
      levelOf({ motionState: 'stopped', guidanceActive: true }),             // NORMAL
      levelOf({ motionState: 'moving', speedKmh: 30 }),                      // ELEVATED
      levelOf({ motionState: 'moving', speedKmh: 120 }),                     // HIGH
      levelOf({ reverseActive: true }),                                      // CRITICAL
      levelOf({}),                                                           // UNKNOWN
    ]);
    expect([...seen].sort()).toEqual(
      ['CRITICAL', 'ELEVATED', 'HIGH', 'LOW', 'NORMAL', 'UNKNOWN'],
    );
  });

  it('3. **UNKNOWN LOW DEĞİLDİR** — kanıt yokluğu duruş iddiası ÜRETMEZ', () => {
    const v = resolveMaviWorkload(snap({}), 5);
    expect(v.level).toBe('UNKNOWN');
    expect(v.evidence).toEqual(['no_evidence']);
    expect(resolveMaviWorkload(null, 5).level).toBe('UNKNOWN');
  });

  it('4. kritik kanıtlar (geri vites · güvenlik · bilişsel) CRITICAL üretir', () => {
    expect(levelOf({ reverseActive: true, motionState: 'stopped' })).toBe('CRITICAL');
    expect(levelOf({ safetyCritical: true, motionState: 'stopped' })).toBe('CRITICAL');
    expect(levelOf({ cognitiveLoad: 'critical', motionState: 'stopped' })).toBe('CRITICAL');
  });

  it('5. bilişsel PROTECTION HIGH üretir (mevcut motorun hükmü EZİLMEZ)', () => {
    expect(levelOf({ cognitiveLoad: 'protection', motionState: 'stopped' })).toBe('HIGH');
  });

  it('6. duruşta rota açıksa NORMAL, kapalıysa LOW (kırmızı ışık yüksek yük DEĞİL)', () => {
    expect(levelOf({ motionState: 'stopped', guidanceActive: true })).toBe('NORMAL');
    expect(levelOf({ motionState: 'stopped', guidanceActive: false })).toBe('LOW');
  });

  it('7. hüküm KANITINI taşır ve kanıt kodları bounded kalır', () => {
    const v = resolveMaviWorkload(
      snap({ motionState: 'moving', speedKmh: 100, guidanceActive: true }), 1);
    expect(v.evidence).toContain('motion_fast');
    for (const e of v.evidence) expect(typeof e).toBe('string');
    /* Ham ölçüm (hız/mesafe) kanıt kümesine SIZAMAZ. */
    expect(JSON.stringify(v.evidence)).not.toMatch(/100|\d{2,}/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Manevra yakınlığı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · B · manevra yakınlığı', () => {
  const nearing = (p: Partial<MaviWorkloadSnapshot>) => levelOf({
    motionState: 'moving', speedKmh: 30, guidanceActive: true, ...p,
  });

  it('8. **YAKIN MANEVRA HIGH üretir** (yavaş gitse bile)', () => {
    expect(nearing({
      maneuverDistanceM: MAVI_WORKLOAD_MANEUVER_M - 1, maneuverDistanceSource: 'ALONG_ROUTE',
    })).toBe('HIGH');
  });

  it('9. uzak manevra HIGH ÜRETMEZ — hareket ELEVATED\'te kalır', () => {
    expect(nearing({
      maneuverDistanceM: MAVI_WORKLOAD_MANEUVER_M + 500, maneuverDistanceSource: 'ALONG_ROUTE',
    })).toBe('ELEVATED');
  });

  it('10. **KAYNAĞI `UNKNOWN` OLAN MESAFE KANIT SAYILMAZ** (uydurma yakınlık yok)', () => {
    expect(nearing({ maneuverDistanceM: 10, maneuverDistanceSource: 'UNKNOWN' })).toBe('ELEVATED');
    expect(nearing({ maneuverDistanceM: 10, maneuverDistanceSource: null })).toBe('ELEVATED');
  });

  it('11. rehberlik YOKKEN manevra mesafesi okunmaz (bayat rota kanıt değil)', () => {
    expect(levelOf({
      motionState: 'moving', speedKmh: 30, guidanceActive: false,
      maneuverDistanceM: 5, maneuverDistanceSource: 'ALONG_ROUTE',
    })).toBe('ELEVATED');
  });

  it('12. `STRAIGHT_LINE` kabul edilir — hata yönü GÜVENLİ taraftadır', () => {
    expect(nearing({
      maneuverDistanceM: 50, maneuverDistanceSource: 'STRAIGHT_LINE',
    })).toBe('HIGH');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — Cevap bütçesi (response policy)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · C · konuşma bütçesi', () => {
  it('13. LOW/NORMAL tam bütçe · ELEVATED kısa · HIGH asgari · CRITICAL yalnız gerekli', () => {
    expect(responseBudgetFor('LOW').klass).toBe('FULL');
    expect(responseBudgetFor('NORMAL').klass).toBe('FULL');
    expect(responseBudgetFor('ELEVATED').klass).toBe('SHORT');
    expect(responseBudgetFor('HIGH').klass).toBe('MINIMAL');
    expect(responseBudgetFor('CRITICAL').klass).toBe('ESSENTIAL_ONLY');
  });

  it('14. **UNKNOWN = NORMAL bütçesi** — kanıt yokluğu Mavi\'yi SUSTURMAZ', () => {
    expect(responseBudgetFor('UNKNOWN')).toMatchObject({
      klass: 'FULL', maxWords: null, allowChat: true, allowFollowUp: true,
      allowProactiveChatter: true, allowStreaming: true,
    });
  });

  it('15. takip dinlemesi ve proaktif sohbet ELEVATED\'ten itibaren KAPANIR', () => {
    for (const l of ['ELEVATED', 'HIGH', 'CRITICAL'] as const) {
      expect(responseBudgetFor(l).allowFollowUp, l).toBe(false);
      expect(responseBudgetFor(l).allowProactiveChatter, l).toBe(false);
    }
    for (const l of ['LOW', 'NORMAL', 'UNKNOWN'] as const) {
      expect(responseBudgetFor(l).allowFollowUp, l).toBe(true);
    }
  });

  it('16. akış cevabı HIGH ve CRITICAL\'da AÇILMAZ', () => {
    expect(responseBudgetFor('HIGH').allowStreaming).toBe(false);
    expect(responseBudgetFor('CRITICAL').allowStreaming).toBe(false);
    expect(responseBudgetFor('ELEVATED').allowStreaming).toBe(true);
  });

  it('17. serbest sohbet YALNIZ CRITICAL\'da kapanır (HIGH\'ta kısa cevap sürer)', () => {
    expect(responseBudgetFor('HIGH').allowChat).toBe(true);
    expect(responseBudgetFor('CRITICAL').allowChat).toBe(false);
  });

  it('18. bütçe kelime SINIRINDA keser — kelime ortasından harf kesilmez', () => {
    const text = 'bir iki üç dört beş altı yedi sekiz dokuz on onbir oniki';
    const out = applyResponseBudget(text, 5);
    expect(out.startsWith('bir iki üç dört beş')).toBe(true);
    expect(out.replace('…', '').trim().split(/\s+/)).toHaveLength(5);
  });

  it('19. tavan yoksa metin DOKUNULMADAN döner', () => {
    expect(applyResponseBudget('tam cevap', null)).toBe('tam cevap');
    expect(applyResponseBudget('kısa', 99)).toBe('kısa');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — "Yalnız tavan koyar, GEVŞETMEZ"
 * ════════════════════════════════════════════════════════════════════════ */

const LONG_30 = Array.from({ length: 30 }, (_, i) => `k${i}`).join(' ');

describe('MAVI-F8 · D · workload hiçbir kısıtı GEVŞETMEZ', () => {
  it('20. **ISO 15008 SÜRÜŞ KISITI YERİNDE**: LOW workload 8 kelime tavanını AÇMAZ', () => {
    setMaviWorkloadSnapshotSource(() => snap({ motionState: 'stopped' }));   // LOW
    beginMaviTurn();
    expect(speakMaviAnswer(LONG_30, { isDriving: true })).toBe(true);
    const spoken = String(M.feedback.mock.calls[0]?.[0] ?? '');
    expect(spoken.split(/\s+/).length).toBeLessThanOrEqual(MAVI_DRIVING_MAX_WORDS);
  });

  it('21. ELEVATED bütçesi sürüş DIŞINDA da cevabı KISALTIR', () => {
    setMaviWorkloadSnapshotSource(() => snap({ motionState: 'moving', speedKmh: 30 }));
    beginMaviTurn();
    expect(speakMaviAnswer(LONG_30, { isDriving: false })).toBe(true);
    const spoken = String(M.feedback.mock.calls[0]?.[0] ?? '');
    expect(spoken.replace('…', '').trim().split(/\s+/).length)
      .toBeLessThanOrEqual(MAVI_WORKLOAD_SHORT_WORDS);
    expect(getMaviWorkloadDiagnostics().responsesShortened).toBeGreaterThan(0);
  });

  it('22. kaynak BAĞLI DEĞİLKEN davranış BUGÜNKÜYLE BİREBİR aynıdır (regresyon yok)', () => {
    setMaviWorkloadSnapshotSource(null);
    beginMaviTurn();
    expect(speakMaviAnswer(LONG_30, { isDriving: false })).toBe(true);
    expect(String(M.feedback.mock.calls[0]?.[0] ?? '')).toBe(LONG_30);
    expect(currentMaviWorkload().level).toBe('UNKNOWN');
  });

  it('23. `trimForDriving` HÂLÂ tek ISO kısaltma noktasıdır ve DEĞİŞMEDİ', () => {
    expect(trimForDriving(LONG_30, true).split(/\s+/)).toHaveLength(MAVI_DRIVING_MAX_WORDS);
    expect(trimForDriving(LONG_30, false)).toBe(LONG_30);
    expect(MAVI_WORKLOAD_MINIMAL_WORDS).toBe(MAVI_DRIVING_MAX_WORDS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — Erteleme: DEFERRED ≠ COMPLETED
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · E · erteleme bir DURUMDUR, cümle DEĞİLDİR', () => {
  it('24. erteleme kaydedilir ve TTL içinde okunur', () => {
    recordDeferredResponse(7, 'CRITICAL', 1_000);
    expect(peekDeferredResponse(1_100)).toMatchObject({ turnId: 7, level: 'CRITICAL' });
  });

  it('25. **BAYAT ERTELEME DÜŞER** — sonradan "cevap hazır" gibi sunulamaz', () => {
    recordDeferredResponse(7, 'CRITICAL', 1_000);
    expect(peekDeferredResponse(1_000 + MAVI_DEFERRAL_TTL_MS + 1)).toBeNull();
    expect(peekDeferredResponse(1_100)).toBeNull();          // yuva temizlendi
    expect(getMaviWorkloadDiagnostics().deferralsExpired).toBe(1);
  });

  it('26. erteleme yuvası TEKtir — birikmez (kuyruk yok → toplu geri oynatma yok)', () => {
    recordDeferredResponse(1, 'CRITICAL', 1_000);
    recordDeferredResponse(2, 'CRITICAL', 1_000);
    expect(peekDeferredResponse(1_050)?.turnId).toBe(2);
    clearDeferredResponse();
    expect(peekDeferredResponse(1_050)).toBeNull();
  });

  it('27. **F2 KORUMASI**: workload katmanı KALIP ERTELEME CÜMLESİ üretmez', () => {
    /* Yorumlar SOYULUR: kapının kendisi kodda aranır — açıklama metni bir
       kalıp cümle ÜRETMEZ, üretilen kod üretir. */
    const code = codeOf(src(WORKLOAD));
    const lower = code.toLocaleLowerCase('tr-TR');
    for (const canned of ['yola odaklan', 'sonra söylerim', 'bir saniye', 'şimdi olmaz']) {
      expect(lower, canned).not.toContain(canned);
    }
    /* Erteleme yalnız DURUM olarak modellenir. */
    expect(code).toContain('recordDeferredResponse');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — Kaynak kilitleri (mimari sınırlar)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · F · workload OTORİTE DEĞİLDİR', () => {
  it('28. **ARACI/NAVİGASYONU/SESİ KONTROL ETMEZ** (ikinci yürütücü yasağı)', () => {
    const code = codeOf(src(WORKLOAD));
    for (const forbidden of [
      'dispatchIntent', 'executeIntent', 'startNavigation', 'stopNavigation',
      'mediaCommandGateway', 'ttsCancel', 'speakMaviAnswer', 'speakSafetyAlert',
      'startListening', 'stopListening', 'CarLauncher',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('29. **GÜVENLİK KARARI VERMEZ** — kanonik kapılar TAKLİT EDİLMEZ', () => {
    const code = codeOf(src(WORKLOAD));
    for (const forbidden of [
      'evaluateVehicleAction', 'evaluateActionIdSafety', 'createAiSafetyGate',
      'MOTION_STOPPED_MAX_KMH', 'setPendingAction', 'writeGate',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('30. çözümleyici SAFTIR (I/O · timer · Date.now · store importu YOK)', () => {
    const code = codeOf(src(WORKLOAD));
    for (const forbidden of ['setTimeout', 'setInterval', 'Date.now', 'localStorage', 'fetch(']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    /* Canlı okuma AYRI adaptördedir; saf dosya hiçbir servis import etmez. */
    const imports = src(WORKLOAD).match(/^import .*/gm) ?? [];
    expect(imports).toHaveLength(0);
  });

  it('31. canlı adaptör MEVCUT otoriteleri OKUR, yenisini kurmaz ve YAZMAZ', () => {
    const code = codeOf(src(WORKLOAD_SRC));
    expect(code).toContain('getNavigationState');
    expect(code).toContain('getRouteState');
    expect(code).toContain('evaluatePreGate');
    expect(code).toContain('currentMaviVehicleContext');
    for (const forbidden of ['setTimeout', 'setInterval', 'subscribe(', 'addEventListener',
      'startNavigation', 'setNavStatus', 'setReverse(', 'setMode(']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('32. **OLMAYAN SİNYAL UYDURULMADI**: telefon görüşmesi alanı YOKTUR', () => {
    /* Denetim ölçtü: üretimde `duck(\'PHONE\')` çağıran yok, native telephony
       dinleyicisi yok → sinyal YOK. Sahte alan eklemek, ölçülmemiş bir gerçeği
       ölçülmüş gibi gösterirdi. */
    const code = codeOf(src(WORKLOAD)) + codeOf(src(WORKLOAD_SRC));
    expect(code).not.toMatch(/phoneCall|callActive|inCall|telephony/i);
  });

  it('33. **GİZLİLİK**: ham sürüş verisi telemetriye TAŞINMAZ', () => {
    const trace = codeOf(src('platform/assistant/maviLatencyTrace.ts'));
    const i = trace.indexOf('setMaviLatencyWorkload');
    expect(i).toBeGreaterThan(-1);
    const body = trace.slice(i, trace.indexOf('\n}', i) + 2);
    for (const forbidden of ['speedKmh', 'maneuverDistance', 'latitude', 'longitude', 'transcript']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G — Presence · komut yeteneği · güvenlik önceliği
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · G · presence ≠ workload · yetenek KAPANMAZ', () => {
  it('34. **F1 KORUNDU**: workload katmanı `companionEnabled`e HİÇ bakmaz', () => {
    const code = codeOf(src(WORKLOAD)) + codeOf(src(WORKLOAD_SRC));
    expect(code).not.toContain('companionEnabled');
    expect(code).not.toContain('presence');
  });

  it('35. **HIGH\'TA KOMUT YETENEĞİ AÇIK KALIR** — bütçe capability kapatmaz', () => {
    const b = responseBudgetFor('HIGH');
    /* Bütçe sözleşmesinde bir "yetenek" alanı YOKTUR — kapatılacak bir şey yok. */
    expect(Object.keys(b).sort()).toEqual([
      'allowChat', 'allowFollowUp', 'allowProactiveChatter', 'allowStreaming',
      'klass', 'level', 'maxWords',
    ]);
    /* Yürütücü/kapı hatları workload'u OKUMAZ (tek yönlü bağımlılık). */
    for (const f of ['platform/commandExecutor.ts', 'platform/action/maviActionAuthority.ts',
      'platform/capability/fabric/capabilityFabric.ts']) {
      expect(codeOf(src(f)), f).not.toContain('maviWorkload');
    }
  });

  /* ⚠️ MAVI-F9 KİLİT GÜNCELLEMESİ (kaldırma DEĞİL, yeniden bağlama).
   *
   * ESKİ HÂLİ: `companionEngine.ts` içinde `allowProactiveChatter` kapısının
   * `_lastFuelWarnMin` · `_lastDoorWarnMin` · `_lastTpmsWarnMin` ·
   * `_lastVisLightsMin` · `_lastDrowsyMin` değişkenlerinden SONRA geldiğini
   * (kaynak metin sırasıyla) doğruluyordu.
   *
   * NEDEN ARTIK YANLIŞ: F9 cooldown defterini `proactivePolicyEngine`e taşıdı;
   * o beş değişken companionEngine'de ARTIK YOKTUR. `indexOf` her biri için
   * -1 döner ve `-1 < gate` DAİMA doğrudur → kilit **sessizce boş kümeye
   * düşer** ve hiçbir şeyi korumaz (CLAUDE.md "kör guard = düşen guard").
   *
   * YENİ HÂLİ aynı invaryantı DAHA GÜÇLÜ kilitler: sıra-bağımlı metin taraması
   * yerine, güvenlik sınıfının bütçe/presence/tavan/öğrenmeden bağımsızlığını
   * TEK TABLODAN (`PROACTIVE_CLASS_RULES`) ve beş tetiğin `safety` sınıfında
   * beyan edildiğini kaynaktan doğrular. Davranış kilidi ayrıca
   * `maviProactivePolicy.test.ts` B bölümünde çalıştırılarak kanıtlanır. */
  it('36. **GÜVENLİK UYARISI ASLA SUSTURULMAZ** — sınıf tablosu tek otoritedir', () => {
    const engine = codeOf(src('platform/companion/companionEngine.ts'));

    /* Beş güvenlik tetiği `safety` sınıfında BEYAN EDİLMİŞ olmalı. */
    for (const s of ['S.fuel', 'S.door', 'S.tpms', 'S.visibility', 'S.drowsy']) {
      expect(engine, s).toContain(`proposal(${s}, 'safety'`);
    }
    /* Sohbet tetikleri `social` sınıfındadır → iş yükü tavanı NORMAL, yani
       ELEVATED ve üstünde susarlar (eski `allowProactiveChatter` davranışı). */
    for (const s of ['S.greeting', 'S.breakHint', 'S.tripNote']) {
      expect(engine, s).toContain(`proposal(${s}, 'social'`);
    }

    /* Tablo tek otoritedir ve güvenlik sınıfı dokunulmazdır. */
    expect(PROACTIVE_CLASS_RULES.safety.maxWorkload).toBe('CRITICAL');
    expect(PROACTIVE_CLASS_RULES.safety.learnedSuppressible).toBe(false);
    expect(PROACTIVE_CLASS_RULES.safety.countsToHourlyCeiling).toBe(false);
    expect(PROACTIVE_CLASS_RULES.social.maxWorkload).toBe('NORMAL');

    /* F8 sayacı hâlâ besleniyor (LAB satırı boş kalmasın). */
    expect(engine).toContain('noteProactiveSuppressed');

    /* Proaktif KRİTİK arıza hattı workload'u hiç görmez. */
    expect(codeOf(src('platform/companion/companionProactiveWiring.ts'))).not.toContain('maviWorkload');
    expect(codeOf(src('platform/companion/companionChatProvider.ts'))).not.toContain('maviWorkload');
  });

  it('37. **NAVİGASYON VE AUDIO OTORİTESİ DEĞİŞMEDİ**', () => {
    const tts = codeOf(src('platform/ttsService.ts'));
    expect(tts).not.toContain('maviWorkload');          // nav anonsu bütçeye tabi DEĞİL
    expect(tts).toContain('speakNavigation');
    const duck = codeOf(src('platform/media/authority/duckPolicy.ts'));
    expect(duck).not.toContain('maviWorkload');          // duck öncelikleri DEĞİŞMEDİ
    expect(duck).toContain('EMERGENCY');
    expect(duck).toContain('PHONE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * H — Akış (F4) · gerçek zamanlı yükselme
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · H · akış sırasında iş yükü yükselmesi', () => {
  const STREAM = 'platform/voice/maviResponseStream.ts';

  it('38. **KELİME ORTASINDAN KESİLMEZ**: iptal DEĞİL, bitirme kullanılır', () => {
    const code = codeOf(src(STREAM));
    const i = code.indexOf('function _shortenForWorkload');
    expect(i).toBeGreaterThan(-1);
    const body = code.slice(i, code.indexOf('\n}', i) + 2);
    expect(body).toContain('finishSpeechStream');
    expect(body).not.toContain('cancelSpeechStream');   // ses ortadan kesilmez
    expect(body).not.toContain('ttsCancel');
  });

  it('39. kapı FAIL-OPEN\'dır — port yoksa akış bugünkü gibi çalışır', () => {
    const code = codeOf(src(STREAM));
    const i = code.indexOf('function _streamingStillAllowed');
    const body = code.slice(i, code.indexOf('\n}', i) + 2);
    expect(body).toContain('if (!_workloadPort) return true;');
  });

  it('40. kısaltma SAHTE TAMAMLANMA değildir — bounded sayaca yazılır', () => {
    const code = codeOf(src(STREAM));
    expect(code).toContain('workloadShortened');
    expect(code).toContain('noteStreamShortened');
    /* Kısaltıldıysa kalan metin ayrıca konuşulmaz (yarım cevap iki kez çıkmaz). */
    expect(code).toMatch(/if \(a\.shortened\) return;/);
  });

  it('41. F4 tur kimliği/iptal zinciri KORUNDU', () => {
    const code = codeOf(src(STREAM));
    expect(code).toContain('isMaviTurnCurrent');
    expect(code).toContain('cancelActiveResponseStream');
    expect(code).toContain('claimMaviAnswerStream');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * I — voiceService entegrasyonu (kaynak kilitleri)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · I · voiceService kapıları', () => {
  const VS = src('platform/voiceService.ts');

  it('42. takip dinlemesi bütçeye bağlıdır ve fail-soft\'tur', () => {
    /* MAVI-F13/2'de YENİDEN BAĞLANDI (zayıflatma DEĞİL): takip dinlemesi
       `voice/voiceConversationRuntime`e taşındı ve bütçeyi artık PORT üzerinden
       sorar. Kilit ARTIK İKİ ucu birden doğrular — kapının kendisi (runtime) ve
       bütçenin gerçekten bağlandığı yer (kök). Eskiden yalnız tek dosyaya
       bakıyordu; port bağlanmasa kapı sessizce hep "izinli" davranırdı. */
    const CONV = src('platform/voice/voiceConversationRuntime.ts');
    const i = CONV.indexOf('export function armFollowUp');
    expect(i, 'armFollowUp bulunamadı — kilit körleşti').toBeGreaterThan(-1);
    const body = CONV.slice(i, i + 900);
    expect(body).toContain('responseBudgetAllowsFollowUp');
    expect(body).toContain('noteFollowUpSuppressed');
    expect(body).toContain('catch');
    /* Bütçe portu kökte GERÇEK motora bağlı olmalı — boş closure kabul edilmez. */
    expect(VS).toContain('responseBudgetAllowsFollowUp: () => currentMaviResponseBudget().allowFollowUp');
    expect(VS).toContain('noteFollowUpSuppressed: () => noteFollowUpSuppressed()');
  });

  it('43. CRITICAL\'da serbest sohbet ERTELENİR — kalıp cümle KONUŞULMAZ', () => {
    const i = VS.indexOf('function _dispatchConversation');
    const body = VS.slice(i, i + 1_800);
    expect(body).toContain('allowChat');
    expect(body).toContain('recordDeferredResponse');
    expect(body).toContain("setMaviLatencyWorkload({ deferred: true })");
    /* Erteleme yerine `speakMaviAnswer` ile bir cümle üretilmez. */
    const gate = body.slice(0, body.indexOf('if (armFollowUp)'));
    expect(gate).not.toContain('speakMaviAnswer');
  });

  it('44. HIGH/CRITICAL\'da akış HİÇ AÇILMAZ (F4 girişinde kapı)', () => {
    expect(VS).toContain('allowStreaming');
    const i = VS.indexOf('_wlAllowsStream');
    expect(i).toBeGreaterThan(-1);
    expect(VS.slice(i, i + 500)).toContain('beginResponseStream');
  });

  it('45. yeni tur ve barge-in bekleyen ertelemeyi DÜŞÜRÜR', () => {
    /* MAVI-F12'de `interruptAndListen` gövdesine kesme hakemi eklendi ve
       fonksiyon uzadı; pencere BÜYÜTÜLDÜ, kilit KALDIRILMADI. Pencere
       fonksiyonun SONUNDA kapanır (bir sonraki `export function`), böylece
       gövde tekrar uzasa bile kilit KÖRLEŞMEZ. */
    expect(VS).toContain('clearDeferredResponse');
    const barge = VS.indexOf('export function interruptAndListen');
    expect(barge).toBeGreaterThan(-1);
    const end = VS.indexOf('export function', barge + 20);
    const body = VS.slice(barge, end > barge ? end : barge + 3_000);
    expect(body).toContain('clearDeferredResponse');
    /* F8 sınırı: iş yükü kesme YETENEĞİNİ kapatmaz — gövdede workload kapısı YOK. */
    expect(body).not.toContain('currentMaviResponseBudget');
  });

  it('46. **MÜKERRER KONUŞMA YOK**: erteleme dalı tek `push` ile terminal biter', () => {
    const i = VS.indexOf('function _dispatchConversation');
    const gate = VS.slice(i, VS.indexOf('if (armFollowUp)', i));
    expect((gate.match(/push\(\{/g) ?? []).length).toBe(1);
    expect(gate).toContain('return;');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * J — LAB dürüstlüğü (yeni ekran AÇILMADI)
 * ════════════════════════════════════════════════════════════════════════ */

const rawSnap = (workload: MaviRawSnapshot['workload']): MaviRawSnapshot => ({
  readAt: 1_000, voice: null, diag: null, aiHealth: null, quota: null,
  proactive: null, speech: null, turn: null, workload,
});

describe('MAVI-F8 · J · CAROS LAB', () => {
  it('47. **YENİ LAB EKRANI AÇILMADI** — Mavi Konsolu genişletildi', () => {
    const catalog = src('platform/devtools/carosLabCatalog.ts');
    expect(catalog).not.toContain('workload');
    expect(catalog).not.toContain('WorkloadScreen');
    expect(src('platform/devtools/maviConsoleModel.ts')).toContain("'workload'");
  });

  it('48. ölçüm yokken "LOW" DEĞİL "ölçüm yok" gösterilir', () => {
    const view = buildMaviSections(rawSnap({
      lastLevel: null, resolutions: 0, sourceBound: false,
      levels: {}, evidence: {}, proactiveSuppressed: 0, responsesShortened: 0,
      streamsShortened: 0, followUpSuppressed: 0, deferrals: 0, deferralsExpired: 0,
    }));
    const sec = view.find((x) => x.id === 'workload');
    expect(sec?.fields.find((f) => f.id === 'mwLevel')?.klass).toBe('UNAVAILABLE');
    expect(sec?.fields.find((f) => f.id === 'mwSource')?.klass).toBe('UNAVAILABLE');
  });

  it('49. kaynak okunamazsa UNAVAILABLE — sahte sıfır ÜRETİLMEZ', () => {
    const sec = buildMaviSections(rawSnap(null)).find((x) => x.id === 'workload');
    expect(sec?.fields[0]?.klass).toBe('UNAVAILABLE');
  });

  it('50. gerçek ölçüm varsa seviye ve kanıt dağılımı GÖRÜNÜR', () => {
    const sec = buildMaviSections(rawSnap({
      lastLevel: 'HIGH', resolutions: 12, sourceBound: true,
      levels: { HIGH: 8, ELEVATED: 4 }, evidence: { maneuver_near: 8 },
      proactiveSuppressed: 3, responsesShortened: 5, streamsShortened: 1,
      followUpSuppressed: 4, deferrals: 2, deferralsExpired: 1,
    })).find((x) => x.id === 'workload');
    expect(sec?.fields.find((f) => f.id === 'mwLevel')?.value).toContain('HIGH');
    expect(sec?.fields.find((f) => f.id === 'mwEvidence')?.value).toContain('maneuver_near');
    expect(sec?.fields.find((f) => f.id === 'mwSuppress')?.value).toContain('proaktif 3');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * K — F0–F7 invariant'ları
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F8 · K · önceki fazların invariant\'ları korunur', () => {
  it('51. F2: filler kapısı YERİNDE ve workload onu ATLAMAZ', () => {
    const speech = codeOf(src('platform/assistant/maviSpeech.ts'));
    expect(speech).toContain('isGenericFiller');
    /* Bütçe uygulaması filler kapısından SONRA gelir → kısaltma bir filler'ı
       "kısa cevap" diye geçiremez. */
    expect(speech.indexOf('isGenericFiller')).toBeLessThan(speech.indexOf('applyResponseBudget'));
  });

  it('52. F5/F6/F7: capability · plan · gözlem hatları workload OKUMAZ', () => {
    for (const f of [
      'platform/capability/fabric/capabilityPlanRunner.ts',
      'platform/capability/observation/observationContract.ts',
      'platform/capability/observation/observationLedger.ts',
    ]) {
      expect(codeOf(src(f)), f).not.toContain('maviWorkload');
    }
  });

  it('53. F0: yeni telemetri sistemi KURULMADI — mevcut ize alan eklendi', () => {
    const trace = src('platform/assistant/maviLatencyTrace.ts');
    expect(trace).toContain('setMaviLatencyWorkload');
    expect(trace).toContain('VALID_WORKLOAD_LEVELS');
    /* Geçersiz seviye ize giremez. */
    expect(trace).toMatch(/VALID_WORKLOAD_LEVELS\.has\(info\.level\)/);
  });

  it('54. tanı kaydı komut akışını ETKİLEMEZ (fail-soft, throw yok)', () => {
    expect(() => currentMaviWorkload(Number.NaN)).not.toThrow();
    setMaviWorkloadSnapshotSource(() => { throw new Error('boom'); });
    expect(currentMaviWorkload().level).toBe('UNKNOWN');
    expect(() => currentMaviResponseBudget()).not.toThrow();
    expect(() => applyResponseBudget(undefined as unknown as string, 5)).not.toThrow();
  });

  it('55. bounded tanı: seviye ve kanıt sayaçları GERÇEK trafikten dolar', () => {
    setMaviWorkloadSnapshotSource(() => snap({ motionState: 'moving', speedKmh: 120 }));
    currentMaviWorkload(1);
    currentMaviWorkload(2);
    const d = getMaviWorkloadDiagnostics();
    expect(d.lastLevel).toBe('HIGH');
    expect(d.levels['HIGH']).toBe(2);
    expect(d.evidence['motion_fast']).toBe(2);
    expect(d.sourceBound).toBe(true);
  });
});
