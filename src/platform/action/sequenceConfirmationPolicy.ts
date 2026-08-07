/**
 * sequenceConfirmationPolicy.ts — ÇOKLU ONAY GEREKTİREN SEQUENCE · FAIL-CLOSED (P1)
 *
 * ── ONARILAN KUSUR (bağımsız denetim, P1) ───────────────────────────────────
 * Tek bir sesli turda iki onay gerektiren araç eylemi bulunduğunda zincir
 * dispatcher İKİ handler'ı da başlatıyordu. Her biri
 * `executeIntent() → needs_confirmation → setPendingAction()` yoluna girebiliyor;
 * bekleyen onay deposu ise TEK global slot ve **last-writer-wins**. MaviSpeech
 * tur başına yalnız İLK onay sorusunu geçirdiği için:
 *
 *   "aracı kilitle ve kornaya bas"
 *     → kullanıcı "Kapıları kilitlememi onaylıyor musun?" DUYAR
 *     → bekleyen slotta HARDWARE_HORN kalır
 *     → "evet" denince KORNA çalar
 *
 * Onaysız native dispatch YOKTU; ama **duyulan onay ile onaylanan eylemin
 * kimliği ayrışıyordu** → rıza sahipliği (consent ownership) ve determinizm
 * ihlali.
 *
 * ── SEÇİLEN POLİTİKA: TAMAMINI REDDET ───────────────────────────────────────
 * Bir turda birden fazla onay gerektiren araç eylemi varsa sequence **dispatch
 * ÖNCESİNDE** tamamen reddedilir. Kuyruk YOK · "yalnız ilkini çalıştır" YOK ·
 * first-writer-wins YOK · çoklu onay durum makinesi YOK. Belirsiz rızada
 * hiçbir şey yapmamak, yanlış eylemi onaylatmaktan ÜSTÜNDÜR.
 *
 * ── RİSK BİLGİSİNİN KAYNAĞI ─────────────────────────────────────────────────
 * `requiresConfirmation` YALNIZ `maviActionAuthority` defterinden okunur
 * (`isVehicleEffectiveIntent` + `getVehicleActionDef`). Parser ifadelerinden
 * risk TÜRETİLMEZ, ikinci bir eylem/ifade listesi TUTULMAZ. Defterde bir eylemin
 * onay politikası değişirse bu kapı OTOMATİK olarak onunla birlikte değişir.
 *
 * SAF MODÜL: global durum yok · I/O yok · timer yok · `Date.now` yok · native yok.
 * Aynı girdi → aynı karar (deterministik).
 */

import { commandTypeToIntentType } from '../intentEngine';
import { getVehicleActionDef, isVehicleEffectiveIntent } from './maviActionAuthority';
import type { ParsedCommand } from '../commandParser';

export type SequenceConfirmationDecision =
  | {
      readonly allowed: true;
      /** 0 veya 1 — gözlem için taşınır, karar değiştirmez. */
      readonly confirmationRequiredCount: number;
    }
  | {
      readonly allowed: false;
      readonly reason: 'multiple_confirmation_required_actions';
      readonly count: number;
    };

/**
 * Kullanıcıya söylenen TEK ve dürüst mesaj. Eyleme özgü hiçbir onay sorusu
 * ("Kapıları kilitlememi onaylıyor musun?") ÜRETİLMEZ — çünkü hangi eylemin
 * onaylandığı belirsizdir ve belirsiz rıza sorulmaz.
 */
export const MULTI_CONFIRMATION_REFUSAL_TEXT =
  'Aynı anda birden fazla araç işlemini onaylayamam. Lütfen komutları tek tek söyle.';

/** Bu komut, AÇIK kullanıcı onayı gerektiren araç etkili bir eylem mi? */
export function commandRequiresConfirmation(cmd: ParsedCommand | null | undefined): boolean {
  if (!cmd) return false;
  try {
    const intent = commandTypeToIntentType(cmd.type);
    if (!isVehicleEffectiveIntent(intent)) return false;
    return getVehicleActionDef(intent)?.requiresConfirmation === true;
  } catch {
    /* Fail-soft: defter okunamazsa kapı YENİ bir kırılma noktası açmaz.
       Güvenlik kaybı yoktur — tekil onay akışı (M4) yerinde durur. */
    return false;
  }
}

/**
 * Sequence kararı — YAN ETKİSİZ. Yalnız sayar ve hüküm verir; dispatch,
 * konuşma, bekleyen onay ve port bu modülün İŞİ DEĞİLDİR.
 *
 * ⚠️ Onay GEREKTİRMEYEN eylemler (ör. `HARDWARE_REAR_CAMERA`,
 * `HARDWARE_SCREEN_OFF`, `HARDWARE_LIGHTS_OFF`) sayıma GİRMEZ → "geri kamerayı
 * aç ve ekranı kapat" bu kapı tarafından reddedilmez.
 */
export function classifySequenceConfirmationPolicy(
  commands: readonly ParsedCommand[],
): SequenceConfirmationDecision {
  const list = Array.isArray(commands) ? commands : [];
  let count = 0;
  for (const cmd of list) if (commandRequiresConfirmation(cmd)) count++;
  return count > 1
    ? { allowed: false, reason: 'multiple_confirmation_required_actions', count }
    : { allowed: true, confirmationRequiredCount: count };
}
