import type { Metadata } from 'next';
import Button from '@/components/Button';

export const metadata: Metadata = {
  title: 'İletişim — Caros Pro',
  description: 'Kurumsal demo ve destek için iletişime geçin.',
};

const contactItems = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" stroke="#3b82f6" strokeWidth="1.5"/>
        <path d="M3 7l7 5 7-5" stroke="#3b82f6" strokeWidth="1.5"/>
      </svg>
    ),
    label: 'E-posta',
    value: 'info@carlauncher.pro',
    href: 'mailto:info@carlauncher.pro',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M4 4h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" stroke="#3b82f6" strokeWidth="1.5"/>
        <path d="M2 7l8 5 8-5" stroke="#3b82f6" strokeWidth="1.5"/>
      </svg>
    ),
    label: 'Destek',
    value: 'support@carlauncher.pro',
    href: 'mailto:support@carlauncher.pro',
  },
];

export default function Contact() {
  return (
    <>
      {/* Header */}
      <section className="pt-32 pb-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_50%_0%,rgba(59,130,246,0.1)_0%,transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-6 text-center">
          <p className="text-xs font-semibold tracking-widest text-accent-ink uppercase mb-4">İletişim</p>
          <h1 className="text-4xl md:text-5xl font-bold text-gradient mb-5">Bizimle İletişime Geç</h1>
          <p className="text-ink-3 text-lg max-w-xl mx-auto">
            Demo talebi, kurumsal teklif veya teknik destek için aşağıdaki formu kullanabilirsiniz.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="py-16 pb-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid md:grid-cols-5 gap-8">

            {/* Info side */}
            <div className="md:col-span-2 flex flex-col gap-6">
              <div>
                <h2 className="font-semibold text-ink mb-2">Kurumsal Satış</h2>
                <p className="text-sm text-ink-3 leading-relaxed">
                  Filo yönetimi, kurumsal lisans ve özel entegrasyon için
                  satış ekibimizle iletişime geçin.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {contactItems.map(({ icon, label, value, href }) => (
                  <a
                    key={label}
                    href={href}
                    className="flex items-center gap-4 p-4 rounded-xl glass border border-line hover:border-line-2 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 group-hover:border-accent/35 transition-colors">
                      {icon}
                    </div>
                    <div>
                      <p className="text-xs text-ink-3 mb-0.5">{label}</p>
                      <p className="text-sm text-ink-2 group-hover:text-ink transition-colors">{value}</p>
                    </div>
                  </a>
                ))}
              </div>

              <div className="p-5 rounded-xl border border-line bg-surface">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-medium text-emerald-ink">Yanıt süresi</span>
                </div>
                <p className="text-sm text-ink-3">
                  Kurumsal talepler genellikle <span className="text-ink-2">24 saat</span> içinde yanıtlanır.
                </p>
              </div>
            </div>

            {/* Form */}
            <div className="md:col-span-3">
              <div className="p-8 rounded-2xl glass border border-line">
                <form className="flex flex-col gap-5">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-ink-3 mb-2 font-medium">Ad Soyad</label>
                      <input
                        type="text"
                        placeholder="Ahmet Yılmaz"
                        className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-accent/50 focus:bg-surface-2 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-3 mb-2 font-medium">Şirket</label>
                      <input
                        type="text"
                        placeholder="ABC Lojistik A.Ş."
                        className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-accent/50 focus:bg-surface-2 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-ink-3 mb-2 font-medium">E-posta</label>
                    <input
                      type="email"
                      placeholder="ahmet@sirket.com"
                      className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-accent/50 focus:bg-surface-2 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-ink-3 mb-2 font-medium">Filo Büyüklüğü</label>
                    <select className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink-2 focus:outline-none focus:border-accent/50 transition-all appearance-none cursor-pointer">
                      <option value="" className="bg-elevated text-ink">Seçiniz</option>
                      <option value="1-10" className="bg-elevated text-ink">1–10 araç</option>
                      <option value="11-50" className="bg-elevated text-ink">11–50 araç</option>
                      <option value="51-200" className="bg-elevated text-ink">51–200 araç</option>
                      <option value="200+" className="bg-elevated text-ink">200+ araç</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-ink-3 mb-2 font-medium">Mesaj</label>
                    <textarea
                      rows={4}
                      placeholder="Kurumsal demo, entegrasyon veya destek talebinizi açıklayın..."
                      className="w-full bg-surface border border-line rounded-xl px-4 py-3 text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-accent/50 focus:bg-surface-2 transition-all resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-accent-solid hover:bg-accent-dark text-white font-medium py-3.5 rounded-xl transition-colors text-sm"
                  >
                    Gönder
                  </button>

                  <p className="text-center text-xs text-ink-4">
                    Formunuz güvenli şekilde iletilir. Spam göndermeyiz.
                  </p>
                </form>
              </div>
            </div>

          </div>
        </div>
      </section>
    </>
  );
}
