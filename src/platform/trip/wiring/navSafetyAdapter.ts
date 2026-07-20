/**
 * navSafetyAdapter — MAVI 4.0 · TRIP AI · MAVI4-TRIP-5B · HEDEF 3.
 *
 * TripApplyEngine'in `safetyCheck` sözleşmesine MEVCUT sürüş/bilişsel durumdan gerçek,
 * FAIL-CLOSED bir karar sağlar. Yeni paralel güvenlik sistemi KURULMAZ.
 *
 * KAYNAK: useCognitiveStore.currentMode — CognitivePriorityEngine'in termal + tehlike +
 * sürücü-dikkat-bütçesi füzyonundan ürettiği 6 seviyeli kognitif mod. Rota-apply, sürücü
 * dikkati kısıtlıyken güvenli değildir; bu yüzden orta+ yükte reddedilir:
 *
 *   IMMERSIVE(0) · AWARE(1) · FOCUSED(2)  → izinli (dikkat bütçesi yeterli)
 *   PROTECTION(3) · CRITICAL(4) · LIMP_HOME(5) → REDDET (yüksek yük / termal / tehlike)
 *
 * FAIL-CLOSED: kaynak okunamazsa VEYA mod bilinmiyorsa → REDDET. throw ETMEZ.
 *
 * KAPSAM SINIRI: Bu adapter YALNIZ karar döndürür — UI açmaz, konuşmaz. AiSafetyGate (ECU)
 * kapsamı GENİŞLETİLMEZ: rota-apply bir araç/ECU eylemi değildir; bu köprü hiçbir araç
 * kapsamı talep etmez, gate'i baypas edecek bir yol açmaz.
 */

import { useCognitiveStore, MODE_RANK, type CognitiveMode } from '../../../store/useCognitiveStore';

export interface NavSafetyDecision {
  allowed: boolean;
  reason?: string;
}

export interface NavSafetyAdapterDeps {
  /** Bilişsel mod okuyucu (test/enjekte). Varsayılan: useCognitiveStore. */
  readMode?: () => CognitiveMode | null | undefined;
}

/** Apply'ın izinli olduğu azami kognitif yük — bu rank'in ALTINDA izinli, dahil/üstünde REDDET. */
const APPLY_BLOCK_RANK = MODE_RANK['PROTECTION']; // 3

/**
 * Production navigasyon-güvenlik kapısı üretir. TripApplyEngine.safetyCheck'e enjekte edilir.
 * Dönen fonksiyon senkron, saf-okur, fail-closed.
 */
export function createNavSafetyAdapter(deps: NavSafetyAdapterDeps = {}): () => NavSafetyDecision {
  const readMode = deps.readMode ?? ((): CognitiveMode | null | undefined => {
    try { return useCognitiveStore.getState().currentMode; }
    catch { return null; }
  });

  return (): NavSafetyDecision => {
    let mode: CognitiveMode | null | undefined;
    try {
      mode = readMode();
    } catch {
      return { allowed: false, reason: 'safety_state_unreadable' }; // fail-closed
    }
    if (!mode || !(mode in MODE_RANK)) {
      return { allowed: false, reason: 'safety_state_unknown' };     // fail-closed
    }
    if (MODE_RANK[mode] >= APPLY_BLOCK_RANK) {
      return { allowed: false, reason: `cognitive_${mode.toLowerCase()}` };
    }
    return { allowed: true };
  };
}
