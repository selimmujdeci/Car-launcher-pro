/**
 * externalNavFlow — "Yandex'ten Mersin'e rota kur" yürütmesi.
 *
 * Sıra:
 *  1. Hedef BİZİM çözücümüzle yalnız KOORDİNATA çevrilir (kayıtlı konum →
 *     doğrudan; değilse çözücü "yalnız çöz" kipinde). BİZİM navigasyonumuz
 *     BAŞLATILMAZ: telefonda ölçüldü (2026-09-30) — bizim rota (25 km D400)
 *     Yandex'inkinden (43 km otoyol) farklı çıkıyor, iki rota kafa karıştırıyor.
 *  2. Harici uygulama o koordinatla açılır (`launchExternalRoute`).
 *  3. Açıldıysa harici rota kaydedilir → uygulamamızın üstünde sağlayıcının
 *     kendi haritasını gösteren yüzen pencere çıkar; varışta/iptalde kapanır.
 *     Açılamadıysa yedek olarak BİZİM navigasyonumuz başlar ve bu söylenir.
 *
 * Rota/konum gerçeği ÜRETMEZ: çözümleme ve rota mevcut sahiplerindedir; bu
 * modül yalnız sıralar. Bağımlılıklar test için enjekte edilir.
 */
import type { ExternalNavProvider, ExternalRoute } from './externalRouteState';
import { EXTERNAL_NAV_LABEL, type ExternalLaunchResult } from './externalNavHandoff';

export interface ExternalNavTarget { lat: number; lng: number; name: string; id?: string }

export interface ExternalNavAddressState {
  phase:    'idle' | 'searching' | 'selecting' | 'confirmed' | 'error';
  query:    string;
  selected: { lat: number; lng: number; name: string } | null;
}

export interface ExternalNavFlowDeps {
  /** Kayıtlı konum eşleşmesi (tek otorite: savedLocationsService). */
  findSaved: (dest: string) => { match: ExternalNavTarget | null; ambiguous: readonly unknown[] };
  /** Serbest hedefi YALNIZ çözer: bizim navigasyon başlamaz, tam ekran açılmaz. */
  resolveOnly: (dest: string) => void;
  onAddressState: (fn: (s: ExternalNavAddressState) => void) => () => void;
  launch: (provider: ExternalNavProvider, lat: number, lng: number) => Promise<ExternalLaunchResult | null>;
  /** Harici rota açıldı → yüzen pencere + bitiş izleyicisi. */
  setExternalRoute: (route: ExternalRoute) => void;
  /** Harici uygulama açılamadı → yedek: BİZİM navigasyonumuz başlar. */
  startOwnNavigation: (t: ExternalNavTarget) => void;
  say: (text: string) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}

/** Kullanıcı birden çok sonuç arasından seçerken beklenecek azami süre. */
export const EXTERNAL_NAV_WAIT_MS = 180_000;

export function runExternalNavFlow(dest: string, provider: ExternalNavProvider, deps: ExternalNavFlowDeps): void {
  const label = EXTERNAL_NAV_LABEL[provider];

  const handoff = (t: ExternalNavTarget): void => {
    void deps.launch(provider, t.lat, t.lng).then((res) => {
      if (res) {
        deps.setExternalRoute({
          provider, packageName: res.packageName, destName: t.name,
          lat: t.lat, lng: t.lng, startedAtMs: deps.now(),
        });
        deps.say(`${t.name} rotasını ${label} uygulamasına gönderdim.`);
      } else {
        deps.startOwnNavigation(t);
        deps.say(`${label} bu cihazda açılamadı; ${t.name} rotasını bizim navigasyonda başlattım.`);
      }
    });
  };

  const saved = deps.findSaved(dest);
  if (saved.ambiguous.length > 0) {
    deps.say(`Birden fazla "${dest}" adında kayıtlı konum var, hangisini kastettiğini netleştirir misin?`);
    return;
  }
  if (saved.match) {
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

  /* Abone olunca motor O ANKİ durumu hemen gönderir (boşta/boş sorgu ya da bir
     önceki aramanın "onaylandı"sı). Telefonda ölçüldü (2026-09-30): akış bu ilk
     mesajı iptal sanıp kapanıyor, harici uygulama HİÇ açılmıyordu. Kendi aramamız
     ("searching" + aynı sorgu) görülene kadar gelen her mesaj yok sayılır. */
  let started = false;
  unsub = deps.onAddressState((s) => {
    if (done) return;
    if (!started) {
      if (s.phase === 'searching' && s.query === dest) started = true;
      return;
    }
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
  deps.resolveOnly(dest);
}
