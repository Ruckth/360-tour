import { lostStaffCapabilities, type StaffRole } from "convex/shared/staffTypes";

/** What a person loses, in Team's words, when their desk role goes from `from` to `to`. */
const LOST_AREAS: Partial<Record<ReturnType<typeof lostStaffCapabilities>[number], string>> = {
  operations: "Hotel, Spa, Chats, Leads and Business facts",
  approve: "approving cashier requests",
  manageTeam: "managing the team",
  settings: "Settings",
};

export function deskRoleReduction(from: StaffRole, to: StaffRole): string[] {
  return lostStaffCapabilities(from, to).flatMap((capability) => LOST_AREAS[capability] ?? []);
}

/** The Team people list's filters: everyone, pending invitations, one branch or one role. */
export type PeopleFilter = { kind: "all" } | { kind: "pending" } | { kind: "branch"; id: string } | { kind: "role"; role: PeopleRole };
export type PeopleRole = "owner" | "manager" | "cashier" | "marketing";

export type FilterablePerson = {
  email: string;
  role: "owner" | "manager" | "cashier" | null;
  branchIds: readonly string[];
  staffGrant: { claimed: boolean } | null;
  marketingGrant: { claimed: boolean } | null;
};

export function personIsPending(person: FilterablePerson): boolean {
  return person.role !== "owner" && [person.staffGrant, person.marketingGrant].some((grant) => grant && !grant.claimed);
}

export function matchesPeopleFilter(person: FilterablePerson, filter: PeopleFilter, search: string, label = person.email): boolean {
  const query = search.trim().toLowerCase();
  if (query && !`${label} ${person.email}`.toLowerCase().includes(query)) return false;
  switch (filter.kind) {
    case "all": return true;
    case "pending": return personIsPending(person);
    case "branch": return person.role !== "owner" && person.branchIds.includes(filter.id);
    case "role": return filter.role === "marketing" ? person.marketingGrant !== null : person.role === filter.role;
  }
}

/** Chip counts for the current search, so each chip says how many rows it would show. */
export function countPeople(people: readonly FilterablePerson[], filter: PeopleFilter, search: string, label?: (person: FilterablePerson) => string) {
  return people.filter((person) => matchesPeopleFilter(person, filter, search, label?.(person))).length;
}
