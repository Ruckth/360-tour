/** Legacy tables remain for archives and rollback; they can never publish new answers. */
export function legacyQaRetired(): boolean {
  return true;
}

export function assertLegacyQaWritable(): void {
  throw new Error(
    "Saved answers and Q&A are retired. Maintain Business facts instead.",
  );
}
