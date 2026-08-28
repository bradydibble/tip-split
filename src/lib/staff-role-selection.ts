export const STAFF_ROLES = ['FOH', 'Kitchen', 'Bar', 'Busser'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function roleFieldName(staffId: number | string): string {
  return `role_${staffId}`;
}

type RoleAssignmentsResult =
  | { ok: true; roles: Map<string, StaffRole> }
  | { ok: false; error: 'missing' | 'invalid' };

/**
 * Read per-shift roles by staff ID. Role inputs may be rendered in any order,
 * including after live regrouping in the split form.
 */
export function readRoleAssignments(
  formData: FormData,
  includedStaffIds: Iterable<string>,
): RoleAssignmentsResult {
  const roles = new Map<string, StaffRole>();

  for (const staffId of includedStaffIds) {
    const submitted = formData.getAll(roleFieldName(staffId));
    if (submitted.length !== 1 || typeof submitted[0] !== 'string') {
      return { ok: false, error: 'missing' };
    }

    const role = submitted[0];
    if (!(STAFF_ROLES as readonly string[]).includes(role)) {
      return { ok: false, error: 'invalid' };
    }

    roles.set(staffId, role as StaffRole);
  }

  return { ok: true, roles };
}
