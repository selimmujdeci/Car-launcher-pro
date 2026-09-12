/**
 * geofenceCloudGuards.test.ts — Bulut geofence: İSTEMCİ TARAFI erişim kilidi.
 *
 * ── BU DOSYANIN KAPSAMI DEĞİŞTİ (kütük #588) ──────────────────────────────
 * Eskiden burada iki ayrı şey vardı: (a) migration 028'in SQL METNİ üzerinden
 * şema/RPC/GRANT iddiaları, (b) istemci kodunun okuma yolunu RPC'den geçirdiği
 * kilidi. #583'ün baseline squash'ı 028'i `supabase/migrations_archive/`'e
 * taşıyınca (a) yükleme anında düştü — kilitler ölüydü ve kasa kırmızıydı.
 *
 * (a) **silinmedi, TAŞINDI**: artık `prodBaselineSecurityGuards.test.ts`
 * içinde ve daha güçlü bir zemine oturuyor — migration'ın NİYETİ yerine
 * `00000000000000_prod_baseline.sql`, yani **üretimin gerçeği** sorgulanıyor.
 *
 * Burada kalan (b) hâlâ zorunludur ve şema tarafından KARŞILANAMAZ: sunucu
 * doğru yapılandırılmış olsa bile, istemci tabloyu doğrudan okumaya kalkarsa
 * mahremiyet sözleşmesi istemci tarafında kırılır. Bu yüzden ayrı kilit.
 *
 * EN KRİTİK İDDİA (değişmedi): bir aracın api_key'i ile TÜM araçların ev/park
 * konumu okunamaz — cihaz okuması `get_geofence_zones` SECURITY DEFINER
 * RPC'sinden geçer, RPC api_key'i araca çözer ve yalnız o aracın bölgelerini
 * döndürür.
 */
import { describe, it, expect } from 'vitest';
import geofenceSecSrc from '../platform/security/geofenceService.ts?raw';

describe('istemci — okuma yolu RPC\'den geçer (doğrudan tablo erişimi DEĞİL)', () => {
  it('KİLİT: okuma get_geofence_zones RPC\'sini çağırır', () => {
    expect(geofenceSecSrc).toMatch(/\.rpc\(\s*'get_geofence_zones'/);
  });

  it('KİLİT: okuma yolu .from(TABLE).select KULLANMAZ (mahremiyet)', () => {
    /* Eski desen `supabase.from('vehicle_geofences').select(...)` idi. Tabloya
       doğrudan erişim, RPC'nin araç-kapsamı kapısını ATLAR — ve sunucudaki
       GRANT/RLS yapılandırması ne olursa olsun bu istemci hatası bir sızıntı
       denemesidir. Şema kilidi bunu yakalayamaz; bu kilit yakalar. */
    expect(geofenceSecSrc).not.toMatch(/\.from\(\s*['"]vehicle_geofences['"]\s*\)/);
    expect(geofenceSecSrc).not.toMatch(/\.from\(TABLE\)/);
  });

  it('KİLİT: yazma ve silme de RPC uçlarına gider', () => {
    expect(geofenceSecSrc).toContain('/push_geofence_zone');
    expect(geofenceSecSrc).toContain('/delete_geofence_zone');
  });

  it('KİLİT: araç kimliği istemciden GÖNDERİLMEZ — api_key\'den çözülür', () => {
    /* RPC'ler `p_vehicle_id` almaz (baseline'da doğrulandı). İstemci bir araç
       kimliği göndermeye kalkarsa sözleşme çoktan bozulmuş demektir. */
    expect(geofenceSecSrc).not.toMatch(/p_vehicle_id/);
  });
});
