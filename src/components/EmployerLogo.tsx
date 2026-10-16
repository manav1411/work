import { useState, type ReactNode } from "react";
import { companyInitials, logoDevUrl } from "../../shared/company-logos";
import { useWorkspace } from "../lib/workspace";
import { CompanyGlyph, companyMark } from "./CompanyGlyph";
import "./company-glyphs.css";

/** Employer-only lookups: tutorials and profile/resource titles stay local. */
export function EmployerLogo({
  name,
  fallback,
}: {
  name: string;
  fallback?: ReactNode;
}) {
  const { logoDevPublishableKey } = useWorkspace();
  if (companyMark(name)) return <CompanyGlyph name={name} />;
  const src = logoDevUrl(name, logoDevPublishableKey);
  return (
    <RemoteEmployerLogo
      key={src}
      src={src}
      fallback={
        fallback ?? (
          <span className="employer-logo-initials">
            {companyInitials(name)}
          </span>
        )
      }
    />
  );
}

function RemoteEmployerLogo({
  src,
  fallback,
}: {
  src: string;
  fallback: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <span className="employer-logo-fallback" aria-hidden="true">
        {fallback}
      </span>
    );
  return (
    <span className="employer-logo" aria-hidden="true">
      {!loaded && fallback}
      <img
        className="employer-logo-image"
        data-loaded={loaded || undefined}
        src={src}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
