import {
  Bell,
  History,
  LayoutDashboard,
  Rss,
  Settings2,
  X,
} from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "./ui/sidebar.tsx";

export const pages: readonly string[] = [
  "nav.overview",
  "nav.feeds",
  "nav.channels",
  "nav.deliveries",
  "nav.settings",
];
const icons = [LayoutDashboard, Rss, Bell, History, Settings2];

export function AppSidebar({ page, onNavigate }: {
  page: number;
  onNavigate: (page: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                aria-label="PushRSS"
                onClick={() => {
                  onNavigate(0);
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <img
                  src="/pushrss-icon-v1.svg"
                  alt=""
                  className="size-4 shrink-0"
                />
                <span className="font-semibold">PushRSS</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setOpenMobile(false)}
              aria-label={t("common.close")}
            >
              <X />
            </Button>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label={t("nav.main")}>
              <SidebarMenu>
                {pages.map((key, index) => {
                  const Icon = icons[index];
                  return (
                    <SidebarMenuItem key={key}>
                      <SidebarMenuButton
                        type="button"
                        isActive={page === index}
                        aria-current={page === index ? "page" : undefined}
                        aria-label={t(key)}
                        tooltip={t(key)}
                        onClick={() => {
                          onNavigate(index);
                          if (isMobile) setOpenMobile(false);
                        }}
                      >
                        <Icon aria-hidden="true" />
                        <span>{t(key)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
