/**
 * publicApiAuth.test.ts — V-16/7 dış REST API kapısının KİLİTLERİ.
 *
 * ── NEDEN BU DOSYA ÖNEMLİ ──────────────────────────────────────────────────
 * Bu, ürünün **ilk dış saldırı yüzeyidir**. Bir anahtar sızarsa ya da yetki
 * kapısı gevşerse müşterinin tüm filo verisi dışarı akar. Kilitler yalnız
 * "çalışıyor mu" değil, **kötüye kullanılabilir mi** diye sorar.
 *
 * Veritabanı davranışı `supabase/tests/066_company_api_key_matrix.sql`
 * içindedir (6 halka: yetki · saklama · kapsam · hız sınırı · iptal · izolasyon).
 * Bu dosya SUNUCU KATMANINI korur.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { extractBearer, apiError, apiOk } from '@/lib/api/publicApiAuth';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** Yorumları ayıklar: açıklama metinleri KOD SANILMAMALI. Bu kilit ilk
    yazımda kendi yorumundaki `api_key_hash` sözcüğüne takıldı. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const AUTH = code('src/lib/api/publicApiAuth.ts');
const V_VEH = code('src/app/api/v1/vehicles/route.ts');
const V_TRIP = code('src/app/api/v1/trips/route.ts');

describe('dış API › Bearer ayrıştırma', () => {
  it('geçerli başlıktan anahtarı çıkarır', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123');
  });

  it('eksik/bozuk başlık `null` verir — "boş anahtar" ile geçilmez', () => {
    for (const h of [null, '', 'abc123', 'Basic abc', 'Bearer', 'Bearer  ']) {
      expect(extractBearer(h)).toBeNull();
    }
  });

  it('boşluk ve enjeksiyon denemeleri reddedilir', () => {
    /* Anahtar biçimi dar tutulur: SQL/başlık enjeksiyonu için alan bırakmaz. */
    expect(extractBearer('Bearer abc def')).toBeNull();
    expect(extractBearer("Bearer abc'--")).toBeNull();
    expect(extractBearer('Bearer abc\nX-Admin: 1')).toBeNull();
  });
});

describe('dış API › fail-closed', () => {
  it('yapılandırma eksikse KAPI AÇILMAZ (503)', () => {
    /* "Emin değilim, geçir" demek kapı olmaması demektir. */
    expect(AUTH).toMatch(/if \(!url \|\| !serviceKey\)/);
    expect(AUTH).toMatch(/503, 'SERVICE_UNAVAILABLE'/);
  });

  it('beklenmeyen hata da erişim VERMEZ', () => {
    const fn = AUTH.slice(AUTH.indexOf('export async function authorizeApiRequest'));
    expect(fn).toMatch(/catch \{[\s\S]*SERVICE_UNAVAILABLE/);
  });

  it('yalnız `ALLOWED` geçer — bilinmeyen durum reddedilir', () => {
    expect(AUTH).toMatch(/if \(state !== 'ALLOWED'\)/);
  });
});

describe('dış API › sızıntı yasakları', () => {
  it('anahtar loglanmaz ve gövdeye yazılmaz', () => {
    expect(AUTH).not.toMatch(/console\.(log|info|warn|error)/);
    /* Ham anahtar yalnız hash için kullanılır, hiçbir yanıta girmez. */
    const body = AUTH.slice(AUTH.indexOf('export function apiError'));
    expect(body).not.toMatch(/raw/);
  });

  it('iç hata metni istemciye GEÇMEZ', () => {
    /* Supabase hata mesajı tablo/kolon adı sızdırabilir. */
    expect(AUTH).not.toMatch(/message:\s*error\./);
    expect(AUTH).not.toMatch(/error\.message/);
  });

  it('geçersiz ile İPTAL EDİLMİŞ anahtar AYNI cevabı alır', () => {
    /* Aksi hâlde saldırgan hangi anahtarların var olduğunu öğrenir
       (varlık oracle'ı). Ayrım SQL tarafında da yok — 066 halka 5 sınıyor. */
    expect(AUTH).toMatch(/INVALID_KEY/);
    expect(AUTH).not.toMatch(/REVOKED/);
  });

  it('hata gövdesi sabit sözleşmedir', () => {
    const res = apiError({ ok: false, status: 401, code: 'INVALID_KEY', message: 'x' });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});

describe('dış API › hız sınırı sözleşmesi', () => {
  it('429 döner ve `retry-after` başlığı EKLENİR', () => {
    const res = apiError({
      ok: false, status: 429, code: 'RATE_LIMITED', message: 'x', retryAfterSec: 42,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
  });

  it('başarılı yanıt kalan kotayı bildirir', () => {
    const res = apiOk({ data: [] }, { ok: true, companyId: 'c', keyId: 'k', limit: 60, used: 5 });
    expect(res.headers.get('x-ratelimit-limit')).toBe('60');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('55');
  });

  it('yanıt ÖNBELLEĞE ALINMAZ — filo verisi anlıktır', () => {
    const res = apiOk({}, { ok: true, companyId: 'c', keyId: 'k', limit: 1, used: 1 });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('doğrulama ve sayaç TEK çağrıda — yarış yok', () => {
    /* İki ayrı çağrı olsaydı aralarında eşzamanlı istekler limiti aşabilirdi. */
    expect((AUTH.match(/admin\.rpc\(/g) ?? []).length).toBe(1);
    expect(AUTH).toMatch(/authorize_api_key/);
  });
});

describe('dış API › uçların disiplini', () => {
  it('her uç TEK KAPIDAN geçer', () => {
    for (const src of [V_VEH, V_TRIP]) {
      expect(src).toMatch(/authorizeApiRequest\(req, 'read:(vehicles|trips)'\)/);
      expect(src).toMatch(/if \(!auth\.ok\) return apiError\(auth\)/);
    }
  });

  it('v1 SALT-OKUNURDUR — yazma fiili YOK', () => {
    for (const src of [V_VEH, V_TRIP]) {
      expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
      expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
    }
  });

  it('sorgular ŞİRKETE daraltılır — kiracı sızıntısı yok', () => {
    expect(V_VEH).toMatch(/\.eq\('company_id', auth\.companyId\)/);
    /* Yolculuklar önce şirketin araçlarına daraltılır; istemciden gelen
       `vehicle_id` başka şirkete GENİŞLEYEMEZ. */
    expect(V_TRIP).toMatch(/\.eq\('company_id', auth\.companyId\)/);
    expect(V_TRIP).toMatch(/\.in\('vehicle_id'/);
  });

  it('sır alanları DIŞARI çıkmaz', () => {
    for (const src of [V_VEH, V_TRIP]) {
      expect(src).not.toMatch(/api_key|api_key_hash|service_role/);
    }
  });

  it('`limit` SUNUCUDA kırpılır — istemciye körlemesine güvenilmez', () => {
    expect(V_TRIP).toMatch(/Math\.min\(Math\.floor\(rawLimit\), MAX_LIMIT\)/);
  });

  it('PROVENANCE alanları da döner — sahte kesinlik satılmaz', () => {
    /* Müşteri hangi değerin ÖLÇÜLDÜĞÜNÜ bilmeden karar veremez. */
    for (const f of ['distance_source', 'fuel_source', 'cost_source']) {
      expect(V_TRIP).toContain(f);
    }
  });
});
