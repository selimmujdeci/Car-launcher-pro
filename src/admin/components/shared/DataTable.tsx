import type { ReactNode } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

export interface ColDef<T extends object> {
  key:        string
  header:     string
  sortable?:  boolean
  width?:     string
  cell:       (row: T, idx: number) => ReactNode
}

interface Props<T extends object> {
  data:       T[]
  cols:       ColDef<T>[]
  total:      number
  page:       number
  pages:      number
  q:          string
  sortKey?:   string | null
  sortDir?:   'asc' | 'desc'
  loading?:   boolean
  placeholder?: string
  onSearch:   (v: string) => void
  onSort:     (k: string) => void
  onPage:     (p: number) => void
  toolbar?:   ReactNode
  empty?:     ReactNode
}

export function DataTable<T extends object>({
  data, cols, total, page, pages, q, sortKey, sortDir,
  loading, placeholder = 'Ara…', onSearch, onSort, onPage,
  toolbar, empty,
}: Props<T>) {
  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <Input
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
          className="max-w-xs"
        />
        {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[--adm-border] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[--adm-border] bg-white/3">
                {cols.map((c) => (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={cn(
                      'px-4 py-2.5 text-left text-[11px] font-semibold text-[--adm-muted] uppercase tracking-wider whitespace-nowrap',
                      c.sortable && 'cursor-pointer select-none hover:text-[--adm-text]',
                    )}
                    onClick={() => c.sortable && onSort(c.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {c.sortable && (
                        sortKey === c.key
                          ? sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          : <ChevronsUpDown className="h-3 w-3 opacity-30" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[--adm-border]">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td key={c.key} className="px-4 py-3">
                        <div className="h-4 rounded bg-white/5 animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={cols.length}>
                    {empty ?? (
                      <p className="text-center py-12 text-sm text-[--adm-muted]">Kayıt bulunamadı.</p>
                    )}
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr key={i} className="hover:bg-white/3 transition-colors">
                    {cols.map((c) => (
                      <td key={c.key} className="px-4 py-3 align-middle">{c.cell(row, i)}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-[--adm-muted]">
          <span>{total} kayıt</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => onPage(page - 1)} disabled={page === 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 text-[--adm-text] font-medium">{page}/{pages}</span>
            <Button variant="outline" size="icon" onClick={() => onPage(page + 1)} disabled={page === pages}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
