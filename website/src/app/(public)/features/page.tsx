import type { Metadata } from 'next';
import FeatureCard from '@/components/FeatureCard';
import Button from '@/components/Button';

export const metadata: Metadata = {
  title: 'Özellikler — Car Launcher Pro',
  description: 'Navigasyon, OBD entegrasyonu, Diagnostic AI ve web kontrol paneli.',
};

const sections = [
  {
    category: 'Navigasyon',
    color: 'blue',
    items: [
      { title: 'Çevrimdışı Haritalar', desc: 'MapLibre GL ile offline tile desteği. İnternetsiz tam navigasyon.', badge: 'Offline' },
      { title: 'Tünel Modu', desc: 'GPS sinyali kesildiğinde dead reckoning ile konum tahmini.', badge: 'Akıllı' },
      { title: 'Rota Optimizasyonu', desc: 'Anlık trafik verisi ile alternatif güzergah önerileri.' },
      { title: 'POI Arama', desc: 'Yakındaki servis istasyonları, restoranlar ve şarj noktaları.' },
    ],
  },
  {
    category: 'Araç Verisi',
    color: 'emerald',
    items: [
      { title: 'OBD-II Okuma', desc: 'ELM327 Bluetooth adaptörü ile anlık araç verisi. Hız, RPM, sıcaklık.', badge: 'Bluetooth' },
      { title: 'CAN Bus Entegrasyonu', desc: 'Araç CAN veri yoluna doğrudan erişim. TPMS, kapı ve far durumu.', badge: 'Gelişmiş' },
      { title: 'Yakıt Takibi', desc: 'Yakıt seviyesi, ortalama tüketim ve maliyet hesaplama.' },
      { title: 'DTC Kod Okuma', desc: 'Motor arıza kodlarını oku, sıfırla ve analiz et.' },
    ],
  },
  {
    category: 'Yapay Zeka',
    color: 'purple',
    items: [
      { title: 'Diagnostic AI', desc: 'P0300, P0420 gibi 200+ DTC kodunu Türkçe açıklamalarla analiz et.', badge: 'AI' },
      { title: 'Sesli Asistan', desc: 'Türkçe sesli komutlarla navigasyon ve araç kontrolü.' },
      { title: 'Mola Önerisi', desc: 'Sürüş süresi ve yorgunluk analizine göre otomatik mola hatırlatıcısı.' },
    ],
  },
  {
    category: 'Yönetim',
    color: 'orange',
    items: [
      { title: 'Web Kontrol Paneli', desc: 'Tüm araçları ve sürücüleri tek ekrandan yönet.', badge: 'Kurumsal' },
      { title: 'Gerçek Zamanlı Konum', desc: 'Filo araçlarını harita üzerinde canlı takip et.' },
      { title: 'Sürüş Raporları', desc: 'Sürücü bazlı detaylı sürüş analizi ve performans raporları.' },
      { title: 'Rol Yönetimi', desc: 'Sürücü, yönetici ve süper admin rolleri ile yetki kontrolü.' },
    ],
  },
];

const iconMap: Record<string, React.ReactNode> = {
  Navigasyon: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2C6.686 2 4 4.686 4 8c0 4.5 6 10 6 10s6-5.5 6-10c0-3.314-2.686-6-6-6z" stroke="#3b82f6" strokeWidth="1.5"/>
      <circle cx="10" cy="8" r="2" stroke="#3b82f6" strokeWidth="1.5"/>
    </svg>
  ),
  'Araç Verisi': (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 10a7 7 0 1014 0A7 7 0 003 10z" stroke="#10b981" strokeWidth="1.5"/>
      <path d="M10 6v4l3 1.5" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  'Yapay Zeka': (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="5" width="14" height="10" rx="2" stroke="#a78bfa" strokeWidth="1.5"/>
      <path d="M7 9h6M7 12h4" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  Yönetim: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="2" y="4" width="16" height="12" rx="2" stroke="#f97316" strokeWidth="1.5"/>
      <path d="M2 8h16" stroke="#f97316" strokeWidth="1.5"/>
    </svg>
  ),
};

export default function Features() {
  return (
    <>
      {/* Header */}
      <section className="pt-32 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,rgba(59,130,246,0.1)_0%,transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-6 text-center">
          <p className="text-xs font-semibold tracking-widest text-accent/70 uppercase mb-4">Özellikler</p>
          <h1 className="text-4xl md:text-5xl font-bold text-gradient mb-5">
            Kapsamlı Özellik Seti
          </h1>
          <p className="text-white/45 text-lg max-w-2xl mx-auto leading-relaxed">
            Araç içi deneyiminden kurumsal filo yönetimine kadar her şey entegre.
          </p>
        </div>
      </section>

      {/* Feature sections */}
      {sections.map(({ category, items }) => (
        <section key={category} className="py-16">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.08]">
                {iconMap[category]}
              </div>
              <h2 className="text-lg font-semibold text-white/80">{category}</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {items.map((item) => (
                <FeatureCard
                  key={item.title}
                  icon={iconMap[category]}
                  title={item.title}
                  description={item.desc}
                  badge={item.badge}
                />
              ))}
            </div>
          </div>
        </section>
      ))}

      {/* CTA */}
      <section className="py-16 pb-24">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="p-12 rounded-3xl glass border border-white/[0.08] relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.06)_0%,transparent_70%)] pointer-events-none" />
            <div className="relative">
              <h2 className="text-2xl md:text-3xl font-bold text-gradient mb-3">Tüm özellikleri keşfet</h2>
              <p className="text-white/40 mb-8 max-w-md mx-auto text-sm">
                Kurumsal demo için bizimle iletişime geçin ya da doğrudan panele giriş yapın.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button href="/contact">Demo Talep Et</Button>
                <Button href="/login" variant="secondary">Panele Gir</Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
