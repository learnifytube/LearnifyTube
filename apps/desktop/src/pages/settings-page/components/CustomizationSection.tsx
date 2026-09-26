import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Layout, Play, BookOpen, Settings, RotateCcw, Smartphone } from "lucide-react";
import type { UserPreferences } from "@/lib/types/user-preferences";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { SidebarTab } from "./tabs/SidebarTab";
import { PlayerTab } from "./tabs/PlayerTab";
import { LearningTab } from "./tabs/LearningTab";
import { SystemTab } from "./tabs/SystemTab";
import { SyncTab } from "./tabs/SyncTab";
import { LEARNING_FEATURES_ENABLED } from "@/lib/features";

export function CustomizationSection(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("appearance");

  const { data: preferences } = useQuery({
    queryKey: ["preferences.customization"],
    queryFn: async () => {
      return trpcClient.preferences.getCustomizationPreferences.query();
    },
  });

  const updatePreferences = async (updates: {
    sidebar?: Partial<UserPreferences["sidebar"]>;
    appearance?: Partial<UserPreferences["appearance"]>;
    player?: Partial<UserPreferences["player"]>;
    learning?: Partial<UserPreferences["learning"]>;
  }): Promise<void> => {
    await trpcClient.preferences.updateCustomizationPreferences.mutate(updates);
    queryClient.invalidateQueries({ queryKey: ["preferences.customization"] });
  };

  const resetPreferences = async (): Promise<void> => {
    if (window.confirm("Are you sure you want to reset all customization settings to defaults?")) {
      await trpcClient.preferences.resetCustomizationPreferences.mutate();
      queryClient.invalidateQueries({ queryKey: ["preferences.customization"] });
    }
  };

  if (!preferences) {
    return <div>Loading preferences...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Personalize LearnifyTube</p>
        </div>
        <Button variant="outline" size="sm" onClick={resetPreferences}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset to Defaults
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList
          className={`grid w-full ${LEARNING_FEATURES_ENABLED ? "grid-cols-6" : "grid-cols-5"}`}
        >
          <TabsTrigger value="appearance">
            <Eye className="mr-2 h-4 w-4" />
            Appearance
          </TabsTrigger>
          <TabsTrigger value="sidebar">
            <Layout className="mr-2 h-4 w-4" />
            Sidebar
          </TabsTrigger>
          <TabsTrigger value="player">
            <Play className="mr-2 h-4 w-4" />
            Player
          </TabsTrigger>
          {LEARNING_FEATURES_ENABLED && (
            <TabsTrigger value="learning">
              <BookOpen className="mr-2 h-4 w-4" />
              Learning
            </TabsTrigger>
          )}
          <TabsTrigger value="sync">
            <Smartphone className="mr-2 h-4 w-4" />
            Sync
          </TabsTrigger>
          <TabsTrigger value="system">
            <Settings className="mr-2 h-4 w-4" />
            System
          </TabsTrigger>
        </TabsList>

        <TabsContent value="appearance">
          <AppearanceTab preferences={preferences} updatePreferences={updatePreferences} />
        </TabsContent>

        <TabsContent value="sidebar">
          <SidebarTab />
        </TabsContent>

        <TabsContent value="player">
          <PlayerTab preferences={preferences} updatePreferences={updatePreferences} />
        </TabsContent>

        {LEARNING_FEATURES_ENABLED && (
          <TabsContent value="learning">
            <LearningTab preferences={preferences} updatePreferences={updatePreferences} />
          </TabsContent>
        )}

        <TabsContent value="sync">
          <SyncTab />
        </TabsContent>

        <TabsContent value="system">
          <SystemTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
