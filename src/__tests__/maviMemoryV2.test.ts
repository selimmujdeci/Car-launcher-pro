/**
 * maviMemoryV2.test.ts — **MAVİ F10 KİLİTLERİ (Hafıza v2).**
 *
 * F10'un sözleşmesini kilitler:
 *  · conversation text ≠ fact ≠ preference ≠ learned pattern,
 *  · TEK konuşma → otomatik uzun dönem fact OLMAZ,
 *  · EXPLICIT beyan ÇIKARIMDAN güçlüdür; ikisi ASLA aynı listede değildir,
 *  · INFERRED kanıtsız kalıcılaşamaz, decay olur, düzeltme onu ezer,
 *  · düzeltme KÖR SİLMEZ; çelişki GÖRÜNÜR kalır,
 *  · FORGET gerçekten siler ve silinen hafıza prompt'a DÖNMEZ,
 *  · TRIP hafızası yeni yolculuğa SIZMAZ,
 *  · hassas veri HEM YAZMA HEM OKUMA yolunda reddedilir,
 *  · depo düşerse "hatırladım" DENMEZ,
 *  · LLM doğrudan hafıza otoritesi DEĞİLDİR,
 *  · F0–F9 invaryantları BOZULMAZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAVI_MEMORY_MIN_EVIDENCE,
  MAVI_MEMORY_MIN_CONFIDENCE,
  MAVI_MEMORY_SCHEMA_VERSION,
  MAVI_MEMORY_SUPPRESSION_MS,
  MAVI_MEMORY_INFERRED_HALF_LIFE_MS,
  MAVI_MEMORY_MAX_TRIP,
  classifyMemoryDomain,
  contradicts,
  decayedConfidence,
  memoryRejectReason,
  projectMemory,
  type MaviMemoryRecord,
} from '../platform/assistant/maviMemoryModel';
import {
  correctMemory,
  forgetMemory,
  getMaviMemoryDiagnostics,
  observeInferred,
  projectMaviMemory,
  rememberExplicit,
  readExplicitPreferenceTexts,
  readInferredPreferenceTexts,
  setConversationPurgePort,
  inferPromptDomain,
  _resetMaviMemoryForTest,
} from '../platform/assistant/maviMemory';
import {
  currentTripKey,
  getTripMemoryDiagnostics,
  getTripRecords,
  rememberTrip,
  setTripScopeSource,
  _resetTripMemoryForTest,
} from '../platform/assistant/tripMemory';

const src = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const MODEL = 'platform/assistant/maviMemoryModel.ts';
const FACADE = 'platform/assistant/maviMemory.ts';
const TRIP = 'platform/assistant/tripMemory.ts';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** Kanıtsız taban kayıt — testler yalnız ilgilendikleri alanı ezer. */
const rec = (p: Partial<MaviMemoryRecord> = {}): MaviMemoryRecord => Object.freeze({
  id: p.id ?? 'r1',
  schemaVersion: MAVI_MEMORY_SCHEMA_VERSION,
  scope: 'LONG_TERM' as const,
  kind: 'preference' as const,
  domain: 'general' as const,
  origin: 'EXPLICIT' as const,
  source: 'user_statement' as const,
  provenance: 'test',
  value: 'sakin yolları tercih ederim',
  confidence: 1,
  evidenceCount: 1,
  createdAtMs: NOW,
  lastConfirmedAtMs: NOW,
  decayHalfLifeMs: null,
  expiresAtMs: null,
  correction: Object.freeze({ state: 'NONE' as const, atMs: null, supersededById: null }),
  privacyClass: 'SAFE' as const,
  tripKey: null,
  ...p,
});

beforeEach(() => {
  _resetMaviMemoryForTest();
  _resetTripMemoryForTest();
  try { localStorage.clear(); } catch { /* jsdom */ }
});

/* ══════════════════════════════════════════════════════════════════════════
 * A — SAFLIK ve mimari sınır
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · A · saflık ve mimari sınır', () => {
  it('1. model SAFTIR: I/O · timer · `Date.now` · store · React YOK', () => {
    const code = codeOf(src(MODEL));
    for (const forbidden of [
      'Date.now', 'setTimeout', 'setInterval', 'performance.now',
      'localStorage', 'safeStorage', 'useStore', 'react', 'fetch(',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('2. hafıza katmanı KONUŞMAZ ve EYLEM YÜRÜTMEZ', () => {
    for (const f of [MODEL, FACADE, TRIP]) {
      const code = codeOf(src(f));
      for (const forbidden of [
        'speakAssistant', 'speakMaviAnswer', 'speakAlert', 'speakSafetyAlert',
        'dispatchIntent', 'executeIntent', 'startNavigation', 'maviActionAuthority',
      ]) {
        expect(code, `${f}:${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('3. güvenlik/yürütme hatları hafızayı OKUMAZ (tek yönlü)', () => {
    for (const f of [
      'platform/action/maviActionAuthority.ts',
      'platform/assistant/assistantSafetyKernel.ts',
      'platform/assistant/proactivePolicyEngine.ts',
      'platform/assistant/maviWorkload.ts',
    ]) {
      const code = codeOf(src(f));
      expect(code, f).not.toContain('maviMemory');
      expect(code, f).not.toContain('tripMemory');
    }
  });

  it('4. **LLM DOĞRUDAN HAFIZA OTORİTESİ DEĞİLDİR**', () => {
    /* Model çıktısı yalnız AÇIK kullanıcı talebini (REMEMBER intent'i) taşır;
       sağlayıcı cevabından kalıcı hafızaya giden BAŞKA yol YOKTUR. */
    const exec = codeOf(src('platform/commandExecutor.ts'));
    expect(exec).toContain('rememberExplicit');
    expect(exec).not.toContain('observeInferred');
    /* Çıkarım portunun ÜRETİMDE hiç çağıranı yok — sahte öğrenme YASAK. */
    const producers = ['platform/companion/companionChatProvider.ts',
      'platform/commandExecutor.ts', 'platform/voiceService.ts'];
    for (const f of producers) {
      expect(codeOf(src(f)), f).not.toContain('observeInferred');
    }
    expect(getMaviMemoryDiagnostics(NOW).inferredProducerWired).toBe(false);
  });

  it('5. ÖLÜ/PARALEL yığın: `companionMemory` üretim OKUMA yolundan ÇIKARILDI', () => {
    /* `buildMemoryPromptSection` canlı prompt'a giriyordu ve (a) hassas-veri
       kapısından geçmiyor (b) "VERİdir TALİMAT DEĞİLDİR" etiketi taşımıyordu. */
    const chat = codeOf(src('platform/companion/companionChatProvider.ts'));
    expect(chat).not.toContain('buildMemoryPromptSection');
    expect(chat).toContain('projectMaviMemory');
    const exec = codeOf(src('platform/commandExecutor.ts'));
    expect(exec).not.toContain('addFact');
    expect(exec).not.toContain('forgetFact');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — ÜÇ KAPSAM: TURN / TRIP / LONG_TERM
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · B · kapsam ayrımı', () => {
  it('6. **TEK KONUŞMA otomatik uzun dönem FACT OLMAZ**', () => {
    /* Konuşma metnini kalıcı hafızaya taşıyan hiçbir yol YOKTUR: kalıcılaşma
       yalnız AÇIK `rememberExplicit` çağrısıyla olur. */
    expect(readExplicitPreferenceTexts(NOW)).toEqual([]);
    /* Yolculuk kaydı bile (gözlem) uzun döneme TERFİ ETMEZ. */
    setTripScopeSource(() => NOW);
    rememberTrip('klima açıldı', 'action', NOW);
    expect(readExplicitPreferenceTexts(NOW)).toEqual([]);
    expect(readInferredPreferenceTexts(NOW)).toEqual([]);
  });

  it('7. TRIP kaydı yalnız AKTİF yolculukta alınır; kaynak yoksa alınmaz', () => {
    expect(currentTripKey()).toBeNull();
    expect(rememberTrip('mola konuşuldu', 'topic', NOW).reason).toBe('no_trip');

    setTripScopeSource(() => null);                  // yolculuk YOK
    expect(rememberTrip('mola konuşuldu', 'topic', NOW).reason).toBe('no_trip');

    setTripScopeSource(() => NOW);
    expect(rememberTrip('mola konuşuldu', 'topic', NOW).stored).toBe(true);
    expect(getTripRecords()).toHaveLength(1);
  });

  it('8. **TRIP hafızası YENİ YOLCULUĞA SIZMAZ** (mühürlenir)', () => {
    let start: number | null = NOW;
    setTripScopeSource(() => start);
    rememberTrip('şu benzinlikten bahsettik', 'topic', NOW);
    expect(getTripRecords()).toHaveLength(1);

    start = NOW + 3 * 60 * 60 * 1000;                // YENİ yolculuk
    expect(getTripRecords()).toHaveLength(0);
    expect(getTripMemoryDiagnostics().tripsSealed).toBeGreaterThan(0);
  });

  it('9. TRIP kaydı bounded — tavan aşılınca en eski düşer', () => {
    setTripScopeSource(() => NOW);
    for (let i = 0; i < MAVI_MEMORY_MAX_TRIP + 5; i++) {
      rememberTrip(`konu numara ${i} hakkında`, 'topic', NOW + i);
    }
    expect(getTripRecords().length).toBeLessThanOrEqual(MAVI_MEMORY_MAX_TRIP);
    expect(getTripMemoryDiagnostics().droppedOverflow).toBeGreaterThan(0);
  });

  it('10. TRIP kaydı projeksiyonda YALNIZ eşleşen anahtarla görünür', () => {
    const tripRec = rec({
      id: 't1', scope: 'TRIP', kind: 'topic', tripKey: 'trip:1', value: 'benzinlik konuştuk',
    });
    const matched = projectMemory({
      records: [tripRec], domain: 'general', nowMs: NOW, tripKey: 'trip:1',
    });
    expect(matched.tripCount).toBe(1);

    const mismatched = projectMemory({
      records: [tripRec], domain: 'general', nowMs: NOW, tripKey: 'trip:2',
    });
    expect(mismatched.items).toHaveLength(0);
    expect(mismatched.rejected.trip_mismatch).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — EXPLICIT ≠ INFERRED
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · C · beyan ile çıkarım ayrımı', () => {
  it('11. AÇIK beyan güven 1 ve DECAY YOK; çıkarım DECAY olur', () => {
    const explicit = rec({ decayHalfLifeMs: null });
    expect(decayedConfidence(explicit, NOW + 365 * DAY)).toBe(1);

    const inferred = rec({
      id: 'i1', origin: 'INFERRED', confidence: 0.8,
      decayHalfLifeMs: MAVI_MEMORY_INFERRED_HALF_LIFE_MS,
    });
    const after = decayedConfidence(inferred, NOW + MAVI_MEMORY_INFERRED_HALF_LIFE_MS);
    expect(after).toBeCloseTo(0.4, 5);               // yarı-ömür → yarıya iner
  });

  it('12. **ÇIKARIM KANITSIZ KALICILAŞMAZ** (eşiğin altı prompt\'a giremez)', () => {
    const weak = rec({
      id: 'i1', origin: 'INFERRED', confidence: 0.9,
      evidenceCount: MAVI_MEMORY_MIN_EVIDENCE - 1,
      decayHalfLifeMs: MAVI_MEMORY_INFERRED_HALF_LIFE_MS,
    });
    expect(memoryRejectReason(weak, NOW)).toBe('insufficient_evidence');

    const strong = rec({ ...weak, evidenceCount: MAVI_MEMORY_MIN_EVIDENCE });
    expect(memoryRejectReason(strong, NOW)).toBeNull();
  });

  it('13. STALE çıkarım DÜŞER (güven eşiğin altına inince)', () => {
    const old = rec({
      id: 'i1', origin: 'INFERRED', confidence: 0.5,
      evidenceCount: MAVI_MEMORY_MIN_EVIDENCE,
      decayHalfLifeMs: MAVI_MEMORY_INFERRED_HALF_LIFE_MS,
    });
    expect(memoryRejectReason(old, NOW)).toBeNull();
    const much = NOW + 4 * MAVI_MEMORY_INFERRED_HALF_LIFE_MS;
    expect(decayedConfidence(old, much)).toBeLessThan(MAVI_MEMORY_MIN_CONFIDENCE);
    expect(memoryRejectReason(old, much)).toBe('decayed');
  });

  it('14. çıkarım kanıtla PEKİŞİR ama güven 1\'e ULAŞMAZ (zero-trust)', () => {
    let last = observeInferred({ value: 'sakin rota seçiyor', provenance: 'route_choice' }, NOW);
    expect(last.outcome).toBe('observed');           // tek gözlem yetmez
    last = observeInferred({ value: 'sakin rota seçiyor', provenance: 'route_choice' }, NOW + 1);
    last = observeInferred({ value: 'sakin rota seçiyor', provenance: 'route_choice' }, NOW + 2);
    expect(last.outcome).toBe('promoted');
    expect(last.evidenceCount).toBe(3);
    expect(last.confidence).toBeLessThan(1);
  });

  it('15. **BEYAN ile ÇIKARIM ASLA aynı listede değildir**', () => {
    rememberExplicit('Arabası dizel', NOW);
    for (let i = 0; i < MAVI_MEMORY_MIN_EVIDENCE; i++) {
      observeInferred({ value: 'sakin rota seçiyor', provenance: 'route_choice' }, NOW + i);
    }
    const explicit = readExplicitPreferenceTexts(NOW);
    const inferred = readInferredPreferenceTexts(NOW);
    expect(explicit).toEqual(['Arabası dizel']);
    expect(inferred.some((t) => t.includes('çıkarım'))).toBe(true);
    expect(explicit.some((t) => t.includes('çıkarım'))).toBe(false);
  });

  it('16. projeksiyonda BEYAN çıkarımdan ÖNCE gelir (beyan daha güçlü)', () => {
    const p = projectMemory({
      records: [
        rec({ id: 'i1', origin: 'INFERRED', value: 'sakin yol seçiyor',
          evidenceCount: 3, confidence: 0.8,
          decayHalfLifeMs: MAVI_MEMORY_INFERRED_HALF_LIFE_MS }),
        rec({ id: 'e1', origin: 'EXPLICIT', value: 'hızlı yolları severim' }),
      ],
      domain: 'general', nowMs: NOW, tripKey: null,
    });
    expect(p.items[0]?.origin).toBe('EXPLICIT');
    /* Prompt bloğu kökeni AÇIKÇA etiketler → LLM ikisini karıştıramaz. */
    expect(p.text).toContain('Kullanıcı söyledi');
    expect(p.text).toContain('Çıkarım');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — DÜZELTME ve ÇELİŞKİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · D · düzeltme ve çelişki', () => {
  it('17. düzeltme güveni SIFIRLAR, kaydı SİLMEZ ve 30 gün mühürler', () => {
    for (let i = 0; i < MAVI_MEMORY_MIN_EVIDENCE; i++) {
      observeInferred({ value: 'hızlı rota tercih ediyor', provenance: 'route_choice' }, NOW + i);
    }
    expect(readInferredPreferenceTexts(NOW).length).toBe(1);

    const r = correctMemory('hızlı rota', NOW);
    expect(r.corrected).toBeGreaterThan(0);
    /* Susar ama SİLİNMEZ — düzeltmenin kendisi bir bilgidir. */
    expect(readInferredPreferenceTexts(NOW)).toEqual([]);
    expect(getMaviMemoryDiagnostics(NOW).correctedCount).toBeGreaterThan(0);
  });

  it('18. **DÜZELTİLEN ÇIKARIM 30 GÜN YENİDEN ÜRETİLMEZ**', () => {
    for (let i = 0; i < MAVI_MEMORY_MIN_EVIDENCE; i++) {
      observeInferred({ value: 'hızlı rota tercih ediyor', provenance: 'route_choice' }, NOW + i);
    }
    correctMemory('hızlı rota tercih ediyor', NOW);

    const again = observeInferred(
      { value: 'hızlı rota tercih ediyor', provenance: 'route_choice' }, NOW + 10 * DAY);
    expect(again.outcome).toBe('suppressed');

    /* Mühür süresi dolunca yeniden öğrenilebilir (kalıcı ölüm YOK). */
    const later = observeInferred(
      { value: 'hızlı rota tercih ediyor', provenance: 'route_choice' },
      NOW + MAVI_MEMORY_SUPPRESSION_MS + DAY);
    expect(later.outcome).not.toBe('suppressed');
  });

  it('19. AÇIK BEYAN mührü kaldırır (kullanıcı fikrini değiştirebilir)', () => {
    rememberExplicit('hızlı rota tercih ediyorum', NOW);
    forgetMemory('hızlı rota', NOW);
    expect(readExplicitPreferenceTexts(NOW)).toEqual([]);

    const again = rememberExplicit('hızlı rota tercih ediyorum', NOW + 1000);
    expect(again.stored).toBe(true);
    expect(readExplicitPreferenceTexts(NOW + 1000)).toHaveLength(1);
  });

  it('20. **ÇELİŞKİ KÖR SİLMEZ — GÖRÜNÜR KALIR**', () => {
    rememberExplicit('hızlı rotaları severim', NOW);
    const second = rememberExplicit('hızlı rotaları sevmiyorum', NOW + 1000);
    expect(second.contradicts).toBe(true);
    /* İki kayıt da DURUR; eski olan CONTRADICTED işaretlenir. */
    expect(readExplicitPreferenceTexts(NOW + 1000)).toHaveLength(2);
    expect(getMaviMemoryDiagnostics(NOW + 1000).contradictedCount).toBe(1);

    const p = projectMaviMemory('general', NOW + 1000);
    expect(p.text).toContain('ÇELİŞKİLİ');
  });

  it('21. çelişki ölçütü DAR: farklı alan/kutup yoksa çelişki YOK', () => {
    const a = rec({ id: 'a', value: 'hızlı rotaları severim', domain: 'navigation' });
    const b = rec({ id: 'b', value: 'hızlı rotaları sevmiyorum', domain: 'navigation' });
    expect(contradicts(a, b)).toBe(true);
    /* Aynı kutup → çelişki değil. */
    const c = rec({ id: 'c', value: 'hızlı rotaları çok severim', domain: 'navigation' });
    expect(contradicts(a, c)).toBe(false);
    /* Farklı alan → çelişki değil. */
    const d = rec({ id: 'd', value: 'hızlı şarkıları sevmiyorum', domain: 'media' });
    expect(contradicts(a, d)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — UNUTMA (FORGET)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · E · unutma gerçekten siler', () => {
  it('22. FORGET kalıcı kaydı SİLER', () => {
    rememberExplicit('Arabası dizel', NOW);
    expect(readExplicitPreferenceTexts(NOW)).toHaveLength(1);
    const r = forgetMemory('dizel', NOW);
    expect(r.removed).toBe(1);
    expect(readExplicitPreferenceTexts(NOW)).toEqual([]);
  });

  it('23. **SİLİNEN HAFIZA PROMPT\'A DÖNMEZ** (geçmiş de temizlenir)', () => {
    const purged: string[] = [];
    setConversationPurgePort((needle) => { purged.push(needle); return 2; });
    rememberExplicit('Arabası dizel', NOW);
    const r = forgetMemory('dizel', NOW);
    expect(r.historyPurged).toBe(true);
    expect(r.historyRemoved).toBe(2);
    expect(purged).toHaveLength(1);
    /* Projeksiyon artık o kaydı ÜRETEMEZ. */
    expect(projectMaviMemory('general', NOW).text).toBe('');
  });

  it('24. geçmiş portu BAĞLI DEĞİLSE bu dürüstçe bildirilir', () => {
    rememberExplicit('Arabası dizel', NOW);
    const r = forgetMemory('dizel', NOW);
    expect(r.historyPurged).toBe(false);            // "sildim" iddiası YOK
    expect(r.removed).toBe(1);
  });

  it('25. "hepsini unut" tüm kapsamları temizler', () => {
    setTripScopeSource(() => NOW);
    rememberExplicit('Arabası dizel', NOW);
    rememberTrip('benzinlik konuştuk', 'topic', NOW);
    const r = forgetMemory('hepsini', NOW);
    expect(r.all).toBe(true);
    expect(readExplicitPreferenceTexts(NOW)).toEqual([]);
    expect(getTripRecords()).toEqual([]);
  });

  it('26. unutulan ifade ÇIKARIMLA geri GELEMEZ (mühür)', () => {
    rememberExplicit('hızlı rota tercih ediyorum', NOW);
    forgetMemory('hızlı rota tercih ediyorum', NOW);
    const again = observeInferred(
      { value: 'hızlı rota tercih ediyorum', provenance: 'route_choice' }, NOW + DAY);
    expect(again.outcome).toBe('suppressed');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — GİZLİLİK
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · F · gizlilik kapısı', () => {
  const SENSITIVE: readonly string[] = Object.freeze([
    'Numaram 0532 123 45 67',
    'Plakam 34 ABC 123',
    'VIN WDB1234567890ABCX',
    'E-postam ornek@ornek.com',
    'IBAN TR330006100519786457841326',
  ]);

  it('27. **YAZMA YOLU** hassas içeriği REDDEDER (F10 öncesi kapı YOKTU)', () => {
    for (const text of SENSITIVE) {
      const r = rememberExplicit(text, NOW);
      expect(r.stored, text).toBe(false);
      expect(r.outcome, text).toBe('rejected_sensitive');
      expect(r.privacyReason, text).not.toBeNull();
    }
    expect(readExplicitPreferenceTexts(NOW)).toEqual([]);
  });

  it('28. **OKUMA YOLU** da kapılıdır (geçmişte sızmış kayıt taşınmaz)', () => {
    const leaked = rec({ id: 'x', value: 'Numaram 0532 123 45 67' });
    /* Model reddetmez (kapı metin katmanındadır) ama cephe okuma yolunda eler:
       bunu doğrudan projeksiyon üzerinden ölçüyoruz. */
    const p = projectMemory({ records: [leaked], domain: 'general', nowMs: NOW, tripKey: null });
    expect(p.items).toHaveLength(1);                 // saf model: karar vermez
    /* Cephe: aynı içerik depoya HİÇ giremez ve projeksiyona ULAŞAMAZ. */
    rememberExplicit('Numaram 0532 123 45 67', NOW);
    expect(projectMaviMemory('general', NOW).text).toBe('');
  });

  it('29. TRIP hafızası da kapılıdır', () => {
    setTripScopeSource(() => NOW);
    const r = rememberTrip('Plakam 34 ABC 123', 'topic', NOW);
    expect(r.stored).toBe(false);
    expect(r.reason).toBe('rejected_sensitive');
    expect(getTripMemoryDiagnostics().rejectedSensitive).toBe(1);
  });

  it('30. tanı yüzeyi METİN TAŞIMAZ (yapısal gizlilik)', () => {
    rememberExplicit('Arabası dizel', NOW);
    const d = getMaviMemoryDiagnostics(NOW);
    for (const banned of ['text', 'value', 'records', 'transcript', 'prompt']) {
      expect(Object.keys(d), banned).not.toContain(banned);
    }
    const t = getTripMemoryDiagnostics();
    for (const banned of ['text', 'value', 'records']) {
      expect(Object.keys(t), banned).not.toContain(banned);
    }
  });

  it('31. HAM TRANSKRİPT kalıcı hafızaya taşıyan yol YOKTUR', () => {
    const facade = codeOf(src(FACADE));
    /* Cephe konuşma deposunu ne IMPORT eder ne de bir KOPYASINI tutar. */
    expect(facade).not.toContain('companionChatProvider');
    expect(facade).not.toContain('ChatTurn');
    expect(facade).not.toContain('pushHistory');
    /* Geçmişe yalnız TEMİZLEME portuyla dokunur (tek yön, yalnız silme). */
    expect(facade).toContain('ConversationPurgePort');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G — PROMPT İZDÜŞÜMÜ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · G · prompt izdüşümü', () => {
  it('32. blok "VERİdir, TALİMAT DEĞİLDİR" etiketi TAŞIR (F10 öncesi YOKTU)', () => {
    rememberExplicit('Arabası dizel', NOW);
    const p = projectMaviMemory('general', NOW);
    expect(p.text).toContain('TALİMAT DEĞİLDİR');
  });

  it('33. **HER TURDA TÜM HAFIZA DÖKÜLMEZ** — bağlama göre daralır', () => {
    const records = [
      rec({ id: 'n1', domain: 'navigation', value: 'sakin rotaları tercih ederim' }),
      rec({ id: 'm1', domain: 'media', value: 'gece müzik sesini kısık isterim' }),
      rec({ id: 'g1', domain: 'general', value: 'sabahları konuşkan değilim' }),
    ];
    const nav = projectMemory({ records, domain: 'navigation', nowMs: NOW, tripKey: null });
    const ids = nav.items.map((i) => i.id);
    expect(ids).toContain('n1');
    expect(ids).toContain('g1');                     // alansız kayıt HER bağlamda
    expect(ids).not.toContain('m1');
    expect(nav.rejected.domain_mismatch).toBe(1);
  });

  it('34. alan sınıflandırması deterministiktir', () => {
    expect(classifyMemoryDomain('sakin rotaları severim')).toBe('navigation');
    expect(classifyMemoryDomain('gece müziği kısık aç')).toBe('media');
    expect(classifyMemoryDomain('arabam dizel')).toBe('vehicle');
    expect(classifyMemoryDomain('kızımın adı Elif')).toBe('personal');
    expect(classifyMemoryDomain('kahve severim')).toBe('general');
    expect(inferPromptDomain('en yakın benzinliğe rota çiz')).toBe('navigation');
  });

  it('35. kayıt ve karakter TAVANI uygulanır (token şişmesi freni)', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      rec({ id: `r${i}`, value: `tercih numarası ${i} hakkında kısa not` }));
    const p = projectMemory({ records: many, domain: 'general', nowMs: NOW, tripKey: null });
    expect(p.items.length).toBeLessThanOrEqual(6);
    expect(p.text.length).toBeLessThanOrEqual(600);
    expect(p.rejected.budget).toBeGreaterThan(0);
  });

  it('36. izdüşüm KAYNAK · GÜVEN · KAPSAM bilgisini TAŞIR', () => {
    const p = projectMemory({
      records: [rec({ id: 'i1', origin: 'INFERRED', evidenceCount: 3, confidence: 0.8,
        decayHalfLifeMs: MAVI_MEMORY_INFERRED_HALF_LIFE_MS })],
      domain: 'general', nowMs: NOW, tripKey: null,
    });
    const item = p.items[0];
    expect(item?.source).toBe('user_statement');
    expect(item?.scope).toBe('LONG_TERM');
    expect(item?.confidence).toBeGreaterThan(0);
    expect(p.text).toContain('güven');
  });

  it('37. hiç kayıt yoksa blok HİÇ EKLENMEZ', () => {
    expect(projectMaviMemory('general', NOW).text).toBe('');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * H — ARIZA / BAYAT / ŞEMA
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · H · fail-soft ama DÜRÜST', () => {
  it('38. **DEPO DÜŞERSE "HATIRLADIM" DENMEZ**', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      const r = rememberExplicit('Arabası dizel', NOW);
      expect(r.persisted).toBe(false);
      expect(r.outcome).toBe('not_persisted');
    } finally { spy.mockRestore(); }
  });

  it('39. yürütücü depo hatasında SAHTE ONAY vermez (kaynak kilidi)', () => {
    const exec = codeOf(src('platform/commandExecutor.ts'));
    expect(exec).toContain('not_persisted');
    expect(exec).toContain('rejected_sensitive');
  });

  it('40. ESKİ ŞEMALI kayıt OKUNMAZ (sessiz yanlış yorum YOK)', () => {
    const stale = rec({ id: 'old', schemaVersion: MAVI_MEMORY_SCHEMA_VERSION - 1 });
    expect(memoryRejectReason(stale, NOW)).toBe('schema_version');
  });

  it('41. bozuk depo içeriği ÇÖKERTMEZ (fail-soft boş başlar)', () => {
    try { localStorage.setItem('mavi_memory_v2', '{bozuk json'); } catch { /* jsdom */ }
    _resetMaviMemoryForTest();
    expect(() => readExplicitPreferenceTexts(NOW)).not.toThrow();
    expect(readExplicitPreferenceTexts(NOW)).toEqual([]);
  });

  it('42. TRIP kapsam kaynağı FIRLATIRSA yolculuk YOK sayılır', () => {
    setTripScopeSource(() => { throw new Error('boom'); });
    expect(currentTripKey()).toBeNull();
    expect(rememberTrip('konu', 'topic', NOW).stored).toBe(false);
  });

  it('43. süresi dolan kayıt DÜŞER', () => {
    const expiring = rec({ id: 'e', expiresAtMs: NOW + 1000 });
    expect(memoryRejectReason(expiring, NOW)).toBeNull();
    expect(memoryRejectReason(expiring, NOW + 2000)).toBe('expired');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * I — F1 / F6 / F7 / F9 SINIRLARI
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F10 · I · önceki fazların invaryantları', () => {
  it('44. **F1:** `companionEnabled` hafıza YETENEĞİNİ KAPATMAZ', () => {
    const facade = codeOf(src(FACADE));
    const trip = codeOf(src(TRIP));
    expect(facade).not.toContain('companionEnabled');
    expect(trip).not.toContain('companionEnabled');
    /* Presence şalteri kapalıyken de hafıza yazılıp okunabilir. */
    expect(rememberExplicit('Arabası dizel', NOW).stored).toBe(true);
  });

  it('45. **F6/F7:** gözlenen eylem otomatik TERCİH OLMAZ', () => {
    setTripScopeSource(() => NOW);
    rememberTrip('Klima açılıyor', 'action', NOW);
    const t = getTripRecords()[0];
    expect(t?.kind).toBe('action');
    expect(t?.scope).toBe('TRIP');
    /* Uzun döneme TERFİ ETMEZ ve çıkarım ÜRETMEZ. */
    expect(readExplicitPreferenceTexts(NOW)).toEqual([]);
    expect(readInferredPreferenceTexts(NOW)).toEqual([]);
    /* Yolculuk hafızası kalıcı depoya YAZMAZ. */
    expect(codeOf(src(TRIP))).not.toContain('safeSetRaw');
  });

  it('46. **F9:** proaktif motor hafıza otoritesi DEĞİLDİR', () => {
    const policy = codeOf(src('platform/assistant/proactivePolicyEngine.ts'));
    expect(policy).not.toContain('maviMemory');
    expect(policy).not.toContain('rememberExplicit');
    expect(policy).not.toContain('observeInferred');
  });

  it('47. araç-teknik hafıza AYRI gizlilik sınıfıdır (cepheye taşınmaz)', () => {
    const facade = codeOf(src(FACADE));
    expect(facade).not.toContain('vehicleMemory');
    expect(facade).not.toContain('fingerprint');
  });
});
