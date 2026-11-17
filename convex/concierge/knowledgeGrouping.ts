type UnknownStatus = 'new' | 'resolved' | 'ignored';

export type GroupableUnknownQuestion = {
  normalizedQuestion: string;
  status: UnknownStatus;
  createdAt: number;
};

export type UnknownQuestionGroup<T extends GroupableUnknownQuestion> = {
  normalizedQuestion: string;
  rows: T[];
  count: number;
  counts: Record<UnknownStatus, number>;
  latestAt: number;
  /** The newest row still waiting ("new"), else the newest row overall. */
  latest: T;
};

/** Groups identical questions (same normalized text), most-asked first, then most recent. */
export function groupUnknownQuestions<T extends GroupableUnknownQuestion>(rows: T[]) {
  const groups = new Map<string, UnknownQuestionGroup<T>>();
  for (const row of rows) {
    let group = groups.get(row.normalizedQuestion);
    if (!group) {
      group = {
        normalizedQuestion: row.normalizedQuestion,
        rows: [],
        count: 0,
        counts: { new: 0, resolved: 0, ignored: 0 },
        latestAt: row.createdAt,
        latest: row
      };
      groups.set(row.normalizedQuestion, group);
    }
    group.rows.push(row);
    group.count++;
    group.counts[row.status]++;
    group.latestAt = Math.max(group.latestAt, row.createdAt);
    const latestIsNew = group.latest.status === 'new';
    const rowIsNew = row.status === 'new';
    if ((rowIsNew && !latestIsNew) || (rowIsNew === latestIsNew && row.createdAt > group.latest.createdAt)) {
      group.latest = row;
    }
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || right.latestAt - left.latestAt);
}
