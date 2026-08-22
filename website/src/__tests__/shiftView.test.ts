/**
 * shiftView.test.ts — V-16/6 vardiya görünümünün KİLİTLERİ.
 *
 * ── KAPATILAN BOŞLUK ───────────────────────────────────────────────────────
 * Enterprise sayfası "Vardiya yönetimi" vaat ediyordu (`grep` → 0 sonuç). Ama
 * şema okununca görüldü ki vardiya ZATEN VAR: `vehicle_driver_assignments`
 * araç + sürücü + zaman penceresi tutuyor. Yeni bir "shifts" tablosu açmak
 * aynı gerçeğin İKİNCİ OTORİTESİ olurdu.
 *
 * ── YOL ÜSTÜNDE BULUNAN GERÇEK ÜRETİM KUSURU ───────────────────────────────
 * `list_vehicle_driver_assignments` `WHERE a.vehicle_id = p_vehicle_id`
 * diyordu; SQL'de `x = NULL` asla doğru olmaz. Filo yönetim sayfası bu RPC'yi
 * araç kimliği VERMEDEN çağırıyordu → atama listesi **her zaman boş** ve
 * **sessizce**. Deneyle kanıtlandı (NULL → 0 satır, araçla → 1 satır) ve
 * migration 068 ile giderildi.
 *
 * Kilitler dört şeyi korur:
 *  (A) "Aktif" kuralının SUNUCUNUNKİYLE AYNI olduğu
 *  (B) Çakışmaların gerçekten yakalandığı
 *  (C) Vardiya DIŞI sürüşün görüldüğü
 *  (D) Üç ayrı "yok"un birleştirilmediği
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildShiftSummary, shiftState, overlaps, shiftDisclaimer,
  SHIFT_STATE_LABEL, SHIFT_VERDICT_LABEL,
  type AssignmentInput, type TripWindowInput,
} from '@/lib/fleet/shiftView';

const H = 3_600_000;
const NOW = 1_760_000_000_000;

const asg = (o: Partial<AssignmentInput> & { assignment_id: string }): AssignmentInput => ({
  vehicle_id: 'v1', vehicle_name: 'Araç 1',
  driver_id: 'd1', driver_name: 'Sürücü 1',
  starts_at: NOW - H, ends_at: NOW + H,
  status: 'ACTIVE', assignment_type: 'PRIMARY',
  ...o,
});

const trip = (o: Partial<TripWindowInput>): TripWindowInput => ({
  vehicle_id: 'v1', started_at: NOW - 30 * 60_000, ended_at: NOW - 10 * 60_000,
  distance_km: 12, ...o,
});

/* ══════════════════════════════════════════════════════════════════════════
 * A) "AKTİF" KURALI SUNUCUNUNKİYLE AYNI
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vardiya › aktiflik kuralı', () => {
  it('`status` TEK BAŞINA otorite DEĞİL — pencere de gerekir', () => {
    /* Sunucu: status ∈ {SCHEDULED,ACTIVE} VE starts_at<=now VE (ends_at NULL
       VEYA ends_at>now). Farklı bir tanım, ekranın araçtakiyle çelişmesidir. */
    expect(shiftState('ACTIVE', NOW + H, NOW + 2 * H, NOW)).toBe('PLANNED');
    expect(shiftState('ACTIVE', NOW - 2 * H, NOW - H, NOW)).toBe('PAST');
    expect(shiftState('SCHEDULED', NOW - H, NOW + H, NOW)).toBe('ACTIVE');
  });

  it('SCHEDULED da penceresi gelince YÜRÜRLÜKTEDİR', () => {
    expect(shiftState('SCHEDULED', NOW - 1, null, NOW)).toBe('ACTIVE');
  });

  it('kapatılmış durumlar pencere ne derse desin CLOSED', () => {
    for (const s of ['COMPLETED', 'CANCELLED', 'CONFLICTED']) {
      expect(shiftState(s, NOW - H, NOW + H, NOW)).toBe('CLOSED');
    }
  });

  it('açık uçlu vardiya (ends_at NULL) bitmiş SAYILMAZ', () => {
    expect(shiftState('ACTIVE', NOW - 100 * H, null, NOW)).toBe('ACTIVE');
  });

  it('dört durum da AYRI etiketli', () => {
    expect(new Set(Object.values(SHIFT_STATE_LABEL)).size).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B) ÇAKIŞMALAR
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vardiya › çakışma', () => {
  it('aynı ARACA aynı anda iki sürücü → çakışma', () => {
    const s = buildShiftSummary({
      assignments: [
        asg({ assignment_id: 'a1', driver_id: 'd1' }),
        asg({ assignment_id: 'a2', driver_id: 'd2' }),
      ],
      trips: [], nowMs: NOW,
    });
    expect(s.conflictCount).toBe(2);
    expect(s.shifts.every((x) => x.vehicleConflict)).toBe(true);
  });

  it('aynı SÜRÜCÜ aynı anda iki araçta → fiziksel imkânsızlık yakalanır', () => {
    const s = buildShiftSummary({
      assignments: [
        asg({ assignment_id: 'a1', vehicle_id: 'v1' }),
        asg({ assignment_id: 'a2', vehicle_id: 'v2' }),
      ],
      trips: [], nowMs: NOW,
    });
    expect(s.shifts.every((x) => x.driverConflict)).toBe(true);
  });

  it('ARDIŞIK vardiyalar çakışma DEĞİLDİR (sınır paylaşımı)', () => {
    const s = buildShiftSummary({
      assignments: [
        asg({ assignment_id: 'a1', starts_at: NOW - 2 * H, ends_at: NOW - H, driver_id: 'd1' }),
        asg({ assignment_id: 'a2', starts_at: NOW - H, ends_at: NOW, driver_id: 'd2' }),
      ],
      trips: [], nowMs: NOW,
    });
    expect(s.conflictCount).toBe(0);
  });

  it('KAPATILMIŞ vardiya kimseyle çakışmaz', () => {
    const s = buildShiftSummary({
      assignments: [
        asg({ assignment_id: 'a1', driver_id: 'd1' }),
        asg({ assignment_id: 'a2', driver_id: 'd2', status: 'CANCELLED' }),
      ],
      trips: [], nowMs: NOW,
    });
    expect(s.conflictCount).toBe(0);
  });

  it('açık uçlu vardiya sonrakilerle çakışır', () => {
    expect(overlaps(NOW - H, null, NOW + 10 * H, NOW + 11 * H)).toBe(true);
    expect(overlaps(NOW - 2 * H, NOW - H, NOW, null)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C) VARDİYA DIŞI SÜRÜŞ — asıl değer
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vardiya › vardiya dışı sürüş', () => {
  it('hiçbir pencereye düşmeyen yolculuk SAYILIR', () => {
    const s = buildShiftSummary({
      assignments: [asg({ assignment_id: 'a1' })],
      trips: [
        trip({}),                                                  // vardiya içi
        trip({ started_at: NOW + 10 * H, ended_at: NOW + 11 * H }), // vardiya dışı
      ],
      nowMs: NOW,
    });
    expect(s.unassignedTripCount).toBe(1);
    expect(shiftDisclaimer(s)).toMatch(/kimseye atanmamış bir zamanda kullanılmış/);
  });

  it('BAŞKA aracın yolculuğu bu vardiyaya sayılmaz', () => {
    const s = buildShiftSummary({
      assignments: [asg({ assignment_id: 'a1', vehicle_id: 'v1' })],
      trips: [trip({ vehicle_id: 'v2' })],
      nowMs: NOW,
    });
    expect(s.shifts[0].tripCount).toBe(0);
    expect(s.unassignedTripCount).toBe(1);
  });

  it('vardiya içi yolculuk sayısı ve mesafesi toplanır', () => {
    const s = buildShiftSummary({
      assignments: [asg({ assignment_id: 'a1' })],
      trips: [trip({ distance_km: 10 }), trip({ distance_km: '5.5' })],
      nowMs: NOW,
    });
    expect(s.shifts[0].tripCount).toBe(2);
    expect(s.shifts[0].distanceKm).toBeCloseTo(15.5);
  });

  it('mesafe hiç bildirilmemişse `null` — 0 DEĞİL', () => {
    const s = buildShiftSummary({
      assignments: [asg({ assignment_id: 'a1' })],
      trips: [trip({ distance_km: null })],
      nowMs: NOW,
    });
    expect(s.shifts[0].tripCount).toBe(1);
    expect(s.shifts[0].distanceKm).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D) ÜÇ AYRI "YOK"
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vardiya › üç ayrı yok', () => {
  it('okunamadı ≠ vardiya yok', () => {
    expect(buildShiftSummary({ assignments: null, trips: [], nowMs: NOW }).verdict).toBe('UNREADABLE');
    expect(buildShiftSummary({ assignments: [], trips: [], nowMs: NOW }).verdict).toBe('NO_SHIFTS');
    expect(new Set(Object.values(SHIFT_VERDICT_LABEL)).size).toBe(3);
  });

  it('yolculuk OKUNAMADIYSA vardiya dışı sürüş `null` — "0" DEĞİL', () => {
    /* `0` "hepsi kapsandı" demektir; bilmediğimizde bunu söylemek yalandır. */
    const s = buildShiftSummary({
      assignments: [asg({ assignment_id: 'a1' })], trips: null, nowMs: NOW,
    });
    expect(s.unassignedTripCount).toBeNull();
    expect(shiftDisclaimer(s)).toMatch(/HESAPLANAMADI/);
  });

  it('okunamadı cümlesi "vardiya yok" ile karıştırmayı YASAKLAR', () => {
    const s = buildShiftSummary({ assignments: null, trips: null, nowMs: NOW });
    expect(shiftDisclaimer(s)).toMatch(/anlamına GELMEZ/);
  });

  it('penceresi OKUNAMAYAN atama vardiya sayılmaz', () => {
    /* Başlangıcı olmayan bir "vardiya" kapsam hesabını sessizce bozardı. */
    const s = buildShiftSummary({
      assignments: [asg({ assignment_id: 'a1', starts_at: null })],
      trips: [trip({})], nowMs: NOW,
    });
    expect(s.verdict).toBe('NO_SHIFTS');
    expect(s.unassignedTripCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E) TEK OTORİTE VE SAFLIK
 * ═════════════════════════════════════════════════════════════════════════ */
describe('vardiya › tek otorite ve saflık', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/fleet/shiftView.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('saat okumaz — `nowMs` çağırandan gelir', () => {
    expect(src).not.toMatch(/Date\.now\(/);
    expect(src).toMatch(/nowMs/);
  });

  it('I/O · ağ · timer içermez ve dış bağımlılığı yoktur', () => {
    expect(src).not.toMatch(/fetch\(|supabase|setInterval|setTimeout/);
    expect([...src.matchAll(/^import .* from/gm)]).toEqual([]);
  });

  it('RPC düzeltmesi migration olarak KAYITLI', () => {
    /* Model filo geneli atama listesine dayanır; RPC düzeltilmeden liste
       boş gelirdi ve ekran "vardiya yok" derdi. */
    const mig = readFileSync(
      join(process.cwd(), '..', 'supabase/migrations/20260822000068_assignment_list_fleetwide_p1.sql'), 'utf8');
    expect(mig).toMatch(/p_vehicle_id IS NULL OR a\.vehicle_id = p_vehicle_id/);
    expect(mig).toMatch(/vehicle_id\s+uuid/);
  });
});
