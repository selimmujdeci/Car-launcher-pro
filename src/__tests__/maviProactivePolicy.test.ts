/**
 * maviProactivePolicy.test.ts — **MAVİ F9 KİLİTLERİ.**
 *
 * F9'un sözleşmesini kilitler:
 *  · proaktif konuşma izni TEK merkezde verilir (`proactivePolicyEngine`),
 *  · karar çekirdeği SAFTIR (`Date.now` · I/O · store · React YOK),
 *  · **`safety` sınıfı bütçeyle, presence'la, saatlik tavanla ve öğrenmeyle
 *    ASLA susturulamaz** — yapısal olarak engellidir,
 *  · aynı tick içinde EN FAZLA BİR teklif konuşur; diğerleri DÜŞER (kuyruk YOK),
 *  · spam yapısal olarak engellidir: cooldown + sıklık bütçesi + saatlik tavan,
 *  · kesinti öğrenilir ama "kabul" UYDURULMAZ (`acceptRateMeasurable === false`),
 *  · motor ikinci bir güvenlik/yürütme otoritesi DEĞİLDİR ve seslendirmez,
 *  · kritik arıza hattı motorun kapısından GEÇMEZ (yalnız gözlenir),
 *  · LAB yüzeyi salt-okunur ve PII taşımaz.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PROACTIVE_CLASS_RULES,
  PROACTIVE_REJECT_THRESHOLD,
  PROACTIVE_VOICE_CEILING_PER_HOUR,
  decideProactive,
  evaluateProactiveProposals,
  endProactiveDelivery,
  getProactivePolicyDiagnostics,
  noteExternalProactiveSpoken,
  noteProactiveInterrupted,
  restoreProactiveSource,
  suppressProactiveSource,
  _resetProactivePolicyForTest,
  type ProactiveDecision,
  type ProactiveKind,
  type ProactiveLedgerView,
  type ProactivePolicyContext,
  type ProactiveProposal,
} from '../platform/assistant/proactivePolicyEngine';
import { buildMaviSections } from '../platform/devtools/maviConsoleModel';
import type { MaviRawSnapshot } from '../platform/devtools/maviConsoleModel';

const src = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const ENGINE = 'platform/assistant/proactivePolicyEngine.ts';
const COMPANION = 'platform/companion/companionEngine.ts';
const WIRING = 'platform/companion/companionProactiveWiring.ts';

const MIN = 60_000;

/** Kanıtsız taban bağlam — testler yalnız ilgilendikleri alanı ezer. */
const ctx = (p: Partial<ProactivePolicyContext> = {}): ProactivePolicyContext => ({
  nowMs: 0,
  workload: 'LOW',
  presenceEnabled: true,
  chattinessGapMs: 20 * MIN,
  mediaProminent: false,
  turnBusy: false,
  ...p,
});

/** Boş defter — hiçbir geçmiş yok. */
const emptyLedger = (): ProactiveLedgerView => Object.freeze({
  lastAdmittedAtMs: Object.freeze({}),
  lastVoiceAtMs: -Infinity,
  hourlyVoiceAtMs: Object.freeze([]),
  userSuppressed: Object.freeze([]),
  learnedSuppressedUntilMs: Object.freeze({}),
  recentRejects: Object.freeze({}),
});

const prop = (p: Partial<ProactiveProposal> & { sourceId: string; kind: ProactiveKind }): ProactiveProposal =>
  Object.freeze({
    relevance: 0.5,
    confidence: 1,
    decayAtMs: null,
    cooldownKey: p.sourceId,
    cooldownMs: 0,
    mediaPolicy: 'DEFERS_TO_MEDIA' as const,
    frequencyBudget: 'EXEMPT' as const,
    deliver: 'voice' as const,
    text: () => 'metin',
    ...p,
  });

const reasons = (d: ProactiveDecision, sourceId: string): string[] =>
  d.drops.filter((x) => x.sourceId === sourceId).map((x) => x.reason);

beforeEach(() => {
  _resetProactivePolicyForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * A — SAFLIK ve mimari sınır
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F9 · A · saflık ve mimari sınır', () => {
  it('1. karar çekirdeği SAF: `Date.now` · timer · store · React YOK', () => {
    const code = codeOf(src(ENGINE));
    for (const forbidden of [
      'Date.now', 'setTimeout', 'setInterval', 'performance.now',
      'localStorage', 'useStore', 'zustand', 'react', 'fetch(',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('2. motor SESLENDİRMEZ ve komut YÜRÜTMEZ (ikinci otorite kurulmaz)', () => {
    const code = codeOf(src(ENGINE));
    for (const forbidden of [
      'speakAssistant', 'speakAlert', 'speakSafetyAlert', 'speakNavigation',
      'dispatchIntent', 'executeIntent', 'startNavigation',
      'maviActionAuthority', 'AiSafetyGate', 'assistantSafetyKernel',
      'evaluateVehicleAction', 'mediaCommandGateway',
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it('3. güvenlik/yürütme hatları bu motoru OKUMAZ (tek yönlü bağımlılık)', () => {
    for (const f of [
      'platform/commandExecutor.ts',
      'platform/action/maviActionAuthority.ts',
      'platform/assistant/assistantSafetyKernel.ts',
      'platform/capability/fabric/capabilityFabric.ts',
      'platform/ttsService.ts',
    ]) {
      expect(codeOf(src(f)), f).not.toContain('proactivePolicyEngine');
    }
  });

  it('4. motor yalnız TİP importu yapar (grafik büyümez)', () => {
    const imports = src(ENGINE).match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain('import type');
    expect(imports[0]).toContain('./maviWorkload');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — SINIF KURALLARI: `safety` susturulamaz
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F9 · B · güvenlik sınıfı yapısal olarak dokunulmazdır', () => {
  it('5. `safety` kuralı: CRITICAL tavan · presence yok · bütçesiz · öğrenilemez', () => {
    const r = PROACTIVE_CLASS_RULES.safety;
    expect(r.maxWorkload).toBe('CRITICAL');
    expect(r.requiresPresence).toBe(false);
    expect(r.countsToHourlyCeiling).toBe(false);
    expect(r.learnedSuppressible).toBe(false);
  });

  it('6. CRITICAL iş yükünde bile güvenlik teklifi konuşur; sohbet SUSAR', () => {
    const d = decideProactive(
      [prop({ sourceId: 'chat', kind: 'social', relevance: 0.9 }),
        prop({ sourceId: 'warn', kind: 'safety', relevance: 0.1 })],
      ctx({ workload: 'CRITICAL' }), emptyLedger());
    expect(d.admitted).toBe(true);
    expect(d.sourceId).toBe('warn');
    expect(reasons(d, 'chat')).toContain('workload');
  });

  it('7. Yol Arkadaşı KAPALIYKEN güvenlik teklifi presence kapısına takılmaz', () => {
    const d = decideProactive(
      [prop({ sourceId: 'warn', kind: 'safety' })],
      ctx({ presenceEnabled: false }), emptyLedger());
    expect(d.admitted).toBe(true);
    expect(d.sourceId).toBe('warn');
  });

  it('8. saatlik tavan DOLU olsa bile güvenlik teklifi düşmez', () => {
    const full = Array.from({ length: PROACTIVE_VOICE_CEILING_PER_HOUR }, (_, i) => i * 1000);
    const ledger = { ...emptyLedger(), hourlyVoiceAtMs: Object.freeze(full) };
    const d = decideProactive(
      [prop({ sourceId: 'info', kind: 'informational' }),
        prop({ sourceId: 'warn', kind: 'safety' })],
      ctx({ nowMs: 10_000 }), ledger);
    expect(reasons(d, 'info')).toContain('hourly_ceiling');
    expect(d.sourceId).toBe('warn');
  });

  it('9. öğrenilmiş bastırma güvenlik teklifini SUSTURAMAZ', () => {
    const ledger = {
      ...emptyLedger(),
      learnedSuppressedUntilMs: Object.freeze({ warn: 9_999_999, chat: 9_999_999 }),
    };
    const d = decideProactive(
      [prop({ sourceId: 'warn', kind: 'safety' })], ctx(), ledger);
    expect(d.admitted).toBe(true);

    const d2 = decideProactive(
      [prop({ sourceId: 'chat', kind: 'social' })], ctx(), ledger);
    expect(reasons(d2, 'chat')).toContain('learned_suppressed');
  });

  it('10. kesinti sayacı güvenlik kaynağına ret YAZMAZ', () => {
    evaluateProactiveProposals([prop({ sourceId: 'warn', kind: 'safety' })], ctx());
    for (let i = 0; i < PROACTIVE_REJECT_THRESHOLD + 2; i++) {
      noteProactiveInterrupted(i * 1000);
      evaluateProactiveProposals([prop({ sourceId: 'warn', kind: 'safety' })],
        ctx({ nowMs: (i + 1) * 1000 }));
    }
    const diag = getProactivePolicyDiagnostics(100_000);
    expect(diag.learnedSuppressed).not.toContain('warn');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — TEK KONU KURALI ve kuyruk yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F9 · C · tek konu kuralı, kuyruk YOK', () => {
  it('11. aynı tick içinde EN FAZLA BİR teklif konuşur; kalanı `not_top`', () => {
    const d = decideProactive(
      [prop({ sourceId: 'a', kind: 'safety', relevance: 0.9 }),
        prop({ sourceId: 'b', kind: 'safety', relevance: 0.5 }),
        prop({ sourceId: 'c', kind: 'safety', relevance: 0.2 })],
      ctx(), emptyLedger());
    expect(d.sourceId).toBe('a');
    expect(reasons(d, 'b')).toEqual(['not_top']);
    expect(reasons(d, 'c')).toEqual(['not_top']);
  });

  it('12. skor eşitse GİRDİ SIRASI kazanır (mevcut öncelik merdiveni bozulmaz)', () => {
    const d = decideProactive(
      [prop({ sourceId: 'ilk', kind: 'safety', relevance: 0.5 }),
        prop({ sourceId: 'ikinci', kind: 'safety', relevance: 0.5 })],
      ctx(), emptyLedger());
    expect(d.sourceId).toBe('ilk');
  });

  it('13. şablon cümle üretmezse SIRADAKİ aday denenir (`no_text`)', () => {
    const d = decideProactive(
      [prop({ sourceId: 'sessiz', kind: 'safety', relevance: 0.9, text: () => null }),
        prop({ sourceId: 'konusan', kind: 'safety', relevance: 0.5 })],
      ctx(), emptyLedger());
    expect(reasons(d, 'sessiz')).toEqual(['no_text']);
    expect(d.sourceId).toBe('konusan');
  });

  it('14. düşen teklif SAKLANMAZ: motor hiçbir kuyruk/bekleme yapısı tutmaz', () => {
    const code = codeOf(src(ENGINE));
    expect(code).not.toContain('_queue');
    expect(code).not.toContain('pending');
    /* Ömrü dolan teklif konuşulmaz — bayat proaktif yasağı. */
    const d = decideProactive(
      [prop({ sourceId: 'bayat', kind: 'safety', decayAtMs: 500 })],
      ctx({ nowMs: 1000 }), emptyLedger());
    expect(d.admitted).toBe(false);
    expect(reasons(d, 'bayat')).toEqual(['decayed']);
  });

  it('15. şablon throw ederse teklif DÜŞER, karar çökmez', () => {
    const d = decideProactive(
      [prop({ sourceId: 'patlak', kind: 'safety', relevance: 0.9,
        text: () => { throw new Error('boom'); } })],
      ctx(), emptyLedger());
    expect(d.admitted).toBe(false);
    expect(reasons(d, 'patlak')).toEqual(['no_text']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — SPAM'İN YAPISAL ENGELİ
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F9 · D · spam yapısal olarak engellidir', () => {
  it('16. cooldown penceresi içinde aynı konu tekrar konuşmaz', () => {
    const p = prop({ sourceId: 'a', kind: 'safety', cooldownMs: 15 * MIN });
    const first = evaluateProactiveProposals([p], ctx({ nowMs: 0 }));
    expect(first.admitted).toBe(true);
    endProactiveDelivery();

    const early = evaluateProactiveProposals([p], ctx({ nowMs: 10 * MIN }));
    expect(early.admitted).toBe(false);
    expect(reasons(early, 'a')).toEqual(['cooldown']);

    const late = evaluateProactiveProposals([p], ctx({ nowMs: 16 * MIN }));
    expect(late.admitted).toBe(true);
  });

  it('17. sıklık bütçesi: SUBJECT teklif aralık dolmadan konuşmaz, EXEMPT konuşur', () => {
    const ledger = { ...emptyLedger(), lastVoiceAtMs: 0 };
    const subject = prop({ sourceId: 's', kind: 'social', frequencyBudget: 'SUBJECT' });
    const exempt = prop({ sourceId: 'e', kind: 'social', frequencyBudget: 'EXEMPT' });

    const d = decideProactive([subject], ctx({ nowMs: 5 * MIN }), ledger);
    expect(reasons(d, 's')).toEqual(['budget']);

    const d2 = decideProactive([exempt], ctx({ nowMs: 5 * MIN }), ledger);
    expect(d2.admitted).toBe(true);

    const d3 = decideProactive([subject], ctx({ nowMs: 25 * MIN }), ledger);
    expect(d3.admitted).toBe(true);
  });

  it("18. 'az' gevezelik (gap = Infinity) bütçeli teklifi TAMAMEN kapatır", () => {
    const d = decideProactive(
      [prop({ sourceId: 's', kind: 'social', frequencyBudget: 'SUBJECT' })],
      ctx({ nowMs: 10_000_000, chattinessGapMs: Infinity }), emptyLedger());
    expect(reasons(d, 's')).toEqual(['budget']);
  });

  it('19. saatlik tavan: güvenlik DIŞI sesli proaktif tavanı aşılamaz', () => {
    const p = (i: number): ProactiveProposal =>
      prop({ sourceId: `s${i}`, kind: 'operational', frequencyBudget: 'EXEMPT' });
    for (let i = 0; i < PROACTIVE_VOICE_CEILING_PER_HOUR; i++) {
      const d = evaluateProactiveProposals([p(i)], ctx({ nowMs: i * MIN }));
      expect(d.admitted, `#${i}`).toBe(true);
      endProactiveDelivery();
    }
    const over = evaluateProactiveProposals([p(99)],
      ctx({ nowMs: PROACTIVE_VOICE_CEILING_PER_HOUR * MIN }));
    expect(over.admitted).toBe(false);
    expect(reasons(over, 's99')).toEqual(['hourly_ceiling']);

    /* Pencere KAYAR: bir saat sonra tavan yeniden açılır (kalıcı kilit değil). */
    const later = evaluateProactiveProposals([p(100)], ctx({ nowMs: 61 * MIN }));
    expect(later.admitted).toBe(true);
  });

  it('20. güvenlik konuşması sohbet bütçesi saatini de ilerletir (mevcut davranış)', () => {
    evaluateProactiveProposals([prop({ sourceId: 'warn', kind: 'safety' })], ctx({ nowMs: 0 }));
    endProactiveDelivery();
    const chat = evaluateProactiveProposals(
      [prop({ sourceId: 'chat', kind: 'social', frequencyBudget: 'SUBJECT' })],
      ctx({ nowMs: 5 * MIN }));
    expect(reasons(chat, 'chat')).toEqual(['budget']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — ÖĞRENME ve DÜRÜSTLÜK
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F9 · E · öğrenme gerçek sinyale bağlıdır, kabul UYDURULMAZ', () => {
  it('21. 3 kesinti sonrası kaynak susar; süre dolunca kendiliğinden geri gelir', () => {
    const p = prop({ sourceId: 'sohbet', kind: 'social' });
    for (let i = 0; i < PROACTIVE_REJECT_THRESHOLD; i++) {
      const d = evaluateProactiveProposals([p], ctx({ nowMs: i * MIN }));
      expect(d.admitted, `konuşma #${i}`).toBe(true);
      noteProactiveInterrupted(i * MIN);
    }
    const blocked = evaluateProactiveProposals([p], ctx({ nowMs: 10 * MIN }));
    expect(blocked.admitted).toBe(false);
    expect(reasons(blocked, 'sohbet')).toEqual(['learned_suppressed']);

    /* Bastırma KALICI DEĞİL — 6 saat sonra kaynak geri döner. */
    const restored = evaluateProactiveProposals([p], ctx({ nowMs: 7 * 3_600_000 }));
    expect(restored.admitted).toBe(true);
  });

  it('22. kesinti YOKSA hiçbir kaynak bastırılmaz (kanıtsız susturma yasak)', () => {
    const p = prop({ sourceId: 'sohbet', kind: 'social' });
    for (let i = 0; i < 5; i++) {
      evaluateProactiveProposals([p], ctx({ nowMs: i * MIN }));
      endProactiveDelivery();
    }
    expect(getProactivePolicyDiagnostics(0).learnedSuppressed).toEqual([]);
  });

  it('23. teslim BİTTİYSE sonradan gelen kesinti hiçbir kaynağa yazılmaz', () => {
    evaluateProactiveProposals([prop({ sourceId: 'sohbet', kind: 'social' })], ctx());
    endProactiveDelivery();
    noteProactiveInterrupted(1000);
    expect(getProactivePolicyDiagnostics(0).interruptions).toBe(0);
  });

  it('24. açık kullanıcı susturması KALICIDIR ve geri alınabilir', () => {
    const p = prop({ sourceId: 'sohbet', kind: 'social' });
    suppressProactiveSource('sohbet');
    const blocked = evaluateProactiveProposals([p], ctx({ nowMs: 10 * 3_600_000 }));
    expect(reasons(blocked, 'sohbet')).toEqual(['user_suppressed']);
    restoreProactiveSource('sohbet');
    expect(evaluateProactiveProposals([p], ctx({ nowMs: 11 * 3_600_000 })).admitted).toBe(true);
  });

  it('25. **KABUL ORANI UYDURULMAZ**: ölçülemez olduğu AÇIKÇA beyan edilir', () => {
    const diag = getProactivePolicyDiagnostics(0);
    expect(diag.acceptRateMeasurable).toBe(false);
    /* Sahte bir oran alanı hiç TANIMLANMAMIŞTIR — üretilemeyen sayı taşınmaz. */
    expect(Object.keys(diag)).not.toContain('acceptRate');
    expect(Object.keys(diag)).not.toContain('proactiveAcceptRate');
  });

  it('26. görsel proaktif kanal YOKTUR: `visual` teklif sesli kanala KAYDIRILMAZ', () => {
    const d = decideProactive(
      [prop({ sourceId: 'gorsel', kind: 'informational', deliver: 'visual' })],
      ctx(), emptyLedger());
    expect(d.admitted).toBe(false);
    expect(reasons(d, 'gorsel')).toEqual(['no_visual_channel']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — TUR ve MEDYA sınırları
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F9 · F · tur ve medya', () => {
  it('27. konuşma sırası meşgulse HİÇBİR teklif değerlendirilmez', () => {
    const d = decideProactive(
      [prop({ sourceId: 'warn', kind: 'safety' })],
      ctx({ turnBusy: true }), emptyLedger());
    expect(d.admitted).toBe(false);
    expect(reasons(d, 'warn')).toEqual(['turn_busy']);
  });

  it('28. medya çalarken yalnız `INTERRUPTS_MEDIA` teklifi geçer', () => {
    const d = decideProactive(
      [prop({ sourceId: 'nazik', kind: 'safety', relevance: 0.9,
        mediaPolicy: 'DEFERS_TO_MEDIA' }),
        prop({ sourceId: 'acil', kind: 'safety', relevance: 0.1,
          mediaPolicy: 'INTERRUPTS_MEDIA' })],
      ctx({ mediaProminent: true }), emptyLedger());
    expect(reasons(d, 'nazik')).toEqual(['media']);
    expect(d.sourceId).toBe('acil');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G — KAYNAK BAĞLAMA (G9'un asıl kusuru) ve dış hat gözlemi
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F9 · G · kaynaklar artık bağlanabilir', () => {
  it('29. companionEngine artık KARAR VERMEZ: kendi cooldown defteri KALMADI', () => {
    const code = codeOf(src(COMPANION));
    for (const gone of ['_lastFuelWarnMin', '_lastDoorWarnMin', '_lastTpmsWarnMin',
      '_lastVisLightsMin', '_lastDrowsyMin', '_lastBreakMin', '_lastSpokeAtMin']) {
      expect(code, gone).not.toContain(gone);
    }
    expect(code).toContain('evaluateProactiveProposals');
  });

  it('30. companionEngine BEŞ güvenlik tetiğini `safety` sınıfında beyan eder', () => {
    const code = codeOf(src(COMPANION));
    for (const s of ['S.fuel', 'S.door', 'S.tpms', 'S.visibility', 'S.drowsy']) {
      const re = new RegExp(`proposal\\(${s.replace('.', '\\.')},\\s*'safety'`);
      expect(re.test(code), s).toBe(true);
    }
    for (const s of ['S.greeting', 'S.breakHint', 'S.tripNote']) {
      const re = new RegExp(`proposal\\(${s.replace('.', '\\.')},\\s*'social'`);
      expect(re.test(code), s).toBe(true);
    }
  });

  it('31. kritik arıza hattı motorun KAPISINDAN GEÇMEZ — yalnız gözlenir', () => {
    const code = codeOf(src(WIRING));
    /* Gözlem VAR: */
    expect(code).toContain('noteExternalProactiveSpoken');
    /* Kapı YOK: bu hat hiçbir koşulda motor tarafından susturulamaz. */
    expect(code).not.toContain('evaluateProactiveProposals');
    expect(code).not.toContain('decideProactive');
  });

  it('32. dış gözlem defteri besler ama KARAR üretmez', () => {
    noteExternalProactiveSpoken('diagnostic.critical_root_cause', 'safety', 0);
    const diag = getProactivePolicyDiagnostics(0);
    expect(diag.externalObserved).toBe(1);
    expect(diag.decisions).toBe(0);          // hiçbir teklif değerlendirilmedi
    expect(diag.admittedBySource['diagnostic.critical_root_cause']).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * H — CAROS LAB gözlem yüzeyi
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F9 · H · LAB salt-okunur ve PII taşımaz', () => {
  const rawBase: MaviRawSnapshot = {
    readAt: 1, voice: null, diag: null, aiHealth: null, quota: null,
    proactive: null, speech: null, turn: null, workload: null, proactivePolicy: null,
  };

  it('33. YENİ EKRAN AÇILMADI: mevcut Mavi Konsolu H bölümüyle genişletildi', () => {
    const sections = buildMaviSections(rawBase);
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('proactive-policy');
    expect(ids).toContain('workload');
    /* LAB katalogunda F9 için ayrı bir ekran kimliği ÜRETİLMEDİ. */
    expect(codeOf(src('platform/devtools/carosLabCatalog.ts')))
      .not.toContain('proactive-policy');
  });

  it('34. kaynak okunamazsa UNAVAILABLE — sahte 0/sahte "sağlıklı" YOK', () => {
    const s = buildMaviSections(rawBase).find((x) => x.id === 'proactive-policy');
    expect(s?.fields.length).toBeGreaterThan(0);
    expect(s?.fields[0]?.klass).toBe('UNAVAILABLE');
  });

  it('35. ölçüm yokken "0 kabul" ÖLÇÜM gibi gösterilmez', () => {
    const s = buildMaviSections({
      ...rawBase,
      proactivePolicy: {
        decisions: 0, admitted: 0, externalObserved: 0, interruptions: 0,
        lastAdmittedSourceId: null, lastDropReason: null,
        drops: {}, admittedBySource: {}, kinds: {},
        hourlyVoiceUsed: 0, hourlyVoiceCeiling: PROACTIVE_VOICE_CEILING_PER_HOUR,
        userSuppressed: [], learnedSuppressed: [], acceptRateMeasurable: false,
      },
    }).find((x) => x.id === 'proactive-policy');
    const root = s?.fields.find((f) => f.id === 'ppRoot');
    expect(root?.klass).toBe('UNAVAILABLE');
    const accept = s?.fields.find((f) => f.id === 'ppAccept');
    expect(accept?.klass).toBe('UNAVAILABLE');
  });

  it('36. tanı yüzeyinde METİN/transcript alanı YOKTUR (yapısal gizlilik)', () => {
    const diag = getProactivePolicyDiagnostics(0);
    for (const banned of ['text', 'transcript', 'prompt', 'utterance', 'message']) {
      expect(Object.keys(diag), banned).not.toContain(banned);
    }
    /* Motor seslendirilen metni HİÇ SAKLAMAZ. */
    const code = codeOf(src(ENGINE));
    expect(code).not.toContain('_lastText');
    expect(code).not.toContain('lastSpokenText');
  });

  it('37. LAB okuma katmanı komut GÖNDERMEZ (salt-okunur sözleşmesi)', () => {
    const code = codeOf(src('platform/devtools/maviConsoleSources.ts'));
    for (const forbidden of ['suppressProactiveSource', 'restoreProactiveSource',
      'evaluateProactiveProposals', 'noteProactiveInterrupted']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    expect(code).toContain('getProactivePolicyDiagnostics');
  });
});
