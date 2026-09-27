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
import { Icon, type IconName } from '@/components/pwa/ui/Icon';
import { BottomSheet, ListRow } from '@/components/pwa/ui/primitives';

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
const PRIMARY_TABS: ReadonlyArray<{ id: PrimaryTab; label: string; icon: IconName; iconActive: IconName }> = [
  { id: 'aracim',      label: 'Aracım',      icon: 'directions_car', iconActive: 'directions_car_fill' },
  { id: 'yolculuklar', label: 'Yolculuklar', icon: 'route',          iconActive: 'route_fill' },
  { id: 'saglik',      label: 'Sağlık',      icon: 'ecg_heart',      iconActive: 'ecg_heart_fill' },
  { id: 'harita',      label: 'Harita',      icon: 'map',            iconActive: 'map_fill' },
  { id: 'daha',        label: 'Daha Fazla',  icon: 'more_horiz',     iconActive: 'more_horiz' },
];

/** Üst uygulama çubuğu başlıkları — yalnız görünüm; route modeli DEĞİŞMEZ. */
const TAB_TITLES: Record<Tab, string> = {
  aracim: 'Arabam Cebimde', yolculuklar: 'Yolculuklar', saglik: 'Sağlık', harita: 'Harita',
  daha: 'Daha Fazla', eslestir: 'Araç Ekle', kayitlar: 'Kayıtlar', hafiza: 'Araç Hafızası', tema: 'Görünüm',
};

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
  const items: ReadonlyArray<{ id: SecondaryTab; label: string; hint: string; icon: IconName }> = [
    { id: 'eslestir', label: hasVehicle ? 'Araç Ekle / Değiştir' : 'Aracınızı Bağlayın', hint: 'Eşleştirme', icon: 'add_link' },
    { id: 'hafiza',   label: 'Araç Hafızası', hint: 'Geçmiş yolculuk ve kayıtlar', icon: 'history' },
    { id: 'kayitlar', label: 'Kayıtlar',  hint: 'Yakıt · servis · masraf', icon: 'receipt_long' },
    { id: 'tema',     label: 'Görünüm',   hint: 'Tema ve renkler', icon: 'palette' },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* M3 liste — tek kart, satırlar ayraçla; her satır ≥56dp. */}
      <div className="md-card-elevated overflow-hidden py-1" role="list">
        {items.map((it) => (
          <div role="listitem" key={it.id}>
            <ListRow icon={it.icon} label={it.label} supporting={it.hint} onClick={() => onOpen(it.id)}
              trailing={<Icon name="chevron_right" className="md-on-surface-variant flex-shrink-0" />} />
          </div>
        ))}
      </div>

      {hasVehicle && (
        <div className="md-card-elevated overflow-hidden py-1">
          <ListRow icon="link_off" tone="error" onClick={onUnpair} disabled={unpairBusy}
            label={unpairBusy ? 'Ayrılıyor…' : 'Araç bağlantısını kes'}
            supporting="Araç bu hesaptan ayrılır; kayıtlar hesabınızda kalır" />
          {/* Sunucu reddettiyse/ulaşılamadıysa araç HÂLÂ bağlıdır; bunu
              sessizce geçmek eski kusurun ta kendisiydi. */}
          {unpairError && (
            <p className="px-6 pb-3 md-body-s" style={{ color: 'var(--md-error)' }}>{unpairError}</p>
          )}
        </div>
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
  /* M3 büyük üst çubuk: içerik kaydırılınca başlık çubuğa küçülür ve çubuk
     tonal yüzeye geçer. Yalnız görünüm durumu. */
  const [scrolled, setScrolled] = useState(false);
  /* Hesap alt sayfası: tema · filo paneli · çıkış tek yerde (Google hesap menüsü deseni). */
  const [accountOpen, setAccountOpen] = useState(false);
  const closeAccount = useCallback(() => setAccountOpen(false), []);
  useEffect(() => { setScrolled(false); }, [activeTab]);

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

  /* M3 iskelet yükleme — sakin (parıltı YOK), içeriğin yerleşimini taklit eder.
     Ekran okuyucuya tek cümleyle durumu söyler. */
  const skeleton = (label: string) => (
    <div className="flex flex-col gap-3 pt-2" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div style={{ height: 28, width: '55%', borderRadius: 'var(--md-shape-sm)', background: 'var(--md-surface-container-high)' }} />
      <div style={{ height: 16, width: '35%', borderRadius: 'var(--md-shape-sm)', background: 'var(--md-surface-container-high)' }} />
      <div className="mt-2" style={{ height: 132, borderRadius: 'var(--md-shape-xl)', background: 'var(--md-surface-container-high)' }} />
      <div className="grid grid-cols-2 gap-3">
        <div style={{ height: 104, borderRadius: 'var(--md-shape-lg)', background: 'var(--md-surface-container-high)' }} />
        <div style={{ height: 104, borderRadius: 'var(--md-shape-lg)', background: 'var(--md-surface-container-high)' }} />
      </div>
    </div>
  );
  const lazySpinner = skeleton('Yükleniyor…');

  // ── Render content per tab ────────────────────────────────────────────────
  function renderMain() {
    if (activeTab === 'eslestir') {
      return <PairingScreen onPaired={handlePaired} />;
    }

    if (activeTab === 'aracim') {
      if (loading) {
        return skeleton('Araç verileri yükleniyor…');
      }

      if (error && !hasPairedVehicle) {
        return (
          <div className="md-card-filled px-5 py-6 flex flex-col items-start gap-4">
            <p className="md-body-m md-on-surface">Bağlantı hatası: {error}</p>
            <button onClick={reload} className="md-btn-tonal md-state min-h-12">
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
      {/* M3 üst uygulama çubuğu — gölge yok; kaydırınca tonal yüzeye geçer. */}
      <header
        className="relative z-10 flex items-center gap-1 pl-4 pr-1 pt-safe"
        style={{
          minHeight: 64,
          background: scrolled ? 'var(--md-surface-container)' : 'var(--md-surface)',
          transition: 'background-color var(--md-dur-short) var(--md-ease-standard)',
        }}
      >
        {/* Büyük başlık görünürken (kaydırılmamış iç yüzey) çubuk yalnız eylem taşır. */}
        <div className="flex-1 min-w-0 py-2"
          style={{ visibility: activeTab === 'aracim' || activeTab === 'harita' || scrolled ? 'visible' : 'hidden' }}>
          <p className="md-title-l md-on-surface truncate">{TAB_TITLES[activeTab]}</p>
          {/* F5 · BAŞLIK CANLILIK İDDİA EDEMEZ.
              ÖLÇÜLEN KUSUR: burada araç eşleşmiş olduğu SÜRECE "Canlı
              Bağlantı" yazıyordu — aracın telemetrisi günlerce eski olsa
              bile. Production ölçümü (2026-09-18): 94 telemetri satırının
              son 24 saatte güncellenmiş olanı YALNIZ 2. Yani bu etiket
              sahadaki çoğu durumda YALANDI (STALE → CURRENT).
              Artık hüküm kanonik tazelik otoritesinden okunur; burada
              eşik/karar ÜRETİLMEZ. */}
          {/* Aracım'da aynı bilgi ana ekran durum çipinde yazılı → görsel tekrar
              olmasın diye yalnız ekran okuyucuya kalır (içerik AYNI kaynaktan). */}
          <p className={`md-body-s md-on-surface-variant truncate ${activeTab === 'aracim' ? 'sr-only' : ''}`}
            data-testid="pwa-connection-label">
            {headerStatusLabel}
          </p>
        </div>

        <button
          onClick={() => setAccountOpen(true)}
          aria-label="Hesap ve ayarlar"
          aria-haspopup="dialog"
          className="md-icon-btn md-state flex-shrink-0"
        >
          <Icon name="account_circle" size={28} />
        </button>
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
        <main
          className="relative z-10 flex-1 px-4 pb-6 overflow-y-auto"
          onScroll={(e) => {
            const next = e.currentTarget.scrollTop > 8;
            if (next !== scrolled) setScrolled(next);
          }}
        >
          {/* M3 büyük başlık: Aracım'da araç adı ana ekranın kendisidir;
              diğer yüzeylerde başlık burada durur ve kaydırınca çubuğa küçülür. */}
          {/* Araç Hafızası kendi başlığını (aynı adla) taşır → çift başlık olmaz. */}
          {activeTab !== 'aracim' && activeTab !== 'hafiza' && (
            <h1 className="md-headline-m md-on-surface px-1 pt-2 pb-4">{TAB_TITLES[activeTab]}</h1>
          )}
          {/* Kart içinde kart YOK: yüzeyler doğrudan zemin üstünde durur. */}
          <div key={activeTab} className="md-enter">{renderMain()}</div>
        </main>
      )}


      <BottomSheet open={accountOpen} onClose={closeAccount} title="Hesap">
        {/* Gece / Gündüz teması */}
        <ListRow
          icon={pwaTheme === 'dark' ? 'dark_mode' : 'light_mode'}
          label="Karanlık tema"
          supporting={pwaTheme === 'dark' ? 'Açık' : 'Kapalı'}
          onClick={togglePwaTheme}
          trailing={
            <span role="switch" aria-checked={pwaTheme === 'dark'}
              aria-label={pwaTheme === 'dark' ? 'Gündüz moduna geç' : 'Gece moduna geç'}
              className="relative flex-shrink-0" style={{ width: 52, height: 32, borderRadius: 16,
                background: pwaTheme === 'dark' ? 'var(--md-primary)' : 'var(--md-surface-container-highest)',
                border: pwaTheme === 'dark' ? 'none' : '2px solid var(--md-outline)' }}>
              <span className="absolute top-1/2 -translate-y-1/2" style={{
                left: pwaTheme === 'dark' ? 24 : 6, width: pwaTheme === 'dark' ? 24 : 16, height: pwaTheme === 'dark' ? 24 : 16,
                borderRadius: '50%', transition: 'all var(--md-dur-short) var(--md-ease-standard)',
                background: pwaTheme === 'dark' ? 'var(--md-on-primary)' : 'var(--md-outline)' }} />
            </span>
          }
        />
        {/* ÜRÜN SINIRI: kurulu uygulamada filo paneli GÖRÜNMEZ (manifest
            scope'u da oraya izin vermez). Web tarayıcısında açıkken kalır —
            filo müşterisi aynı siteden panele geçebilsin. */}
        <Link href="/dashboard" className="hide-in-standalone md-list-item md-state px-6">
          <span className="md-on-surface-variant flex-shrink-0"><Icon name="dashboard" /></span>
          <span className="flex-1 md-body-l md-on-surface">Filo paneline git</span>
        </Link>
        <div className="mx-6 my-2" style={{ height: 1, background: 'var(--md-outline-variant)' }} />
        <ListRow
          icon="logout"
          label={logoutBusy ? 'Çıkış yapılıyor…' : 'Çıkış'}
          supporting="Araçlarınız hesabınızda kalır"
          onClick={() => { void handleLogout(); }}
          disabled={logoutBusy}
          testId="pwa-logout-button"
        />
      </BottomSheet>

      {/* M3 gezinme çubuğu — 80dp, aktif hedef tonal hap göstergesiyle. */}
      <nav className="md-nav-bar relative z-10 pb-safe" aria-label="Ana gezinme">
        <div className="flex items-stretch justify-around" style={{ minHeight: 80 }}>
          {PRIMARY_TABS.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className="flex-1 min-w-0 flex flex-col items-center justify-center gap-1 pt-3 pb-4"
                style={{ color: active ? 'var(--md-on-surface)' : 'var(--md-on-surface-variant)' }}
              >
                <span className="md-nav-indicator md-state">
                  <Icon name={active ? t.iconActive : t.icon} />
                </span>
                <span className="md-label-m truncate max-w-full px-1"
                  style={{ fontWeight: active ? 700 : 500 }}>
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
    </PwaErrorBoundary>
  );
}
