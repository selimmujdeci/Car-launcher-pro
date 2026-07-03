/**
 * openScreen.test.ts — REGRESYON KİLİDİ (SAHA 2026-07-03)
 *
 * "Asistan uygulamanın iç ekranlarını sesle açıp kapatsın" hedefi. OPEN_SCREEN
 * intent'i drawerBus/settingsFocusBus üzerinden trafik/klima/arıza kodları/Gemini
 * QR gibi İÇ yüzeyleri gerçekten açar (sadece "açıyorum" demez).
 *
 * Korunan halkalar:
 *  1. resolveScreen — Türkçe ekli/serbest adı doğru iç ekrana çözer.
 *  2. fromSemanticResult/fromAIResponse — OPEN_SCREEN köprüsü + VALID_INTENTS kapısı.
 *  3. settingsFocusBus — çok aboneli + geç-mount replay (Gemini QR iki seviyeli akış).
 *
 * Bu davranışları ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolveScreen } from '../platform/screenRegistry';
import { fromSemanticResult, fromAIResponse } from '../platform/intentEngine';
import {
  registerSettingsFocus, focusSettingsSection, _resetSettingsFocusForTest,
  type SettingsSection,
} from '../platform/settingsFocusBus';
import type { SemanticResult } from '../platform/ai/semanticAiService';

describe('screenRegistry.resolveScreen — iç ekran çözümleme', () => {
  it('tam ad → doğru ekran', () => {
    expect(resolveScreen('trafik')?.id).toBe('traffic');
    expect(resolveScreen('klima')?.id).toBe('climate');
    expect(resolveScreen('gemini qr')?.id).toBe('gemini-qr');
  });

  it('ekli/fiilli söyleyiş gövdeyle çözülür', () => {
    expect(resolveScreen('trafiği aç')?.id).toBe('traffic');
    expect(resolveScreen('klimayı kapat')?.id).toBe('climate');
    expect(resolveScreen('arıza kodlarını göster')?.id).toBe('dtc');
    expect(resolveScreen('yolculuk defterini aç')?.id).toBe('triplog');
  });

  it('eşleşme yoksa null — SAHTE ONAY YOK', () => {
    expect(resolveScreen('zzzqqq bilinmeyen ekran')).toBeNull();
    expect(resolveScreen('')).toBeNull();
  });
});

describe('OPEN_SCREEN intent köprüsü', () => {
  it('fromSemanticResult screen + screenAction taşır (varsayılan open)', () => {
    const semantic: SemanticResult = {
      intent: 'OPEN_SCREEN', screen: 'trafik',
      feedback: 'Trafik açılıyor', confidence: 0.92, source: 'direct_ai',
    };
    const intent = fromSemanticResult(semantic, 'trafiği aç');
    expect(intent?.type).toBe('OPEN_SCREEN');
    expect(intent?.payload.screen).toBe('trafik');
    expect(intent?.payload.screenAction).toBe('open');
  });

  it('screenAction="close" korunur', () => {
    const semantic: SemanticResult = {
      intent: 'OPEN_SCREEN', screen: 'bildirimler', screenAction: 'close',
      feedback: 'Bildirimler kapatılıyor', confidence: 0.9, source: 'direct_ai',
    };
    expect(fromSemanticResult(semantic, 'bildirimleri kapat')?.payload.screenAction).toBe('close');
  });

  it('fromAIResponse OPEN_SCREEN\'i GEÇİRİR (VALID_INTENTS kapısı)', () => {
    const intent = fromAIResponse(
      { intent: 'OPEN_SCREEN', payload: { screen: 'klima', screenAction: 'open' }, confidence: 0.9 },
      'klimayı aç',
    );
    expect(intent?.type).toBe('OPEN_SCREEN');
    expect(intent?.payload.screen).toBe('klima');
  });
});

describe('settingsFocusBus — çok aboneli + geç-mount replay', () => {
  afterEach(() => { _resetSettingsFocusForTest(); });

  it('geç abone bekleyen odağı tekrar alır (Gemini QR mount zinciri)', () => {
    // openDrawer('settings') sonrası panel HENÜZ mount değilken odak istenir:
    focusSettingsSection('gemini-qr');
    // SettingsPage geç abone olur → bekleyen odağı hemen alır (sekme geçişi):
    const seenByPage: SettingsSection[] = [];
    const unsubPage = registerSettingsFocus((s) => seenByPage.push(s));
    // AIVoicePanel daha da geç mount olur (sekme değişince) → o da alır:
    const seenByPanel: SettingsSection[] = [];
    const unsubPanel = registerSettingsFocus((s) => seenByPanel.push(s));

    expect(seenByPage).toEqual(['gemini-qr']);
    expect(seenByPanel).toEqual(['gemini-qr']);

    // Tüm aboneler ayrılınca (ayarlar kapanır) bayat odak temizlenir:
    unsubPage(); unsubPanel();
    const seenAfterClose: SettingsSection[] = [];
    const unsub3 = registerSettingsFocus((s) => seenAfterClose.push(s));
    expect(seenAfterClose).toEqual([]); // bayat tetik yok
    unsub3();
  });

  it('canlı aboneye anında iletir', () => {
    const seen: SettingsSection[] = [];
    const unsub = registerSettingsFocus((s) => seen.push(s));
    focusSettingsSection('sound');
    expect(seen).toEqual(['sound']);
    unsub();
  });
});
