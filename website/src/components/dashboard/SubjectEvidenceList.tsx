'use client';

/**
 * SubjectEvidenceList — Fleet UI · "BU KAYDIN KANITLARI" (salt-okunur).
 *
 * Üç yerde kullanılır:
 *   · Trip detayı              → "Bu yolculuğun kanıtları"
 *   · Sürücü DNA kartı         → "Bu profilin dayandığı kanıtlar"
 *   · Fleet Intelligence detayı→ "Bu içgörünün kanıtları"
 *
 * ── SALT-OKUNUR (ilk sürüm) ───────────────────────────────────────────
 * Kanıt üretmez, düzenlemez, silmez. Buton/aksiyon YOKTUR.
 *
 * ── DÜRÜSTLÜK ─────────────────────────────────────────────────────────
 *   · Kanıt yoksa BOŞ LİSTE değil, GEREKÇE gösterilir.
 *   · Ölçümü olmayan kanıt `—` gösterilir, **`0` değil**.
 *   · `SUPERSEDED`/`EXPIRED` kanıt gizlenmez ama AKTİF gibi sunulmaz.
 *   · Tam UUID, VIN, konum ve ham yük GÖSTERİLMEZ.
 */

import {
  buildSubjectEvidenceView,
  type SubjectEvidenceRow,
} from '@/lib/fleet/evidenceCoverageView';

export interface SubjectEvidenceListProps {
  /** `get_subject_evidence()` satırları; yoksa `null`. */
  readonly rows: readonly SubjectEvidenceRow[] | null;
  /** Başlık — çağıran bağlama göre verir. */
  readonly title?: string;
}

export function SubjectEvidenceList({ rows, title }: SubjectEvidenceListProps) {
  const v = buildSubjectEvidenceView(rows);

  return (
    <section
      data-testid="subject-evidence-list"
      className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-100">
          {title ?? 'Bu kaydın kanıtları'}
        </h3>
        {v.items.length > 0 && (
          <span className="text-[11px] text-neutral-500">
            {v.activeCount} aktif
            {v.supersededCount > 0 && ` · ${v.supersededCount} devredilmiş`}
            {v.expiredCount > 0 && ` · ${v.expiredCount} süresi dolmuş`}
          </span>
        )}
      </header>

      {v.emptyReason !== null ? (
        <p data-testid="subject-evidence-empty" className="text-[12px] text-neutral-400">
          {v.emptyReason}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {v.items.map((e) => (
            <li
              key={e.id}
              data-testid={`evidence-item-${e.state}`}
              className={`flex items-center justify-between rounded border border-neutral-800 px-2 py-1 text-[12px] ${
                e.active ? 'bg-neutral-950/50' : 'bg-neutral-950/20 opacity-70'
              }`}
            >
              <span className="text-neutral-300">
                {e.metric}
                <span className="ml-2 text-[10px] text-neutral-600">{e.source}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-neutral-200">
                  {e.value === null ? '—' : e.value}
                </span>
                <span className="rounded border border-neutral-700 px-1 text-[10px] text-neutral-500">
                  {e.provenance}
                </span>
                <span className="rounded border border-neutral-700 px-1 text-[10px] text-neutral-500">
                  {e.confidence}
                </span>
                {!e.active && (
                  <span className="rounded border border-amber-800 px-1 text-[10px] text-amber-600">
                    {e.state}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-neutral-600">
        Bu liste <strong>salt-okunurdur</strong>. Ölçümü olmayan kanıt
        <strong> boş bırakılır</strong> (<code>0</code> değil). Devredilmiş
        veya süresi dolmuş kanıt <strong>silinmez</strong> ama aktif gibi
        sunulmaz — geçmişte söylenmiş bir şeyin dayanağı izlenebilir kalır.
      </p>
    </section>
  );
}

export default SubjectEvidenceList;
