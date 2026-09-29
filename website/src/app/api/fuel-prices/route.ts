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

/* CORS: herkese AYNI cevap (`*`). Veri kamuya açık EPDK fiyatıdır ve cevap CDN'de
   6 saat önbelleklenir; origin'e göre değişen izin başlığı önbellekle birleşince
   bir istekçinin cevabı (başka ya da hiç izin başlığı) araç WebView'ine
   (https://localhost) gider ve tarayıcı onu ENGELLER — canlı fiyat hiç gelmezdi.
   /api/tts'ten farkı bu: orada POST, önbellek yok ve servis maliyetli. Kötüye
   kullanıma karşı IP başına dakikalık sınır kalır (yalnız önbellek ıskasında
   çalışır; ıska olmayan istek EPDK'ya da gitmez). */
const CORS = { 'Access-Control-Allow-Origin': '*' } as const;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const _hits = new Map<string, { n: number; resetAt: number }>();

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
  const cors = CORS;
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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
