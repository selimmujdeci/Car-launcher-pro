import Link from 'next/link';

const columns = [
  {
    title: 'Ürün',
    links: [
      { href: '/features', label: 'Özellikler' },
      { href: '/enterprise', label: 'Kurumsal' },
      { href: '/#how-it-works', label: 'Nasıl Çalışır' },
    ],
  },
  {
    title: 'Şirket',
    links: [
      { href: '/contact', label: 'İletişim' },
      { href: '/enterprise', label: 'Filo Çözümleri' },
    ],
  },
  {
    title: 'Hesap',
    links: [
      { href: '/login', label: 'Giriş Yap' },
      { href: '/admin', label: 'Admin Panel' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-bg">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8C2 4.686 4.686 2 8 2s6 2.686 6 6-2.686 6-6 6-6-2.686-6-6z" stroke="#3b82f6" strokeWidth="1.5"/>
                  <path d="M8 5v3l2 1.5" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <span className="font-semibold text-sm">Caros <span className="text-accent">Pro</span></span>
            </div>
            <p className="text-white/40 text-sm leading-relaxed max-w-[200px]">
              Araç içi yazılım platformu. Filo yönetimi ve kurumsal çözümler.
            </p>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-semibold tracking-widest text-white/30 uppercase mb-4">
                {col.title}
              </p>
              <ul className="flex flex-col gap-2.5">
                {col.links.map(({ href, label }) => (
                  <li key={href}>
                    <Link href={href} className="text-sm text-white/50 hover:text-white transition-colors">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="pt-8 border-t border-white/[0.06] flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-white/25 text-xs">
            © {new Date().getFullYear()} Caros Pro. Tüm hakları saklıdır.
          </p>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-slow" />
            <span className="text-white/25 text-xs">Platform Aktif</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
