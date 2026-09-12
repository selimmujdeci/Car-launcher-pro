'use client';

/**
 * ZoneReorder — bir bölgenin kart sırasını SÜRÜKLEYEREK değiştirir.
 *
 * NEDEN VAR (#658): sıra bugüne dek yalnız "Bölge İçi Sıra" adlı bir SAYI
 * alanıyla değiştirilebiliyordu. Kullanıcının kafasında sıra görseldir; sayı
 * girmek için önce mevcut sırayı okuyup zihinden hesap yapmak gerekiyordu.
 *
 * ── TASARIM KARARLARI ──────────────────────────────────────────────────────
 *
 * 1. HTML5 drag-and-drop API'si KULLANILMAZ. Dokunmatik ekranda (bu ürünün
 *    birincil hedefi) `dragstart` güvenilir değildir; Pointer Events hem fare
 *    hem dokunuşta aynı yolu kullanır ve `setPointerCapture` ile parmak
 *    elemandan çıksa bile olay akışı KOPMAZ.
 *
 * 2. KİLİTLİ KART SÜRÜKLENEBİLİR ama listeden ÇIKARILAMAZ. `locked` bu üründe
 *    "gizlenemez" demektir, "yeri değişemez" demek DEĞİLDİR (solver de öyle
 *    davranır: `locked` yalnız görünürlük ve taşma kararında kullanılır).
 *    Yanlış bir kısıt eklemek, çözücünün gerçeğinden sapmak olurdu.
 *
 * 3. SONUÇ TEK İŞLEMDE yazılır (`reorder-zone`). Kart başına ayrı yama atılsaydı
 *    tek bir sürükleme geri-al geçmişinde N adıma bölünürdü.
 *
 * 4. Sürükleme sırasında yalnız YEREL bir dizi güncellenir; manifest ancak
 *    parmak kalkınca yazılır. Böylece her piksel hareketinde araca önizleme
 *    manifesti gönderilmez (araç WebView'i gereksiz yere yeniden boyamaz).
 */

import { memo, useCallback, useRef, useState } from 'react';

export interface ZoneReorderItem {
  id: string;
  label: string;
  locked?: boolean;
}

interface Props {
  items: readonly ZoneReorderItem[];
  /** Parmak kalkınca YENİ sıra (yalnız gerçekten değiştiyse çağrılır). */
  onCommit: (orderedIds: string[]) => void;
}

export const ZoneReorder = memo(function ZoneReorder({ items, onCommit }: Props) {
  /** Sürükleme sırasındaki geçici sıra; `null` = sürükleme yok (kaynak: props). */
  const [taslak, setTaslak] = useState<ZoneReorderItem[] | null>(null);
  const [aktifId, setAktifId] = useState<string | null>(null);
  const satirRef = useRef<Map<string, HTMLDivElement>>(new Map());
  /** Sürükleme başlarkenki sıra — değişmediyse hiç yazmamak için. */
  const baslangicRef = useRef<string[]>([]);

  const gosterilen = taslak ?? [...items];

  const kaydet = useCallback((el: HTMLDivElement | null, id: string) => {
    if (el) satirRef.current.set(id, el);
    else satirRef.current.delete(id);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    baslangicRef.current = items.map((x) => x.id);
    setTaslak([...items]);
    setAktifId(id);
  }, [items]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!aktifId) return;
    const y = e.clientY;
    setTaslak((onceki) => {
      if (!onceki) return onceki;
      const suAn = onceki.findIndex((x) => x.id === aktifId);
      if (suAn < 0) return onceki;

      /* Hedef indeks, DİĞER satırların gerçek ekran kutularından hesaplanır —
         sabit satır yüksekliği VARSAYILMAZ (etiketler sarabilir ve satırlar
         farklı yükseklikte olabilir). */
      let hedef = suAn;
      for (let i = 0; i < onceki.length; i++) {
        if (i === suAn) continue;
        const el = satirRef.current.get(onceki[i].id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const orta = r.top + r.height / 2;
        if (i < suAn && y < orta) { hedef = i; break; }
        if (i > suAn && y > orta) { hedef = i; }
      }
      if (hedef === suAn) return onceki;

      const next = [...onceki];
      const [tasinan] = next.splice(suAn, 1);
      next.splice(hedef, 0, tasinan);
      return next;
    });
  }, [aktifId]);

  const bitir = useCallback(() => {
    if (!aktifId) return;
    const son = (taslak ?? []).map((x) => x.id);
    setAktifId(null);
    setTaslak(null);
    /* Sıra değişmediyse HİÇ yazma: gereksiz geri-al adımı ve araca gereksiz
       manifest gönderimi olmasın. */
    const onceki = baslangicRef.current;
    if (son.length !== onceki.length || son.some((id, i) => id !== onceki[i])) {
      onCommit(son);
    }
  }, [aktifId, taslak, onCommit]);

  return (
    <div className="flex flex-col gap-1">
      {gosterilen.map((it, i) => {
        const suruklenen = it.id === aktifId;
        return (
          <div
            key={it.id}
            ref={(el) => kaydet(el, it.id)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5"
            style={{
              background: suruklenen ? 'rgba(96,165,250,0.18)' : 'var(--pwa-surface)',
              border: `1px solid ${suruklenen ? 'rgba(96,165,250,0.45)' : 'var(--pwa-border)'}`,
              /* Sürüklenen satır hafifçe kalkar — parmağın neyi taşıdığı belli olsun. */
              transform: suruklenen ? 'scale(1.02)' : undefined,
              transition: suruklenen ? 'none' : 'background 120ms ease',
            }}
          >
            <button
              type="button"
              aria-label={`${it.label} sırasını değiştir`}
              onPointerDown={(e) => onPointerDown(e, it.id)}
              onPointerMove={onPointerMove}
              onPointerUp={bitir}
              onPointerCancel={bitir}
              className="flex-shrink-0 rounded-md"
              style={{
                /* Dokunma hedefi 44 px — araç içi/eldeki telefonda güvenilir. */
                width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: 'none', color: 'var(--pwa-text-3)',
                cursor: 'grab', fontSize: 15,
                /* Parmak hareketi sayfayı KAYDIRMASIN — yoksa sürükleme yerine
                   panel scroll olur ve özellik dokunmatikte kullanılamaz. */
                touchAction: 'none',
              }}
            >
              ⠿
            </button>
            <span className="text-[10px] font-black tabular-nums w-4 text-center"
              style={{ color: 'var(--pwa-text-3)' }}>{i + 1}</span>
            <span className="text-[11px] font-semibold flex-1 min-w-0 truncate"
              style={{ color: 'var(--pwa-text-2)' }}>
              {it.label}{it.locked ? ' 🔒' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
});
