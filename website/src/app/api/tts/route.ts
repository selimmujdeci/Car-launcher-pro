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
  try {
    const { text, voice } = (await req.json()) as { text?: string; voice?: string };
    const t = (text ?? '').trim();
    if (!t) return NextResponse.json({ error: 'text gerekli' }, { status: 400 });
    if (t.length > 800) return NextResponse.json({ error: 'text çok uzun (max 800)' }, { status: 400 });

    const v = voice && ALLOWED_VOICES.has(voice) ? voice : DEFAULT_VOICE;
    const mp3 = await synthesize(t, v);

    return new NextResponse(new Uint8Array(mp3), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('tts:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'sentez başarısız' }, { status: 502 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
