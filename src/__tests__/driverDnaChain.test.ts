/**
 * driverDnaChain.test.ts — V-11 Driver DNA zincir matrisinin KİLİTLERİ.
 *
 * ── NEDEN BU DOSYA VAR ──────────────────────────────────────────────────────
 * Asıl matris gerçek PostgreSQL'e karşı koşar (`npm run test:dna`) ve Docker
 * gerektirir. Bu vitest dosyası onun YERİNE geçmez; matrisin KENDİSİNİ korur —
 * Docker'sız CI'da da koşar.
 *
 * ── V-11'İN VARSAYIMI ARTIK KANIT ──────────────────────────────────────────
 * Plan, prod ölçümünden (31 yolculuk · 31 `UNKNOWN` · 0 atama · 0 DNA) şu sonucu
 * çıkarmıştı: *"besleme köprüsü ZATEN VAR ve ÇALIŞIYOR — sunucuda; zincir yalnız
 * ilk halkada kopuyor."* Ama zincirin geri kalanının çalıştığı **hiç
 * gözlemlenmemişti**: üretimde statü bir kez bile `UNKNOWN` dışında olmadı ve
 * `driver_dna` tablosuna bir kez bile satır düşmedi.
 *
 * 064 matrisi o varsayımı SINADI ve **6 halkanın 6'sı da geçti** (2026-08-22,
 * yerel PostgreSQL): statü `ATTRIBUTED` oluyor, DNA `trip_count = 3`'e birikiyor
 * ve aynı yolculuğun tekrar yüklenmesi sayacı ŞİŞİRMİYOR.
 *
 * ── MATRİSİ YAZARKEN ÇIKAN GERÇEK SÖZLEŞME KUSURLARI ───────────────────────
 * Matris ilk koşumlarda ÜÇ kez düştü ve her düşüş bir sözleşme gerçeğini
 * öğretti — üçü de **sessiz** kusur sınıfı (fonksiyon HATA FIRLATMAZ, dönüş
 * değeri okunmazsa "başarılı" sanılır):
 *   · `create_fleet_driver` → anahtar **`driverId`** (camelCase), `driver_id` DEĞİL
 *   · `create_vehicle_driver_assignment` → tip **BÜYÜK HARF** (`PRIMARY`);
 *     `'primary'` gönderilirse `REJECTED / INVALID_TYPE` döner
 *   · `upload_vehicle_trip` → metrik **`distanceKm`**; `distance_km` gönderilirse
 *     `REJECTED / NO_DISTANCE` döner ve yolculuk tabloya HİÇ DÜŞMEZ
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/tests/064_driver_dna_chain_matrix.sql'), 'utf8');
const PKG = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');

describe('Driver DNA zinciri › halkalar', () => {
  it('altı halkanın hepsi ayrı ayrı sınanıyor', () => {
    for (const ring of [0, 1, 2, 3, 4, 5]) {
      expect(SQL).toMatch(new RegExp(`HALKA ${ring}`));
    }
  });

  it('her halka EXCEPTION fırlatır — NOTICE ile geçiştirilmez', () => {
    for (const ring of [0, 1, 2, 3, 4, 5]) {
      expect(SQL).toMatch(new RegExp(`RAISE EXCEPTION[\\s\\S]{0,80}DNA HALKA ${ring} DUSTU`));
    }
  });

  it('ÇEKİRDEK: atama VARKEN statü hâlâ UNKNOWN ise düşer', () => {
    /* V-11'in teşhisi "yalnız veri eksik, kod sağlam"dı. Bu kilit onun
       yanlışlanabilir olmasını sağlar: atama varken bile UNKNOWN kalırsa
       sorun VERİ değil KODDUR. */
    const ring3 = SQL.slice(SQL.indexOf('HALKA 3 —'), SQL.indexOf('HALKA 4 —'));
    expect(ring3).toMatch(/st = 'UNKNOWN' OR did IS NULL/);
    expect(ring3).toMatch(/teshisi YANLIS demektir/);
  });

  it('DNA satırı yoksa düşer — "0 satır" sessizce geçmez', () => {
    const ring4 = SQL.slice(SQL.indexOf('HALKA 4 —'), SQL.indexOf('HALKA 5 —'));
    expect(ring4).toMatch(/driver_dna satiri YOK/);
    expect(ring4).toMatch(/trip_count/);
  });

  it('idempotans sınanıyor — tekrar yükleme sayacı şişiremez', () => {
    /* Çevrimdışı kuyruk aynı yolculuğu yeniden gönderebilir; sayaç artarsa
       sürücünün "deneyimi" uydurma olur ve güven skoru yalan söyler. */
    const ring5 = SQL.slice(SQL.indexOf('HALKA 5 —'));
    expect(ring5).toMatch(/dna_trip_key_1/);
    expect(ring5).toMatch(/3 kalmaliydi/);
  });

  it('yükleme dönüşü OKUNUYOR — REJECTED sessiz başarısızlıktır', () => {
    expect(SQL).toMatch(/v_res ->> 'state'\) = 'REJECTED'/);
  });
});

describe('Driver DNA zinciri › gerçek sözleşme', () => {
  it('camelCase anahtarlar kullanılıyor — snake_case sessizce reddedilir', () => {
    expect(SQL).toContain("->> 'driverId'");
    expect(SQL).toContain("'distanceKm'");
    expect(SQL).toContain("'harshBrakeCount'");
    /* Eski (yanlış) anahtarlar geri sızmamalı. */
    expect(SQL).not.toContain("'distance_km'");
    expect(SQL).not.toContain("->> 'driver_id'");
  });

  it('atama tipi BÜYÜK HARF — `primary` REJECTED/INVALID_TYPE döner', () => {
    expect(SQL).toContain("'PRIMARY'");
    expect(SQL).not.toMatch(/,\s*'primary',/);
  });
});

describe('Driver DNA zinciri › üretime dokunmaz', () => {
  it('ROLLBACK ile biter, COMMIT ETMEZ', () => {
    expect(SQL.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(SQL).not.toMatch(/^\s*COMMIT;/m);
  });

  it('`ON_ERROR_STOP` açık — halka düşünce dosya HATA ile biter', () => {
    expect(SQL).toMatch(/\\set ON_ERROR_STOP on/);
  });

  it('npm betiği doğru matrisi ve doğru başarı imzasını geçiriyor', () => {
    expect(PKG).toContain('064_driver_dna_chain_matrix.sql');
    expect(PKG).toContain('6 HALKA DA GECTI');
    expect(SQL).toContain('6 HALKA DA GECTI');
  });
});
