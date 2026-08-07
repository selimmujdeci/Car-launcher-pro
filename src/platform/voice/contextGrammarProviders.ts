/**
 * contextGrammarProviders.ts — bağlam sağlayıcılarının BAĞIMLILIKSIZ çekirdeği.
 *
 * ── NEDEN AYRI (SAHA DERSİ, ÖLÇÜLDÜ) ────────────────────────────────────────
 * `voiceService` sıcak ve HER YERDEN mock'lanan bir modüldür; grafiğine AĞIR
 * zincir (obd/store) girmemelidir — bu kural depoda zaten yazılıdır
 * (`voiceService.ts` → `diagnosticTrailCore` importunun yanındaki not: *"çekirdek:
 * ağır obd/store zinciri GİRMESİN"*). Gramer bağlamını okumak için
 * `navigationService` / `mediaService` / `obdService` DOĞRUDAN import edilince tam
 * olarak o kaza yeniden yaşandı: dokuz test dosyası (voiceTuning, voiceNbest,
 * companionConversationLoop, maviVehicleContextWiring, voiceCogPause,
 * voiceCommandExecutionPhases, maviFakeAckVoiceChain, …) `performanceMode` mock'u
 * eksik kaldığı için ARTIK YÜKLENEMEDİ. `diagnosticTrailCore`'daki nota göre bu
 * aynı hata daha önce de altı voice testini kırmış.
 *
 * Çözüm aynı desendir: **sıcak taraf yalnız bu çekirdeği tanır**, ağır servisleri
 * tanıyan taraf (`contextGrammarWiring.ts`) yalnız boot yolunda yüklenir.
 *
 * ── BU DOSYA NE DEĞİLDİR ────────────────────────────────────────────────────
 * Durum AYNASI DEĞİLDİR: burada kopyalanmış bayrak SAKLANMAZ. Yalnız gerçek
 * otoritelerin senkron getter REFERANSLARI tutulur; okuma anında otoriteye gidilir
 * → ikinci bir doğruluk kaynağı ve yeni paralel state makinesi OLUŞMAZ.
 *
 * ── BAĞLANMAMIŞSA ───────────────────────────────────────────────────────────
 * Sağlayıcı yoksa bağlam BİLİNMİYOR sayılır (`null`) — `false`a İNDİRGENMEZ ve
 * tahmin YAPILMAZ → seçim `general_command`a düşer (tam sözlük = bugünkü davranış).
 * Bağlanmamışlık LAB'da AÇIKÇA gösterilir (sessiz "bağlam yok" ile karışmaz).
 */

/** Senkron, yan etkisiz, PII'siz bayrak getter'ları. */
export interface GrammarContextProviders {
  /** Rota FİİLEN sürüyor mu (açık kullanıcı akışı). */
  readonly isNavigating: () => boolean;
  /** Medya GERÇEKTEN çalıyor mu (oturum varlığı YETMEZ). */
  readonly isMediaPlaying: () => boolean;
  /** Araç oturumu FİİLEN hazır mı (bağlı + taze veri). */
  readonly isVehicleSessionReady: () => boolean;
}

let _providers: Partial<GrammarContextProviders> = {};

/**
 * Ağır taraf (`contextGrammarWiring`) boot'ta çağırır. Tekrar çağrılırsa yalnız
 * verilen alanlar güncellenir (kısmi bağlama serbesttir — bağlanmayan bağlam
 * `null` kalır, "yok" SAYILMAZ).
 */
export function registerGrammarContextProviders(p: Partial<GrammarContextProviders>): void {
  if (!p || typeof p !== 'object') return;
  /* Alanlar `readonly` olduğu için mutasyon YOK: her kayıt YENİ bir nesne kurar
     (okuyucular ellerindeki referansın altından değişmez). */
  _providers = {
    isNavigating:          typeof p.isNavigating === 'function' ? p.isNavigating : _providers.isNavigating,
    isMediaPlaying:        typeof p.isMediaPlaying === 'function' ? p.isMediaPlaying : _providers.isMediaPlaying,
    isVehicleSessionReady: typeof p.isVehicleSessionReady === 'function'
      ? p.isVehicleSessionReady : _providers.isVehicleSessionReady,
  };
}

export function getGrammarContextProviders(): Partial<GrammarContextProviders> {
  return _providers;
}

/** LAB dürüstlüğü: bağlam kaynakları GERÇEKTEN bağlı mı (hepsi mi, hiçbiri mi). */
export function grammarProvidersWired(): boolean {
  return typeof _providers.isNavigating === 'function'
    && typeof _providers.isMediaPlaying === 'function'
    && typeof _providers.isVehicleSessionReady === 'function';
}

/** @internal — testler arası izolasyon. */
export function _resetGrammarContextProvidersForTest(): void {
  _providers = {};
}
