import { useState, useMemo } from 'react'

interface Opts<T extends object> {
  data:        T[]
  searchKeys?: (keyof T)[]
  perPage?:    number
}

export function useTable<T extends object>({ data, searchKeys = [], perPage = 10 }: Opts<T>) {
  const [q,       setQ]       = useState('')
  const [page,    setPage]    = useState(1)
  const [sortKey, setSortKey] = useState<keyof T | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const filtered = useMemo(() => {
    if (!q.trim()) return data
    const low = q.toLowerCase()
    return data.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(low)))
  }, [data, q, searchKeys])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    return [...filtered].sort((a, b) => {
      const cmp = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), 'tr')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  const total = sorted.length
  const pages = Math.max(1, Math.ceil(total / perPage))
  const rows  = sorted.slice((page - 1) * perPage, page * perPage)

  function onSearch(v: string) { setQ(v); setPage(1) }
  function onSort(key: keyof T) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
    setPage(1)
  }

  return { rows, total, pages, page, q, sortKey, sortDir, setPage, onSearch, onSort }
}
