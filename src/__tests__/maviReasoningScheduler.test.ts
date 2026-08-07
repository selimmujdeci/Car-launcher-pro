/**
 * maviReasoningScheduler.test.ts — 059 KUYRUK ZAMANLAYICISI KİLİTLERİ.
 *
 * NE KİLİTLENİR:
 *  · Sağlık kapısı SIRASI (SQL `CASE` ile birebir parite)
 *  · "Bilmiyorum" ile "iyi"nin karışmaması (üç değerli sağlık)
 *  · Ölçülmeyen sayacın `null` kalması (sahte `0` yasağı)
 *  · Zamanlayıcının KARAR ÜRETMEMESİ (ikinci otorite yasağı)
 *  · Migration 059'un istemciye yazma/çalıştırma açmaması
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SCHEDULER_INTERVAL_SECONDS, SCHEDULER_OUTCOMES, SCHEDULER_OVERDUE_FACTOR,
  SCHEDULER_STATUSES, SCHEDULER_TRIGGER_SOURCES, UNREAD_SCHEDULER_HEALTH,
  classifySchedulerHealth, isSchedulerOutcome, isSchedulerOverdue,
  schedulerOutcomeLabel, schedulerStatus, schedulerStatusLabel,
  schedulerTriggerSourceLabel,
  type SchedulerHealth,
} from '../platform/reasoning/maviReasoningSchedule';
import {
  EMPTY_REASONING_LEDGER, maviReasoningStore, readMaviReasoning,
  _resetMaviReasoningStoreForTest,
} from '../platform/reasoning/maviReasoningEngine';

/** Sağlıklı bir okuma tabanı — testler yalnız ilgili alanı bozar. */
const HEALTHY: SchedulerHealth = Object.freeze({
  ...UNREAD_SCHEDULER_HEALTH,
  schedulerInstalled: true,
  jobScheduled: true,
  scheduleExpression: '* * * * *',
  intervalSeconds: SCHEDULER_INTERVAL_SECONDS,
  runTotal: 12,
  lastRunAgeSeconds: 20,
  lastRunOutcome: 'COMPLETED',
  lastRunDurationMs: 8,
  lastProcessed: 3,
  lastExpired: 0,
  consecutiveFailureCount: 0,
  overdue: false,
  healthy: true,
});

beforeEach(() => { _resetMaviReasoningStoreForTest(); });

/* ══════════════════════════════════════════════════════════════════════ */
describe('A · Bounded sözleşme', () => {
  it('A1. koşum sonucu kümesi KAPALI', () => {
    expect([...SCHEDULER_OUTCOMES]).toEqual(['COMPLETED', 'SKIPPED_LOCKED', 'FAILED']);
    expect(isSchedulerOutcome('COMPLETED')).toBe(true);
    expect(isSchedulerOutcome('HEALTHY')).toBe(false);
    expect(isSchedulerOutcome(null)).toBe(false);
  });

  it('A2. tetikleyici kaynağı kümesi KAPALI', () => {
    expect([...SCHEDULER_TRIGGER_SOURCES]).toEqual(['CRON', 'MANUAL']);
  });

  it('A3. her durum kodunun bir etiketi VAR (serbest metin yok)', () => {
    for (const s of SCHEDULER_STATUSES) {
      expect(schedulerStatusLabel(s).length).toBeGreaterThan(0);
    }
    for (const o of SCHEDULER_OUTCOMES) {
      expect(schedulerOutcomeLabel(o).length).toBeGreaterThan(0);
    }
    for (const t of SCHEDULER_TRIGGER_SOURCES) {
      expect(schedulerTriggerSourceLabel(t).length).toBeGreaterThan(0);
    }
  });

  it('A4. gecikme çarpanı 1 DEĞİL (tek kaçan tik arıza değildir)', () => {
    expect(SCHEDULER_OVERDUE_FACTOR).toBe(3);
    expect(SCHEDULER_INTERVAL_SECONDS).toBe(60);
  });

  it('A5. OKUNMAMIŞ durum "sağlıklı" DEĞİL, BİLİNMİYOR', () => {
    expect(UNREAD_SCHEDULER_HEALTH.healthy).toBeNull();
    expect(UNREAD_SCHEDULER_HEALTH.overdue).toBeNull();
    expect(UNREAD_SCHEDULER_HEALTH.lastRunAgeSeconds).toBeNull();
    /* Ölçülmemiş sayaç `0` DEĞİL `null`. */
    expect(UNREAD_SCHEDULER_HEALTH.lastProcessed).toBeNull();
    expect(UNREAD_SCHEDULER_HEALTH.lastExpired).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('B · Gecikme ölçümü (ölçülemiyorsa null)', () => {
  it('B1. hiç koşmamışsa gecikme BİLİNMEZ', () => {
    expect(isSchedulerOverdue(null, 60)).toBeNull();
  });

  it('B2. aralık bilinmiyorsa gecikme TAHMİN EDİLMEZ', () => {
    expect(isSchedulerOverdue(9999, null)).toBeNull();
  });

  it('B3. tam 3 aralık gecikme SAYILMAZ, üstü sayılır (eşik keskin)', () => {
    expect(isSchedulerOverdue(180, 60)).toBe(false);
    expect(isSchedulerOverdue(181, 60)).toBe(true);
  });

  it('B4. bozuk sayı gecikme ÜRETMEZ', () => {
    expect(isSchedulerOverdue(Number.NaN, 60)).toBeNull();
    expect(isSchedulerOverdue(60, Number.POSITIVE_INFINITY)).toBeNull();
    expect(isSchedulerOverdue(60, 0)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('C · Sağlık kapısı (SQL ile aynı SIRA)', () => {
  it('C1. zamanlanmamış koşucu GERÇEK ARIZADIR', () => {
    expect(classifySchedulerHealth({
      jobScheduled: false, lastRunAgeSeconds: 5,
      consecutiveFailureCount: 0, intervalSeconds: 60,
    })).toBe(false);
  });

  it('C2. kurulu ama HİÇ KOŞMAMIŞ → BİLİNMİYOR (false DEĞİL)', () => {
    expect(classifySchedulerHealth({
      jobScheduled: true, lastRunAgeSeconds: null,
      consecutiveFailureCount: 0, intervalSeconds: 60,
    })).toBeNull();
  });

  it('C3. art arda hata → sağlıksız', () => {
    expect(classifySchedulerHealth({
      jobScheduled: true, lastRunAgeSeconds: 5,
      consecutiveFailureCount: 1, intervalSeconds: 60,
    })).toBe(false);
  });

  it('C4. hata, aralık bilinmese DE arızadır (SIRA kilidi)', () => {
    /* Aralık kapısı önce gelseydi bu durum "bilinmiyor" olurdu — düşen bir
       koşum hiçbir koşulda belirsizliğe gömülemez. */
    expect(classifySchedulerHealth({
      jobScheduled: true, lastRunAgeSeconds: 5,
      consecutiveFailureCount: 2, intervalSeconds: null,
    })).toBe(false);
  });

  it('C5. aralık bilinmiyorsa "sağlıklı" DENMEZ', () => {
    expect(classifySchedulerHealth({
      jobScheduled: true, lastRunAgeSeconds: 5,
      consecutiveFailureCount: 0, intervalSeconds: null,
    })).toBeNull();
  });

  it('C6. gecikmiş koşum sağlıksızdır', () => {
    expect(classifySchedulerHealth({
      jobScheduled: true, lastRunAgeSeconds: 600,
      consecutiveFailureCount: 0, intervalSeconds: 60,
    })).toBe(false);
  });

  it('C7. ölçülmüş ve zamanında → sağlıklı', () => {
    expect(classifySchedulerHealth({
      jobScheduled: true, lastRunAgeSeconds: 20,
      consecutiveFailureCount: 0, intervalSeconds: 60,
    })).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('D · Durum kodu (NOT_READ ≠ NEVER_RUN)', () => {
  it('D1. okunmadıysa NOT_READ — bu bir sağlık raporu DEĞİLDİR', () => {
    expect(schedulerStatus(UNREAD_SCHEDULER_HEALTH, false)).toBe('NOT_READ');
    /* Okunmuş ama kurulu değilse ayrı bir gerçektir. */
    expect(schedulerStatus(UNREAD_SCHEDULER_HEALTH, true)).toBe('NOT_INSTALLED');
  });

  it('D2. kurulu ama zamanlanmamış → NOT_SCHEDULED', () => {
    expect(schedulerStatus(
      { ...HEALTHY, jobScheduled: false }, true)).toBe('NOT_SCHEDULED');
  });

  it('D3. zamanlanmış ama hiç koşmamış → NEVER_RUN', () => {
    expect(schedulerStatus(
      { ...HEALTHY, lastRunAgeSeconds: null }, true)).toBe('NEVER_RUN');
  });

  it('D4. düşen koşum → FAILING', () => {
    expect(schedulerStatus(
      { ...HEALTHY, consecutiveFailureCount: 3 }, true)).toBe('FAILING');
  });

  it('D5. tanınmayan ifade → INTERVAL_UNKNOWN (uydurma aralık yok)', () => {
    expect(schedulerStatus(
      { ...HEALTHY, scheduleExpression: '*/5 * * * *', intervalSeconds: null },
      true)).toBe('INTERVAL_UNKNOWN');
  });

  it('D6. gecikmiş → OVERDUE · zamanında → HEALTHY', () => {
    expect(schedulerStatus({ ...HEALTHY, lastRunAgeSeconds: 900 }, true))
      .toBe('OVERDUE');
    expect(schedulerStatus(HEALTHY, true)).toBe('HEALTHY');
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('E · Cihaz deposu (LAB salt-okur)', () => {
  it('E1. hiç okuma yoksa zamanlayıcı NOT_READ', () => {
    const d = readMaviReasoning(1_000);
    expect(d.scheduleRead).toBe(false);
    expect(schedulerStatus(d.schedule, d.scheduleRead)).toBe('NOT_READ');
    expect(d.schedule.healthy).toBeNull();
  });

  it('E2. karar defteri gelip zamanlayıcı gelmediyse OKUNMAMIŞ sayılır', () => {
    maviReasoningStore.setFromServer(EMPTY_REASONING_LEDGER);
    const d = readMaviReasoning(1_000);
    /* Karar tarafı sunucudan geldi ama zamanlayıcı BİLİNMİYOR. */
    expect(d.source).toBe('SERVER');
    expect(d.scheduleRead).toBe(false);
    expect(schedulerStatus(d.schedule, d.scheduleRead)).toBe('NOT_READ');
  });

  it('E3. sunucudan gelen sağlık aynen okunur (istemci yeniden hesaplamaz)', () => {
    maviReasoningStore.setFromServer(EMPTY_REASONING_LEDGER, undefined, HEALTHY);
    const d = readMaviReasoning(1_000);
    expect(d.scheduleRead).toBe(true);
    expect(d.schedule.lastProcessed).toBe(3);
    expect(d.schedule.healthy).toBe(true);
    expect(schedulerStatus(d.schedule, d.scheduleRead)).toBe('HEALTHY');
  });

  it('E4. temizlik zamanlayıcıyı da BİLİNMEYENE döndürür', () => {
    maviReasoningStore.setFromServer(EMPTY_REASONING_LEDGER, undefined, HEALTHY);
    _resetMaviReasoningStoreForTest();
    const d = readMaviReasoning(1_000);
    expect(d.scheduleRead).toBe(false);
    expect(d.schedule.healthy).toBeNull();
  });

  it('E5. okuma ASLA fırlatmaz', () => {
    maviReasoningStore.setFromServer(EMPTY_REASONING_LEDGER, undefined, HEALTHY);
    expect(() => readMaviReasoning(Number.NaN)).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════ */
describe('F · 🔒 KAYNAK KİLİTLERİ (statik)', () => {
  const MODEL = readFileSync(
    join(process.cwd(), 'src/platform/reasoning/maviReasoningSchedule.ts'), 'utf8');
  const SQL = readFileSync(
    join(process.cwd(),
      'supabase/migrations/20260801000059_mavi_reasoning_scheduler_p1.sql'), 'utf8');
  const strip = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('F1. 🔒 model SAF (I/O · zaman · timer · React YOK)', () => {
    const code = strip(MODEL);
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(code).not.toMatch(/localStorage|sessionStorage|safeStorage/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/from ['"]react['"]/);
    expect(code).not.toMatch(/supabase|createClient/i);
  });

  it('F2. 🔒 model KARAR ÜRETMEZ (ikinci otorite yok)', () => {
    const code = strip(MODEL);
    /* Zamanlayıcı katmanı niyet/kanıt/güven sözcüklerine DOKUNMAZ. */
    expect(code).not.toMatch(/evidence|Evidence/);
    expect(code).not.toMatch(/confidence|Confidence/);
    expect(code).not.toMatch(/SUPPORTED|CONFLICTED_EVIDENCE|INSUFFICIENT_EVIDENCE/);
    expect(code).not.toMatch(/openrouter|gemini|anthropic|openai/i);
  });

  it('F3. 🔒 migration zamanlayıcıyı İSTEMCİYE AÇMAZ', () => {
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.run_mavi_reasoning_scheduler\(integer, text\)\s*\n?\s*FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.run_mavi_reasoning_scheduler\(integer, text\) TO service_role/);
    /* Kütük istemciye HİÇ açılmaz. */
    expect(SQL).toMatch(
      /REVOKE ALL ON TABLE public\.mavi_reasoning_scheduler_run FROM anon, authenticated, PUBLIC/);
    expect(SQL).not.toMatch(
      /GRANT[^;]*ON TABLE public\.mavi_reasoning_scheduler_run[^;]*authenticated/);
  });

  it('F4. 🔒 migration KARAR MANTIĞI kopyalamaz — yalnız çağırır', () => {
    expect(SQL).toMatch(/run_mavi_reasoning_queue\(/);
    expect(SQL).toMatch(/expire_mavi_reasoning\(\)/);
    /* Fonksiyon gövdesinde karar motoru DOĞRUDAN çağrılmaz. */
    const body = SQL.slice(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.run_mavi_reasoning_scheduler'),
      SQL.indexOf('-- ── 3. ZAMANLAMA'));
    expect(body).not.toMatch(/mavi_reason\(/);
    expect(body).not.toMatch(/_reasoning_dispatch|_reasoning_resolve|ai_evidence/);
  });

  it('F5. 🔒 örtüşen koşum engeli ve dürüst kayıt migration da VAR', () => {
    expect(SQL).toMatch(/pg_try_advisory_lock/);
    expect(SQL).toMatch(/SKIPPED_LOCKED/);
    expect(SQL).toMatch(/pg_advisory_unlock/);
    /* Sahte "0 iş" yazılamaz — şema kısıtı. */
    expect(SQL).toMatch(/mrsr_counts_only_when_completed/);
    expect(SQL).toMatch(/mrsr_completed_has_counts/);
  });

  it('F6. 🔒 kütük BOUNDED (sınırsız büyüme yok)', () => {
    expect(SQL).toMatch(/_reasoning_scheduler_history_max/);
    expect(SQL).toMatch(/DELETE FROM public\.mavi_reasoning_scheduler_run/);
  });

  it('F7. 🔒 TS ve SQL sağlık kapısı AYNI SIRADA', () => {
    const gate = SQL.slice(SQL.indexOf('v_healthy := CASE'),
      SQL.indexOf('RETURN QUERY SELECT v_ext'));
    /* Sıra: zamanlanmamış → hiç koşmamış → hata → aralık → gecikme. */
    const order = ['NOT v_sched', 'v_age IS NULL', 'v_fails > 0',
      'v_int IS NULL', 'v_overdue'];
    let cursor = -1;
    for (const token of order) {
      const at = gate.indexOf(token);
      expect(at, `SQL kapısında sıra bozuk: ${token}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('F8. 🔒 sağlık okuması ŞİRKET/KİŞİSEL veri taşımaz', () => {
    const rpc = SQL.slice(
      SQL.indexOf('CREATE OR REPLACE FUNCTION public.get_reasoning_scheduler_health'),
      SQL.indexOf('-- ── 5. YETKİLER'));
    const signature = rpc.slice(0, rpc.indexOf('LANGUAGE plpgsql'));
    for (const banned of ['vehicle', 'driver', 'company', 'vin', 'plate', 'lat', 'lon']) {
      expect(signature.toLowerCase(), `yasak alan: ${banned}`)
        .not.toMatch(new RegExp(`\\b${banned}`));
    }
    /* Oturumsuz okuma fail-closed. */
    expect(rpc).toMatch(/IF v_uid IS NULL THEN RETURN; END IF;/);
  });

  it('F9. 🔒 LAB ekranı zamanlayıcıyı GÖSTERİR ve komut GÖNDERMEZ', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/MaviReasoningEngineScreen.tsx'), 'utf8');
    expect(SCREEN).toMatch(/Queue Scheduler/);
    expect(SCREEN).toMatch(/schedulerStatus\(/);
    /* Salt-okunur: koşum tetikleyen hiçbir çağrı yok. */
    expect(SCREEN).not.toMatch(/run_mavi_reasoning_scheduler|runScheduler/);
    expect(SCREEN).not.toMatch(/\bfetch\s*\(/);
  });
});
