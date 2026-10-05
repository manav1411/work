import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEditMode } from "../lib/edit-mode";

/** Delay visual feedback so a normal navigation click never starts the fill. */
const FEEDBACK_DELAY = 250;
const HOLD_DURATION = 3000;

export function EditNavigation({
  to,
  label,
  children,
  mobile = false,
}: {
  to: string;
  label: string;
  children: ReactNode;
  mobile?: boolean;
}) {
  const { isEditing, toggleSection } = useEditMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [holding, setHolding] = useState(false);
  const feedback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const complete = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    clearTimeout(feedback.current);
    clearTimeout(complete.current);
    feedback.current = undefined;
    complete.current = undefined;
    origin.current = null;
    setHolding(false);
  };
  useEffect(
    () => () => {
      clearTimeout(feedback.current);
      clearTimeout(complete.current);
    },
    [],
  );
  const start = () => {
    if (complete.current) return;
    suppressClick.current = false;
    feedback.current = setTimeout(() => setHolding(true), FEEDBACK_DELAY);
    complete.current = setTimeout(() => {
      suppressClick.current = true;
      cancel();
      toggleSection(to);
      if (location.pathname !== to) navigate(to);
    }, HOLD_DURATION);
  };
  return (
    <NavLink
      to={to}
      title={`Hold for 3 seconds to ${isEditing(to) ? "finish editing" : "edit"} ${label}. Keyboard: hold Space.`}
      aria-label={label}
      data-editing={isEditing(to) || undefined}
      className={({ isActive }) =>
        `edit-navigation ${mobile ? "" : "nav-link"} ${isActive ? (mobile ? "active" : "nav-link-active") : ""} ${holding ? "nav-holding" : ""}`
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        origin.current = { x: event.clientX, y: event.clientY };
        start();
      }}
      onPointerMove={(event) => {
        if (
          origin.current &&
          Math.hypot(
            event.clientX - origin.current.x,
            event.clientY - origin.current.y,
          ) > 10
        )
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onBlur={cancel}
      onContextMenu={(event) => {
        if (holding || suppressClick.current) event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === " ") {
          event.preventDefault();
          if (!event.repeat) start();
        }
        if (event.key === "Escape") cancel();
      }}
      onKeyUp={(event) => {
        if (event.key === " ") {
          event.preventDefault();
          cancel();
          suppressClick.current = false;
        }
      }}
      onClick={(event) => {
        cancel();
        if (suppressClick.current) {
          event.preventDefault();
          suppressClick.current = false;
        }
      }}
    >
      {children}
      {isEditing(to) && <span className="nav-edit-dot" aria-hidden="true" />}
    </NavLink>
  );
}
