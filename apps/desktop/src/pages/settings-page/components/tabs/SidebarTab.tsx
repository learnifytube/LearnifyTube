import { useAtom } from "jotai";
import { sidebarPreferencesAtom } from "@/atoms/sidebar-atoms";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { SidebarItem } from "@/lib/types/user-preferences";

const SIDEBAR_ITEMS: { id: SidebarItem; label: string; description: string }[] = [
  { id: "channels", label: "Channels", description: "Find Videos from YouTube channels" },
  {
    id: "playlists",
    label: "YouTube playlists",
    description: "Find Videos from YouTube playlists",
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    description: "New Videos from Channels you follow",
  },
  { id: "storage", label: "Storage", description: "Disk space used by your Library" },
  { id: "settings", label: "Settings", description: "App configuration" },
];

export function SidebarTab(): React.JSX.Element {
  const [preferences, setPreferences] = useAtom(sidebarPreferencesAtom);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Visible Menu Items</CardTitle>
          <CardDescription>
            Choose which pages appear in your sidebar. Hide features you don't use to keep your
            workspace clean.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {SIDEBAR_ITEMS.map((item) => {
            const isVisible = preferences.visibleItems.includes(item.id);
            const isSettings = item.id === "settings";

            return (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-border p-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Label className="font-medium">{item.label}</Label>
                    {isSettings && (
                      <Badge variant="outline" className="text-xs">
                        Required
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
                <Switch
                  checked={isVisible}
                  disabled={isSettings}
                  onCheckedChange={(checked) => {
                    const newVisibleItems = checked
                      ? [...preferences.visibleItems, item.id]
                      : preferences.visibleItems.filter((id) => id !== item.id);

                    setPreferences({
                      ...preferences,
                      visibleItems: newVisibleItems,
                    });
                  }}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sidebar Behavior</CardTitle>
          <CardDescription>Control how the sidebar appears and behaves</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Collapsed by Default</Label>
              <p className="text-sm text-muted-foreground">
                Start with sidebar in collapsed icon-only mode
              </p>
            </div>
            <Switch
              checked={preferences.collapsed}
              onCheckedChange={(checked) =>
                setPreferences({
                  ...preferences,
                  collapsed: checked,
                })
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
