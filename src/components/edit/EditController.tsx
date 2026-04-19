/**
 * Edit Controller
 * Tüm [data-editable] elementlere global uzun-basma tespiti yapar.
 * Store değişince CSS'i otomatik enjekte eder.
 * Kilitliyken hiçbir şey açılmaz.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useEditStore } from '../../store/useEditStore';
import { generateAndInjectStyles } from '../../platform/editStyleEngine';
import { EditPanel } from './EditPanel';

const LONG_PRESS_MS = 650;
const MOVE_THRESHOLD = 10; // px

interface Props {
  children: ReactNode;
}

export function EditController({ children }: Props) {
  const { locked, editingId, setEditing, elements, globalTypes } = useEditStore();
  const lockedRef  = useRef(locked);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedRef   = useRef(false);
  const startRef   = useRef({ x: 0, y: 0 });

  // Ref'i güncel tut (stale closure önlemi)
  useEffect(() => { lockedRef.current = locked; }, [locked]);

  // ── CSS Enjeksiyonu — store her değiştiğinde ──
  useEffect(() => {
    generateAndInjectStyles(elements, globalTypes);
  }, [elements, globalTypes]);

  // ── Global uzun-basma tespiti (event delegation) ──
  useEffect(() => {
    const cancel = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };

    const onDown = (e: PointerEvent) => {
      if (lockedRef.current) return;
      const target = e.target as Element | null;
      if (!target) return;

      // Edit panelinin kendisine uzun basma → yok say
      if (target.closest('[data-edit-panel]')) return;

      const el = target.closest('[data-editable]');
      if (!el) return;
      const id = el.getAttribute('data-editable');
      if (!id) return;

      movedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };

      cancel();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (!movedRef.current) {
          setEditing(id);
        }
      }, LONG_PRESS_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (!timerRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
        movedRef.current = true;
        cancel();
      }
    };

    document.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerup', cancel,   { passive: true });
    document.addEventListener('pointercancel', cancel);

    return () => {
      cancel();
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointercancel', cancel);
    };
  }, [setEditing]);

  return (
    <>
      {children}
      {editingId && !locked && (
        <div data-edit-panel>
          <EditPanel
            elementId={editingId}
            onClose={() => setEditing(null)}
          />
        </div>
      )}
    </>
  );
}


