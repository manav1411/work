import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  Flag,
  Pause,
  Play,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import {
  defaultRadarConfig,
  jobSchema,
  type Opportunity,
  type RadarConfig,
  type RadarProfile,
  type RadarSettings,
  type RadarSource,
} from "../../../shared/radar";
import { field, niceDate } from "../../../shared/model";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
} from "../../components/ui";
import { EmployerLogo } from "../../components/EmployerLogo";
import { companyInitials } from "../../../shared/company-logos";
import { radarPublisherLinks } from "../../../shared/radar-publishers";
import { useWorkspace } from "../../lib/workspace";
import { useEditMode } from "../../lib/edit-mode";
import { getAttachmentUrl, jsonRequest, request } from "../../lib/api";
import { NoteInput } from "../content/NoteInput";
import { errorMessage } from "./domain";
import "./radar.css";

type Settings = RadarSettings & {
  nextRunAt?: string | null;
  nextEmailAt?: string | null;
  deliveries?: { id: string; status: string; created_at: string }[];
};
const initialFilters = {
  q: "",
  sort: "interest",
  flagged: "",
  unread: "",
  country: "",
  workplace: "",
  source: "",
  profile: "",
  salary: "",
  qualification: "",
  scored: "",
  minInterest: "",
  confidence: "",
  location: "",
  currency: "",
  period: "year",
  closed: "",
  minSalary: "",
  maxSalary: "",
  postedAfter: "",
  discoveredAfter: "",
  closingBefore: "",
  employmentType: "",
  seniority: "",
  view: "",
};
const actors = [
  "parsebird/linkedin-jobs-scraper",
  "saswave/seek-scraper",
  "automation-lab/indeed-scraper",
];
const split = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
function salaryLabel(job: Opportunity) {
  const s = job.salary;
  return !s
    ? "Salary not listed"
    : s.text ||
        `${s.currency || "Currency unknown"} ${s.min?.toLocaleString() ?? "?"}–${s.max?.toLocaleString() ?? "?"} / ${s.period}`;
}
export function RadarView({
  view,
  onApplication,
  refreshKey = 0,
  setupRequest = 0,
}: {
  view: "radar" | "interested";
  onApplication: (job: Opportunity) => void;
  refreshKey?: number;
  setupRequest?: number;
}) {
  const { user, preferences } = useWorkspace(),
    { editing } = useEditMode();
  const [settings, setSettings] = useState<Settings>();
  const [jobs, setJobs] = useState<Opportunity[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [filters, setFilters] = useState<typeof initialFilters>(() => {
    try {
      return {
        ...initialFilters,
        ...JSON.parse(
          sessionStorage.getItem(`work:radar-view:${user?.id}:${view}`) || "{}",
        ),
      };
    } catch {
      return initialFilters;
    }
  });
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [preferencesOpen, setPreferencesOpen] = useState(false),
    [captureOpen, setCaptureOpen] = useState(false),
    [preview, setPreview] = useState<Opportunity[] | null>(null);
  const [merging, setMerging] = useState<{
    from: Opportunity;
    target: Opportunity;
  } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (setupRequest) setPreferencesOpen(true);
  }, [setupRequest]);
  const load = useCallback(
    async (append = false, cursor?: string) => {
      const stamp = ++generation.current;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters))
        if (value) params.set(key, String(value));
      params.set("view", filters.view || view);
      if (cursor) params.set("cursor", cursor);
      try {
        const [result, status] = await Promise.all([
          request<{ opportunities: Opportunity[]; nextCursor: string | null }>(
            `/api/radar/opportunities?${params}`,
          ),
          request<Settings>("/api/radar/settings"),
        ]);
        if (stamp !== generation.current) return;
        setJobs((old) =>
          append
            ? [
                ...old,
                ...result.opportunities.filter(
                  (j) => !old.some((o) => o.id === j.id),
                ),
              ]
            : result.opportunities,
        );
        setNext(result.nextCursor);
        setSettings(status);
        setError("");
      } catch (failure) {
        if (stamp === generation.current) setError(errorMessage(failure));
      } finally {
        if (stamp === generation.current) setLoading(false);
      }
    },
    [filters, view],
  );
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [load, refreshKey]);
  const running = settings?.runs.some(
    (r) => r.status === "queued" || r.status === "running",
  );
  useEffect(() => {
    if (!running) return;
    const run = settings?.runs.find(
      (r) => r.status === "queued" || r.status === "running",
    );
    const timer = setInterval(() => {
      if (run)
        void request(
          `/api/radar/runs/${run.id}/advance`,
          jsonRequest("POST", {}),
        ).catch(() => undefined);
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [running, load, settings?.runs]);
  useEffect(() => {
    sessionStorage.setItem(
      `work:radar-view:${user?.id}:${view}`,
      JSON.stringify(filters),
    );
  }, [filters, user?.id, view]);
  const change = (key: keyof typeof filters, value: string) =>
    setFilters((old) => ({ ...old, [key]: value }));
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const state = (job: Opportunity, patch: Record<string, unknown>) =>
    action(() =>
      request(
        `/api/radar/opportunities/${job.id}/state`,
        jsonRequest("PATCH", { version: job.version, ...patch }),
      ),
    );
  async function toggleFlag(job: Opportunity) {
    setBusy(true);
    setError("");
    setJobs((old) =>
      old.map((j) => (j.id === job.id ? { ...j, flagged: !job.flagged } : j)),
    );
    try {
      await request(
        `/api/radar/opportunities/${job.id}/state`,
        jsonRequest("PATCH", { version: job.version, flagged: !job.flagged }),
      );
      await load();
    } catch (failure) {
      setJobs((old) =>
        old.map((j) => (j.id === job.id ? { ...j, flagged: job.flagged } : j)),
      );
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    if (!settings?.version) {
      setPreferencesOpen(true);
      return;
    }
    await action(() =>
      request(
        "/api/radar/settings",
        jsonRequest("PUT", {
          version: settings.version,
          config: { ...settings.config, enabled: !settings.config.enabled },
        }),
      ),
    );
  }
  return (
    <section
      className="radar-feature"
      aria-label={
        view === "radar" ? "Radar opportunities" : "Saved opportunities"
      }
    >
      {(view === "interested" || editing) && (
        <div className="radar-toolbar">
          {view === "interested" && (
            <div>
              <h2>
                <Bookmark size={20} />
                Saved opportunities
              </h2>
              <p className="muted">Specific roles you want to come back to.</p>
            </div>
          )}
          <div className="inline-actions">
            {editing && (
              <Button variant="secondary" onClick={() => setCaptureOpen(true)}>
                <Plus size={15} />
                Save opportunity
              </Button>
            )}
            {view === "radar" && editing && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setPreferencesOpen(true)}
                >
                  <Settings2 size={16} />
                  Preferences
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void toggle()}
                >
                  {settings?.config.enabled ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}{" "}
                  {settings?.config.enabled ? "Pause Radar" : "Enable Radar"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {view === "radar" && settings && (
        <div className="radar-status-bar">
          <Badge tone={settings.config.enabled ? "lime" : "muted"}>
            {settings.config.enabled ? "Radar on" : "Automation paused"}
          </Badge>
          {running && <span role="status">Searching…</span>}
          <span>Email: {settings.config.emailFrequency}</span>
          {settings.nextRunAt && (
            <span>
              Next search{" "}
              {new Date(settings.nextRunAt).toLocaleString("en-AU", {
                timeZone: settings.config.timezone,
              })}
            </span>
          )}
          {settings.runs[0] && (
            <span>
              Last run: {settings.runs[0].status} · {settings.runs[0].found} new
              · {settings.runs[0].scored} assessed
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() =>
              void action(async () =>
                setPreview(
                  (
                    await request<{ opportunities: Opportunity[] }>(
                      "/api/radar/digests/preview",
                      jsonRequest("POST", {}),
                    )
                  ).opportunities,
                ),
              )
            }
          >
            Preview email
          </Button>
        </div>
      )}
      <div className="radar-filter-bar">
        <Input
          aria-label="Search opportunities"
          placeholder="Search company, role, or description…"
          value={filters.q}
          onChange={(e) => change("q", e.target.value)}
        />
        <Select
          aria-label="Sort opportunities"
          value={filters.sort}
          onChange={(e) => change("sort", e.target.value)}
        >
          {Object.entries({
            interest: "Predicted interest",
            newest: "Newest discovered",
            posted: "Newest posted",
            qualification: "Qualification fit",
            confidence: "Assessment confidence",
            closing: "Closing date",
            salary: "Salary (selected currency)",
            company: "Company A–Z",
            role: "Role A–Z",
          }).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className="opportunity-flag radar-flag-filter"
          aria-label="Show flagged opportunities"
          title={
            filters.flagged
              ? "Show all opportunities"
              : "Show flagged opportunities"
          }
          aria-pressed={!!filters.flagged}
          onClick={() => change("flagged", filters.flagged ? "" : "true")}
        >
          <Flag
            size={23}
            fill={filters.flagged ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
        <details className="radar-filter-details">
          <summary>All filters</summary>
          <div className="radar-filter-grid">
            <Field label="Profile">
              <Select
                value={filters.profile}
                onChange={(e) => change("profile", e.target.value)}
              >
                <option value="">All profiles</option>
                {settings?.config.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Country">
              <Select
                value={filters.country}
                onChange={(e) => change("country", e.target.value)}
              >
                <option value="">All countries</option>
                <option value="au">Australia</option>
                <option value="us">United States</option>
                <option value="gb">United Kingdom</option>
                <option value="nz">New Zealand</option>
                <option value="ca">Canada</option>
              </Select>
            </Field>
            <Field label="Location">
              <Input
                value={filters.location}
                onChange={(e) => change("location", e.target.value)}
                placeholder="City or region"
              />
            </Field>
            <Field label="Workplace">
              <Select
                value={filters.workplace}
                onChange={(e) => change("workplace", e.target.value)}
              >
                <option value="">Any workplace</option>
                {["remote", "hybrid", "onsite", "unknown"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="Listing source">
              <Select
                value={filters.source}
                onChange={(e) => change("source", e.target.value)}
              >
                <option value="">All sources</option>
                {[
                  "LinkedIn",
                  "Indeed",
                  "SEEK",
                  "jsearch",
                  "apify",
                  "greenhouse",
                  "lever",
                  "ashby",
                  "manual",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="Salary disclosure">
              <Select
                value={filters.salary}
                onChange={(e) => change("salary", e.target.value)}
              >
                <option value="">Include undisclosed</option>
                <option value="listed">Salary provided</option>
                <option value="unknown">Salary unknown</option>
              </Select>
            </Field>
            <Field label="Salary currency">
              <Select
                value={filters.currency}
                onChange={(e) => change("currency", e.target.value)}
              >
                <option value="">Any currency</option>
                {["AUD", "USD", "GBP", "CAD", "NZD"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="Salary period">
              <Select
                value={filters.period}
                onChange={(e) => change("period", e.target.value)}
              >
                {["year", "month", "week", "day", "hour"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="Qualification fit">
              <Select
                value={filters.qualification}
                onChange={(e) => change("qualification", e.target.value)}
              >
                <option value="">All, including unknown</option>
                <option value="unknown">Unknown</option>
                <option value="50">50+ rubric score</option>
                <option value="75">75+ rubric score</option>
              </Select>
            </Field>
            <Field label="Assessment">
              <Select
                value={filters.scored}
                onChange={(e) => change("scored", e.target.value)}
              >
                <option value="">Scored and unscored</option>
                <option value="yes">Assessed</option>
                <option value="no">Awaiting assessment</option>
              </Select>
            </Field>
            <Field label="Minimum interest">
              <Select
                value={filters.minInterest}
                onChange={(e) => change("minInterest", e.target.value)}
              >
                <option value="">Any interest</option>
                {[25, 50, 75].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </Select>
            </Field>
            <Field label="Minimum confidence">
              <Select
                value={filters.confidence}
                onChange={(e) => change("confidence", e.target.value)}
              >
                <option value="">Any confidence</option>
                <option value="0.5">50%</option>
                <option value="0.8">80%</option>
              </Select>
            </Field>
            <Field label="Read state">
              <Select
                value={filters.unread}
                onChange={(e) => change("unread", e.target.value)}
              >
                <option value="">Read and unread</option>
                <option value="true">Unread</option>
              </Select>
            </Field>
            <Field label="View">
              <Select
                value={filters.view}
                onChange={(e) => change("view", e.target.value)}
              >
                <option value="">
                  {view === "radar" ? "Radar" : "Saved opportunities"}
                </option>
                <option value="dismissed">Dismissed</option>
                <option value="tracked">Tracked in Applications</option>
                <option value="all">All opportunities</option>
              </Select>
            </Field>
            <Field label="Minimum listed salary">
              <Input
                type="number"
                min={0}
                value={filters.minSalary}
                onChange={(e) => change("minSalary", e.target.value)}
                placeholder="Unknown pay stays included"
              />
            </Field>
            <p className="muted">
              Salary bounds use the selected currency and period, with AUD as
              the default currency. Missing facts and estimated pay stay
              included.
            </p>
            <Field label="Maximum listed salary">
              <Input
                type="number"
                min={0}
                value={filters.maxSalary}
                onChange={(e) => change("maxSalary", e.target.value)}
              />
            </Field>
            <Field label="Posted on or after">
              <Input
                type="date"
                value={filters.postedAfter}
                onChange={(e) => change("postedAfter", e.target.value)}
              />
            </Field>
            <Field label="Discovered on or after">
              <Input
                type="date"
                value={filters.discoveredAfter}
                onChange={(e) => change("discoveredAfter", e.target.value)}
              />
            </Field>
            <Field label="Closing on or before">
              <Input
                type="date"
                value={filters.closingBefore}
                onChange={(e) => change("closingBefore", e.target.value)}
              />
            </Field>
            <Field label="Employment type">
              <Input
                value={filters.employmentType}
                onChange={(e) => change("employmentType", e.target.value)}
                placeholder="Full-time, contract…"
              />
            </Field>
            <Field label="Seniority">
              <Input
                value={filters.seniority}
                onChange={(e) => change("seniority", e.target.value)}
                placeholder="Junior, graduate…"
              />
            </Field>
            <label className="radar-checkbox">
              <input
                type="checkbox"
                checked={filters.closed === "true"}
                onChange={(e) =>
                  change("closed", e.target.checked ? "true" : "")
                }
              />
              Include closed listings
            </label>
            <Button variant="ghost" onClick={() => setFilters(initialFilters)}>
              Reset filters
            </Button>
          </div>
        </details>
      </div>
      {loading && !jobs.length ? (
        <p className="muted" role="status">
          Loading opportunities…
        </p>
      ) : !jobs.length ? (
        <EmptyState
          title={
            view === "radar"
              ? "A little curiosity goes a long way"
              : "No saved opportunities yet"
          }
          description={
            view === "radar"
              ? "Set your preferences and run Radar. Undisclosed salaries and uncertain fits stay in consideration."
              : "Save a role from Radar, or add a listing link yourself."
          }
          action={
            editing && view === "radar" ? (
              <Button onClick={() => setPreferencesOpen(true)}>
                Set up Radar
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="opportunity-grid">
          {jobs.map((job) => (
            <Card className="opportunity-card" key={job.id}>
              <div className="opportunity-card-header">
                <div className="opportunity-employer">
                  <EmployerLogo
                    name={job.company}
                    fallback={
                      <span className="opportunity-initials" aria-hidden="true">
                        {companyInitials(job.company)}
                      </span>
                    }
                  />
                  <span>{job.company}</span>
                </div>
                <div className="opportunity-listing-actions">
                  <button
                    type="button"
                    className="opportunity-flag"
                    aria-label={`${job.flagged ? "Unflag" : "Flag"} ${job.title}`}
                    aria-pressed={job.flagged}
                    title={
                      job.flagged ? "Unflag opportunity" : "Flag opportunity"
                    }
                    disabled={busy}
                    onClick={() => void toggleFlag(job)}
                  >
                    <Flag
                      size={17}
                      fill={job.flagged ? "currentColor" : "none"}
                      aria-hidden="true"
                    />
                  </button>
                  <a
                    className="radar-careers-button application-destination external-link"
                    href={job.sources[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Listing <ArrowUpRight size={15} />
                  </a>
                </div>
              </div>
              <h3>{job.title}</h3>
              <p className="opportunity-location">
                {job.locations.join(" · ") || "Location not listed"}
                {job.workplace !== "unknown" ? ` · ${job.workplace}` : ""}
              </p>
              <p className="opportunity-salary">
                {salaryLabel(job)}
                {job.salary?.estimated && <Badge>Estimate</Badge>}
              </p>
              <div className="opportunity-signals">
                <div>
                  <span>Interest</span>
                  <strong>
                    {job.assessment
                      ? `${Math.round(job.assessment.interest)}/100`
                      : "Pending"}
                  </strong>
                </div>
                <div>
                  <span>Qualification fit</span>
                  <strong>
                    {job.assessment?.qualification == null
                      ? "Unknown"
                      : `${Math.round(job.assessment.qualification)}/100`}
                  </strong>
                </div>
                <div>
                  <span>Confidence</span>
                  <strong>
                    {job.assessment
                      ? `${Math.round(job.assessment.confidence * 100)}%`
                      : "—"}
                  </strong>
                </div>
              </div>
              {job.assessment && (
                <p className="opportunity-match">
                  {job.assessment.reason}
                  {job.assessment.feasibility !== "compatible"
                    ? " Location or eligibility needs checking."
                    : ""}
                </p>
              )}
              <div className="opportunity-labels">
                {job.saved && <Badge tone="lime">Saved</Badge>}
                {job.tracked && <Badge tone="blue">In Applications</Badge>}
                {job.assessment?.information !== "enough" && (
                  <Badge>Limited information</Badge>
                )}
                {job.closed && <Badge>Closed</Badge>}
                {job.employmentType && <Badge>{job.employmentType}</Badge>}
              </div>
              <details
                className="opportunity-details"
                onToggle={(e) => {
                  if (e.currentTarget.open && !job.seen && editing)
                    void state(job, { seen: true });
                }}
              >
                <summary>Description & match details</summary>
                <div className="opportunity-description">
                  {job.description ||
                    "The source did not provide a description. Open the listing for details."}
                </div>
                <p className="muted">
                  Found {niceDate(job.firstSeenAt, preferences.timezone)}
                  {job.postedAt
                    ? ` · Posted ${niceDate(job.postedAt, preferences.timezone)}`
                    : ""}
                  {job.closingDate
                    ? ` · Closes ${niceDate(job.closingDate)}`
                    : ""}
                </p>
                {job.assessment && (
                  <small className="muted">
                    Matched {job.assessment.profileName} ·{" "}
                    {job.assessment.model}. Scores describe rubric fit, not
                    hiring probability.
                  </small>
                )}
                <div className="opportunity-source-list">
                  {job.sources.map((s, i) => (
                    <a
                      key={`${s.url}:${i}`}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {s.publisher}{" "}
                      <span className="muted">via {s.provider}</span>{" "}
                      <ArrowUpRight size={12} />
                    </a>
                  ))}
                </div>
                {job.notes && <p>{job.notes}</p>}
                {editing && jobs.length > 1 && (
                  <Select
                    aria-label={`Combine duplicate ${job.title}`}
                    value=""
                    onChange={(e) => {
                      const target = jobs.find((j) => j.id === e.target.value);
                      if (target) setMerging({ from: job, target });
                    }}
                  >
                    <option value="">
                      Combine with another advertisement…
                    </option>
                    {jobs
                      .filter((j) => j.id !== job.id)
                      .map((j) => (
                        <option value={j.id} key={j.id}>
                          {j.company} · {j.title}
                        </option>
                      ))}
                  </Select>
                )}
              </details>
              <div className="opportunity-footer">
                <nav
                  className="opportunity-publishers"
                  aria-label={`Listing sites for ${job.title}`}
                >
                  {radarPublisherLinks(job.sources).map((publisher) => (
                    <a
                      key={publisher.key}
                      className="opportunity-publisher"
                      href={publisher.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${publisher.name} listing`}
                      aria-label={`${publisher.name} listing for ${job.title}`}
                    >
                      <EmployerLogo name={publisher.name} />
                    </a>
                  ))}
                </nav>
                {editing && (
                  <div className="inline-actions">
                    <Button
                      variant="ghost"
                      aria-label={`${job.saved ? "Unsave" : "Save"} ${job.title}`}
                      disabled={busy}
                      onClick={() => void state(job, { saved: !job.saved })}
                    >
                      <Bookmark
                        size={16}
                        fill={job.saved ? "currentColor" : "none"}
                      />
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onApplication(job)}
                    >
                      {job.applicationId
                        ? "Open application"
                        : "Add application"}
                    </Button>
                    {job.dismissed || (job.tracked && !job.applicationId) ? (
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void state(job, {
                            dismissed: false,
                            restore: !job.applicationId,
                          })
                        }
                      >
                        Restore
                      </Button>
                    ) : (
                      !job.tracked && (
                        <Button
                          variant="ghost"
                          aria-label={`Dismiss ${job.title}`}
                          disabled={busy}
                          onClick={() => void state(job, { dismissed: true })}
                        >
                          <X size={16} />
                        </Button>
                      )
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {next && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void load(true, next)}
        >
          Load more opportunities
        </Button>
      )}
      {view === "radar" && settings && (
        <details className="radar-activity">
          <summary>Sources, usage & recent activity</summary>
          <p className="muted">
            JSearch requests and Apify reserved dollars stay inside free
            allowances. JEV uses your capped existing balance. Uncertain
            requests retain their reservation.
          </p>
          <div className="inline-actions">
            {Object.entries(settings.providers).map(([name, configured]) => (
              <Badge key={name} tone={configured ? "lime" : "muted"}>
                {name}: {configured ? "configured" : "not configured"}
              </Badge>
            ))}
          </div>
          {settings.usage.map((u) => (
            <p key={u.provider}>
              {u.provider}: {u.units.toFixed(u.provider === "jsearch" ? 0 : 4)}{" "}
              / {u.limit}{" "}
              {u.provider === "jsearch" ? "requests" : "USD reserved/used"} ·{" "}
              {u.period}
            </p>
          ))}
          {settings.runs.map((run) => (
            <div key={run.id} className="radar-run">
              <strong>{run.status}</strong> ·{" "}
              {niceDate(run.createdAt, preferences.timezone)} · {run.found} new
              · {run.scored} assessed
              {run.messages.map((message, i) => (
                <p key={i}>{message}</p>
              ))}
            </div>
          ))}
          {settings.deliveries?.map((d) => (
            <p key={d.id}>
              Email {d.status} · {niceDate(d.created_at, preferences.timezone)}
              {editing && ["failed", "uncertain"].includes(d.status) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      request(
                        `/api/radar/digests/${d.id}/retry`,
                        jsonRequest("POST", {}),
                      ),
                    )
                  }
                >
                  Retry same delivery
                </Button>
              )}
            </p>
          ))}
        </details>
      )}
      <Modal
        title="Radar preferences"
        size="wide"
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
      >
        {preferencesOpen && (
          <RadarPreferences
            settings={settings}
            onSaved={() => {
              setPreferencesOpen(false);
              void load();
            }}
          />
        )}
      </Modal>
      <Modal
        title="Combine duplicate listings"
        open={!!merging}
        onClose={() => setMerging(null)}
      >
        {merging && (
          <div className="stack">
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <p>
              Combine {merging.from.company} · {merging.from.title} with{" "}
              {merging.target.company} · {merging.target.title}?
            </p>
            <p>
              Only combine advertisements for the same vacancy. Source links,
              flags, saved state, and application tracking will be kept.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await request(
                    `/api/radar/opportunities/${merging.from.id}/merge`,
                    jsonRequest("POST", {
                      targetId: merging.target.id,
                      version: merging.from.version,
                      targetVersion: merging.target.version,
                    }),
                  );
                  setMerging(null);
                })
              }
            >
              Combine listings
            </Button>
          </div>
        )}
      </Modal>
      <Modal
        title="Save an opportunity"
        size="wide"
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
      >
        {captureOpen && (
          <CaptureOpportunity
            onSaved={() => {
              setCaptureOpen(false);
              void load();
            }}
          />
        )}
      </Modal>
      <Modal
        title="Your next Radar email"
        size="wide"
        open={preview !== null}
        onClose={() => setPreview(null)}
      >
        {preview !== null && (
          <div className="stack">
            <p>
              {preview.length
                ? `${preview.length} new opportunities ready for a digest.`
                : "No unsent opportunities match your current preferences."}
            </p>
            {preview.map((j) => (
              <div key={j.id}>
                <strong>{j.title}</strong>
                <p>
                  {j.company} · {j.locations.join(" · ")}
                </p>
              </div>
            ))}
            {editing && (
              <Button
                disabled={
                  busy ||
                  !preview.length ||
                  !settings?.emailConfigured ||
                  !settings.config.enabled
                }
                onClick={() =>
                  void action(async () => {
                    await request(
                      "/api/radar/digests/send",
                      jsonRequest("POST", {}),
                    );
                    setPreview(null);
                  })
                }
              >
                Email new results now
              </Button>
            )}
            {!settings?.emailConfigured && (
              <p className="muted">
                The private sender needs configuration before email can be
                enabled.
              </p>
            )}
          </div>
        )}
      </Modal>
      <span className="sr-only" aria-live="polite">
        {busy ? "Saving Radar changes" : ""}
      </span>
    </section>
  );
}
function RadarPreferences({
  settings,
  onSaved,
}: {
  settings?: Settings;
  onSaved: () => void;
}) {
  const { records, preferences } = useWorkspace();
  const [config, setConfig] = useState<RadarConfig>(() =>
    structuredClone(
      settings?.config || defaultRadarConfig(preferences.timezone),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selectedResume, setSelectedResume] = useState(config.resumeId);
  const resumeRef = useRef<HTMLTextAreaElement>(null);
  function patch<T extends keyof RadarConfig>(key: T, value: RadarConfig[T]) {
    setConfig((old) => ({ ...old, [key]: value }));
  }
  function profile(index: number, value: Partial<RadarProfile>) {
    patch(
      "profiles",
      config.profiles.map((p, i) => (i === index ? { ...p, ...value } : p)),
    );
  }
  function source(index: number, value: Partial<RadarSource>) {
    patch(
      "sources",
      config.sources.map((s, i) => (i === index ? { ...s, ...value } : s)),
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(
        "/api/radar/settings",
        jsonRequest("PUT", { config, version: settings?.version || 0 }),
      );
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function importResume() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{
        project?: {
          latestSuccessfulJob?: { textAttachmentId?: string };
          latestJob?: { textAttachmentId?: string };
        };
      }>(`/api/latex/${selectedResume}`);
      const textId =
        result.project?.latestSuccessfulJob?.textAttachmentId ||
        result.project?.latestJob?.textAttachmentId;
      if (!textId)
        throw new Error(
          "This document has no extracted text yet. Compile the resume in Documents, or paste its text below.",
        );
      const response = await fetch(await getAttachmentUrl(textId), {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error("Resume text is unavailable. Paste its text below.");
      const text = await response.text();
      if (text.length > 60000)
        throw new Error(
          "Resume text exceeds 60,000 characters. Paste the relevant sections below.",
        );
      setConfig((old) => ({
        ...old,
        resumeId: selectedResume,
        resumeText: text,
        resumeImportedAt: new Date().toISOString(),
      }));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const companies = records.filter((r) => r.kind === "company"),
    resumes = records.filter(
      (r) => r.kind === "asset" && field(r, "type") === "resume",
    );
  function watchCompany(companyId: string) {
    const company = companies.find((c) => c.id === companyId);
    if (!company) return;
    const url = field(company, "careersUrl");
    const type = /greenhouse\.io/.test(url)
      ? "greenhouse"
      : /lever\.co/.test(url)
        ? "lever"
        : /ashbyhq\.com/.test(url)
          ? "ashby"
          : null;
    if (!type) {
      setError(
        "This careers page needs a custom connector. Its link stays available in Interested; you can save individual listings manually.",
      );
      return;
    }
    patch("sources", [
      ...config.sources,
      {
        id: crypto.randomUUID(),
        type,
        name: company.title,
        url,
        companyId: company.id,
        actor: "",
        enabled: true,
      },
    ]);
  }
  return (
    <form className="stack radar-preferences" onSubmit={(e) => void save(e)}>
      <div className="radar-preference-section">
        <h3>Automation & email</h3>
        <label className="radar-checkbox">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => patch("enabled", e.target.checked)}
          />
          Enable scheduled Radar discovery
        </label>
        <div className="form-grid">
          <Field label="Discovery frequency">
            <Select
              value={config.discoveryFrequency}
              onChange={(e) =>
                patch(
                  "discoveryFrequency",
                  e.target.value as RadarConfig["discoveryFrequency"],
                )
              }
            >
              {["daily", "weekly", "monthly", "disabled"].map((v) => (
                <option key={v} value={v}>
                  {v === "disabled" ? "Manual only" : v}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Email frequency"
            hint="Independent from discovery. Monthly email can accompany daily collection."
          >
            <Select
              value={config.emailFrequency}
              onChange={(e) =>
                patch(
                  "emailFrequency",
                  e.target.value as RadarConfig["emailFrequency"],
                )
              }
            >
              {["disabled", "daily", "weekly", "monthly"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Local delivery time">
            <Input
              type="time"
              value={config.emailTime}
              onChange={(e) => patch("emailTime", e.target.value)}
            />
          </Field>
          <Field label="Timezone">
            <Input
              value={config.timezone}
              onChange={(e) => patch("timezone", e.target.value)}
            />
          </Field>
          <Field label="Weekly day">
            <Select
              value={config.emailWeekday}
              onChange={(e) => patch("emailWeekday", Number(e.target.value))}
            >
              {[
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
              ].map((v, i) => (
                <option key={v} value={i}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Monthly day">
            <Input
              type="number"
              min={1}
              max={31}
              value={config.emailMonthday}
              onChange={(e) => patch("emailMonthday", Number(e.target.value))}
            />
          </Field>
        </div>
        <p className="muted">
          Pausing keeps your opportunities. Hold the Radar tab for 3 seconds to
          search now, even while paused. A ping never emails automatically.
        </p>
      </div>
      <div className="radar-preference-section">
        <h3>About you</h3>
        <p className="muted">
          Your experience, qualifications, work rights and anything else JEV
          should know. For example, your graduate role or stated E3 eligibility.
        </p>
        <NoteInput
          aria-label="About you"
          value={config.aboutYou}
          maxLength={30000}
          onChange={(e) => patch("aboutYou", e.target.value)}
          rows={5}
        />
        <div className="inline-actions">
          <Select
            aria-label="Resume from Documents"
            value={selectedResume}
            onChange={(e) => setSelectedResume(e.target.value)}
          >
            <option value="">Choose a resume from Documents</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !selectedResume}
            onClick={() => void importResume()}
          >
            Use resume from Documents
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => resumeRef.current?.focus()}
          >
            Paste resume text
          </Button>
        </div>
        <textarea
          ref={resumeRef}
          className="input textarea"
          aria-label="Resume text"
          rows={7}
          value={config.resumeText}
          maxLength={60000}
          onChange={(e) => patch("resumeText", e.target.value)}
          placeholder="Paste or import resume text here. You can edit it before saving."
        />
        {config.resumeImportedAt && (
          <small className="muted">
            Imported {niceDate(config.resumeImportedAt)}. This is an editable
            snapshot; document changes are not imported automatically.
          </small>
        )}
      </div>
      <div className="radar-preference-section">
        <h3>Search profiles</h3>
        <p className="muted">
          Profiles are alternatives: a role can match any enabled profile.
          Missing salary stays eligible.
        </p>
        {config.profiles.map((p, i) => (
          <details className="radar-profile" key={p.id} open={i === 0}>
            <summary>
              {p.name || "New profile"}
              {!p.enabled ? " · paused" : ""}
            </summary>
            <div className="stack">
              <div className="form-grid">
                <Field label="Profile name">
                  <Input
                    value={p.name}
                    onChange={(e) => profile(i, { name: e.target.value })}
                  />
                </Field>
                <Field label="Priority">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={p.priority}
                    onChange={(e) =>
                      profile(i, { priority: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
              <label className="radar-checkbox">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => profile(i, { enabled: e.target.checked })}
                />
                Search this profile
              </label>
              <div className="form-grid">
                {(
                  [
                    ["titles", "Role titles"],
                    ["keywords", "Alternative keywords"],
                    ["requiredKeywords", "Required keywords (all)"],
                    ["exclude", "Excluded title words"],
                    ["locations", "Cities or regions"],
                    ["preferredCompanies", "Preferred companies"],
                    ["employmentTypes", "Employment types"],
                  ] as const
                ).map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    hint="Separate entries with commas."
                  >
                    <Input
                      defaultValue={p[key].join(", ")}
                      onBlur={(e) =>
                        profile(i, { [key]: split(e.target.value) })
                      }
                    />
                  </Field>
                ))}
                <Field label="Country">
                  <Select
                    value={p.country}
                    onChange={(e) =>
                      profile(i, {
                        country: e.target.value as RadarProfile["country"],
                      })
                    }
                  >
                    {[
                      ["au", "Australia"],
                      ["us", "United States"],
                      ["gb", "United Kingdom"],
                      ["nz", "New Zealand"],
                      ["ca", "Canada"],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="inline-actions">
                {(["onsite", "hybrid", "remote"] as const).map((v) => (
                  <label className="radar-checkbox" key={v}>
                    <input
                      type="checkbox"
                      checked={p.workplace.includes(v)}
                      onChange={(e) =>
                        profile(i, {
                          workplace: e.target.checked
                            ? [...p.workplace, v]
                            : p.workplace.filter((w) => w !== v),
                        })
                      }
                    />
                    {v}
                  </label>
                ))}
                <small className="muted">
                  None selected means any workplace. Unknown remote eligibility
                  is retained.
                </small>
              </div>
              <div className="form-grid">
                <Field label="Salary minimum">
                  <Input
                    type="number"
                    min={0}
                    placeholder="No minimum"
                    value={p.salaryMin ?? ""}
                    onChange={(e) =>
                      profile(i, {
                        salaryMin: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                  />
                </Field>
                <Field label="Salary maximum">
                  <Input
                    type="number"
                    min={0}
                    placeholder="No maximum"
                    value={p.salaryMax ?? ""}
                    onChange={(e) =>
                      profile(i, {
                        salaryMax: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                  />
                </Field>
                <Field label="Currency">
                  <Select
                    value={p.currency}
                    onChange={(e) =>
                      profile(i, {
                        currency: e.target.value as RadarProfile["currency"],
                      })
                    }
                  >
                    {["AUD", "USD", "GBP", "NZD", "CAD"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Pay period">
                  <Select
                    value={p.salaryPeriod}
                    onChange={(e) =>
                      profile(i, {
                        salaryPeriod: e.target
                          .value as RadarProfile["salaryPeriod"],
                      })
                    }
                  >
                    {["year", "month", "week", "day", "hour"].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="What you're looking for / context">
                <NoteInput
                  value={p.context}
                  maxLength={8000}
                  onChange={(e) => profile(i, { context: e.target.value })}
                  rows={4}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  patch(
                    "profiles",
                    config.profiles.filter((_, index) => index !== i),
                  )
                }
              >
                Remove profile
              </Button>
            </div>
          </details>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={config.profiles.length >= 12}
          onClick={() =>
            patch("profiles", [
              ...config.profiles,
              {
                ...defaultRadarConfig().profiles[0],
                id: crypto.randomUUID(),
                name: "New profile",
                titles: [],
                locations: [],
                context: "",
              },
            ])
          }
        >
          <Plus size={15} />
          Add search profile
        </Button>
      </div>
      <div className="radar-preference-section">
        <h3>Discovery sources</h3>
        <p className="muted">
          JSearch is the broad search. Employer feeds provide direct listings.
          Apify runs only on a Free account with a five-cent per-run cap and a
          four-dollar monthly reservation ceiling.
        </p>
        {config.sources.map((s, i) => (
          <div className="radar-source-setting" key={s.id}>
            <label className="radar-checkbox">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => source(i, { enabled: e.target.checked })}
              />
              {s.name}
            </label>
            <span className="muted">
              {s.type}
              {s.actor ? ` · ${s.actor}` : ""}
            </span>
            {s.url && (
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                Careers <ArrowUpRight size={12} />
              </a>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                patch(
                  "sources",
                  config.sources.filter((_, index) => index !== i),
                )
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="inline-actions">
          <Select
            aria-label="Watch careers page"
            value=""
            onChange={(e) => watchCompany(e.target.value)}
          >
            <option value="">Add an Interested company's employer feed</option>
            {companies
              .filter((c) => !config.sources.some((s) => s.companyId === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </Select>
          <Select
            aria-label="Add job board collector"
            value=""
            onChange={(e) =>
              patch("sources", [
                ...config.sources,
                {
                  id: crypto.randomUUID(),
                  type: "apify",
                  name: e.target.value.includes("seek")
                    ? "SEEK"
                    : e.target.value.includes("indeed")
                      ? "Indeed"
                      : "LinkedIn",
                  actor: e.target.value,
                  enabled: false,
                  url: "",
                  companyId: "",
                },
              ])
            }
          >
            <option value="">Add an Apify board collector</option>
            {actors
              .filter((a) => !config.sources.some((s) => s.actor === a))
              .map((a) => (
                <option key={a}>{a}</option>
              ))}
          </Select>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <Button type="submit" disabled={busy}>
          <Check size={16} />
          {busy ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </form>
  );
}
function CaptureOpportunity({ onSaved }: { onSaved: () => void }) {
  const [form, setForm] = useState({
      company: "",
      title: "",
      url: "",
      location: "",
      description: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const job = jobSchema.parse({
        company: form.company,
        title: form.title,
        description: form.description,
        companyUrl: "",
        companyId: "",
        locations: form.location ? [form.location] : [],
        country: "",
        workplace: "unknown",
        remoteRegions: [],
        salary: null,
        employmentType: "",
        seniority: "",
        requisitionId: "",
        requisitionNamespace: "",
        postedAt: "",
        closingDate: "",
        closed: false,
        sources: [
          {
            provider: "manual",
            publisher: "Saved listing",
            sourceId: "",
            url: form.url,
            applyUrl: "",
            observedAt: new Date().toISOString(),
          },
        ],
      });
      await request("/api/radar/opportunities", jsonRequest("POST", job));
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={(e) => void save(e)}>
      {(
        [
          ["company", "Company"],
          ["title", "Role title"],
          ["url", "Listing URL"],
          ["location", "Location"],
        ] as const
      ).map(([key, label]) => (
        <Field key={key} label={label}>
          <Input
            required={key !== "location"}
            value={form[key]}
            onChange={(e) =>
              setForm((old) => ({ ...old, [key]: e.target.value }))
            }
          />
        </Field>
      ))}
      <Field label="Job description (optional)">
        <NoteInput
          value={form.description}
          onChange={(e) =>
            setForm((old) => ({ ...old, description: e.target.value }))
          }
          rows={6}
        />
      </Field>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy} type="submit">
        {busy ? "Saving…" : "Save to Interested"}
      </Button>
    </form>
  );
}
