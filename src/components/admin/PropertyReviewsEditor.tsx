"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { format } from "date-fns";
import { BadgeCheck, Pencil, Plus, Star, Trash2, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { useConfirm } from "./ConfirmDialog";
import { Field, IMAGE_ACCEPT, NATIVE_SELECT, SaveBar, Section, Thumb, useImageUpload, useSaver } from "./property-form";

type Review = Doc<"reviews">;

/** Real guest reviews for one villa. The rating and count guests see are computed from these. */
export function PropertyReviewsEditor({ propertyId }: { propertyId: Id<"properties"> }) {
  const data = useQuery(api.adminReviews.list, { propertyId });
  const remove = useMutation(api.adminReviews.remove);
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Review | "new" | null>(null);
  const [error, setError] = useState("");

  async function deleteReview(review: Review) {
    if (!(await confirm({ title: `Delete ${review.authorName}'s review?`, confirmLabel: "Delete", destructive: true }))) return;
    setError("");
    try {
      await remove({ reviewId: review._id });
    } catch (err) {
      setError(errorText(err, "Could not delete the review."));
    }
  }

  return (
    <Section
      title="Reviews"
      description={
        data?.summary
          ? `${data.summary.overallRating.toFixed(1)} ★ from ${data.summary.totalReviews} review${data.summary.totalReviews === 1 ? "" : "s"}, computed from the reviews below.`
          : "Enter reviews guests actually left (e.g. on Airbnb or Google). The villa's rating is computed from them."
      }
      actions={
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden className="size-4" />
          Add review
        </Button>
      }
    >
      {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
      {!data ? (
        <ul role="status" aria-label="Loading reviews" className="grid gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className="grid gap-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-40" />
            </li>
          ))}
        </ul>
      ) : data.reviews.length ? (
        <ul className="divide-y divide-border">
          {data.reviews.map((review) => (
            <li key={review._id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-foreground">
                  <Stars rating={review.rating} />
                  {review.title || "Untitled"}
                  {review.verified ? <BadgeCheck aria-label="Verified stay" className="size-4 text-gold-text" /> : null}
                </p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{review.body}</p>
                <p className="text-xs text-muted-foreground">
                  {review.authorName}
                  {[review.authorCity, review.authorCountry].filter(Boolean).length
                    ? ` · ${[review.authorCity, review.authorCountry].filter(Boolean).join(", ")}`
                    : ""}{" "}
                  · {formatDate(review.date)}
                  {review.photos?.length ? ` · ${review.photos.length} photo${review.photos.length === 1 ? "" : "s"}` : ""}
                </p>
              </div>
              <Button size="icon" variant="ghost" className="size-9" onClick={() => setEditing(review)} aria-label={`Edit ${review.authorName}'s review`}>
                <Pencil aria-hidden className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-9" onClick={() => void deleteReview(review)} aria-label={`Delete ${review.authorName}'s review`}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-start gap-3">
          <p className="text-sm text-muted-foreground">No reviews yet. Villas without reviews show no rating.</p>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus aria-hidden className="size-4" />
            Add the first review
          </Button>
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add review" : "Edit review"}</DialogTitle>
            <DialogDescription>Only enter reviews a guest really wrote.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <ReviewForm
              key={editing === "new" ? "new" : editing._id}
              propertyId={propertyId}
              review={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function ReviewForm({ propertyId, review, onDone }: { propertyId: Id<"properties">; review: Review | null; onDone: () => void }) {
  const create = useMutation(api.adminReviews.create);
  const update = useMutation(api.adminReviews.update);
  const upload = useImageUpload();
  const save = useSaver();
  const fileInput = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState(review?.photos ?? []);
  const [verified, setVerified] = useState(review?.verified ?? true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function addPhotos(files: File[]) {
    setUploading(true);
    setUploadError("");
    try {
      for (const file of files) {
        const url = await upload(file, "photo");
        setPhotos((current) => [...current, url]);
      }
    } catch (err) {
      setUploadError(errorText(err, "Could not upload the photo."));
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const fields = {
      authorName: text("authorName"),
      authorCity: text("authorCity"),
      authorCountry: text("authorCountry"),
      rating: Number(text("rating")),
      title: text("title"),
      body: text("body"),
      date: text("date"),
      verified,
      photos,
    };
    const ok = await save.run(() => (review ? update({ reviewId: review._id, ...fields }) : create({ propertyId, ...fields })));
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Guest name" htmlFor="rv-name">
          <Input id="rv-name" name="authorName" defaultValue={review?.authorName} required />
        </Field>
        <Field label="City" htmlFor="rv-city">
          <Input id="rv-city" name="authorCity" defaultValue={review?.authorCity} />
        </Field>
        <Field label="Country" htmlFor="rv-country">
          <Input id="rv-country" name="authorCountry" defaultValue={review?.authorCountry} />
        </Field>
        <Field label="Rating" htmlFor="rv-rating">
          <select id="rv-rating" name="rating" defaultValue={review?.rating ?? 5} className={NATIVE_SELECT}>
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {"★".repeat(value)} ({value})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date of stay or review" htmlFor="rv-date">
          <Input id="rv-date" name="date" type="date" defaultValue={review?.date ?? format(new Date(), "yyyy-MM-dd")} required />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
          <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} className="size-4 accent-foreground" />
          Verified stay
        </label>
      </div>
      <Field label="Title (optional)" htmlFor="rv-title">
        <Input id="rv-title" name="title" defaultValue={review?.title} />
      </Field>
      <Field label="Review" htmlFor="rv-body">
        <Textarea id="rv-body" name="body" defaultValue={review?.body} required className="min-h-32" />
      </Field>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Photos (optional)</p>
        {photos.length ? (
          <div className="flex flex-wrap gap-2">
            {photos.map((photo) => (
              <div key={photo} className="relative">
                <Thumb src={photo} className="size-16" />
                <button
                  type="button"
                  onClick={() => setPhotos((current) => current.filter((item) => item !== photo))}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Remove photo"
                >
                  <Trash2 aria-hidden className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            void addPhotos(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <Button type="button" size="sm" variant="outline" className="w-fit" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <Spinner className="text-current" /> : <Upload aria-hidden className="size-4" />}
          Upload photos
        </Button>
        {uploadError ? <p role="alert" className="text-sm text-destructive">{uploadError}</p> : null}
      </div>
      <SaveBar save={save} label={review ? "Save review" : "Add review"} />
    </form>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star key={value} aria-hidden className={cn("size-3.5", value <= rating ? "fill-gold text-gold-text" : "text-muted-foreground/40")} />
      ))}
    </span>
  );
}

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : format(parsed, "d MMM yyyy");
}
