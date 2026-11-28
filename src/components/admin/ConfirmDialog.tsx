"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  returnFocusTo?: () => HTMLElement | null;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;
type PendingConfirm = ConfirmOptions & { resolve: (confirmed: boolean) => void };

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Promise-based replacement for `window.confirm`:
 * `if (!(await confirm({ title: "Delete?", destructive: true }))) return;`
 */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>.");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const returnFocusTo = useRef<ConfirmOptions["returnFocusTo"]>(undefined);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  function settle(confirmed: boolean) {
    returnFocusTo.current = pending?.returnFocusTo;
    pending?.resolve(confirmed);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent
          role="alertdialog"
          showCloseButton={false}
          className="max-w-md"
          onCloseAutoFocus={(event) => {
            const target = returnFocusTo.current?.();
            returnFocusTo.current = undefined;
            if (target) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            {pending?.description ? (
              <DialogDescription>{pending.description}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">Confirm this action.</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(false)}>
              {pending?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              type="button"
              variant={pending?.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
