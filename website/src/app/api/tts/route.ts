import { NextRequest, NextResponse } from 'next/server';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

/**
 * /api/tts — Edge (Microsoft) Neural TTS proxy (msedge-tts ile).
 *
 * NEDEN: Head unit WebView'da TTS motoru yok; Gemini TTS ücretsiz kotası
 * günlük çok düşük (saha 2026-07-03: kota bitince robotik erkek eSpeak'e
 * düşüyordu). Edge Neural (tr-TR-EmelNeural) premium TR ses, pratikte kotasız.
 * Tarayıcıdan doğrudan çağrılamaz (CORS + Sec-MS-GEC token) → bu proxy.
 *
 * msedge-tts paketi güncel Sec-MS-GEC token şemasını kapsar (elle implementasyon
 * 403 veriyordu — Microsoft algoritmayı değiştirmiş, saha 2026-07-03). Araç POST
 * { text, voice? } → MP3. Anahtar gerekmez. Hata → araç Gemini/eSpeak yedeğine düşer.
 *
 * TİCARİ NOT: Edge okuma servisi resmi ticari API değil; satış öncesi lisans
 * netleştirilmeli (CLAUDE.md ticari kural). Teknik yedek: Gemini TTS + eSpeak.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const DEFAULT_VOICE = 'tr-TR-EmelNeural';

/* Açık proxy olmasın: tarayıcıdan yalnız head unit WebView'ı (Capacitor) ve kendi
   alanımız çağırabilir; sunucudan sunucuya kötüye kullanıma karşı IP başına dakikalık
   sınır. Sınır örnek (instance) başınadır — tam koruma değil, bedava TTS servisi
   olmayı engelleyen ucuz kapı. Head unit anahtarsız çağırdığı için kimlik doğrulama
   APK değişikliği ister (ayrı iş). */
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
const ALLOWED_VOICES = new Set(['tr-TR-EmelNeural', 'tr-TR-AhmetNeural']);

function synthesize(text: string, voice: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error('timeout')), 25_000);
    (async () => {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text);
      audioStream.on('data', (c: Buffer) => chunks.push(c));
      audioStream.on('end', () => {
        clearTimeout(timer);
        if (chunks.length === 0) reject(new Error('no audio'));
        else resolve(Buffer.concat(chunks));
      });
      audioStream.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
    })().catch((e) => { clearTimeout(timer); reject(e); });
  });
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);
  if (req.headers.get('origin') && !cors['Access-Control-Allow-Origin']) {
    return NextResponse.json({ error: 'origin izinli değil' }, { status: 403 });
  }
  if (rateLimited(req)) {
    return NextResponse.json({ error: 'çok fazla istek' }, { status: 429, headers: { ...cors, 'Retry-After': '60' } });
  }
  try {
    const { text, voice } = (await req.json()) as { text?: string; voice?: string };
    const t = (text ?? '').trim();
    if (!t) return NextResponse.json({ error: 'text gerekli' }, { status: 400, headers: cors });
    if (t.length > 800) return NextResponse.json({ error: 'text çok uzun (max 800)' }, { status: 400, headers: cors });

    const v = voice && ALLOWED_VOICES.has(voice) ? voice : DEFAULT_VOICE;
    const mp3 = await synthesize(t, v);

    return new NextResponse(new Uint8Array(mp3), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
        ...cors,
      },
    });
  } catch (err) {
    console.error('tts:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'sentez başarısız' }, { status: 502, headers: cors });
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(req),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
