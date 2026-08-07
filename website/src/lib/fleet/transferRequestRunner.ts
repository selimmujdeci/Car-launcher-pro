/**
 * transferRequestRunner.ts — DEVİR İSTEK YÜRÜTÜCÜSÜ (saf, React'siz).
 *
 * ── NEDEN AYRI ────────────────────────────────────────────────────────
 * Devir akışının güvenlik açısından kritik davranışları — çevrimdışı kapısı,
 * çift gönderim kilidi, ham hata redaksiyonu, "tamamlandı" dürüstlüğü —
 * React'e bağlı DEĞİLDİR. Hook içinde kalırlarsa yalnız bir render kütüphanesi
 * kurularak test edilebilirler; burada doğrudan ve deterministik test edilirler.
 *
 * Hook bu sınıfı sarar; karar mantığı TEK yerdedir (ikinci otorite yok).
 *
 * SAF: React YOK · global durum YOK · timer YOK. Ağ ve ağ-durumu ENJEKTE edilir.
 */

import {
  type TransferResultCode,
  toTransferResultCode,
  transferResultLabel,
} from './ownershipTransfer';
import { isFleetErrorCode } from './errors';

/** Kullanıcıya dönük sonuç — ham backend metni ASLA taşınmaz. */
export interface TransferOutcome {
  ok:      boolean;
  code:    TransferResultCode | null;
  message: string | null;
}

export const OK_OUTCOME: TransferOutcome = { ok: true, code: null, message: null };

export function transferFailure(serverCode: unknown): TransferOutcome {
  const code = toTransferResultCode(serverCode);
  return { ok: false, code, message: transferResultLabel(code) };
}

function onlineRequired(): TransferOutcome {
  return {
    ok: false,
    code: 'ONLINE_REQUIRED',
    message: transferResultLabel('ONLINE_REQUIRED'),
  };
}

export interface TransferRequest {
  method: 'POST' | 'PATCH' | 'DELETE';
  body:   Record<string, unknown>;
}

export interface RunnerOptions {
  /** Ağ durumu — her çağrıda YENİDEN sorulur (uçak modu anlık değişir). */
  isOnline: () => boolean;
  /** Enjekte edilen taşıyıcı (üretimde `fetch`). */
  send: (request: TransferRequest) => Promise<{ ok: boolean; status: number; body: unknown }>;
}

/**
 * Devir isteklerini yürütür.
 *
 * GARANTİLER:
 *   · ÇEVRİMDIŞI → istek GÖNDERİLMEZ, kuyruğa da yazılmaz (`ONLINE_REQUIRED`).
 *   · UÇUŞTA bir istek varken ikincisi GÖNDERİLMEZ (çift tıklama koruması).
 *   · Ağ istisnası "başarılı" SAYILMAZ — sonuç bilinmiyordur.
 *   · Sunucu 2xx dönmedikçe `ok:true` ÜRETİLMEZ.
 *   · Tanınmayan hata `UNKNOWN` olur; ham metin taşınmaz.
 */
export class TransferRequestRunner {
  private inFlight = false;

  constructor(private readonly options: RunnerOptions) {}

  isBusy(): boolean {
    return this.inFlight;
  }

  async run(request: TransferRequest): Promise<TransferOutcome> {
    // 1. ÇEVRİMDIŞI KAPISI — devir kuyruğa ALINMAZ, denenmez.
    if (!this.options.isOnline()) return onlineRequired();

    // 2. ÇİFT GÖNDERİM KAPISI.
    if (this.inFlight) return transferFailure('duplicate_operation');
    this.inFlight = true;

    try {
      const response = await this.options.send(request);

      if (!response.ok) {
        const code = (response.body as { code?: unknown } | null)?.code;
        return transferFailure(isFleetErrorCode(code) ? code : code ?? null);
      }

      // Sunucu 2xx → RPC transaction'ı COMMIT oldu. Ancak şimdi "tamamlandı".
      return OK_OUTCOME;
    } catch {
      // Ağ koptu → SONUÇ BİLİNMİYOR. Sunucuda uygulanmış da olabilir;
      // "başarılı" demek de "başarısız" demek de yanlış olurdu. Kullanıcıya
      // bağlantı gerektiği söylenir, listeyi yenileyince gerçek durum görülür.
      return onlineRequired();
    } finally {
      this.inFlight = false;
    }
  }
}

/** Sonuç kodundan UI durumu türetir (saf eşleme). */
export type TransferUiOutcomeState = 'completed' | 'conflict' | 'expired' | 'offline_required' | 'failed';

export function uiStateForOutcome(outcome: TransferOutcome): TransferUiOutcomeState {
  if (outcome.ok) return 'completed';
  switch (outcome.code) {
    case 'ONLINE_REQUIRED':   return 'offline_required';
    case 'TRANSFER_EXPIRED':  return 'expired';
    case 'REVISION_GAP':
    case 'TRANSFER_CONFLICT': return 'conflict';
    default:                  return 'failed';
  }
}
