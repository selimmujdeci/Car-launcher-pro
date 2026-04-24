'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const links = [
  { href: '/', label: 'Ana Sayfa' },
  { href: '/features', label: 'Özellikler' },
  { href: '/enterprise', label: 'Kurumsal' },
  { href: '/contact', label: 'İletişim' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-white/[0.07] bg-bg/90 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center group-hover:bg-accent/25 transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.375 4.5 8.5 4.5 8.5S12.5 9.375 12.5 6c0-2.485-2.015-4.5-4.5-4.5z" stroke="#3b82f6" strokeWidth="1.3"/>
              <circle cx="8" cy="6" r="1.5" stroke="#3b82f6" strokeWidth="1.3"/>
            </svg>
          </div>
          <span className="font-semibold text-sm tracking-tight">
            Caros <span className="text-accent">Pro</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                pathname === href
                  ? 'text-white bg-white/[0.07]'
                  : 'text-white/50 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-white/55 hover:text-white transition-colors px-3 py-2"
          >
            Giriş Yap
          </Link>
          <Link
            href="/enterprise"
            className="text-sm bg-accent hover:bg-accent/90 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-glow-sm"
          >
            Kurumsal
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 text-white/60 hover:text-white transition-colors"
          onClick={() => setOpen(!open)}
          aria-label="Menü"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            {open ? (
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            ) : (
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-white/[0.06] bg-bg/95 backdrop-blur-xl px-6 py-4 flex flex-col gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`px-4 py-3 rounded-lg text-sm transition-colors ${
                pathname === href ? 'text-white bg-white/[0.07]' : 'text-white/60 hover:text-white'
              }`}
            >
              {label}
            </Link>
          ))}
          <div className="border-t border-white/[0.06] mt-2 pt-3 flex flex-col gap-2">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="px-4 py-3 text-sm text-white/60 hover:text-white transition-colors"
            >
              Giriş Yap
            </Link>
            <Link
              href="/enterprise"
              onClick={() => setOpen(false)}
              className="px-4 py-3 bg-accent text-white text-sm rounded-lg text-center font-medium"
            >
              Kurumsal Çözüm
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
