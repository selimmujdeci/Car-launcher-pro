/**
 * /api/vehicle/class-lookup — araç YASAL SINIFI araştırma PROXY'si.
 *
 * ── NEDEN BACKEND (görev §4 + §11, pazarlıksız) ─────────────────────────────
 * Head unit doğrudan sağlayıcıya çıkmaz. Sebebi tek: sağlayıcı anahtarı
 * uygulama bundle'ına GÖMÜLEMEZ (APK dekompile edilir, anahtar sızar, fatura
 * ve ToS riski doğar — CLAUDE.md BYOK/lisans kuralı). Anahtar YALNIZ sunucu
 * ortam değişkenindedir ve istemciye ASLA dönmez.
 *
 * ── DÜRÜSTLÜK SÖZLEŞMESİ ────────────────────────────────────────────────────
 *  · Sağlayıcı yapılandırılmamışsa **uydurma yapılmaz**: `outcome:"UNAVAILABLE"`
 *    döner. "Bilmiyorum" demek, yanlış sınıf söylemekten iyidir.
 *  · Dönen her kanıt KÜNYELİDİR (`sourceRefs`); künyesiz kanıt istemci
 *    tarafında zaten ELENİR (`parseResearchResponse`).
 *  · Tekilleştirici VIN KABUL EDİLMEZ: yalnız 9 haneli önek (WMI+VDS) alınır.
 *    17 hane gönderilirse istek REDDEDİLİR — seri numarası sunucuya bile gitmez.
 *  · Girdi loglanmaz.
 *
 * Yapılandırma (sunucu tarafı, opsiyonel):
 *   VEHICLE_CLASS_LOOKUP_URL  — yukarı akış sağlayıcı uç noktası
 *   VEHICLE_CLASS_LOOKUP_KEY  — sağlayıcı anahtarı (yalnız sunucuda)
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Head unit farklı origin'den çağırır (Capacitor `https://localhost`). */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VIN_PREFIX_RE = /^[A-HJ-NPR-Z0-9]{9}$/;
const UPSTREAM_TIMEOUT_MS = 7_000;

interface LookupBody {
  vinPrefix?: unknown;
  make?: unknown;
  model?: unknown;
  modelYear?: unknown;
  countryCode?: unknown;
}

function _text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : null;
}

function _json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: LookupBody;
  try {
    body = (await req.json()) as LookupBody;
  } catch {
    return _json({ outcome: 'UNAVAILABLE', results: [], reason: 'gövde JSON değil' }, 400);
  }

  const vinPrefixRaw = _text(body.vinPrefix, 32);
  if (vinPrefixRaw && !VIN_PREFIX_RE.test(vinPrefixRaw.toUpperCase())) {
    /* 17 haneli TAM VIN veya bozuk önek → REDDET. Tekilleştirici veri bu
       sunucuya girmez; istemci hatası sessizce tolere EDİLMEZ. */
    return _json({
      outcome: 'UNAVAILABLE', results: [],
      reason: 'vinPrefix yalnız 9 hane olabilir (tam VIN kabul edilmez)',
    }, 400);
  }

  const vinPrefix = vinPrefixRaw ? vinPrefixRaw.toUpperCase() : null;
  const make = _text(body.make, 64);
  const model = _text(body.model, 64);
  const modelYear = typeof body.modelYear === 'number' && Number.isFinite(body.modelYear)
    ? Math.trunc(body.modelYear) : null;
  const countryCode = _text(body.countryCode, 2)?.toUpperCase() ?? 'TR';

  if (!vinPrefix && !(make && model)) {
    return _json({ outcome: 'UNAVAILABLE', results: [], reason: 'kimlik yetersiz' });
  }

  const upstreamUrl = process.env.VEHICLE_CLASS_LOOKUP_URL?.trim();
  const upstreamKey = process.env.VEHICLE_CLASS_LOOKUP_KEY?.trim();
  if (!upstreamUrl || !upstreamKey) {
    /* SAĞLAYICI YOK → UYDURMA YOK. İstemci bunu `UNAVAILABLE` olarak alır ve
       kullanıcıya ruhsat sınıfını sorar. Sessiz bir "otomobil" varsayımı
       yapılmaz — bu turun kapattığı hatanın ta kendisi odur. */
    return _json({
      outcome: 'UNAVAILABLE', results: [],
      reason: 'sağlayıcı yapılandırılmadı (VEHICLE_CLASS_LOOKUP_URL/KEY yok)',
    });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${upstreamKey}`,
      },
      body: JSON.stringify({ vinPrefix, make, model, modelYear, countryCode }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return _json({ outcome: 'UNAVAILABLE', results: [], reason: `sağlayıcı HTTP ${res.status}` });
    }
    const data = (await res.json()) as { results?: unknown };
    /* Yukarı akış yanıtı OLDUĞU GİBİ geçilmez; istemcinin beklediği daraltılmış
       şekle indirgenir. Doğrulamanın ASIL kapısı istemcidedir
       (`parseResearchResponse`) — bu yalnız ilk süzgeç. */
    const results = Array.isArray(data.results) ? data.results.slice(0, 4) : [];
    return _json({ outcome: results.length > 0 ? 'RESOLVED' : 'UNAVAILABLE', results });
  } catch {
    return _json({ outcome: 'UNAVAILABLE', results: [], reason: 'sağlayıcıya ulaşılamadı' });
  } finally {
    clearTimeout(timer);
  }
}
