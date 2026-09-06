import { memo, useState, useCallback } from 'react';
import {
  X, ZoomIn, ZoomOut, Crosshair, Map, Layers, Globe, Navigation2, Camera, CameraOff,
  AlertTriangle, Construction, Car, CircleAlert, Minimize2,
} from 'lucide-react';
import type { MapMode } from '../../platform/mapSourceManager';
import { addEvent } from '../../platform/communityService';
import type { CommunityEventType } from '../../store/useCommunityStore';
import { useDenseHud } from '../../hooks/useDenseHud';
import { DEVELOPER_FEATURES_ENABLED } from '../../platform/debug/developerFeatures';

/* ── Manuel rapor seçenekleri ────────────────────────────────────────────── */

interface ReportOption {
  type:  CommunityEventType;
  label: string;
  Icon:  React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
}

const REPORT_OPTIONS: ReportOption[] = [
  { type: 'ACCIDENT',      label: 'Kaza',          Icon: Car,            color: '#ef4444' },
  { type: 'ROAD_WORK',     label: 'Yol Çalışması', Icon: Construction,   color: '#f59e0b' },
  { type: 'POTHOLE',       label: 'Çukur',         Icon: AlertTriangle,  color: '#fb923c' },
  { type: 'GENERAL_ALERT', label: 'Genel Uyarı',   Icon: CircleAlert,    color: '#60a5fa' },
];

const MODE_LABELS: Record<MapMode, string> = {
  road: 'Yol',
  hybrid: 'Hibrit',
  satellite: 'Uydu',
};

export interface MapHudControlsProps {
  // State
  isNavigating: boolean;
  isPreview: boolean;
  isFollowing: boolean;
  ctrlVisible: boolean;
  drivingMode: boolean;
  cameraOn: boolean;
  mode: MapMode;
  heading: number | null;
  location: { latitude: number; longitude: number } | null;

  // Actions
  onClose: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
  onToggleDrivingMode: () => void;
  onCameraToggle: () => void;
  onSetMapMode: (mode: MapMode) => void;
  showControls: () => void;
}

export const MapHudControls = memo(function MapHudControls({
  isNavigating,
  isPreview,
  /* `isFollowing` prop olarak KORUNDU (çağıran kanonik kamera otoritesinden
     besliyor) ama bu bileşende artık tüketilmiyor: onu okuyan tek yer orta
     "Aracı Ortala" banner'ıydı ve o kaldırıldı (2026-08-13). */
  ctrlVisible,
  drivingMode,
  cameraOn,
  mode,
  /* `heading` prop KORUNDU (çağıran kanonik kaynaktan besliyor) ama artık
     tüketilmiyor: onu okuyan tek yer kaldırılan nav pusulasıydı. */
  heading: _heading,
  location,
  onClose,
  onZoomIn,
  onZoomOut,
  onRecenter,
  onToggleDrivingMode,
  onCameraToggle,
  onSetMapMode,
  showControls,
}: MapHudControlsProps) {
  /* Dar ekran (telefon yatayı) yerleşimi — eşik TEK KAYNAKTAN gelir. */
  /* `dense` yalnız kaldırılan nav kolonunun çapası içindi. */
  void useDenseHud();

  const [reportOpen, setReportOpen] = useState(false);

  const handleReport = useCallback((type: CommunityEventType) => {
    setReportOpen(false);
    if (!location) return;
    addEvent(type, location.latitude, location.longitude, 0.9, { source: 'manual' });
  }, [location]);

  return (
    <>
      {/* ── NAVİGASYONDAYKEN: ANA EKRANA DÖN (görünüm kapatır, oturumu BİTİRMEZ) ──
       *
       * SAHA 2026-08-04 (NAV-MINIMAP-CONT-P0, cihaz 4L45OFZDX84X55GE): navigasyon
       * aktifken tam ekranı kapatan HİÇBİR düğme yoktu (aşağıdaki KAPAT
       * `!isNavigating` ile gizleniyor). Geriye iki çıkış kalıyordu: donanım geri
       * tuşu veya NavInfoBar'daki kırmızı SONLANDIR. Uygulama bir LAUNCHER ve
       * hedef donanım (K24 / T507 head unit) çoğu zaman donanım geri tuşu
       * TAŞIMAZ → kullanıcı ana ekrana dönmek için navigasyonu BİTİRMEK zorunda
       * kalıyordu. Bu, tam olarak bu görevin kapattığı arızanın kendisiydi.
       *
       * Bu düğme yalnız GÖRÜNÜMÜ kapatır: `onClose` → `setFullMapOpen(false)`.
       * Oturum yaşamaya devam eder ve mini haritada sürer. SONLANDIR'dan
       * bilinçli olarak AYRIŞTIRILDI: farklı konum (sol üst ≠ sağ alt), nötr
       * renk (kırmızı DEĞİL) ve farklı ikon → sürüşte yanlış dokunma riski
       * azalır. */}
      {isNavigating && (
        <button
          onClick={onClose}
          aria-label="Ana ekrana dön — navigasyon sürer"
          title="Ana ekrana dön (navigasyon sürer)"
          /* ── GÖRSEL ÖNCELİK DÜŞÜRÜLDÜ (P0-NAV-05) ────────────────────────
           * Eski hâli koyu dolgu + 1,5 px parlak kenar + 28 px gölge + büyük
           * harfli metinle navigasyon bilgisinden DAHA ÇOK dikkat çekiyordu.
           * Bu bir görünüm anahtarıdır, sürüş kararı değildir. Artık ikon
           * ağırlıklı ve saydam; DOKUNMA HEDEFİ 44×44 px KORUNUR (araç ekranı
           * şartı) — küçülen görsel ağırlık, tıklanabilirlik değil. */
          className="flex items-center justify-center gap-2 rounded-full active:scale-90 transition-all"
          style={{
            position: 'fixed',
            top: 'calc(var(--sat) + 12px)', right: 'calc(var(--sar) + 12px)',
            zIndex: 'var(--z-map-alert)',
            minWidth: 44, minHeight: 44,
            padding: '0 14px',
            background: 'rgba(15,23,42,0.42)',
            backdropFilter: 'blur(14px)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(226,232,240,0.72)', fontWeight: 700, fontSize: 11,
            letterSpacing: '0.06em', cursor: 'pointer',
            boxShadow: 'none',
          }}
        >
          <Minimize2 className="w-4 h-4 stroke-[2px]" />
          <span className="uppercase tracking-wider">ANA EKRAN</span>
        </button>
      )}

      {/* ── KAPAT — yalnızca navigasyon kapalıyken görünür.
       *   Active nav: yukarıdaki ANA EKRAN görünümü kapatır, NavInfoBar'daki
       *   SONLANDIR ise oturumu bitirir. Bu sayede SpeedPanel ile çakışmaz. */}
      {!isNavigating && (
        <button
          onClick={onClose}
          aria-label="Haritayı kapat"
          /* CHROME TURU 2026-09-05 (§15 "controls haritanın önüne geçemez"):
             düğme kırmızı ALARM diliyle çiziliyordu (kırmızı dolgu + kırmızı
             kenar + kırmızı glow + fontWeight 900) — oysa haritayı kapatmak
             tehlikeli bir eylem DEĞİL. Sağ üst köşede sürekli duran bir uyarı
             rengi hem haritayı bastırıyor hem de gerçek uyarıların (rota
             kaybı, sensör arızası) kırmızısını değersizleştiriyordu. Artık
             sağ raydaki kontrollerle AYNI nötr yüzey dilini kullanır; dokunma
             hedefi (≥44 px) korunur, görsel ağırlık düşer. */
          className="flex items-center gap-2 rounded-2xl active:scale-90 transition-all hover:brightness-110 backdrop-blur-xl"
          style={{
            position: 'fixed',
            top: 'calc(var(--sat) + 16px)', right: 'calc(var(--sar) + 16px)',
            zIndex: 'var(--z-map-alert)',
            padding: '11px 15px',
            background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
            borderWidth: 1, borderStyle: 'solid',
            borderColor: 'var(--oem-line-strong, rgba(255,240,210,0.18))',
            color: 'rgba(226,232,240,0.82)', fontWeight: 700, fontSize: 12,
            letterSpacing: '0.08em', cursor: 'pointer',
            boxShadow: 'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
          }}
        >
          <X className="w-4 h-4 stroke-[2.5px]" />
          <span className="uppercase tracking-widest">KAPAT</span>
        </button>
      )}

      {/* ── ORTALA (RE-CENTER) DÜĞMESİ KALDIRILDI (2026-08-13) ────────────────
       *
       * Düğme haritanın ORTASINDA duruyordu ve navigasyon sırasında tam olarak
       * yolun üstünü kapatıyordu — sürücünün görmesi gereken tek yeri.
       *
       * KALDIRMAK KULLANICIYI KİLİTLEMEZ — önce bu doğrulandı: takibe dönüş
       * OTOMATİKTİR ve düğmeden bağımsız çalışır. `FullMapView` pan bitişinde
       * `notifyUserPanEnd(applyRecenter)` çağırır; `cameraFollowAuthority`
       * navigasyonda **3 sn** (`AUTO_FOLLOW_DELAY_NAV_MS`), navigasyon dışında
       * **10 sn** sonra kamerayı araca geri döndürür. Yani 2026-08-04'te
       * düzeltilen kusur ("navigasyonda araca dönmenin hiçbir yolu yok") GERİ
       * GELMEZ: o turda eklenen şey erişimin KENDİSİ değil, elle kısayoldu.
       *
       * `onRecenter` prop'u KORUNDU — kanonik ortalama yolu hâlâ ayakta ve
       * başka bir yüzey (ör. sağ kontrol rayı) onu bağlayabilir. */}

      {/* ── SAĞ: Nav dışı kontroller — sürüş modunda gizle ── */}
      {/* ── CHROME TURU 2026-09-06 (saha: "sağ controls çok ağır") ──────────
       * ÖNCE: beş AYRI kutu, her birinde kendi dolgusu + kenarı + gölgesi →
       * harita üstünde beş kez tekrarlayan çerçeve ailesi. OEM navigasyonda
       * (HERE/TomTom) kontroller TEK ray içinde toplanır; kenar bir kez çizilir.
       * ŞİMDİ: tek yüzey + tek kenar + tek gölge; düğmeler ray İÇİNDE
       * çerçevesizdir, anlamı ikon ve aktif tint taşır.
       * Dokunma hedefi DEĞİŞMEDİ (48×48 + güneş modu 52 px tabanı). */}
      <div
        className="absolute right-4 z-[var(--z-map-label)] flex flex-col items-center gap-0.5 p-1 rounded-[1.35rem] border backdrop-blur-xl"
        style={{
          background:  'var(--oem-surface-1, rgba(38,44,60,0.72))',
          borderColor: 'var(--oem-line, rgba(255,240,210,0.10))',
          boxShadow:   'var(--oem-shadow-card, 0 18px 40px -24px rgba(0,0,0,0.5))',
          bottom: 'calc(var(--lp-dock-h,68px) + 18px)',
          opacity: isNavigating ? 0 : ctrlVisible ? 1 : 0.32,
          transform: isNavigating ? 'translateX(56px)' : 'translateX(0)',
          pointerEvents: isNavigating ? 'none' : 'auto',
          transition: 'opacity 500ms cubic-bezier(0.4,0,0.2,1), transform 400ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Sürüş modu toggle */}
        <button
          onClick={() => { onToggleDrivingMode(); showControls(); }}
          className={`w-12 h-12 rounded-2xl border flex items-center justify-center active:scale-95 transition-colors duration-300 backdrop-blur-xl ${
            drivingMode
              ? 'bg-amber-500 border-amber-400/50 text-black'
              : 'text-slate-400 hover:text-white'
          }`}
          style={{
            /* Ray içinde: pasif hâlde YÜZEY YOK (ray zaten yüzey). */
            background: drivingMode ? undefined : 'transparent',
            borderColor: drivingMode ? undefined : 'transparent',
            boxShadow: drivingMode ? '0 0 16px rgba(224,162,60,0.42)' : 'none',
          }}
        >
          <Navigation2 className={`w-5 h-5 ${drivingMode ? 'fill-black' : ''}`} />
        </button>

        {/* Konuma dön */}
        <button
          onClick={() => { onRecenter(); showControls(); }}
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-slate-400 hover:text-amber-300 active:scale-90 transition-colors"
          style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}
        >
          <Crosshair className="w-5 h-5" />
        </button>

        {/* Kamera aç/kapat */}
        <button
          onClick={onCameraToggle}
          className={`w-12 h-12 rounded-2xl backdrop-blur-xl border flex items-center justify-center active:scale-90 transition-all ${
            cameraOn
              ? 'bg-amber-500 border-amber-400 text-black shadow-[0_0_16px_rgba(224,162,60,0.6)]'
              : 'text-slate-400 hover:text-amber-300'
          }`}
          style={{
            background: cameraOn ? undefined : 'transparent',
            borderColor: cameraOn ? undefined : 'transparent',
            boxShadow: cameraOn ? '0 0 14px rgba(224,162,60,0.42)' : 'none',
          }}
        >
          {cameraOn ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
        </button>

        {/* Zoom pill */}
        <div
          className="flex flex-col rounded-2xl overflow-hidden"
          style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}
        >
          <button
            onClick={() => { onZoomIn(); showControls(); }}
            className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-colors"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <div style={{ height: 1, margin: '0 12px', background: 'var(--oem-line, rgba(255,240,210,0.10))' }} />
          <button
            onClick={() => { onZoomOut(); showControls(); }}
            className="w-12 h-12 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-colors"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── NAV ZOOM + PUSULA KOLONU KALDIRILDI (P0-NAV-04) ─────────────────
       * Sürüş boyunca sağ kenarda duran pusula + zoom(+/−) üçlüsü bir WEB
       * HARİTASI hissiydi; sürücü seyirde zoom'a basmaz ve kamera zaten hıza
       * göre ölçekleniyor. Bu kolonun hız paneliyle **54×55 px çakıştığı** eski
       * yorumda ölçülmüştü. Yerini `hud/DrivingControls` aldı: ORTALA düğmesi
       * yalnız kullanıcı kamerayı bıraktığında (`cameraFollowAuthority`
       * FOLLOW_SUSPENDED / USER_PANNING) görünür. Zoom, rehberlik dışında
       * aşağıdaki idle kolonunda AYNEN durmaya devam eder. */}

      {/* ── SOL: Yol durumu rapor butonu — sürüş modunda gizli ── */}
      {!drivingMode && (
        <button
          onClick={() => setReportOpen(true)}
          aria-label="Yol durumu bildir"
          style={{
            position: 'fixed',
            bottom: 'calc(var(--lp-dock-h,68px) + 18px)',
            left:   'calc(var(--sal,0px) + 16px)',
            zIndex: 'var(--z-map-control)',
            width: 48, height: 48,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            /* CHROME TURU 2026-09-05: amber dolgu + amber kenar + amber glow
               üçlüsü haritanın sol alt köşesinde sürekli yanan bir kutu
               yaratıyordu ("dev sol butonlar"). Anlam İKONDA taşınır; kutu
               sağ raydaki nötr yüzey diliyle aynıdır. */
            background:     'var(--oem-surface-1, rgba(38,44,60,0.86))',
            backdropFilter: 'blur(16px)',
            border:         '1px solid var(--oem-line-strong, rgba(255,240,210,0.18))',
            borderRadius:   '16px',
            color:          '#fbbf24',
            cursor:         'pointer',
            boxShadow:      'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
            transition:     'opacity 300ms',
            opacity:        ctrlVisible ? 1 : 0.32,
          }}
        >
          <AlertTriangle className="w-5 h-5" />
        </button>
      )}

      {/* ── RAPOR OVERLAY — büyük dokunmatik hedefler, otomotiv UX ── */}
      {reportOpen && (
        <div
          onClick={() => setReportOpen(false)}
          style={{
            position:   'fixed',
            inset:      0,
            zIndex:     'var(--z-map-sheet)',
            background: 'rgba(0,0,0,0.72)',
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background:    'rgba(10,14,26,0.96)',
              border:        '1.5px solid rgba(255,255,255,0.1)',
              borderRadius:  '24px',
              padding:       '28px 24px',
              width:         'min(360px, 90vw)',
              boxShadow:     '0 16px 48px rgba(0,0,0,0.7)',
            }}
          >
            {/* Başlık */}
            <p style={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: 11, fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              textAlign: 'center', marginBottom: 20,
            }}>
              Yol Durumu Bildir
            </p>

            {/* Seçenek butonları */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {REPORT_OPTIONS.map(({ type, label, Icon, color }) => (
                <button
                  key={type}
                  onClick={() => handleReport(type)}
                  style={{
                    display:        'flex',
                    flexDirection:  'column',
                    alignItems:     'center',
                    justifyContent: 'center',
                    gap:            10,
                    height:         88,
                    background:     `${color}18`,
                    border:         `1.5px solid ${color}40`,
                    borderRadius:   '16px',
                    color,
                    cursor:         'pointer',
                    fontSize:       13, fontWeight: 700,
                    letterSpacing:  '0.02em',
                    transition:     'background 150ms',
                  }}
                >
                  <Icon className="w-6 h-6" style={{ color }} />
                  {label}
                </button>
              ))}
            </div>

            {/* İptal */}
            <button
              onClick={() => setReportOpen(false)}
              style={{
                marginTop:     16,
                width:         '100%',
                padding:       '14px 0',
                background:    'rgba(255,255,255,0.05)',
                border:        '1px solid rgba(255,255,255,0.1)',
                borderRadius:  '14px',
                color:         'rgba(255,255,255,0.45)',
                fontSize:      13, fontWeight: 600,
                cursor:        'pointer',
                letterSpacing: '0.04em',
              }}
            >
              İptal
            </button>
          </div>
        </div>
      )}

      {/* ── ALT MERKEZ: Harita katman seçici — nav/preview'da kaybolur, idle'da soluklaşır ── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-[var(--z-map-label)] flex flex-col items-center gap-2"
        style={{
          bottom: 'calc(var(--lp-dock-h,68px) + 14px)',
          opacity: (isNavigating || isPreview) ? 0 : ctrlVisible ? 1 : 0.28,
          transform: (isNavigating || isPreview) ? 'translateY(16px)' : 'translateY(0)',
          pointerEvents: (isNavigating || isPreview) ? 'none' : 'auto',
          transition: 'opacity 500ms cubic-bezier(0.4,0,0.2,1), transform 400ms cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div
          className="flex items-center gap-0.5 backdrop-blur-xl rounded-2xl p-1 border"
          style={{
            background: 'var(--oem-surface-1, rgba(38,44,60,0.86))',
            borderColor: 'var(--oem-line-strong, rgba(255,240,210,0.18))',
            boxShadow: 'var(--oem-shadow-card, 0 20px 44px -22px rgba(0,0,0,0.55))',
          }}
        >
          {(['road', 'hybrid', 'satellite'] as MapMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { onSetMapMode(m); showControls(); }}
              aria-label={MODE_LABELS[m]}
              aria-pressed={mode === m}
              /* CHROME TURU 2026-09-05: üç mod da metin+ikon taşıyordu ve pill
                 ekranın altında ~250 px yer kaplıyordu ("büyük YOL/HİBRİT/UYDU").
                 Etiket artık YALNIZ seçili modda yazılır — hangi modda olunduğu
                 okunmaya devam eder, diğer ikisi ikonla temsil edilir. Dokunma
                 hedefi 44×40 px'in altına İNMEZ (min-w-[44px] + py-2.5). */
              className={`flex items-center justify-center gap-1.5 min-w-[44px] px-3 py-2.5 rounded-xl text-[10px] font-bold tracking-[0.12em] uppercase transition-all duration-200 active:scale-95 ${
                mode === m
                  ? 'text-[color:var(--oem-accent,#E0A23C)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/8'
              }`}
              style={mode === m ? { background: 'var(--oem-accent-soft, rgba(224,162,60,0.18))' } : undefined}
            >
              {m === 'road' && <Map className="w-4 h-4" />}
              {m === 'hybrid' && <Layers className="w-4 h-4" />}
              {m === 'satellite' && <Globe className="w-4 h-4" />}
              {mode === m && <span>{MODE_LABELS[m]}</span>}
            </button>
          ))}
        </div>
        {/* OEM++ 2026-09-05 — ham lat/lon üretim kullanıcı ekranında görünüyordu
            (kullanıcı saha raporu: "harita üstünde gereksiz ham koordinat").
            Bu bir navigasyon/harita otoritesi kararı değil, salt bir geliştirici
            hata-ayıklama yardımcısıydı; tek geliştirici-yüzey otoritesi
            (`DEVELOPER_FEATURES_ENABLED`) arkasına alındı — DEV/debug-panel
            build'lerinde aynen kalır, satış APK'sında derleme zamanında elenir. */}
        {DEVELOPER_FEATURES_ENABLED && location && (
          <span className="text-[9px] text-white/25 font-mono tracking-tight">
            {location.latitude.toFixed(4)}°, {location.longitude.toFixed(4)}°
          </span>
        )}
      </div>
    </>
  );
});
