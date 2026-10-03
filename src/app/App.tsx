import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Code2,
  Command,
  Compass,
  FileText,
  Folder,
  Home,
  Lightbulb,
  Menu,
  MessageSquare,
  NotebookPen,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { GitHubIcon as Github } from "../components/GitHubIcon";
import { KIND_LABELS, recordUrl, type RecordKind } from "../../shared/model";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  RecordLinks,
  Select,
  Textarea,
} from "../components/ui";
import { jsonRequest, request } from "../lib/api";
import { useWorkspace } from "../lib/workspace";
import { TodayPage } from "../features/home/TodayPage";
import { FocusPage } from "../features/home/FocusPage";

const NotesPage = lazy(() =>
  import("../features/notes/NotesPage").then((module) => ({
    default: module.NotesPage,
  })),
);
const LearnPage = lazy(() =>
  import("../features/prepare/LearnPage").then((module) => ({
    default: module.LearnPage,
  })),
);
const PracticePage = lazy(() =>
  import("../features/prepare/PracticePage").then((module) => ({
    default: module.PracticePage,
  })),
);
const InterviewsPage = lazy(() =>
  import("../features/prepare/InterviewsPage").then((module) => ({
    default: module.InterviewsPage,
  })),
);
const ResourcesPage = lazy(() =>
  import("../features/prepare/ResourcesPage").then((module) => ({
    default: module.ResourcesPage,
  })),
);
const CompaniesPage = lazy(() =>
  import("../features/search/CompaniesPage").then((module) => ({
    default: module.CompaniesPage,
  })),
);
const ApplicationsPage = lazy(() =>
  import("../features/search/ApplicationsPage").then((module) => ({
    default: module.ApplicationsPage,
  })),
);
const NetworkPage = lazy(() =>
  import("../features/search/NetworkPage").then((module) => ({
    default: module.NetworkPage,
  })),
);
const AssetsPage = lazy(() =>
  import("../features/assets/AssetsPage").then((module) => ({
    default: module.AssetsPage,
  })),
);
const CareerPage = lazy(() =>
  import("../features/career/CareerPage").then((module) => ({
    default: module.CareerPage,
  })),
);
const EvidencePage = lazy(() =>
  import("../features/career/EvidencePage").then((module) => ({
    default: module.EvidencePage,
  })),
);
const ProjectsPage = lazy(() =>
  import("../features/career/ProjectsPage").then((module) => ({
    default: module.ProjectsPage,
  })),
);
const ReviewPage = lazy(() =>
  import("../features/career/ReviewPage").then((module) => ({
    default: module.ReviewPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

const NAV = [
  {
    label: "",
    items: [
      { to: "/today", label: "Today", icon: Home },
      { to: "/focus", label: "Focus", icon: Sparkles },
    ],
  },
  {
    label: "GET READY",
    items: [
      { to: "/learn", label: "Learn", icon: BookOpen },
      { to: "/practice", label: "Practice", icon: Code2 },
      { to: "/interviews", label: "Interviews", icon: MessageSquare },
    ],
  },
  {
    label: "MAKE YOUR MOVE",
    items: [
      { to: "/companies", label: "Companies", icon: Compass },
      { to: "/applications", label: "Applications", icon: BriefcaseBusiness },
      { to: "/network", label: "Your people", icon: Users },
    ],
  },
  {
    label: "BUILD YOUR STORY",
    items: [
      { to: "/career", label: "Your direction", icon: ArrowUpRight },
      { to: "/evidence", label: "Work evidence", icon: Lightbulb },
      { to: "/projects", label: "Projects", icon: Folder },
      { to: "/assets", label: "Career assets", icon: FileText },
    ],
  },
  {
    label: "KEEP IT TOGETHER",
    items: [
      { to: "/notes", label: "Notes", icon: NotebookPen },
      { to: "/resources", label: "Resources", icon: BookOpen },
      { to: "/review", label: "Weekly review", icon: CalendarDays },
    ],
  },
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
        title="This page needs a fresh start"
        description="Your saved workspace is safe. Reload to return to it."
        action={
          <Button onClick={() => location.reload()}>
            Reload workspace
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
    <div className="loading-state">
      <div className="work-symbol">
        w<span>↗</span>
      </div>
      <p>Making room for your next move…</p>
    </div>
  );
}

function Login() {
  const { openDemo, configured, error, notify } = useWorkspace();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const login = async () => {
    setBusy(true);
    try {
      const response = await request<{ url: string }>(
        "/api/auth/sign-in/social",
        jsonRequest("POST", {
          provider: "github",
          callbackURL: `${location.origin}/today`,
        }),
      );
      if (!response.url) throw new Error("Sign-in is not ready yet.");
      location.assign(response.url);
    } catch (failure) {
      notify(
        failure instanceof Error ? failure.message : "Could not start sign-in.",
        "error",
      );
      setBusy(false);
    }
  };
  return (
    <main className="login-page">
      <header>
        <Link to="/" className="brand brand-light">
          <span className="brand-word">
            work<span>↗</span>
          </span>
          <span className="brand-tag">MAKE YOUR NEXT MOVE</span>
        </Link>
        <Badge tone="lime">YOUR CAREER, YOUR WAY</Badge>
      </header>
      <section className="login-layout">
        <div className="login-intro">
          <p className="eyebrow">A LITTLE MOMENTUM. A BIGGER CHAPTER.</p>
          <h1>
            Good things
            <br />
            take <span>work</span>
            <i>.</i>
          </h1>
          <p>
            Your ideas, interview prep, applications, and the work you're proud
            of. Finally, in one place.
          </p>
          <div className="login-actions">
            <Button disabled={!configured || busy} onClick={() => void login()}>
              <Github size={18} />
              {busy ? "Opening GitHub…" : "Your private workspace"}
              <ArrowRight size={19} />
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                openDemo();
                navigate("/today");
              }}
            >
              Take a look around
              <ArrowUpRight size={18} />
            </Button>
          </div>
          {!configured && (
            <p className="login-setup-note">
              Private sign-in is being set up. The preview is ready to explore.
            </p>
          )}
          {error && <p className="notice notice-warning">{error}</p>}
          <div className="login-promise">
            <Check size={15} />
            Private by default<span>•</span>
            <Check size={15} />
            Made for real progress
          </div>
        </div>
        <div className="login-art" aria-hidden="true">
          <div className="art-note">
            <span>ONE USEFUL THING</span>
            <strong>
              What's your
              <br />
              next move?
            </strong>
            <div>
              <i />
              Write a first sentence
            </div>
            <div>
              <i />
              Make a little progress
            </div>
            <div>
              <i />
              Pick it up tomorrow
            </div>
            <b>↗</b>
          </div>
          <div className="art-sticker">
            LET'S
            <br />
            GO<span>✳</span>
          </div>
          <div className="art-label">
            less scattered.
            <br />
            <strong>more started.</strong>
          </div>
          <span className="art-plus">+</span>
          <span className="art-cross">✳</span>
        </div>
      </section>
      <footer>
        Made for the next chapter.<span>Learning · Doing · Becoming</span>
      </footer>
    </main>
  );
}

function Shell() {
  const {
    user,
    mode,
    records,
    pending,
    error,
    preferences,
    toasts,
    dismissToast,
  } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        setCaptureOpen(true);
      }
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const current = NAV.flatMap((group) => group.items).find((item) =>
    location.pathname.startsWith(item.to),
  );
  const actionCount = records.filter(
    (record) => record.kind === "action" && record.data.status !== "done",
  ).length;
  return (
    <div className="workspace-shell">
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
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <Link to="/today" className="brand">
          <span className="brand-word">
            work<span>↗</span>
          </span>
          <span className="brand-tag">MAKE YOUR NEXT MOVE</span>
        </Link>
        <div className="sidebar-space">
          <span className="space-avatar">
            {(preferences.displayName || user?.name || "M")[0].toUpperCase()}
          </span>
          <div>
            <strong>{preferences.displayName || user?.name}'s workspace</strong>
            <small>
              {mode === "demo"
                ? "Preview · just this tab"
                : "A little more you, every day"}
            </small>
          </div>
          <ChevronDown size={14} />
        </div>
        <nav aria-label="Main navigation">
          {NAV.map((group) => (
            <div className="nav-group" key={group.label}>
              {group.label && <p>{group.label}</p>}
              {group.items.map((item) => (
                <NavLink
                  to={item.to}
                  key={item.to}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? "nav-link-active" : ""}`
                  }
                >
                  <item.icon size={18} strokeWidth={1.7} />
                  <span>{item.label}</span>
                  {item.to === "/today" && actionCount > 0 && (
                    <span className="nav-count">{actionCount}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="sidebar-capture"
            onClick={() => setCaptureOpen(true)}
          >
            <Plus size={17} />
            <span>Catch a thought</span>
            <kbd>C</kbd>
          </button>
          <NavLink to="/settings" className="nav-link">
            <Settings2 size={17} />
            <span>Make it yours</span>
          </NavLink>
          <div className="sidebar-sync">
            <span className="status-dot" />
            {mode === "demo"
              ? "Preview workspace"
              : pending
                ? `${pending} change${pending === 1 ? "" : "s"} to sync`
                : "Your work, kept safe"}
            <Cloud size={14} />
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="topbar-breadcrumb">
            <Button
              variant="ghost"
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={21} />
            </Button>
            <span>YOUR WORKSPACE</span>
            <ChevronRight size={13} />
            <strong>{current?.label ?? "Settings"}</strong>
          </div>
          <button
            className="global-search-trigger"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={16} />
            <span>Find a thought, a plan, a next step…</span>
            <kbd>
              <Command size={11} />K
            </kbd>
          </button>
          <button
            className="topbar-capture"
            aria-label="Quick capture"
            onClick={() => setCaptureOpen(true)}
          >
            <Plus size={17} />
          </button>
        </header>
        {mode === "demo" && (
          <div className="demo-banner">
            <Sparkles size={15} />
            <span>
              Preview workspace. Sample records and edits stay in this tab.
            </span>
            <button
              onClick={() => {
                sessionStorage.removeItem("work-demo-active");
                locationReload();
              }}
            >
              Your private workspace
              <ArrowRight size={13} />
            </button>
          </div>
        )}
        <main id="main-content" className="page-container">
          {error && <div className="notice notice-warning">{error}</div>}
          <PageBoundary key={location.pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </PageBoundary>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <NavLink to="/today">
          <Home size={19} />
          Today
        </NavLink>
        <button onClick={() => setCaptureOpen(true)}>
          <Plus size={20} />
          Capture
        </button>
        <button onClick={() => setSearchOpen(true)}>
          <Search size={19} />
          Find
        </button>
        <button onClick={() => setMobileOpen(true)}>
          <Menu size={20} />
          More
        </button>
      </nav>
      <QuickCapture open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone}`} key={toast.id}>
            <span>
              {toast.tone === "error" ? (
                "!"
              ) : toast.tone === "success" ? (
                <Check size={17} />
              ) : (
                <Cloud size={17} />
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

function locationReload() {
  window.location.assign("/");
}

function QuickCapture({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { create, notify } = useWorkspace();
  const [kind, setKind] = useState<RecordKind>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const save = async (andOpen = false) => {
    if (!title.trim() && !body.trim()) return;
    setBusy(true);
    try {
      const data =
        kind === "action"
          ? {
              status: "todo",
              firstStep: body,
              estimatedMinutes: 15,
              priority: "normal",
            }
          : kind === "achievement"
            ? { verified: false }
            : kind === "resource"
              ? { url: body.trim(), category: "Saved link" }
              : { collection: "Inbox" };
      const record = await create({
        kind,
        title: title.trim() || body.trim().split("\n")[0].slice(0, 100),
        body,
        links,
        data,
      });
      setTitle("");
      setBody("");
      setLinks([]);
      onClose();
      notify("Caught. You can organise it later.");
      if (andOpen) navigate(recordUrl(record));
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not capture this.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catch it before it goes"
      description="A thought, an action, a small win. Put it down; sort it later."
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="capture-types">
          {[
            { value: "note", icon: NotebookPen, label: "Thought" },
            { value: "action", icon: Check, label: "Next step" },
            { value: "achievement", icon: Lightbulb, label: "Work win" },
            { value: "resource", icon: BookOpen, label: "Link" },
          ].map((item) => (
            <button
              type="button"
              className={kind === item.value ? "active" : ""}
              key={item.value}
              onClick={() => setKind(item.value as RecordKind)}
            >
              <item.icon size={17} />
              {item.label}
            </button>
          ))}
        </div>
        <Field label="Give it a name">
          <Input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              kind === "action"
                ? "One useful thing I could do…"
                : "A thought worth keeping…"
            }
          />
        </Field>
        <Field label={kind === "resource" ? "URL" : "Put it down"}>
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            placeholder={
              kind === "achievement"
                ? "What happened? What did you contribute?"
                : "No need to make it perfect."
            }
          />
        </Field>
        <RecordLinks value={links} onChange={setLinks} />
        <div className="modal-actions">
          <Button
            variant="secondary"
            type="button"
            disabled={busy || (!title.trim() && !body.trim())}
            onClick={() => void save(true)}
          >
            Save & open
            <ArrowUpRight size={15} />
          </Button>
          <Button
            type="submit"
            disabled={busy || (!title.trim() && !body.trim())}
          >
            {busy ? "Saving…" : "Keep this"}
            <Check size={16} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function GlobalSearch({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { records, notify } = useWorkspace();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [results, setResults] = useState(records);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (!query.trim())
        setResults(
          records
            .slice()
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 20),
        );
      else
        void request<{ records: typeof records }>(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        )
          .then((response) => setResults(response.records))
          .catch((error) => {
            if (!controller.signal.aborted) notify(String(error), "error");
          });
    }, 200);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query, records, notify]);
  const filtered = results.filter(
    (record) => kind === "all" || record.kind === kind,
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Find your thread"
      description="Search across notes, opportunities, preparation, and work evidence."
      size="wide"
    >
      <div className="stack">
        <div className="toolbar">
          <div className="input-with-icon grow">
            <Search size={18} />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search workspace"
              placeholder="A company, a concept, a note…"
            />
          </div>
          <Select
            aria-label="Filter search by type"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="all">Everything</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="search-results">
          {filtered.slice(0, 40).map((record) => (
            <button
              className="search-result"
              key={record.id}
              onClick={() => {
                onClose();
                navigate(recordUrl(record));
              }}
            >
              <span className="search-result-kind">
                {KIND_LABELS[record.kind]}
              </span>
              <span>
                <strong>{record.title}</strong>
                <small>
                  {record.body.replace(/[#*_`]/g, "").slice(0, 120)}
                </small>
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
          {filtered.length === 0 && (
            <EmptyState
              title="No thread yet"
              description="Try another term or capture something new."
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function App() {
  const { user, loading } = useWorkspace();
  if (loading) return <Loading />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/today" replace />} />
        <Route path="today" element={<TodayPage />} />
        <Route path="focus" element={<FocusPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="learn" element={<LearnPage />} />
        <Route path="practice" element={<PracticePage />} />
        <Route path="interviews" element={<InterviewsPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="network" element={<NetworkPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="career" element={<CareerPage />} />
        <Route path="evidence" element={<EvidencePage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="settings/*" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="That page wandered off"
              description="You can always return to your next move."
              action={
                <Link className="button button-primary" to="/today">
                  Back to Today
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
