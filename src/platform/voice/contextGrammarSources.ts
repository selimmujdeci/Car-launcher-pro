/**
 * contextGrammarSources.ts — MAVI-STT-CONTEXT-GRAMMAR bağlamının TEK okuma noktası.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ getter. `await` YOK. Timer/abonelik AÇILMAZ.
 *  · YENİ PARALEL STATE MAKİNESİ KURULMAZ — mevcut otoritelerin durumu OKUNUR.
 *  · Her kaynak AYRI try/catch → biri patlarsa diğerleri okunur ve o bağlam
 *    `null` (OKUNAMADI) olur; `false`a İNDİRGENMEZ.
 *  · ⚠️ AĞIR SERVİS IMPORT EDİLMEZ. Bu dosya `voiceService` grafiğindedir;
 *    `navigationService`/`mediaService`/`obdService` buradan import edilirse
 *    obd/store zinciri sıcak grafiğe girer ve voice testleri YÜKLENEMEZ (bu
 *    ölçülerek yaşandı — bkz. `contextGrammarProviders.ts` saha dersi). Bağlam
 *    bu yüzden bağımlılıksız sağlayıcı çekirdeğinden alınır; ağır tarafı
 *    `contextGrammarWiring.ts` boot'ta bağlar.
 *
 * ── ⚠️ MUTASYONSUZ ONAY OKUMASI (kritik) ────────────────────────────────────
 * `peekPendingAction` gözlem için KULLANILAMAZ: süresi dolmuş isteği **SİLER**
 * (üretim durumunu değiştirir). Gramer seçimi bir gözlemdir ve onay slotunu
 * tüketemez → `getPendingActionDiagnostics` kullanılır (mutasyonsuz, PII'siz).
 * Bu ayrım MAVI-M4-LAB'da da aynı gerekçeyle yapılmıştı.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Dışarı çıkan tipte yalnız üç durumlu bayrak vardır: hedef adresi, parça adı,
 * kişi adı, `actionId` ve ham komut metni bu katmana HİÇ girmez.
 */

import { getPendingActionDiagnostics } from '../action/pendingActionConfirmation';
import { getGrammarContextProviders } from './contextGrammarProviders';
import type { GrammarContextSnapshot } from './contextGrammarModel';

/** `null` = kaynak OKUNAMADI (bilinmiyor). `false`a indirgenmez. */
function _flag(fn: () => boolean): boolean | null {
  try {
    const v = fn();
    return typeof v === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Sağlayıcı BAĞLI DEĞİLSE `null` — yani "bağlam yok" değil, "BİLİNMİYOR".
 * Tahmin yapılmaz; seçim tam sözlüğe düşer.
 */
function _providerFlag(fn: (() => boolean) | undefined): boolean | null {
  return typeof fn === 'function' ? _flag(fn) : null;
}

/**
 * Anlık bağlam. `online` çağırandan gelir çünkü mevcut çevrimiçi kapısı
 * (`navigator.onLine`) `voiceService`teki TEK karar noktasıdır — burada ikinci
 * bir ağ hükmü ÜRETİLMEZ.
 */
export function readGrammarContext(online: boolean, nowMs: number = Date.now()): GrammarContextSnapshot {
  const p = getGrammarContextProviders();
  return {
    /* M4 tek otoritesi — MUTASYONSUZ yüzey. Hafif modüldür, DOĞRUDAN okunur. */
    pendingConfirmation: _flag(() => getPendingActionDiagnostics(nowMs).pending === true),
    /* Aşağıdaki üçü ağır servislerdedir → boot'ta bağlanan sağlayıcılardan okunur. */
    navigationActive:    _providerFlag(p.isNavigating),
    mediaPlaying:        _providerFlag(p.isMediaPlaying),
    vehicleSessionReady: _providerFlag(p.isVehicleSessionReady),
    online: online === true,
  };
}
