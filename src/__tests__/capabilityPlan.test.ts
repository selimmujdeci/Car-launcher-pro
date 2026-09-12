/**
 * capabilityPlan.test.ts — MAVİ F6 KİLİTLERİ (bileşik komut + kanonik plan).
 *
 * Kilitlenen sözleşme:
 *  · tek cümle → çoklu TİPLİ plan adımı,
 *  · tekrar ve çakışma DETERMİNİSTİK olarak elenir,
 *  · bağımlılık sırası korunur ve düşen öncül ardılını yürütmez,
 *  · onay gerektiren adım YÜRÜTÜLMEZ; çoklu onay planı TÜMÜYLE reddeder,
 *  · kısmi başarı DÜRÜSTÇE raporlanır (sahte toplu başarı YASAK),
 *  · iptal tamamlanmış işi "geri alındı" göstermez (sahte rollback YASAK),
 *  · eskimiş tur yan etki BAŞLATMAZ,
 *  · plan durumu KONUŞULMAZ (F4 yapısal çıktı sınırı korunur).
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildCapabilityPlan, classifyPlanResult, resolveExecutionOrder, summarizePlan,
  withItemUpdate, operationsConflict,
  type CapabilityPlan, type PlanItem, type PlanItemProposal,
} from '../platform/capability/fabric/capabilityPlan';
import {
  runCapabilityPlan, cancelCapabilityPlan,
  type PlanDispatchOutcome,
} from '../platform/capability/fabric/capabilityPlanRunner';
import {
  renderPlanOutcome, labelOf,
} from '../platform/capability/fabric/capabilityPlanSummary';
import { CAROS_CAPABILITY_CATALOG } from '../platform/capability/fabric/carosCapabilityCatalog';
import { _resetCapabilityFabricForTest } from '../platform/capability/fabric/capabilityFabric';

const src = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ── Öneri kısayolları ─────────────────────────────────────────────────── */

const nav = (dest = 'home'): PlanItemProposal => ({
  capabilityId: 'navigation.route', operation: 'start',
  parameters: { destination: dest }, legacyIntent: 'OPEN_NAVIGATION',
  requiresConfirmation: false,
});
const volDown = (): PlanItemProposal => ({
  capabilityId: 'media.volume', operation: 'decrease',
  parameters: {}, legacyIntent: 'VOLUME_DOWN', requiresConfirmation: false,
});
const volUp = (): PlanItemProposal => ({
  capabilityId: 'media.volume', operation: 'increase',
  parameters: {}, legacyIntent: 'VOLUME_UP', requiresConfirmation: false,
});
const phone = (): PlanItemProposal => ({
  capabilityId: 'phone.call', operation: 'start',
  parameters: { contactName: 'annem' }, legacyIntent: 'OPEN_PHONE',
  requiresConfirmation: true,
});
const dtcClear = (): PlanItemProposal => ({
  capabilityId: 'diagnostics.dtc', operation: 'clear',
  parameters: {}, legacyIntent: 'CLEAR_DTC_CODES', requiresConfirmation: true,
});
const music = (): PlanItemProposal => ({
  capabilityId: 'media.playback', operation: 'searchAndPlay',
  parameters: { query: 'sezen aksu' }, legacyIntent: 'PLAY_MUSIC_SEARCH',
  requiresConfirmation: false,
});
const pause = (): PlanItemProposal => ({
  capabilityId: 'media.playback', operation: 'pause',
  parameters: {}, legacyIntent: 'PAUSE_MEDIA', requiresConfirmation: false,
});

const build = (props: readonly PlanItemProposal[]): CapabilityPlan =>
  buildCapabilityPlan(props, { planId: 'p1', turnId: 7 });

/** Her adıma sabit sonuç veren yürütücü portu (DI — gerçek yürütücü YOK). */
function makeRunner(
  outcomes: Readonly<Record<string, PlanDispatchOutcome>>,
  opts: { live?: boolean; liveAfter?: number } = {},
) {
  const dispatched: string[] = [];
  let calls = 0;
  return {
    dispatched,
    ports: {
      isTurnCurrent: (): boolean => {
        if (opts.liveAfter !== undefined) { calls += 1; return calls <= opts.liveAfter; }
        return opts.live !== false;
      },
      dispatch: (item: PlanItem): PlanDispatchOutcome => {
        dispatched.push(item.legacyIntent);
        return outcomes[item.legacyIntent] ?? { observation: 'ACCEPTED' as const };
      },
    },
  };
}
beforeEach(() => { _resetCapabilityFabricForTest(); });
afterEach(() => { _resetCapabilityFabricForTest(); });

/* ══════════════════════════════════════════════════════════════════════════
 * A — Bileşik plan kurulumu
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F6 · A · bileşik plan kurulumu', () => {
  it('1. İKİ iş → iki tipli adım', () => {
    const plan = build([nav(), volDown()]);
    expect(plan.items).toHaveLength(2);
    expect(plan.items.map((i) => i.legacyIntent)).toEqual(['OPEN_NAVIGATION', 'VOLUME_DOWN']);
    expect(plan.items[0].executionState).toBe('PENDING');
    expect(plan.items[0].observationState).toBe('REQUESTED');   // proposal ≠ execution ≠ observation
  });

  it('2. ÜÇ iş → üç adım; sıra ve kimlikler kararlı', () => {
    const plan = build([nav(), volDown(), music()]);
    expect(plan.items).toHaveLength(3);
    expect(plan.items.map((i) => i.itemId)).toEqual(['p1:0', 'p1:1', 'p1:2']);
    expect(plan.items.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it('3. adımlar VARSAYILAN OLARAK bağımsızdır (bağımlılık uydurulmaz)', () => {
    const plan = build([nav(), volDown(), music()]);
    expect(plan.items.every((i) => i.dependencies.length === 0)).toBe(true);
    expect(summarizePlan(plan).dependencyCount).toBe(0);
  });

  it('4. `dependsOnPrevious` sırayı bağlar ("önce … sonra …")', () => {
    const plan = build([nav(), { ...music(), dependsOnPrevious: true }]);
    expect(plan.items[1].dependencies).toEqual(['p1:0']);
    const ordered = resolveExecutionOrder(plan.items);
    expect(ordered.map((i) => i.itemId)).toEqual(['p1:0', 'p1:1']);
  });

  it('5. **TEKRAR ELENİR** — düzeltme cümlesi iki adım üretmez', () => {
    const plan = build([nav('home'), nav('home'), volDown()]);
    expect(plan.items).toHaveLength(2);
    expect(plan.suppressed).toHaveLength(1);
    expect(plan.suppressed[0].suppressionReason).toBe('DUPLICATE');
    expect(plan.suppressed[0].executionState).toBe('SUPPRESSED');
  });

  it('6. farklı parametre TEKRAR DEĞİLDİR', () => {
    const plan = build([nav('home'), nav('work')]);
    expect(plan.items).toHaveLength(2);
    expect(plan.suppressed).toHaveLength(0);
  });

  it('7. **ÇAKIŞMA DETERMİNİSTİK: son istek kazanır**', () => {
    const plan = build([volUp(), volDown()]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].legacyIntent).toBe('VOLUME_DOWN');       // SON
    expect(plan.suppressed[0].legacyIntent).toBe('VOLUME_UP');
    expect(plan.suppressed[0].suppressionReason).toBe('CONFLICT_SUPERSEDED');
  });

  it('8. "müziği aç ve kapat" kör yürütülmez (çakışma sözlüğü)', () => {
    expect(operationsConflict('media.playback', 'searchAndPlay', 'pause')).toBe(true);
    expect(operationsConflict('media.playback', 'next', 'previous')).toBe(false);
    const plan = build([music(), pause()]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].operation).toBe('pause');
  });

  it('9. **SAHTE ROLLBACK YOK** — hiçbir adım `reversible` değildir', () => {
    const plan = build([nav(), music(), volDown()]);
    expect(plan.items.every((i) => i.reversible === false)).toBe(true);
  });

  it('10. adım metadata\'sı katalogdan gelir (ikinci tanım yok)', () => {
    const plan = build([phone()]);
    expect(plan.items[0].safetyClass).toBe('communication');
    expect(plan.items[0].cancellable).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Onay
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F6 · B · onay', () => {
  it('11. **ONAY GEREKEN ADIM YÜRÜTÜLMEZ; güvenli adımlar akar**', async () => {
    const plan = build([nav(), music(), phone()]);
    const r = makeRunner({});
    const out = await runCapabilityPlan(plan, r.ports);
    expect(r.dispatched).toEqual(['OPEN_NAVIGATION', 'PLAY_MUSIC_SEARCH']);
    const p = out.items.find((i) => i.legacyIntent === 'OPEN_PHONE')!;
    expect(p.executionState).toBe('AWAITING_CONFIRMATION');
    expect(p.failureClass).toBe('CONFIRMATION_REQUIRED');
    expect(out.resultClass).toBe('AWAITING_CONFIRMATION');
  });

  it('12. onay bekleyen adım için kanca çağrılır (kanonik kurulum çağıranın)', async () => {
    const seen: string[] = [];
    const plan = build([nav(), phone()]);
    await runCapabilityPlan(plan, {
      isTurnCurrent: () => true,
      dispatch: () => ({ observation: 'ACCEPTED' as const }),
      requestConfirmation: (i) => seen.push(i.legacyIntent),
    });
    expect(seen).toEqual(['OPEN_PHONE']);
  });

  it('13. **ÇOKLU ONAY → PLAN TÜMÜYLE REDDEDİLİR** (P1 fail-closed politikası)', async () => {
    const plan = build([nav(), phone(), dtcClear()]);
    expect(plan.resultClass).toBe('REFUSED');
    expect(plan.refusalReason).toBe('multiple_confirmation_required_items');
    expect(plan.items.every((i) => i.executionState === 'SUPPRESSED')).toBe(true);

    const r = makeRunner({});
    const out = await runCapabilityPlan(plan, r.ports);
    expect(r.dispatched, 'reddedilen planda HİÇBİR adım çalışmamalı').toEqual([]);
    expect(out.resultClass).toBe('REFUSED');
  });

  it('14. çoklu onay reddi kullanıcıya DÜRÜSTÇE söylenir', () => {
    const plan = build([phone(), dtcClear()]);
    expect(renderPlanOutcome(plan)).toContain('birden fazla onay');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — Yürütme · kısmi başarı · bağımlılık
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F6 · C · yürütme ve kısmi başarı', () => {
  it('15. **KISMİ BAŞARI DÜRÜST** — bir adım düşünce plan tümüyle başarısız SAYILMAZ', async () => {
    const plan = build([nav(), music(), { ...phone(), requiresConfirmation: false }]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION: { observation: 'ACCEPTED' },
      PLAY_MUSIC_SEARCH: { observation: 'ACCEPTED' },
      OPEN_PHONE: { observation: 'FAILED', status: 'failed' },
    }).ports);
    expect(out.resultClass).toBe('PARTIAL');
    const s = summarizePlan(out);
    expect(s.failedCount).toBe(1);
    expect(out.items.find((i) => i.legacyIntent === 'OPEN_PHONE')!.failureClass)
      .toBe('EXECUTION_FAILED');
  });

  it('16. **SAHTE TOPLU BAŞARI YASAK** — bir adım UNKNOWN ise ALL_SUCCEEDED olmaz', async () => {
    const plan = build([nav(), music()]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION: { observation: 'ACCEPTED' },
      PLAY_MUSIC_SEARCH: { observation: 'UNKNOWN' },
    }).ports);
    expect(out.resultClass).not.toBe('ALL_SUCCEEDED');
    expect(out.resultClass).toBe('PARTIAL');
  });

  it('17. tüm adımlar kanıtlı başarıysa ALL_SUCCEEDED', async () => {
    const plan = build([nav(), music()]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION: { observation: 'EXECUTED' },
      PLAY_MUSIC_SEARCH: { observation: 'OBSERVED' },
    }).ports);
    expect(out.resultClass).toBe('ALL_SUCCEEDED');
  });

  it('17b. **ACCEPTED ≠ DOĞRULANMIŞ BAŞARI** — tümü ACCEPTED olan plan ALL_SUCCEEDED OLAMAZ', async () => {
    /* ── QA BULGU-1 (2026-08-29) · EKSİK KİLİT KAPATILDI ────────────────────
     * Bağımsız QA mutasyon testi şunu ölçtü: `classifyPlanResult` içindeki
     *     if (verified.length === live.length) return 'ALL_SUCCEEDED';
     * satırı
     *     if (verified.length + delivered.length === live.length) …
     * hâline getirildiğinde **947 test yeşil kaldı** — yani F6'nın MANŞET
     * invariantı ("sahte toplu başarı yasak") KORUMASIZDI.
     *
     * Boşluğun sebebi kapsama deliğiydi: test setinde adımların TAMAMI
     * `ACCEPTED` olan bir plan senaryosu yoktu. Karışık senaryolar
     * (ACCEPTED+FAILED → PARTIAL) ve tam kanıtlı senaryolar
     * (EXECUTED+OBSERVED → ALL_SUCCEEDED) bu mutasyonu AYIRT EDEMİYOR.
     *
     * Üretim davranışı o sırada da DOĞRUYDU (QA probe ile kanıtlandı) —
     * bu kilit davranışı değiştirmez, onu YAPISAL OLARAK SABİTLER. */
    const plan = build([nav(), music(), volDown()]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION:   { observation: 'ACCEPTED' },
      PLAY_MUSIC_SEARCH: { observation: 'ACCEPTED' },
      VOLUME_DOWN:       { observation: 'ACCEPTED' },
    }).ports);

    // Ön koşul: senaryo gerçekten "tümü ACCEPTED" olmalı (vacuous PASS koruması).
    const live = out.items.filter((i) => i.executionState !== 'SUPPRESSED');
    expect(live, 'senaryo kurulamadı — kilit körleşirdi').toHaveLength(3);
    expect(live.every((i) => i.executionState === 'SETTLED')).toBe(true);
    expect(live.every((i) => i.observationState === 'ACCEPTED')).toBe(true);

    /* SINIFLANDIRMA: teslim edilmiş ama DOĞRULANMAMIŞ iş "hepsi başarılı"
     * SAYILAMAZ. Sınıflandırıcı doğrudan da çağrılır — plan üzerinden gelen
     * değerin türetilmiş olması kilidi zayıflatmasın. */
    expect(out.resultClass, 'ACCEPTED kanıtlı başarı sayılıyor — SAHTE TOPLU BAŞARI')
      .not.toBe('ALL_SUCCEEDED');
    expect(classifyPlanResult(out)).not.toBe('ALL_SUCCEEDED');
    // Mevcut DOĞRU sınıflandırma: hiçbiri düşmedi ama hiçbiri de doğrulanmadı.
    expect(out.resultClass).toBe('PARTIAL');
    expect(classifyPlanResult(out)).toBe('PARTIAL');

    /* METİN: doğrulanmış başarı fiili KULLANILAMAZ; teslim/başlatma seviyesinde
     * dürüst ifade KORUNMALI. */
    const text = renderPlanOutcome(out);
    expect(text, 'boş metin kilidi körleştirir').not.toBe('');
    for (const verified of ['açtım', 'yaptım', 'doğruladım', 'tamamladım']) {
      expect(text.toLocaleLowerCase('tr-TR'),
        `doğrulanmamış iş için başarı iddiası: "${verified}"`).not.toContain(verified);
    }
    expect(text).toContain('başlattım');
  });

  it('17c. **TEK adım bile ACCEPTED ise** plan ALL_SUCCEEDED olamaz (sınır durumu)', async () => {
    /* Kanıtlı adımların yanında TEK bir doğrulanmamış adım bile toplu başarıyı
     * düşürür — "çoğunluk doğrulandı" bir başarı kanıtı DEĞİLDİR. */
    const plan = build([nav(), music()]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION:   { observation: 'OBSERVED' },   // kanıtlı
      PLAY_MUSIC_SEARCH: { observation: 'ACCEPTED' },   // doğrulanmamış
    }).ports);
    expect(out.resultClass).not.toBe('ALL_SUCCEEDED');
    expect(out.resultClass).toBe('PARTIAL');
    const text = renderPlanOutcome(out);
    // Kanıtlı adım "açtım", doğrulanmamış adım "başlattım" — İKİ İDDİA AYRIŞIR.
    expect(text).toContain('açtım');
    expect(text).toContain('başlattım');
  });

  it('18. hiçbiri başaramazsa ALL_FAILED', async () => {
    const plan = build([nav(), music()]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION: { observation: 'FAILED' },
      PLAY_MUSIC_SEARCH: { observation: 'FAILED' },
    }).ports);
    expect(out.resultClass).toBe('ALL_FAILED');
  });

  it('19. **DÜŞEN ÖNCÜL ARDILINI YÜRÜTMEZ** ("önce rota, sonra müzik")', async () => {
    const plan = build([nav(), { ...music(), dependsOnPrevious: true }]);
    const r = makeRunner({ OPEN_NAVIGATION: { observation: 'FAILED', status: 'failed' } });
    const out = await runCapabilityPlan(plan, r.ports);
    expect(r.dispatched).toEqual(['OPEN_NAVIGATION']);           // ikincisi HİÇ çalışmadı
    const m = out.items.find((i) => i.legacyIntent === 'PLAY_MUSIC_SEARCH')!;
    expect(m.executionState).toBe('CANCELLED');
  });

  it('20. gözlem GELMEZSE başarı iddia edilmez (UNKNOWN)', async () => {
    const plan = build([nav(), music()]);
    const out = await runCapabilityPlan(plan, {
      isTurnCurrent: () => true,
      dispatch: () => ({ observation: null }),
    });
    expect(out.items.every((i) => i.observationState === 'UNKNOWN')).toBe(true);
    expect(out.resultClass).toBe('ALL_FAILED');                  // başarı SAYILMAZ
  });

  it('21. yürütücü THROW ederse adım FAILED olur, plan çökmez', async () => {
    const plan = build([nav(), music()]);
    const out = await runCapabilityPlan(plan, {
      isTurnCurrent: () => true,
      dispatch: (i) => {
        if (i.legacyIntent === 'OPEN_NAVIGATION') throw new Error('boom');
        return { observation: 'ACCEPTED' as const };
      },
    });
    expect(out.items[0].observationState).toBe('FAILED');
    expect(out.resultClass).toBe('PARTIAL');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — Stale tur ve iptal
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F6 · D · stale ve iptal', () => {
  it('22. **ESKİMİŞ TUR YAN ETKİ BAŞLATMAZ**', async () => {
    const plan = build([nav(), music(), volDown()]);
    const r = makeRunner({}, { live: false });
    const out = await runCapabilityPlan(plan, r.ports);
    expect(r.dispatched).toEqual([]);
    expect(out.items.every((i) => i.executionState === 'CANCELLED')).toBe(true);
    expect(out.resultClass).toBe('CANCELLED');
  });

  it('23. tur ORTADA devralınırsa kalan adımlar çalışmaz', async () => {
    const plan = build([nav(), music(), volDown()]);
    const r = makeRunner({}, { liveAfter: 1 });    // yalnız ilk adım canlı
    const out = await runCapabilityPlan(plan, r.ports);
    expect(r.dispatched).toEqual(['OPEN_NAVIGATION']);
    expect(out.items[1].executionState).toBe('CANCELLED');
    expect(out.items[2].executionState).toBe('CANCELLED');
  });

  it('24. **İPTAL: başlamamış adımlar iptal, TAMAMLANMIŞ adım GERİ ALINMIŞ GÖSTERİLMEZ**', async () => {
    let plan = build([nav(), music(), volDown()]);
    plan = withItemUpdate(plan, 'p1:0', {
      executionState: 'SETTLED', observationState: 'EXECUTED',
    });
    const out = cancelCapabilityPlan(plan);
    expect(out.alreadySettled).toBe(1);
    expect(out.cancelled).toBe(2);
    expect(out.plan.items[0].executionState, 'tamamlanmış iş geri alınmış gösterilemez')
      .toBe('SETTLED');
    expect(out.plan.items[0].observationState).toBe('EXECUTED');
  });

  it('25. uçuşta olup İPTAL EDİLEMEYEN adım dürüstçe raporlanır', () => {
    let plan = build([pause(), nav()]);
    // `media.playback#pause` katalogda cancellable:false
    plan = withItemUpdate(plan, 'p1:0', { executionState: 'DISPATCHED' });
    const out = cancelCapabilityPlan(plan);
    expect(out.notCancellable).toBe(1);
    expect(out.plan.items[0].executionState).toBe('DISPATCHED');   // dokunulmadı
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — Gözleme dayalı birleşik cevap
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F6 · E · birleşik sonuç metni', () => {
  it('26. **KISMİ SONUÇ GERÇEK GÖZLEMDEN** üretilir', async () => {
    const plan = build([nav(), music(), { ...phone(), requiresConfirmation: false }]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION: { observation: 'ACCEPTED' },
      PLAY_MUSIC_SEARCH: { observation: 'ACCEPTED' },
      OPEN_PHONE: { observation: 'FAILED' },
    }).ports);
    const text = renderPlanOutcome(out);
    expect(text.toLocaleLowerCase('tr-TR')).toContain('rotayı');
    expect(text).toContain('müziği');
    expect(text).toContain('başlattım');
    expect(text).toContain('başlatamadım');
  });

  it('27. **`ACCEPTED` için "açtım" DENMEZ** (doğrulanmamış başarı iddiası yasak)', async () => {
    const plan = build([nav()]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION: { observation: 'ACCEPTED' },
    }).ports);
    const text = renderPlanOutcome(out);
    expect(text).toContain('başlattım');
    expect(text).not.toContain('açtım');
  });

  it('28. metin PARAMETRE DEĞERİ taşımaz (kişi adı/adres sızmaz)', async () => {
    const plan = build([nav('Kadıköy'), { ...phone(), requiresConfirmation: false }]);
    const out = await runCapabilityPlan(plan, makeRunner({}).ports);
    const text = renderPlanOutcome(out);
    expect(text).not.toContain('Kadıköy');
    expect(text).not.toContain('annem');
  });

  it('29. söylenecek bir şey yoksa cümle UYDURULMAZ', () => {
    const empty = buildCapabilityPlan([], { planId: 'p0' });
    expect(renderPlanOutcome(empty)).toBe('');
  });

  it('30. katalogdaki HER işlemin kısa adı vardır (etiket boşluğu yok)', () => {
    for (const d of CAROS_CAPABILITY_CATALOG) {
      const label = labelOf({ capabilityId: d.capabilityId, operation: d.operation });
      expect(label, `${d.capabilityId}#${d.operation} etiketsiz`).not.toBe('işlemi');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — Telemetri
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F6 · F · telemetri özeti', () => {
  it('31. özet ADET ve bounded sınıf taşır; PARAMETRE DEĞERİ taşımaz', async () => {
    const plan = build([nav(), { ...music(), dependsOnPrevious: true }, phone()]);
    const out = await runCapabilityPlan(plan, makeRunner({
      OPEN_NAVIGATION: { observation: 'EXECUTED' },
      PLAY_MUSIC_SEARCH: { observation: 'ACCEPTED' },
    }).ports);
    const s = summarizePlan(out);
    expect(s.itemCount).toBe(3);
    expect(s.dependencyCount).toBe(1);
    expect(s.confirmationCount).toBe(1);
    expect(s.executedCount).toBe(1);
    expect(JSON.stringify(s)).not.toContain('annem');
    expect(JSON.stringify(s)).not.toContain('sezen');
  });

  it('32. elenen adımlar özet dışında ama SAYILIR', () => {
    const plan = build([nav('home'), nav('home'), volUp(), volDown()]);
    const s = summarizePlan(plan);
    expect(s.itemCount).toBe(2);
    expect(s.suppressedCount).toBe(2);              // 1 duplicate + 1 conflict
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G — Kaynak kilitleri (mimari sınırlar + F0–F5 invariant'ları)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F6 · G · kaynak kilitleri', () => {
  const plan = src('platform/capability/fabric/capabilityPlan.ts');
  const runnerSrc = src('platform/capability/fabric/capabilityPlanRunner.ts');
  const summary = src('platform/capability/fabric/capabilityPlanSummary.ts');

  it('33. **PLAN KATMANI YÜRÜTMEZ** (ikinci yürütücü yasağı — F5 sözleşmesi)', () => {
    for (const [name, s] of [['plan', plan], ['runner', runnerSrc], ['summary', summary]] as const) {
      const code = codeOf(s);
      for (const forbidden of [
        'dispatchIntent', 'executeIntent', 'executeAIResult', 'routeIntent',
        'navigationService', 'mediaService', 'appLauncher', 'obdService', 'useStore',
      ]) {
        expect(code, `${name} yürütme yoluna dokunuyor: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('34. **PLAN KATMANI GÜVENLİK KARARI VERMEZ** (kanonik otorite taklit edilmez)', () => {
    for (const s of [plan, runnerSrc, summary]) {
      const code = codeOf(s);
      for (const forbidden of [
        'evaluateVehicleAction', 'evaluateActionIdSafety', 'createAiSafetyGate',
        'assistantSafetyKernel', 'MOTION_STOPPED_MAX_KMH',
      ]) {
        expect(code).not.toContain(forbidden);
      }
    }
  });

  it('35. SAF katmanlar SAF kalır (I/O · timer · Date.now YOK)', () => {
    for (const [name, s] of [['plan', plan], ['summary', summary]] as const) {
      const code = codeOf(s);
      expect(code, name).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
      expect(code, name).not.toMatch(/^let\s/m);
    }
    // Koordinatör de kendi timer'ını KURMAZ (sıfır sızıntı).
    expect(codeOf(runnerSrc)).not.toMatch(/setTimeout\(|setInterval\(/);
  });

  it('36. plan katmanı KONUŞMAZ (seslendirme çağıranındır)', () => {
    for (const s of [plan, runnerSrc]) {
      const code = codeOf(s);
      expect(code).not.toContain('speakMavi');
      expect(code).not.toContain('ttsSpeak');
    }
  });

  it('37. **F4 KORUNDU:** yapısal çıktı (plan/action JSON) akıştan SESLENDİRİLMEZ', () => {
    /* Beyin artık `{"type":"action","actions":[...]}` da dönebiliyor. Çıkarıcı
       `type !== 'chat'` gördüğü an akışı STRUCTURED'a çeker → plan durumu,
       item listesi ve capability JSON'ı TEK KARAKTER bile konuşulmaz. */
    const code = codeOf(src('platform/voice/streamSayExtractor.ts'));
    expect(code).toMatch(/if \(t !== 'chat'\)/);
    expect(code).toContain("state = 'STRUCTURED'");
  });

  it('38. **F6 TEK CEVAP:** plan başında `answer` slotu tutulur (duplicate speech yasağı)', () => {
    const code = codeOf(src('platform/voiceService.ts'));
    const i = code.indexOf('async function _runBrainPlan');
    expect(i, 'plan yürütücüsü kaldırılmış — kilit körleşti').toBeGreaterThan(-1);
    const body = code.slice(i, i + 4200);
    expect(body).toContain('claimMaviAnswerStream');
    expect(body).toContain('releaseMaviAnswerSlot');
    /* Slot alınamazsa plan HİÇ çalışmamalı — yarım iş yapıp susmak yasak. */
    expect(body).toMatch(/if \(!claimMaviAnswerStream\(turn\)\) return 'not_applicable'/);
  });

  it('39. **F5 KORUNDU:** her adım capability kapısından geçer', () => {
    const code = codeOf(src('platform/voiceService.ts'));
    const i = code.indexOf('async function _runBrainPlan');
    const body = code.slice(i, i + 4200);
    expect(body).toContain('evaluateLegacyIntent');
    expect(body).toMatch(/if \(!decision\.allow\) continue/);
  });

  it('40. **ONAY GERÇEĞİ KANONİK DEFTERDEN** okunur (ikinci politika yok)', () => {
    const code = codeOf(src('platform/voiceService.ts'));
    const i = code.indexOf('async function _runBrainPlan');
    const body = code.slice(i, i + 4200);
    expect(body).toContain('isVehicleEffectiveIntent');
    expect(body).toContain('getVehicleActionDef');
  });

  it('41. **F2 KORUNDU:** plan katmanı ara söz üretmez', () => {
    for (const s of [plan, runnerSrc]) {
      expect(codeOf(s)).not.toContain('feedback');
    }
  });

  it('42. bileşik ayrıştırma TEK çıkarıcı kullanır (alan kopyası yok)', () => {
    /* MAVI-F13/4: ayrıştırma `companionBrainParser`e taşındı — kilit SİLİNMEDİ,
       yeni sahibine bağlandı. Sözleşme aynı: TEK çıkarıcı, alan kopyası yok. */
    const code = codeOf(src('platform/companion/companionBrainParser.ts'));
    expect(code).toContain('semanticFromBrainAction');
    /* Tekil ve bileşik yol AYNI fonksiyonu çağırmalı — iki kopya çıkarım
       F5'te kapatılan "üç ayrı liste" kusurunun tekrarı olurdu. */
    expect((code.match(/semanticFromBrainAction\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(code).toContain('MAX_PLAN_ITEMS');
    /* Sağlayıcıda İKİNCİ bir çıkarıcı doğmamalı (bölünme yasağı). */
    const provider = codeOf(src('platform/companion/companionChatProvider.ts'));
    expect(provider, 'sağlayıcıda ikinci alan çıkarıcısı belirdi')
      .not.toMatch(/settingKey:\s+typeof obj\.settingKey/);
  });

  it('43. ardışık yürütme KİLİTLİ (gözlem devri yarışa girmesin)', () => {
    /* `takeLastCapabilityObservation` tek atışlık yuvadır ve YALNIZ ardışık
       yürütmede güvenlidir. Paralel `Promise.all` eklenirse bu kilit düşer. */
    const code = codeOf(runnerSrc);
    expect(code).toMatch(/for \(const item of ordered\)/);
    expect(code).not.toMatch(/Promise\.all\(\s*ordered/);
  });
});
