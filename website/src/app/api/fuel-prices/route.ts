import { NextRequest, NextResponse } from 'next/server';
import {
  createEpdkFuelCache,
  emptyResponse,
  resolveProvince,
} from '@/lib/fuel/epdkFuelPrice';

/**
 * /api/fuel-prices?il=Adana — EPDK il bazlı benzin/motorin pompa fiyatı.
 *
 * NEDEN: EPDK servisi SOAP ve CORS izni vermiyor → araç doğrudan çağıramaz.
 * Cevap `parseFuelPricePack` (araç) biçimindedir; veri yoksa fiyatlar `null`.
 * EPDK'ya il başına en fazla 6 saatte bir gidilir; hata/429'da son iyi veri
 * döner ve bekleme süresince EPDK'ya gidilmez (ayrıntı: lib/fuel/epdkFuelPrice).
 *
 * TİCARİ NOT: EPDK'nın bu servis için yazılı kullanım koşulu bulunamadı;
 * bülten sayfalarında "başka amaçla kullanımı uygun değildir" notu var.
 * Satış öncesi EPDK'dan yazılı teyit alınmalı (CLAUDE.md ticari kural).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

/* /api/tts ile aynı kapı: yalnız head unit WebView'ı ve kendi alanımız; IP başına
   dakikalık sınır (örnek başına — tam koruma değil, açık proxy olmayı engeller). */
const ALLOWED_ORIGINS = new Set([
  'https://localhost', 'http://localhost', 'capacitor://localhost',
  'https://carospro.com', 'https://www.carospro.com',
]);
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const _hits = new Map<string, { n: number; resetAt: number }>();

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  return origin && ALLOWED_ORIGINS.has(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {};
}

/** true → sınır aşıldı. */
function rateLimited(req: NextRequest): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const e = _hits.get(ip);
  if (!e || now >= e.resetAt) {
    if (_hits.size > 5000) _hits.clear();
    _hits.set(ip, { n: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  e.n += 1;
  return e.n > RATE_MAX;
}

const cache = createEpdkFuelCache({ fetchFn: (u, i) => fetch(u, i), now: () => Date.now() });

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req);
  if (req.headers.get('origin') && !cors['Access-Control-Allow-Origin']) {
    return NextResponse.json({ error: 'origin izinli değil' }, { status: 403 });
  }
  if (rateLimited(req)) {
    return NextResponse.json({ error: 'çok fazla istek' }, { status: 429, headers: { ...cors, 'Retry-After': '60' } });
  }

  const il = req.nextUrl.searchParams.get('il');
  const province = resolveProvince(il);
  if (!province) {
    return NextResponse.json(
      { ...emptyResponse(null, 'EPDK — il bilinmiyor'), error: 'il parametresi eksik ya da tanınmadı (ör. ?il=Adana)' },
      { status: 400, headers: { ...cors, 'Cache-Control': 'no-store' } },
    );
  }

  const { body, state } = await cache.get(province);
  // CDN önbelleği de EPDK yükünü sınırlar: taze veri 6 saat, yedek/boş kısa süre.
  const cacheControl = state === 'fresh'
    ? 'public, s-maxage=21600'
    : 'public, s-maxage=300';
  return NextResponse.json(body, {
    status: state === 'none' ? 503 : 200,
    headers: { ...cors, 'Cache-Control': cacheControl, 'X-Fuel-Price-State': state },
  });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
