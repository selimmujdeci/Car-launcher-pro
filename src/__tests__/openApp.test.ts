/**
 * openApp.test.ts — REGRESYON KİLİDİ (SAHA 2026-07-03)
 *
 * "Asistan uygulamanın genelini kullansın" hedefinin çekirdeği: sesli "X'i aç"
 * komutu HERHANGİ bir yüklü uygulamayı gerçekten açar (sadece "açıyorum" demez).
 *
 * Bu kilit üç kritik halkayı korur:
 *  1. resolveAppByName — Türkçe ekli/serbest adı doğru uygulamaya çözer.
 *  2. fromSemanticResult — beynin OPEN_APP kararını appName'li AppIntent'e köprüler.
 *  3. fromAIResponse — OPEN_APP intentEngine VALID_INTENTS kapısından GEÇER
 *     (geçmezse AI komutu "Anlayamadım"a düşerdi — sessiz kırılma).
 *
 * Bu davranışları ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import { resolveAppByName, setAppIndex, getAppIndex } from '../platform/appRegistry';
import { fromSemanticResult, fromAIResponse } from '../platform/intentEngine';
import type { SemanticResult } from '../platform/ai/semanticAiService';

describe('appRegistry.resolveAppByName — Türkçe isimle uygulama çözümleme', () => {
  it('tam ad → doğru uygulama (küratörlü liste varsayılanı)', () => {
    expect(resolveAppByName('kamera')?.id).toBe('camera');
    expect(resolveAppByName('radyo')?.id).toBe('radio');
    expect(resolveAppByName('youtube')?.id).toBe('youtube');
  });

  it('ASR eki gövdeyi bozmaz ("kamerayı" → kamera, "radyoyu" → radyo)', () => {
    expect(resolveAppByName('kamerayı')?.id).toBe('camera');
    expect(resolveAppByName('radyoyu')?.id).toBe('radio');
  });

  it('çok kelimeli ad ("hesap makinesini") token örtüşmesiyle çözülür', () => {
    expect(resolveAppByName('hesap makinesini')?.id).toBe('calculator');
  });

  it('komut gürültüsü ("kamera uygulamasını aç") temizlenip çözülür', () => {
    expect(resolveAppByName('kamera uygulamasını aç')?.id).toBe('camera');
  });

  it('eşleşme yoksa null — SAHTE ONAY YOK (çağıran "bulamadım" der)', () => {
    expect(resolveAppByName('zzzqqq bilinmeyen uygulama')).toBeNull();
    expect(resolveAppByName('')).toBeNull();
    expect(resolveAppByName('a')).toBeNull();
  });

  it('setAppIndex ile keşfedilen native uygulama eklenince isimle bulunur', () => {
    const prev = [...getAppIndex()];
    setAppIndex([
      ...prev,
      {
        id: 'native-com.whatsapp', name: 'WhatsApp', icon: '', category: 'communication',
        url: '', androidPackage: 'com.whatsapp', supportsFavorite: true, supportsRecent: true,
      },
    ]);
    try {
      expect(resolveAppByName('whatsapp')?.id).toBe('native-com.whatsapp');
      expect(resolveAppByName('whatsapp\'ı aç')?.id).toBe('native-com.whatsapp');
    } finally {
      setAppIndex(prev); // izolasyon — sonraki testlere sızmasın
    }
  });
});

describe('OPEN_APP intent köprüsü — beyin → AppIntent', () => {
  it('fromSemanticResult OPEN_APP appName\'i payload\'a taşır', () => {
    const semantic: SemanticResult = {
      intent: 'OPEN_APP', appName: 'kamera',
      feedback: 'Kamera açılıyor', confidence: 0.92, source: 'direct_ai',
    };
    const intent = fromSemanticResult(semantic, 'kamerayı aç');
    expect(intent?.type).toBe('OPEN_APP');
    expect(intent?.payload.appName).toBe('kamera');
  });

  it('appName yoksa query\'e düşer (esneklik)', () => {
    const semantic: SemanticResult = {
      intent: 'OPEN_APP', query: 'radyo',
      feedback: 'Radyo açılıyor', confidence: 0.9, source: 'direct_ai',
    };
    expect(fromSemanticResult(semantic, 'radyoyu aç')?.payload.appName).toBe('radyo');
  });

  it('fromAIResponse OPEN_APP\'i GEÇİRİR (VALID_INTENTS kapısı) — kritik', () => {
    const intent = fromAIResponse(
      { intent: 'OPEN_APP', payload: { appName: 'kamera' }, confidence: 0.9 },
      'kamerayı aç',
    );
    expect(intent).not.toBeNull();
    expect(intent?.type).toBe('OPEN_APP');
    expect(intent?.payload.appName).toBe('kamera');
  });
});
