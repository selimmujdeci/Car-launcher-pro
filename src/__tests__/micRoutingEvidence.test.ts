/**
 * micRoutingEvidence.test.ts — **SAHA #1255-a · YANLIŞ MİKROFON GİRİŞİ ARTIK GÖRÜNÜR.**
 *
 * ── ÖLÇÜLEN ARIZA (2026-09-04, K2401 head unit) ─────────────────────────────
 * "Hey Mavi" 10 denemede HİÇ tetiklenmedi. `tinycap` ile donanımdan doğrudan
 * kayıtta tepe genlik **1.073/32768 (%3,3)**, RMS 64 — pratikte gürültü tabanı.
 * Uygulamanın VAD'ı `lastRms ≈ 0,010` ölçüyordu, eşik `VAD_RMS_ON = 0,012` →
 * konuşma "sessizlik" sayılıp Vosk'a HİÇ gönderilmiyordu.
 *
 * Kök neden uygulamada DEĞİLDİ: cihazda iki mikrofon girişi var ve OEM ayarı
 * `key_double_mic = 0` ile YANLIŞ olan seçiliydi. `= 1` yapılınca konuşma RMS'i
 * **0,03-0,10** (eşiğin 3-8 katı) oldu ve wake tetiklendi (güven %86,3).
 *
 * ── BU KİLİDİN KAPSADIĞI BORÇ ───────────────────────────────────────────────
 * Kütük #1255 açık borç (a): *"uygulama bu ayarı OKUMUYOR ve yanlış mikrofon
 * seçiliyken kullanıcıya hiçbir teşhis vermiyor — LAB'da giriş yolu + ölçülen
 * seviye + eşik yan yana gösterilmeli."*
 *
 * ── SINIR (dürüstlük) ───────────────────────────────────────────────────────
 * Ayar SALT-OKUNURDUR. LAB onu DEĞİŞTİREMEZ (aktif komut yasağı) ve okunamadığı
 * durumda `0` UYDURULMAZ — "0" (yanlış giriş) ile "bilinmiyor" AYRI şeylerdir;
 * karıştırılırsa teşhis TERS döner.
 *
 * ZAYIFLATMA/SİLME YASAK (CLAUDE.md §Regresyon Kasası).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSttSections } from '../platform/devtools/sttMicModel';
import type { SttMicRaw } from '../platform/devtools/sttMicModel';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Sahadaki iki durumu birebir yeniden üreten asgari anlık görüntü. */
function snap(opts: {
  oemDualMic: number | null;
  lastRms: number;
  threshold: number;
}): SttMicRaw {
  return {
    readAt: 1_700_000_000_000,
    capturedAt: 1_700_000_000_000,
    present: true,
    path: 'WAKE',
    sessionActive: true,
    sessionStartedAt: 1,
    source: {
      selectedSource: 6,
      selectedSourceName: 'VOICE_RECOGNITION',
      sampleRate: 16_000,
      channelCount: 1,
      bufferBytes: 4_096,
      frameSamples: 512,
      attempts: [],
      oemDualMic: opts.oemDualMic,
    },
    effects: null,
    vad: {
      present: true,
      lastRms: opts.lastRms,
      noiseFloor: -1,
      effectiveThreshold: opts.threshold,
      staticMinThreshold: opts.threshold,
      floorFactor: -1,
      speechDetected: opts.lastRms >= opts.threshold,
      lastAudioAtMs: 900,
      monotonicNowMs: 1_000,
      sampleCount: 4,
      samples: [],
    },
    stt: null,
    wakeNative: null,
    wake: null,
    warnings: [],
  } as unknown as SttMicRaw;
}

function field(s: SttMicRaw, id: string): { klass: string; value: unknown } | null {
  for (const sec of buildSttSections(s)) {
    for (const f of sec.fields) if (f.id === id) return f as unknown as { klass: string; value: unknown };
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * A · DAVRANIŞ — sahadaki iki durum ayırt edilebiliyor mu
 * ════════════════════════════════════════════════════════════════════════ */

describe('SAHA #1255-a/A — giriş yolu ile ölçülen seviye YAN YANA okunuyor', () => {
  it('çapa: her iki alan da gerçekten üretiliyor', () => {
    const s = snap({ oemDualMic: 1, lastRms: 0.05, threshold: 0.012 });
    expect(field(s, 'sttOemDualMic'), 'OEM ayarı alanı yok — kilit körleşti').not.toBeNull();
    expect(field(s, 'sttLevelVsThreshold'), 'oran alanı yok — kilit körleşti').not.toBeNull();
  });

  it('ARIZALI DURUM (ölçülen): key_double_mic=0 · RMS eşiğin ALTINDA', () => {
    /* 2026-09-04 K2401 ölçümü: lastRms 0,010 · eşik 0,012. */
    const s = snap({ oemDualMic: 0, lastRms: 0.010, threshold: 0.012 });
    const oem = field(s, 'sttOemDualMic')!;
    expect(oem.klass).toBe('OBSERVED');
    expect(String(oem.value)).toContain('key_double_mic = 0');

    const ratio = field(s, 'sttLevelVsThreshold')!;
    expect(ratio.klass, 'oran gözlem gibi sunuldu — türetilmiş olmalı').toBe('DERIVED');
    expect(String(ratio.value)).toContain('ALTINDA');
    expect(String(ratio.value)).toContain('0.83');
  });

  it('DÜZELTİLMİŞ DURUM (ölçülen): key_double_mic=1 · RMS eşiğin 3-8 katı', () => {
    const s = snap({ oemDualMic: 1, lastRms: 0.05, threshold: 0.012 });
    expect(String(field(s, 'sttOemDualMic')!.value)).toContain('key_double_mic = 1');
    const ratio = String(field(s, 'sttLevelVsThreshold')!.value);
    expect(ratio).toContain('ÜSTÜNDE');
    expect(ratio).toContain('4.17');
  });

  it('AYAR OKUNAMAZSA sahte `0` ÜRETİLMEZ (teşhis ters dönmesin)', () => {
    const s = snap({ oemDualMic: null, lastRms: 0.05, threshold: 0.012 });
    const oem = field(s, 'sttOemDualMic')!;
    expect(oem.klass, '"bilinmiyor" gözlem gibi sunuldu').toBe('UNAVAILABLE');
    expect(String(oem.value)).not.toContain('key_double_mic = 0');
  });

  it('ÖLÇÜM ya da EŞİK yoksa oran UYDURULMAZ', () => {
    const s = snap({ oemDualMic: 1, lastRms: -1, threshold: -1 });
    expect(field(s, 'sttLevelVsThreshold')!.klass).toBe('UNAVAILABLE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B · YAPISAL — salt-okunurluk ve yeni ekran yasağı
 * ════════════════════════════════════════════════════════════════════════ */

describe('SAHA #1255-a/B — yapısal kilitler', () => {
  const JAVA  = read('android/app/src/main/java/com/cockpitos/pro/CarLauncherPlugin.java');
  const MODEL = stripComments(read('src/platform/devtools/sttMicModel.ts'));
  const SRCS  = stripComments(read('src/platform/devtools/sttMicSources.ts'));

  it('native taraf ayarı OKUR ve okunamazsa dürüstçe bildirir', () => {
    expect(JAVA).toContain('"key_double_mic"');
    expect(JAVA).toContain('dualMicSettingRead');
    /* Okunamayan ayar için sahte değer basılmamalı: `read=false` tek başına gider. */
    const i = JAVA.indexOf('"key_double_mic"');
    const block = JAVA.slice(i, i + 600);
    expect(block, 'okunamayan ayar için sahte değer basılıyor')
      .not.toMatch(/catch[\s\S]{0,160}put\("dualMicSetting",/);
  });

  it('ayar hiçbir yerden YAZILMAZ (LAB aktif komut göndermez)', () => {
    expect(JAVA, 'OEM mikrofon ayarı uygulamadan yazılıyor — salt-okunurluk delindi')
      .not.toMatch(/putInt\([^)]*key_double_mic/);
    expect(MODEL).not.toContain('key_double_mic"');
    for (const forbidden of ['putInt', 'setOemDualMic', 'writeSetting']) {
      expect(MODEL, `LAB modeli yazma yoluna girdi: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('okuma katmanı "0" ile "bilinmiyor"u AYIRIR', () => {
    expect(SRCS).toContain('dualMicSettingRead === true');
    expect(SRCS, 'okunamayan ayar `null` yerine sayıya düşürülmüş')
      .toMatch(/oemDualMic:[\s\S]{0,160}: null,/);
  });

  it('oran TÜRETİLMİŞTİR — yeni eşik/hüküm kurulmadı', () => {
    const i = MODEL.indexOf("id: 'sttLevelVsThreshold'");
    expect(i, 'oran alanı yok — kilit körleşti').toBeGreaterThan(-1);
    expect(MODEL.slice(Math.max(0, i - 120), i)).toContain('derived(');
    /* Yeni bir eşik SABİTİ tanımlanmamalı: kıyas mevcut `effectiveThreshold`e
       göre yapılır, LAB kendi eşiğini ÜRETMEZ (ikinci otorite yasağı). */
    const blk = MODEL.slice(i, i + 700);
    expect(blk).toContain('v.effectiveThreshold');
    expect(blk, 'LAB kendi eşik sabitini üretti').not.toMatch(/=\s*0\.0\d+/);
  });

  it('YENİ LAB EKRANI AÇILMADI — mevcut STT/Mikrofon ekranı genişletildi', () => {
    const catalog = read('src/platform/devtools/carosLabCatalog.ts');
    expect(catalog, 'mikrofon yönlendirmesi için ayrı ekran açılmış (ekran enflasyonu yasağı)')
      .not.toMatch(/mic-routing|oem-mic|dual-mic/);
  });
});
