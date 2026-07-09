import Link from 'next/link';
import FeatureCard from '@/components/FeatureCard';
import Button from '@/components/Button';
import MockDashboard from '@/components/MockDashboard';
import PWAInstallButton from '@/components/PWAInstallButton';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const features = [
  {
    title: 'Akıllı Navigasyon',
    description: 'MapLibre tabanlı çevrimdışı haritalar. İnternet olmadan tam navigasyon, tünel modu ve rota optimizasyonu.',
    badge: 'Offline',
    tone: 'blue' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--fc-ink)' }}>
        <path d="M10 2C6.686 2 4 4.686 4 8c0 4.5 6 10 6 10s6-5.5 6-10c0-3.314-2.686-6-6-6z" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="10" cy="8" r="2" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    title: 'Araç Verisi Entegrasyonu',
    description: 'OBD-II / ELM327 Bluetooth bağlantısı. Anlık hız, RPM, motor sıcaklığı ve yakıt seviyesi okuma.',
    badge: 'OBD-II',
    tone: 'emerald' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--fc-ink)' }}>
        <path d="M3 10a7 7 0 1014 0A7 7 0 003 10z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 6v4l3 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: 'Diagnostic AI',
    description: 'Motor arızalarını yapay zeka ile analiz et. P0300, P0420 ve yüzlerce DTC kodunu Türkçe açıklamalarla öğren.',
    badge: 'AI',
    tone: 'violet' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--fc-ink)' }}>
        <rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    title: 'Web Kontrol Paneli',
    description: 'Uzaktan filo takibi, cihaz yönetimi ve sürücü raporları. Rol bazlı yetkilendirme ile kurumsal yönetim.',
    badge: 'Kurumsal',
    tone: 'orange' as const,
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--fc-ink)' }}>
        <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 8h16" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="5" cy="6" r="0.75" fill="currentColor"/>
        <circle cx="7.5" cy="6" r="0.75" fill="currentColor"/>
      </svg>
    ),
  },
];

// Uydurma metrik yok — yalnız doğrulanabilir, gerçek ürün yetenekleri.
const capabilities = [
  { label: 'Çevrimdışı-öncelikli harita', sub: 'MapLibre GL' },
  { label: 'OBD-II · ELM327 · CAN', sub: 'Canlı telemetri' },
  { label: 'Yerinde Diagnostic AI', sub: 'Türkçe DTC analizi' },
  { label: 'Web kontrol paneli', sub: 'Rol bazlı filo' },
];

export default function Home() {
  return (
    <>
      <Navbar />
      {/* ── Hero ── */}
      <section className="relative min-h-screen flex flex-col items-center pt-16 overflow-hidden">
        <div className="absolute inset-0 grid-bg" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(59,130,246,0.13)_0%,transparent_60%)]" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-accent/[0.04] blur-[140px] pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-6 pt-24 pb-8 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-accent/25 bg-accent/10 text-accent-ink text-xs font-medium tracking-wide mb-8 shadow-glow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            v2.0 — Android &amp; Kurumsal Platform
          </div>

          <h1 className="text-[2.75rem] leading-[1.05] sm:text-6xl md:text-7xl lg:text-[5rem] font-bold tracking-tightest mb-6">
            <span className="text-gradient">Araç İçi Yazılımın</span>
            <br />
            <span className="text-gradient-blue">Yeni Standardı</span>
          </h1>

          <p className="text-ink-2 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Caros Pro — navigasyon, araç verisi, medya ve filo yönetimini
            tek platformda birleştiren profesyonel araç içi yazılım.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-6">
            <Button href="/login" size="lg">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M1 7h14" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              Kontrol Paneline Gir
            </Button>
            <Button href="/enterprise" variant="secondary" size="lg">
              Kurumsal Çözüm
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Button>
          </div>

          {/* PWA install — Arabam Cebimde */}
          <div className="flex justify-center mb-14">
            <PWAInstallButton />
          </div>

          {/* Yetenek şeridi — dürüst, doğrulanabilir; uydurma sayı yok */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto mb-16">
            {capabilities.map(({ label, sub }) => (
              <div
                key={label}
                className="flex flex-col items-center gap-1 p-4 rounded-xl glass border border-line text-center shadow-soft"
              >
                <div className="flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="text-accent-ink flex-shrink-0">
                    <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[13px] font-semibold text-ink leading-tight">{label}</span>
                </div>
                <span className="text-[11px] text-ink-3">{sub}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard preview */}
        <div className="relative w-full max-w-6xl mx-auto px-6 pb-24">
          <MockDashboard />
          <div className="absolute -inset-x-0 bottom-0 h-32 bg-gradient-to-t from-bg to-transparent pointer-events-none" />
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-24 relative" id="features">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold tracking-widest text-accent-ink uppercase mb-3">Yetenekler</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-4">Her Şey Tek Platformda</h2>
            <p className="text-ink-3 text-base max-w-xl mx-auto">
              Araç içi deneyimi yeniden tanımlayan entegre özellik seti.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((f) => (
              <FeatureCard key={f.title} {...f} />
            ))}
          </div>
          <div className="text-center mt-10">
            <Button href="/features" variant="secondary">Tüm Özellikleri Gör</Button>
          </div>
        </div>
      </section>

      {/* ── Edition Comparison ── */}
      <section className="py-24 border-y border-line" id="editions">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold tracking-widest text-accent-ink uppercase mb-3">Sürümler</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-4">
              Bireysel veya Kurumsal
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {/* Play Store */}
            <div className="p-8 rounded-2xl glass border border-line flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M3 9l4 4 8-8" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-ink">Play Store Sürümü</p>
                  <p className="text-xs text-ink-3">Bireysel kullanım</p>
                </div>
              </div>
              <ul className="flex flex-col gap-3 mb-8">
                {['Navigasyon & Harita', 'OBD Okuma', 'Medya Kontrolü', 'GPS Takibi', 'Sesli Asistan'].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-ink-2">
                    <span className="w-1 h-1 rounded-full bg-ink-4 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-auto">
                <Button href="#" variant="secondary" className="w-full" external>
                  Play Store&apos;dan İndir
                </Button>
              </div>
            </div>

            {/* Enterprise */}
            <div className="relative p-8 rounded-2xl bg-accent/[0.06] border border-accent/25 flex flex-col overflow-hidden">
              <div className="absolute top-4 right-4 text-[10px] font-semibold tracking-widest uppercase px-2.5 py-1 rounded-full bg-accent/20 text-accent-ink border border-accent/25">
                Önerilen
              </div>
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(59,130,246,0.08)_0%,transparent_60%)] pointer-events-none" />

              <div className="relative flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <rect x="2" y="6" width="14" height="10" rx="2" stroke="#3b82f6" strokeWidth="1.5"/>
                    <path d="M6 6V4a3 3 0 016 0v2" stroke="#3b82f6" strokeWidth="1.5"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-ink">Kurumsal Sürüm</p>
                  <p className="text-xs text-ink-3">Filo &amp; ekip yönetimi</p>
                </div>
              </div>

              <ul className="relative flex flex-col gap-3 mb-8">
                {[
                  'Play Store özellikleri +',
                  'Web Kontrol Paneli',
                  'Rol Bazlı Yetkilendirme',
                  'Filo Takibi & Raporlar',
                  'Uzaktan Araç Yönetimi',
                  'Kurumsal Destek & SLA',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-ink-2">
                    <span className="w-1 h-1 rounded-full bg-accent flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="relative mt-auto">
                <Button href="/enterprise" className="w-full">
                  Kurumsal Teklif Al
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-24" id="how-it-works">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold tracking-widest text-accent-ink uppercase mb-3">Platform</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gradient mb-4">Nasıl Çalışır?</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { step: '01', title: 'Kurulum', desc: "APK'yı araca bağlı Android cihaza yükle. Sistem launcher olarak ayarla." },
              { step: '02', title: 'Bağlan', desc: 'OBD adaptörü ile araca bağlan. GPS ve Bluetooth otomatik devreye girer.' },
              { step: '03', title: 'Yönet', desc: 'Web panelinden tüm araç ve sürücüleri merkezi olarak takip et.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="p-8 rounded-2xl glass border border-line relative overflow-hidden">
                <div aria-hidden="true" className="absolute top-5 right-6 font-mono text-6xl font-bold text-ink-4 select-none">{step}</div>
                <div className="font-mono text-xs text-accent-ink mb-3">Adım {step}</div>
                <h3 className="font-semibold text-ink text-lg mb-2">{title}</h3>
                <p className="text-sm text-ink-3 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section className="py-4 mx-6 mb-24">
        <div className="rounded-3xl bg-accent/[0.07] border border-accent/20 relative overflow-hidden py-16">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)] pointer-events-none" />
          <div className="relative text-center px-6">
            <h2 className="text-2xl md:text-3xl font-bold text-ink mb-3">
              Hemen Başla
            </h2>
            <p className="text-ink-3 mb-8 max-w-md mx-auto text-sm">
              Filo yönetimini dijitalleştir. Kurumsal demo için bizimle iletişime geç.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button href="/contact" size="lg">Demo Talep Et</Button>
              <Button href="/login" variant="secondary" size="lg">Panele Gir</Button>
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
