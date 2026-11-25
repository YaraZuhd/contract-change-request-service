import { ChangeRequest } from '../change-requests/cr.types';

/**
 * Policy-string RBAC + request-user model. Policies are `cr_{action}_{scope}` (see README).
 *
 * The request user carries the org code used for tenant scoping. Read scope (u/w/o) determines
 * which CRs the user may list/see; action policies gate create/update/approve/apply.
 */
export type ReadScope = 'u' | 'w' | 'o';

export type PolicyAction = 'c' | 'r' | 'u' | 'a' | 'x';

export interface ReqUser {
	id: string;
	orgCode: string;
	workspaceIds: string[];
	policies: string[]; // e.g. ['cr_c_u', 'cr_r_o', 'cr_a_o']
}

/** True if the user holds the exact policy string. */
export function hasPolicy(user: ReqUser, policy: string): boolean {
	return user.policies.includes(policy);
}

/** The user's highest read scope for CRs, or null if they cannot read CRs at all. */
export function crReadScope(user: ReqUser): ReadScope | null {
	if (hasPolicy(user, 'cr_r_o')) return 'o';
	if (hasPolicy(user, 'cr_r_w')) return 'w';
	if (hasPolicy(user, 'cr_r_u')) return 'u';
	return null;
}

/** True if the user's widest policy for this action covers the CR (org, workspace or own). */
export function canActOn(user: ReqUser, cr: ChangeRequest, action: PolicyAction): boolean {
	// Implementation for checking if user can perform action on CR
	if (cr.orgCode !== user.orgCode) return false; // User must belong to the same org as the CR

	const orgScopePolicy = `cr_${action}_o`;
	const workspaceScopePolicy = `cr_${action}_w`;
	const userScopePolicy = `cr_${action}_u`;

	if (hasPolicy(user, orgScopePolicy)) {
		return true; // User has org-wide permission
	}

	if (hasPolicy(user, workspaceScopePolicy) && user.workspaceIds.includes(cr.workspaceId)) {
		return true; // User has workspace-level permission and is in the same workspace
	}
	if (hasPolicy(user, userScopePolicy) && user.id === cr.createdBy) {
		return true; // User has user-level permission and is the owner of the CR
	}

	return false;
}
