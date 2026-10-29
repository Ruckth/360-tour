"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  message: string;
  children: ReactNode;
  /** When this changes (e.g. the search text), a failed part tries again by itself. */
  resetKey?: string;
};

/**
 * Keeps a failed list or search (Orders, customer or booking search) inside its dialog with a
 * retry, instead of replacing the whole checkout with the page error. Retrying remounts the
 * children, so their queries subscribe again.
 */
export class InlineErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="grid gap-3 text-sm">
        <p className="text-destructive">{this.props.message}</p>
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => this.setState({ failed: false })}>
          Try again
        </Button>
      </div>
    );
  }
}
