/**
 * maviLongAnswerEdgeChunking.test.ts — SAHA 2026-09-10 · "uzun cevap yarıda kesiliyor".
 *
 * ÖLÇÜLEN ZİNCİR (gerçek cihaz, CDP): `carospro.com/api/tts` proxy'si 800
 * karakterde SABİT sınırlı (`400 {"error":"text çok uzun (max 800)"}`) →
 * 800'ü aşan HER cevapta premium ses düşüyor ve `_coolUntil` 60 sn devreye
 * girdiği için SONRAKİ kısa cevaplar da robotik sese düşüyordu. Gemini yedeği
 * çalışıyor ama yavaş (2976 karakter → 84 sn) ve o katmanın timeout'u 12 sn.
 *
 * Bu dosya parçalı sentezin sözleşmesini kilitler: parça tavanı · metin
 * kaybı YOK · `onEnd` yalnız SON parçada · iptal kuyruğu öldürür + duck'ı
 * bırakır · ilk parça küçük (ilk kelime gecikmesi).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DUCK = vi.hoisted(() => ({ requested: 0, released: 0 }));
vi.mock('../platform/media/authority/duckRequest', () => ({
  requestDuck: () => { DUCK.requested++; return { reason: 'MAVI', release: () => { DUCK.released++; } }; },
}));
vi.mock('../platform/assistant/maviLatencyTrace', () => ({ markMaviLatency: () => {} }));

import { splitForSynthesis, speakEdge, cancelEdge } from '../platform/edgeTtsService';

/* ── Sahte Audio: çalma bitişini test SÜRÜKLER (gerçek zaman YOK) ───────── */
class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  paused = false;
  constructor(public src: string) { FakeAudio.instances.push(this); }
  play(): Promise<void> { return Promise.resolve(); }
  pause(): void { this.paused = true; }
  end(): void { this.onended?.(); }
}

const SENTENCE = 'Marmara Bölgesi ülkenin kuzeybatısında yer alır ve sanayi açısından önemlidir. ';

describe('splitForSynthesis — parça sözleşmesi', () => {
  it('hiçbir parça 800 karakteri (sunucu sınırı) AŞMAZ', () => {
    for (const n of [1, 5, 20, 60]) {
      for (const c of splitForSynthesis(SENTENCE.repeat(n))) {
        expect(c.length).toBeLessThanOrEqual(800);
      }
    }
  });

  it('METİN KAYBOLMAZ — parçaların birleşimi girdinin tamamıdır', () => {
    const text = SENTENCE.repeat(30).trim();
    const birlesik = splitForSynthesis(text).join(' ');
    expect(birlesik.replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('kısa söz TEK parça kalır (eski davranış korunur)', () => {
    expect(splitForSynthesis('Merhaba, nasılsın?')).toEqual(['Merhaba, nasılsın?']);
  });

  it('İLK parça küçüktür — ilk kelime hızlı duyulsun', () => {
    const parts = splitForSynthesis(SENTENCE.repeat(20));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBeLessThanOrEqual(320);
  });

  it('tek bir dev cümle bile bölünür (kırpılmaz)', () => {
    const dev = 'kelime '.repeat(400).trim();   // ~2800 karakter, nokta YOK
    const parts = splitForSynthesis(dev);
    expect(parts.every((c) => c.length <= 800)).toBe(true);
    expect(parts.join(' ')).toBe(dev);
  });
});

describe('speakEdge — parçalı seslendirme', () => {
  beforeEach(() => {
    DUCK.requested = 0; DUCK.released = 0;
    FakeAudio.instances = [];
    (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
    (globalThis as unknown as { URL: { createObjectURL: unknown; revokeObjectURL: unknown } }).URL = {
      ...URL, createObjectURL: (b: Blob) => `blob:${(b as { size?: number }).size ?? 0}:${Math.random()}`,
      revokeObjectURL: () => {},
    } as never;
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, blob: async () => ({ size: ++n * 10 } as Blob),
    })));
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('SAHA: 800 karakteri aşan cevap KESİLMEZ — tüm parçalar sırayla çalar', async () => {
    const onEnd = vi.fn();
    const uzun = SENTENCE.repeat(20);           // ~1560 karakter → çok parça
    const beklenen = splitForSynthesis(uzun).length;
    expect(beklenen).toBeGreaterThan(1);

    expect(await speakEdge(uzun, onEnd)).toBe(true);
    // Parçalar bitişlerini test sürükler; `onEnd` yalnız SONUNCUDA çalmalı.
    for (let i = 0; i < beklenen; i++) {
      expect(FakeAudio.instances.length).toBe(i + 1);
      expect(onEnd).not.toHaveBeenCalled();
      FakeAudio.instances[i].end();
      await vi.waitFor(() => {
        if (i + 1 < beklenen) expect(FakeAudio.instances.length).toBe(i + 2);
        else expect(onEnd).toHaveBeenCalledTimes(1);
      });
    }
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ducking parça sınırlarında BIRAKILMAZ (müzik zıplamaz), sonda bir kez bırakılır', async () => {
    const uzun = SENTENCE.repeat(20);
    const beklenen = splitForSynthesis(uzun).length;
    await speakEdge(uzun, () => {});
    for (let i = 0; i < beklenen; i++) {
      FakeAudio.instances[i].end();
      await vi.waitFor(() => expect(FakeAudio.instances.length >= Math.min(i + 2, beklenen)).toBe(true));
    }
    expect(DUCK.requested).toBe(1);
    expect(DUCK.released).toBe(1);
  });

  it('iptal kuyruğu ÖLDÜRÜR: yeni parça çalmaz, onEnd ÇAĞRILMAZ, duck BIRAKILIR', async () => {
    const onEnd = vi.fn();
    await speakEdge(SENTENCE.repeat(20), onEnd);
    const acikParca = FakeAudio.instances.length;
    cancelEdge();
    expect(DUCK.released).toBe(1);            // sızıntı yok (pause 'ended' üretmez)
    FakeAudio.instances[acikParca - 1].end(); // iptalden sonra gelen bitiş
    await new Promise((r) => setTimeout(r, 10));
    expect(FakeAudio.instances.length).toBe(acikParca);  // yeni parça KURULMADI
    expect(onEnd).not.toHaveBeenCalled();     // kesilen söz "bitti" SAYILMAZ
  });

  it('ilk parça sentezlenemezse false döner (çağıran yedeğe düşer)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, blob: async () => ({ size: 0 }) })));
    /* LRU önbelleği modül ömürlüdür → daha önce sentezlenmemiş BENZERSİZ metin. */
    const taze = `Ege Bölgesi zeytinlikleriyle bilinir ${Date.now()}. `.repeat(20);
    expect(await speakEdge(taze, () => {})).toBe(false);
    expect(DUCK.requested).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * "KONUŞUYOR" TAVANI — parçalı sentezin İKİZ kusuru
 *
 * Uzun cevap artık GERÇEKTEN 120 sn'yi aşıyor. `speakAssistant` yolu
 * (klip/Edge/online) `ttsSpeak`e uğramadığı için tavan tabanda (120 sn)
 * kalsaydı `isTtsSpeaking()` sözün ortasında `false` döner, takip penceresi
 * mikrofonu açar ve `startListening` → `ttsCancel` sesi keserdi — yani
 * düzelttiğimiz belirti BAŞKA KAPIDAN geri gelirdi.
 * ════════════════════════════════════════════════════════════════════════ */
describe('🔒 speakAssistant — emniyet tavanı söze göre genişler', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'platform', 'ttsService.ts'), 'utf8');
  const kod = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const govde = kod.slice(kod.indexOf('function speakAssistant'));

  it('konuşma başlarken uzunluk bütçesi BİLDİRİLİR', () => {
    const i = govde.indexOf('_markSpeakingStart()');
    expect(i).toBeGreaterThan(-1);
    // Tavanı tabana çeken çağrının HEMEN ardından genişletme gelmeli.
    expect(govde.slice(i, i + 200)).toContain('_noteSpeakingBudget(');
  });

  it('bütçe tavanı SAHİPTEN türer — ikinci süre otoritesi yok', () => {
    expect(kod).toContain('function _noteSpeakingBudget');
    expect(kod).toMatch(/_noteSpeakingBudget[\s\S]{0,160}_maxSpeechMsFor/);
  });
});
