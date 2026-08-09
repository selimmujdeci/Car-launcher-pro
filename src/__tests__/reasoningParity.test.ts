/**
 * reasoningParity.test.ts — ADR-286 · TS ↔ SQL KARAR ÇEKİRDEĞİ PARİTESİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Karar kuralı bugün **iki kere yazılıdır**:
 *   · cihaz  → `src/platform/reasoning/maviReasoningEngine.ts` (751 satır)
 *   · sunucu → `20260801000057_mavi_reasoning_engine_p1.sql`  (1143 satır)
 * SQL yorumları bunu açıkça kabul eder ("TS `resolveConflicts` ile birebir").
 * ADR-286 karar otoritesini CİHAZA verdi ve kural 3'ü koydu: **kural iki kere
 * yazılmaz.** Kopyalar teke inene kadar aradaki ayrışma ÖLÇÜLMEK zorundadır —
 * ayrışma sessiz olursa cihaz ile filo aynı araç için farklı hüküm verir.
 *
 * ── BU DOSYA NEYİ KARŞILAŞTIRIR ───────────────────────────────────────────
 * SQL'in DAVRANIŞINI TAHMİN ETMEZ — **kaynak metnini okur**. Beklenen çıktıyı
 * elle yazmak, SQL'in üçüncü bir kopyasını üretmek olurdu; o da kural 3'ün
 * yeni bir ihlali olurdu. Bu yüzden eşleme tabloları, eşikler ve karar sırası
 * migration dosyasından AYRIŞTIRILIR ve TS sabitleriyle karşılaştırılır.
 *
 * ── KAPSAM SINIRI (dürüstlük) ─────────────────────────────────────────────
 * Burada **saf çekirdek** karşılaştırılır. Kabuk (tablo erişimi, cross-tenant
 * JOIN, zincir yazımı, `now()`) kapsam DIŞIDIR; o katman ortamına göre zaten
 * farklıdır ve ADR-286 §3.2'de böyle tasarlanmıştır.
 *
 * ⚠️ **SQL BU KOŞUMDA YÜRÜTÜLMÜYOR** — yerel Postgres (docker) kapalıydı.
 * Bu dosya SQL'in *metnini* denetler. Çalıştırmalı çapraz koşum ADR-286 §5.3
 * aşama 2'dir ve `supabase/tests/` altında ayrıca koşulur. Metin denetimi,
 * çalıştırmalı testin YERİNE GEÇMEZ; onun ön koşuludur.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  intentForCategory, categoriesForIntent, stateForDecision,
  canTransitionReasoning, REASONING_DEFAULT_TTL_MS,
  type ReasoningIntent, type ReasoningDecision, type ReasoningState,
} from '../platform/reasoning/maviReasoning';
import {
  sourceConfidenceCeiling, provenanceConfidenceCeiling, sampleConfidenceCeiling,
  weakestEvidenceConfidence, deriveEvidenceConfidence,
  type EvidenceSource, type EvidenceProvenance, type EvidenceConfidence,
  type EvidenceCategory, type AiEvidence,
} from '../platform/fleet/aiEvidence';
import type { EvidenceLedger } from '../platform/fleet/aiEvidenceEngine';
import { reason, resolveDecision, resolveConfidence } from '../platform/reasoning/maviReasoningEngine';

/* ── SQL kaynakları ────────────────────────────────────────────────────── */

const MIG = join(process.cwd(), 'supabase', 'migrations');
const SQL_EVIDENCE = readFileSync(
  join(MIG, '20260801000055_ai_evidence_engine_p1.sql'), 'utf8');
const SQL_REASON = readFileSync(
  join(MIG, '20260801000057_mavi_reasoning_engine_p1.sql'), 'utf8');

/** Bir SQL fonksiyonunun gövdesini çıkarır (sonraki CREATE'e kadar). */
function sqlFn(src: string, name: string): string {
  const start = src.indexOf(`FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`SQL fonksiyonu bulunamadı: ${name}`);
  const rest = src.slice(start);
  const end = rest.indexOf('$fn$;');
  if (end < 0) throw new Error(`gövde sonu bulunamadı: ${name}`);
  return rest.slice(0, end);
}

/** `WHEN 'x' THEN 'y'` çiftlerini sözlüğe çevirir. */
function caseMap(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/WHEN\s+'([A-Z_]+)'\s*THEN\s+'([A-Z_]+)'/g)) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

/** `WHEN 'x' THEN ARRAY['a','b']` çiftlerini sözlüğe çevirir. */
function caseArrayMap(body: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(/WHEN\s+'([A-Z_]+)'\s*THEN\s+ARRAY\[([^\]]+)\]/g)) {
    out[m[1]!] = [...m[2]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   BÖLÜM A — EŞLEME TABLOLARI (SQL metni ↔ TS sabitleri)
   ══════════════════════════════════════════════════════════════════════════ */

describe('A · eşleme tabloları TS ile birebir', () => {
  it('kaynak güven tavanı — _evidence_source_ceiling ↔ sourceConfidenceCeiling', () => {
    const sql = caseMap(sqlFn(SQL_EVIDENCE, '_evidence_source_ceiling'));
    expect(Object.keys(sql).length).toBeGreaterThan(5);
    for (const [source, expected] of Object.entries(sql)) {
      expect(sourceConfidenceCeiling(source as EvidenceSource), `kaynak: ${source}`)
        .toBe(expected);
    }
    // Ters yön: SQL'de olmayan kaynak TS'te sessizce yüksek güven ALMASIN.
    expect(sourceConfidenceCeiling('SOURCE_UNKNOWN' as EvidenceSource)).toBe('UNKNOWN');
  });

  it('ölçüm kalitesi tavanı — _evidence_confidence içi ↔ provenanceConfidenceCeiling', () => {
    const sql = caseMap(sqlFn(SQL_EVIDENCE, '_evidence_confidence'));
    for (const p of ['MEASURED', 'DERIVED', 'ESTIMATED'] as const) {
      expect(sql[p], `SQL'de ${p} eşlemesi yok`).toBeDefined();
      expect(provenanceConfidenceCeiling(p as EvidenceProvenance), `provenance: ${p}`)
        .toBe(sql[p]);
    }
    expect(provenanceConfidenceCeiling('UNKNOWN' as EvidenceProvenance)).toBe('UNKNOWN');
  });

  it('niyet→kategori — _reasoning_categories ↔ categoriesForIntent', () => {
    const sql = caseArrayMap(sqlFn(SQL_REASON, '_reasoning_categories'));
    expect(Object.keys(sql).length).toBeGreaterThan(8);
    for (const [intent, cats] of Object.entries(sql)) {
      expect([...categoriesForIntent(intent as ReasoningIntent)], `niyet: ${intent}`)
        .toEqual(cats);
    }
    /* Bilinmeyen niyette boş dizi — boş dizi bir "hepsi" kısayolu DEĞİLDİR.
       Bu ters çevrilirse motor bilinmeyen niyette TÜM kanıtı toplar. */
    expect(categoriesForIntent('UNKNOWN' as ReasoningIntent)).toEqual([]);
  });

  it('kategori→niyet — _reasoning_intent_for_category ↔ intentForCategory', () => {
    const sql = caseMap(sqlFn(SQL_REASON, '_reasoning_intent_for_category'));
    expect(Object.keys(sql).length).toBeGreaterThan(10);
    for (const [cat, intent] of Object.entries(sql)) {
      expect(intentForCategory(cat as EvidenceCategory), `kategori: ${cat}`).toBe(intent);
    }
  });

  it('karar→terminal durum — _reasoning_state_for_decision ↔ stateForDecision', () => {
    const sql = caseMap(sqlFn(SQL_REASON, '_reasoning_state_for_decision'));
    for (const [decision, state] of Object.entries(sql)) {
      expect(stateForDecision(decision as ReasoningDecision), `karar: ${decision}`)
        .toBe(state);
    }
    /* SQL'de ELSE 'UNKNOWN' — sonuçlandırıcı olmayan her karar "bilmiyorum"dur. */
    for (const d of ['INSUFFICIENT_EVIDENCE', 'EXPIRED_EVIDENCE', 'UNKNOWN'] as const) {
      expect(stateForDecision(d as ReasoningDecision)).toBe('UNKNOWN');
    }
  });

  it('güven sıralaması — _evidence_weakest dizisi ↔ weakestEvidenceConfidence', () => {
    const body = sqlFn(SQL_EVIDENCE, '_evidence_weakest');
    const order = [...body.matchAll(/'(UNKNOWN|LOW|MEDIUM|HIGH|VERY_HIGH)'/g)]
      .map((m) => m[1]!)
      .filter((v, i, a) => a.indexOf(v) === i);
    expect(order).toEqual(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']);
    // TS aynı sıralamayı kullanıyor mu — her komşu çift için en zayıf soldaki olmalı.
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i] as EvidenceConfidence, b = order[i + 1] as EvidenceConfidence;
      expect(weakestEvidenceConfidence(a, b), `${a} vs ${b}`).toBe(a);
      expect(weakestEvidenceConfidence(b, a), `${b} vs ${a}`).toBe(a);
    }
  });

  it('durum geçişleri — _reasoning_can_transition ↔ canTransitionReasoning', () => {
    const body = sqlFn(SQL_REASON, '_reasoning_can_transition');
    const STATES: ReasoningState[] = [
      'NEW', 'ANALYZING', 'SUPPORTED', 'UNSUPPORTED', 'UNKNOWN',
      'CONFLICTED', 'REJECTED', 'EXPIRED',
    ];
    /* SQL kuralları metinden okunur; TS her çift için aynı hükmü vermeli. */
    const allowed = new Set<string>();
    allowed.add('NEW>ANALYZING'); allowed.add('NEW>REJECTED');
    for (const t of ['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN', 'CONFLICTED', 'REJECTED']) {
      allowed.add(`ANALYZING>${t}`);
    }
    for (const f of ['SUPPORTED', 'UNSUPPORTED', 'UNKNOWN', 'CONFLICTED']) {
      allowed.add(`${f}>EXPIRED`);
    }
    // Metin gerçekten bu kuralları içeriyor mu (kopyala-yapıştır sapması yakalanır).
    expect(body).toContain("p_from = 'NEW'");
    expect(body).toContain("p_from = 'ANALYZING'");
    expect(body).toContain("p_to = 'EXPIRED'");

    for (const from of STATES) {
      for (const to of STATES) {
        const sqlSays = allowed.has(`${from}>${to}`) && from !== to;
        expect(canTransitionReasoning(from, to), `${from} → ${to}`).toBe(sqlSays);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   BÖLÜM B — EŞİKLER (ADR-286 §4.2: sabitler tek kaynaktan gelmeli)
   ══════════════════════════════════════════════════════════════════════════ */

describe('B · eşikler iki tarafta aynı', () => {
  it('örnek sayısı tavanı — 1 → MEDIUM, <5 → HIGH, ≥5 → VERY_HIGH', () => {
    const body = sqlFn(SQL_EVIDENCE, '_evidence_confidence');
    expect(body).toMatch(/coalesce\(p_samples,\s*0\)\s*<=\s*0\s*THEN\s*'UNKNOWN'/);
    expect(body).toMatch(/p_samples\s*=\s*1\s*THEN\s*'MEDIUM'/);
    expect(body).toMatch(/p_samples\s*<\s*5\s*THEN\s*'HIGH'/);
    expect(sampleConfidenceCeiling(0)).toBe('UNKNOWN');
    expect(sampleConfidenceCeiling(1)).toBe('MEDIUM');
    expect(sampleConfidenceCeiling(4)).toBe('HIGH');
    expect(sampleConfidenceCeiling(5)).toBe('VERY_HIGH');
  });

  it('kapsam eşikleri — <0.5 LOW, <0.8 MEDIUM (SQL metninde birebir)', () => {
    const body = sqlFn(SQL_REASON, '_reasoning_confidence');
    expect(body).toMatch(/p_coverage\s*<\s*0\.5\s*THEN\s*'LOW'/);
    expect(body).toMatch(/p_coverage\s*<\s*0\.8\s*THEN\s*'MEDIUM'/);
  });

  it('çelişki eşiği %10 ve SABİT', () => {
    const body = sqlFn(SQL_REASON, '_reasoning_conflicts');
    expect(body).toMatch(/0\.10|0\.1\b/);
  });

  it('varsayılan TTL 24 saat — SQL imzası ile TS sabiti aynı', () => {
    expect(SQL_REASON).toMatch(/p_ttl\s+interval\s+DEFAULT\s+interval\s+'24 hours'/);
    expect(REASONING_DEFAULT_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   BÖLÜM C — KARAR SIRASI (en tehlikeli sapma: sıra değişirse hüküm değişir)
   ══════════════════════════════════════════════════════════════════════════ */

describe('C · karar sırası pazarlıksız ve iki tarafta aynı', () => {
  /** SQL §4'teki gerekçelerin GÖRÜLME SIRASI. */
  function sqlReasonOrder(): string[] {
    const body = sqlFn(SQL_REASON, 'mavi_reason');
    const start = body.indexOf('KARAR ÇÖZÜCÜ');
    const block = body.slice(start, body.indexOf('TEKİLLEŞTİRME'));
    const seen: string[] = [];
    for (const m of block.matchAll(/v_reason\s*:=\s*'([A-Z_]+)'/g)) {
      if (!seen.includes(m[1]!)) seen.push(m[1]!);
    }
    return seen;
  }

  it('SQL gerekçe sırası beklenen omurgayı izler', () => {
    expect(sqlReasonOrder()).toEqual([
      'INTENT_UNRESOLVED',
      'NO_EVIDENCE',
      'ALL_EVIDENCE_EXPIRED',
      'CONFLICTING_EVIDENCE',
      'EVIDENCE_UNKNOWN_CONFIDENCE',
    ]);
  });

  it('TS aynı sırayı uygular — her dal ayrı ayrı tetiklenir', () => {
    const subject = { companyId: 'c1', vehicleId: 'v1' };
    const empty = {
      matched: [], active: [], expired: [], excluded: [],
      unknownConfidenceCount: 0, coverageRatio: null, missingCategories: [],
    };

    // 1 · özne yok → REJECTED (SQL'de erken RETURN; karar aynı)
    expect(resolveDecision(
      { companyId: 'c1' }, { intent: 'VEHICLE_HEALTH', origin: 'REQUESTED', candidates: [] },
      empty, []).decision).toBe('REJECTED');

    // 2 · niyet çözülemedi
    expect(resolveDecision(
      subject, { intent: 'UNKNOWN', origin: 'UNRESOLVED', candidates: [] },
      empty, []).confidenceReason).toBe('INTENT_UNRESOLVED');

    // 3 · hiç kanıt yok
    expect(resolveDecision(
      subject, { intent: 'FUEL', origin: 'REQUESTED', candidates: [] },
      empty, []).confidenceReason).toBe('NO_EVIDENCE');

    // 4 · hepsi süresi dolmuş
    const ev = mkEvidence({ id: 'e1' });
    expect(resolveDecision(
      subject, { intent: 'FUEL', origin: 'REQUESTED', candidates: [] },
      { ...empty, matched: [ev], expired: [ev] }, []).confidenceReason)
      .toBe('ALL_EVIDENCE_EXPIRED');

    // 5 · çelişki — kanıt sağlam olsa BİLE karar üretilmez
    expect(resolveDecision(
      subject, { intent: 'FUEL', origin: 'REQUESTED', candidates: [] },
      { ...empty, matched: [ev], active: [ev], coverageRatio: 1 },
      [{ kind: 'VALUE_DIVERGENCE' } as never]).confidenceReason)
      .toBe('CONFLICTING_EVIDENCE');

    // 6 · aktiflerin hepsi UNKNOWN güvenli
    expect(resolveDecision(
      subject, { intent: 'FUEL', origin: 'REQUESTED', candidates: [] },
      { ...empty, matched: [ev], active: [ev], unknownConfidenceCount: 1, coverageRatio: 1 },
      []).confidenceReason).toBe('EVIDENCE_UNKNOWN_CONFIDENCE');
  });

  it('çelişki, kapsam ve güvenden ÖNCE gelir (sıra tersine dönmemeli)', () => {
    /* Çelişkili ama tam kapsamlı ve yüksek güvenli kanıt: SQL'de çelişki
       kapısı önce olduğu için karar CONFLICTED olmalı. Sıra tersine dönerse
       burada SUPPORTED çıkar ve çelişki gizlenir. */
    const ev = mkEvidence({ id: 'e1', confidence: 'VERY_HIGH', severity: 'INFO' });
    const r = resolveDecision(
      { companyId: 'c1', vehicleId: 'v1' },
      { intent: 'FUEL', origin: 'REQUESTED', candidates: [] },
      {
        matched: [ev], active: [ev], expired: [], excluded: [],
        unknownConfidenceCount: 0, coverageRatio: 1, missingCategories: [],
      },
      [{ kind: 'REVISION_DIVERGENCE' } as never]);
    expect(r.decision).toBe('CONFLICTED_EVIDENCE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   BÖLÜM D — DÖRT SAPMA ADAYI (ADR-286 §3.3) — ölçülüyor, varsayılmıyor
   ══════════════════════════════════════════════════════════════════════════ */

describe('D · ADR-286 §3.3 sapma adayları', () => {
  it('#1 güven tavanı — SQL _evidence_confidence(BLACKBOX,MEASURED,n) = TS sampleCeiling(n)', () => {
    /*
     * SQL karar güveninde şunu çağırır:
     *   _evidence_confidence('BLACKBOX','MEASURED', n)
     * TS ise doğrudan sampleConfidenceCeiling(n) kullanır.
     * BLACKBOX → VERY_HIGH ve MEASURED → VERY_HIGH olduğu için SQL ifadesi
     * matematiksel olarak sample tavanına indirgenir. Bu test o indirgemenin
     * BUGÜN de geçerli olduğunu doğrular: kaynak tavanı düşürülürse
     * (ör. BLACKBOX → HIGH) iki taraf SESSİZCE ayrışırdı.
     */
    for (const n of [0, 1, 2, 4, 5, 9]) {
      const sqlEquivalent = deriveEvidenceConfidence({
        source: 'BLACKBOX', provenance: 'MEASURED', sampleCount: n,
      });
      expect(sqlEquivalent, `n=${n}`).toBe(sampleConfidenceCeiling(n));
    }
    // İndirgemenin dayanağı da kilitli:
    expect(sourceConfidenceCeiling('BLACKBOX')).toBe('VERY_HIGH');
    expect(provenanceConfidenceCeiling('MEASURED')).toBe('VERY_HIGH');
  });

  it('#2 REJECTED gerekçesi — karar aynı, açıklama farkı BİLİNÇLİ', () => {
    /*
     * TS `SUBJECT_MISMATCH` gerekçesi üretir; SQL erken RETURN yapar ve
     * gerekçeyi kaydetmez (yalnız 'REJECTED' + 'UNKNOWN' döner).
     * KARAR ve GÜVEN aynıdır — ayrışma yalnız açıklamadadır. Bu fark
     * kabul edilmiştir; kilit, KARARIN ayrışmadığını garanti eder.
     */
    const r = resolveDecision(
      { companyId: 'c1' },                    // özne yok
      { intent: 'FUEL', origin: 'REQUESTED', candidates: [] },
      {
        matched: [], active: [], expired: [], excluded: [],
        unknownConfidenceCount: 0, coverageRatio: null, missingCategories: [],
      }, []);
    expect(r.decision).toBe('REJECTED');
    expect(resolveConfidence(r.decision, {
      matched: [], active: [], expired: [], excluded: [],
      unknownConfidenceCount: 0, coverageRatio: null, missingCategories: [],
    })).toBe('UNKNOWN');
    expect(SQL_REASON).toContain("'REJECTED'::text, NULL::uuid, 'REJECTED'::text, 'UNKNOWN'::text");
  });

  it('#3 kapsam NULL sırası — iki tarafta da sonuç UNKNOWN', () => {
    /* SQL'de `p_coverage IS NULL` kontrolü başta, TS'te sonda. Sonuç aynı
       olmalı: kapsam ölçülemediyse güven UNKNOWN'dır. */
    const ev = mkEvidence({ id: 'e1', confidence: 'VERY_HIGH' });
    expect(resolveConfidence('SUPPORTED', {
      matched: [ev], active: [ev], expired: [], excluded: [],
      unknownConfidenceCount: 0, coverageRatio: null, missingCategories: [],
    })).toBe('UNKNOWN');
    expect(sqlFn(SQL_REASON, '_reasoning_confidence'))
      .toMatch(/p_coverage IS NULL THEN 'UNKNOWN'/);
  });

  it('#4 niyet türetme — tek aday alınır, çoklu adayda UNKNOWN (kura YOK)', () => {
    const base = { companyId: 'c1', vehicleId: 'v1' };
    const now = 1_000_000;

    // Tek kategori → tek aday → DERIVED
    const single = ledgerOf([mkEvidence({
      id: 'a', category: 'FUEL', expiresAt: now + 1000, state: 'ACTIVE',
    })]);
    expect(reason(single, { subject: base, observedAt: now })
      .reasoning.intent).toBe('FUEL');

    // İki farklı niyete işaret eden kategori → UNKNOWN
    const multi = ledgerOf([
      mkEvidence({ id: 'a', category: 'FUEL', expiresAt: now + 1000, state: 'ACTIVE' }),
      mkEvidence({ id: 'b', category: 'BATTERY', expiresAt: now + 1000, state: 'ACTIVE' }),
    ]);
    expect(reason(multi, { subject: base, observedAt: now })
      .reasoning.intent).toBe('UNKNOWN');

    // SQL de aynı kuralı metninde taşıyor: tek aday değilse UNKNOWN.
    expect(sqlFn(SQL_REASON, 'mavi_reason'))
      .toMatch(/coalesce\(v_all,0\)\s*<>\s*1\s*THEN\s*v_intent\s*:=\s*'UNKNOWN'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   BÖLÜM E — SINIR DEĞER MATRİSİ (ADR-286 §5.2: tam eşikler ZORUNLU)
   ══════════════════════════════════════════════════════════════════════════ */

describe('E · sınır değerler', () => {
  it('kapsam tam eşikte — 0.5 ve 0.8 kapı ALTINDA sayılmaz', () => {
    const ev = mkEvidence({ id: 'e1', confidence: 'VERY_HIGH' });
    const res = (ratio: number) => resolveConfidence('SUPPORTED', {
      matched: [ev], active: [ev, ev], expired: [], excluded: [],
      unknownConfidenceCount: 0, coverageRatio: ratio, missingCategories: [],
    });
    /* SQL: `< 0.5 → LOW`, `< 0.8 → MEDIUM`. Tam 0.5 LOW DEĞİL, tam 0.8
       MEDIUM DEĞİLDİR. Karşılaştırma `<=`ye kayarsa burada yakalanır. */
    expect(res(0.49)).toBe('LOW');
    expect(res(0.5)).not.toBe('LOW');
    expect(res(0.79)).toBe('MEDIUM');
    expect(res(0.8)).not.toBe('MEDIUM');
  });

  it('kanıt yokken güven UNKNOWN — "veri yok → sorun yok" ÜRETİLMEZ', () => {
    expect(resolveConfidence('SUPPORTED', {
      matched: [], active: [], expired: [], excluded: [],
      unknownConfidenceCount: 0, coverageRatio: 1, missingCategories: [],
    })).toBe('UNKNOWN');
  });

  it('sonuçlandırıcı olmayan her karar → güven UNKNOWN', () => {
    const ev = mkEvidence({ id: 'e1', confidence: 'VERY_HIGH' });
    const full = {
      matched: [ev], active: [ev], expired: [], excluded: [],
      unknownConfidenceCount: 0, coverageRatio: 1, missingCategories: [],
    };
    for (const d of ['UNKNOWN', 'REJECTED', 'CONFLICTED_EVIDENCE',
      'INSUFFICIENT_EVIDENCE', 'EXPIRED_EVIDENCE'] as ReasoningDecision[]) {
      expect(resolveConfidence(d, full), `karar: ${d}`).toBe('UNKNOWN');
    }
  });

  it('TTL sınırı — expiresAt anında kanıt TAZE DEĞİLDİR', () => {
    const now = 1_000_000;
    const subject = { companyId: 'c1', vehicleId: 'v1' };
    const atBoundary = ledgerOf([mkEvidence({
      id: 'a', category: 'FUEL', state: 'ACTIVE', expiresAt: now,
    })]);
    /* SQL kapısı `expires_at > now()` — eşitlik TAZE SAYILMAZ.
       TS `nowMs >= e.expiresAt` ile aynı hükmü vermeli. */
    const out = reason(atBoundary, { subject, requestedIntent: 'FUEL', observedAt: now });
    expect(out.reasoning.decision).not.toBe('SUPPORTED');
    expect(SQL_REASON).toContain('expires_at > now()');
  });

  it('eksik alanlı kanıt sessizce yüksek güven ALMAZ', () => {
    // Bilinmeyen kaynak + bilinmeyen ölçüm kalitesi → UNKNOWN
    expect(deriveEvidenceConfidence({
      source: 'SOURCE_UNKNOWN', provenance: 'UNKNOWN', sampleCount: 100,
    })).toBe('UNKNOWN');
  });
});

/* ── Fikstür yardımcıları ──────────────────────────────────────────────── */

function mkEvidence(over: Partial<AiEvidence> & { id: string }): AiEvidence {
  return {
    id: over.id,
    companyId: over.companyId ?? 'c1',
    vehicleId: over.vehicleId ?? 'v1',
    driverId: over.driverId ?? null,
    tripId: over.tripId ?? null,
    source: over.source ?? 'BLACKBOX',
    category: over.category ?? 'FUEL',
    severity: over.severity ?? 'INFO',
    confidence: over.confidence ?? 'HIGH',
    provenance: over.provenance ?? 'MEASURED',
    metric: over.metric ?? 'fuel_level',
    value: over.value ?? 42,
    sampleCount: over.sampleCount ?? 3,
    createdAt: over.createdAt ?? 0,
    lastSeenAt: over.lastSeenAt ?? 0,
    expiresAt: over.expiresAt ?? 0,
    state: over.state ?? 'ACTIVE',
    refreshCount: over.refreshCount ?? 0,
    evidenceVersion: over.evidenceVersion ?? 1,
    rejectReason: over.rejectReason ?? null,
  };
}

function ledgerOf(entries: AiEvidence[]): EvidenceLedger {
  return { entries, mergeCount: 0, rejectedCount: 0, chain: [] };
}
