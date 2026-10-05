import { useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useEditMode } from "../../lib/edit-mode";
import "./content.css";

function SortableItem({
  id,
  children,
  enabled,
}: {
  id: string;
  children: (handle: ReactNode) => ReactNode;
  enabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !enabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 5 : undefined,
    opacity: isDragging ? 0.6 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="sortable-item">
      {children(
        enabled ? (
          <button
            type="button"
            className="sort-handle"
            aria-label="Drag to arrange; Space to pick up, arrows to move, Escape to cancel"
            {...attributes}
            {...listeners}
            onClick={(event) => event.stopPropagation()}
          >
            <GripVertical size={15} />
          </button>
        ) : null,
      )}
    </div>
  );
}
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  children,
  className = "",
  horizontal = false,
  label,
}: {
  items: T[];
  onReorder: (ids: string[]) => Promise<void>;
  children: (item: T, handle: ReactNode) => ReactNode;
  className?: string;
  horizontal?: boolean;
  label?: string;
}) {
  const { editing } = useEditMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const visible = optimistic
    ? optimistic
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is T => !!item)
    : items;
  async function finish({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || busy) return;
    const ids = items.map((item) => item.id);
    const next = arrayMove(
      ids,
      ids.indexOf(String(active.id)),
      ids.indexOf(String(over.id)),
    );
    setOptimistic(next);
    setBusy(true);
    setError("");
    try {
      await onReorder(next);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Order could not be saved. Previous order restored.",
      );
    } finally {
      setOptimistic(null);
      setBusy(false);
    }
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => void finish(event)}
    >
      <SortableContext
        items={visible.map((item) => item.id)}
        strategy={
          horizontal
            ? horizontalListSortingStrategy
            : verticalListSortingStrategy
        }
      >
        <div
          className={className}
          aria-busy={busy}
          role={horizontal ? "tablist" : undefined}
          aria-label={label}
        >
          {visible.map((item) => (
            <SortableItem key={item.id} id={item.id} enabled={editing && !busy}>
              {(handle) => children(item, handle)}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
      {error && (
        <p role="alert" className="content-save-error">
          {error}
        </p>
      )}
    </DndContext>
  );
}
