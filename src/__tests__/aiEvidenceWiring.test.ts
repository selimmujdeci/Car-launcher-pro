/**
 * aiEvidenceWiring.test.ts — AI EVIDENCE PRODUCTION WIRING P1 KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURALLAR ────────────────────────────────────────────
 *  1. **Kapsam ÜÇ kaynakla sınırlı** — Deep Scan/BlackBox/DTC/LLM YOK.
 *  2. **Kaynak sahipliği:** bir adaptör yalnız kendi kaynağıyla yazabilir.
 *  3. **Paralel motor kurulmadı:** DNA metrik formülü SQL adaptörüne
 *     kopyalanmadı; FI adaptörü mevcut kanıt satırlarını kullanıyor.
 *  4. Kaynağı olmayan metrikler (viraj/akü, BATTERY/MAINTENANCE) ÜRETİLMEZ.
 *  5. Hata yalıtımı ve **sınırlı** yeniden deneme sözleşmesi.
 *
 * ⚠️ Bu dosya SQL adaptörlerinin **sözleşmesini** kilitler; davranış
 * doğrulaması gerçek PostgreSQL'de yapılır
 * (`supabase/verification/local_056_ai_evidence_wiring_p1.sql`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EVIDENCE_ADAPTERS, ADAPTER_RESULTS, adapterSource, canAdapterWrite,
  readAiEvidence, aiEvidenceStore, _resetAiEvidenceStoreForTest,
  EMPTY_EVIDENCE_LEDGER,
  type AdapterState,
} from '../platform/fleet/aiEvidenceEngine';
import { EVIDENCE_SOURCES } from '../platform/fleet/aiEvidence';

const MIGRATION = readFileSync(
  join(process.cwd(),
    'supabase/migrations/20260801000056_ai_evidence_production_wiring_p1.sql'), 'utf8');

const T0 = Date.UTC(2026, 7, 1, 12, 0, 0);

function adapter(over: Partial<AdapterState> = {}): AdapterState {
  return {
    source: 'TRIP_ENGINE', lastEventAtMs: T0 - 60_000, lastResult: 'REPORTED',
    reportedCount: 12, dedupedCount: 3, rejectedCount: 1, degradedCount: 0,
    retryPendingCount: 0, evidenceCount: 40, orphanChainCount: 0,
    ...over,
  };
}

/* ═══ A. KAPSAM ════════════════════════════════════════════════════════ */

describe('EvidenceWiring · A. Kapsam üç kaynakla sınırlı', () => {
  it('A1. 🔒 YALNIZ üç adaptör vardır', () => {
    expect([...EVIDENCE_ADAPTERS]).toEqual([
      'TRIP_METRICS_ADAPTER', 'DRIVER_DNA_ADAPTER', 'FLEET_INTELLIGENCE_ADAPTER',
    ]);
  });

  it('A2. 🔒 KAPSAM DIŞI kaynaklar bağlanmadı (Deep Scan · BlackBox · LLM)', () => {
    /* Bu kaynaklar `EVIDENCE_SOURCES` sözleşmesinde VAR (055) ama bu turda
       ADAPTÖRÜ YOK — sessizce bağlanması kapsamı genişletmek olurdu. */
    expect(EVIDENCE_SOURCES).toContain('DEEP_SCAN');
    expect(EVIDENCE_SOURCES).toContain('BLACKBOX');
    const wired = EVIDENCE_ADAPTERS.map(adapterSource);
    expect(wired).not.toContain('DEEP_SCAN');
    expect(wired).not.toContain('BLACKBOX');
    expect(wired).not.toContain('VEHICLE_IDENTITY');
    expect(wired).not.toContain('HEALTH_MONITOR');
  });

  it('A3. 🔒 sunucu eşlemesi TS ile BİREBİR aynı', () => {
    expect(MIGRATION).toContain("WHEN 'TRIP_METRICS_ADAPTER'       THEN 'TRIP_ENGINE'");
    expect(MIGRATION).toContain("WHEN 'DRIVER_DNA_ADAPTER'         THEN 'DRIVER_DNA'");
    expect(MIGRATION).toContain("WHEN 'FLEET_INTELLIGENCE_ADAPTER' THEN 'FLEET_INTELLIGENCE'");
  });
});

/* ═══ B. KAYNAK SAHİPLİĞİ ══════════════════════════════════════════════ */

describe('EvidenceWiring · B. Kaynak sahipliği', () => {
  it('B1. 🔒 her adaptör YALNIZ kendi kaynağıyla yazabilir', () => {
    expect(canAdapterWrite('TRIP_METRICS_ADAPTER', 'TRIP_ENGINE')).toBe(true);
    expect(canAdapterWrite('TRIP_METRICS_ADAPTER', 'DRIVER_DNA')).toBe(false);
    expect(canAdapterWrite('DRIVER_DNA_ADAPTER', 'FLEET_INTELLIGENCE')).toBe(false);
    expect(canAdapterWrite('FLEET_INTELLIGENCE_ADAPTER', 'BLACKBOX')).toBe(false);
  });

  it('B2. 🔒 sunucu kapısı YABANCI kaynağı reddeder', () => {
    expect(MIGRATION).toContain("RETURN 'FOREIGN_SOURCE'");
    expect(MIGRATION).toMatch(/v_allowed IS NULL OR v_allowed IS DISTINCT FROM p_source/);
  });

  it('B3. 🔒 055 değişmezlik trigger i KORUNUYOR (kaynak değiştirilemez)', () => {
    expect(MIGRATION).toContain('trg_ai_evidence_immutable');
    expect(MIGRATION).toContain('055 fail-closed kisiti kayboldu');
  });
});

/* ═══ C. PARALEL MOTOR YOK ═════════════════════════════════════════════ */

describe('EvidenceWiring · C. Paralel motor kurulmadı', () => {
  it('C1. 🔒 DNA metrik FORMÜLÜ adaptöre kopyalanmadı', () => {
    /* 053 kuralı: karakter formüllerinin tek otoritesi `driverDnaEngine.ts`.
       ⚠️ Tüm dosyada arama YANILTICIDIR: migration bu adları KENDİ
       doğrulamasında YASAK LİSTESİ olarak zaten içerir. Bu yüzden yalnız
       ADAPTÖR GÖVDESİ denetlenir. */
    const start = MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public._evidence_from_dna');
    const end = MIGRATION.indexOf('-- ── 6. FLEET INTELLIGENCE ADAPTÖRÜ', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = MIGRATION.slice(start, end);
    for (const forbidden of ['MECHANICAL_SYMPATHY', 'AGGRESSIVENESS',
                             'DRIVING_SMOOTHNESS', 'CONSISTENCY']) {
      expect(body).not.toContain(forbidden);
    }
    /* Migration bu yasağı KENDİ doğrulamasında da zorluyor. */
    expect(MIGRATION).toContain('DNA metrik formulu adaptore kopyalanmis');
  });

  it('C2. 🔒 FI adaptörü MEVCUT kanıt satırlarını kullanır', () => {
    expect(MIGRATION).toContain('FROM public.fleet_insight_evidence WHERE insight_id');
    expect(MIGRATION).toContain('FI adaptoru mevcut kanit satirlarini kullanmiyor');
  });

  it('C3. 🔒 KAYNAĞI OLMAYAN tipler ÜRETİLMEZ', () => {
    /* Akü/bakım (FI) ve viraj/akü (DNA) — kaynak yok, kanıt yok. */
    expect(MIGRATION).toContain("i.type IN ('BATTERY_TREND','MAINTENANCE_TREND')");
    expect(MIGRATION).toContain('SKIPPED_NO_SOURCE');
    expect(MIGRATION).toContain('kaynagi olmayan DNA metrigi uretilmis');
  });

  it('C4. 🔒 kanıt <3 iken ACTIVE zincir kurulmaz', () => {
    expect(MIGRATION).toContain('i.evidence_count < 3');
    expect(MIGRATION).toContain('SKIPPED_INSUFFICIENT');
  });

  it('C5. 🔒 SINGLE_VEHICLE_ONLY etiketi KORUNUR', () => {
    expect(MIGRATION).toContain('single_vehicle_only');
    expect(MIGRATION).toContain("i.unknown_reason = 'SINGLE_VEHICLE_ONLY'");
  });
});

/* ═══ D. TRIP ADAPTÖRÜ SÖZLEŞMESİ ══════════════════════════════════════ */

describe('EvidenceWiring · D. Trip adaptörü', () => {
  it('D1. 🔒 AÇIK yolculuk kanıt üretmez', () => {
    expect(MIGRATION).toContain('SKIPPED_OPEN_TRIP');
    expect(MIGRATION).toMatch(/t\.ended_at IS NULL THEN RETURN 'SKIPPED_OPEN_TRIP'/);
  });

  it('D2. 🔒 ÖLÇÜLMEMİŞ alan kanıt üretmez (0 sayılmaz)', () => {
    expect(MIGRATION).toContain("m.src = 'UNAVAILABLE'");
    expect(MIGRATION).toContain('CONTINUE WHEN m.val IS NULL');
  });

  it('D3. 🔒 ESTIMATED alan ÖLÇÜLMÜŞ gibi işaretlenmez', () => {
    /* Kaynak alanı OLDUĞU GİBİ taşınır — yükseltilmez. */
    expect(MIGRATION).toContain('ESTIMATED, ÖLÇÜLMÜŞ gibi işaretlenmez');
  });

  it('D4. 🔒 istenen tüm metrikler eşlenmiş', () => {
    for (const m of ['distance_km', 'duration_min', 'moving_time_min',
                     'idle_time_min', 'unknown_time_min', 'harsh_brake_count',
                     'harsh_accel_count', 'max_rpm', 'max_engine_temp_c',
                     'fuel_used_l', 'estimated_cost', 'trip_confidence']) {
      expect(MIGRATION).toContain(m);
    }
  });

  it('D5. 🔒 REVİZYON: eski kanıt DEĞİŞMEZ, SUPERSEDED olur', () => {
    expect(MIGRATION).toContain('subject_revision');
    expect(MIGRATION).toContain("SET state = 'SUPERSEDED'");
    expect(MIGRATION).toContain('ESKİ REVİZYON KANITLARI');
  });
});

/* ═══ E. HATA YALITIMI VE SINIRLI RETRY ════════════════════════════════ */

describe('EvidenceWiring · E. Hata yalıtımı', () => {
  it('E1. 🔒 adaptör hatası ANA İŞLEMİ bozmaz', () => {
    expect(MIGRATION).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(MIGRATION).toContain('HATA YALITIMI: ana işlem devam eder');
  });

  it('E2. 🔒 hata SESSİZCE YUTULMAZ — bounded DURUM döner', () => {
    expect([...ADAPTER_RESULTS]).toEqual([
      'REPORTED', 'DEDUPED', 'REJECTED', 'DEGRADED', 'RETRY_PENDING',
    ]);
    expect(MIGRATION).toContain('_evidence_adapter_state_bump');
  });

  it('E3. 🔒 yeniden deneme SINIRLIDIR (sonsuz/hızlı retry YOK)', () => {
    expect(MIGRATION).toContain('aer_attempts_bounded');
    expect(MIGRATION).toContain('attempts <= 5');
    /* Üstel bekleme — sabit hızlı tekrar yok. */
    expect(MIGRATION).toContain("power(2,");
    expect(MIGRATION).toContain('sinirsiz yeniden deneme mumkun');
  });

  it('E4. 🔒 tükenen deneme DEGRADED kalır (sessizce kaybolmaz)', () => {
    expect(MIGRATION).toMatch(/attempts \+ 1 >= 5[\s\S]{0,80}'DEGRADED'/);
  });
});

/* ═══ F. GÖZLEM YÜZEYİ ═════════════════════════════════════════════════ */

describe('EvidenceWiring · F. LAB gözlem yüzeyi', () => {
  it('F1. 🔒 adaptör durumu yoksa kaynak kapsamı NULL (0 DEĞİL)', () => {
    _resetAiEvidenceStoreForTest();
    expect(readAiEvidence(T0).sourceCoverage).toBeNull();
    expect(readAiEvidence(T0).adapters).toHaveLength(0);
  });

  it('F2. 🔒 kaynak kapsamı GERÇEK adaptör verisinden hesaplanır', () => {
    _resetAiEvidenceStoreForTest();
    aiEvidenceStore.setFromServer({
      ...EMPTY_EVIDENCE_LEDGER,
      adapters: [
        adapter({ source: 'TRIP_ENGINE', evidenceCount: 40 }),
        adapter({ source: 'DRIVER_DNA', evidenceCount: 8 }),
        adapter({ source: 'FLEET_INTELLIGENCE', evidenceCount: 0,
                  lastResult: 'REJECTED' }),
      ],
    });
    const r = readAiEvidence(T0);
    expect(r.sourceCoverage).toBeCloseTo(2 / 3, 6);
    expect(r.adapters).toHaveLength(3);
  });

  it('F3. 🔒 öksüz zincir ve bekleyen retry sayıları TOPLANIR', () => {
    _resetAiEvidenceStoreForTest();
    aiEvidenceStore.setFromServer({
      ...EMPTY_EVIDENCE_LEDGER,
      adapters: [
        adapter({ source: 'TRIP_ENGINE', orphanChainCount: 2, retryPendingCount: 1 }),
        adapter({ source: 'DRIVER_DNA', orphanChainCount: 3, retryPendingCount: 4 }),
      ],
    });
    const r = readAiEvidence(T0);
    expect(r.orphanChainCount).toBe(5);
    expect(r.retryPendingTotal).toBe(5);
  });

  it('F4. 🔒 LAB ekranı adaptör alanlarını GÖSTERİR', () => {
    const SCREEN = readFileSync(
      join(process.cwd(),
        'src/components/devtools/screens/AiEvidenceEngineScreen.tsx'), 'utf8');
    for (const field of ['sourceCoverage', 'orphanChainCount', 'retryPendingCount',
                         'lastResult', 'reportedCount', 'dedupedCount',
                         'rejectedCount', 'Source Adapters']) {
      expect(SCREEN).toContain(field);
    }
    /* Ham veri/PII gösterilmez. */
    expect(SCREEN).not.toContain('trip_payload');
    expect(SCREEN).toContain('slice(0, 8)');
  });
});

/* ═══ G. MEVCUT KATMANLARA DOKUNULMADI ═════════════════════════════════ */

describe('EvidenceWiring · G. Regresyon güvencesi', () => {
  it('G1. 🔒 attribution / DNA birikimi kanıt yazımına BAĞLANMADI', () => {
    expect(MIGRATION).toContain('kanit yazimi attribution kararina girmis');
    expect(MIGRATION).toContain('DNA birikimi kanit yazimina baglanmis');
  });

  it('G2. 🔒 055 güven türetimi DEĞİŞMEDİ', () => {
    expect(MIGRATION).toContain('guven turetimi DEGISTI');
    expect(MIGRATION).toContain("public._evidence_confidence('BLACKBOX','MEASURED',1) <> 'MEDIUM'");
  });

  it('G3. 🔒 TS motoru hâlâ LLM ÇAĞIRMAZ', () => {
    const ENGINE = readFileSync(
      join(process.cwd(), 'src/platform/fleet/aiEvidenceEngine.ts'), 'utf8');
    const code = ENGINE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    for (const forbidden of ['fetch(', 'openrouter', 'gemini', 'llm', 'openai']) {
      expect(code.toLowerCase()).not.toContain(forbidden);
    }
  });
});
