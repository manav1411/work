import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Eye, EyeOff, Mail } from "lucide-react";
import { BrandArrow } from "../../components/BrandArrow";
import { Button } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { authRequest } from "../../lib/auth";
import { useWorkspace } from "../../lib/workspace";
import { AuthLogoPlayground } from "./AuthLogoPlayground";
import "./auth.css";

type Flow = { email: string; kind: "signup" | "reset"; retryAt: number };
const FLOW_KEY = "work:email-flow";
function readFlow(): Flow | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(FLOW_KEY) || "null");
    return value &&
      typeof value.email === "string" &&
      ["signup", "reset"].includes(value.kind) &&
      typeof value.retryAt === "number" &&
      Date.now() - value.retryAt < 86_400_000
      ? value
      : null;
  } catch {
    return null;
  }
}
function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.min(5, Math.max(2, name.length - 2)))}@${domain}`;
}

export function AuthPage() {
  const { configured, error: workspaceError, openDemo } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const view =
    location.pathname === "/sign-up"
      ? "signup"
      : location.pathname === "/verify-email"
        ? "verify"
        : location.pathname === "/forgot-password"
          ? "forgot"
          : location.pathname === "/reset-password"
            ? "reset"
            : "signin";
  const [flow, setFlow] = useState<Flow | null>(readFlow);
  const [email, setEmail] = useState(() => readFlow()?.email || "");
  const [password, setPassword] = useState("");
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "signin" | "signup" | null
  >(null);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState(() => {
    try {
      return sessionStorage.getItem("work:auth-notice") || "";
    } catch {
      return "";
    }
  });
  const [now, setNow] = useState(Date.now);
  const [saveNotice] = useState(() => {
    try {
      return sessionStorage.getItem("work:signout-save-notice") || "";
    } catch {
      return "";
    }
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const card = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const entryView = view === "signin" || view === "signup";
  const codeView = view === "verify" || view === "reset";
  const validFlow = Boolean(
    flow &&
    (view === "verify" ? flow.kind === "signup" : flow.kind === "reset"),
  );
  const cooldown = Math.max(0, Math.ceil(((flow?.retryAt || 0) - now) / 1000));

  useEffect(() => {
    heading.current?.focus();
    setFailure("");
    setOtp("");
    setPassword("");
    setVisible(false);
    if (view === "signin") {
      try {
        sessionStorage.removeItem("work:auth-notice");
      } catch {
        /* Optional feedback only. */
      }
    }
    if (view !== "verify") setRegistrationPassword("");
  }, [view]);
  useEffect(() => {
    if (!codeView) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [codeView]);

  function remember(next: Flow | null) {
    setFlow(next);
    setNow(Date.now());
    try {
      if (next) sessionStorage.setItem(FLOW_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(FLOW_KEY);
    } catch {
      /* The current tab can continue without browser persistence. */
    }
  }
  function enterWorkspace() {
    remember(null);
    setPassword("");
    setRegistrationPassword("");
    try {
      sessionStorage.removeItem("work-demo-active");
    } catch {
      /* Cookie auth still works. */
    }
    window.location.assign("/home");
  }
  function report(error: unknown) {
    setFailure(error instanceof Error ? error.message : "Please try again.");
    if (error instanceof ApiError && error.status === 429 && flow) {
      const details = error.details as {
        error?: { details?: { retryAfter?: number } };
      };
      remember({
        ...flow,
        retryAt:
          Date.now() + (details?.error?.details?.retryAfter || 60) * 1000,
      });
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = entryView
      ? submitter instanceof HTMLButtonElement && submitter.value === "signup"
        ? "signup"
        : "signin"
      : view;
    if (action === "signup" && password.length < 8) {
      setFailure("Use at least 8 characters to sign up.");
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setPendingAction(
      action === "signin" || action === "signup" ? action : null,
    );
    setFailure("");
    setNotice("");
    const address = email.trim().toLowerCase();
    try {
      if (action === "signin") {
        await authRequest("/sign-in/email", { email: address, password });
        enterWorkspace();
      } else if (action === "signup") {
        await authRequest("/sign-up/email", { email: address, password });
        setRegistrationPassword(password);
        setPassword("");
        remember({
          email: address,
          kind: "signup",
          retryAt: Date.now() + 60_000,
        });
        navigate("/verify-email");
      } else if (view === "forgot") {
        await authRequest("/email-otp/request-password-reset", {
          email: address,
        });
        remember({
          email: address,
          kind: "reset",
          retryAt: Date.now() + 60_000,
        });
        setPassword("");
        navigate("/reset-password");
      } else if (view === "verify" && flow) {
        await authRequest("/email-otp/verify-email", {
          email: flow.email,
          otp,
        });
        remember(null);
        if (registrationPassword) {
          try {
            await authRequest("/sign-in/email", {
              email: flow.email,
              password: registrationPassword,
            });
            enterWorkspace();
            return;
          } catch {
            /* Verification succeeded; the user can retry sign-in without another code. */
          }
        }
        setRegistrationPassword("");
        setNotice("Email verified. You’re ready to sign in.");
        navigate("/sign-in");
      } else if (view === "reset" && flow) {
        await authRequest("/email-otp/reset-password", {
          email: flow.email,
          otp,
          password,
        });
        remember(null);
        setPassword("");
        try {
          sessionStorage.setItem(
            "work:auth-notice",
            "Password updated. Sign in for a fresh start.",
          );
        } catch {
          /* The cookie session is still revoked. */
        }
        // Reload session state too: recovery can also be opened from a signed-in tab.
        window.location.assign("/sign-in");
      }
    } catch (error) {
      report(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
      setPendingAction(null);
    }
  }
  async function resend() {
    if (!flow || cooldown || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      await authRequest(
        flow.kind === "signup"
          ? "/email-otp/send-verification-otp"
          : "/email-otp/request-password-reset",
        {
          email: flow.email,
          ...(flow.kind === "signup" ? { type: "email-verification" } : {}),
        },
      );
      remember({ ...flow, retryAt: Date.now() + 60_000 });
      setOtp("");
      setNotice(
        flow.kind === "signup"
          ? "A fresh code is on its way. Use the newest email."
          : "If an account uses this email, a fresh code is on its way.",
      );
    } catch (error) {
      report(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const title = {
    signin: "Sign up or sign in",
    signup: "Sign up or sign in",
    verify: "Verify email",
    forgot: "Forgot password",
    reset: "Reset password",
  }[view];
  const description =
    view === "forgot"
      ? "Enter your email and we’ll help you reset your password."
      : view === "reset"
        ? "Enter your recovery code and choose a new password."
        : "";
  const primary = {
    signin: "Sign in",
    signup: "Create account",
    verify: "Verify email",
    forgot: "Send reset code",
    reset: "Reset password",
  }[view];
  return (
    <main className="work-signin-page email-auth-page">
      <AuthLogoPlayground obstacle={card} />
      <section
        ref={card}
        className="signin-card email-auth-card"
        aria-labelledby="auth-heading"
      >
        <div className="signin-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <BrandArrow />
        </div>
        <div className="auth-heading">
          <h1 id="auth-heading" ref={heading} tabIndex={-1}>
            {title}
          </h1>
          {description && <p>{description}</p>}
        </div>
        {codeView && !validFlow ? (
          <div className="auth-expired">
            <p>Start again to request a fresh code.</p>
            <Link
              className="button button-primary"
              to={view === "verify" ? "/sign-up" : "/forgot-password"}
            >
              Start again
              <ArrowRight size={17} />
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(event) => void submit(event)}
            className="auth-form"
            aria-busy={busy}
          >
            {codeView && flow ? (
              <>
                <div className="auth-destination">
                  <Mail size={18} />
                  <span>{maskEmail(flow.email)}</span>
                </div>
                {view === "reset" && (
                  <p className="field-hint">
                    If an account uses this email, a recovery code is on its
                    way.
                  </p>
                )}
                <label className="auth-field" htmlFor="auth-code">
                  <span>Six-digit code</span>
                  <input
                    id="auth-code"
                    className="input auth-code"
                    value={otp}
                    onChange={(event) =>
                      setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    name="otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    disabled={busy}
                    aria-describedby="auth-code-hint"
                    placeholder="000000"
                  />
                </label>
                <p id="auth-code-hint" className="field-hint">
                  Codes expire after 5 minutes. Check your spam folder too.
                </p>
              </>
            ) : (
              <label className="auth-field" htmlFor="auth-email">
                <span>Email address</span>
                <input
                  id="auth-email"
                  className="input"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  disabled={busy}
                />
              </label>
            )}
            {(view === "signin" || view === "signup" || view === "reset") && (
              <label className="auth-field" htmlFor="auth-password">
                <span>{view === "reset" ? "New password" : "Password"}</span>
                <span className="auth-password-wrap">
                  <input
                    id="auth-password"
                    className="input"
                    type={visible ? "text" : "password"}
                    name="password"
                    required
                    autoComplete={
                      view === "signin" ? "current-password" : "new-password"
                    }
                    minLength={entryView ? undefined : 8}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                    aria-describedby={
                      entryView ? undefined : "auth-password-hint"
                    }
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    onClick={() => setVisible(!visible)}
                    aria-label={visible ? "Hide password" : "Show password"}
                    aria-pressed={visible}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>
            )}
            {view === "reset" && (
              <p id="auth-password-hint" className="field-hint">
                At least 8 characters. A longer phrase works well.
              </p>
            )}
            {entryView && (
              <Link to="/forgot-password" className="auth-forgot">
                Forgot password?
              </Link>
            )}
            {notice && (
              <p className="auth-notice" role="status">
                <Check size={17} />
                {notice}
              </p>
            )}
            {(failure || workspaceError) && (
              <p className="notice notice-warning" role="alert">
                {failure || workspaceError}
              </p>
            )}
            {!configured && (
              <p className="field-hint" role="status">
                Sign-in is unavailable right now. You can still explore the
                demo.
              </p>
            )}
            <div
              className={
                entryView ? "auth-entry-actions" : "auth-primary-action"
              }
            >
              {entryView ? (
                <>
                  <div className="auth-account-actions">
                    <Button
                      type="submit"
                      name="action"
                      value="signin"
                      disabled={!configured || busy}
                    >
                      {busy && pendingAction === "signin"
                        ? "Signing in…"
                        : "Sign in"}
                    </Button>
                    <Button
                      type="submit"
                      name="action"
                      value="signup"
                      variant="secondary"
                      className="auth-alternate-action"
                      disabled={!configured || busy}
                    >
                      {busy && pendingAction === "signup"
                        ? "Signing up…"
                        : "Sign up"}
                    </Button>
                  </div>
                  <hr className="auth-action-divider" />
                  <Button
                    type="button"
                    variant="secondary"
                    className="auth-see-demo"
                    disabled={busy}
                    onClick={() => {
                      openDemo();
                      navigate("/home");
                    }}
                  >
                    See demo
                  </Button>
                </>
              ) : (
                <Button
                  type="submit"
                  disabled={
                    !configured || busy || (codeView && otp.length !== 6)
                  }
                >
                  {busy ? "One moment…" : primary}
                  {!busy && <ArrowRight size={18} />}
                </Button>
              )}
            </div>
            {codeView && (
              <div className="auth-code-actions">
                <button
                  type="button"
                  className="auth-text-button"
                  disabled={busy || cooldown > 0}
                  onClick={() => void resend()}
                >
                  {cooldown ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
                <Link to={view === "verify" ? "/sign-up" : "/forgot-password"}>
                  Use a different email
                </Link>
              </div>
            )}
          </form>
        )}
        {!entryView && (
          <div className="auth-secondary-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                openDemo();
                navigate("/home");
              }}
            >
              Demo
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => navigate("/sign-in")}
            >
              Sign in
            </Button>
          </div>
        )}
        {view === "verify" && (
          <p className="auth-recovery-hint">
            Returning to an older registration?{" "}
            <Link to="/forgot-password">Set a new password</Link>
          </p>
        )}
        {saveNotice && (
          <p className="field-hint" role="status">
            {saveNotice}
          </p>
        )}
      </section>
    </main>
  );
}
