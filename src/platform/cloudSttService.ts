/**
 * cloudSttService — HİBRİT bulut STT (yalnız WAV → metin).
 *
 * MİMARİ (modül çakışması YOK): mikrofonu AÇMAZ, kaynak yönetmez, durum tutmaz.
 * Yalnız native'in TEK yakalamada ürettiği WAV base64'ü alır ve online'da yüksek
 * doğruluklu bulut STT'ye çevirir. Offline / anahtar yok / hata → null döner →
 * çağıran (voiceService) Vosk metnine düşer (fail-soft). Vosk ile bulut aynı sesi
 * kullanır, ayrı mikrofon açılmaz.
 *
 * Sağlayıcı seçimi (BYOK — gömülü anahtar YOK, CLAUDE.md ticari kural):
 *   1) Groq Whisper (whisper-large-v3-turbo) — TR'de çok iyi + hızlı, Google DEĞİL.
 *   2) Gemini (ses girişi) — kullanıcı zaten beyin için anahtar girmişse.
 * İkisi de yoksa null (Vosk kalır).
 */
const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GEMINI_STT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

const DEFAULT_TIMEOUT_MS = 6_000;

/**
 * İnternet kapısı — YALNIZ navigator.onLine. isAiNetHealthy() (Gemini devre kesici)
 * BİLİNÇLİ dışarıda: Groq Whisper / Gemini SES endpoint'i, Gemini SOHBET breaker'ından
 * bağımsız denenmeli (biri 429 olsa da diğeri/STT çalışabilir). Kötü ağ → 6sn timeout
 * + fail-soft null → Vosk yedeği. Böylece online'da bulut STT HER ZAMAN şans bulur.
 */
function hasRealNet(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.onLine;
}

/** Bulut STT hiç denenmeli mi? (online + en az bir anahtar). Native returnAudio kapısı için. */
export async function cloudSttAvailable(): Promise<boolean> {
  if (!hasRealNet()) return false;
  const { groq, gemini } = await resolveSttKeys();
  return !!(groq || gemini);
}

/** Son bilinen bulut STT anahtarı mevcudiyeti (tanı için — snapshot okur). null = henüz bakılmadı. */
let _keyPresent: boolean | null = null;

/** Tanı: bulut STT için anahtar girili mi (Groq/Gemini). null = henüz çözülmedi. */
export function getCloudSttKeyPresent(): boolean | null {
  return _keyPresent;
}

async function resolveSttKeys(): Promise<{ groq: string; gemini: string }> {
  try {
    const { sensitiveKeyStore } = await import('./sensitiveKeyStore');
    const [groq, gemini] = await Promise.all([
      sensitiveKeyStore.get('groqApiKey'),
      sensitiveKeyStore.get('geminiApiKey'),
    ]);
    const g = (groq ?? '').trim();
    const m = (gemini ?? '').trim();
    _keyPresent = !!(g || m);
    return { groq: g, gemini: m };
  } catch {
    return { groq: '', gemini: '' };
  }
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
}

/** Groq Whisper — multipart WAV → metin. Başarısız/boş → null. */
async function groqWhisper(wavB64: string, key: string, timeoutMs: number): Promise<string | null> {
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const form = new FormData();
    form.append('file', base64ToBlob(wavB64, 'audio/wav'), 'speech.wav');
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'tr');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    const res = await fetch(GROQ_STT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    return text || null;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

/** Gemini ses girişi — WAV inline → metin. Başarısız/boş → null. */
async function geminiAudio(wavB64: string, key: string, timeoutMs: number): Promise<string | null> {
  const { signal, cancel } = withTimeout(timeoutMs);
  try {
    const body = {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: 'audio/wav', data: wavB64 } },
            { text: 'Bu Türkçe konuşmayı birebir yazıya dök. Sadece söylenen metni döndür; açıklama, tırnak veya noktalama ekleme.' },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 64 },
    };
    const res = await fetch(`${GEMINI_STT_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p: { text?: string }) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
      : '';
    return text || null;
  } catch {
    return null;
  } finally {
    cancel();
  }
}

/**
 * WAV base64 → metin. Online + anahtar varsa bulut STT; aksi halde null (Vosk kalır).
 * ASLA throw etmez (fail-soft) — dönerse yalnız GÜVENİLİR bir transkript döner.
 */
export async function cloudTranscribe(
  wavB64: string,
  opts?: { timeoutMs?: number },
): Promise<string | null> {
  if (!wavB64 || !hasRealNet()) return null;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { groq, gemini } = await resolveSttKeys();
  // 1) Groq Whisper (tercih — purpose-built STT, TR güçlü, Google değil).
  if (groq) {
    const t = await groqWhisper(wavB64, groq, timeoutMs);
    if (t) return t;
  }
  // 2) Gemini ses (kullanıcı zaten beyin anahtarı girmişse).
  if (gemini) {
    const t = await geminiAudio(wavB64, gemini, timeoutMs);
    if (t) return t;
  }
  return null;
}
