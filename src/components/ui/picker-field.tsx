"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";

function clearPickerError(trigger: HTMLButtonElement | null) {
  if (!trigger?.hasAttribute("data-picker-invalid")) return;
  trigger.removeAttribute("data-picker-invalid");
  trigger.removeAttribute("aria-invalid");
  trigger.removeAttribute("aria-errormessage");
}

export type PickerValueProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
};

export function usePickerValue({
  value,
  defaultValue = "",
  onValueChange,
}: PickerValueProps) {
  const [internal, setInternal] = useState(defaultValue);
  return {
    value: value ?? internal,
    reset: () => {
      if (value === undefined) setInternal(defaultValue);
    },
    change: (next: string) => {
      if (value === undefined) setInternal(next);
      onValueChange?.(next);
    },
  };
}

/** A validation-enabled text control bridges custom pickers to native forms.
 * Unlike a hidden input, it participates in required/constraint validation.
 */
export function PickerFormControl({
  name,
  value,
  disabled,
  problem,
  focusRef,
  onReset,
}: {
  name?: string;
  value: string;
  disabled?: boolean;
  problem: string;
  focusRef: RefObject<HTMLButtonElement | null>;
  onReset: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    input.current?.setCustomValidity(problem);
    if (!problem) clearPickerError(focusRef.current);
  }, [problem, focusRef]);
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => {
      onReset();
      setInvalid(false);
      clearPickerError(focusRef.current);
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [onReset, focusRef]);
  return (
    <>
      <input
        ref={input}
        type="text"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={value}
        disabled={disabled}
        onChange={() => {}}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          const trigger = focusRef.current;
          trigger?.setAttribute("data-picker-invalid", "true");
          trigger?.setAttribute("aria-invalid", "true");
          trigger?.setAttribute("aria-errormessage", errorId);
          // Native reporting can focus a later text input after this handler.
          // Restore the first invalid picker once that synchronous work ends.
          setTimeout(() => {
            const control = input.current;
            const firstInvalid = control?.form?.querySelector(
              "input:invalid, select:invalid, textarea:invalid",
            );
            if (firstInvalid === control) focusRef.current?.focus();
          }, 0);
        }}
      />
      {invalid && problem ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
    </>
  );
}
