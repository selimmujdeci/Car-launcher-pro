'use client';

import { useEffect, useCallback, useState, lazy, Suspense } from 'react';
import Link from 'next/link';
/* Ana ekran LAZY DEĞİL: her kullanıcının ilk gördüğü yüzey odur, kod
   bölmek yalnız açılışa bir spinner ekler. (İçindeki `MobileCarControl`
   zaten F3 öncesinde de doğrudan import ediliyordu.) */
import AracimHome from '@/components/pwa/AracimHome';
import PairingScreen from '@/components/pwa/PairingScreen';
import PwaLoginScreen from '@/components/pwa/PwaLoginScreen';
import PwaInstallPrompt from '@/components/pwa/PwaInstallPrompt';
import { PwaErrorBoundary } from '@/components/pwa/PwaErrorBoundary';
import { useVehicleStore } from '@/store/vehicleStore';
import { useRealtime } from '@/hooks/useRealtime';
import { useSessionUser } from '@/hooks/useSessionUser';
import { resolvePwaAuthPhase } from '@/lib/pwaAuth';
import { requestCanonicalLogout } from '@/security/accountCleanup/canonicalLogout';
import { useAccountCleanupRuntime } from '@/security/accountCleanup/useAccountCleanupRuntime';
import { performLocalSecurityReset } from '@/security/accountCleanup/localSecurityReset';
import { clearLocalVehicle, getLocalVehicle, unpairVehicle } from '@/lib/pairingService';
import { freshnessLabel } from '@/lib/fleet/vehicleTelemetryFreshness';

const VehicleMapView     = lazy(() => import('@/components/pwa/VehicleMapView'));
const DiagnosticsPanel   = lazy(() => import('@/components/pwa/DiagnosticsPanel'));
const VehicleHealthCard  = lazy(() => import('@/components/pwa/VehicleHealthCard'));
const RecordsPanel       = lazy(() => import('@/components/pwa/RecordsPanel'));
const VehicleMemoryPanel = lazy(() => import('@/components/pwa/VehicleMemoryPanel'));
const TripJournalPanel   = lazy(() => import('@/components/pwa/TripJournalPanel'));
const ThemeStudio        = lazy(() => import('@/components/pwa/ThemeStudio').then(m => ({ default: m.ThemeStudio })));

/**
 * F3 · BEŞ ANA YÜZEY.
 *
 * Eskiden yedi sekme vardı ve ikisi (Eşleştir · Tema) ana navigasyonu
 * işgal ediyordu — bunlar kurulum/kişiselleştirme yüzeyleridir, günlük
 * kullanımın ana adımı değil. Artık `daha` altındalar.
 *
 * `SECONDARY_TABS` ana çubukta GÖRÜNMEZ ama route/state modeli KIRILMAZ:
 * mevcut `setActiveTab('eslestir')` yolları (araç yokken otomatik geçiş,
 * "Araç Ekle") aynen çalışmaya devam eder.
 */
type PrimaryTab = 'aracim' | 'yolculuklar' | 'saglik' | 'harita' | 'daha';
type SecondaryTab = 'eslestir' | 'kayitlar' | 'hafiza' | 'tema';
type Tab = PrimaryTab | SecondaryTab;


/* ── F3 · BEŞ ANA YÜZEY ──────────────────────────────────────────────────
   Simgeler mevcut görsel dilden AYNEN taşındı; yeni bir ikon seti
   getirilmedi. Etiketler ürün diline çevrildi: "Kumanda" bir kontrol
   panelini anlatıyordu, "Aracım" ise kullanıcının sorduğu soruyu. */
const PRIMARY_TABS: ReadonlyArray<{ id: PrimaryTab; label: string; icon: React.ReactNode }> = [
  {
    id: 'aracim', label: 'Aracım',
    icon: (
      <>
        <path d="M3 12l1.6-4.2A2 2 0 016.5 6.5h7a2 2 0 011.9 1.3L17 12v4.5a1 1 0 01-1 1h-1a1 1 0 01-1-1V16H6v.5a1 1 0 01-1 1H4a1 1 0 01-1-1V12z"
          stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M3.5 12h13M6 14h1.5M12.5 14H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </>
    ),
  },
  {
    id: 'yolculuklar', label: 'Yolculuklar',
    icon: (
      <>
        <path d="M4 4.5A1.5 1.5 0 015.5 3H15a1 1 0 011 1v12a1 1 0 01-1 1H5.5A1.5 1.5 0 014 15.5v-11z"
          stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M4 14.5A1.5 1.5 0 015.5 13H16" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7.5 6.5h5M7.5 9.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </>
    ),
  },
  {
    id: 'saglik', label: 'Sağlık',
    icon: (
      <>
        <path d="M10 17s-6-3.8-6-8a3.5 3.5 0 016-2.4A3.5 3.5 0 0116 9c0 4.2-6 8-6 8z"
          stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M4.5 10.5h3L9 8.5l1.5 4L12 10h3.5" stroke="currentColor" strokeWidth="1.4"
          strokeLinecap="round" strokeLinejoin="round"/>
      </>
    ),
  },
  {
    id: 'harita', label: 'Harita',
    icon: (
      <>
        <path d="M2 5l5.5-2.5 5 2.5 5-2.5V15l-5 2.5-5-2.5L2 17.5V5z"
          stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M7.5 2.5V15M12.5 5V17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </>
    ),
  },
  {
    id: 'daha', label: 'Daha Fazla',
    icon: (
      <>
        <circle cx="4.5" cy="10" r="1.3" fill="currentColor"/>
        <circle cx="10"  cy="10" r="1.3" fill="currentColor"/>
        <circle cx="15.5" cy="10" r="1.3" fill="currentColor"/>
      </>
    ),
  },
];

/**
 * DAHA FAZLA — kurulum ve kişiselleştirme yüzeyleri.
 *
 * Eşleştirme burada durur: zaten bağlı aracı olan kullanıcı her açılışta
 * eşleştirme ekranıyla karşılaşmaz (§16). Sunucudaki 3 araç sınırı bu
 * yüzeyden DEĞİŞMEZ — yalnız kanonik eşleştirme akışına götürür.
 */
function MoreMenu({
  hasVehicle, onOpen, onUnpair, unpairBusy, unpairError,
}: {
  hasVehicle: boolean;
  onOpen: (tab: Tab) => void;
  onUnpair: () => void;
  unpairBusy: boolean;
  unpairError: string | null;
}) {
  const items: ReadonlyArray<{ id: SecondaryTab; label: string; hint: string }> = [
    { id: 'eslestir', label: hasVehicle ? 'Araç Ekle / Değiştir' : 'Aracınızı Bağlayın', hint: 'Eşleştirme' },
    { id: 'hafiza',   label: 'Araç Hafızası', hint: 'Geçmiş yolculuk ve kayıtlar' },
    { id: 'kayitlar', label: 'Kayıtlar',  hint: 'Yakıt · servis · masraf' },
    { id: 'tema',     label: 'Görünüm',   hint: 'Tema ve renkler' },
  ];

  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onOpen(it.id)}
          className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-transform active:scale-[0.99]"
          style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}
        >
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-bold pwa-text">{it.label}</span>
            <span className="block text-[11px] pwa-text-3 mt-0.5">{it.hint}</span>
          </span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" className="pwa-text-3"/>
          </svg>
        </button>
      ))}

      {hasVehicle && (
        <>
          <button
            onClick={onUnpair}
            disabled={unpairBusy}
            className="mt-2 w-full min-h-11 text-xs pwa-text-3 hover:text-red-400/60 transition-colors py-3 disabled:opacity-50"
          >
            {unpairBusy ? 'Ayrılıyor…' : 'Araç bağlantısını kes'}
          </button>
          {/* Sunucu reddettiyse/ulaşılamadıysa araç HÂLÂ bağlıdır; bunu
              sessizce geçmek eski kusurun ta kendisiydi. */}
          {unpairError && (
            <p className="text-center text-[11px] text-red-300/80">{unpairError}</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Kanonik hesap temizliğine tanınan süre.
 *
 * Temizlik bu süre içinde bitmezse (sahada HİÇ DÖNMEDİĞİ ölçüldü) çıkış
 * yerel sıfırlamayla TAMAMLANIR. Süre, sunucu oturumu iptali + depo
 * doğrulaması için cömert; ama kullanıcıyı düğmede kilitlemeyecek kadar kısa.
 */
const CANONICAL_LOGOUT_TIMEOUT_MS = 8_000;

/**
 * F1 · OTURUM KAPISI.
 *
 * Uygulama gövdesi YALNIZ `AUTHENTICATED` iken kurulur. Bu bilinçlidir:
 * giriş yapılmamışken realtime aboneliği, araç deposu ve komut izleyicisi hiç
 * başlamaz — önceki kullanıcının verisi yeni kullanıcıya "bir kare" bile
 * sızamaz (mount edilmeyen ağaç render etmez).
 */
export default function KumandaPage() {
  const { userId, loading, isAnonymous, authError } = useSessionUser();
  const phase = resolvePwaAuthPhase({ loading, authError, userId, isAnonymous });

  if (phase === 'BOOTING') return <PwaBootScreen />;
  if (phase === 'AUTH_ERROR') return <PwaAuthErrorScreen />;
  if (phase === 'SIGNED_OUT') {
    return <PwaLoginScreen hasPendingAnonymousData={isAnonymous} />;
  }

  /* `key`: hesap değiştiğinde tüm PWA ağacı (store okumaları, realtime
     aboneliği, komut izleyicisi) SIFIRDAN kurulur. */
  return <KumandaApp key={userId ?? 'no-account'} />;
}

function PwaBootScreen() {
  return (
    <div
      data-testid="pwa-boot-screen"
      className="h-[100dvh] flex items-center justify-center"
      style={{ background: 'var(--pwa-bg, #060d1a)', color: 'var(--pwa-text-3, rgba(232,238,252,0.45))' }}
    >
      <svg className="animate-spin w-6 h-6" viewBox="0 0 20 20" fill="none" aria-label="Yükleniyor">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"
          strokeDasharray="32" strokeDashoffset="10" opacity="0.4" />
        <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/**
 * Oturum SORULAMADI — ve kullanıcı burada MAHSUR KALMAZ.
 *
 * ── ÖLÇÜLEN KUSUR (telefonda, 2026-09-17) ────────────────────────────────
 * Yarıda kalmış bir çıkış, hesap temizliğinin auth-yazma kilidini açık
 * bırakıyordu. O durumda oturum okunamıyor ve kullanıcının hiçbir çıkış
 * yolu yoktu: uygulama açılış ekranında donuyordu. Filo panelinde bu durum
 * için kurtarma ekranı vardı, tüketici yüzeyinde YOKTU.
 *
 * Kurtarma, KANONİK yoldan yapılır (`runtime.retryRecovery()` — filo boot
 * gate'inin kullandığı aynı çağrı); ikinci bir temizlik otoritesi yoktur.
 */
function PwaAuthErrorScreen() {
  const { runtime, snapshot } = useAccountCleanupRuntime();
  const [busy, setBusy] = useState(false);
  const recoveryNeeded = snapshot.bootStatus === 'CLEANUP_RECOVERY_REQUIRED';
  const resetNeeded = snapshot.bootStatus === 'SECURITY_RESET_REQUIRED';

  const handleRetry = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (runtime) {
        /* SIRA ÖNEMLİ: kurtarma kararını `retryRecovery` kendi içinde
           `bootStatus`a bakarak verir, ama ilk render'da snapshot henüz
           `CHECKING` olabilir (initialize asenkron). `recoveryNeeded`e
           bakıp çağrıyı atlamak, kullanıcıyı kilitli ekranda bırakan bir
           YARIŞ üretiyordu — bu yüzden önce hazır olması beklenir, sonra
           kanonik kurtarma her durumda denenir (gerekmiyorsa no-op). */
        await runtime.initialize();
        const next = await runtime.retryRecovery();

        /* ── SON ÇARE (production kusuru, 2026-09-17) ────────────────────
           Bir temizlik `FAILED_BLOCKING` ile bittiyse boot gate
           `SECURITY_RESET_REQUIRED` döner ve `retryRecovery()` o durumda
           HİÇBİR ŞEY YAPMAZ. İşaret çerezi de durduğu için auth yazımı
           kilitli kalıyor ve kullanıcı kendi hesabına giremiyordu.
           Kanonik yol tükendiyse yerel durum sıfırlanır: kilidin amacı
           (eski hesabın yerel verisi sızmasın) zayıflamaz, en sert
           biçimde yerine getirilir. Sunucudaki araç sahipliği DURUR. */
        if (next.bootStatus === 'SECURITY_RESET_REQUIRED') {
          performLocalSecurityReset();
        }
      } else {
        performLocalSecurityReset();
      }
    } catch {
      /* Kurtarma yürütülemiyorsa da kullanıcı mahsur kalmamalı. */
      performLocalSecurityReset();
    }
    window.location.reload();
  }, [busy, runtime]);

  return (
    <div
      data-testid="pwa-auth-error-screen"
      className="h-[100dvh] flex flex-col items-center justify-center px-8 text-center"
      style={{ background: 'var(--pwa-bg, #060d1a)', color: 'var(--pwa-text, #e8eefc)' }}
    >
      <p className="text-sm">
        {resetNeeded
          ? 'Güvenli oturum temizliği tamamlanamamış.'
          : recoveryNeeded
            ? 'Güvenli oturum temizliği yarıda kalmış.'
            : 'Oturum bilgisi okunamadı.'}
      </p>
      <p className="mt-2 text-[12px] opacity-55 leading-relaxed">
        Araçlarınız ve kayıtlarınız hesabınızda duruyor.
        {resetNeeded
          ? ' Aşağıdaki düğme bu cihazdaki yerel verileri sıfırlar; sonra yeniden giriş yaparsınız.'
          : recoveryNeeded
            ? ' Aşağıdaki düğme temizliği tamamlar ve uygulamayı açar.'
            : ' Bağlantınızı kontrol edip tekrar deneyin.'}
      </p>
      <button
        type="button"
        onClick={() => { void handleRetry(); }}
        disabled={busy}
        data-testid="pwa-auth-recover-button"
        className="mt-6 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-colors disabled:opacity-60"
        style={{
          background: 'rgba(59,130,246,0.14)',
          border: '1px solid rgba(59,130,246,0.3)',
          color: '#93c5fd',
        }}
      >
        {busy
          ? 'Tamamlanıyor…'
          : resetNeeded
            ? 'Yerel Verileri Sıfırla'
            : recoveryNeeded ? 'Temizliği Tamamla' : 'Tekrar Dene'}
      </button>
      {/* Düğme, kanonik kurtarma tükenirse yerel sıfırlamaya düşer — bu
          yüzden kullanıcı ne olabileceğini ÖNCEDEN bilir. */}
      <p className="mt-5 text-[11px] opacity-35 leading-relaxed max-w-xs">
        Kurtarma tamamlanamazsa bu cihazdaki yerel veriler sıfırlanır ve
        yeniden giriş istenir. Araçlarınız hesabınızda kalır.
      </p>
    </div>
  );
}

function KumandaApp() {
  /* F5 · ÜRÜN SINIRI: filo uyarı kuralları (hız limiti · geofence · motor
     sıcaklığı) tüketici ürününde ÇALIŞMAZ. Bkz. `useRealtime` gerekçesi. */
  useRealtime({ fleetAlerts: false });

  const loading  = useVehicleStore((s) => s.loading);
  const error    = useVehicleStore((s) => s.error);
  const vehicles = useVehicleStore((s) => s.getList());
  const setActiveVehicleId = useVehicleStore((s) => s.setActiveVehicleId);

  const [activeTab, setActiveTab] = useState<Tab>('aracim');
  const [pwaTheme, setPwaTheme] = useState<'dark' | 'light'>('dark');
  /* F0.4 · Ayırma sunucu-otoritelidir; hem bekleme hem gerekçe görünür olmalı. */
  const [unpairBusy,  setUnpairBusy]  = useState(false);
  const [unpairError, setUnpairError] = useState<string | null>(null);
  /* F1 · Çıkış her koşulda TAMAMLANIR (aşağıdaki `handleLogout`); bu yüzden
     kullanıcıya gösterilecek bir "başarısız" durumu KALMADI. */
  const [logoutBusy,  setLogoutBusy]  = useState(false);

  // Tema tercihi (gece/gündüz) — localStorage'dan; SSR default gece, mount'ta oku.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pwa-theme');
      if (saved === 'light' || saved === 'dark') setPwaTheme(saved);
    } catch { /* ignore */ }
  }, []);
  const togglePwaTheme = useCallback(() => {
    setPwaTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('pwa-theme', next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /* TEK OTORİTE: canonical activeVehicleId üzerinden okunur (vehicleStore).
     ÖNCEDEN: `vehicles.find(online) ?? vehicles[0]` — birden fazla eşleştirilmiş
     araç varken kullanıcı seçim YAPAMIYORDU, ekran sessizce "ilk online / ilk"
     araca kilitleniyordu. Artık belirsiz seçimde `null` döner (fail closed);
     kullanıcı vehicle selector'dan açıkça seçer. */
  const vehicle = useVehicleStore((s) => s.getActiveVehicle());

  const hasPairedVehicle = vehicles.length > 0;

  /* Başlık durumu — TEK otorite `vehicleTelemetryFreshness`. Araç seçilmemiş
     ya da telemetri okunamamışsa "canlı" DENMEZ; bilinmeyen bilinmeyen kalır. */
  const headerStatusLabel = !hasPairedVehicle
    ? 'Araç Eşleştir'
    : vehicle?.telemetry
      ? freshnessLabel(vehicle.telemetry.device)
      : 'Durum bilinmiyor';

  // Auto-switch to pairing screen when no vehicle
  useEffect(() => {
    if (!loading && !hasPairedVehicle && activeTab === 'aracim') {
      setActiveTab('eslestir');
    }
  }, [loading, hasPairedVehicle, activeTab]);

  const reload = useCallback(() => {
    void useVehicleStore.getState().initializeFromSupabase();
  }, []);

  const handlePaired = useCallback(() => {
    /* Yerel kayıt ANINDA görünür kılar (ağ beklenmez); Supabase okuması ise
       gerçek adı/plakayı ve telemetriyi getirir. #632 öncesinde yalnız yerel
       okuma vardı ve o okuma `api_key` yoksa aracı düşürüyordu → "eşleşti"
       denip eşleştirme ekranına geri dönülüyordu. */
    useVehicleStore.getState().initializeFromLocal();
    void useVehicleStore.getState().initializeFromSupabase();
    /* Az önce eşleştirilen araç açıkça aktif yapılır (kullanıcının niyeti
       budur). `getLocalVehicle()` tam bu anda `pairVehicle()`in yazdığı
       kaydı döndürür; `setActiveVehicleId` zaten `vehicles` içinde
       olmayan bir id'yi FAIL CLOSED reddeder — ikinci bir doğrulama
       gerekmez. Mevcut çoklu-araçlı kullanıcı için diğer araçların
       seçimini DEĞİŞTİRMEZ. */
    const justPaired = getLocalVehicle();
    if (justPaired) useVehicleStore.getState().setActiveVehicleId(justPaired.id);
    setActiveTab('aracim');
  }, []);

  const handleUnpair = useCallback(async () => {
    /* ÖNCEDEN: `setVehicles([])` — yalnız AKTİF aracın yerel eşleşmesi
       koparılmak istenirken TÜM eşleştirilmiş araçlar (ör. Megane ONLINE
       iken Doblo'yu koparmak) ekrandan siliniyordu. Artık yalnız aktif
       araç kaldırılır; `clearLocalVehicle()` ise yalnız bu cihazın tekil
       yerel kaydı GERÇEKTEN bu araca aitse çağrılır.

       ── F0.4 · SUNUCU ÖNCE ────────────────────────────────────────────
       ÖNCEKİ KUSUR: burada YALNIZ yerel durum siliniyordu; sunucuda
       `vehicles.owner_id` ve `vehicle_pairings` AYNEN kalıyordu. Kullanıcı
       aracı "bıraktığını" sanıyor, bireysel 3 araç kotası dolu kalıyor ve
       (PWA anonim oturum kullandığı için) kimliğini kaybederse araç
       KALICI olarak erişilemez hâle geliyordu.

       Artık sıra PAZARLIKSIZ: önce sunucu ayırması KANITLANIR, sonra yerel
       durum silinir. Sunucu reddederse/ulaşılamazsa yerel kayıt DURUR —
       kullanıcı hâlâ aracını görür ve tekrar deneyebilir (sessiz veri
       kaybı yok). */
    if (!vehicle || unpairBusy) return;
    setUnpairBusy(true);
    setUnpairError(null);
    try {
      const res = await unpairVehicle(vehicle.id);
      if (!res.success) {
        setUnpairError(res.message);
        return;
      }
      const local = getLocalVehicle();
      if (local?.id === vehicle.id) clearLocalVehicle();
      useVehicleStore.getState().removeVehicle(vehicle.id);
    } finally {
      setUnpairBusy(false);
    }
  }, [vehicle, unpairBusy]);

  /**
   * ÇIKIŞ ≠ ARAÇ AYIRMA.
   *
   * Kanonik hesap temizliği yalnız oturumu ve KULLANICIYA AİT YEREL durumu
   * siler; sunucudaki araç sahipliğine (`vehicles.owner_id`,
   * `vehicle_pairings`) DOKUNMAZ. Kullanıcı aynı Google hesabıyla tekrar
   * girdiğinde araçları yerinde durur. Aracı gerçekten bırakmak ayrı ve
   * açık bir eylemdir ("Araç bağlantısını kes").
   */
  const handleLogout = useCallback(async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    /* ── ÇIKIŞ GARANTİLİDİR (sahada 8 tur ölçüldü) ────────────────────────
       Kanonik temizlik altı fazlı, on iki katılımcılı, Web Locks'lı bir
       zincir. Sahada her denemede farklı bir halkası kırıldı ve bir kez de
       HİÇ DÖNMEDİ (düğme "…"de kilitli kaldı, hata bile çıkmadı).
       Kullanıcının kendi hesabından çıkamaması kabul edilebilir bir sonuç
       değildir; bu yüzden kanonik yol ZAMAN SINIRLI denenir. */
    const canonical = await Promise.race([
      requestCanonicalLogout().catch(() => null),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), CANONICAL_LOGOUT_TIMEOUT_MS);
      }),
    ]);

    if (canonical?.ok) {
      /* Temizlik tamamlandı; oturum olayı kapıyı giriş ekranına taşır. */
      return;
    }

    /* SON ÇARE — ve bu GÜVENLİĞİ ZAYIFLATMAZ.
       Kilidin amacı "eski hesabın yerel verisi yeni oturuma sızmasın"dır.
       Yerel sıfırlama tam olarak bunu, en sert biçimde yapar: yerel depo,
       oturum deposu ve bu kaynağın çerezleri (Supabase oturum çerezi dahil)
       silinir → çıkış GERÇEKLEŞİR. Sunucudaki araç sahipliği, eşleştirmeler
       ve kayıtlar DURUR; aynı hesapla girince geri gelirler.
       Sunucu oturumu iptali kanonik zincirde denenmiştir; yarıda kaldıysa
       yerel çerez gittiği için bu cihazda oturum yine kullanılamaz. */
    performLocalSecurityReset();
    window.location.replace('/kumanda');
    /* Başarıda `onAuthStateChange` → kapı SIGNED_OUT'a geçer ve giriş ekranı
       kurulur; burada ayrıca yönlendirme yapılmaz (tek otorite oturumdur). */
  }, [logoutBusy]);

  const lazySpinner = (
    <div className="flex items-center justify-center gap-2 py-10 text-sm pwa-text-3">
      <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"
          strokeDasharray="28" strokeDashoffset="9" opacity="0.4"/>
        <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      Yükleniyor…
    </div>
  );

  // ── Render content per tab ────────────────────────────────────────────────
  function renderMain() {
    if (activeTab === 'eslestir') {
      return <PairingScreen onPaired={handlePaired} />;
    }

    if (activeTab === 'aracim') {
      if (loading) {
        return (
          <div className="flex items-center justify-center gap-3 py-10 text-sm pwa-text-2">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"
                strokeDasharray="32" strokeDashoffset="10" opacity="0.4"/>
              <path d="M10 3a7 7 0 017 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Araç verileri yükleniyor…
          </div>
        );
      }

      if (error && !hasPairedVehicle) {
        return (
          <div className="py-6 text-center">
            <p className="text-sm text-red-300/80">Bağlantı hatası: {error}</p>
            <button
              onClick={reload}
              className="mt-3 text-xs text-blue-400/70 hover:text-blue-400 transition-colors px-3 py-1.5 rounded-lg border border-blue-500/20 bg-blue-500/[0.06]"
            >
              Tekrar Dene
            </button>
          </div>
        );
      }

      /* F3 · ARACIM.
         `key`: aktif araç değiştiğinde tüm ana ekran ağacı (sağlık okuması,
         yolculuk okuması, komut izleyici) SIFIRDAN kurulur — eski aracın
         geç gelen sonucu yeni aracın ekranına SIZAMAZ (§17). */
      return (
        <>
          <AracimHome
            key={vehicle?.id ?? 'no-active-vehicle'}
            vehicle={vehicle}
            vehicles={vehicles}
            onSelectVehicle={setActiveVehicleId}
            onAddVehicle={() => setActiveTab('eslestir')}
            onOpenHealth={() => setActiveTab('saglik')}
            onOpenMap={() => setActiveTab('harita')}
          />
          {/* Henüz kurmadıysa tüketici kurulum teklifi burada yapılır. */}
          <div className="mt-4">
            <PwaInstallPrompt />
          </div>
        </>
      );
    }

    if (activeTab === 'yolculuklar') {
      return (
        <Suspense fallback={lazySpinner}>
          {/* ARAÇ SINIRI (V1): `key` araç kimliğidir. Bu üç panel kendi
              araç-kapsamlı state'ini (tarama sonucu · yolculuk listesi ·
              kayıtlar) TUTAR ve araç değişiminde SIFIRLAMIYORDU — A aracında
              tarama yapıp B'ye geçen kullanıcı, B'nin ekranında A'nın arıza
              kodlarını görüyordu. `key` değişince React örneği YENİDEN KURAR;
              eski aracın state'i yapısal olarak TAŞINAMAZ. (Memory/Aracım/
              Sağlık'ta `requestedFor` koruması zaten var, dokunulmadı.) */}
          <TripJournalPanel key={vehicle?.id ?? 'no-vehicle'} vehicle={vehicle} />
        </Suspense>
      );
    }

    if (activeTab === 'saglik') {
      /* F2.2 · ÖNCE SONUÇ, SONRA SENSÖR.
         Sağlık kartı aracın DAHA ÖNCE yazdığı ölçümü okur ve yeni komut
         göndermez; altındaki panel kullanıcının açık tarama eylemidir. */
      return (
        <Suspense fallback={lazySpinner}>
          <div className="flex flex-col gap-4">
            <VehicleHealthCard vehicle={vehicle} />
            <DiagnosticsPanel key={vehicle?.id ?? 'no-vehicle'} vehicle={vehicle} />
          </div>
        </Suspense>
      );
    }

    if (activeTab === 'hafiza') {
      return (
        <Suspense fallback={lazySpinner}>
          <VehicleMemoryPanel vehicle={vehicle} />
        </Suspense>
      );
    }

    if (activeTab === 'kayitlar') {
      return (
        <Suspense fallback={lazySpinner}>
          <RecordsPanel key={vehicle?.id ?? 'no-vehicle'} vehicle={vehicle} />
        </Suspense>
      );
    }

    if (activeTab === 'daha') {
      /* Kurulum ve kişiselleştirme yüzeyleri BURADA toplanır: günlük
         kullanımın ana adımı değiller, bu yüzden ana çubuğu işgal etmezler. */
      return (
        <MoreMenu
          hasVehicle={hasPairedVehicle}
          onOpen={setActiveTab}
          onUnpair={() => { void handleUnpair(); }}
          unpairBusy={unpairBusy}
          unpairError={unpairError}
        />
      );
    }

    if (activeTab === 'tema') {
      return (
        <Suspense fallback={lazySpinner}>
          <ThemeStudio vehicleId={vehicle?.id ?? null} />
        </Suspense>
      );
    }

    return null;
  }

  return (
    <PwaErrorBoundary>
    <div
      data-pwa-theme={pwaTheme}
      className="h-[100dvh] flex flex-col overflow-hidden"
      style={{ background: 'var(--pwa-bg)', color: 'var(--pwa-text)' }}
    >
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-64 rounded-full bg-blue-500/[0.06] blur-[80px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-80 h-48 rounded-full bg-blue-600/[0.04] blur-[60px]" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(var(--pwa-grid) 1px, transparent 1px), linear-gradient(90deg, var(--pwa-grid) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 pt-safe pt-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)' }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 11L4.5 6Q5.5 4 7 4H11Q12.5 4 13.5 6L16 11V13.5Q16 15 14.5 15H3.5Q2 15 2 13.5Z"
                stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="5.5" cy="15" r="1.8" stroke="#3b82f6" strokeWidth="1.5"/>
              <circle cx="12.5" cy="15" r="1.8" stroke="#3b82f6" strokeWidth="1.5"/>
              <rect x="6.5" y="7.5" width="5" height="3.5" rx="1.2" stroke="#3b82f6" strokeWidth="1.2"/>
            </svg>
          </div>
          <div>
            <p className="pwa-text font-bold text-sm leading-none">Arabam Cebimde</p>
            {/* F5 · BAŞLIK CANLILIK İDDİA EDEMEZ.
                ÖLÇÜLEN KUSUR: burada araç eşleşmiş olduğu SÜRECE "Canlı
                Bağlantı" yazıyordu — aracın telemetrisi günlerce eski olsa
                bile. Production ölçümü (2026-09-18): 94 telemetri satırının
                son 24 saatte güncellenmiş olanı YALNIZ 2. Yani bu etiket
                sahadaki çoğu durumda YALANDI (STALE → CURRENT).
                Artık hüküm kanonik tazelik otoritesinden okunur; burada
                eşik/karar ÜRETİLMEZ. */}
            <p className="pwa-text-3 text-[10px] mt-0.5" data-testid="pwa-connection-label">
              {headerStatusLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Gece / Gündüz teması */}
          <button
            onClick={togglePwaTheme}
            aria-label={pwaTheme === 'dark' ? 'Gündüz moduna geç' : 'Gece moduna geç'}
            /* F5 · DOKUNMA HEDEFİ: 36px, telefon için önerilen 44px'in altındaydı. */
            className="w-11 h-11 rounded-lg flex items-center justify-center transition-colors pwa-surface pwa-border"
            style={{ border: '1px solid var(--pwa-border)' }}
          >
            {pwaTheme === 'dark' ? (
              /* Güneş — gündüze geç */
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ color: '#fbbf24' }}>
                <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M16 4l-1.4 1.4M5.4 14.6L4 16"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            ) : (
              /* Ay — geceye geç */
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ color: '#60a5fa' }}>
                <path d="M16 11.5A6.5 6.5 0 018.5 4a6.5 6.5 0 100 12 6.5 6.5 0 007.5-4.5z"
                  stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          {/* ÜRÜN SINIRI: kurulu uygulamada filo paneli GÖRÜNMEZ (manifest
              scope'u da oraya izin vermez). Web tarayıcısında açıkken kalır —
              filo müşterisi aynı siteden panele geçebilsin. */}
          <Link
            href="/dashboard"
            className="hide-in-standalone inline-flex items-center min-h-11 text-[11px] font-semibold text-blue-400/80 hover:text-blue-400 transition-colors px-3 rounded-lg border border-blue-500/25 bg-blue-500/[0.08]"
          >
            Panele Git →
          </Link>

          <button
            onClick={() => { void handleLogout(); }}
            disabled={logoutBusy}
            data-testid="pwa-logout-button"
            className="inline-flex items-center min-h-11 text-[11px] font-semibold pwa-text-3 hover:text-red-400/70 transition-colors px-3 rounded-lg disabled:opacity-50"
            style={{ border: '1px solid var(--pwa-border)' }}
          >
            {logoutBusy ? '…' : 'Çıkış'}
          </button>
        </div>
      </header>

      {/* Main */}
      {activeTab === 'harita' ? (
        <main className="relative z-10 flex-1" style={{ minHeight: 0 }}>
          <Suspense fallback={
            <div className="flex items-center justify-center h-full gap-2 pwa-text-3 text-sm">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"
                  strokeDasharray="28" strokeDashoffset="9" opacity="0.4"/>
                <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Harita yükleniyor…
            </div>
          }>
            <VehicleMapView vehicle={vehicle} />
          </Suspense>
        </main>
      ) : (
        <main className="relative z-10 flex-1 px-4 py-4 overflow-y-auto">
          <div
            className="rounded-3xl p-5 mb-4"
            style={{
              background: 'linear-gradient(145deg, var(--pwa-card-a) 0%, var(--pwa-card-b) 100%)',
              border: '1px solid var(--pwa-border)',
              boxShadow: '0 0 40px var(--pwa-glow), 0 20px 60px rgba(0,0,0,0.18)',
            }}
          >
            {renderMain()}
          </div>
        </main>
      )}


      {/* Bottom nav */}
      <nav
        className="relative z-10 pb-safe"
        style={{ background: 'var(--pwa-nav-bg)', backdropFilter: 'blur(20px)', borderTop: '1px solid var(--pwa-border-soft)' }}
      >
        <div className="flex items-center justify-around py-2">
          {PRIMARY_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              aria-current={activeTab === t.id ? 'page' : undefined}
              className="flex flex-col items-center gap-1 py-2 px-3 min-w-[56px] transition-colors"
              style={{ color: activeTab === t.id ? '#3b82f6' : 'var(--pwa-text-3)' }}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                {t.icon}
              </svg>
              <span className="text-[9px] font-semibold">{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
    </PwaErrorBoundary>
  );
}
