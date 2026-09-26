import React, { useState } from "react";
import {
  Home,
  Clapperboard,
  Users,
  List,
  HardDrive,
  ScrollText,
  Settings,
  FolderHeart,
  Smartphone,
  Library,
  Plus,
} from "lucide-react";
import { Link, useMatches } from "@tanstack/react-router";
import { logger } from "@/helpers/logger";
import { cn } from "@/lib/utils";
import { useAtomValue } from "jotai";
import { sidebarPreferencesAtom } from "@/atoms/sidebar-atoms";
import type { SidebarItem } from "@/lib/types/user-preferences";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { SidebarThemeToggle } from "@/components/SidebarThemeToggle";
import { MinimizedPlayer } from "@/components/MinimizedPlayer";
import { Logo } from "@/components/Logo";
import { QuickAddDialog } from "@/components/QuickAddDialog";

// Check if we're in development mode
// In Electron renderer, check window.location - if it's http(s)://, we're in dev mode
const isDevelopment = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  // If loading from http://localhost (dev server), we're in development
  const href = window.location.href;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return true;
  }

  // Fallback: check for Electron Forge dev server URL global
  // @ts-ignore - MAIN_WINDOW_VITE_DEV_SERVER_URL is a global defined by Electron Forge
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return true;
  }

  // Last fallback: if NODE_ENV is not explicitly production, assume development
  return process.env.NODE_ENV !== "production";
};

// Sidebar item type
type SidebarItemConfig = {
  id: SidebarItem;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  url: string;
};

// Sidebar groups configuration
const SIDEBAR_GROUPS: Array<{
  label?: string;
  items: SidebarItemConfig[];
  addUrl?: boolean;
}> = [
  {
    items: [
      { id: "home", title: "Up next", icon: Home, url: "/" },
      { id: "library", title: "Library", icon: Library, url: "/library" },
      { id: "my-playlists", title: "Lists", icon: FolderHeart, url: "/my-playlists" },
    ],
  },
  {
    label: "EXPLORE",
    items: [
      { id: "channels", title: "Channels", icon: Users, url: "/channels" },
      { id: "playlists", title: "YouTube playlists", icon: List, url: "/playlists" },
      { id: "subscriptions", title: "Subscriptions", icon: Clapperboard, url: "/subscriptions" },
    ],
    addUrl: true,
  },
  {
    items: [{ id: "mobile-sync", title: "Devices", icon: Smartphone, url: "/mobile-sync" }],
  },
  {
    items: [
      { id: "storage", title: "Storage", icon: HardDrive, url: "/storage" },
      { id: "settings", title: "Settings", icon: Settings, url: "/settings" },
      { id: "logs", title: "Logs", icon: ScrollText, url: "/app-debug-logs" },
    ],
  },
];

// Core pages can't be hidden, even by sidebar preferences stored before they existed
const ALWAYS_VISIBLE: SidebarItem[] = [
  "home",
  "library",
  "my-playlists",
  "mobile-sync",
  "settings",
];

export function AppSidebar({
  className,
  ...props
}: React.ComponentProps<typeof Sidebar>): React.JSX.Element {
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const matches = useMatches();
  const currentPath = matches[matches.length - 1]?.pathname ?? "/";
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  // Load user preferences from atom
  const sidebarPreferences = useAtomValue(sidebarPreferencesAtom);

  // Filter groups and items based on user preferences
  const filteredGroups = SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.id === "logs") return isDevelopment();
      return ALWAYS_VISIBLE.includes(item.id) || sidebarPreferences.visibleItems.includes(item.id);
    }),
  })).filter((group) => group.items.length > 0 || group.addUrl);

  return (
    <Sidebar
      collapsible="icon"
      className={cn("border-r border-border bg-sidebar", className)}
      {...props}
    >
      <SidebarHeader className="px-2 py-2">
        <div
          className={cn(
            "flex items-center gap-2",
            isCollapsed ? "justify-center" : "justify-between"
          )}
        >
          <div className="flex items-center gap-2">
            <Logo size={28} />
            {!isCollapsed && (
              <span className="text-sm font-semibold text-foreground">LearnifyTube</span>
            )}
          </div>
          {!isCollapsed && <SidebarThemeToggle />}
        </div>
        {isCollapsed && (
          <div className="flex justify-center pt-1">
            <SidebarThemeToggle />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {filteredGroups.map((group) => (
          <SidebarGroup key={group.items[0]?.id ?? group.label}>
            {group.label && (
              <SidebarGroupLabel className="text-xs font-medium text-muted-foreground/70">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={currentPath === item.url || activeItem === item.title}
                    tooltip={item.title}
                    className={cn(
                      "gap-2 text-muted-foreground transition-colors",
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      (currentPath === item.url || activeItem === item.title) &&
                        "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    )}
                  >
                    <Link
                      to={item.url}
                      onClick={() => {
                        logger.debug("Sidebar navigation", {
                          from: currentPath,
                          to: item.url,
                          title: item.title,
                          source: "AppSidebar",
                        });
                        setActiveItem(item.title);
                      }}
                    >
                      <item.icon className="size-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {group.addUrl && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Add URL"
                    className="gap-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    onClick={() => setQuickAddOpen(true)}
                  >
                    <Plus className="size-4" />
                    <span>Add URL</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <MinimizedPlayer />
      </SidebarFooter>

      <SidebarRail className="border-primary/20 dark:border-primary/10" />
      <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </Sidebar>
  );
}
