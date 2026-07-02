import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';

/**
 * /api/tts — Edge (Microsoft) Neural TTS proxy.
 *
 * NEDEN: Head unit WebView'da çalışan TTS motoru yok; Gemini TTS ücretsiz
 * kotası günlük çok düşük (saha 2026-07-03: klip üretimi + birkaç asistan
 * cevabı kotayı bitirdi → erkek eSpeak'e düşüyordu). Edge Neural TTS Türkçe
 * premium ses (tr-TR-EmelNeural) sunar, pratikte kotasız. Ama tarayıcıdan
 * DOĞRUDAN çağrılamaz (CORS + saat-bazlı Sec-MS-GEC token) → bu proxy.
 *
 * Araç POST { text, voice? } → WAV (audio/mpeg aslında MP3; araç <audio> çalar).
 * Anahtar gerekmez (BYOK'a ek yük yok). Hata → araç Gemini/eSpeak yedeğine düşer.
 *
 * TİCARİ NOT: Edge okuma servisi resmi ticari API değil; satış öncesi lisans
 * netleştirilmeli (CLAUDE.md ticari kural). Teknik yedek: Gemini TTS + eSpeak.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const DEFAULT_VOICE = 'tr-TR-EmelNeural';
const ALLOWED_VOICES = new Set(['tr-TR-EmelNeural', 'tr-TR-AhmetNeural']);

/** Sec-MS-GEC: Windows FILETIME'ı 5 dk'ya yuvarla + token → SHA256 uppercase hex. */
function secMsGec(): string {
  const ticks = Math.floor((Date.now() / 1000 + 11644473600) / 300) * 300 * 10_000_000;
  return createHash('sha256').update(`${ticks}${TRUSTED_TOKEN}`).digest('hex').toUpperCase();
}

function ssml(text: string, voice: string): string {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='tr-TR'>` +
    `<voice name='${voice}'><prosody rate='+6%' pitch='+0Hz'>${safe}</prosody></voice></speak>`;
}

function synthesize(text: string, voice: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const connId = createHash('md5').update(`${Date.now()}${Math.random()}`).digest('hex');
    const url = `${WSS_BASE}?TrustedClientToken=${TRUSTED_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-130.0.2849.68&ConnectionId=${connId}`;
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        'Origin': 'chrome-extension://jdiccldimpvhjnmlmmpngpdheicokpif',
      },
    });

    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { try { ws.close(); } catch { /* noop */ } reject(new Error('timeout')); }, 25_000);

    ws.on('open', () => {
      const cfg = `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":` +
        `{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},` +
        `"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
      ws.send(cfg);
      const msg = `X-RequestId:${connId}\r\nContent-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n${ssml(text, voice)}`;
      ws.send(msg);
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Binary frame: [2-byte header len][header][audio]. "Path:audio\r\n" sonrası ses.
        const headerLen = (data[0] << 8) | data[1];
        const header = data.subarray(2, 2 + headerLen).toString('utf8');
        if (header.includes('Path:audio')) chunks.push(data.subarray(2 + headerLen));
      } else {
        const txt = data.toString('utf8');
        if (txt.includes('Path:turn.end')) {
          clearTimeout(timer);
          try { ws.close(); } catch { /* noop */ }
          if (chunks.length === 0) reject(new Error('no audio'));
          else resolve(Buffer.concat(chunks));
        }
      }
    });

    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
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
