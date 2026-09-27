import {
  getThemePreference,
  setThemePreference,
  subscribeThemePreference,
} from "../theme.ts";
import { Languages, LogOut, Monitor, Moon, RefreshCw, Sun } from "lucide-react";
import type { ComponentProps, JSX } from "react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  getLanguagePreference,
  type LanguagePreference,
  setLanguagePreference,
  subscribeLanguagePreference,
} from "../i18n.ts";
import { Button } from "./ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.tsx";

function HeaderIconButton({
  label,
  children,
  ...buttonProps
}: Omit<ComponentProps<typeof Button>, "className" | "size" | "variant"> & {
  label: string;
}): JSX.Element {
  return (
    <Button
      {...buttonProps}
      type="button"
      data-slot="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

function LanguageAction(): JSX.Element {
  const { t } = useTranslation();
  const preference = useSyncExternalStore(
    subscribeLanguagePreference,
    getLanguagePreference,
  );
  const label = t("settings.language");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton label={label}>
          <Languages aria-hidden="true" />
        </HeaderIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) =>
            setLanguagePreference(value as LanguagePreference)}
        >
          <DropdownMenuRadioItem value="system">
            {t("settings.system")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh-CN" lang="zh-CN">
            {t("language.zhCN")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en" lang="en">
            {t("language.en")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeAction(): JSX.Element {
  const { t } = useTranslation();
  const preference = useSyncExternalStore(
    subscribeThemePreference,
    getThemePreference,
  );
  const Icon = preference === "system"
    ? Monitor
    : preference === "dark"
    ? Moon
    : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <HeaderIconButton label={t("theme.label")}>
          <Icon aria-hidden="true" />
        </HeaderIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            if (value === "system" || value === "light" || value === "dark") {
              setThemePreference(value);
            }
          }}
        >
          {(["system", "light", "dark"] as const).map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {t(`theme.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PageHeaderActions({
  busy,
  onRefresh,
  onSignOut,
}: {
  busy: boolean;
  onRefresh: () => void;
  onSignOut: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="actions">
      <LanguageAction />
      <ThemeAction />
      <HeaderIconButton
        label={t("common.refresh")}
        disabled={busy}
        onClick={onRefresh}
      >
        <RefreshCw aria-hidden="true" />
      </HeaderIconButton>
      <HeaderIconButton
        label={t("auth.signOut")}
        disabled={busy}
        onClick={onSignOut}
      >
        <LogOut aria-hidden="true" />
      </HeaderIconButton>
    </div>
  );
}
