import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  FileText,
  Compass,
  MessagesSquare,
  Home,
  LogOut,
  Menu,
  Settings2,
  X,
} from "lucide-react";
import { GitHubIcon as Github } from "../components/GitHubIcon";
import { field } from "../../shared/model";
import { Button, EmptyState } from "../components/ui";
import { jsonRequest, request } from "../lib/api";
import { useWorkspace } from "../lib/workspace";
import { EditModeProvider, useEditMode } from "../lib/edit-mode";
import { EditNavigation } from "./EditNavigation";
import { TodayPage } from "../features/home/TodayPage";
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

const NAV = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/learn", label: "Learn", icon: BookOpen },
  { to: "/applications", label: "Applications", icon: BriefcaseBusiness },
  { to: "/interviews", label: "Interviews", icon: MessagesSquare },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/direction", label: "Your Direction", icon: Compass },
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
        w<span>↗</span>
      </div>
      <p>Loading…</p>
    </div>
  );
}

function Login() {
  const { openDemo, configured, error } = useWorkspace();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failureMessage, setFailureMessage] = useState("");
  const login = async () => {
    setBusy(true);
    setFailureMessage("");
    try {
      const response = await request<{ url: string }>(
        "/api/auth/sign-in/social",
        jsonRequest("POST", {
          provider: "github",
          callbackURL: `${window.location.origin}/home`,
        }),
      );
      if (!response.url) throw new Error("Sign-in is unavailable.");
      window.location.assign(response.url);
    } catch (failure) {
      setFailureMessage(
        failure instanceof Error ? failure.message : "Could not start sign-in.",
      );
      setBusy(false);
    }
  };
  return (
    <main className="work-signin-page">
      <Link to="/" className="brand signin-brand" aria-label="Work">
        <span className="brand-word">
          work<span>↗</span>
        </span>
      </Link>
      <section className="signin-card">
        <div className="signin-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>↗</span>
        </div>
        <h1>Sign in</h1>
        <Button disabled={!configured || busy} onClick={() => void login()}>
          <Github size={18} />
          {busy ? "Opening GitHub…" : "Sign in with GitHub"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            openDemo();
            navigate("/home");
          }}
        >
          Open demo
          <ArrowRight size={17} />
        </Button>
        {!configured && (
          <p className="field-hint">
            Sign-in is unavailable in this environment. You can open the demo.
          </p>
        )}
        {(failureMessage || error) && (
          <p className="notice notice-warning" role="alert">
            {failureMessage || error}
          </p>
        )}
      </section>
    </main>
  );
}

function AccountMenu({ className = "" }: { className?: string }) {
  const { user, mode, signOut, notify } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const firstFocus = useRef<"first" | "last">("first");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const location = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const items =
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[firstFocus.current === "last" ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const name =
    mode === "demo" ? "Demo" : user?.name || user?.email || "Account";
  return (
    <div
      ref={root}
      className={`account-control ${className}`}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="account-trigger"
        aria-label={`Account: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          firstFocus.current = "first";
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            firstFocus.current = event.key === "ArrowUp" ? "last" : "first";
            setOpen(true);
          }
          if (event.key === "Escape") close();
        }}
      >
        <span className="account-avatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">{name}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          className="account-menu"
          role="menu"
          aria-label="Account"
          onKeyDown={(event) => {
            const items = [
              ...(menu.current?.querySelectorAll<HTMLElement>(
                '[role="menuitem"]',
              ) ?? []),
            ];
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          {user?.email && mode !== "demo" && (
            <p className="account-email" role="presentation">
              {user.email}
            </p>
          )}
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)}>
            <Settings2 size={16} />
            Settings
          </Link>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void signOut().catch((failure) => {
                notify(
                  failure instanceof Error
                    ? failure.message
                    : "Could not sign out.",
                  "error",
                );
                setBusy(false);
                close();
              });
            }}
          >
            <LogOut size={16} />
            {busy
              ? "Signing out…"
              : mode === "demo"
                ? "Leave demo"
                : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { editing, section, toggleSection } = useEditMode();
  const { pending, error, toasts, dismissToast } = useWorkspace();
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
              work<span>↗</span>
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
          <p className="edit-mode-hint">
            Hold a section to edit.
          </p>
          <AccountMenu />
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
            work<span>↗</span>
          </Link>
          <AccountMenu className="mobile-account" />
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
          {pending > 0 && (
            <Link className="pending-changes" to="/settings#device-drafts">
              {pending} unsynced change{pending === 1 ? "" : "s"}. Review in
              Settings
              <ArrowRight size={13} />
            </Link>
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

function Redirect({ to }: { to: string }) {
  const location = useLocation();
  const target = new URL(to, window.location.origin);
  for (const [key, value] of new URLSearchParams(location.search))
    target.searchParams.set(key, value);
  return (
    <Navigate
      replace
      to={`${target.pathname}${target.search}${location.hash}`}
    />
  );
}

function LegacyRedirect({ kind }: { kind: string }) {
  const location = useLocation();
  const source = new URLSearchParams(location.search);
  const params = new URLSearchParams({ legacy: kind });
  const record =
    source.get("record") ||
    source.get("selected") ||
    location.pathname.split("/").filter(Boolean)[1];
  if (record) params.set("record", record);
  return <Navigate replace to={`/settings?${params.toString()}#recovery`} />;
}

function PracticeRedirect() {
  const location = useLocation();
  const { records } = useWorkspace();
  const source = new URLSearchParams(location.search);
  const requested =
    source.get("problem") || source.get("record") || source.get("selected");
  const record = records.find((item) => item.id === requested);
  const slug = record
    ? field(record, "problemSlug") || field(record, "problemId")
    : requested;
  if (record && !slug) return <LegacyRedirect kind="practice" />;
  const params = new URLSearchParams({ view: "roadmap" });
  if (slug) params.set("problem", slug);
  return <Navigate replace to={`/learn?${params.toString()}`} />;
}

export default function App() {
  const { user, loading } = useWorkspace();
  if (loading) return <Loading />;
  if (!user) return <Login />;
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
        <Route path="today" element={<Redirect to="/home" />} />
        <Route path="assets" element={<Redirect to="/documents" />} />
        <Route path="focus" element={<Redirect to="/learn" />} />
        <Route path="practice" element={<PracticeRedirect />} />
        <Route path="interviews" element={<InterviewsPage />} />
        <Route path="direction" element={<DirectionPage />} />
        <Route path="career/*" element={<Redirect to="/direction" />} />
        <Route
          path="companies/*"
          element={<Redirect to="/applications?tab=radar" />}
        />
        {[
          "notes",
          "resources",
          "network",
          "evidence",
          "projects",
          "review",
          "connectors",
        ].map((kind) => (
          <Route
            key={kind}
            path={`${kind}/*`}
            element={<LegacyRedirect kind={kind} />}
          />
        ))}
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
