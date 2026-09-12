/**
 * prodBaselineSecurityGuards.test.ts — ŞEMA GÜVENLİK KİLİTLERİNİN YENİ EVİ.
 *
 * ── NEDEN BU DOSYA VAR (kütük #588) ────────────────────────────────────────
 * Beş kilit dosyası (`geofenceCloudGuards` · `otaSchema` · `remoteLogGuards` ·
 * `voiceDiag` · `supportReaderGuard`) güvenlik iddialarını **tek tek migration
 * dosyalarının METNİNDEN** okuyordu. Kütük #583'ün baseline squash'ı 49 eski
 * migration'ı `supabase/migrations_archive/`'e taşıyınca bu kilitler **yükleme
 * anında düştü** — yani kasa kırmızıydı ve kilitler hiçbir şeyi korumuyordu.
 *
 * ── NEDEN BASELINE DAHA GÜÇLÜ BİR HEDEF ───────────────────────────────────
 * Eski kilitler "şu migration şunu yazmış mı"yı sorardı — yani bir NİYETİ.
 * `00000000000000_prod_baseline.sql` ise canlı prod kataloğundan **üretilmiş**
 * ve #583'te prod ile **2315/2315 anahtar** birebir eşleştiği ölçülmüştür.
 * Yani bu dosyaya sorulan soru artık *"üretimde gerçekten böyle mi"*dir.
 * Kilitler zayıflamadı — **hedefleri niyetten gerçeğe taşındı**.
 *
 * ── DÜRÜSTLÜK: BU DOSYA "HER ŞEY YOLUNDA" DEMEZ ───────────────────────────
 * Yeniden hedeflerken üç şey ÖLÇÜLDÜ ve eski kilitlerin beklediğinden farklı
 * çıktı. Hiçbiri gizlenmedi; her biri aşağıda kendi testiyle **beyan edilir**:
 *   1. OTA tablolarında `anon` **tam yazma** ayrıcalığına sahip (Supabase
 *      varsayılan ayrıcalıkları — kütük #582/D10). Tek savunma RLS'tir.
 *   2. `ota_apks` storage bucket'ı **prod'da YOK** — OTA APK depolama hiç
 *      kurulmamış; migration 019'un koruduğu şey üretimde mevcut değil.
 *   3. Fonksiyon **EXECUTE ayrıcalıkları baseline'a taşınmamış** — bu yüzden
 *      "push_vehicle_event anon'a açık" gibi iddialar burada doğrulanamaz.
 * Üçü de kütükte açık borçtur; kilit onları **sessizce doğru saymaz**.
 *
 * `?raw` bilinçlidir: transform-time sabittir, `readFileSync`in paralel-suite
 * flake'inden bağışıktır (regression.guards.test.ts dersi).
 */
import { describe, it, expect } from 'vitest';
import baselineSql from '../../supabase/migrations/00000000000000_prod_baseline.sql?raw';

/**
 * Negatif (mahremiyet) iddiaları YALNIZ çalıştırılabilir SQL'i denetlemeli.
 * `--` yorumları "anon"/"GRANT"/"USING (true)" gibi kelimeler taşır ve kilit
 * kendi açıklama metnine takılırdı (#467–#479'da ölçülmüş alt-dize tuzağı).
 */
const exec = baselineSql.replace(/--[^\n]*/g, '');

/** Bir tabloya verilen tüm GRANT satırları (yorumsuz SQL üzerinden). */
function grantsFor(table: string): string[] {
  const re = new RegExp(`GRANT[^;]*ON TABLE public\\."?${table}"?[^;]*;`, 'g');
  return exec.match(re) ?? [];
}

/** Bir fonksiyonun gövdesi — `$function$ … $function$` arası. */
function functionBody(signaturePrefix: string): string {
  const start = baselineSql.indexOf(`CREATE OR REPLACE FUNCTION public.${signaturePrefix}`);
  if (start < 0) return '';
  const end = baselineSql.indexOf('$function$;', start);
  return end < 0 ? '' : baselineSql.slice(start, end);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · KONUM MAHREMİYETİ — vehicle_geofences (eski geofenceCloudGuards)
 *
 * En kritik iddia: bir aracın `api_key`i ile TÜM araçların ev/park konumu
 * okunamaz. Cihaz erişimi yalnız SECURITY DEFINER RPC'den geçer.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('vehicle_geofences — 🔒 konum mahremiyeti (prod gerçeği)', () => {
  it('KİLİT: anon\'a TABLO GRANT\'i YOK (yalnız RPC ile erişilir)', () => {
    const grants = grantsFor('vehicle_geofences');
    expect(grants.length, 'GRANT satırı hiç yok — baseline eksik olabilir').toBeGreaterThan(0);
    for (const g of grants) {
      expect(g, `anon'a tablo GRANT'i sızmış: ${g}`).not.toMatch(/\banon\b/);
    }
    // Ayrıca açıkça geri alınmış olmalı (defense-in-depth).
    expect(exec).toMatch(/REVOKE ALL ON TABLE public\."vehicle_geofences" FROM anon/);
  });

  it('KİLİT: RLS açık ve doğrudan okuma yalnız super_admin\'e', () => {
    expect(exec).toMatch(/ALTER TABLE public\."vehicle_geofences" ENABLE ROW LEVEL SECURITY/);
    expect(exec).toContain('CREATE POLICY "superadmin_select_vehicle_geofences"');
    expect(exec).toMatch(/\(auth\.jwt\(\) -> 'app_metadata'::text\) ->> 'role'::text\) = 'super_admin'/);
  });

  it('KİLİT: hiçbir geofence politikası TÜM satırları açmaz (USING(true) yok)', () => {
    /* Politika bloğunu izole et — baseline'ın başka yerlerinde meşru
       `USING (true)` bulunabilir; iddia YALNIZ bu tabloya aittir. */
    const idx = exec.indexOf('CREATE POLICY "superadmin_select_vehicle_geofences"');
    expect(idx).toBeGreaterThan(-1);
    const policy = exec.slice(idx, idx + 400);
    expect(policy).not.toMatch(/USING\s*\(\s*\(?\s*true\s*\)?\s*\)/i);
  });

  const RPCS = ['push_geofence_zone', 'get_geofence_zones', 'delete_geofence_zone'];
  for (const rpc of RPCS) {
    it(`KİLİT: ${rpc} SECURITY DEFINER + api_key auth + fail-closed`, () => {
      const body = functionBody(`${rpc}(`);
      expect(body, `${rpc} prod'da yok`).not.toBe('');
      expect(body).toContain('SECURITY DEFINER');
      expect(body).toMatch(/SET search_path TO 'public'/);
      // api_key hash'li de olabilir (024a) — iki biçim de kabul, kapı aynı.
      expect(body).toMatch(/coalesce\(api_key_hash, api_key\) = p_api_key/);
      expect(body).toMatch(/RAISE EXCEPTION 'invalid_api_key' USING ERRCODE = 'P0001'/);
    });
  }

  it('KİLİT: get_geofence_zones yalnız ÇÖZÜLEN aracın aktif bölgelerini döndürür', () => {
    const body = functionBody('get_geofence_zones(');
    expect(body).toMatch(/WHERE vehicle_id = v_vehicle_id::text\s+AND is_active = true/);
    // Araç kimliği dışarıdan DEĞİL, api_key'den çözülür — parametreyle gelemez.
    expect(body).not.toMatch(/p_vehicle_id/);
  });

  it('KİLİT: delete_geofence_zone soft-delete ve araç kapsamlı', () => {
    const body = functionBody('delete_geofence_zone(');
    expect(body).toMatch(/SET is_active = false, updated_at = now\(\)/);
    expect(body).toMatch(/WHERE vehicle_id = v_vehicle_id::text\s+AND id = p_zone_id/);
  });

  it('şema sözleşmesi: composite PK + type CHECK korunuyor', () => {
    expect(exec).toMatch(/PRIMARY KEY \(vehicle_id, id\)/);
    expect(exec).toMatch(/CHECK \(\(type = ANY \(ARRAY\['polygon'::text, 'circle'::text\]\)\)\)/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · UZAK LOG BEKÇİLERİ — push_vehicle_event (eski remoteLogGuards + voiceDiag)
 *
 * Bir aracın sınırsız log basıp tabloyu şişirmesi ve maliyeti patlatması
 * engellenir: boyut kırpma + rate limit + retention.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('push_vehicle_event — log bekçileri (prod gerçeği)', () => {
  const body = functionBody('push_vehicle_event(');

  it('KİLİT: fonksiyon prod\'da var, imza ve dönüş tipi korunuyor', () => {
    expect(body).not.toBe('');
    expect(baselineSql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.push_vehicle_event\(p_api_key text, p_type text, p_payload jsonb DEFAULT '\{\}'::jsonb\)\s*\n\s*RETURNS uuid/);
  });

  it('KİLİT: api_key fail-closed — çözülemezse istisna, sessiz kabul YOK', () => {
    expect(body).toMatch(/coalesce\(api_key_hash, api_key\) = p_api_key/);
    expect(body).toMatch(/IF v_vehicle_id IS NULL THEN\s+RAISE EXCEPTION 'invalid_api_key'/);
  });

  it('KİLİT: payload boyut tavanı VAR ve kırpma dalı çalışır', () => {
    /* Sabitin DEĞERİ prod'da 16KB'den 64KB'ye çıkarılmış (bilinçli genişletme).
       Kilit sayıyı dondurmaz — **tavanın varlığını** ve makul kalmasını korur:
       tavan kalkarsa ya da saçma bir değere çıkarsa bu test düşer. */
    const m = body.match(/c_max_bytes\s+constant integer\s+:=\s+(\d+)/);
    expect(m, 'boyut tavanı sabiti kaldırılmış').toBeTruthy();
    const maxBytes = Number(m![1]);
    expect(maxBytes).toBeGreaterThan(0);
    expect(maxBytes).toBeLessThanOrEqual(262_144);   // 256KB üstü = fiilen sınırsız
    expect(body).toMatch(/IF octet_length\(v_payload::text\) > c_max_bytes THEN/);
  });

  it('KİLİT: kırpılmış payload güvenli alanlara indirgenir', () => {
    expect(body).toMatch(/'truncated', true/);
    expect(body).toMatch(/'ctx',\s+left\(v_payload->>'ctx',\s*256\)/);
    expect(body).toMatch(/'msg',\s+left\(v_payload->>'msg',\s*2048\)/);
    // errorCode yalnız VARSA yazılır.
    expect(body).toMatch(/jsonb_strip_nulls\(jsonb_build_object\(/);
  });

  it('KİLİT: tavanın ALTINDAKİ payload aynen geçer (v_store önce atanır)', () => {
    const passthrough = body.indexOf('v_store := v_payload;');
    const truncCheck  = body.indexOf('octet_length(v_payload::text) > c_max_bytes');
    expect(passthrough).toBeGreaterThan(-1);
    expect(truncCheck).toBeGreaterThan(passthrough);
  });

  it('KİLİT: audit insert KIRPILMIŞ değeri yazar (ham payload değil)', () => {
    expect(body).toMatch(/INSERT INTO public\.vehicle_events \(vehicle_id, type, metadata\)\s+VALUES \(v_vehicle_id::text, p_type, v_store\)/);
  });

  it('KİLİT: rate limit 60 sn penceresi + tavan, YALNIZ log tiplerine', () => {
    expect(body).toContain("interval '60 seconds'");
    expect(body).toMatch(/c_rate_max\s+constant integer\s+:=\s+30/);
    expect(body).toMatch(/IF p_type = ANY \(c_log_types\) THEN/);
  });

  it('KİLİT: rate aşımı ÇÖKME değil kontrollü no-op (RETURN NULL)', () => {
    expect(body).toMatch(/IF v_recent >= c_rate_max THEN\s+RETURN NULL;/);
    // Gövdedeki tek istisna api_key kapısıdır — rate dalı RAISE ETMEZ.
    expect(body.match(/RAISE EXCEPTION/g) ?? []).toHaveLength(1);
  });

  it('KİLİT: voice_diag üç bekçinin de kapsamında (eski voiceDiag kilidi)', () => {
    // 1) rate limit listesi
    expect(body).toMatch(/c_log_types\s+constant text\[\]\s+:= ARRAY\[[^\]]*'voice_diag'[^\]]*\]/);
    // 2) retention DELETE listesi
    const cleanup = functionBody('cleanup_vehicle_log_events(');
    expect(cleanup).toMatch(/WHERE type IN \([^)]*'voice_diag'[^)]*\)/);
    // 3) kısmi indeksin WHERE listesi
    const idx = exec.slice(exec.indexOf('CREATE INDEX IF NOT EXISTS idx_vehicle_events_log_rate'));
    expect(idx.slice(0, 400)).toContain("'voice_diag'::text");
  });

  it('KİLİT: system_health log tipi DEĞİL — telemetri bekçilere takılmaz', () => {
    const m = body.match(/c_log_types\s+constant text\[\]\s+:= ARRAY\[([^\]]*)\]/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toContain('system_health');
  });

  it('KİLİT: konum köprüsü ORİJİNAL payload\'dan okur (kırpma lat/lng\'i yemez)', () => {
    expect(body).toMatch(/v_lat := NULLIF\(v_payload->>'lat', ''\)::double precision/);
    expect(body).toMatch(/INSERT INTO public\.vehicle_locations \(vehicle_id, company_id, lat, lng, heading_deg\)/);
  });

  it('KİLİT: rate sorgusunu destekleyen kısmi indeks duruyor', () => {
    expect(exec).toMatch(/CREATE INDEX IF NOT EXISTS idx_vehicle_events_log_rate ON public\.vehicle_events USING btree \(vehicle_id, created_at DESC\)/);
  });
});

describe('cleanup_vehicle_log_events — retention (prod gerçeği)', () => {
  const body = functionBody('cleanup_vehicle_log_events(');

  it('KİLİT: 30 gün ve YALNIZ log tipleri silinir (audit olayları korunur)', () => {
    expect(body).not.toBe('');
    expect(body).toContain("created_at < now() - interval '30 days'");
    const del = body.slice(body.indexOf('DELETE FROM public.vehicle_events'));
    expect(del).toMatch(/WHERE type IN \('critical_error','crash','log','obd_diag','support_snapshot','ota_event','voice_diag'\)/);
  });

  it('KİLİT: SECURITY DEFINER + sabit search_path (arama yolu kaçırma yok)', () => {
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toMatch(/SET search_path TO 'public'/);
  });
});

describe('vehicle_events — RLS (log tablosunun kendisi)', () => {
  it('KİLİT: RLS açık ve okuma politikası araç sahipliğine bağlı', () => {
    expect(exec).toMatch(/ALTER TABLE public\."vehicle_events" ENABLE ROW LEVEL SECURITY/);
    expect(exec).toContain('CREATE POLICY "Kendi araç olaylarını oku"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · DESTEK RAPORU OKUYUCUSU — get_support_reports (eski supportReaderGuard)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('get_support_reports — destek okuma kapısı (prod gerçeği)', () => {
  const body = functionBody('get_support_reports(');

  it('KİLİT: token bcrypt ile doğrulanır, eşleşmezse 42501', () => {
    expect(body).not.toBe('');
    expect(body).toMatch(/secret_hash = crypt\(p_secret, s\.secret_hash\)/);
    expect(body).toMatch(/RAISE EXCEPTION 'get_support_reports: yetkisiz/);
    expect(body).toMatch(/errcode = '42501'/);
  });

  it('KİLİT: YALNIZ support_snapshot döner — genel olay okuyucusuna dönüşmez', () => {
    expect(body).toMatch(/WHERE e\.type = 'support_snapshot'/);
  });

  it('KİLİT: sayfa boyutu sınırlı (sınırsız dışa aktarım yok)', () => {
    expect(body).toMatch(/LIMIT LEAST\(GREATEST\(coalesce\(p_limit, 5\), 1\), 50\)/);
  });

  it('KİLİT: baseline SIR içermez (JWT / bcrypt hash literali yok)', () => {
    const SECRET_LITERAL = /eyJ[A-Za-z0-9_-]{20,}|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{20,}/;
    expect(SECRET_LITERAL.test(baselineSql)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · OTA — ota_releases / rollout_plans (eski otaSchema)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('OTA — şema ve erişim (prod gerçeği)', () => {
  it('KİLİT: ota_releases status kümesi {draft, active, paused, revoked}', () => {
    expect(exec).toMatch(/ota_releases_status_check.*CHECK \(\(status = ANY \(ARRAY\['draft'::text, 'active'::text, 'paused'::text, 'revoked'::text\]\)\)\)/s);
  });

  it('KİLİT: her iki OTA tablosunda da RLS AÇIK', () => {
    expect(exec).toMatch(/ALTER TABLE public\."ota_releases" ENABLE ROW LEVEL SECURITY/);
    expect(exec).toMatch(/ALTER TABLE public\."rollout_plans" ENABLE ROW LEVEL SECURITY/);
  });

  it('KİLİT: cihaz YALNIZ aktif sürümü görür (pause = anında gizlenir)', () => {
    const idx = exec.indexOf('CREATE POLICY "ota_releases_device_read"');
    expect(idx).toBeGreaterThan(-1);
    const policy = exec.slice(idx, idx + 300);
    expect(policy).toMatch(/FOR SELECT/);
    expect(policy).toMatch(/TO "anon"/);
    expect(policy).toMatch(/USING \(\(status = 'active'::text\)\)/);
  });

  it('KİLİT: yazma super_admin rolüne kapalı tutulur', () => {
    expect(exec).toContain('CREATE POLICY "ota_releases_superadmin_all"');
    expect(exec).toContain('CREATE POLICY "superadmin_rollouts"');
    const idx = exec.indexOf('CREATE POLICY "ota_releases_superadmin_all"');
    expect(exec.slice(idx, idx + 400)).toMatch(/->> 'role'::text\) = 'super_admin'/);
  });

  it('cihaz sorgu indeksi duruyor (channel, status, version_code DESC)', () => {
    expect(exec).toMatch(/idx_ota_releases_device_query/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · ÖLÇÜLEN SAPMALAR — "yolunda" DEMEYEN kilitler
 *
 * Aşağıdakiler bir kusuru KORUMAZ; kusurun **hâlâ orada olduğunu** kilitler.
 * Kusur düzeltilirse bu testler düşer — bu İSTENEN davranıştır: düzeltme
 * bilinçli olur, kütüğe işlenir ve kilit yeni gerçeğe güncellenir.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('ölçülen sapmalar — beyan edilir, doğru sayılmaz (kütük #588)', () => {
  it('SAPMA: OTA tablolarında anon TAM yazma ayrıcalıklı — tek savunma RLS', () => {
    /* Migration 018 yalnız `GRANT SELECT … TO anon` veriyordu. Prod'da
       Supabase varsayılan ayrıcalıkları yüzünden anon INSERT/UPDATE/DELETE de
       almış (kütük #582/D10: 22 tablonun 19'unda aynı durum). RLS politikaları
       erişimi tutuyor, ama defense-in-depth katmanı YOK.
       Bu bir AÇIK BORÇtur; daraltılırsa bu test düşer ve güncellenmelidir. */
    for (const table of ['ota_releases', 'rollout_plans']) {
      const anonGrants = grantsFor(table).filter((g) => /\banon\b/.test(g)).join(' ');
      expect(anonGrants, `${table}: anon GRANT satırı yok`).not.toBe('');
      expect(anonGrants, `${table}: anon artık yalnız SELECT — sapma kapanmış, kilidi güncelle`)
        .toMatch(/INSERT/);
    }
  });

  it('SAPMA: vehicle_geofences DOĞRU daraltılmış — karşı örnek (sapma evrensel değil)', () => {
    /* Aynı varsayılan ayrıcalık tuzağı `vehicle_geofences`te KAPATILMIŞ.
       Bu, yukarıdaki sapmanın "yapılamaz" değil "yapılmamış" olduğunu
       kanıtlar — konum tablosunda yapılabildiği ölçülmüştür. */
    const anonGrants = grantsFor('vehicle_geofences').filter((g) => /\banon\b/.test(g));
    expect(anonGrants).toHaveLength(0);
  });

  it('SAPMA: ota_apks storage bucket\'ı prod\'da YOK (OTA APK depolama kurulmamış)', () => {
    /* Migration 019 bucket'ı private + APK mime kısıtlı kuruyordu; prod'da
       hiç oluşmamış. Prod'daki tek bucket `sentry_clips`. Yani OTA dağıtımının
       depolama ucu ÜRÜNDE YOK — kilit bunu "korunuyor" diye göstermez. */
    expect(baselineSql).not.toContain("'ota_apks'");
    expect(baselineSql).toContain("'sentry_clips'");
  });

  it('SAPMA: fonksiyon EXECUTE ayrıcalıkları baseline\'a TAŞINMAMIŞ', () => {
    /* Baseline tablo ACL'lerini birebir taşıyor ama `GRANT EXECUTE ON FUNCTION`
       satırı hiç içermiyor. Sonuç: "push_vehicle_event anon'a açık mı",
       "cleanup yalnız service_role mü" gibi iddialar bu dosyadan
       DOĞRULANAMAZ — o kilitler bu turda geri getirilemedi.
       Baseline'a fonksiyon ACL'leri eklendiğinde bu test düşer ve ilgili
       kilitler geri yazılmalıdır. */
    expect(exec).not.toMatch(/GRANT\s+EXECUTE\s+ON FUNCTION/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · BASELINE'IN KENDİSİ — kilitlerin dayandığı zemin
 * ══════════════════════════════════════════════════════════════════════════ */

describe('baseline bütünlüğü', () => {
  it('KİLİT: baseline VERİ içermez (yalnız şema)', () => {
    /* YALNIZ üst düzey (girintisiz) INSERT'ler sayılır. Fonksiyon gövdelerinin
       İÇİNDEKİ INSERT'ler kodun kendisidir, veri değildir — tüm dosyada arama
       yapmak kilidi kendi meşru içeriğine takardı (#467–#479 alt-dize tuzağı).
       Tek meşru üst düzey INSERT storage bucket yapılandırmasıdır. */
    const topLevel = exec.match(/^INSERT INTO\s+(\S+)/gm) ?? [];
    const nonConfig = topLevel.filter((s) => !s.includes('storage.buckets'));
    expect(nonConfig, `baseline'a veri sızmış: ${nonConfig.join(', ')}`).toHaveLength(0);
  });

  it('KİLİT: baseline boş/kırpılmış değil (fonksiyon gövdeleri taşınıyor)', () => {
    expect(baselineSql.length).toBeGreaterThan(50_000);
    expect((baselineSql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBeGreaterThan(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · DÜRÜST NULL SÖZLEŞMESİ — yazıcı ile kolon kısıtı ÇELİŞEMEZ
 *
 * Cihazda ölçülen kusur (2026-08-16, Xiaomi 23090RA98I, CDP ağ yakalaması):
 * `push_vehicle_event` HER çağrıda HTTP 400 / SQLSTATE 23502 döndü —
 * "null value in column \"fuel\" of relation \"vehicle_telemetry\"".
 *
 * KÖK: 042 gövdeden `coalesce(...,0)`'ı kaldırıp bilinmeyeni NULL yaptı
 * (doğru), ama baseline'daki `NOT NULL` kolonlara DOKUNMADI. RPC'nin
 * `ON CONFLICT DO UPDATE` dalı korunaklı olduğu için kusur yalnız INSERT
 * yolunda görünür — yani ilk satırı olmayan araç ASLA satır oluşturamaz
 * ve kalıcı olarak çevrimdışı kalır.
 *
 * Bu kilit tek bir invaryantı korur: **bir kolona NULL yazan gövde varsa,
 * o kolon nullable OLMALI.** İki taraftan biri sessizce değişirse düşer.
 * ══════════════════════════════════════════════════════════════════════════ */

import fixSql from '../../supabase/migrations/20260816000066_telemetry_honest_null_columns.sql?raw';

describe('vehicle_telemetry — dürüst NULL sözleşmesi (#042 ↔ #066)', () => {
  /** Baseline'ın `vehicle_telemetry` CREATE TABLE gövdesi. */
  const createBody = (() => {
    const start = exec.indexOf('CREATE TABLE IF NOT EXISTS public."vehicle_telemetry"');
    if (start < 0) return '';
    const end = exec.indexOf(');', start);
    return end < 0 ? '' : exec.slice(start, end);
  })();

  /** 066'nın çalıştırılabilir SQL'i (yorumlar "NOT NULL" kelimesi taşır). */
  const fixExec = fixSql.replace(/--[^\n]*/g, '');

  const SINYAL_KOLONLARI = ['speed', 'fuel', 'rpm', 'temp'] as const;

  it('ÖLÇÜM: baseline bu kolonları NOT NULL + DEFAULT 0 ilan eder (kusurun zemini)', () => {
    /* Bu test "iyi" bir durumu değil, ölçülen GERÇEĞİ beyan eder. Baseline
       prod kataloğundan üretildiği için burada NOT NULL görmek, kusurun
       üretimde var olduğunun kanıtıdır. Baseline bir gün yeniden üretilir
       ve kısıt kalkmış olursa bu test düşer — o zaman 066 gereksizleşmiştir
       ve aşağıdaki kilitle birlikte gözden geçirilmelidir. */
    expect(createBody, 'baseline vehicle_telemetry tablosu bulunamadı').not.toBe('');
    for (const kolon of SINYAL_KOLONLARI) {
      expect(
        createBody,
        `baseline'da ${kolon} artık NOT NULL değil — 066 gözden geçirilmeli`,
      ).toMatch(new RegExp(`"${kolon}"[^,]*NOT NULL`));
    }
  });

  it('KİLİT: 066 dört sinyal kolonundan da NOT NULL kısıtını KALDIRIR', () => {
    for (const kolon of SINYAL_KOLONLARI) {
      expect(
        fixExec,
        `${kolon} için DROP NOT NULL yok — bilinmeyen sinyal yazılamaz, araç çevrimdışı kalır`,
      ).toMatch(new RegExp(`ALTER COLUMN\\s+${kolon}\\s+DROP NOT NULL`, 'i'));
    }
  });

  it('KİLİT: 066 sahte DEFAULT 0\'ı da düşürür (NULL "ölçülmedi", 0 "ölçüldü ve sıfır")', () => {
    /* DEFAULT 0 kalırsa kolonu atlayan her yazıcı yine uydurma bir ölçüm
       üretir — projenin "kanıtsız bilgi üretilmez" kuralının ihlali. */
    for (const kolon of SINYAL_KOLONLARI) {
      expect(
        fixExec,
        `${kolon} için DROP DEFAULT yok — sahte 0 başka bir yazıcıdan geri sızabilir`,
      ).toMatch(new RegExp(`ALTER COLUMN\\s+${kolon}\\s+DROP DEFAULT`, 'i'));
    }
  });

  it('KİLİT: 066 kendi sonucunu DOĞRULAR (sessiz kısmi uygulama olamaz)', () => {
    /* #582'nin dersi: uygulanmış görünen ama etkisiz kalan migration.
       066 sonunda information_schema'dan okuyup kalan kısıt varsa patlar. */
    expect(fixExec).toMatch(/information_schema\.columns/i);
    expect(fixExec).toMatch(/RAISE EXCEPTION\s*'066 DOĞRULAMA DÜŞTÜ/);
  });

  it('KİLİT: 066 ön koşul olarak 042 dürüst gövdesini arar', () => {
    /* Sahte 0 yazan eski gövdeyle nullable kolon kusuru GİZLENİR; kolonları
       gevşetmek ancak dürüst gövdeyle birlikte anlamlıdır. */
    expect(fixExec).toMatch(/push_vehicle_event/);
    expect(fixExec).toMatch(/RAISE EXCEPTION\s*'066 DURDU/);
  });
});
