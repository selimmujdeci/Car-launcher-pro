/**
 * gatewayChatBridge — mevcut AI tüketicileri ile AI Gateway arasındaki İNCE KÖPRÜ.
 *
 * Mevcut servisler (companion beyin, semantic, aiVoice) "system prompt + geçmiş +
 * kullanıcı metni → düz metin" şeklinde çalışır. Bu köprü o şekli gateway'in
 * `generateResponse()` sözleşmesine çevirir. PROMPT/PARSE İŞİ BURADA YOK —
 * çağıran ne gönderiyorsa aynen taşınır, dönen metin çağıranın KENDİ
 * ayrıştırıcısına gider (davranış değişmez).
 *
 * ── SAĞLAYICI-BAĞIMSIZ (ZORUNLU) ───────────────────────────────────────────
 * Bu dosya OpenRouter'ı (veya başka bir somut sağlayıcıyı) İMPORT ETMEZ ve
 * ADINI BİLE GEÇİRMEZ — yalnız `AiGateway` soyutlamasına bağlıdır. Sağlayıcı
 * bilgisi TEK BİR YERDE, composition root'ta (`concrete/defaultAiGateway`)
 * durur. İleride OpenRouter yerine/yanına Gemini Direct, Anthropic, xAI veya
 * Ollama eklemek = YENİ BİR `AiProvider` DOSYASI yazmak; bu köprü ve onu
 * kullanan tüketiciler DEĞİŞMEZ.
 *
 * ── DEVRE KESİCİ SEMANTİĞİ (davranış korunumu için kritik) ─────────────────
 * Mevcut companion zincirinde ayrım nettir:
 *   - fetch THROW etti (timeout/DNS/kopma) = GERÇEK ağ ölümü → devre kesiciye sayılır
 *   - HTTP yanıtı geldi ama hata (429/4xx/parse) = ağ CANLI → sayılmaz
 * Gateway asla throw etmediği için bu ayrım `netFailure` bayrağıyla taşınır:
 * yalnız `network`/`timeout` gerçek ağ ölümü sayılır. Böylece kesici eskisi
 * gibi davranır (bkz. SAHA 2026-07-04: "internetim var ama offline sanıyor").
 */

import type { AiErrorKind, AiGateway, AiMessage } from './types';

/** Köprüye verilen konuşma turu (OpenAI-uyumlu roller — sağlayıcı-nötr). */
export interface GatewayChatTurn {
  readonly role:    'user' | 'assistant';
  readonly content: string;
}

export type GatewayChatOutcome =
  | { readonly ok: true;  readonly text: string }
  | { readonly ok: false; readonly netFailure: boolean; readonly errorKind: AiErrorKind };

export interface GatewayChatParams {
  /** DI: hangi gateway kullanılacak (somut sağlayıcı burada BİLİNMEZ). */
  readonly gateway:      AiGateway;
  /** Çağıranın ZATEN ürettiği system prompt — aynen taşınır. */
  readonly system:       string;
  /** Kullanıcı metni (çağıran ne gönderiyorsa). */
  readonly user:         string;
  /** Konuşma geçmişi (sıra korunur). */
  readonly history?:     readonly GatewayChatTurn[];
  readonly timeoutMs?:   number;
  readonly maxTokens?:   number;
  readonly temperature?: number;
  /** Verilirse streaming: token-token teslim (Mavi konuşurken akıtabilir). */
  readonly onToken?:     (token: string) => void;
  /** Barge-in/iptal sinyali. */
  readonly signal?:      AbortSignal;
}

/**
 * GERÇEK ağ ölümü sayılan hata sınıfları — yalnız bunlar devre kesiciyi besler.
 * Diğerleri (429/4xx/5xx/parse/anahtar/çevrimdışı kapısı) sunucudan yanıt
 * geldiğinin ya da yerel kapının kapandığının işaretidir → kesiciye YAZILMAZ.
 */
const NET_DEATH_KINDS: readonly AiErrorKind[] = ['network', 'timeout'];

/**
 * Gateway üzerinden düz-metin sohbet cevabı alır.
 * ASLA throw etmez: her hata tipli `ok:false` sonucudur (fail-soft) — çağıran
 * zinciri eskisi gibi sürdürür.
 */
export async function askGatewayChat(params: GatewayChatParams): Promise<GatewayChatOutcome> {
  const { gateway, system, user, history, timeoutMs, maxTokens, temperature, onToken, signal } = params;

  const messages: AiMessage[] = [{ role: 'system', content: system }];
  for (const turn of history ?? []) {
    if (!turn || typeof turn.content !== 'string' || turn.content.length === 0) continue;
    messages.push({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: turn.content });
  }
  messages.push({ role: 'user', content: user });

  try {
    const result = await gateway.generateResponse(
      {
        messages,
        ...(timeoutMs   !== undefined ? { timeoutMs }   : {}),
        ...(maxTokens   !== undefined ? { maxTokens }   : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      },
      {
        ...(onToken ? { onToken } : {}),
        ...(signal  ? { signal }  : {}),
      },
    );

    if (result.ok) {
      const text = result.text.trim();
      // Boş metin "cevap üretildi" sayılmaz (uydurma yok) → sağlayıcı hatası gibi
      // ele alınır, ama ağ canlıdır (kesiciye yazılmaz).
      return text
        ? { ok: true, text }
        : { ok: false, netFailure: false, errorKind: 'malformed_response' };
    }

    return {
      ok:         false,
      netFailure: NET_DEATH_KINDS.includes(result.error.kind),
      errorKind:  result.error.kind,
    };
  } catch {
    // Gateway sözleşmesi throw etmemektir; yine de savunmacı davran.
    return { ok: false, netFailure: false, errorKind: 'unknown' };
  }
}
