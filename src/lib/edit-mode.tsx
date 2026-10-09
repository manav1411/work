import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

const EditModeContext = createContext<{
  sections: Set<string>;
  toggleSection: (section: string) => void;
  continueCreation: (section: string) => void;
} | null>(null);

const STORAGE_KEY = "work-edit-sections";
const EDITABLE_SECTIONS = new Set([
  "/home",
  "/learn",
  "/applications",
  "/interviews",
  "/documents",
  "/goals",
]);

export function EditModeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const tab =
    search.get(location.pathname === "/learn" ? "track" : "tab") || "";
  const scope = ["/learn", "/interviews", "/applications"].includes(
    location.pathname,
  )
    ? location.pathname
    : `${location.pathname}:${tab}`;
  const previous = useRef(scope);
  const requestedDestination = useRef<string | null>(null);
  const [sections, setSections] = useState<Set<string>>(new Set());
  useLayoutEffect(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* optional storage */
    }
    if (previous.current === scope) return;
    previous.current = scope;
    const target = requestedDestination.current;
    requestedDestination.current = null;
    setSections(
      target && location.pathname === target ? new Set([target]) : new Set(),
    );
  }, [scope, location.pathname]);
  const toggleSection = (section: string) =>
    setSections((current) => {
      if (!EDITABLE_SECTIONS.has(section)) return current;
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else {
        next.clear();
        next.add(section);
      }
      requestedDestination.current =
        location.pathname !== section && next.has(section) ? section : null;
      return next;
    });
  return (
    <EditModeContext.Provider
      value={{
        sections,
        toggleSection,
        continueCreation: (section) => {
          if (sections.has(section)) requestedDestination.current = section;
        },
      }}
    >
      {children}
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  const context = useContext(EditModeContext);
  const { pathname } = useLocation();
  const section = `/${pathname.split("/")[1]}`;
  return {
    editing: context?.sections.has(section) ?? false,
    section,
    isEditing: (target: string) => context?.sections.has(target) ?? false,
    toggleSection: context?.toggleSection ?? (() => {}),
    continueCreation: () => context?.continueCreation(section),
  };
}
