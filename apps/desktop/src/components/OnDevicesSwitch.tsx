import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Switches a List on or off for devices. Switching off says how many Videos leave every Device.
export function OnDevicesSwitch({
  listId,
  listName,
  className,
}: {
  listId: string;
  listName: string;
  className?: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [leavingCount, setLeavingCount] = useState<number | null>(null);

  const switchedOnQuery = useQuery({
    queryKey: ["onDevices", "switchedOn"],
    queryFn: () => trpcClient.onDevices.listSwitchedOn.query(),
  });
  const isOn = switchedOnQuery.data?.includes(listId) ?? false;

  const setOnDevices = useMutation({
    mutationFn: (on: boolean) => trpcClient.onDevices.setListOnDevices.mutate({ listId, on }),
    onSuccess: (_result, on) => {
      queryClient.invalidateQueries({ queryKey: ["onDevices"] });
      toast.success(
        on ? `"${listName}" will go to your Devices` : `"${listName}" is off your Devices`
      );
    },
  });

  const handleChange = async (on: boolean): Promise<void> => {
    if (on) {
      setOnDevices.mutate(true);
      return;
    }
    const count = await trpcClient.onDevices.countLeavingIfSwitchedOff.query({ listId });
    if (count === 0) {
      setOnDevices.mutate(false);
    } else {
      setLeavingCount(count);
    }
  };

  return (
    <>
      <label
        className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
        onClick={(e) => e.stopPropagation()}
      >
        <Smartphone className="h-3.5 w-3.5" />
        On devices
        <Switch
          checked={isOn}
          disabled={switchedOnQuery.isLoading || setOnDevices.isPending}
          onCheckedChange={handleChange}
          aria-label={`${listName} on devices`}
        />
      </label>

      <AlertDialog open={leavingCount !== null} onOpenChange={() => setLeavingCount(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take "{listName}" off your Devices?</AlertDialogTitle>
            <AlertDialogDescription>
              {leavingCount} {leavingCount === 1 ? "Video" : "Videos"} will be removed from your
              phone and TV the next time they connect. Videos pulled on a Device itself stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep on Devices</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setLeavingCount(null);
                setOnDevices.mutate(false);
              }}
            >
              Remove from Devices
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
