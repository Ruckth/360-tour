import type { Id } from '../../_generated/dataModel';
import type { DurableTool } from '../../messaging/model';

export type ToolArgs = Record<string, unknown>;

export type ToolContext = {
  sessionId: Id<'conversations'>;
  siteUrl?: string;
  /** When the current AI turn started; lets two-step tools require a guest reply in between. */
  turnStartedAt: number;
  deadlineAt?: number;
  durableTool?: DurableTool;
  bookingProposal?: string;
  serviceProposal?: string;
};
