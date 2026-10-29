"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import type { ComponentProps } from "react";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { PhotoPickerButton } from "@/components/admin/PhotoPickerButton";
import { usePhotoUpload } from "@/components/admin/usePhotoUpload";

/** A staff member's round avatar as a photo picker. */
export function StaffAvatarPhotoButton({
  staff,
  avatarClassName,
  ...props
}: Omit<ComponentProps<typeof PhotoPickerButton>, "photoUrl" | "name" | "unnamed" | "thumb" | "title" | "description" | "shape"> & {
  staff: Pick<Doc<"staff">, "name" | "avatarUrl" | "color">;
  avatarClassName?: string;
}) {
  const name = staff.name.trim();
  return (
    <PhotoPickerButton
      {...props}
      photoUrl={staff.avatarUrl}
      name={name}
      unnamed="new staff member"
      thumb={<StaffAvatar staff={staff} className={avatarClassName} />}
      title={name ? `${name}’s photo` : "Staff photo"}
      description="Shown as a round avatar wherever this person appears."
    />
  );
}

/** Staff list avatar: a picked photo is uploaded and saved right away. */
export function StaffListPhotoButton({ staff, onError }: { staff: Doc<"staff">; onError: (message: string) => void }) {
  const updateStaff = useMutation(api.adminServices.updateStaff);
  const saveWithPhoto = usePhotoUpload();
  return (
    <StaffAvatarPhotoButton
      staff={staff}
      avatarClassName="size-10"
      onError={onError}
      onPhoto={(photo) => saveWithPhoto(photo, (avatarStorageId) => updateStaff({ staffId: staff._id, avatarStorageId }))}
      onRemove={() => updateStaff({ staffId: staff._id, avatarStorageId: null })}
    />
  );
}
