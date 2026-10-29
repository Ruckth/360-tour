import { Button } from "@/components/ui/button";

export function BookingAvailabilityNotice({
  loading,
  failed,
  dateError,
  retry,
}: {
  loading: boolean;
  failed: boolean;
  dateError: string;
  retry: () => void;
}) {
  return (
    <>
      {dateError ? (
        <p role="alert" className="text-sm text-destructive">
          {dateError}
        </p>
      ) : null}
      {failed ? (
        <div role="alert" className="text-sm text-destructive">
          Could not load availability. Unchecked dates cannot be booked.
          <Button type="button" variant="link" onClick={retry}>
            Retry availability
          </Button>
        </div>
      ) : loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking availability…
        </p>
      ) : null}
    </>
  );
}
