import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type SyncPairingCodeProps = {
  pairingCode: string;
};

// "ABCD2345" → "ABCD-2345": easier to read off the screen; the mobile app ignores the dash.
const formatPairingCode = (code: string): string => code.replace(/^(.{4})(.+)$/, "$1-$2");

export function SyncPairingCode({ pairingCode }: SyncPairingCodeProps): React.JSX.Element {
  const queryClient = useQueryClient();

  const resetMutation = useMutation({
    mutationFn: () => trpcClient.sync.resetPairingCode.mutate(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sync", "status"] });
      toast.success("New pairing code created. Enter it on your mobile devices to reconnect.");
    },
    onError: (error) => toast.error(`Failed to reset pairing code: ${String(error)}`),
  });

  return (
    <div>
      <Label className="text-xs text-muted-foreground">Pairing Code</Label>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 rounded bg-background px-3 py-2 font-mono text-lg font-bold tracking-widest">
          {formatPairingCode(pairingCode)}
        </code>
        <Button
          size="icon"
          variant="outline"
          title="Create a new code (paired devices must re-enter it)"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Enter this code in the mobile app&apos;s Connect screen. Only devices with the code can read
        or change your library.
      </p>
    </div>
  );
}
