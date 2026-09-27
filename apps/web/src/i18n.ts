import { createInstance } from "i18next";
import en from "./locales/en.json" with { type: "json" };
import zhCN from "./locales/zh-CN.json" with { type: "json" };

export type LanguagePreference = "system" | "zh-CN" | "en";
const storageKey = "pushrss.language";
const listeners = new Set<() => void>();
export function parseLanguagePreference(
  value: string | null,
): LanguagePreference {
  return value === "zh-CN" || value === "en" ? value : "system";
}
export function resolveLanguage(languages: readonly string[]): "zh-CN" | "en" {
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en";
  }
  return "en";
}
function readPreference(): LanguagePreference {
  try {
    return parseLanguagePreference(localStorage.getItem(storageKey));
  } catch {
    return "system";
  }
}
let preference = readPreference();
export function getLanguagePreference(): LanguagePreference {
  return preference;
}
function currentLanguage(): "zh-CN" | "en" {
  return preference === "system"
    ? resolveLanguage(
      typeof navigator === "undefined" ? [] : navigator.languages,
    )
    : preference;
}
export const i18n: ReturnType<typeof createInstance> = createInstance();
// Resources are bundled, so initialization completes before the first render.
void i18n.init({
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
  lng: currentLanguage(),
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  keySeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
});
function updateDocumentLanguage() {
  if (typeof document !== "undefined") {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }
}
i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();
export function subscribeLanguagePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function applyPreference(value: LanguagePreference) {
  preference = value;
  void i18n.changeLanguage(currentLanguage());
  for (const listener of listeners) listener();
}
export function setLanguagePreference(value: LanguagePreference): void {
  try {
    if (value === "system") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, value);
  } catch {
    // Storage can be disabled; the selection still applies for this session.
  }
  applyPreference(value);
}
if (typeof document !== "undefined") {
  globalThis.addEventListener("languagechange", () => {
    if (preference === "system") void i18n.changeLanguage(currentLanguage());
  });
  globalThis.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) {
      applyPreference(readPreference());
    }
  });
}
