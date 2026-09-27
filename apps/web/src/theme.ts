export type ThemePreference = "system" | "light" | "dark";
const storageKey = "pushrss.theme";
const listeners = new Set<() => void>();
const media = globalThis.matchMedia("(prefers-color-scheme: dark)");

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
let preference = readPreference();

function applyTheme() {
  const dark = preference === "dark" ||
    (preference === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
export function getThemePreference(): ThemePreference {
  return preference;
}
export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function setThemePreference(value: ThemePreference): void {
  preference = value;
  try {
    if (value === "system") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, value);
  } catch {
    // 浏览器禁用存储时，当前会话仍可切换主题。
  }
  applyTheme();
  for (const listener of listeners) listener();
}
media.addEventListener("change", applyTheme);
globalThis.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) {
    preference = readPreference();
    applyTheme();
    for (const listener of listeners) listener();
  }
});
applyTheme();
