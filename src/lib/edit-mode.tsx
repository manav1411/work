import { createContext, useContext, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

const EditModeContext = createContext<{
  sections: Set<string>;
  toggleSection: (section: string) => void;
} | null>(null);

const STORAGE_KEY = "work-edit-sections";
const EDITABLE_SECTIONS = new Set([
  "/home",
  "/learn",
  "/applications",
  "/interviews",
  "/documents",
  "/direction",
]);

export function EditModeProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<Set<string>>(() => {
    try {
      const stored: unknown = JSON.parse(
        sessionStorage.getItem(STORAGE_KEY) ?? "[]",
      );
      return new Set(
        Array.isArray(stored)
          ? stored.filter(
              (item): item is string =>
                typeof item === "string" && EDITABLE_SECTIONS.has(item),
            )
          : [],
      );
    } catch {
      return new Set();
    }
  });
  const toggleSection = (section: string) =>
    setSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* Edit mode still works when browser storage is unavailable. */
      }
      return next;
    });
  return (
    <EditModeContext.Provider value={{ sections, toggleSection }}>
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
  };
}
