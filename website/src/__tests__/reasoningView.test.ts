/**
 * reasoningView.test.ts — FLEET DASHBOARD KARAR KARTLARI KİLİTLERİ.
 *
 * ── KİLİTLENEN KURALLAR ────────────────────────────────────────────────
 *  1. Karar yoksa BOŞ KART değil, GEREKÇE.
 *  2. Bilinmeyen değer `null` — **`0` DEĞİL**.
 *  3. Çelişki ve bilinmezlik GİZLENMEZ (ayrı kartları var).
 *  4. **İkinci otorite YOK** — bu katman karar/güven ÜRETMEZ, yalnız gösterir.
 *  5. Bozuk satır SESSİZCE UYDURULMAZ.
 *  6. Kişisel veri (ad · plaka · VIN · konum) TAŞINMAZ.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EMPTY_QUEUE_VIEW, EMPTY_REASONING_VIEW,
  buildReasoningItems, buildReasoningQueueView, buildReasoningView,
  buildSchedulerView, queueAbsenceExplanation, reasoningAbsenceExplanation,
  reasoningDecisionExplanation, schedulerAbsenceExplanation,
  type ReasoningQueueRow, type ReasoningSummaryRow, type RecentReasoningRow,
  type SchedulerHealthRow,
} from '@/lib/fleet/reasoningView';

function summary(over: Partial<ReasoningSummaryRow> = {}): ReasoningSummaryRow {
  return {
    company_id: 'co-1',
    reasoning_total: 10, valid_count: 8, expired_count: 2,
    supported_count: 4, unsupported_count: 2,
    conflicted_count: 1, unknown_count: 1,
    insufficient_count: 1, expired_evidence_count: 1, rejected_count: 0,
    duplicate_count: 3, invalid_transition_count: 0, rejected_request_count: 0,
    evidence_ref_total: 24, chain_node_total: 40,
    high_confidence_ratio: 0.5, conclusive_ratio: 0.6,
    newest_decision_age_seconds: 120, oldest_decision_age_seconds: 86_400,
    integrity_ok: true,
    ...over,
  };
}

describe('A · Yokluk dürüstlüğü', () => {
  it('A1. satır yoksa NO_ROW ve kart YOK', () => {
    const v = buildReasoningView(null);
    expect(v).toEqual(EMPTY_REASONING_VIEW);
    expect(v.cards).toHaveLength(0);
    expect(reasoningAbsenceExplanation(v)).toContain('bulunamadı');
  });

  it('A2. 🔒 karar yoksa BOŞ KART değil GEREKÇE', () => {
    const v = buildReasoningView(summary({ reasoning_total: 0 }));
    expect(v.present).toBe(false);
    expect(v.absentReason).toBe('NO_DECISION');
    expect(v.cards).toHaveLength(0);
    expect(reasoningAbsenceExplanation(v)).toContain('Karar kanıta dayanır');
  });

  it('A3. karar yokken bile bastırılan tekrar sayısı korunur', () => {
    const v = buildReasoningView(summary({ reasoning_total: 0, duplicate_count: 7 }));
    expect(v.duplicateSuppressed).toBe(7);
  });

  it('A4. karar varsa gerekçe YOKTUR', () => {
    expect(reasoningAbsenceExplanation(buildReasoningView(summary()))).toBeNull();
  });
});

describe('B · Kart içeriği', () => {
  it('B1. beş kart üretilir (son kararlar · güven · kanıt · çakışma · bilinmeyen)', () => {
    const v = buildReasoningView(summary());
    expect(v.cards.map((c) => c.key)).toEqual(
      ['RECENT', 'CONFIDENCE', 'EVIDENCE', 'CONFLICT', 'UNKNOWN']);
  });

  it('B2. 🔒 çelişki ve bilinmezlik DİKKAT işaretlenir (gizlenmez)', () => {
    const v = buildReasoningView(summary());
    expect(v.cards.find((c) => c.key === 'CONFLICT')?.attention).toBe(true);
    expect(v.cards.find((c) => c.key === 'UNKNOWN')?.attention).toBe(true);
  });

  it('B3. çelişki yoksa dikkat çekilmez ve dürüst yazılır', () => {
    const v = buildReasoningView(summary({ conflicted_count: 0 }));
    const c = v.cards.find((x) => x.key === 'CONFLICT');
    expect(c?.attention).toBe(false);
    expect(c?.detail).toBe('Çelişkili kanıt yok');
  });

  it('B4. 🔒 "bilmiyorum"un ÜÇ biçimi toplanır ama gerekçeleri AYRI kalır', () => {
    const v = buildReasoningView(summary({
      unknown_count: 2, insufficient_count: 3, expired_evidence_count: 4,
    }));
    expect(v.unknownCount).toBe(9);
    const detail = v.cards.find((c) => c.key === 'UNKNOWN')?.detail ?? '';
    expect(detail).toContain('3 kanıt yetersiz');
    expect(detail).toContain('4 kanıt süresi dolmuş');
    expect(detail).toContain('2 niyet/güven çözülemedi');
  });

  it('B5. 🔒 bilinmeyen oran `null` — 0 DEĞİL', () => {
    const v = buildReasoningView(summary({
      high_confidence_ratio: null, conclusive_ratio: null,
    }));
    expect(v.highConfidenceRatio).toBeNull();
    const c = v.cards.find((x) => x.key === 'CONFIDENCE');
    expect(c?.value).toBeNull();
    expect(c?.known).toBe(false);
    expect(c?.detail).toContain('bilinmiyor');
  });

  it('B6. numeric string oranlar sayıya çevrilir (PostgREST davranışı)', () => {
    const v = buildReasoningView(summary({ high_confidence_ratio: '0.75' }));
    expect(v.cards.find((c) => c.key === 'CONFIDENCE')?.value).toBe(75);
  });

  it('B7. kanıt kartı "kanıtsız karar olamaz" ilkesini yazar', () => {
    const v = buildReasoningView(summary());
    expect(v.cards.find((c) => c.key === 'EVIDENCE')?.detail)
      .toContain('kanıtsız karar sonuçlandırıcı olamaz');
  });

  it('B8. süresi dolmuş karar sayısı GİZLENMEZ', () => {
    const v = buildReasoningView(summary({ expired_count: 5 }));
    expect(v.expiredCount).toBe(5);
    expect(v.cards.find((c) => c.key === 'RECENT')?.detail).toContain('5 süresi dolmuş');
  });
});

describe('C · Bütünlük', () => {
  it('C1. bütünlük bayrağı taşınır', () => {
    expect(buildReasoningView(summary({ integrity_ok: false })).integrityOk).toBe(false);
    expect(buildReasoningView(summary({ integrity_ok: true })).integrityOk).toBe(true);
  });

  it('C2. 🔒 bilinmeyen bütünlük `null` — "sağlam" VARSAYILMAZ', () => {
    expect(buildReasoningView(summary({ integrity_ok: null })).integrityOk).toBeNull();
  });

  it('C3. geçersiz durum geçişi sayısı taşınır', () => {
    expect(buildReasoningView(summary({ invalid_transition_count: 2 })).invalidTransitions)
      .toBe(2);
  });
});

describe('D · Son kararlar listesi', () => {
  const rows: RecentReasoningRow[] = [
    {
      reasoning_id: 'r-1', intent: 'ENGINE', decision: 'SUPPORTED',
      confidence: 'HIGH', confidence_reason: 'WEAKEST_EVIDENCE_LINK',
      state: 'SUPPORTED', evidence_count: 3, conflict_count: 0,
      coverage_ratio: '1', vehicle_id: 'veh-abcdef123456',
      decision_age_seconds: 90,
    },
    {
      reasoning_id: 'r-2', intent: 'FUEL', decision: 'CONFLICTED_EVIDENCE',
      confidence: 'UNKNOWN', confidence_reason: 'CONFLICTING_EVIDENCE',
      state: 'CONFLICTED', evidence_count: 2, conflict_count: 1,
      coverage_ratio: null, driver_id: 'drv-999888777',
      decision_age_seconds: null,
    },
  ];

  it('D1. satırlar listeye çevrilir', () => {
    const items = buildReasoningItems(rows);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'r-1', conclusive: true });
    expect(items[1]).toMatchObject({ id: 'r-2', conclusive: false, conflictCount: 1 });
  });

  it('D2. 🔒 BOZUK satır sessizce UYDURULMAZ, atlanır', () => {
    const items = buildReasoningItems([
      { reasoning_id: null, intent: 'ENGINE', decision: 'SUPPORTED' },
      { reasoning_id: 'r-3', intent: null, decision: 'SUPPORTED' },
      { reasoning_id: 'r-4', intent: 'FUEL', decision: null },
    ]);
    expect(items).toHaveLength(0);
  });

  it('D3. 🔒 kapsam bilinmiyorsa `null` — 0 DEĞİL', () => {
    expect(buildReasoningItems(rows)[1]!.coverageRatio).toBeNull();
    expect(buildReasoningItems(rows)[1]!.ageSeconds).toBeNull();
  });

  it('D4. 🔒 KİŞİSEL VERİ taşınmaz — yalnız kısaltılmış referans', () => {
    const items = buildReasoningItems(rows);
    expect(items[0]!.subjectRef).toBe('veh:veh-abcd');
    expect(items[1]!.subjectRef).toBe('drv:drv-9998');
    /* Tam kimlik listede TAŞINMAZ. */
    expect(items[0]!.subjectRef).not.toContain('abcdef123456');
  });

  it('D5. öznesiz satır UNAVAILABLE gösterir (sahte özne YOK)', () => {
    const items = buildReasoningItems([{
      reasoning_id: 'r-5', intent: 'FLEET', decision: 'UNKNOWN',
    }]);
    expect(items[0]!.subjectRef).toBe('UNAVAILABLE');
  });

  it('D6. liste boş/eksikse boş dizi döner', () => {
    expect(buildReasoningItems(null)).toEqual([]);
    expect(buildReasoningItems(undefined)).toEqual([]);
  });

  it('D7. karar yokken bile son kararlar listesi taşınır', () => {
    const v = buildReasoningView(summary({ reasoning_total: 0 }), rows);
    expect(v.items).toHaveLength(2);
  });
});

describe('E · İkinci otorite yasağı', () => {
  it('E1. 🔒 karar açıklaması SABİT eşlemedir — yeni cümle ÜRETİLMEZ', () => {
    expect(reasoningDecisionExplanation('CONFLICTED_EVIDENCE'))
      .toBe('Kaynaklar çelişiyor — karar üretilmedi');
    expect(reasoningDecisionExplanation('INSUFFICIENT_EVIDENCE'))
      .toBe('Kanıt yetersiz — karar üretilmedi');
    /* Bilinmeyen kod için tahmin YAPILMAZ. */
    expect(reasoningDecisionExplanation('SOMETHING_NEW')).toBe('Bilinmiyor');
  });

  it('E2. 🔒 görünüm katmanı KARAR ÜRETMEZ (sunucu kararını taşır)', () => {
    const v = buildReasoningView(summary({
      conflicted_count: 3, supported_count: 0, unsupported_count: 0,
    }));
    /* Çelişkiyi "olumsuz" diye yeniden sınıflandırmaz. */
    expect(v.conflictCount).toBe(3);
    expect(v.cards.find((c) => c.key === 'CONFIDENCE')?.detail)
      .toContain('0 olumlu · 0 olumsuz');
  });

  it('E3. 🔒 kaynak kilidi: LLM/karar mantığı YOK', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/lib/fleet/reasoningView.ts'), 'utf8');
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/openrouter|gemini|anthropic|openai/i);
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/supabase/i);
    /* Güven ölçeğini yeniden tanımlamamalı. */
    expect(code).not.toMatch(/VERY_HIGH['"]?\s*[:,]\s*\d/);
  });

  it('E4. 🔒 okuma katmanı KARAR TETİKLEMEZ', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/lib/lab/reasoningLabSource.ts'), 'utf8');
    /* `mavi_reason` zaten authenticated'a kapalı; istemci onu ÇAĞIRMAYI
       denemez bile. */
    expect(SRC).not.toMatch(/rpc\(\s*['"]mavi_reason/);
    expect(SRC).not.toMatch(/rpc\(\s*['"]expire_mavi_reasoning/);
    expect(SRC).not.toMatch(/rpc\(\s*['"]mavi_reasoning_transition/);
    expect(SRC).toMatch(/get_reasoning_summary/);
    expect(SRC).toMatch(/get_recent_reasoning/);
  });

  it('E5. 🔒 kart bileşeni AKTİF KOMUT içermez', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/components/dashboard/ReasoningCards.tsx'), 'utf8');
    expect(SRC).not.toMatch(/<button/);
    expect(SRC).not.toMatch(/onClick/);
    expect(SRC).not.toMatch(/\bfetch\s*\(/);
    expect(SRC).not.toMatch(/setInterval|setTimeout/);
  });

  it('E5b. 🔒 kuyruk okuması KUYRUĞU İŞLETMEZ', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/lib/lab/reasoningLabSource.ts'), 'utf8');
    expect(SRC).not.toMatch(/rpc\(\s*['"]run_mavi_reasoning_queue/);
    expect(SRC).not.toMatch(/rpc\(\s*['"]_reasoning_dispatch/);
    expect(SRC).toMatch(/get_reasoning_queue/);
  });

  it('E6. 🔒 kartlar LAB sayfasına GERÇEKTEN bağlı', () => {
    /* Bağlanmamış bir kart gözlem yüzeyi SAYILMAZ. */
    const PAGE = readFileSync(
      join(process.cwd(), 'src/app/dashboard/fleet/lab/page.tsx'), 'utf8');
    expect(PAGE).toMatch(/ReasoningCards/);
    expect(PAGE).toMatch(/readReasoningLab/);
    /* "Okunamadı" ile "karar yok" ayrı gösterilmeli. */
    expect(PAGE).toMatch(/summaryReadable/);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('F · Üretim kuyruğu kartları (058 wiring)', () => {
  function queue(over: Partial<ReasoningQueueRow> = {}): ReasoningQueueRow {
    return {
      company_id: 'co-1',
      event_total: 20, pending_count: 2, running_count: 1,
      completed_count: 14, failed_count: 0, retry_pending_count: 1,
      rejected_count: 1, skipped_count: 1, deduped_count: 0,
      suppressed_total: 37,
      avg_queue_ms: 12.4, avg_decision_ms: 88.2,
      max_queue_ms: 50, max_decision_ms: 210,
      oldest_pending_age_seconds: 90, last_event_age_seconds: 5,
      queue_healthy: true,
      ...over,
    };
  }

  it('F1. satır yoksa NO_ROW ve kart YOK', () => {
    const v = buildReasoningQueueView(null);
    expect(v).toEqual(EMPTY_QUEUE_VIEW);
    expect(queueAbsenceExplanation(v)).toContain('okunamadı');
  });

  it('F2. 🔒 HİÇ OLAY YOKSA bu bir BAŞARI DEĞİLDİR — gerekçe yazılır', () => {
    const v = buildReasoningQueueView(queue({ event_total: 0 }));
    expect(v.present).toBe(false);
    expect(v.absentReason).toBe('NO_EVENT');
    const msg = queueAbsenceExplanation(v) ?? '';
    expect(msg).toContain('kuyruk temiz');
    expect(msg).toContain('tetikleyiciler çalışmıyor');
  });

  it('F3. dört kart üretilir', () => {
    const v = buildReasoningQueueView(queue());
    expect(v.cards.map((c) => c.key)).toEqual(
      ['QUEUE', 'LATENCY', 'SUPPRESSED', 'FAILED']);
  });

  it('F4. açık iş sayısı bekleyen+çalışan+yeniden denenecek', () => {
    const v = buildReasoningQueueView(queue());
    expect(v.openCount).toBe(4);
  });

  it('F5. 🔒 hiç iş bitmediyse gecikme `null` — "0 ms" DEĞİL', () => {
    const v = buildReasoningQueueView(queue({
      avg_decision_ms: null, avg_queue_ms: null, max_decision_ms: null,
    }));
    const c = v.cards.find((x) => x.key === 'LATENCY');
    expect(c?.value).toBeNull();
    expect(c?.known).toBe(false);
    expect(c?.detail).toContain('ölçüm bilinmiyor');
  });

  it('F6. numeric string gecikme sayıya çevrilir', () => {
    const v = buildReasoningQueueView(queue({ avg_decision_ms: '88.2' }));
    expect(v.cards.find((c) => c.key === 'LATENCY')?.value).toBe(88);
  });

  it('F7. 🔒 düşen olay DİKKAT işaretlenir', () => {
    const v = buildReasoningQueueView(queue({ failed_count: 3 }));
    const c = v.cards.find((x) => x.key === 'FAILED');
    expect(c?.attention).toBe(true);
    expect(c?.detail).toContain('sessizce yutulmadı');
  });

  it('F8. 🔒 bastırılan tekrar GÖRÜNÜR kalır', () => {
    const v = buildReasoningQueueView(queue());
    expect(v.suppressedTotal).toBe(37);
    expect(v.cards.find((c) => c.key === 'SUPPRESSED')?.detail)
      .toContain('öznesiz atlandı');
  });

  it('F9. yeniden denenecek iş dikkat çeker', () => {
    expect(buildReasoningQueueView(queue({ retry_pending_count: 2 }))
      .cards.find((c) => c.key === 'QUEUE')?.attention).toBe(true);
    expect(buildReasoningQueueView(queue({ retry_pending_count: 0 }))
      .cards.find((c) => c.key === 'QUEUE')?.attention).toBe(false);
  });

  it('F10. 🔒 bilinmeyen sağlık `null` — "sağlıklı" VARSAYILMAZ', () => {
    expect(buildReasoningQueueView(queue({ queue_healthy: null })).healthy).toBeNull();
    expect(buildReasoningQueueView(queue({ queue_healthy: false })).healthy).toBe(false);
  });

  it('F11. 🔒 kuyruk bölümü kart bileşeninde AKTİF KOMUT içermez', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/components/dashboard/ReasoningCards.tsx'), 'utf8');
    expect(SRC).toMatch(/QueueSection/);
    expect(SRC).not.toMatch(/<button/);
    expect(SRC).not.toMatch(/onClick/);
  });

  it('F12. 🔒 karar yokken bile kuyruk GÖSTERİLİR', () => {
    /* "Hiç karar yok" ile "olaylar geliyor ama karara bağlanamıyor"
       farklı arızalardır. */
    const SRC = readFileSync(
      join(process.cwd(), 'src/components/dashboard/ReasoningCards.tsx'), 'utf8');
    const absentBranch = SRC.slice(
      SRC.indexOf('if (!v.present)'), SRC.indexOf('function AbsentDecisions'));
    expect(absentBranch).toContain('QueueSection');
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('G · Kuyruk zamanlayıcısı (059)', () => {
  function sched(over: Partial<SchedulerHealthRow> = {}): SchedulerHealthRow {
    return {
      scheduler_installed: true, job_scheduled: true,
      schedule_expression: '* * * * *', interval_seconds: 60,
      run_total: 5, last_run_age_seconds: 12, last_run_outcome: 'COMPLETED',
      last_run_duration_ms: 7, last_processed: 2, last_expired: 0,
      consecutive_failure_count: 0, overdue: false, healthy: true,
      ...over,
    };
  }

  it('G1. okunamayan zamanlayıcı "sağlıklı" SAYILMAZ', () => {
    const v = buildSchedulerView(null);
    expect(v.present).toBe(false);
    expect(v.status).toBe('NOT_READ');
    expect(v.healthy).toBeNull();
    /* Körlüğümüz bir uyarı değildir — arıza gibi kırmızıya boyanmaz. */
    expect(v.attention).toBe(false);
    expect(schedulerAbsenceExplanation(v)).not.toBeNull();
  });

  it('G2. zamanlanmamış koşucu GERÇEK ARIZADIR (yumuşatılmaz)', () => {
    const v = buildSchedulerView(sched({ job_scheduled: false, healthy: false }));
    expect(v.status).toBe('NOT_SCHEDULED');
    expect(v.attention).toBe(true);
    expect(v.detail).toMatch(/kuyrukta bekler/);
  });

  it('G3. eklenti yoksa ayrı bir gerçektir', () => {
    expect(buildSchedulerView(sched({ scheduler_installed: false })).status)
      .toBe('NOT_INSTALLED');
  });

  it('G4. hiç koşmamış ≠ sağlıklı · ölçüm UYDURULMAZ', () => {
    const v = buildSchedulerView(sched({
      last_run_age_seconds: null, last_run_outcome: null,
      last_run_duration_ms: null, last_processed: null, healthy: null,
    }));
    expect(v.status).toBe('NEVER_RUN');
    expect(v.lastRunAgeSeconds).toBeNull();
    expect(v.lastProcessed).toBeNull();     // sahte `0` YOK
    expect(v.healthy).toBeNull();
  });

  it('G5. düşen koşum, aralık bilinmese DE arızadır (sıra kilidi)', () => {
    const v = buildSchedulerView(sched({
      consecutive_failure_count: 2, interval_seconds: null, healthy: false,
    }));
    expect(v.status).toBe('FAILING');
    expect(v.attention).toBe(true);
  });

  it('G6. tanınmayan aralık → "sağlıklı" DENMEZ ama arıza da DEĞİL', () => {
    const v = buildSchedulerView(sched({
      schedule_expression: '*/5 * * * *', interval_seconds: null, healthy: null,
    }));
    expect(v.status).toBe('INTERVAL_UNKNOWN');
    expect(v.attention).toBe(false);
  });

  it('G7. gecikme eşiği 3 aralıktır (tek kaçan tik arıza değil)', () => {
    expect(buildSchedulerView(sched({ last_run_age_seconds: 180 })).status)
      .toBe('HEALTHY');
    expect(buildSchedulerView(sched({ last_run_age_seconds: 181 })).status)
      .toBe('OVERDUE');
  });

  it('G8. 🔒 zamanlayıcı bölümü AKTİF KOMUT içermez (salt-okunur)', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/components/dashboard/ReasoningCards.tsx'), 'utf8');
    expect(SRC).toMatch(/SchedulerSection/);
    expect(SRC).not.toMatch(/run_mavi_reasoning_scheduler|runScheduler/);
    expect(SRC).not.toMatch(/onClick/);
  });

  it('G9. 🔒 karar yokken bile zamanlayıcı GÖSTERİLİR', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/components/dashboard/ReasoningCards.tsx'), 'utf8');
    const absentBranch = SRC.slice(
      SRC.indexOf('if (!v.present)'), SRC.indexOf('function AbsentDecisions'));
    expect(absentBranch).toContain('SchedulerSection');
  });

  it('G10. 🔒 okuma katmanı zamanlayıcıyı AYRI okur ve komut GÖNDERMEZ', () => {
    const SRC = readFileSync(
      join(process.cwd(), 'src/lib/lab/reasoningLabSource.ts'), 'utf8');
    expect(SRC).toMatch(/get_reasoning_scheduler_health/);
    expect(SRC).toMatch(/schedulerReadable/);
    /* Koşum tetikleyen RPC ÇAĞRILMAZ. */
    expect(SRC).not.toMatch(/run_mavi_reasoning_scheduler|run_mavi_reasoning_queue/);
  });
});
