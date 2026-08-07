import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  MESSAGES,
  SCENARIO_SUMMARIES,
  readStoredLocale,
  storeLocale,
  type Locale,
  type MessageKey,
  type Messages,
} from "./messages";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: Messages;
  scenarioSummary: (scenarioId: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  const value = useMemo<LocaleContextValue>(() => {
    const setLocale = (next: Locale): void => {
      setLocaleState(next);
      storeLocale(next);
    };
    return {
      locale,
      setLocale,
      toggleLocale: () => setLocale(locale === "zh-TW" ? "en" : "zh-TW"),
      t: MESSAGES[locale],
      scenarioSummary: (scenarioId: string) => SCENARIO_SUMMARIES[locale][scenarioId] ?? "",
    };
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return ctx;
}

export function useT(): Messages {
  return useLocale().t;
}

export type { Locale, MessageKey };
