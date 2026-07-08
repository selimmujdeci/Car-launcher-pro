'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

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
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? 'border-b border-line nav-blur' : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center group-hover:bg-accent/25 transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.375 4.5 8.5 4.5 8.5S12.5 9.375 12.5 6c0-2.485-2.015-4.5-4.5-4.5z" stroke="#3b82f6" strokeWidth="1.3" />
              <circle cx="8" cy="6" r="1.5" stroke="#3b82f6" strokeWidth="1.3" />
            </svg>
          </div>
          <span className="font-semibold text-sm tracking-tight text-ink">
            Caros <span className="text-accent-ink">Pro</span>
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
                  ? 'text-ink bg-surface-2'
                  : 'text-ink-3 hover:text-ink hover:bg-surface'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* CTAs */}
        <div className="hidden md:flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className="text-sm text-ink-2 hover:text-ink transition-colors px-3 py-2"
          >
            Giriş Yap
          </Link>
          <Link
            href="/enterprise"
            className="text-sm bg-accent-solid hover:bg-accent-dark text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-glow-sm"
          >
            Kurumsal
          </Link>
        </div>

        {/* Mobile actions */}
        <div className="md:hidden flex items-center gap-1">
          <ThemeToggle />
          <button
            className="p-2 text-ink-3 hover:text-ink transition-colors"
            onClick={() => setOpen(!open)}
            aria-label="Menü"
            aria-expanded={open}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              {open ? (
                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-line nav-blur px-6 py-4 flex flex-col gap-1">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`px-4 py-3 rounded-lg text-sm transition-colors ${
                pathname === href ? 'text-ink bg-surface-2' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {label}
            </Link>
          ))}
          <div className="border-t border-line mt-2 pt-3 flex flex-col gap-2">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="px-4 py-3 text-sm text-ink-2 hover:text-ink transition-colors"
            >
              Giriş Yap
            </Link>
            <Link
              href="/enterprise"
              onClick={() => setOpen(false)}
              className="px-4 py-3 bg-accent-solid text-white text-sm rounded-lg text-center font-medium"
            >
              Kurumsal Çözüm
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
