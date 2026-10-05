import { useLocation } from "react-router-dom";

export function BrandArrow() {
  const location = useLocation();
  const value = Number(
    new URLSearchParams(location.search).get("arrow-colour-change-page") || 3,
  );
  const duration =
    Number.isFinite(value) && value > 0
      ? Math.min(60, Math.max(0.5, value))
      : 3;
  return (
    <span
      className="brand-arrow"
      style={{ animationDuration: `${duration * 4}s` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M5 19 19 5M6 5h13v13"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
    </span>
  );
}
