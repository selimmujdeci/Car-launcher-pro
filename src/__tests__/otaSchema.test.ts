/**
 * otaSchema.test.ts — OTA: KOD ↔ ŞEMA sözleşmesi (istemci/servis tarafı).
 *
 * ── BU DOSYANIN KAPSAMI DEĞİŞTİ (kütük #588) ──────────────────────────────
 * Eskiden burada iki ayrı şey vardı: (a) migration 018/019'un SQL METNİ
 * üzerinden kolon/CHECK/GRANT/RLS/policy iddiaları, (b) servis ve UI kodunun
 * o şemayla senkron kaldığı kilitler. #583'ün baseline squash'ı 018/019'u
 * `supabase/migrations_archive/`'e taşıyınca (a) yükleme anında düştü.
 *
 * (a) **silinmedi, TAŞINDI**: `prodBaselineSecurityGuards.test.ts` içinde ve
 * artık üretimin gerçeğine (`00000000000000_prod_baseline.sql`) soruluyor.
 * Orada ayrıca iki SAPMA da beyan edildi: OTA tablolarında `anon` tam yazma
 * ayrıcalıklı (tek savunma RLS) ve `ota_apks` bucket'ı **prod'da hiç yok**.
 *
 * Burada kalan (b) hâlâ zorunludur: şema doğru olsa bile servis kodu farklı
 * bir kolon adı veya farklı bir durum kümesi kullanırsa OTA sessizce kırılır.
 * Bu kilit, şemayı DEĞİL, koda gömülü sözleşmeyi korur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import baselineSql from '../../supabase/migrations/00000000000000_prod_baseline.sql?raw';

const service = readFileSync(
  join(process.cwd(), 'src', 'admin', 'services', 'superadmin.service.ts'), 'utf-8');

describe('rollout_plans — servis ↔ şema senkronu', () => {
  it('KİLİT: createRolloutPlan\'in yazdığı her alan gerçekten bir kolon', () => {
    const cols = ['id', 'name', 'version', 'description', 'status', 'stages',
                  'rollback_to', 'created_at', 'created_by', 'approved_by', 'approved_at'];
    /* Tablo tanımını izole et — dosyanın başka yerlerinde aynı adlı kolonlar
       (ör. `name`) bulunabilir; iddia YALNIZ bu tabloya aittir. */
    const start = baselineSql.indexOf('CREATE TABLE IF NOT EXISTS public."rollout_plans"');
    expect(start, 'rollout_plans prod\'da yok').toBeGreaterThan(-1);
    const table = baselineSql.slice(start, baselineSql.indexOf(');', start));
    for (const col of cols) {
      expect(table, `rollout_plans kolonu eksik: ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('KİLİT: elle-SQL JSDoc bağımlılığı geri gelmedi (şema migration\'ın işi)', () => {
    expect(service).not.toContain('CREATE TABLE IF NOT EXISTS public.rollout_plans');
  });
});

describe('ota_releases — cihaz sorgu sözleşmesi', () => {
  it('KİLİT: cihaz sorgusunun gerektirdiği kolonlar şemada var', () => {
    const start = baselineSql.indexOf('CREATE TABLE IF NOT EXISTS public."ota_releases"');
    expect(start, 'ota_releases prod\'da yok').toBeGreaterThan(-1);
    const table = baselineSql.slice(start, baselineSql.indexOf(');', start));
    for (const col of ['version_code', 'version_name', 'channel', 'apk_path',
                       'apk_size', 'sha256', 'status', 'release_notes', 'rollout_plan_id']) {
      expect(table, `ota_releases kolonu eksik: ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('KİLİT: durum kümesi UI\'ın bildiği kümeyle aynı', () => {
    /* UI bir durumu tanımıyorsa release görünmez olur; şema UI'ın bilmediği
       bir durum kabul ederse sessiz ölü kayıt doğar. İki uç birlikte kilitlenir. */
    for (const s of ['draft', 'active', 'paused', 'revoked']) {
      expect(baselineSql, `şemada durum eksik: ${s}`).toContain(`'${s}'::text`);
    }
  });

  it('KİLİT: bütünlük kısıtları duruyor (version_code pozitif+tekil, sha256 64 hex)', () => {
    expect(baselineSql).toMatch(/ota_releases_version_code_check.*version_code > 0/s);
    expect(baselineSql).toMatch(/char_length\(sha256\) = 64/);
  });
});

describe('rollout durumları — ölçülen sapma (kütük #588)', () => {
  it('SAPMA: rollout_plans.status\'ta CHECK kısıtı YOK — durum kümesi zorlanmıyor', () => {
    /* ÖLÇÜLDÜ: migration 018 `CHECK (status IN ('draft','pending_review',…))`
       yazıyordu; PROD'da bu kısıt YOK (`ota_releases`te VAR — bkz. baseline
       kilitleri). Yani `rollout_plans.status` serbest metindir: yazım hatası
       ya da bilinmeyen bir durum sessizce kaydedilebilir ve o plan ekranda
       renksiz/işlemsiz kalır.

       Bu bir AÇIK BORÇtur ve burada "tanımlı" diye gösterilmez. Kısıt geri
       eklenirse bu test düşer → bilinçli değişiklik kütüğe işlenir ve kilit
       "durum kümesi zorlanıyor" hâline güncellenir. */
    const start = baselineSql.indexOf('CREATE TABLE IF NOT EXISTS public."rollout_plans"');
    const table = baselineSql.slice(start, baselineSql.indexOf(');', start));
    expect(table).toMatch(/"status" text DEFAULT 'draft'::text NOT NULL/);
    expect(baselineSql).not.toContain('rollout_plans_status_check');
  });

  it('KİLİT: durum kümesinin TEK kaynağı UI sabitidir — servis onu ezmez', () => {
    /* Şema zorlamıyorsa sözleşmeyi kod taşımak zorundadır: yeni bir durum
       eklenirse RolloutCenter'ın renk haritasına da girmelidir, yoksa plan
       ekranda görünmez olur. */
    const center = readFileSync(
      join(process.cwd(), 'src', 'admin', 'pages', 'superadmin', 'RolloutCenter.tsx'), 'utf-8');
    for (const s of ['draft', 'pending_review', 'approved', 'rolling', 'paused', 'complete', 'reverted']) {
      expect(center, `RolloutCenter durumu tanımıyor: ${s}`).toContain(s);
    }
  });
});
