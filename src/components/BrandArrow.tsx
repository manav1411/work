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
          d="M5 23 20 5M12.5 5H20v7.5"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
