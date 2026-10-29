"use client";

import type { Id } from "convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { usePhotoUpload } from "@/components/admin/usePhotoUpload";

type PhotoEdit =
  | { kind: "replace"; photo: Blob; previewUrl: string; saved: boolean }
  | { kind: "remove"; saved: boolean };

/** Keeps photo edits local until Save and owns the lifetime of their preview URLs. */
export function usePhotoDraft(originalUrl?: string) {
  const [edit, setEdit] = useState<PhotoEdit | null>(null);
  const uploadAndSave = usePhotoUpload();
  const previewUrl = edit?.kind === "replace" ? edit.previewUrl : undefined;

  useEffect(() => {
    if (previewUrl) return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function save<T>(persist: (storageId?: Id<"_storage"> | null) => Promise<T>): Promise<T> {
    const result = edit?.kind === "replace" && !edit.saved
      ? await uploadAndSave(edit.photo, persist)
      : await persist(edit?.kind === "remove" && !edit.saved ? null : undefined);
    // A later operation (such as adding time off) can fail after the profile was saved.
    // Retrying it must not upload the same photo again or overwrite a newer draft.
    setEdit((current) => current === edit && current ? { ...current, saved: true } : current);
    return result;
  }

  return {
    url: edit?.kind === "remove" ? undefined : previewUrl ?? originalUrl,
    changed: edit !== null && !edit.saved,
    removing: edit?.kind === "remove",
    choose(photo: Blob) {
      setEdit({ kind: "replace", photo, previewUrl: URL.createObjectURL(photo), saved: false });
    },
    remove() {
      setEdit({ kind: "remove", saved: false });
    },
    save,
  };
}
