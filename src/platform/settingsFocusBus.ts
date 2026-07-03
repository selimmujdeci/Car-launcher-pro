/**
 * settingsFocusBus.ts — Ayarlar sayfası içindeki belirli bir bölüme/panele sesle
 * odaklanma bus'ı. "Gemini QR'ı aç" gibi komutlar ayarları açtıktan sonra doğru
 * sekmeyi (SettingsPage) seçip ilgili paneli (AIVoicePanel → KeyBeam) genişletmeli.
 *
 * Neden çok aboneli + replay: hedef panel (AIVoicePanel) yalnız doğru sekme
 * seçilince MOUNT olur. Akış zinciri: openDrawer('settings') → SettingsPage mount
 * → sekme='general' → AIVoicePanel mount. focusSettingsSection senkron çağrılır
 * ama aboneler kademeli mount olur; bu yüzden son istenen bölüm (_current) tutulur
 * ve GEÇ abone olan her dinleyiciye tekrar iletilir. Son abone ayrılınca (ayarlar
 * drawer'ı kapanınca) _current temizlenir → bayat tetik yok.
 */

export type SettingsSection = 'gemini-qr' | 'assistant' | 'sound' | 'appearance';

type FocusHandler = (section: SettingsSection) => void;

const _handlers = new Set<FocusHandler>();
let _current: SettingsSection | null = null;

/**
 * Bir bölüm odak dinleyicisi kaydeder. Zaten bekleyen bir odak varsa (geç mount
 * eden panel) hemen tekrar iletilir. Dönen fonksiyon aboneliği iptal eder.
 */
export function registerSettingsFocus(fn: FocusHandler): () => void {
  _handlers.add(fn);
  if (_current) fn(_current); // geç abone → bekleyen odağı tekrar al
  return () => {
    _handlers.delete(fn);
    if (_handlers.size === 0) _current = null; // ayarlar kapandı → bayat tetik yok
  };
}

/** Ayarlar içinde bir bölüme odaklan (sesli "X ayarını/QR'ı aç"). */
export function focusSettingsSection(section: SettingsSection): void {
  _current = section;
  _handlers.forEach((fn) => fn(section));
}

/** @internal testler için — bus durumunu sıfırlar. */
export function _resetSettingsFocusForTest(): void {
  _handlers.clear();
  _current = null;
}
