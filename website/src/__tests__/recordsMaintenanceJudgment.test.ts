/**
 * recordsMaintenanceJudgment.test.ts — BAKIM HÜKMÜ ve KİLOMETRE KAYNAĞI kilitleri.
 *
 * Kapatılan borç (devir belgesi B5): "Bakım hükmü hâlâ elle girilen km'ye
 * bağlı." Aracın anlık kilometresi ölçülemiyorken hüküm **her zaman
 * `unknown`** kalıyordu — kullanıcı kayıt girmiş olsa bile.
 *
 * Kilitlenen kural — **ASİMETRİK ALT SINIR**:
 *   Kayıtlardan gelen en yüksek kilometre bir ALT SINIRDIR (araç en az bu
 *   kadar gitmiştir). Bu sınır tek yönde hüküm kurar:
 *     · "GEÇMİŞ" denebilir  — alt sınır bile aralığı aşmışsa hüküm kesindir.
 *     · "İYİ" DENEMEZ       — alt sınırın düşük olması gerçek kilometrenin
 *                             de düşük olduğunu KANITLAMAZ (kütük #383 sınıfı).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabaseBrowser: null,
}));

import { judgeService, knownOdometerFloor } from '@/components/pwa/RecordsPanel';
import { queueFailureMessage, type RecordsQueueEntry } from '@/hooks/useRecordsSync';
import type { FuelEntry, ServiceEntry } from '@/lib/recordsService';

const OIL = { key: 'oil', label: 'Yağ', icon: '🛢', intervalKm: 10_000, intervalDays: 365 };

const service = (odometerKm: number | null): ServiceEntry => ({
  serviceKey: 'oil', performedOn: '2026-01-01', odometerKm,
});

/* ── Alt sınır çıkarımı ──────────────────────────────────────────────────── */

describe('bakım hükmü — anlık kilometre YOKKEN', () => {
  it('KİLİT: alt sınır aralığı AŞMIŞSA "geçmiş" hükmü verilir', () => {
    // Son yağ 100.000'de; kayıtlardan bilinen en yüksek km 115.000 →
    // araç EN AZ 15.000 km gitmiş, 10.000'lik aralık kesinlikle aşıldı.
    expect(judgeService(OIL, service(100_000), null, 115_000)).toBe('overdue');
  });

  it('KİLİT: alt sınır aralığın ALTINDAYSA "iyi" DEĞİL "bilinmiyor" verilir', () => {
    // En az 3.000 km gitmiş — ama gerçekte 50.000 km gitmiş olabilir.
    // Yeşil basmak ölçülmemiş bir iyimserliktir.
    expect(judgeService(OIL, service(100_000), null, 103_000)).toBe('unknown');
  });

  it('KİLİT: alt sınır da yoksa hüküm YOK', () => {
    expect(judgeService(OIL, service(100_000), null, null)).toBe('unknown');
  });

  it('KİLİT: alt sınır kaydın kilometresinden KÜÇÜKSE hüküm YOK (veri güvenilmez)', () => {
    expect(judgeService(OIL, service(100_000), null, 90_000)).toBe('unknown');
  });

  it('KİLİT: kaydın kilometresi bilinmiyorsa alt sınır işe yaramaz', () => {
    expect(judgeService(OIL, service(null), null, 200_000)).toBe('unknown');
  });

  it('KİLİT: alt sınır tam aralığa EŞİTSE henüz "geçmiş" DEĞİLDİR', () => {
    expect(judgeService(OIL, service(100_000), null, 110_000)).toBe('unknown');
  });
});

describe('bakım hükmü — anlık kilometre VARKEN davranış DEĞİŞMEZ', () => {
  it('KİLİT: ölçülmüş kilometre varsa alt sınır hükmü etkilemez', () => {
    // Alt sınır "geçmiş" derdi (115.000) ama ölçüm 102.000 → gerçek hüküm "iyi".
    expect(judgeService(OIL, service(100_000), 102_000, 115_000)).toBe('ok');
  });

  it('ölçülmüş kilometre ile geçmiş/yakında hükümleri korunur', () => {
    expect(judgeService(OIL, service(100_000), 111_000, null)).toBe('overdue');
    expect(judgeService(OIL, service(100_000), 109_500, null)).toBe('soon');
  });

  it('kayıt yoksa hüküm YOK', () => {
    expect(judgeService(OIL, undefined, 120_000, 120_000)).toBe('unknown');
  });
});

/* ── Alt sınırın kendisi ─────────────────────────────────────────────────── */

describe('knownOdometerFloor', () => {
  const fuel = (odometerKm: number | null): FuelEntry => ({
    id: `f${odometerKm}`, filledOn: '2026-01-01', odometerKm, liters: 10, pricePerL: null,
  });

  it('KİLİT: iki kaynaktan EN YÜKSEK kilometre alınır', () => {
    expect(knownOdometerFloor([fuel(90_000), fuel(115_000)], [service(100_000)])).toBe(115_000);
  });

  it('KİLİT: bilinmeyen kilometre alt sınırı DÜŞÜRMEZ', () => {
    expect(knownOdometerFloor([fuel(null), fuel(115_000)], [service(null)])).toBe(115_000);
  });

  it('KİLİT: hiç ölçüm yoksa 0 DEĞİL null döner', () => {
    expect(knownOdometerFloor([fuel(null)], [service(null)])).toBeNull();
    expect(knownOdometerFloor([], [])).toBeNull();
  });

  it('KİLİT: sahte 0 alt sınır sayılmaz', () => {
    expect(knownOdometerFloor([fuel(0)], [])).toBeNull();
  });
});

/* ── Gönderilemeyen kayıt gerekçesi ──────────────────────────────────────── */

describe('kuyruk hata gerekçesi — UYDURULMAZ', () => {
  const entry = (over: Partial<RecordsQueueEntry>): RecordsQueueEntry => ({
    id: 'q1', type: 'FUEL_LOG_ADD', status: 'PERMANENT_FAILED', failureCode: null,
    attemptCount: 6, maxAttempts: 6, createdAt: 0, vehicleId: 'v', clientRef: 'f-1',
    ...over,
  });

  it('KİLİT: gerekçe kaydedilmemişse bu AÇIKÇA söylenir (uydurma sebep YOK)', () => {
    expect(queueFailureMessage(entry({ failureCode: null }))).toMatch(/gerekçe kaydedilmemiş/i);
  });

  it('bilinen kodlar Türkçeye çevrilir', () => {
    expect(queueFailureMessage(entry({ failureCode: 'permission_denied' }))).toMatch(/yetkiniz yok/i);
    expect(queueFailureMessage(entry({ failureCode: 'vehicle_not_found' }))).toMatch(/araç bulunamadı/i);
  });

  it('KİLİT: bilinmeyen kod GİZLENMEZ — ham kod gösterilir', () => {
    expect(queueFailureMessage(entry({ failureCode: 'weird_code' }))).toContain('weird_code');
  });

  it('KİLİT: TTL aşımı ayrı bir gerçektir', () => {
    expect(queueFailureMessage(entry({ status: 'EXPIRED', failureCode: 'ttl_expired' })))
      .toMatch(/geçerliliğini yitirdi/i);
  });
});
