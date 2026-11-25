import { CrStatus, isTerminal } from './cr.enums';
import { Errors } from '../common/errors';

/**
 * Legal transitions for the CR state machine. See README diagram.
 *
 * The table lists the declared moves between statuses. REJECTED and CANCELLED are handled by a
 * general rule in `canTransition`: any non-terminal status can move to them.
 */
export const LEGAL_TRANSITIONS: Partial<Record<CrStatus, CrStatus[]>> = {
	[CrStatus.DRAFT]: [CrStatus.SUBMITTED, CrStatus.CANCELLED],
	[CrStatus.SUBMITTED]: [CrStatus.PENDING_APPROVAL, CrStatus.CANCELLED],
	[CrStatus.PENDING_APPROVAL]: [CrStatus.APPROVED, CrStatus.COMMITTEE_VOTING, CrStatus.RETURNED, CrStatus.REJECTED],
	[CrStatus.COMMITTEE_VOTING]: [CrStatus.COMMITTEE_DECISION],
	[CrStatus.COMMITTEE_DECISION]: [CrStatus.APPROVED, CrStatus.REJECTED],
	[CrStatus.APPROVED]: [CrStatus.APPLIED],
	[CrStatus.RETURNED]: [CrStatus.DRAFT],
};

export function canTransition(from: CrStatus, to: CrStatus): boolean {
	// 1. Terminal statuses are immutable: nothing can move out of them.
	if (isTerminal(from)) {
		return false;
	}
	// 2. Any non-terminal status can be rejected or cancelled. This relies on rule 1 running first.
	if (to === CrStatus.CANCELLED || to === CrStatus.REJECTED) {
		return true;
	}
	// 3. Otherwise the move must be declared in the table.
	return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

/** Throw a BusinessError if the transition from->to is not allowed. */
export function assertTransition(from: CrStatus, to: CrStatus): void {
	if (isTerminal(from)) {
		throw Errors.terminal(`Cannot move a ${from} change request to ${to}`);
	}
	// Reject moves that are not declared legal in LEGAL_TRANSITIONS.
	if (!canTransition(from, to)) {
		throw Errors.illegalTransition(`Illegal transition: ${from} -> ${to} is not allowed`);
	}
}
