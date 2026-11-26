"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import { useId, useState, type ComponentProps, type FormEvent } from "react";
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
import { cn } from "@/lib/utils";
import {
  isBranchChangedError,
  slugifyBranchValue,
  validateBranchProfile,
  type BranchProfileDraft,
  type BranchProfileProblem,
  type BranchRow,
} from "./branch-profile";

function emptyDraft(defaultLegalName = "", defaultTaxId = ""): BranchProfileDraft {
  return { name: "", slug: "", legalName: defaultLegalName, taxId: defaultTaxId, branchCode: "", address: "" };
}

function draftFromBranch(branch: BranchRow): BranchProfileDraft {
  return {
    name: branch.name,
    slug: branch.slug,
    legalName: branch.issuer.legalName,
    taxId: branch.issuer.taxId,
    branchCode: branch.issuer.branchCode,
    address: branch.issuer.address,
  };
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
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<BranchProfileProblem | null>(null);
  const [error, setError] = useState("");
  const [staleError, setStaleError] = useState(false);

  // The live row: newer than the loaded draft once the conflicting change has arrived.
  const hasNewerRevision = isEdit && branch.revision > loadedRevision;
  const showReloadHint = staleError || hasNewerRevision;
  const errorId = `${id}-error`;

  function updateField<K extends keyof BranchProfileDraft>(field: K, value: BranchProfileDraft[K]) {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (!isEdit && field === "name" && !slugTouched) next.slug = slugifyBranchValue(value);
      return next;
    });
    setProblem(null);
    setError("");
  }

  /** Label, input and the error wiring for one profile field. */
  function field(name: keyof BranchProfileDraft, label: string, props: ComponentProps<typeof Input> & { wrapperClassName?: string } = {}) {
    const { wrapperClassName, onChange, ...rest } = props;
    const invalid = problem?.field === name;
    return (
      <div className={cn("grid gap-1.5", wrapperClassName)}>
        <Label htmlFor={`${id}-${name}`} className="text-xs font-normal text-muted-foreground">
          {label}
        </Label>
        <Input
          id={`${id}-${name}`}
          required
          disabled={saving}
          value={draft[name]}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={onChange ?? ((event) => updateField(name, event.target.value))}
          {...rest}
        />
      </div>
    );
  }

  function reloadLatest() {
    if (!branch) return;
    setDraft(draftFromBranch(branch));
    setLoadedRevision(branch.revision);
    setStaleError(false);
    setProblem(null);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const found = validateBranchProfile(draft);
    if (found) {
      setProblem(found);
      setError("");
      return;
    }
    const issuer = {
      legalName: draft.legalName.trim(),
      taxId: draft.taxId.trim(),
      branchCode: draft.branchCode.trim(),
      address: draft.address.trim(),
    };
    const name = draft.name.trim();
    const slug = draft.slug.trim().toLowerCase();
    setSaving(true);
    setError("");
    setStaleError(false);
    try {
      if (isEdit) {
        await updateBranch({ branchId: branch._id, revision: loadedRevision, name, slug, issuer });
        onSaved(`Saved changes to ${name}.`);
      } else {
        // The server derives the internal key from the slug.
        await createBranch({ name, slug, issuer });
        onSaved(`Created ${name} in Setup.`);
      }
      onClose();
    } catch (err) {
      if (isEdit && isBranchChangedError(err)) setStaleError(true);
      setError(errorText(err, isEdit ? "Couldn’t save this branch." : "Couldn’t create this branch."));
    } finally {
      setSaving(false);
    }
  }

  const message = problem?.message ?? (staleError ? "" : error);

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit ${branch.name}` : "Add branch"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update this branch’s profile and receipt issuer details."
            : "It starts in Setup: hidden from guests, with sales off. Assigned people can configure and preview it."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
        {showReloadHint ? (
          <Alert variant="warning">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{staleError && error ? error : "This branch changed. Reload it and try again."}</span>
              <Button type="button" variant="outline" size="sm" disabled={saving || !hasNewerRevision} onClick={reloadLatest}>
                {hasNewerRevision ? "Reload latest" : "Loading latest…"}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {field("name", "Branch name", { autoFocus: true, maxLength: 120, placeholder: "Phuket" })}
          {field("slug", "URL slug", {
            placeholder: "phuket", maxLength: 80,
            onChange: (event) => {
              setSlugTouched(true);
              updateField("slug", event.target.value);
            },
          })}
        </div>

        <fieldset className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Receipt issuer</legend>
          {field("legalName", "Issuer legal name", { maxLength: 120, placeholder: "360 Tour Co., Ltd.", wrapperClassName: "sm:col-span-2" })}
          {field("taxId", "Tax ID", { maxLength: 32, placeholder: "0105560000000" })}
          {field("branchCode", "Issuer branch code (5 digits)", { inputMode: "numeric", maxLength: 5, placeholder: "00001" })}
          {field("address", "Issuer address", { placeholder: "88 Rawai Rd, Phuket 83130", wrapperClassName: "sm:col-span-2" })}
        </fieldset>

        {!isEdit ? (
          <p className="text-[13px] text-muted-foreground">
            Asia/Bangkok time and THB, like every branch. You can assign people and configure this branch next.
          </p>
        ) : null}

        {message ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {message}
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
