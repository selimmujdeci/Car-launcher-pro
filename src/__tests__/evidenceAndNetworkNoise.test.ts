/**
 * #668 KİLİTLERİ — LAB kopyasından çıkan iki gürültü kusuru.
 *
 * Kaynak: kullanıcının cihazdan aldığı CAROS LAB tam kopyası (2026-08-20).
 *  1. Kanıt özeti ham çift duyarlıklı sayı basıyordu
 *     (`trip_distance=0.11309596145554154km`).
 *  2. Araç açılışında ağ hazır olmadığı için düşen iki fail-soft çağrı,
 *     hata defterine KIRMIZI `error` olarak yazılıyordu.
 *
 * Bu kilitler ZAYIFLATILMAZ; davranış bilinçli değişirse kilit GÜNCELLENİR.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatEvidenceValue } from '../platform/aiCore/evidenceStore';
import { isNetworkAbsenceError } from '../platform/crashLogger';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('#668 · kanıt özeti okunur, ham değer korunur', () => {
  it('KİLİT: mesafe 17 haneli basılmaz', () => {
    expect(formatEvidenceValue(0.11309596145554154, 'km')).toBe('0.11');
  });

  it('KİLİT: birime göre hassasiyet', () => {
    expect(formatEvidenceValue(11.4, 'km/h')).toBe('11');
    expect(formatEvidenceValue(63.2, '°C')).toBe('63');
    expect(formatEvidenceValue(1649.7, 'rpm')).toBe('1650');
    expect(formatEvidenceValue(12.94, 'V')).toBe('12.9');
  });

  it('KİLİT: gereksiz sıfır eklenmez (0.10 değil 0.1)', () => {
    expect(formatEvidenceValue(0.1, 'km')).toBe('0.1');
    expect(formatEvidenceValue(5, 'km')).toBe('5');
  });

  it('KİLİT: sayı olmayan değer olduğu gibi kalır', () => {
    expect(formatEvidenceValue('kapalı' as unknown as string, '')).toBe('kapalı');
    expect(formatEvidenceValue(true as unknown as boolean, '')).toBe('true');
    expect(formatEvidenceValue(Number.NaN, 'km')).toBe('NaN');
  });

  it('KİLİT: kırpma YALNIZ özet metnindedir — ham değer zarfta kalır', () => {
    /* Kanıtın kendisi `sig.value`yu taşır; kısaltılan insan-okur satırdır.
       Bu kilit, birinin "sadeleştirme" adına ham değeri yuvarlamasını önler. */
    const src = read('src/platform/aiCore/evidenceStore.ts');
    expect(src).toContain('formatEvidenceValue(sig.value, sig.unit)');
    expect(src).toMatch(/ham değer[\s\S]{0,80}AYNEN kalır/i);
  });
});

describe('#668 · ağ yokluğu hata defterini kirletmez', () => {
  it('KİLİT: ağ yokluğu imzaları tanınır', () => {
    expect(isNetworkAbsenceError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkAbsenceError(new Error('NetworkError when attempting to fetch'))).toBe(true);
    expect(isNetworkAbsenceError(new Error('The operation was aborted'))).toBe(true);
    expect(isNetworkAbsenceError('net::ERR_INTERNET_DISCONNECTED')).toBe(true);
  });

  it('KİLİT: GERÇEK hata ağ sayılmaz — sessizleştirme yok', () => {
    expect(isNetworkAbsenceError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isNetworkAbsenceError(new RangeError('Maximum call stack size exceeded'))).toBe(false);
    expect(isNetworkAbsenceError(new Error('PGRST205 table not found'))).toBe(false);
    expect(isNetworkAbsenceError(null)).toBe(false);
  });

  it('KİLİT: açılışta düşen iki fail-soft çağrı ağ-farkında loglar', () => {
    /* Saha: `weatherService:fetchFuel` ve `geofenceService:_loadAndPushZones`
       araç açılışında `Failed to fetch` ile düşüp defterde KIRMIZI duruyordu. */
    expect(read('src/platform/weatherService.ts')).toContain('logNetworkAware');
    expect(read('src/platform/security/geofenceService.ts')).toContain('logNetworkAware');
  });

  it('KİLİT: kayıt BASTIRILMAZ — yalnız seviye düşer', () => {
    /* Olay defterde kalmalı; "ağ yoktu" bilgisi de bir gözlemdir. */
    const src = read('src/platform/crashLogger.ts');
    expect(src).toContain("isNetworkAbsenceError(error) ? 'warning' : 'error'");
    expect(src).toMatch(/kayd[ıi] BASTIRMAZ|Olay yine defterdedir/i);
  });
});

describe('#669 · "tekrar söyle" yalnız tekrarın işe yaradığı yerde', () => {
  const provider = read('src/platform/companion/companionChatProvider.ts');

  it('KİLİT: ağ ölümünde REASK DEĞİL, dürüst cevap verilir', () => {
    /* Saha: kullanıcı telefonda "Mavi cevap vermiyor, 'of orayı kaçırdım'
       diyor" dedi. O cümle REASK'tır ve "seni duyamadım, TEKRAR SÖYLE"
       anlamına gelir — oysa tetikleyen şey çoğu kez STT değil, ağın ölmüş
       olmasıydı. Tekrar söylemek işe yaramaz; kullanıcı döngüye girer. */
    /* MAVI-F13/4: persona metinleri `companionAnswerShaping`e taşındı — kilit
       SİLİNMEDİ, yeni sahibine bağlandı ve DAVRANIŞLA güçlendirildi: artık
       "REASK ≠ NET_DOWN" ayrımının GERÇEKTEN korunduğu da doğrulanıyor. */
    const shaping = read('src/platform/companion/companionAnswerShaping.ts');
    expect(shaping).toContain('NET_DOWN_BY_PERSONALITY');
    expect(provider).toContain("route: 'companion_net_down'");
    /* Ton kişiliğe uyar (persona sözleşmesi korunur), içerik dürüsttür. */
    expect(provider).toMatch(/netDeathOnly[\s\S]{0,300}netDownReply\(/);
  });

  it('DAVRANIŞ: REASK ile NET_DOWN metinleri ASLA aynı değildir (#669 özü)', async () => {
    /* Kusurun özü iki farklı arızanın AYNI cümleyi duyurmasıydı. Kaynak taraması
       bunu yakalayamaz; iki tabloyu gerçekten çağırıp karşılaştırıyoruz. */
    const { reaskReply, netDownReply } =
      await import('../platform/companion/companionAnswerShaping');
    for (const p of ['sessiz', 'samimi', 'neseli', 'profesyonel', 'bilinmeyen']) {
      expect(reaskReply(p), `${p}: REASK boş`).toBeTruthy();
      expect(netDownReply(p), `${p}: NET_DOWN boş`).toBeTruthy();
      expect(netDownReply(p), `${p}: ağ ölümünde yine "tekrar söyle" duyuluyor`)
        .not.toBe(reaskReply(p));
    }
    // Bilinmeyen kişilik fail-soft: cümle üretilir, boşluğa düşülmez.
    expect(reaskReply('bilinmeyen')).toBe(reaskReply('__yok__'));
  });

  it('KİLİT: ağ ölümü ölçümü dış kapsama TAŞINIR (bilgi var, besleyen yok deseni)', () => {
    expect(provider).toContain('let netDeathOnly = false;');
    expect(provider).toContain('netDeathOnly = aiAttempted && sawNetFailure && !sawHttpResponse;');
  });

  it('KİLİT: HTTP yanıtı gelmişse ağ ölü SAYILMAZ — REASK korunur', () => {
    /* 429/4xx/5xx/parse hataları ağın canlı olduğunun kanıtıdır; o hâllerde
       "tekrar söyle" doğru cevaptır ve dürüst kota/anahtar dalları da bozulmaz. */
    expect(provider).toContain('!sawHttpResponse');
    expect(provider).toContain("route: 'companion_rate_limited'");
    /* MAVI-F13/3: kimlik/kredi dalı TEK noktadan ve `failure.kind`e göre
       yönlendiriliyor (işaretler `companionProviderHealth` defterinden okunur).
       Kilit sabit metne değil DALIN KENDİSİNE bağlanır — ve GÜÇLENDİ: artık
       kredi ↔ anahtar AYRIMININ da kaybolmadığı doğrulanıyor (ikisi AYRI
       eylem gerektirir: bakiye yükle ↔ anahtar yenile, #698). */
    expect(provider, 'dürüst kimlik/kredi dalı kayboldu — kullanıcı yine REASK duyar')
      .toMatch(/resolveProviderFailureAnswer\(\)/);
    expect(provider, 'kimlik ↔ kredi rota ayrımı kayboldu (#698)')
      .toMatch(/failure\.kind === 'no_credit' \? 'companion_no_credit' : 'companion_key_invalid'/);
  });

  it('KİLİT: bağlantı kalitesi -1 iken kanıt ÜRETİLMEZ', () => {
    /* LAB kopyasında kanıt satırı "Bağlantı kalitesi %-1" yazıyordu; -1
       bilinmiyor sentinelidir, ölçüm değildir. */
    const diag = read('src/platform/aiCore/runtime/diagnosticEvidence.ts');
    expect(diag).toContain('q !== null && q >= 0');
  });
});

describe('#670 · boşta ısıtan iş (performans denetimi bulguları)', () => {
  it('KİLİT: DÖRT temanın saati de düşük-uç kapısına bağlı', () => {
    /* Saha ölçümü (Tesla/Expedition yorumunda kayıtlı): zayıf GPU'da saniye
       ibresi = her saniye re-render = tik başına ~60 ms tam boyama, boşta
       jank'ın ana etkeni. Düzeltme Tesla ve Expedition'a uygulanmış ama
       HORIZON'A PORTLANMAMIŞTI — aynı kusur bir temada açık kalmıştı. */
    for (const theme of ['Tesla', 'Expedition', 'Horizon']) {
      const src = read(`src/components/themes/${theme}Layout.tsx`);
      expect(src, `${theme}: tier kapısı yok`).toContain('isLowEndDevice');
      expect(src, `${theme}: koşulsuz 1 Hz saat`).not.toContain(
        'setInterval(() => setNow(new Date()), 1000)',
      );
    }
  });

  it('KİLİT: Horizon saniye ibresi düşük-uçta çizilmez', () => {
    /* İbre `drop-shadow` taşıyor; filter compositor-only değildir, her tikte
       tam repaint tetikler. 30 sn'de tazelenen saatte zaten yanlış yeri
       gösterirdi. */
    expect(read('src/components/themes/HorizonLayout.tsx')).toContain('{!lowEnd && (');
  });

  it('KİLİT: analog saat tiki kapatılabilir — dijital saatte timer kurulmaz', () => {
    /* `useAnalogClock` parametresizdi; hooks kuralı gereği çağıran her yerde
       koşulsuz çalışıyordu. Ekran koruyucu (tam "boşta" senaryosu) dijital
       saatte bile saniyede bir re-render alıyordu. */
    const hook = read('src/hooks/useClock.ts');
    expect(hook).toContain('export function useAnalogClock(enabled = true)');
    expect(hook).toContain('if (!enabled) return;');
    expect(read('src/components/layout/SleepOverlay.tsx'))
      .toContain("useAnalogClock(clockStyle === 'analog')");
  });
});
