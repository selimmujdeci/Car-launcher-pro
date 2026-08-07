/**
 * fleetMembershipFoundation.test.ts — MIGRATION 035 SÖZLEŞME KİLİDİ.
 *
 * ── ONARILAN KÖK NEDEN (production'da salt-okunur ÖLÇÜLDÜ) ──────────────────
 * Production envanteri 2026-07-29: auth.users = 2 · profiles = 0 · companies = 0.
 * Profil satırı hiç üretilmediği için `auth_company_id()` ve 034'ün
 * `SELECT p.company_id INTO v_company` okuması DAİMA NULL dönüyordu → filo
 * (şirket) dalı ulaşılamaz ölü yoldu ve her kullanıcı bireysel sayılıyordu.
 *
 * ── TEST TÜRÜ: SÖZLEŞME (SQL kaynak kilidi) ────────────────────────────────
 * Migration SQL'i METİN olarak okunur; veritabanı gerekmez. Kilitlenenler:
 * fail-closed ön koşullar, kimlik kaynağı (`auth.uid()`), cross-tenant devir
 * yasağı, advisory kilit, GRANT daraltmaları ve `pair_vehicle` anon kapaması.
 *
 * ⚠️ Gerçek Postgres davranışı burada KANITLANMAZ. Bu dosya "SQL bunu iddia
 * ediyor" der, "production'da çalıştı" DEMEZ — canlı doğrulama kütükte 🔴.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = '20260729000035_fleet_membership_foundation.sql';
const SQL_PATH = [
  resolve(process.cwd(), '..', 'supabase', 'migrations', MIGRATION),
  resolve(process.cwd(), 'supabase', 'migrations', MIGRATION),
].find((p) => existsSync(p));

const SQL = SQL_PATH ? readFileSync(SQL_PATH, 'utf8') : '';

describe('035 · migration dosyası', () => {
  it('migration SQL dosyası bulunur ve boş değildir', () => {
    expect(SQL_PATH).toBeTruthy();
    expect(SQL.length).toBeGreaterThan(500);
  });
});

describe('035 · fail-closed ön koşullar', () => {
  it('033 uygulanmadan DURUR (profiles.company_id NOT NULL ise exception)', () => {
    expect(SQL).toMatch(/IF v_prof_nullable <> 'YES' THEN/);
    expect(SQL).toMatch(/önce migration 033 uygulanmalı/);
  });

  it('companies tablosu yoksa DURUR', () => {
    expect(SQL).toMatch(/companies tablosu YOK/);
  });

  it('bilinmeyen profiles.role değeri varsa DURUR (mevcut satır kırılmaz)', () => {
    expect(SQL).toMatch(/bilinmeyen profiles\.role/);
  });
});

describe('035 · kök neden: profil üretimi', () => {
  it('auth.users üzerine AFTER INSERT tetikleyicisi kurar', () => {
    expect(SQL).toMatch(/AFTER INSERT ON auth\.users/);
    expect(SQL).toMatch(/EXECUTE FUNCTION public\.handle_new_user\(\)/);
  });

  it('varsayılan profil BİREYSEL olur — otomatik şirket üretilmez', () => {
    expect(SQL).toMatch(/VALUES \(NEW\.id, NULL, 'individual'\)/);
  });

  it('mevcut profili EZMEZ (idempotent)', () => {
    expect(SQL).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
  });

  it('profilsiz mevcut kullanıcıları backfill eder', () => {
    expect(SQL).toMatch(/FROM auth\.users u[\s\S]*LEFT JOIN public\.profiles p[\s\S]*WHERE p\.id IS NULL/);
  });

  it('backfill sonrası profilsiz kullanıcı kalmadığını DOĞRULAR', () => {
    expect(SQL).toMatch(/hâlâ profilsiz — backfill başarısız/);
  });
});

/**
 * ── STAGING'DE BULUNAN P0 (2026-07-29) ───────────────────────────────────────
 * Staging'de gerçek `auth.users` INSERT'ü şu hatayla PATLADI:
 *   new row for relation "profiles" violates check constraint "profiles_role_check"
 * Kök neden: depoda HİÇBİR migration dosyasında bulunmayan, bant-dışı eklenmiş
 * dar bir kısıt vardı → CHECK (role IN ('admin','member')). Postgres tüm
 * CHECK'leri AND'lediği için `role='individual'` YAZILAMIYORDU ve
 * `handle_new_user` her signup'ta patlıyordu → **auth kaydı tamamen kırık**.
 *
 * Bu kilitler onarımın geri gelmesini engeller.
 */
describe('035 · bant-dışı eski rol kısıtının uzlaştırılması (staging P0 + R2 sertleştirmesi)', () => {
  /**
   * ── R2 (production preflight denetimi) ────────────────────────────────────
   * İLK onarım metin alt dizgesiyle hedefliyordu:
   *     pg_get_constraintdef(oid) LIKE '%role%' AND NOT LIKE '%individual%'
   * Bu kanıtlanmış şekilde `role <> 'individual'`i KAÇIRIYOR, `role_description`
   * gibi alakasız kısıtı SİLİYOR, ENUM/DOMAIN/trigger'ı hiç görmüyordu; öz-test
   * de AYNI yüklemi kullandığı için kusuru doğrulayamıyordu.
   *
   * Aşağıdaki kilitler METİN EŞLEMESİNE DÖNÜŞÜ engeller.
   */

  it('🔒 R2: kısıt hedeflemesinde METİN eşlemesi KULLANILMAZ', () => {
    // Yalnız ÇALIŞTIRILABİLİR SQL denetlenir: `--` yorum satırları eski kusuru
    // BELGELEMEK için hâlâ anıyor; kilit belgeyi değil, kodu korumalı.
    const CODE = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

    expect(CODE).not.toMatch(/pg_get_constraintdef\([^)]*\)\s*(NOT\s+)?LIKE/);
    expect(CODE).not.toMatch(/NOT LIKE '%individual%'/);
    // Yorumlarda anılması SERBEST — hatta kusurun tekrar yazılmaması için GEREKLİ.
    expect(SQL).toMatch(/ÖNCEKİ SÜRÜMÜN KUSURU/);
  });

  it('🔒 R2: kolon bağımlılığı conkey → pg_attribute ile SEMANTİK bulunur', () => {
    expect(SQL).toMatch(/a\.attnum\s*=\s*ANY\s*\(\s*r\.conkey\s*\)/);
    expect(SQL).toMatch(/pg_attribute/);
  });

  it('🔒 R2: role"e bağlı OLMAYAN kısıta ASLA dokunulmaz', () => {
    expect(SQL).toMatch(/NOT \('role' = ANY \(v_cols\)\)/);
    expect(SQL).toMatch(/v_kept/);
  });

  it('🔒 R2: ÇOK SÜTUNLU role kısıtı otomatik DROP edilmez (fail-closed)', () => {
    expect(SQL).toMatch(/MULTICOLUMN_ROLE_CHECK/);
    expect(SQL).toMatch(/array_length\(v_cols, 1\) > 1/);
  });

  it('🔒 R2: blocker kararı ifadenin GERÇEKTEN DEĞERLENDİRİLMESİYLE verilir', () => {
    expect(SQL).toMatch(/pg_get_expr\(r\.conbin, r\.conrelid\)/);
    expect(SQL).toMatch(/SELECT coalesce\(\(%s\), true\)/);
  });

  it('🔒 R2: değerlendirilemeyen kısıt SESSİZCE GEÇMEZ', () => {
    expect(SQL).toMatch(/UNCLASSIFIABLE_CHECK/);
  });

  it('🔒 R2: ENUM ve DOMAIN rol tipi fail-closed DURDURUR', () => {
    expect(SQL).toMatch(/ROLE_TYPE_ENUM/);
    expect(SQL).toMatch(/ROLE_TYPE_DOMAIN/);
    // Otomatik tip dönüştürme YASAK.
    expect(SQL).not.toMatch(/ALTER COLUMN role TYPE/);
  });

  it('🔒 R2: incelenmemiş INSERT/UPDATE trigger"ı fail-closed DURDURUR', () => {
    expect(SQL).toMatch(/UNREVIEWED_TRIGGER/);
    expect(SQL).toMatch(/tgtype & 4/);
    expect(SQL).toMatch(/tgtype & 16/);
    // Alakasız trigger SİLİNMEZ.
    expect(SQL).not.toMatch(/DROP TRIGGER(?!\s+IF EXISTS on_auth_user_created)/);
  });

  it('🔒 R2: trigger onay listesi boşken fail-OPEN olmaz', () => {
    // `<> ALL (NULL)` NULL döner ve kapıyı sessizce açardı — boş DİZİ kullanılmalı.
    expect(SQL).toMatch(/ARRAY\[\]::text\[\]/);
  });

  it('🔒 R2: öz-test GERÇEK INSERT dener (metin yüklemi TEKRAR EDİLMEZ)', () => {
    expect(SQL).toMatch(/LIKE public\.profiles INCLUDING CONSTRAINTS/);
    expect(SQL).toMatch(/INSERT INTO _m035_role_probe/);
    expect(SQL).toMatch(/SELFTEST_CHECK/);
    expect(SQL).toMatch(/SELFTEST_TYPE/);
  });

  it('🔒 R2: öz-test FK gerektiren sahte auth.users satırı ÜRETMEZ', () => {
    expect(SQL).toMatch(/FK kopyalanmaz/);
    expect(SQL).not.toMatch(/INSERT INTO auth\.users/);
  });

  it('🔒 R2: reddeden kısıtın adı Postgres"ten alınır (tahmin YOK)', () => {
    expect(SQL).toMatch(/GET STACKED DIAGNOSTICS .*CONSTRAINT_NAME/);
  });

  it('🔒 R2: ATOMİKLİK kapısı — tek transaction KANITLANIR', () => {
    expect(SQL).toMatch(/_m035_txn_probe/);
    expect(SQL).toMatch(/ON COMMIT DROP/);
    expect(SQL).toMatch(/DURDU \[ATOMICITY\]/);
  });

  it('🔒 R2: backfill ön kapıları YIKICI adımdan ÖNCE gelir', () => {
    const gateIdx = SQL.indexOf('BACKFILL_NOT_NULL');
    const dropIdx = SQL.indexOf('DROP CONSTRAINT %I');
    expect(gateIdx).toBeGreaterThan(0);
    expect(dropIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(dropIdx);   // kapı önce, yıkım sonra
  });

  it('🔒 R2: backfill PK/orphan/NOT NULL kapıları vardır', () => {
    expect(SQL).toMatch(/BACKFILL_NOT_NULL/);
    expect(SQL).toMatch(/BACKFILL_NO_PK/);
    expect(SQL).toMatch(/ORPHAN_PROFILES/);
  });

  it('yeni kısıt eskisinin ÜST KÜMESİDİR — güvenlik gevşemez', () => {
    expect(SQL).toMatch(/role IN \('individual','member','observer','admin','super_admin'\)/);
  });

  it('🔒 rol kümesi kısıtı kurulamadıysa da DURUR', () => {
    expect(SQL).toMatch(/profiles_role_allowed kısıtı kurulamadı/);
  });
});

describe('035 · create_company güvenlik sözleşmesi', () => {
  it('kimliği SUNUCUDAN alır — istemciden user_id KABUL ETMEZ', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.create_company\(p_name text\)/);
    expect(SQL).toMatch(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
  });

  it('kimliksiz çağrıyı reddeder', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'unauthenticated'/);
  });

  it('sessiz tenant değişimini reddeder (zaten şirketliyse hata)', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'already_member_of_company'/);
  });

  it('yarışla iki şirket kurulmasını advisory kilitle engeller', () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_uid::text, 1\)\)/);
  });

  it('şirket adını sunucuda doğrular', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'invalid_company_name'/);
  });

  it('kurucu admin rolü alır', () => {
    expect(SQL).toMatch(/SET company_id = v_company,[\s\S]*role\s*=\s*'admin'/);
  });
});

describe('035 · add_company_member güvenlik sözleşmesi', () => {
  it('yalnız o şirketin admini çağırabilir', () => {
    expect(SQL).toMatch(/v_admin_role IS DISTINCT FROM 'admin'/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'not_company_admin'/);
  });

  it('cross-tenant üye taşımayı reddeder', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'user_belongs_to_another_company'/);
  });

  it('hayalet üyeliği reddeder (hedef gerçek auth kullanıcısı olmalı)', () => {
    expect(SQL).toMatch(/RAISE EXCEPTION 'target_user_not_found'/);
  });

  it('serbest metin rolü reddeder — yalnız member/observer/admin', () => {
    expect(SQL).toMatch(/p_role NOT IN \('member', 'observer', 'admin'\)/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'invalid_role'/);
  });

  it('rol kümesini veritabanı kısıtıyla da kilitler', () => {
    expect(SQL).toMatch(/CONSTRAINT profiles_role_allowed/);
  });
});

describe('035 · GRANT daraltmaları', () => {
  it("üyelik RPC'leri anon'a KAPALI", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.create_company\(text\)\s+FROM PUBLIC, anon/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.add_company_member\(uuid, text\)\s+FROM PUBLIC, anon/);
  });

  it("üyelik RPC'leri authenticated'a açık (kimlik auth.uid() ile gelir)", () => {
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_company\(text\)\s+TO authenticated, service_role/);
  });

  it('anon açık kalırsa migration KENDİNİ DURDURUR', () => {
    expect(SQL).toMatch(/üyelik RPC''leri anon''a AÇIK — güvenlik ihlali/);
  });
});

describe('035 · pair_vehicle anon açığının kapatılması', () => {
  it('anon ve authenticated EXECUTE geri alınır', () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.pair_vehicle\(text\) FROM PUBLIC, anon, authenticated/);
  });

  it('yalnız service_role çağırabilir', () => {
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.pair_vehicle\(text\) TO service_role/);
  });

  it('fonksiyon yoksa daraltmayı atlar (fail-soft, migration patlamaz)', () => {
    expect(SQL).toMatch(/IF EXISTS \([\s\S]*proname = 'pair_vehicle'[\s\S]*\) THEN/);
  });

  it('hâlâ açıksa migration KENDİNİ DURDURUR', () => {
    expect(SQL).toMatch(/pair_vehicle hâlâ istemci rollerine AÇIK — güvenlik ihlali/);
  });

  it('pair_vehicle GÖVDESİNİ değiştirmez — yalnız yetki daraltır', () => {
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.pair_vehicle/);
  });
});

describe('035 · kapsam sınırı (mevcut mimariyi bozmama kilidi)', () => {
  it('araç sahipliğine DOKUNMAZ (vehicles UPDATE yok)', () => {
    expect(SQL).not.toMatch(/UPDATE public\.vehicles/);
  });

  it("034'ün pair_vehicle_to_user sözleşmesini DEĞİŞTİRMEZ", () => {
    expect(SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.pair_vehicle_to_user/);
  });

  it('mevcut RLS politikalarını yeniden yazmaz', () => {
    expect(SQL).not.toMatch(/CREATE POLICY/);
    expect(SQL).not.toMatch(/DROP POLICY/);
  });

  it('hiçbir KALICI tabloyu DROP etmez', () => {
    // Kilit DARALTILDI (kaldırılmadı): R2 sertleştirmesi anlamsal öz-test için
    // GEÇİCİ bir probe tablo kurup siler. İzin verilen TEK DROP TABLE budur;
    // başka herhangi bir tablo DROP'u hâlâ YASAK.
    const drops = SQL.match(/DROP TABLE[^\n;]*/g) ?? [];
    for (const d of drops) {
      expect(d).toMatch(/_m035_role_probe/);
    }
    expect(SQL).not.toMatch(/DROP TABLE\s+(IF EXISTS\s+)?public\./);
    expect(SQL).not.toMatch(/DROP TABLE\s+(IF EXISTS\s+)?auth\./);
  });
});
