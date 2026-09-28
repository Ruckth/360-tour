"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { IMAGE_TYPES, uploadProblem, type UploadKind } from "convex/lib/imageUploads";
import { Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

// Small building blocks shared by the villa admin screens.

export type PropertyStatus = Doc<"properties">["status"];
export const STATUS_LABELS: Record<PropertyStatus, string> = { active: "Active", draft: "Draft", archived: "Archived" };

export const TEXTAREA =
  "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
export const NATIVE_SELECT = "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm";

export function Section({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export type Saver = ReturnType<typeof useSaver>;

/** Tracks one save action: spinner, readable error, "Saved". */
export function useSaver() {
  const [state, setState] = useState({ saving: false, error: "", saved: false });
  async function run(action: () => Promise<unknown>) {
    setState({ saving: true, error: "", saved: false });
    try {
      await action();
      setState({ saving: false, error: "", saved: true });
      return true;
    } catch (err) {
      setState({ saving: false, error: errorText(err, "Could not save."), saved: false });
      return false;
    }
  }
  return { ...state, run };
}

export function SaveStatus({ save }: { save: Saver }) {
  if (save.error) return <p role="alert" className="text-sm text-destructive">{save.error}</p>;
  if (save.saved) return <p className="text-sm text-muted-foreground">Saved</p>;
  return null;
}

export function SaveBar({ save, compact, label = "Save", children }: { save: Saver; compact?: boolean; label?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-end gap-3", !compact && "border-t border-border pt-4")}>
      {children}
      <SaveStatus save={save} />
      <Button type="submit" size={compact ? "sm" : "default"} disabled={save.saving} className={cn(compact && "h-10")}>
        {save.saving ? <Loader2 className="size-4 animate-spin" /> : null}
        {label}
      </Button>
    </div>
  );
}

export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

/** Uploads a photo or panorama to Convex storage and returns its public URL. Throws a readable error. */
export function useImageUpload() {
  const generateUploadUrl = useMutation(api.adminProperties.generateUploadUrl);
  const saveUploadedImage = useMutation(api.adminProperties.saveUploadedImage);
  return async function upload(file: File, kind: UploadKind): Promise<string> {
    const problem = uploadProblem(kind, file.type, file.size);
    if (problem) throw new Error(`${file.name}: ${problem}`);
    const response = await fetch(await generateUploadUrl(), {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) throw new Error(`${file.name}: upload failed`);
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    const result = await saveUploadedImage({ storageId, kind });
    if ("error" in result) throw new Error(`${file.name}: ${result.error}`);
    return result.url;
  };
}

/** 360° panoramas are equirectangular (2:1); anything else looks stretched in the tour. */
export async function panoramaWarning(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const { width, height } = bitmap;
  bitmap.close();
  if (Math.abs(width / height - 2) <= 0.02) return null;
  return `${file.name} is ${width}×${height}, not 2:1. 360° panoramas should be twice as wide as they are tall, or the tour will look stretched.`;
}

/** Small cover-cropped preview for arbitrary admin URLs (next/image only allows known hosts). */
export function Thumb({ src, className }: { src?: string; className?: string }) {
  if (!src) return <span className={cn("block shrink-0 rounded-lg bg-muted", className)} />;
  // eslint-disable-next-line @next/next/no-img-element -- admin thumbnail from arbitrary URLs
  return <img src={src} alt="" loading="lazy" className={cn("shrink-0 rounded-lg bg-muted object-cover", className)} />;
}
