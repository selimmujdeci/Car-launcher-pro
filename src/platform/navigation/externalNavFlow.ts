/**
 * externalNavFlow — "Yandex'ten Mersin'e rota kur" yürütmesi.
 *
 * Sıra:
 *  1. Hedef BİZİM çözücümüzle koordinata çevrilir (kayıtlı konum → doğrudan;
 *     değilse `resolveAndNavigate`, tam ekran harita AÇILMADAN). Böylece bizim
 *     rotamız da kurulur ve mini haritada görünür (sahibin isteği: "mini harita
 *     sabit; harici rota olduğunda devreye girsin").
 *  2. Onaylanan koordinatla harici uygulama açılır (`launchExternalRoute`).
 *  3. Açıldıysa yol tarifi sahipliği harici uygulamaya geçer — bizim anonslarımız
 *     susar (`externalGuidanceOwner`). Açılamadıysa sahiplik kurulmaz, rota
 *     bizim haritada sürer ve bu DÜRÜSTÇE söylenir.
 *
 * Rota/konum gerçeği ÜRETMEZ: çözümleme ve rota mevcut sahiplerindedir; bu
 * modül yalnız sıralar. Bağımlılıklar test için enjekte edilir.
 */
import type { ExternalNavProvider } from './externalGuidanceOwner';
import { EXTERNAL_NAV_LABEL } from './externalNavHandoff';

export interface ExternalNavTarget { lat: number; lng: number; name: string; id?: string }

export interface ExternalNavAddressState {
  phase:    'idle' | 'searching' | 'selecting' | 'confirmed' | 'error';
  query:    string;
  selected: { lat: number; lng: number; name: string } | null;
}

export interface ExternalNavFlowDeps {
  /** Kayıtlı konum eşleşmesi (tek otorite: savedLocationsService). */
  findSaved: (dest: string) => { match: ExternalNavTarget | null; ambiguous: readonly unknown[] };
  /** Kayıtlı konumla BİZİM rotamızı başlatır. */
  startOwnNavigation: (t: ExternalNavTarget) => void;
  /** Serbest hedefi çözer ve BİZİM rotamızı başlatır — tam ekran harita açmadan. */
  resolveWithoutFullMap: (dest: string) => void;
  onAddressState: (fn: (s: ExternalNavAddressState) => void) => () => void;
  launch: (provider: ExternalNavProvider, lat: number, lng: number) => Promise<boolean>;
  setGuidanceOwner: (p: ExternalNavProvider) => void;
  clearGuidanceOwner: () => void;
  say: (text: string) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}

/** Kullanıcı birden çok sonuç arasından seçerken beklenecek azami süre. */
export const EXTERNAL_NAV_WAIT_MS = 180_000;

export function runExternalNavFlow(dest: string, provider: ExternalNavProvider, deps: ExternalNavFlowDeps): void {
  const label = EXTERNAL_NAV_LABEL[provider];

  const handoff = (t: ExternalNavTarget): void => {
    deps.setGuidanceOwner(provider);          // ilk anons çakışmasın diye açılıştan ÖNCE
    void deps.launch(provider, t.lat, t.lng).then((ok) => {
      if (ok) {
        deps.say(`${t.name} rotasını ${label} uygulamasına gönderdim.`);
      } else {
        deps.clearGuidanceOwner();            // harici yok → yol tarifini biz veririz
        deps.say(`${label} bu cihazda açılamadı; ${t.name} rotası bizim haritada kuruldu.`);
      }
    });
  };

  const saved = deps.findSaved(dest);
  if (saved.ambiguous.length > 0) {
    deps.say(`Birden fazla "${dest}" adında kayıtlı konum var, hangisini kastettiğini netleştirir misin?`);
    return;
  }
  if (saved.match) {
    deps.startOwnNavigation(saved.match);
    handoff(saved.match);
    return;
  }

  let done = false;
  let unsub: (() => void) | null = null;
  let timer: unknown = null;
  const finish = (): void => {
    if (done) return;
    done = true;
    unsub?.();
    if (timer !== null) deps.clearTimer(timer);
  };

  unsub = deps.onAddressState((s) => {
    if (done) return;
    // Başka bir arama başladıysa bu istek geçersizdir (eski oturum yeniyi değiştiremez).
    if (s.query !== dest) { finish(); return; }
    if (s.phase === 'confirmed' && s.selected) {
      const sel = s.selected;
      finish();
      handoff({ lat: sel.lat, lng: sel.lng, name: sel.name });
      return;
    }
    // Hata/iptal: çözücü kendi mesajını gösterir; harici uygulama AÇILMAZ.
    if (s.phase === 'error' || s.phase === 'idle') finish();
  });
  timer = deps.setTimer(finish, EXTERNAL_NAV_WAIT_MS);
  deps.resolveWithoutFullMap(dest);
}
