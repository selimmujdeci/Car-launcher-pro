// SERVER-ONLY — istemci bileşeninde import EDİLMEZ.
/**
 * publicApiAuth — dış müşteri REST API'sinin kimlik ve hız sınırı kapısı (V-16/7).
 *
 * ── NEDEN AYRI DOSYA ────────────────────────────────────────────────────────
 * Her uç kendi doğrulamasını yazsaydı, biri unutulduğunda **kimlik doğrulamasız
 * bir uç** yayına girerdi ve bunu kimse fark etmezdi. Tek kapı vardır; uçlar
 * yalnız onu çağırır.
 *
 * ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
 * Servis anahtarı yoksa, veritabanı yanıt vermezse ya da beklenmeyen bir şey
 * olursa **erişim VERİLMEZ**. Bir API kapısının "emin değilim, geçir" demesi,
 * kapı olmaması demektir.
 *
 * ── SIZINTI YASAKLARI ───────────────────────────────────────────────────────
 *  · Anahtarın kendisi loglanmaz, hata gövdesine yazılmaz.
 *  · Bilinmeyen anahtar ile İPTAL EDİLMİŞ anahtar **aynı** cevabı alır —
 *    aksi hâlde saldırgan hangi anahtarların var olduğunu öğrenirdi.
 *  · İç hata metinleri istemciye geçmez; sabit kodlar döner.
 */

import { createClient } from '@supabase/supabase-js';
import { hashApiKey } from '@/lib/crypto';

export type ApiScope = 'read:vehicles' | 'read:trips';

export interface ApiAuthOk {
  readonly ok: true;
  readonly companyId: string;
  readonly keyId: string;
  readonly limit: number;
  readonly used: number;
}

export interface ApiAuthFail {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** Hız sınırında istemciye ne zaman tekrar deneyeceği söylenir. */
  readonly retryAfterSec?: number;
}

export type ApiAuthResult = ApiAuthOk | ApiAuthFail;

const fail = (status: number, code: string, message: string, retryAfterSec?: number): ApiAuthFail =>
  ({ ok: false, status, code, message, retryAfterSec });

/** `Authorization: Bearer <key>` başlığından ham anahtarı çıkarır. */
export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+([A-Za-z0-9._-]+)\s*$/.exec(header);
  return m ? m[1] : null;
}

/**
 * İsteği doğrular ve hız sınırını uygular.
 *
 * Doğrulama ve sayaç artışı **tek bir veritabanı çağrısında** yapılır
 * (`authorize_api_key`): iki ayrı çağrı olsaydı aralarında yarış oluşur ve
 * eşzamanlı istekler limiti aşabilirdi.
 */
export async function authorizeApiRequest(
  req: Request,
  scope: ApiScope,
): Promise<ApiAuthResult> {
  const raw = extractBearer(req.headers.get('authorization'));
  if (raw === null) {
    return fail(401, 'MISSING_KEY', 'Authorization: Bearer <api_key> başlığı gerekli.');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    /* Yapılandırma eksikse KAPI AÇILMAZ. "Emin değilim, geçir" demek,
       kapı olmaması demektir. */
    return fail(503, 'SERVICE_UNAVAILABLE', 'API şu anda hizmet veremiyor.');
  }

  try {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc('authorize_api_key', {
      p_key_hash: hashApiKey(raw),
      p_scope: scope,
    });

    /* İç hata metni istemciye GEÇMEZ. */
    if (error) return fail(503, 'SERVICE_UNAVAILABLE', 'API şu anda hizmet veremiyor.');

    const r = (data ?? {}) as Record<string, unknown>;
    const state = String(r.state ?? '');

    if (state === 'RATE_LIMITED') {
      const resetAt = typeof r.resetAt === 'string' ? Date.parse(r.resetAt) : Number.NaN;
      const sec = Number.isFinite(resetAt)
        ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
        : 60;
      return fail(429, 'RATE_LIMITED',
        `Dakikalık istek sınırı aşıldı (${String(r.limit ?? '')}/dk).`, sec);
    }

    if (state !== 'ALLOWED') {
      /* Geçersiz, iptal edilmiş ve kapsamsız anahtar AYNI gövdeyi alır;
         yalnız kod ayrışır ve kod da hangi anahtarın var olduğunu SÖYLEMEZ. */
      const code = String(r.reason ?? 'INVALID_KEY');
      return fail(401, code === 'SCOPE_NOT_GRANTED' ? 'SCOPE_NOT_GRANTED' : 'INVALID_KEY',
        code === 'SCOPE_NOT_GRANTED'
          ? 'Bu anahtar bu kapsam için yetkili değil.'
          : 'API anahtarı geçersiz.');
    }

    return {
      ok: true,
      companyId: String(r.companyId ?? ''),
      keyId: String(r.keyId ?? ''),
      limit: Number(r.limit ?? 0),
      used: Number(r.used ?? 0),
    };
  } catch {
    return fail(503, 'SERVICE_UNAVAILABLE', 'API şu anda hizmet veremiyor.');
  }
}

/** Tek biçimli hata gövdesi — her uç aynı sözleşmeyi döner. */
export function apiError(f: ApiAuthFail): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (f.retryAfterSec !== undefined) headers['retry-after'] = String(f.retryAfterSec);
  return new Response(
    JSON.stringify({ error: { code: f.code, message: f.message } }),
    { status: f.status, headers },
  );
}

/** Başarılı yanıt — hız sınırı başlıkları HER yanıtta bulunur. */
export function apiOk(body: unknown, auth: ApiAuthOk): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-ratelimit-limit': String(auth.limit),
      'x-ratelimit-remaining': String(Math.max(0, auth.limit - auth.used)),
      /* Dış istemciler bu yanıtı önbelleğe ALMAMALI: filo verisi anlıktır. */
      'cache-control': 'no-store',
    },
  });
}
