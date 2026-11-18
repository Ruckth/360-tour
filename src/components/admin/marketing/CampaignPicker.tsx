"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { marketingErrorText } from "./marketing-format";
import type { CampaignOption, MarketingActions } from "./types";

const NEW_CAMPAIGN = "__new";

/**
 * A campaign select whose last option, "+ New campaign", opens a name field in place. The new
 * campaign is saved with `saveCampaign` (as a draft, like the Campaigns page) and selected.
 */
export function CampaignPicker({
  id,
  value,
  onChange,
  campaigns,
  onCreate,
  defaults,
  disabled,
  invalid,
  describedBy,
  placeholder = "Choose a campaign",
}: {
  id: string;
  value: string;
  onChange: (campaignId: string) => void;
  campaigns: readonly CampaignOption[];
  /** Left out when the role can't create campaigns: the option isn't offered. */
  onCreate?: MarketingActions["saveCampaign"];
  /** What a campaign made here reports as, and its suggested name. */
  defaults: { name: string; source: string; medium: string };
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(defaults.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A campaign made here is listed at once, before the campaign list catches up with it.
  const [made, setMade] = useState<CampaignOption[]>([]);
  const all = [...campaigns, ...made.filter((campaign) => !campaigns.some((other) => other._id === campaign._id))];
  const live = all.filter((campaign) => campaign.status !== "archived" || campaign._id === value);

  async function create() {
    if (!onCreate) return;
    if (!name.trim()) {
      setError("Name the campaign");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const campaignId = await onCreate({ name: name.trim(), source: defaults.source, medium: defaults.medium });
      setMade((current) => [...current, { _id: campaignId, name: name.trim(), status: "draft" }]);
      onChange(campaignId);
      setCreating(false);
    } catch (cause) {
      setError(marketingErrorText(cause, "Couldn’t create the campaign."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Select
        value={creating ? NEW_CAMPAIGN : value || undefined}
        onValueChange={(next) => {
          // The hidden native select reports "" while an option is still mounting; that's not a choice.
          if (!next) return;
          if (next === NEW_CAMPAIGN) {
            setCreating(true);
            setName(defaults.name);
            setError("");
          } else {
            setCreating(false);
            onChange(next);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-10 w-full" aria-invalid={invalid ? true : undefined} aria-describedby={describedBy}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {live.map((campaign) => (
            <SelectItem key={campaign._id} value={campaign._id}>
              {campaign.name}
            </SelectItem>
          ))}
          {onCreate ? (
            <SelectItem value={NEW_CAMPAIGN} className="border-t border-border font-medium">
              + New campaign
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {creating ? (
        <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <label htmlFor={`${id}-new`} className="text-xs font-medium text-muted-foreground">
            New campaign name · reports as {defaults.source} · {defaults.medium}
          </label>
          <div className="flex gap-2">
            <Input
              id={`${id}-new`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                // Inside another form, Enter creates the campaign instead of submitting that form.
                if (event.key === "Enter") {
                  event.preventDefault();
                  void create();
                }
              }}
              autoComplete="off"
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-new-error` : undefined}
            />
            <Button type="button" size="sm" className="h-10" disabled={saving} onClick={() => void create()}>
              {saving ? <Spinner label="Creating" className="text-current" /> : null}
              Create
            </Button>
          </div>
          {error ? (
            <p id={`${id}-new-error`} role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
