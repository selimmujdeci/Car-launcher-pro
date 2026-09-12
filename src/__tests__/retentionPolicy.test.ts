/**
 * retentionPolicy.test.ts — V-16/3 saklama politikasının KİLİTLERİ.
 *
 * ── NEDEN BU DOSYA VAR ──────────────────────────────────────────────────────
 * Asıl matris gerçek PostgreSQL'e karşı koşar (`npm run test:retention`) ve
 * Docker gerektirir. Bu vitest dosyası onun YERİNE geçmez; migration'ın ve
 * matrisin SÖZLEŞMESİNİ korur — Docker'sız CI'da da koşar.
 *
 * ── KAPATILAN BOŞLUK ───────────────────────────────────────────────────────
 * Enterprise sayfası "90 günlük rota ve sürüş geçmişi" vaat ediyordu. Ölçüm:
 * `vehicle_locations` 7 gün sonra siliniyordu ve `vehicle_trips` **HİÇ
 * SİLİNMİYORDU** — yani "sürüş geçmişi" için bir politika YOKTU ve tablo
 * SONSUZ BÜYÜYORDU. Süreler ayrıca fonksiyon gövdesine gömülüydü.
 *
 * ── ÜRETİM KANITI (2026-08-22) ─────────────────────────────────────────────
 * Migration prod'a uygulandı ve `cleanup_old_telemetry()` çalıştırıldı:
 * politika yürürlükte (trips 90 · locations 30 · events 90), silinen yolculuk
 * ve konum **0** (bu kadar eski veri yok), yalnız 6 süresi dolmuş bağlama kodu
 * temizlendi. `skipped_missing` ve `skipped_schema_mismatch` prod'da BOŞ.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260822000067_retention_policy_p1.sql'), 'utf8');
const MATRIX = readFileSync(
  resolve(process.cwd(), 'supabase/tests/065_retention_policy_matrix.sql'), 'utf8');
const PKG = readFileSync(resolve(process.cwd(), 'package.json'), 'utf8');

describe('saklama politikası › tek otorite', () => {
  it('süreler TABLODAN okunur — fonksiyon gövdesine GÖMÜLMEZ', () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.retention_policy/);
    /* Temizlik fonksiyonu her süreyi `_retention_days` ile almalı. */
    const fn = MIG.slice(MIG.indexOf('FUNCTION public.cleanup_old_telemetry'));
    for (const t of ['vehicle_locations', 'telemetry_events', 'vehicle_commands',
                     'command_logs', 'vehicle_trips']) {
      expect(fn, `${t} süresi politikadan okunmuyor`)
        .toMatch(new RegExp(`_retention_days\\('${t}'`));
    }
    /* Gövdede sabit gün sayısıyla `interval` KALMAMALI. */
    expect(fn).not.toMatch(/interval '\d+ days'/);
  });

  it('Enterprise vaadi: sürüş geçmişi 90 GÜN', () => {
    expect(MIG).toMatch(/\('vehicle_trips', 90,/);
  });

  it('politika satırı silinse bile SONSUZ saklamaya düşülmez', () => {
    /* `_retention_days` kayıt yoksa çağıranın varsayılanını döner. */
    expect(MIG).toMatch(/COALESCE\(\(SELECT retain_days FROM public\.retention_policy/);
  });
});

describe('saklama politikası › veri kaybı savunmaları', () => {
  it('SÜREN yolculuk (ended_at NULL) ASLA silinmez', () => {
    const fn = MIG.slice(MIG.indexOf('FUNCTION public.cleanup_old_telemetry'));
    expect(fn, 'süren yolculuk yaşına bakılıp silinirse aktif seyahat kaybolur')
      .toMatch(/ended_at IS NOT NULL AND ended_at </);
  });

  it('yalnız TERMİNAL komutlar silinir — yürüyen komut DOKUNULMAZ', () => {
    const fn = MIG.slice(MIG.indexOf('FUNCTION public.cleanup_old_telemetry'));
    expect(fn).toMatch(/status IN \(''completed'',''failed'',''expired'',''rejected''\)/);
    expect(fn).not.toMatch(/'pending'|'accepted'|'executing'/);
  });

  it('matris sınırın İKİ TARAFINI da ölçer — "silindi" yetmez', () => {
    /* ① eski silinmeli ② YENİ KALMALI. İkincisi olmadan bir hata tüm
       müşteri verisini silerken test yeşil kalırdı. */
    expect(MATRIX).toMatch(/VERI KAYBI/);
    expect(MATRIX).toMatch(/SILINMEDI \(sonsuz buyume\)/);
    expect(MATRIX).toMatch(/SUREN yolculuk silindi/);
  });

  it('matris politikanın GERÇEKTEN etkili olduğunu sınar (tablo tiyatro değil)', () => {
    expect(MATRIX).toMatch(/UPDATE public\.retention_policy SET retain_days = 7/);
    expect(MATRIX).toMatch(/tablo TIYATRO demektir/);
  });
});

describe('saklama politikası › eksik şema SESSİZ kalmaz', () => {
  it('olmayan TABLO ile olmayan KOLON AYRI raporlanır', () => {
    /* Depoda iki migration zinciri var; bazı tablolar prod'da VAR yerelde YOK.
       Tek bir DELETE fonksiyonun tamamını düşürür ve o günün temizliği HİÇ
       koşmaz. Ama atlamak SESSİZ olursa bir tablo yıllarca büyüyebilir. */
    expect(MIG).toMatch(/'skipped_missing'/);
    expect(MIG).toMatch(/'skipped_schema_mismatch'/);
    expect(MIG).toMatch(/RETURN -1;/);   // tablo yok
    expect(MIG).toMatch(/RETURN -2;/);   // kolon yok
  });

  it('kolon varlığı GERÇEKTEN doğrulanır', () => {
    expect(MIG).toMatch(/information_schema\.columns/);
  });
});

describe('saklama politikası › erişim fail-closed', () => {
  it('politika tablosu anon/authenticated\'a KAPALI ve RLS AÇIK', () => {
    expect(MIG).toMatch(/REVOKE ALL ON TABLE public\.retention_policy FROM anon, authenticated, PUBLIC/);
    expect(MIG).toMatch(/ALTER TABLE public\.retention_policy ENABLE ROW LEVEL SECURITY/);
  });

  it('temizlik fonksiyonu anon tarafından ÇALIŞTIRILAMAZ', () => {
    /* Aksi hâlde kimliksiz biri veri silmeyi tetikleyebilirdi. */
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.cleanup_old_telemetry\(\) FROM anon/);
    expect(MATRIX).toMatch(/anon TEMIZLIGI CALISTIRABILIYOR/);
  });

  it('migration KENDİ doğrulamasını koşar (fail-closed)', () => {
    expect(MIG).toMatch(/067 DOGRULAMA: retention_policy uzerinde RLS KAPALI/);
    expect(MIG).toMatch(/anon\/authenticated tarafindan OKUNABILIYOR/);
  });
});

describe('saklama politikası › koşum', () => {
  it('npm betiği doğru matrisi ve doğru imzayı geçiriyor', () => {
    expect(PKG).toContain('065_retention_policy_matrix.sql');
    expect(PKG).toContain('4 HALKA DA GECTI');
    expect(MATRIX).toContain('4 HALKA DA GECTI');
  });

  it('matris SALT-OKUNUR: ROLLBACK ile biter', () => {
    expect(MATRIX.trimEnd().endsWith('ROLLBACK;')).toBe(true);
  });
});
