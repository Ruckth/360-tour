"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import { useId, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldLabel as Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import {
  slugifyBranchValue,
  validateBranchProfile,
  type BranchProfileDraft,
  type BranchRow,
} from "./branch-status";

function emptyDraft(defaultLegalName = "", defaultTaxId = ""): BranchProfileDraft {
  return {
    key: "",
    name: "",
    slug: "",
    legalName: defaultLegalName,
    taxId: defaultTaxId,
    branchCode: "",
    address: "",
  };
}

function draftFromBranch(branch: BranchRow): BranchProfileDraft {
  return {
    key: branch.key,
    name: branch.name,
    slug: branch.slug,
    legalName: branch.issuer.legalName,
    taxId: branch.issuer.taxId,
    branchCode: branch.issuer.branchCode,
    address: branch.issuer.address,
  };
}

function isStaleBranchError(message: string): boolean {
  return message.toLowerCase().includes("this branch changed");
}

export function BranchProfileDialog({
  open,
  branch,
  defaultIssuer,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  branch: BranchRow | null;
  defaultIssuer?: { legalName: string; taxId: string };
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <BranchProfileDialogBody
          key={branch ? branch._id : "new-branch"}
          branch={branch}
          defaultIssuer={defaultIssuer}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function BranchProfileDialogBody({
  branch,
  defaultIssuer,
  onClose,
  onSaved,
}: {
  branch: BranchRow | null;
  defaultIssuer?: { legalName: string; taxId: string };
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const id = useId();
  const isEdit = branch !== null;
  const createBranch = useMutation(api.branches.branches.create);
  const updateBranch = useMutation(api.branches.branches.update);

  const [loadedRevision, setLoadedRevision] = useState<number>(branch?.revision ?? 0);
  const [draft, setDraft] = useState<BranchProfileDraft>(() =>
    branch ? draftFromBranch(branch) : emptyDraft(defaultIssuer?.legalName ?? "", defaultIssuer?.taxId ?? ""),
  );
  const [keyTouched, setKeyTouched] = useState(isEdit);
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [staleError, setStaleError] = useState(false);

  const hasNewerRevision = isEdit && branch.revision > loadedRevision;
  const showReloadHint = staleError || hasNewerRevision;

  function updateField<K extends keyof BranchProfileDraft>(field: K, value: BranchProfileDraft[K]) {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (!isEdit && field === "name") {
        const suggested = slugifyBranchValue(value);
        if (!keyTouched) next.key = suggested;
        if (!slugTouched) next.slug = suggested;
      }
      return next;
    });
    setError("");
  }

  function reloadLatest() {
    if (!branch) return;
    setDraft(draftFromBranch(branch));
    setLoadedRevision(branch.revision);
    setStaleError(false);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const problem = validateBranchProfile(draft, { requireKey: !isEdit });
    if (problem) {
      setError(problem);
      return;
    }
    const issuer = {
      legalName: draft.legalName.trim(),
      taxId: draft.taxId.trim(),
      branchCode: draft.branchCode.trim(),
      address: draft.address.trim(),
    };
    setSaving(true);
    setError("");
    setStaleError(false);
    try {
      if (isEdit) {
        await updateBranch({
          branchId: branch._id,
          revision: loadedRevision,
          name: draft.name.trim(),
          slug: draft.slug.trim().toLowerCase(),
          issuer,
        });
        onSaved(`Saved changes to ${draft.name.trim()}.`);
      } else {
        await createBranch({
          key: draft.key.trim().toLowerCase(),
          name: draft.name.trim(),
          slug: draft.slug.trim().toLowerCase(),
          issuer,
        });
        onSaved(`Created ${draft.name.trim()} in Setup.`);
      }
      onClose();
    } catch (err) {
      const message = errorText(err, isEdit ? "Couldn’t save this branch." : "Couldn’t create this branch.");
      if (isEdit && isStaleBranchError(message)) setStaleError(true);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit ${branch.name}` : "Add branch"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update this branch’s profile and receipt issuer details. The branch key can’t be changed."
            : "It starts in Setup: hidden from guests, with sales off. Assigned people can configure and preview it."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        {showReloadHint ? (
          <Alert variant="warning">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{staleError && error ? error : "This branch changed. Reload it and try again."}</span>
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={reloadLatest}>
                Reload latest
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-name`} className="text-xs font-normal text-muted-foreground">
              Branch name
            </Label>
            <Input
              id={`${id}-name`}
              required
              autoFocus
              disabled={saving}
              value={draft.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder="Phuket"
            />
          </div>

          {isEdit ? (
            <div className="grid gap-1.5">
              <span className="text-xs font-normal text-muted-foreground">Branch key</span>
              <p className="flex h-10 items-center rounded-lg border border-border bg-muted/40 px-3 font-mono text-sm text-muted-foreground">
                {branch.key}
              </p>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-key`} className="text-xs font-normal text-muted-foreground">
                Branch key
              </Label>
              <Input
                id={`${id}-key`}
                required
                disabled={saving}
                value={draft.key}
                onChange={(event) => {
                  setKeyTouched(true);
                  updateField("key", event.target.value);
                }}
                placeholder="phuket"
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-slug`} className="text-xs font-normal text-muted-foreground">
              URL slug
            </Label>
            <Input
              id={`${id}-slug`}
              required
              disabled={saving}
              value={draft.slug}
              onChange={(event) => {
                setSlugTouched(true);
                updateField("slug", event.target.value);
              }}
              placeholder="phuket"
            />
          </div>
        </div>

        <fieldset className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Receipt issuer</legend>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-legalName`} className="text-xs font-normal text-muted-foreground">
              Issuer legal name
            </Label>
            <Input
              id={`${id}-legalName`}
              required
              disabled={saving}
              value={draft.legalName}
              onChange={(event) => updateField("legalName", event.target.value)}
              placeholder="360 Tour Co., Ltd."
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-taxId`} className="text-xs font-normal text-muted-foreground">
              Tax ID
            </Label>
            <Input
              id={`${id}-taxId`}
              required
              disabled={saving}
              value={draft.taxId}
              onChange={(event) => updateField("taxId", event.target.value)}
              placeholder="0105560000000"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-branchCode`} className="text-xs font-normal text-muted-foreground">
              Issuer branch code (5 digits)
            </Label>
            <Input
              id={`${id}-branchCode`}
              required
              inputMode="numeric"
              maxLength={5}
              disabled={saving}
              value={draft.branchCode}
              onChange={(event) => updateField("branchCode", event.target.value)}
              placeholder="00001"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-address`} className="text-xs font-normal text-muted-foreground">
              Issuer address
            </Label>
            <Input
              id={`${id}-address`}
              required
              disabled={saving}
              value={draft.address}
              onChange={(event) => updateField("address", event.target.value)}
              placeholder="88 Rawai Rd, Phuket 83130"
            />
          </div>
        </fieldset>

        {!isEdit ? (
          <p className="text-[13px] text-muted-foreground">
            Asia/Bangkok time and THB, like every branch. You can assign people and configure this branch next.
          </p>
        ) : null}

        {error && !staleError ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner label="Saving branch" className="text-current" /> : null}
            {isEdit ? "Save changes" : "Create in Setup"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
