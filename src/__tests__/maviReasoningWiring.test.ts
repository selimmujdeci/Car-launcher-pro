/**
 * maviReasoningWiring.test.ts — ÜRETİM AKIŞI BAĞLANTISI P1 KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **12 gerçek olay** karar motoruna bağlı ve TS/SQL eşlemesi AYNI.
 *  2. **Varsayılan resolver YOKTUR** — eşlenmemiş niyet kuyruğa giremez.
 *  3. **Bounded dedupe:** aynı özne+niyet için tek açık iş.
 *  4. **Resolver KARAR ÜRETMEZ** — yalnız özne seçer ve yönlendirir.
 *  5. **Hata sessizce yutulmaz** — durum kümesi bounded.
 *  6. **Ölçülemeyen süre `null`'dır**, `0` değil.
 *  7. **Hot-path korunur:** yüksek frekanslı olaylar senkron karar üretmez.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REASONING_EVENT_TYPES, REASONING_RESOLVERS, REASONING_EVENT_STATES,
  EVENT_SKIP_REASONS, REASONING_MAX_ATTEMPTS, QUEUE_BACKLOG_LIMIT,
  EMPTY_QUEUE_SNAPSHOT,
  averageOrNull, eventDedupeKey, eventSkipReasonLabel, eventTiming,
  intentForEvent, isOpenEventState, isReasoningEventType,
  reasoningEventStateLabel, reasoningEventTypeLabel, reasoningResolverLabel,
  resolverForIntent, summarizeQueue,
  type ReasoningEvent,
} from '../platform/reasoning/maviReasoningQueue';
import { REASONING_INTENTS } from '../platform/reasoning/maviReasoning';

const SQL = readFileSync(
  join(process.cwd(),
    'supabase/migrations/20260801000058_mavi_reasoning_production_wiring_p1.sql'),
  'utf8');

/* ══════════════════════════════════════════════════════════════════════ */
describe('A · Olay kümesi (12 gerçek olay)', () => {
  it('A1. tam olarak 12 olay tanımlı', () => {
    expect(REASONING_EVENT_TYPES).toHaveLength(12);
  });

  it('A2. 🔒 TS ve SQL olay kümesi AYNI', () => {
    for (const e of REASONING_EVENT_TYPES) {
      expect(SQL, `SQL'de eksik olay: ${e}`).toContain(`'${e}'`);
    }
  });

  it('A3. 🔒 her olay için bir SQL trigger kurulu', () => {
    for (const t of ['trg_reasoning_trip', 'trg_reasoning_dna',
      'trg_reasoning_insight', 'trg_reasoning_identity',
      'trg_reasoning_connectivity', 'trg_reasoning_location',
      'trg_reasoning_auth', 'trg_reasoning_presence',
      'trg_reasoning_health', 'trg_reasoning_evidence']) {
      expect(SQL, `SQL'de eksik trigger: ${t}`).toContain(`CREATE TRIGGER ${t}`);
    }
  });

  it('A4. tip koruması yabancı olayı reddeder', () => {
    expect(isReasoningEventType('TRIP_COMPLETED')).toBe(true);
    expect(isReasoningEventType('SOMETHING_NEW')).toBe(false);
  });

  it('A5. her olay ve durum için Türkçe etiket var', () => {
    for (const e of REASONING_EVENT_TYPES) {
      expect(reasoningEventTypeLabel(e).length).toBeGreaterThan(0);
    }
    for (const s of REASONING_EVENT_STATES) {
      expect(reasoningEventStateLabel(s).length).toBeGreaterThan(0);
    }
    for (const r of REASONING_RESOLVERS) {
      expect(reasoningResolverLabel(r).length).toBeGreaterThan(0);
    }
    for (const r of EVENT_SKIP_REASONS) {
      expect(eventSkipReasonLabel(r).length).toBeGreaterThan(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('B · Olay → niyet eşlemesi', () => {
  it('B1. sabit eşlemeler doğru', () => {
    expect(intentForEvent('TRIP_COMPLETED')).toBe('TRIP_STATUS');
    expect(intentForEvent('DRIVER_DNA_UPDATED')).toBe('DRIVER');
    expect(intentForEvent('FLEET_INSIGHT_CREATED')).toBe('FLEET');
    expect(intentForEvent('VEHICLE_IDENTITY_CHANGED')).toBe('VEHICLE_HEALTH');
    expect(intentForEvent('VEHICLE_CONNECTIVITY_CHANGED')).toBe('CONNECTIVITY');
    expect(intentForEvent('LOCATION_STATE_CHANGED')).toBe('LOCATION');
    expect(intentForEvent('DRIVER_AUTHENTICATION_CHANGED')).toBe('DRIVER');
    expect(intentForEvent('DRIVER_PRESENCE_CHANGED')).toBe('DRIVER');
    expect(intentForEvent('HEALTH_SNAPSHOT_UPDATED')).toBe('FLEET');
  });

  it('B2. 🔒 kanıt olayı niyeti KANITIN kategorisinden alır', () => {
    expect(intentForEvent('EVIDENCE_ADDED', 'TEMPERATURE')).toBe('TEMPERATURE');
    expect(intentForEvent('EVIDENCE_EXPIRED', 'BLACKBOX')).toBe('DIAGNOSTIC');
    expect(intentForEvent('EVIDENCE_RETRACTED', 'FUEL')).toBe('FUEL');
  });

  it('B3. 🔒 kategori yoksa/tanınmıyorsa niyet YUVARLANMAZ → UNKNOWN', () => {
    expect(intentForEvent('EVIDENCE_ADDED')).toBe('UNKNOWN');
    expect(intentForEvent('EVIDENCE_ADDED', null)).toBe('UNKNOWN');
    expect(intentForEvent('EVIDENCE_ADDED', 'NOT_A_CATEGORY')).toBe('UNKNOWN');
    expect(intentForEvent('EVIDENCE_ADDED', 'UNKNOWN')).toBe('UNKNOWN');
  });

  it('B4. 🔒 TS ve SQL olay→niyet eşlemesi AYNI', () => {
    const pairs: readonly [string, string][] = [
      ['TRIP_COMPLETED', 'TRIP_STATUS'],
      ['DRIVER_DNA_UPDATED', 'DRIVER'],
      ['FLEET_INSIGHT_CREATED', 'FLEET'],
      ['VEHICLE_IDENTITY_CHANGED', 'VEHICLE_HEALTH'],
      ['VEHICLE_CONNECTIVITY_CHANGED', 'CONNECTIVITY'],
      ['LOCATION_STATE_CHANGED', 'LOCATION'],
      ['DRIVER_AUTHENTICATION_CHANGED', 'DRIVER'],
      ['DRIVER_PRESENCE_CHANGED', 'DRIVER'],
      ['HEALTH_SNAPSHOT_UPDATED', 'FLEET'],
    ];
    for (const [event, intent] of pairs) {
      const re = new RegExp(`WHEN '${event}'\\s+THEN '${intent}'`);
      expect(SQL, `SQL eşlemesi farklı: ${event}`).toMatch(re);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('C · Niyet → resolver (VARSAYILAN RESOLVER YASAK)', () => {
  it('C1. 🔒 057\'nin BÜTÜN niyetleri bir resolver\'a eşlenmiş', () => {
    for (const i of REASONING_INTENTS) {
      expect(resolverForIntent(i), `eşlenmemiş niyet: ${i}`).not.toBeNull();
    }
  });

  it('C2. resolver eşlemesi doğru', () => {
    expect(resolverForIntent('VEHICLE_HEALTH')).toBe('VEHICLE');
    expect(resolverForIntent('ENGINE')).toBe('VEHICLE');
    expect(resolverForIntent('TEMPERATURE')).toBe('VEHICLE');
    expect(resolverForIntent('BATTERY')).toBe('VEHICLE');
    expect(resolverForIntent('CONNECTIVITY')).toBe('VEHICLE');
    expect(resolverForIntent('DRIVER')).toBe('DRIVER');
    expect(resolverForIntent('TRIP_STATUS')).toBe('TRIP');
    expect(resolverForIntent('LOCATION')).toBe('TRIP');
    expect(resolverForIntent('FUEL')).toBe('TRIP');
    expect(resolverForIntent('FLEET')).toBe('FLEET');
    expect(resolverForIntent('DIAGNOSTIC')).toBe('DIAGNOSTIC');
    expect(resolverForIntent('UNKNOWN')).toBe('UNKNOWN');
  });

  it('C3. 🔒 TS ve SQL resolver eşlemesi AYNI', () => {
    for (const i of REASONING_INTENTS) {
      const r = resolverForIntent(i);
      const re = new RegExp(`WHEN '${i}'\\s+THEN '${r}'`);
      expect(SQL, `SQL resolver eşlemesi farklı: ${i}`).toMatch(re);
    }
  });

  it('C4. 🔒 SQL tarafında da VARSAYILAN RESOLVER YOK', () => {
    /* Eşlenmemiş niyet `NULL` dönmeli — bir resolver'a düşmemeli. */
    const fn = SQL.slice(
      SQL.indexOf('FUNCTION public._reasoning_resolver_for_intent'),
      SQL.indexOf('-- ── 4. KUYRUĞA ALMA'));
    expect(fn).toMatch(/ELSE NULL END/);
    expect(fn).not.toMatch(/ELSE '[A-Z]+' END/);
  });

  it('C5. 🔒 eşlenmemiş niyet kuyruğa GİREMEZ (SQL kapısı)', () => {
    expect(SQL).toMatch(/IF v_resolver IS NULL THEN[\s\S]{0,200}'REJECTED'/);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('D · Bounded dedupe', () => {
  it('D1. anahtar = şirket + niyet + özne', () => {
    const k = eventDedupeKey({
      companyId: 'co-1', intent: 'TEMPERATURE', vehicleId: 'veh-1',
    });
    expect(k).toBe('co-1|TEMPERATURE|veh-1|-|-');
  });

  it('D2. 🔒 OLAY TİPİ anahtara DÂHİL DEĞİL', () => {
    /* Aynı soru iki farklı olaydan gelirse tek kez sorulmalı. */
    const a = eventDedupeKey({
      companyId: 'co-1', intent: 'TEMPERATURE', vehicleId: 'veh-1',
    });
    const b = eventDedupeKey({
      companyId: 'co-1', intent: 'TEMPERATURE', vehicleId: 'veh-1',
      driverId: null, tripId: null,
    });
    expect(b).toBe(a);
    expect(a).not.toContain('EVIDENCE_ADDED');
    expect(a).not.toContain('TRIP_COMPLETED');
  });

  it('D3. farklı niyet AYRI iştir', () => {
    const a = eventDedupeKey({ companyId: 'co-1', intent: 'TEMPERATURE', vehicleId: 'v' });
    const b = eventDedupeKey({ companyId: 'co-1', intent: 'FUEL', vehicleId: 'v' });
    expect(b).not.toBe(a);
  });

  it('D4. farklı şirket AYRI iştir (cross-tenant)', () => {
    const a = eventDedupeKey({ companyId: 'co-1', intent: 'FLEET', vehicleId: 'v' });
    const b = eventDedupeKey({ companyId: 'co-2', intent: 'FLEET', vehicleId: 'v' });
    expect(b).not.toBe(a);
  });

  it('D5. 🔒 SQL dedupe anahtarı TS ile aynı biçimde', () => {
    expect(SQL).toMatch(
      /concat_ws\('\|', p_company_id::text, v_intent,[\s\S]{0,200}p_trip_id::text,'-'\)\)/);
  });

  it('D6. 🔒 açık iş penceresi PENDING/RUNNING/RETRY_PENDING', () => {
    expect(isOpenEventState('PENDING')).toBe(true);
    expect(isOpenEventState('RUNNING')).toBe(true);
    expect(isOpenEventState('RETRY_PENDING')).toBe(true);
    for (const s of ['COMPLETED', 'FAILED', 'REJECTED', 'SKIPPED', 'DEDUPED'] as const) {
      expect(isOpenEventState(s)).toBe(false);
    }
    /* SQL kısmi indeksi aynı pencereyi kullanmalı. */
    expect(SQL).toMatch(
      /WHERE state IN \('PENDING','RUNNING','RETRY_PENDING'\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('E · Gecikme ölçümü', () => {
  it('E1. 🔒 başlamamış iş için kuyruk süresi `null` (0 DEĞİL)', () => {
    expect(eventTiming({ enqueuedAtMs: 100, startedAtMs: null, finishedAtMs: null }))
      .toEqual({ queueMs: null, decisionMs: null });
  });

  it('E2. 🔒 bitmemiş iş için karar süresi `null`', () => {
    expect(eventTiming({ enqueuedAtMs: 100, startedAtMs: 150, finishedAtMs: null }))
      .toEqual({ queueMs: 50, decisionMs: null });
  });

  it('E3. tamamlanan iş için iki süre de ölçülür', () => {
    expect(eventTiming({ enqueuedAtMs: 100, startedAtMs: 150, finishedAtMs: 400 }))
      .toEqual({ queueMs: 50, decisionMs: 250 });
  });

  it('E4. saat geri giderse negatif süre üretilmez', () => {
    expect(eventTiming({ enqueuedAtMs: 500, startedAtMs: 100, finishedAtMs: 50 }))
      .toEqual({ queueMs: 0, decisionMs: 0 });
  });

  it('E5. 🔒 ölçüm yoksa ortalama `null` (sahte 0 YOK)', () => {
    expect(averageOrNull([])).toBeNull();
    expect(averageOrNull([null, null])).toBeNull();
    expect(averageOrNull([10, null, 20])).toBe(15);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('F · Kuyruk özeti', () => {
  function ev(over: Partial<ReasoningEvent> = {}): ReasoningEvent {
    return {
      id: 'e-1', companyId: 'co-1', eventType: 'TRIP_COMPLETED',
      intent: 'TRIP_STATUS', resolver: 'TRIP', state: 'COMPLETED',
      attempts: 1, suppressedCount: 0, reasoningId: 'r-1', skipReason: null,
      queueMs: 10, decisionMs: 30, ...over,
    };
  }

  it('F1. boş kuyruk sağlıklıdır', () => {
    expect(summarizeQueue([])).toMatchObject({
      healthy: true, avgQueueMs: null, avgDecisionMs: null,
    });
    expect(EMPTY_QUEUE_SNAPSHOT.healthy).toBe(true);
  });

  it('F2. 🔒 TEK bir düşen iş kuyruğu SAĞLIKSIZ yapar', () => {
    const q = summarizeQueue([ev(), ev({ id: 'e-2', state: 'FAILED' })]);
    expect(q.failed).toBe(1);
    expect(q.healthy).toBe(false);
  });

  it('F3. 🔒 SKIPPED ve DEDUPED kuyruğu sağlıksız YAPMAZ', () => {
    const q = summarizeQueue([
      ev({ id: 'a', state: 'SKIPPED', skipReason: 'NO_DRIVER_SUBJECT' }),
      ev({ id: 'b', state: 'DEDUPED' }),
    ]);
    expect(q.healthy).toBe(true);
    expect(q.skipped).toBe(1);
    expect(q.deduped).toBe(1);
  });

  it('F4. birikme eşiği aşılınca sağlıksız', () => {
    const many = Array.from({ length: QUEUE_BACKLOG_LIMIT + 1 }, (_, i) =>
      ev({ id: `p-${i}`, state: 'PENDING', queueMs: null, decisionMs: null }));
    expect(summarizeQueue(many).healthy).toBe(false);
  });

  it('F5. bastırılan tekrarlar toplanır (sessizce yutulmaz)', () => {
    const q = summarizeQueue([
      ev({ suppressedCount: 20 }), ev({ id: 'e-2', suppressedCount: 5 }),
    ]);
    expect(q.suppressedTotal).toBe(25);
  });

  it('F6. ortalama süreler yalnız ölçülenlerden hesaplanır', () => {
    const q = summarizeQueue([
      ev({ queueMs: 10, decisionMs: 100 }),
      ev({ id: 'e-2', state: 'PENDING', queueMs: null, decisionMs: null }),
    ]);
    expect(q.avgQueueMs).toBe(10);
    expect(q.avgDecisionMs).toBe(100);
  });

  it('F7. deneme tavanı SINIRLI', () => {
    expect(REASONING_MAX_ATTEMPTS).toBe(5);
    expect(SQL).toMatch(/attempts >= 5/);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('G · 🔒 KAYNAK KİLİTLERİ (statik)', () => {
  const QUEUE_TS = readFileSync(
    join(process.cwd(), 'src/platform/reasoning/maviReasoningQueue.ts'), 'utf8');

  it('G1. 🔒 kuyruk katmanı SAF ve LLM\'siz', () => {
    const code = QUEUE_TS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/openrouter|gemini|anthropic|openai/i);
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/setTimeout|setInterval/);
    expect(code).not.toMatch(/supabase|localStorage/i);
    expect(code).not.toMatch(/from ['"]react['"]/);
  });

  it('G2. 🔒 kuyruk katmanı KARAR MANTIĞI taşımaz', () => {
    /* Karar 057'de üretilir; burada eşik/güven/çelişki mantığı olamaz. */
    expect(QUEUE_TS).not.toMatch(/resolveDecision|resolveConfidence|resolveConflicts/);
    expect(QUEUE_TS).not.toMatch(/SUPPORTED|UNSUPPORTED|CONFLICTED_EVIDENCE/);
  });

  it('G3. 🔒 SQL resolver\'ı KARAR ÜRETMEZ (ikinci otorite yok)', () => {
    const fn = SQL.slice(
      SQL.indexOf('FUNCTION public._reasoning_resolve('),
      SQL.indexOf('-- ── 6. DISPATCHER'));
    expect(fn).toContain('mavi_reason(');
    /* Karar mantığı kopyalanmamalı. */
    expect(fn).not.toMatch(/ai_evidence/);
    expect(fn).not.toMatch(/_reasoning_confidence|_reasoning_conflicts/);
    expect(fn).not.toMatch(/severity|confidence\s*=/i);
  });

  it('G4. 🔒 HOT-PATH korunuyor: konum/bağlantı senkron karar üretmez', () => {
    const conn = SQL.slice(
      SQL.indexOf('FUNCTION public._reasoning_connectivity_trigger'),
      SQL.indexOf('FUNCTION public._reasoning_location_trigger'));
    const loc = SQL.slice(
      SQL.indexOf('FUNCTION public._reasoning_location_trigger'),
      SQL.indexOf('/* 8.7'));
    /* İkisi de `p_dispatch_now = false` ile çağırmalı. */
    expect(conn).toMatch(/NULL, false\)/);
    expect(loc).toMatch(/NULL, false\)/);
    /* Ve yalnız gerçek durum geçişinde olay üretmeli. */
    expect(conn).toMatch(/interval '10 minutes'/);
    expect(loc).toMatch(/interval '10 minutes'/);
  });

  it('G5. 🔒 kuyruk İSTEMCİYE kapalı', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.run_mavi_reasoning_queue\(integer\)\s*\n?\s*FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT SELECT ON TABLE public\.mavi_reasoning_event TO authenticated/);
    expect(SQL).not.toMatch(
      /GRANT (INSERT|UPDATE|DELETE)[^;]*mavi_reasoning_event[^;]*authenticated/);
  });

  it('G6. 🔒 hata yalıtımı var (ana işlem bozulmaz)', () => {
    const fn = SQL.slice(
      SQL.indexOf('FUNCTION public._reasoning_wire_safely'),
      SQL.indexOf('-- ── 8. GERÇEK OLAY'));
    expect(fn).toMatch(/EXCEPTION WHEN OTHERS/);
  });

  it('G7. 🔒 057 ve 055/054/053 fonksiyonları YENİDEN TANIMLANMADI', () => {
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.mavi_reason\(/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\._reasoning_confidence/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\._ai_evidence_record/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\._dna_/);
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\._fleet_insight/);
  });

  it('G8. 🔒 LAB ekranı kuyruğu gösteriyor ve SALT-OKUNUR kalıyor', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/MaviReasoningEngineScreen.tsx'), 'utf8');
    expect(SCREEN).toMatch(/Live Event Queue/);
    expect(SCREEN).toMatch(/avgQueueTime/);
    expect(SCREEN).toMatch(/avgDecisionTime/);
    expect(SCREEN).toMatch(/suppressedEvents/);
    /* Aktif komut hâlâ YOK. */
    expect(SCREEN).not.toMatch(/setInterval|setTimeout|addEventListener/);
    expect(SCREEN).not.toMatch(/\bfetch\s*\(/);
    expect(SCREEN).not.toMatch(/run_mavi_reasoning_queue|_reasoning_dispatch/);
  });
});
