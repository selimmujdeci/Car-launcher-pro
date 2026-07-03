/**
 * callContact.test.ts — REGRESYON KİLİDİ (kişi adıyla arama)
 *
 * "Selim'i ara" komutu beyin → AppIntent köprüsünde contactName'i taşımalı;
 * commandExecutor OPEN_PHONE case'i bu adı rehberde arayıp numarayı çevirir.
 * Bu kilit köprüyü korur (dispatch tarafı searchContacts+bridge.callNumber ile,
 * openApp.test.ts felsefesi: köprü = kritik halka, dispatch düz kod).
 *
 * Bu davranışı ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect } from 'vitest';
import { fromSemanticResult, fromAIResponse } from '../platform/intentEngine';
import type { SemanticResult } from '../platform/ai/semanticAiService';

describe('OPEN_PHONE kişi köprüsü — beyin → AppIntent', () => {
  it('contactName payload\'a taşınır ("Selim\'i ara")', () => {
    const semantic: SemanticResult = {
      intent: 'OPEN_PHONE', contactName: 'Selim',
      feedback: 'Selim aranıyor', confidence: 0.93, source: 'direct_ai',
    };
    const intent = fromSemanticResult(semantic, 'Selim\'i ara');
    expect(intent?.type).toBe('OPEN_PHONE');
    expect(intent?.payload.contactName).toBe('Selim');
  });

  it('kişi adı yoksa contactName boş — telefon uygulaması açılır (numara uydurma yok)', () => {
    const semantic: SemanticResult = {
      intent: 'OPEN_PHONE',
      feedback: 'Telefon açılıyor', confidence: 0.9, source: 'direct_ai',
    };
    const intent = fromSemanticResult(semantic, 'telefonu aç');
    expect(intent?.type).toBe('OPEN_PHONE');
    expect(intent?.payload.contactName).toBeUndefined();
  });

  it('contactName query\'e DÜŞMEZ — yanlış ada arama yapmamak için', () => {
    // OPEN_PHONE'da query varsa bile contactName'e kopyalanmaz (OPEN_APP'ten farkı).
    const semantic: SemanticResult = {
      intent: 'OPEN_PHONE', query: 'telefon rehberi',
      feedback: 'Telefon açılıyor', confidence: 0.9, source: 'direct_ai',
    };
    expect(fromSemanticResult(semantic, 'telefonu aç')?.payload.contactName).toBeUndefined();
  });

  it('fromAIResponse OPEN_PHONE\'u contactName ile GEÇİRİR (VALID_INTENTS kapısı)', () => {
    const intent = fromAIResponse(
      { intent: 'OPEN_PHONE', payload: { contactName: 'annem' }, confidence: 0.9 },
      'annemi ara',
    );
    expect(intent).not.toBeNull();
    expect(intent?.type).toBe('OPEN_PHONE');
  });
});
