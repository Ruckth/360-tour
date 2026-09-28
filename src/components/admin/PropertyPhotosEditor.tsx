"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { ArrowDown, ArrowUp, Loader2, Trash2, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "./ConfirmDialog";
import { IMAGE_ACCEPT, SaveStatus, Section, Thumb, useImageUpload, useSaver } from "./property-form";

/** Villa photo gallery: upload or link photos, reorder them, remove them. The first photo is the cover. */
export function PropertyPhotosEditor({ property }: { property: Doc<"properties"> }) {
  const update = useMutation(api.properties.update);
  const upload = useImageUpload();
  const confirm = useConfirm();
  const save = useSaver();
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState("");
  const images = property.images;

  const saveImages = (next: string[]) => save.run(() => update({ propertyId: property._id, images: next }));

  function move(index: number, by: -1 | 1) {
    const next = [...images];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    void saveImages(next);
  }

  async function remove(index: number) {
    if (!(await confirm({ title: "Remove this photo?", confirmLabel: "Remove", destructive: true }))) return;
    void saveImages(images.filter((_, i) => i !== index));
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    await save.run(async () => {
      const urls: string[] = [];
      try {
        for (const [index, file] of files.entries()) {
          setUploading(`Uploading ${index + 1} of ${files.length}…`);
          urls.push(await upload(file, "photo"));
        }
      } finally {
        setUploading("");
        // Keep whatever finished, even if a later file failed.
        if (urls.length) await update({ propertyId: property._id, images: [...images, ...urls] });
      }
    });
  }

  function addUrl(event: FormEvent) {
    event.preventDefault();
    void saveImages([...images, url.trim()]).then((ok) => ok && setUrl(""));
  }

  return (
    <Section
      title="Photos"
      description="JPEG, PNG or WebP up to 8 MB. The first photo is the cover on the villa card and page."
      actions={
        <>
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              void uploadFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <Button size="sm" disabled={save.saving} onClick={() => fileInput.current?.click()}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload aria-hidden className="size-4" />}
            {uploading || "Upload photos"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {images.length ? (
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image, index) => (
              <li key={`${image}-${index}`} className="overflow-hidden rounded-lg border border-border">
                <div className="relative">
                  <Thumb src={image} className="aspect-[3/2] w-full rounded-none" />
                  {index === 0 ? <Badge variant="gold" className="absolute left-2 top-2">Cover</Badge> : null}
                </div>
                <div className="flex items-center gap-1 p-2">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={image}>
                    {index + 1}. {image.split("/").pop()}
                  </p>
                  <Button size="icon" variant="ghost" className="size-8" disabled={save.saving || index === 0} onClick={() => move(index, -1)} aria-label="Move earlier">
                    <ArrowUp aria-hidden className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8" disabled={save.saving || index === images.length - 1} onClick={() => move(index, 1)} aria-label="Move later">
                    <ArrowDown aria-hidden className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-8" disabled={save.saving} onClick={() => void remove(index)} aria-label="Remove photo">
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No photos yet. Upload some or add one by URL.</p>
        )}
        <form onSubmit={addUrl} className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Input
            aria-label="Photo URL"
            placeholder="https://… or /public-path.webp"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="min-w-60 flex-1"
            required
          />
          <Button type="submit" variant="outline" disabled={save.saving}>
            Add by URL
          </Button>
        </form>
        <div className="flex justify-end">
          <SaveStatus save={save} />
        </div>
      </div>
    </Section>
  );
}
