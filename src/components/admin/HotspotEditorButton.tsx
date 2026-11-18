"use client";

import type { Doc } from "convex/_generated/dataModel";
import { MapPin } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "./DisabledReason";
import type { HotspotEditorDialog } from "./HotspotEditorDialog";

type Room = Doc<"tourScenes">;

export function HotspotEditorButton({ room, rooms }: { room: Room; rooms: Room[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<"loading" | "failed" | typeof HotspotEditorDialog>("loading");

  async function loadEditor() {
    setEditor("loading");
    try {
      const { HotspotEditorDialog } = await import("./HotspotEditorDialog");
      setEditor(() => HotspotEditorDialog);
    } catch {
      setEditor("failed");
    }
  }

  function openEditor() {
    openRef.current = true;
    setOpen(true);
    if (typeof editor !== "function") void loadEditor();
  }

  function closeEditor() {
    openRef.current = false;
    setOpen(false);
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    // Replacing the loading dialog with the editor moves focus into the editor.
    // Only a dismissal should move it back to the room's button.
    if (!openRef.current) trigger.current?.focus();
  }

  const Editor = typeof editor === "function" ? editor : null;
  return (
    <>
      <DisabledReason reason={rooms.length < 2 && "Add another room first: hotspots move guests between rooms."}>
        <Button ref={trigger} size="sm" variant="outline" disabled={rooms.length < 2} onClick={openEditor}>
          <MapPin aria-hidden className="size-4" />
          Edit hotspots ({room.hotspots.length})
        </Button>
      </DisabledReason>
      {open && Editor ? (
        <Editor room={room} rooms={rooms} onClose={closeEditor} onCloseAutoFocus={restoreFocus} />
      ) : open ? (
        <Dialog open onOpenChange={(next) => !next && closeEditor()}>
          <DialogContent onCloseAutoFocus={restoreFocus}>
            <DialogTitle>Hotspots · {room.name}</DialogTitle>
            {editor === "failed" ? (
              <>
                <DialogDescription role="alert">The visual hotspot editor could not be loaded.</DialogDescription>
                <Button className="justify-self-start" size="sm" onClick={() => void loadEditor()}>Try again</Button>
              </>
            ) : (
              <DialogDescription className="flex items-center gap-2" role="status">
                <Spinner aria-hidden />
                Loading visual hotspot editor…
              </DialogDescription>
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
