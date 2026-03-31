import { memo, useRef, useCallback, type ReactNode, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';

interface Props {
  id:          string;
  editMode:    boolean;
  dragId:      string | null;
  dropId:      string | null;
  onDragStart: (id: string) => void;
  onDragOver:  (id: string) => void;
  onDrop:      () => void;
  children:    ReactNode;
  className?:  string;
}

export const DraggableWidget = memo(function DraggableWidget({
  id, editMode, dragId, dropId, onDragStart, onDragOver, onDrop, children, className = '',
}: Props) {
  const holdTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging  = dragId === id;
  const isDropTarget = dropId === id && dragId !== null && dragId !== id;

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!editMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    holdTimer.current = setTimeout(() => { onDragStart(id); }, 350);
  }, [editMode, id, onDragStart]);

  const handlePointerUp = useCallback(() => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    onDrop();
  }, [onDrop]);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (dragId === null || dragId === id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
      onDragOver(id);
    }
  }, [dragId, id, onDragOver]);

  return (
    <div
      className={`relative flex min-h-0 transition-all duration-200 ${
        isDragging   ? 'opacity-50 scale-[0.98]' : ''
      } ${
        isDropTarget ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-transparent rounded-[2.5rem]' : ''
      } ${className}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerCancel={handlePointerUp}
    >
      {children}
      {editMode && (
        <div className="absolute top-3 left-3 z-50 bg-black/60 backdrop-blur-sm rounded-xl p-1.5 text-slate-400">
          <GripVertical className="w-4 h-4" />
        </div>
      )}
    </div>
  );
});
