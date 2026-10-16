import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BrandArrow } from "../components/BrandArrow";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Check,
  CircleUserRound,
  FileText,
  Compass,
  MessagesSquare,
  Home,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { Button, EmptyState } from "../components/ui";
import { useWorkspace } from "../lib/workspace";
import { displayName } from "../lib/display-name";
import { EditModeProvider, useEditMode } from "../lib/edit-mode";
import { EditNavigation } from "./EditNavigation";
import { TodayPage } from "../features/home/TodayPage";
import { AuthPage } from "../features/auth/AuthPage";
import "./shell.css";

const LearnPage = lazy(() =>
  import("../features/prepare/LearnPage").then((module) => ({
    default: module.LearnPage,
  })),
);
const ApplicationsPage = lazy(() =>
  import("../features/search/ApplicationsPage").then((module) => ({
    default: module.ApplicationsPage,
  })),
);
const AssetsPage = lazy(() =>
  import("../features/assets/AssetsPage").then((module) => ({
    default: module.AssetsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

const InterviewsPage = lazy(() =>
  import("../features/interviews/InterviewsPage").then((module) => ({
    default: module.InterviewsPage,
  })),
);
const DirectionPage = lazy(() =>
  import("../features/direction/DirectionPage").then((module) => ({
    default: module.DirectionPage,
  })),
);

function LegacyDirectionRedirect() {
  const location = useLocation();
  const old = new URLSearchParams(location.search);
  const next = new URLSearchParams();
  if (old.get("record")) next.set("goal", old.get("record")!);
  if (old.get("goal")) next.set("action", old.get("goal")!);
  return (
    <Navigate
      replace
      to={`/goals${next.size ? `?${next}` : ""}${location.hash}`}
    />
  );
}

const NAV = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/learn", label: "Learn", icon: BookOpen },
  { to: "/applications", label: "Applications", icon: BriefcaseBusiness },
  { to: "/interviews", label: "Interviews", icon: MessagesSquare },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/goals", label: "Goals", icon: Compass },
];

class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <EmptyState
        title="This page could not load"
        description="Reload to retry. Saved records remain available."
        action={
          <Button onClick={() => window.location.reload()}>
            Reload
            <ArrowRight size={16} />
          </Button>
        }
      />
    ) : (
      this.props.children
    );
  }
}

function Loading() {
  return (
    <div className="loading-state" role="status">
      <div className="work-symbol">
        w<BrandArrow />
      </div>
      <p>Loading…</p>
    </div>
  );
}

function AccountControls({ className = "" }: { className?: string }) {
  const { user, mode, preferences, signOut, notify } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setConfirming(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!confirming) return;
    const timeout = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [confirming]);
  const name = mode === "demo" ? "Demo" : displayName(preferences, user);
  return (
    <div
      className={`account-control ${className}`}
      role="group"
      aria-label="Account and settings"
    >
      <button
        className={`account-trigger ${confirming ? "account-confirming" : ""}`}
        type="button"
        aria-label={
          confirming ? "Log out?" : `Account: ${name}. Show log out option`
        }
        title={confirming ? "Log out?" : name}
        disabled={busy}
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          setBusy(true);
          void signOut().catch((failure) => {
            notify(
              failure instanceof Error
                ? failure.message
                : "Could not sign out.",
              "error",
            );
            setBusy(false);
            setConfirming(false);
          });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && confirming) {
            event.preventDefault();
            setConfirming(false);
          }
        }}
      >
        {confirming ? (
          <LogOut size={18} aria-hidden="true" />
        ) : (
          <CircleUserRound size={18} aria-hidden="true" />
        )}
        <span className="account-trigger-label">
          {confirming ? "Log out?" : name}
        </span>
      </button>
      <Link
        className="settings-trigger"
        to="/settings"
        aria-label="Settings"
        title="Settings"
        onClick={() => setConfirming(false)}
      >
        <Settings size={20} />
      </Link>
    </div>
  );
}

function Shell() {
  const { editing, section, toggleSection } = useEditMode();
  const { pending, syncIssues, error, toasts, dismissToast } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  const sidebar = useRef<HTMLElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const navigationOrigin = useRef<HTMLButtonElement | null>(null);
  const location = useLocation();
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const resize = () => {
      setMobileViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      [
        ...(sidebar.current?.querySelectorAll<HTMLElement>(
          'a, button:not([disabled]), [tabindex="0"]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length);
    focusables()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
      }
      if (event.key === "Tab") {
        const items = focusables();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      requestAnimationFrame(() =>
        (navigationOrigin.current ?? menuTrigger.current)?.focus(),
      );
    };
  }, [mobileOpen]);
  return (
    <div className="workspace-shell simple-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {mobileOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id="primary-sidebar"
        className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen || undefined}
        aria-label="Navigation"
        aria-hidden={(mobileViewport && !mobileOpen) || undefined}
        inert={(mobileViewport && !mobileOpen) || undefined}
      >
        <div className="sidebar-brand-row">
          <Link to="/home" className="brand" aria-label="Work home">
            <span className="brand-word">
              work
              <BrandArrow />
            </span>
          </Link>
          <button
            className="simple-nav-close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          {NAV.map((item) => (
            <EditNavigation to={item.to} key={item.to} label={item.label}>
              <item.icon size={19} strokeWidth={1.8} />
              <span>{item.label}</span>
            </EditNavigation>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p className="edit-mode-hint">Hold a section to edit.</p>
          <AccountControls />
        </div>
      </aside>
      <div className="workspace-main" inert={mobileOpen || undefined}>
        <header className="simple-mobile-header">
          <button
            ref={menuTrigger}
            className="simple-menu-trigger"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            aria-controls="primary-sidebar"
            onClick={(event) => {
              navigationOrigin.current = event.currentTarget;
              setMobileOpen(true);
            }}
          >
            <Menu size={22} />
          </button>
          <Link to="/home" className="mobile-work-brand" aria-label="Work home">
            work
            <BrandArrow />
          </Link>
          <AccountControls className="mobile-account" />
        </header>
        <main id="main-content" className="page-container">
          {editing && (
            <div className="edit-mode-banner" role="status">
              <span>
                Editing {NAV.find((item) => item.to === section)?.label}
              </span>
              <button onClick={() => toggleSection(section)}>
                Done editing
              </button>
            </div>
          )}
          {syncIssues.length > 0 ? (
            <Link className="pending-changes" to="/settings#device-drafts">
              {syncIssues.length} change
              {syncIssues.length === 1 ? " needs" : "s need"} review
              <ArrowRight size={13} />
            </Link>
          ) : (
            pending > 0 && (
              <span className="pending-changes" role="status">
                Changes saved on this device · syncing automatically
              </span>
            )
          )}
          {error && (
            <div className="notice notice-warning" role="alert">
              {error}
            </div>
          )}
          <PageBoundary key={location.pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </PageBoundary>
        </main>
      </div>
      <nav
        className="mobile-nav"
        aria-label="Mobile navigation"
        inert={mobileOpen || undefined}
      >
        {NAV.slice(0, 3).map((item) => (
          <EditNavigation to={item.to} label={item.label} mobile key={item.to}>
            <item.icon size={19} />
            {item.label}
          </EditNavigation>
        ))}
        <button
          aria-label="More navigation"
          aria-expanded={mobileOpen}
          onClick={(event) => {
            navigationOrigin.current = event.currentTarget;
            setMobileOpen(true);
          }}
        >
          <Menu size={19} />
          More
        </button>
      </nav>
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            <span>
              {toast.tone === "error" ? (
                "!"
              ) : toast.tone === "success" ? (
                <Check size={17} />
              ) : (
                "i"
              )}
            </span>
            <p>{toast.message}</p>
            <button
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading, mode } = useWorkspace();
  const { pathname } = useLocation();
  if (loading) return <Loading />;
  if (
    !user ||
    ["/forgot-password", "/reset-password"].includes(pathname) ||
    (mode === "demo" &&
      ["/sign-in", "/sign-up", "/verify-email"].includes(pathname))
  )
    return <AuthPage />;
  if (["/sign-in", "/sign-up", "/verify-email"].includes(pathname))
    return <Navigate to="/home" replace />;
  return (
    <Routes>
      <Route
        element={
          <EditModeProvider>
            <Shell />
          </EditModeProvider>
        }
      >
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<TodayPage />} />
        <Route path="learn" element={<LearnPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="documents" element={<AssetsPage />} />
        <Route path="settings/*" element={<SettingsPage />} />
        <Route path="interviews" element={<InterviewsPage />} />
        <Route path="goals" element={<DirectionPage />} />
        <Route path="direction" element={<LegacyDirectionRedirect />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="Page not found"
              action={
                <Link className="button button-primary" to="/home">
                  Home
                  <ArrowRight size={17} />
                </Link>
              }
            />
          }
        />
      </Route>
    </Routes>
  );
}
