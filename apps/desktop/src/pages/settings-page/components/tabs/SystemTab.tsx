import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Database, Film, FolderOpen, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LanguagePreferencesSection } from "@/pages/settings-page/components/LanguagePreferencesSection";
import { SystemDoctorCard } from "./SystemDoctorCard";
import type { DownloadQuality, YtDlpCookiesBrowser } from "@/lib/types/user-preferences";

const COOKIE_SOURCE_OPTIONS: Array<{ value: YtDlpCookiesBrowser; label: string }> = [
  { value: "none", label: "Disabled (No browser cookies)" },
  { value: "safari", label: "Safari" },
  { value: "chrome", label: "Chrome" },
  { value: "firefox", label: "Firefox" },
  { value: "edge", label: "Edge" },
  { value: "brave", label: "Brave" },
  { value: "chromium", label: "Chromium" },
  { value: "opera", label: "Opera" },
  { value: "vivaldi", label: "Vivaldi" },
  { value: "whale", label: "Whale" },
];
const isCookieSource = (value: string): value is YtDlpCookiesBrowser =>
  COOKIE_SOURCE_OPTIONS.some((option) => option.value === value);

const DOWNLOAD_QUALITY_OPTIONS: Array<{
  value: Extract<DownloadQuality, "720p" | "1080p">;
  label: string;
  description: string;
}> = [
  {
    value: "1080p",
    label: "1080p (Full HD)",
    description: "Sharpest video, larger files.",
  },
  {
    value: "720p",
    label: "720p (HD)",
    description: "Smaller files and faster downloads.",
  },
];

const isDownloadQuality = (
  value: string
): value is (typeof DOWNLOAD_QUALITY_OPTIONS)[number]["value"] =>
  DOWNLOAD_QUALITY_OPTIONS.some((option) => option.value === value);

export function SystemTab(): React.JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get database path
  const { data: dbInfo } = useQuery({
    queryKey: ["database", "path"],
    queryFn: () => trpcClient.utils.getDatabasePath.query(),
  });

  // Get download path
  const { data: downloadPathInfo } = useQuery({
    queryKey: ["preferences", "downloadPath"],
    queryFn: () => trpcClient.preferences.getDownloadPath.query(),
  });
  const { data: customizationPreferences } = useQuery({
    queryKey: ["preferences.customization"],
    queryFn: () => trpcClient.preferences.getCustomizationPreferences.query(),
  });

  const ensureLatestDownloadFolderAccess = async (): Promise<void> => {
    const latest = await trpcClient.preferences.getDownloadPath.query();
    await ensureDirectoryAccessMutation.mutateAsync(latest.downloadPath);
  };

  const handleRestartApp = async (): Promise<void> => {
    const result = await trpcClient.utils.restartApp.mutate();

    if (!result.success) {
      toast({
        title: "Restart Failed",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const updateDatabasePathMutation = useMutation({
    mutationFn: async (filePath: string | null) => {
      const result = await trpcClient.utils.updateDatabasePath.mutate({ filePath });

      if (!result.success) {
        throw new Error(result.error);
      }

      return result;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["database", "path"] });

      toast({
        title: "Database Path Updated",
        description: result.requiresRestart
          ? result.usedExistingDatabase
            ? "Found an existing database at the selected path. Restart LearnifyTube to start using it."
            : result.copiedExistingData
              ? "Your current data was copied to the new database file. Restart LearnifyTube to start using it."
              : "Restart LearnifyTube to start using the new database location."
          : result.isDefault
            ? "LearnifyTube is already using the default database location."
            : "LearnifyTube is already using this database location.",
        action: result.requiresRestart ? (
          <ToastAction altText="Restart app" onClick={() => void handleRestartApp()}>
            Restart
          </ToastAction>
        ) : undefined,
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  // Mutation to update download path
  const updateDownloadPathMutation = useMutation({
    mutationFn: async (downloadPath: string | null) => {
      return await trpcClient.preferences.updateDownloadPath.mutate({ downloadPath });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["preferences", "downloadPath"] });
      toast({
        title: "Download Path Updated",
        description: "Your download folder path has been updated.",
      });
      await ensureLatestDownloadFolderAccess();
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  const ensureDirectoryAccessMutation = useMutation({
    mutationFn: async (directoryPath?: string | null) => {
      if (!directoryPath) return null;
      return await trpcClient.preferences.ensureDownloadDirectoryAccess.mutate({
        directoryPath,
      });
    },
    onSuccess: (result) => {
      if (!result) return;
      if (result.success) {
        toast({
          title: "Folder access granted",
          description: `LearnifyTube can now read ${result.downloadPath}.`,
        });
      } else if (!result.cancelled) {
        toast({
          title: "Folder access was not granted",
          description: result.message ?? "Please try again.",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Unable to request access",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  const updateCookieSourceMutation = useMutation({
    mutationFn: async (cookiesFromBrowser: YtDlpCookiesBrowser) => {
      return await trpcClient.preferences.updateCustomizationPreferences.mutate({
        download: { cookiesFromBrowser },
      });
    },
    onSuccess: async (_result, cookiesFromBrowser) => {
      await queryClient.invalidateQueries({ queryKey: ["preferences.customization"] });
      toast({
        title: "YouTube Authentication Updated",
        description:
          cookiesFromBrowser === "none"
            ? "Browser cookie authentication is disabled."
            : `LearnifyTube will use ${cookiesFromBrowser} cookies for YouTube downloads.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  const updateDownloadQualityMutation = useMutation({
    mutationFn: async (downloadQuality: (typeof DOWNLOAD_QUALITY_OPTIONS)[number]["value"]) => {
      return await trpcClient.preferences.updateCustomizationPreferences.mutate({
        download: { downloadQuality },
      });
    },
    onSuccess: async (_result, downloadQuality) => {
      await queryClient.invalidateQueries({ queryKey: ["preferences.customization"] });
      toast({
        title: "Download Quality Updated",
        description:
          downloadQuality === "1080p"
            ? "New downloads will use 1080p Full HD by default."
            : "New downloads will use 720p HD by default.",
      });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  const handleRevealDatabase = async (): Promise<void> => {
    if (dbInfo?.path) {
      await trpcClient.utils.openFolder.mutate({ folderPath: dbInfo.directory });
    }
  };

  const handleChangeDatabasePath = async (): Promise<void> => {
    const result = await trpcClient.utils.selectDatabaseFile.mutate({
      defaultPath: dbInfo?.path ?? dbInfo?.defaultPath,
    });

    if (result.success && "filePath" in result) {
      await updateDatabasePathMutation.mutateAsync(result.filePath);
    } else if (result.success === false && "cancelled" in result && result.cancelled) {
      // User cancelled, do nothing
    } else if (result.success === false && "error" in result) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const handleResetDatabasePath = async (): Promise<void> => {
    await updateDatabasePathMutation.mutateAsync(null);
  };

  const handleOpenDownloadFolder = async (): Promise<void> => {
    if (downloadPathInfo?.downloadPath) {
      await trpcClient.utils.openFolder.mutate({ folderPath: downloadPathInfo.downloadPath });
    }
  };

  const handleChangeDownloadFolder = async (): Promise<void> => {
    const result = await trpcClient.utils.selectFolder.mutate({
      defaultPath: downloadPathInfo?.downloadPath,
    });

    if (result.success && "folderPath" in result) {
      await updateDownloadPathMutation.mutateAsync(result.folderPath);
    } else if (result.success === false && "cancelled" in result && result.cancelled) {
      // User cancelled, do nothing
    } else if (result.success === false && "error" in result) {
      toast({
        title: "Error",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const handleResetToDefault = async (): Promise<void> => {
    await updateDownloadPathMutation.mutateAsync(null);
  };

  return (
    <div className="space-y-4">
      <SystemDoctorCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database
          </CardTitle>
          <CardDescription>Manage where LearnifyTube stores its database file</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {dbInfo ? (
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">
                  Current Database File
                  {dbInfo.isDefault && (
                    <span className="ml-2 text-xs text-muted-foreground">(Default)</span>
                  )}
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-muted px-3 py-2 font-mono text-xs">
                    {dbInfo.path}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRevealDatabase}
                    disabled={!dbInfo.exists}
                  >
                    Open Folder
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span className={dbInfo.exists ? "text-green-600" : "text-red-600"}>
                    {dbInfo.exists ? "✓ Found" : "✗ Not Found"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Size:</span>{" "}
                  <span>{(dbInfo.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Changing the database path copies your current data into a new database file and
                takes effect after a restart.
              </p>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleChangeDatabasePath}
                  disabled={updateDatabasePathMutation.isPending}
                >
                  Change Path
                </Button>
                {!dbInfo.isDefault && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleResetDatabasePath}
                    disabled={updateDatabasePathMutation.isPending}
                  >
                    Reset to Default
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Loading database information...</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Download Folder
          </CardTitle>
          <CardDescription>Manage where downloaded videos are saved</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {downloadPathInfo ? (
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">
                  Current Download Folder
                  {downloadPathInfo.isDefault && (
                    <span className="ml-2 text-xs text-muted-foreground">(Default)</span>
                  )}
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-muted px-3 py-2 font-mono text-xs">
                    {downloadPathInfo.downloadPath}
                  </code>
                  <Button size="sm" variant="outline" onClick={handleOpenDownloadFolder}>
                    Open Folder
                  </Button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button size="sm" onClick={handleChangeDownloadFolder}>
                  Change Folder
                </Button>
                {!downloadPathInfo.isDefault && (
                  <Button size="sm" variant="outline" onClick={handleResetToDefault}>
                    Reset to Default
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Loading download folder information...
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Film className="h-5 w-5" />
            Video Downloads
          </CardTitle>
          <CardDescription>The highest resolution to fetch for new videos</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {customizationPreferences ? (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Maximum quality</Label>
                <Select
                  value={customizationPreferences.download.downloadQuality}
                  onValueChange={(value) => {
                    if (isDownloadQuality(value)) {
                      updateDownloadQualityMutation.mutate(value);
                    }
                  }}
                >
                  <SelectTrigger disabled={updateDownloadQualityMutation.isPending}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOWNLOAD_QUALITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {
                  DOWNLOAD_QUALITY_OPTIONS.find(
                    (option) => option.value === customizationPreferences.download.downloadQuality
                  )?.description
                }
              </p>
              <p className="text-xs text-muted-foreground">
                This applies to new downloads. A video YouTube only offers in lower quality is still
                downloaded at the best quality available.
              </p>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Loading download quality...</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            YouTube Authentication
          </CardTitle>
          <CardDescription>
            Use browser cookies when YouTube asks to sign in or verify you are not a bot
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {customizationPreferences ? (
            <>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Cookie Source</Label>
                <Select
                  value={customizationPreferences.download.cookiesFromBrowser}
                  onValueChange={(value) => {
                    if (isCookieSource(value)) {
                      updateCookieSourceMutation.mutate(value);
                    }
                  }}
                >
                  <SelectTrigger disabled={updateCookieSourceMutation.isPending}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COOKIE_SOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                If downloads fail with "Sign in to confirm you're not a bot", choose the browser
                where you are already signed in to YouTube, then retry the download.
              </p>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Loading YouTube authentication...</div>
          )}
        </CardContent>
      </Card>

      <LanguagePreferencesSection />
    </div>
  );
}
