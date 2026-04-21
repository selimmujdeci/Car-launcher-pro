import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtDate(iso?: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso))
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export function fmtRelative(iso?: string): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'Az önce'
  if (m < 60) return `${m}dk önce`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}s önce`
  return `${Math.floor(h / 24)}g önce`
}

export function fmtKm(km: number): string {
  return `${km.toLocaleString('tr-TR')} km`
}

export function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
}
