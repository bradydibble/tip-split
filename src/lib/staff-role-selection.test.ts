import { describe, expect, it } from 'vitest';
import { readRoleAssignments, roleFieldName } from './staff-role-selection';

describe('per-shift staff role selection', () => {
  it('pairs roles by staff ID when form order and database order differ', () => {
    const formData = new FormData();

    // Visual order after regrouping: Aiden, then Aine.
    formData.append('included', '29');
    formData.append(roleFieldName(29), 'Kitchen');
    formData.append('included', '20');
    formData.append(roleFieldName(20), 'FOH');

    // Database order: Aine, then Aiden.
    const includedInDatabaseOrder = ['20', '29'];
    const result = readRoleAssignments(formData, includedInDatabaseOrder);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.roles.get('20')).toBe('FOH');
    expect(result.roles.get('29')).toBe('Kitchen');
  });

  it('rejects a missing role for an included staff member', () => {
    const result = readRoleAssignments(new FormData(), ['8']);
    expect(result).toEqual({ ok: false, error: 'missing' });
  });

  it('rejects a role outside the supported split categories', () => {
    const formData = new FormData();
    formData.set(roleFieldName(8), 'Manager');

    const result = readRoleAssignments(formData, ['8']);
    expect(result).toEqual({ ok: false, error: 'invalid' });
  });
});
