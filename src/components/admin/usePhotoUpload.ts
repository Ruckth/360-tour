"use client";

import { useAction, useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";

/**
 * Uploads an optimized photo, then runs `save` with its storage ID (a staff or service create/update).
 * If the save fails the upload is dropped again; a cron catches any that slip through.
 */
export function usePhotoUpload() {
  const uploadPhoto = useAction(api.services.commands.uploadStaffAvatar.uploadStaffAvatar);
  const discardUpload = useMutation(api.services.commands.discardStaffAvatarUpload.discardStaffAvatarUpload);
  return async function saveWithPhoto<T>(photo: Blob, save: (storageId: Id<"_storage">) => Promise<T>): Promise<T> {
    const storageId = await uploadPhoto({ bytes: await photo.arrayBuffer(), contentType: photo.type });
    try {
      return await save(storageId);
    } catch (err) {
      await discardUpload({ storageId }).catch(() => null);
      throw err;
    }
  };
}
