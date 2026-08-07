/**
 * driverIdentityAssignment.test.ts — SÜRÜCÜ KİMLİĞİ VE ATAMA KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURAL ──────────────────────────────────────────────
 * "Bu aracı, bu zaman aralığında ve bu yolculuk sırasında KİM kullanıyordu?"
 * sorusuna **kanıt yoksa `UNKNOWN`** denir. Araç sahibi, Fleet kullanıcısı,
 * observer veya son giriş yapan kişi ASLA otomatik sürücü sayılmaz.
 *
 * Bu dosya davranışı UI/model katmanında kilitler; sunucu tarafı ayrıca
 * gerçek PostgreSQL ile doğrulanır (`local_048_*.sql`, 54 kontrol).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildDriverView, buildDriverViews, buildAssignmentView,
  buildTripAttributionView, selectActiveAssignment, countCoveringAssignments,
  licenseValidity, licenseValidityLabel,
  tripDriverLabel, attributionSourceLabel, attributionConfidenceLabel,
  driverStatusLabel, assignmentStatusLabel,
  normalizeAttributionStatus, normalizeAttributionConfidence,
  type AssignmentRow, type DriverRow, type TripAttributionRow,
} from '../lib/fleet/driverIdentity';
import { driverRpcReasonLabel } from '../lib/fleet/drivers.service';
import { buildTripView, type TripRow } from '../lib/fleet/vehicleTripsView';

const MIGRATION_048 = readFileSync(
  join(process.cwd(), '..', 'supabase/migrations/20260730000048_fleet_driver_identity_assignment_p0.sql'),
  'utf8',
);

const T = Date.UTC(2026, 6, 30, 12, 0, 0);
const H = 3_600_000;

function asg(over: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    assignment_id: 'a1', driver_id: 'd1', driver_name: 'Ahmet',
    starts_at: new Date(T - 2 * H).toISOString(),
    ends_at: new Date(T + 2 * H).toISOString(),
    assignment_type: 'PRIMARY', source: 'FLEET_ADMIN',
    confidence: 'HIGH', status: 'ACTIVE', revision: 1, note: null,
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════ */

describe('Driver P0 · A. Kimlik ayrımı', () => {
  it('A1. 🔒 sürücünün CAROS hesabı OLMAK ZORUNDA değil', () => {
    const v = buildDriverView({
      driver_id: 'd1', display_name: 'Hasan', status: 'ACTIVE',
      has_linked_account: false,
    });
    expect(v.hasLinkedAccount).toBe(false);
    expect(v.driverId).toBe('d1');
  });

  it('A2. 🔒 hesap bağı bir SÜRÜCÜLÜK kanıtı DEĞİL — yalnız bilgi alanı', () => {
    const linked = buildDriverView({
      driver_id: 'd2', display_name: 'Ayşe', status: 'INACTIVE',
      has_linked_account: true,
    });
    /* Hesabı VAR ama sürücü PASİF: hesap sahibi olmak sürücü yapmaz. */
    expect(linked.hasLinkedAccount).toBe(true);
    expect(linked.status).toBe('INACTIVE');
  });

  it('A3. 🔒 bilinmeyen durum "aktif" sayılmaz (fail-closed)', () => {
    const v = buildDriverView({ driver_id: 'd3', display_name: 'X', status: 'BILINMEYEN' });
    expect(v.status).toBe('INACTIVE');
    expect(v.status).not.toBe('ACTIVE');
  });

  it('A4. 🔒 okunamadı ≠ sürücü yok', () => {
    const failed = buildDriverViews(null);
    expect(failed.readable).toBe(false);
    expect(failed.isEmpty).toBe(false);

    const empty = buildDriverViews([]);
    expect(empty.readable).toBe(true);
    expect(empty.isEmpty).toBe(true);
  });
});

describe('Driver P0 · B. Gizlilik', () => {
  it('B1. 🔒 TAM ehliyet numarası görünüme GİRMEZ (yalnız maskeli)', () => {
    const v = buildDriverView({
      driver_id: 'd1', display_name: 'A', license_masked: '•••6655',
    });
    expect(v.licenseMasked).toBe('•••6655');
    expect(JSON.stringify(v)).not.toContain('9988776655');
    /* Görünüm tipinde ham numara alanı BULUNMAMALI. */
    expect(Object.keys(v)).not.toContain('licenseNumber');
  });

  it('B2. 🔒 telefon yalnız sunucunun gönderdiği kadar (admin dışı null)', () => {
    const noPhone = buildDriverView({ driver_id: 'd1', display_name: 'A' });
    expect(noPhone.phone).toBeNull();
  });

  it('B3. 🔒 sunucu okuma RPC si TAM ehliyet döndürmez', () => {
    /* `list_fleet_drivers` yalnız son 4 haneyi maskeli döndürür. */
    expect(MIGRATION_048).toContain("'•••' || right(d.license_number, 4)");
  });

  it('B4. 🔒 head unit özeti HASSAS alan taşımaz', () => {
    const fn = MIGRATION_048.slice(
      MIGRATION_048.indexOf('FUNCTION public.get_active_driver_assignment'),
    );
    const body = fn.slice(0, fn.indexOf('$fn$;') + 5)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')   // blok yorumlar
      .replace(/--[^\n]*/g, ' ');          // satır yorumları
    for (const forbidden of ['license_number', 'd.phone', 'employee_code', 'linked_user_id']) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe('Driver P0 · C. Zaman aralığı otoritesi', () => {
  it('C1. 🔒 aralığı KAPSAYAN tek atama aktif sayılır', () => {
    const a = [buildAssignmentView(asg())];
    expect(selectActiveAssignment(a, T)?.driverId).toBe('d1');
  });

  it('C2. 🔒 GELECEKTEKİ atama "şu anki sürücü" DEĞİLDİR', () => {
    const a = [buildAssignmentView(asg({
      starts_at: new Date(T + H).toISOString(),
      ends_at: new Date(T + 3 * H).toISOString(),
      status: 'SCHEDULED',
    }))];
    expect(selectActiveAssignment(a, T)).toBeNull();
  });

  it('C3. 🔒 BİTMİŞ atama "şu anki sürücü" DEĞİLDİR', () => {
    const a = [buildAssignmentView(asg({
      starts_at: new Date(T - 5 * H).toISOString(),
      ends_at: new Date(T - H).toISOString(),
      status: 'COMPLETED',
    }))];
    expect(selectActiveAssignment(a, T)).toBeNull();
  });

  it('C4. 🔒 AÇIK UÇLU atama (ends_at null) aktiftir', () => {
    const v = buildAssignmentView(asg({ ends_at: null }));
    expect(v.isOpenEnded).toBe(true);
    expect(selectActiveAssignment([v], T)?.driverId).toBe('d1');
  });

  it('C5. 🔒 İKİ kapsayan atama -> ÇAKIŞMA (rastgele ilki SEÇİLMEZ)', () => {
    const a = [
      buildAssignmentView(asg({ assignment_id: 'a1', driver_id: 'd1' })),
      buildAssignmentView(asg({ assignment_id: 'a2', driver_id: 'd2' })),
    ];
    expect(countCoveringAssignments(a, T)).toBe(2);
    expect(selectActiveAssignment(a, T)).toBeNull();
  });

  it('C6. 🔒 BİTİŞİK aralıklar çakışma değildir (vardiya devri)', () => {
    const a = [
      buildAssignmentView(asg({
        assignment_id: 'a1', driver_id: 'd1',
        starts_at: new Date(T - 4 * H).toISOString(),
        ends_at: new Date(T).toISOString(),
      })),
      buildAssignmentView(asg({
        assignment_id: 'a2', driver_id: 'd2',
        starts_at: new Date(T).toISOString(),
        ends_at: new Date(T + 4 * H).toISOString(),
      })),
    ];
    /* T anında: ilkinin bitişi = ikincinin başlangıcı → tek kapsayan. */
    expect(countCoveringAssignments(a, T)).toBe(1);
    expect(selectActiveAssignment(a, T)?.driverId).toBe('d2');
  });

  it('C7. 🔒 zaman DIŞARIDAN verilir (saf model, Date.now kullanmaz)', () => {
    const a = [buildAssignmentView(asg())];
    /* Aynı veri, farklı "şimdi" → farklı sonuç. */
    expect(selectActiveAssignment(a, T)).not.toBeNull();
    expect(selectActiveAssignment(a, T + 10 * H)).toBeNull();
  });
});

describe('Driver P0 · D. Trip attribution — FALLBACK YOK', () => {
  it('D1. 🔒 atama yoksa UNKNOWN (sürücü UYDURULMAZ)', () => {
    const v = buildTripAttributionView({});
    expect(v.status).toBe('UNKNOWN');
    expect(v.driverId).toBeNull();
    expect(tripDriverLabel(v)).toBe('Sürücü bilinmiyor');
  });

  it('D2. 🔒 UNKNOWN "Sürücü yok" DEMEK DEĞİLDİR', () => {
    const v = buildTripAttributionView({ driver_attribution_status: 'UNKNOWN' });
    const label = tripDriverLabel(v);
    expect(label).toContain('bilinmiyor');
    expect(label).not.toContain('yok');
  });

  it('D3. 🔒 sürücü kimliği yoksa ATTRIBUTED İDDİA EDİLEMEZ (fail-closed)', () => {
    /* Sunucu bozuk veri gönderse bile görünüm "atandı" demez. */
    const v = buildTripAttributionView({
      driver_attribution_status: 'ATTRIBUTED', driver_id: null,
    });
    expect(v.status).toBe('UNKNOWN');
  });

  it('D4. 🔒 CONFLICTED rastgele ilk sürücüye DÜŞMEZ', () => {
    const v = buildTripAttributionView({
      driver_attribution_status: 'CONFLICTED', driver_id: null,
    });
    expect(v.status).toBe('CONFLICTED');
    expect(v.driverId).toBeNull();
    expect(tripDriverLabel(v)).toContain('Çakışma');
  });

  it('D5. 🔒 KISMİ kapsama kesin sürücü ÜRETMEZ', () => {
    const v = buildTripAttributionView({
      driver_attribution_status: 'MANUAL_REVIEW', driver_id: null,
    });
    expect(v.driverId).toBeNull();
    expect(tripDriverLabel(v)).toContain('İnceleme');
  });

  it('D6. 🔒 elle düzeltme GİZLENMEZ', () => {
    const v = buildTripAttributionView({
      driver_attribution_status: 'LOCKED', driver_id: 'd1', driver_name: 'Ahmet',
      driver_attribution_source: 'MANUAL_TRIP_ASSIGNMENT',
    });
    expect(v.isManual).toBe(true);
    expect(attributionSourceLabel(v.source)).toBe('Elle düzeltildi');
    expect(tripDriverLabel(v)).toBe('Ahmet');
  });

  it('D7. 🔒 tanınmayan durum/kaynak/güven UYDURULMAZ', () => {
    expect(normalizeAttributionStatus('HAYALI')).toBe('UNKNOWN');
    expect(normalizeAttributionConfidence('SUPREME')).toBe('UNKNOWN');
    const v = buildTripAttributionView({ driver_attribution_source: 'TAHMIN' });
    expect(v.source).toBe('UNKNOWN');
  });

  it('D8. 🔒 sunucu yönetici atamasına VERY_HIGH VERMEZ', () => {
    /* Bir yöneticinin ataması sürücünün direksiyonda olduğunu KANITLAMAZ. */
    const auto = MIGRATION_048.slice(MIGRATION_048.indexOf('_resolve_trip_driver'));
    const body = auto.slice(0, auto.indexOf('$fn$;'));
    expect(body).toContain("'ATTRIBUTED'::text, 'HIGH'::text");
    expect(body).not.toContain("'ATTRIBUTED'::text, 'VERY_HIGH'");
  });

  it('D9. 🔒 manuel atama otomatik VERY_HIGH ÜRETMEZ', () => {
    const man = MIGRATION_048.slice(
      MIGRATION_048.indexOf('FUNCTION public.manually_assign_trip_driver'));
    const body = man.slice(0, man.indexOf('$fn$;'));
    expect(body).toContain("driver_attribution_confidence = 'MEDIUM'");
    expect(body).not.toContain("driver_attribution_confidence = 'VERY_HIGH'");
  });
});

describe('Driver P0 · E. Trip görünümü zinciri', () => {
  function tripRow(over: Partial<TripRow> = {}): TripRow {
    return {
      trip_key: 'p0-1', started_at: '2026-07-30T10:00:00Z',
      distance_km: '12.5', confidence: 'HIGH', ...over,
    };
  }

  it('E1. 🔒 trip görünümü sürücü sonucunu TAŞIR', () => {
    const v = buildTripView(tripRow({
      driver_id: 'd1', driver_name: 'Ahmet',
      driver_attribution_status: 'ATTRIBUTED',
      driver_attribution_source: 'ACTIVE_ASSIGNMENT',
      driver_attribution_confidence: 'HIGH',
      driver_attribution_revision: 1,
    }));
    expect(v.driver.driverId).toBe('d1');
    expect(v.driver.status).toBe('ATTRIBUTED');
    expect(tripDriverLabel(v.driver)).toBe('Ahmet');
    expect(attributionConfidenceLabel(v.driver.confidence)).toBe('Yüksek');
  });

  it('E2. 🔒 sürücüsüz trip UNKNOWN — araç sahibine DÜŞMEZ', () => {
    const v = buildTripView(tripRow());
    expect(v.driver.status).toBe('UNKNOWN');
    expect(v.driver.driverId).toBeNull();
    expect(v.driver.driverName).toBeNull();
  });

  it('E3. 🔒 sürücü alanları trip METRİKLERİNİ etkilemez', () => {
    const withDriver = buildTripView(tripRow({ driver_id: 'd1', driver_name: 'A' }));
    const without = buildTripView(tripRow());
    expect(withDriver.distanceKm).toEqual(without.distanceKm);
    expect(withDriver.tripKey).toBe(without.tripKey);
  });
});

describe('Driver P0 · F. Ehliyet geçerliliği', () => {
  it('F1. 🔒 tarih yoksa "geçerli" DENMEZ', () => {
    expect(licenseValidity(null, T)).toBe('UNKNOWN');
    expect(licenseValidityLabel('UNKNOWN')).toBe('Bilinmiyor');
  });

  it('F2. 🔒 süresi dolmuş ehliyet işaretlenir', () => {
    expect(licenseValidity(T - H, T)).toBe('EXPIRED');
  });

  it('F3. 🔒 yakında dolan ehliyet uyarılır', () => {
    expect(licenseValidity(T + 10 * 24 * H, T)).toBe('EXPIRING_SOON');
  });

  it('F4. 🔒 geçerli ehliyet', () => {
    expect(licenseValidity(T + 200 * 24 * H, T)).toBe('VALID');
  });
});

describe('Driver P0 · G. Sunucu sözleşmesi (migration kilitleri)', () => {
  it('G1. 🔒 fallback sürücü ÜRETİLMEZ — owner/admin/son kullanıcı yok', () => {
    const fn = MIGRATION_048.slice(MIGRATION_048.indexOf('_resolve_trip_driver'));
    const body = fn.slice(0, fn.indexOf('$fn$;'))
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
    /* Karar YALNIZ atama tablosundan gelir. */
    expect(body).toContain('vehicle_driver_assignments');
    expect(body).not.toContain('owner_id');
    expect(body).not.toContain('auth.uid()');
    expect(body).not.toContain('profiles');
  });

  it('G2. 🔒 attribution TRIP zamanını kullanır (replay zamanını DEĞİL)', () => {
    const fn = MIGRATION_048.slice(MIGRATION_048.indexOf('_trip_attribution_trigger'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    expect(body).toContain('NEW.started_at');
    expect(body).toContain('NEW.ended_at');
  });

  it('G3. 🔒 MANUEL sonuç otomatik kararla EZİLMEZ', () => {
    const fn = MIGRATION_048.slice(MIGRATION_048.indexOf('_trip_attribution_trigger'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    expect(body).toContain("'LOCKED'");
    expect(body).toContain("'MANUAL_TRIP_ASSIGNMENT'");
    expect(body).toContain('RETURN NEW');
  });

  it('G4. 🔒 değişiklik yoksa revizyon ARTMAZ (replay şişirmesi yok)', () => {
    const fn = MIGRATION_048.slice(MIGRATION_048.indexOf('_trip_attribution_trigger'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    expect(body).toContain('IS NOT DISTINCT FROM');
  });

  it('G5. 🔒 araç devrinde açık atamalar KAPANIR', () => {
    expect(MIGRATION_048).toContain('trg_vehicle_transfer_assignments');
    const fn = MIGRATION_048.slice(
      MIGRATION_048.indexOf('_vehicle_transfer_close_assignments'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    expect(body).toContain("status = 'COMPLETED'");
    expect(body).toContain('ends_at IS NULL');
  });

  it('G6. 🔒 yetki fail-closed: yönetim yalnız admin', () => {
    const fn = MIGRATION_048.slice(
      MIGRATION_048.indexOf('FUNCTION public._fleet_driver_admin_company'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    expect(body).toContain("p.role = 'admin'");
  });

  it('G7. 🔒 anon sürücü verisine erişemez', () => {
    expect(MIGRATION_048).toContain('REVOKE ALL ON TABLE public.fleet_drivers');
    expect(MIGRATION_048).toContain('anon surucu verisini okuyabiliyor');
    expect(MIGRATION_048).toContain('anon surucu listesini cekebiliyor');
  });

  it('G8. 🔒 RLS açık + tenant izolasyonu', () => {
    expect(MIGRATION_048).toContain('ENABLE ROW LEVEL SECURITY');
    expect(MIGRATION_048).toContain('fleet_drivers_company_read');
    expect(MIGRATION_048).toContain('vda_company_read');
  });

  it('G9. 🔒 çakışma savunması: kısmi UNIQUE indeksler', () => {
    expect(MIGRATION_048).toContain('vda_vehicle_open_active_uniq');
    expect(MIGRATION_048).toContain('vda_driver_open_active_uniq');
  });

  it('G10. 🔒 yarış koruması: advisory lock', () => {
    expect(MIGRATION_048).toContain('pg_advisory_xact_lock');
  });

  it('G11. 🔒 sürücü HARD DELETE edilmez (geçmiş korunur)', () => {
    expect(MIGRATION_048).toContain("'ARCHIVED'");
    expect(MIGRATION_048).not.toMatch(/DELETE\s+FROM\s+public\.fleet_drivers/i);
  });

  it('G12. 🔒 manuel atama trip_key ve metrikleri DEĞİŞTİRMEZ', () => {
    const fn = MIGRATION_048.slice(
      MIGRATION_048.indexOf('FUNCTION public.manually_assign_trip_driver'));
    const body = fn.slice(0, fn.indexOf('$fn$;'));
    /* Kilit YALNIZ `SET` listesini inceler: `UPDATE`ten sonrasının tamamı
       alınırsa `WHERE … trip_key = p_trip_key` koşulu "trip_key yazılıyor"
       sanılır. Yazma ile FİLTRELEME karıştırılmamalı. */
    const from = body.indexOf('UPDATE public.vehicle_trips');
    const setBlock = body.slice(from, body.indexOf('WHERE', from))
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(setBlock).not.toMatch(/\btrip_key\s*=/);
    expect(setBlock).not.toMatch(/\bdistance_km\s*=/);
    expect(setBlock).not.toMatch(/^\s*revision\s*=/m);
    /* Yazılan alanların HEPSİ `driver_` önekli olmalı.
       (`matchAll` yayılımı website'in derleme hedefinde desteklenmiyor —
       satır taraması hem taşınabilir hem daha okunur.) */
    const assigned: string[] = [];
    for (const line of setBlock.split('\n')) {
      const m = /^\s{4}(\w+)\s*=/.exec(line);
      if (m !== null) assigned.push(m[1]);
    }
    expect(assigned.length).toBeGreaterThan(0);
    for (const col of assigned) expect(col.startsWith('driver_')).toBe(true);
  });

  it('G13. 🔒 TRIP METRICS P2 dedupe kısıtı korunur', () => {
    expect(MIGRATION_048).toContain('vehicle_trips_key_unique');
    expect(MIGRATION_048).toContain('trip dedupe UNIQUE kisiti kayboldu');
  });

  it('G14. 🔒 yardımcı fonksiyonlar ÇAĞRILARAK doğrulanır', () => {
    /* 047 dersi: plpgsql geç bağlanır; metne bakan denetim eksik
       fonksiyonu YAKALAMAZ. */
    expect(MIGRATION_048).toContain('PERFORM public._fleet_driver_admin_company()');
    expect(MIGRATION_048).toContain('FROM public._resolve_trip_driver(');
    expect(MIGRATION_048).toContain('atamasiz trip icin surucu uyduruldu');
  });

  it('G15. 🔒 yalnız ileri migration — 033–047 tablolarını düşürmez', () => {
    expect(MIGRATION_048).not.toMatch(/DROP\s+TABLE\s+public\.(vehicles|profiles|vehicle_trips)/i);
  });
});

describe('Driver P0 · H. Hata mesajları teknik sızıntı yapmaz', () => {
  it('H1. 🔒 gerekçeler kullanıcı diline çevrilir', () => {
    expect(driverRpcReasonLabel({
      state: 'CONFLICTED', reason: 'VEHICLE_OVERLAP',
      driverId: null, assignmentId: null, revision: null,
    })).toContain('başka bir sürücü atanmış');
  });

  it('H2. 🔒 başarı durumunda hata metni YOK', () => {
    expect(driverRpcReasonLabel({
      state: 'CREATED', reason: null, driverId: 'd', assignmentId: null, revision: 1,
    })).toBeNull();
  });

  it('H3. 🔒 metinlerde rpc/sql/null/tablo adı geçmez', () => {
    const reasons = ['NOT_AUTHORIZED', 'CROSS_TENANT', 'VEHICLE_OVERLAP',
      'DRIVER_OVERLAP', 'DRIVER_NOT_ACTIVE', 'INVALID_RANGE', 'BILINMEYEN'];
    for (const reason of reasons) {
      const msg = driverRpcReasonLabel({
        state: 'REJECTED', reason, driverId: null, assignmentId: null, revision: null,
      });
      expect(msg).not.toBeNull();
      expect(msg!.toLowerCase()).not.toMatch(/rpc|sql|null|undefined|fleet_drivers|vehicle_driver/);
    }
  });

  it('H4. 🔒 durum etiketleri tam kapsanır', () => {
    expect(driverStatusLabel('ARCHIVED')).toBe('Arşivlenmiş');
    expect(assignmentStatusLabel('CONFLICTED')).toBe('Çakışmalı');
  });
});
