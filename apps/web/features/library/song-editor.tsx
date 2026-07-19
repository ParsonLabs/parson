"use client";

import { Button } from "@/components/ui/button";
import { ContextMenuItem } from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MetadataFields } from "./metadata-fields";
import { useMetadataEditor } from "./use-metadata-editor";

type Props = {
  song_id: string;
  label?: string;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  trigger?: "context" | "dropdown" | "none";
};

export default function SongEditor({
  song_id,
  label = "Edit metadata",
  trigger = "context",
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const {
    loaded,
    loading,
    open: isOpen,
    patch,
    save,
    saving,
    setOpen,
    update,
  } = useMetadataEditor({
    controlledOpen: open,
    onOpenChange,
    onSaved: router.refresh,
    songId: song_id,
  });

  const triggerNode =
    trigger === "context" ? (
      <ContextMenuItem
        onSelect={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Pencil className="size-4" />
        {label}
      </ContextMenuItem>
    ) : trigger === "dropdown" ? (
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Pencil className="size-4" />
        {label}
      </DropdownMenuItem>
    ) : null;

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {triggerNode}
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)] gap-5 p-6 sm:max-w-xl">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-base">Edit metadata</DialogTitle>
          <DialogDescription>
            Update the details people see most. Technical fields stay tucked
            away.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="min-h-0 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading metadata
              </div>
            ) : (
              <MetadataFields
                patch={patch}
                showAdvanced={showAdvanced}
                toggleAdvanced={() => setShowAdvanced((visible) => !visible)}
                update={update}
              />
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-9 text-zinc-400 hover:bg-white/[0.06] hover:text-white"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="h-9 bg-white px-4 text-black hover:bg-zinc-200"
              disabled={loading || saving || !loaded}
              type="submit"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? "Saving" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
