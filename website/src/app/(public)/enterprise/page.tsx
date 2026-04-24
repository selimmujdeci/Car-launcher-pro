import type { Metadata } from 'next';
import Button from '@/components/Button';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Kurumsal Çözümler — Car Launcher Pro',
  description: 'Filo yönetimi, kamu kurumları ve şirket araç takibi için kurumsal platform.',
};

const useCases = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect x="2" y="6" width="20" height="14" rx="3" stroke="#3b82f6" strokeWidth="1.5"/>
        <path d="M8 6V4a4 4 0 018 0v2" stroke="#3b82f6" strokeWidth="1.5"/>
        <path d="M12 13v2M10 13h4" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    title: 'Şirket Filoları',
    desc: 'Kurye, servis ve satış ekiplerinin araçlarını anlık takip et. Sürücü performansını izle, yakıt maliyetlerini optimize et.',
    points: ['Anlık GPS takibi', 'Sürücü puanlaması', 'Yakıt maliyet analizi', 'Bakım hatırlatıcı'],
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L3 7l9 5 9-5-9-5z" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M3 12l9 5 9-5" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M3 17l9 5 9-5" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Kamu Kurumları',
    desc: 'Belediye araçları, polis ve ambulanslar için merkezi yönetim. Acil durum rotalaması ve anlık iletişim.',
    points: ['Öncelikli rota planı', 'Merkezi komuta', 'Vardiya yönetimi', 'Detaylı raporlama'],
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="#a78bfa" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M9 22V12h6v10" stroke="#a78bfa" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
    title: 'Lojistik & Ulaştırma',
    desc: 'Uzun mesafe taşımacılık ve dağıtım ağları için optimize edilmiş platform. Sürücü mola yönetimi ve yasal uyumluluk.',
    points: ['Rota optimizasyonu', 'Mola takibi (AB)', 'Kargo doğrulama', 'Müşteri bildirim'],
  },
];

const panelFeatures = [
  { title: 'Gerçek Zamanlı Harita', desc: 'Tüm araçları tek haritada anlık izle' },
  { title: 'Rol Bazlı Erişim', desc: 'Sürücü, yönetici ve süper admin rolleri' },
  { title: 'Otomatik Raporlar', desc: 'Günlük / haftalık PDF rapor gönderimi' },
  { title: 'Araç Geçmişi', desc: '90 günlük rota ve sürüş geçmişi' },
  { title: 'Alert Sistemi', desc: 'Hız aşımı, bölge çıkışı ve arıza bildirimleri' },
  { title: 'API Entegrasyonu', desc: 'REST API ile mevcut sistemlere entegrasyon' },
];

export default function Enterprise() {
  return (
    <>
      {/* Header */}
      <section className="pt-32 pb-16 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,rgba(59,130,246,0.1)_0%,transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-accent/25 bg-accent/10 text-accent text-xs font-medium tracking-wide mb-8">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="4" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4 4V3a2 2 0 014 0v1" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
            Kurumsal Platform
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-gradient mb-5">
            Filoyu Merkezi Yönet
          </h1>
          <p className="text-white/45 text-lg max-w-2xl mx-auto leading-relaxed mb-10">
            Tek araçtan yüzlerce araca. Web paneli, rol yönetimi ve gerçek zamanlı
            takip ile kurumsal filoyu tam kontrol altına al.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button href="/contact" size="lg">Demo Talep Et</Button>
            <Button href="/login" variant="secondary" size="lg">Panele Gir</Button>
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-semibold tracking-widest text-accent/70 uppercase mb-3">Kullanım Senaryoları</p>
            <h2 className="text-3xl font-bold text-gradient mb-4">Her Sektöre Uygun</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {useCases.map(({ icon, title, desc, points }) => (
              <div key={title} className="p-8 rounded-2xl glass border border-white/[0.07] hover:border-white/[0.12] transition-colors flex flex-col">
                <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-6">
                  {icon}
                </div>
                <h3 className="font-semibold text-white text-lg mb-3">{title}</h3>
                <p className="text-sm text-white/45 leading-relaxed mb-6">{desc}</p>
                <ul className="flex flex-col gap-2 mt-auto">
                  {points.map((p) => (
                    <li key={p} className="flex items-center gap-2.5 text-sm text-white/55">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Web Panel Features */}
      <section className="py-20 border-y border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-xs font-semibold tracking-widest text-accent/70 uppercase mb-4">Web Paneli</p>
              <h2 className="text-3xl font-bold text-gradient mb-5">
                Tam Kontrol,<br />Her Yerden
              </h2>
              <p className="text-white/45 text-base leading-relaxed mb-8">
                Herhangi bir tarayıcıdan erişilebilen web kontrol paneli.
                Araç, sürücü ve raporları merkezi olarak yönet.
              </p>
              <Button href="/contact">Demo İste</Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {panelFeatures.map(({ title, desc }) => (
                <div key={title} className="p-5 rounded-xl glass border border-white/[0.06] hover:border-white/[0.1] transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent mb-3" />
                  <p className="font-medium text-white text-sm mb-1">{title}</p>
                  <p className="text-xs text-white/40 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* RBAC */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold tracking-widest text-accent/70 uppercase mb-3">Yetkilendirme</p>
            <h2 className="text-3xl font-bold text-gradient mb-4">Rol Bazlı Erişim Kontrolü</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {[
              {
                role: 'Sürücü',
                color: 'emerald',
                perms: ['Kendi rotasını görür', 'Navigasyon kullanır', 'OBD okur', 'Mola kaydeder'],
              },
              {
                role: 'Yönetici',
                color: 'blue',
                perms: ['Filo haritasını görür', 'Sürücü raporları', 'Araç atama', 'Alert yönetimi'],
              },
              {
                role: 'Süper Admin',
                color: 'purple',
                perms: ['Tam yönetim', 'Kullanıcı ekleme', 'Sistem ayarları', 'API erişimi'],
              },
            ].map(({ role, color, perms }) => (
              <div key={role} className={`p-7 rounded-2xl border ${
                color === 'blue'
                  ? 'border-accent/25 bg-accent/[0.05]'
                  : color === 'purple'
                  ? 'border-violet-500/20 bg-violet-500/[0.04]'
                  : 'border-emerald-500/20 bg-emerald-500/[0.04]'
              }`}>
                <div className={`text-xs font-semibold tracking-widest uppercase mb-5 ${
                  color === 'blue' ? 'text-accent' : color === 'purple' ? 'text-violet-400' : 'text-emerald-400'
                }`}>
                  {role}
                </div>
                <ul className="flex flex-col gap-2.5">
                  {perms.map((p) => (
                    <li key={p} className="flex items-center gap-2.5 text-sm text-white/60">
                      <span className={`w-1 h-1 rounded-full flex-shrink-0 ${
                        color === 'blue' ? 'bg-accent' : color === 'purple' ? 'bg-violet-400' : 'bg-emerald-400'
                      }`} />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 pb-24">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="p-12 rounded-3xl bg-accent/[0.06] border border-accent/20 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.1)_0%,transparent_70%)] pointer-events-none" />
            <div className="relative">
              <h2 className="text-2xl font-bold text-gradient mb-3">Kurumsal Demo Talep Et</h2>
              <p className="text-white/45 text-sm mb-8 max-w-sm mx-auto">
                Ekibiniz için özelleştirilmiş demo ve fiyat teklifi alın.
              </p>
              <Button href="/contact" size="lg">İletişime Geç</Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
