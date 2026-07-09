/** gen-clips.mjs — klip bankasını Gemini TTS (Kore) ile yeniden üret (geçici araç) */
import { writeFileSync, statSync } from 'node:fs';

const KEY = process.env.GEMINI_KEY;
if (!KEY) { console.error('GEMINI_KEY env gerekli'); process.exit(1); }

const MANIFEST = {
  'Kapı açık, lütfen kapıyı hemen kapatın.':                'safety-door-moving',
  'El freni çekili, lütfen el frenini indirin.':            'safety-parking-brake',
  'Motor sıcaklığı yüksek, lütfen güvenli yerde durun.':    'safety-overheat',
  'Emniyet kemeri takılı değil.':                           'safety-seatbelt',
  'Kaput veya bagaj açık, lütfen durup kontrol edin.':      'safety-hood-trunk',
  'Farlar kapalı görünüyor.':                               'safety-headlights',
  'Yakıt seviyesi düşük.':                                  'safety-low-fuel',
  'Araçta bir arıza göstergesi var, kontrol önerilir.':     'safety-battery-oil',
  'Kapı açık.':                                             'safety-door-park',
  'Dikkat! yol çalışması.':                                 'hazard-construction',
  'Dikkat! kaza.':                                          'hazard-accident',
  'Dikkat! zor hava koşulları.':                            'hazard-weather',
  'Dikkat! hız kamerası.':                                  'hazard-speedcam',
  'Dikkat! yol hasarı.':                                    'hazard-road-damage',
  'Dikkat! tünel.':                                         'hazard-tunnel',
  'Bağlantı kurulamadı. Tekrar deneyin.':                   'hw-error',
  'Araç verisi alınamıyor. OBD bağlantısını kontrol edin.': 'obd-nodata',
};

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const EP = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

for (const [text, id] of Object.entries(MANIFEST)) {
  // Bu oturumda üretilmiş taze dosyayı atla (yeniden koşumda kaldığı yerden devam)
  try {
    const st = statSync(`public/voice/${id}.wav`);
    if (Date.now() - st.mtimeMs < 2 * 60 * 60 * 1000) { console.log(`${id}: taze — atla`); continue; }
  } catch { /* dosya yok → üret */ }
  let done = false;
  for (let attempt = 1; attempt <= 4 && !done; attempt++) {
    try {
      const resp = await fetch(EP, {
        method: 'POST',
        signal: AbortSignal.timeout(30000), // asılı kalan bağlantı tüm kuyruğu kilitlemesin
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          },
        }),
      });
      if (resp.status === 429) { console.log(`${id}: 429 — 30sn bekle (deneme ${attempt})`); await sleep(30000); continue; }
      if (!resp.ok) { console.log(`${id}: HTTP ${resp.status}`); await sleep(5000); continue; }
      const data = await resp.json();
      const part = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!part?.data) { console.log(`${id}: ses verisi yok`); break; }
      const rate = Number(/rate=(\d+)/.exec(part.mimeType ?? '')?.[1] ?? 24000);
      const wav = pcmToWav(Buffer.from(part.data, 'base64'), rate);
      writeFileSync(`public/voice/${id}.wav`, wav);
      console.log(`${id}: OK (${Math.round(wav.length / 1024)} KB, ${rate} Hz)`);
      done = true;
      await sleep(15000); // ücretsiz katman RPM nezaketi (TTS kotası sert)
    } catch (e) { console.log(`${id}: hata ${e.message}`); await sleep(5000); }
  }
  if (!done) console.log(`${id}: BASARISIZ — eski klip korunacak`);
}
console.log('BITTI');
