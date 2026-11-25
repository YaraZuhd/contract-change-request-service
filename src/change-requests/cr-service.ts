import { CrRepo } from './cr-repo';
import { ChangeRequest, Budget, PurchaseAgreement, COMMITTEE_DELTA_THRESHOLD } from './cr.types';
import { CrStatus, CrAction } from './cr.enums';
import { assertTransition } from './cr-state-machine';
import { computeTotals } from './cr-totals';
import { Errors } from '../common/errors';
import { ReqUser, canActOn, hasPolicy } from '../common/policy';

/**
 * Orchestrates CR actions. The transition + audit helper is provided; the action methods are
 * STUBS for you to implement (see `../../CANDIDATE_BRIEF.md`). Make the workflow correct, safe,
 * and complete.
 */
export class CrService {
	constructor(
		private readonly repo: CrRepo,
		private readonly agreements: Map<string, PurchaseAgreement>,
		private readonly budgets: Map<string, Budget>,
		// Committee membership used when routing large changes to a vote (Task 3).
		private readonly committeeConfig?: { members: string[]; head: string },
	) {}

	/** Load a CR for this user or throw NOT_FOUND. */
	private getOrThrow(user: ReqUser, id: string): ChangeRequest {
		const cr = this.repo.findOne(user, id);
		if (!cr) throw Errors.notFound(`CR ${id} not found`);
		return cr;
	}

	/** Apply a legal transition and append an immutable audit entry. Provided helper. */
	private transition(cr: ChangeRequest, to: CrStatus, action: CrAction, byUserId: string, at: string, note?: string): void {
		assertTransition(cr.status, to);
		cr.status = to;
		cr.audit = [...cr.audit, { action, byUserId, at, note }];
	}

	// ---- Actions to implement -------------------------------------------------------------

	submit(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!hasPolicy(user, 'cr_u_u') && !hasPolicy(user, 'cr_u_o')) throw Errors.forbidden('Cannot submit');
		this.transition(cr, CrStatus.SUBMITTED, CrAction.SUBMIT, user.id, at);
		return this.repo.save(cr);
	}

	/**
	 * SUBMITTED -> PENDING_APPROVAL. Small changes (|delta| <= threshold) stay pending for a single
	 * approver; larger ones are routed straight on to COMMITTEE_VOTING.
	 */
	sendForApproval(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!canActOn(user, cr, 'u')) throw Errors.forbidden('Cannot send for approval');

		// Validate and compute everything that can fail before mutating the CR.
		const agreement = this.agreements.get(cr.agreementId);
		if (!agreement) throw Errors.notFound('Agreement not found');
		const totals = computeTotals(agreement, cr);
		const config = this.committeeConfig;
		const needsCommittee = Math.abs(totals.delta) > COMMITTEE_DELTA_THRESHOLD;
		if (needsCommittee && !config) throw Errors.validation('Committee config not provided');

		// Guarded transition: throws if the CR is not SUBMITTED.
		this.transition(cr, CrStatus.PENDING_APPROVAL, CrAction.SEND_FOR_APPROVAL, user.id, at);
		cr.totals = totals;

		// Large change: route to the committee. Both steps are legal and audited.
		if (needsCommittee && config) {
			this.transition(cr, CrStatus.COMMITTEE_VOTING, CrAction.SEND_FOR_APPROVAL, user.id, at, 'Routed to committee for approval');
			cr.committee = { members: config.members, head: config.head, votes: [] };
		}

		return this.repo.save(cr);
	}

	/**
	 * PENDING_APPROVAL -> APPROVED by a single approver. Committee CRs are never approved here;
	 * they are resolved through committee votes.
	 */
	approve(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!canActOn(user, cr, 'a')) throw Errors.forbidden('Cannot approve');
		// Four-eyes rule: someone other than the creator must approve.
		if (cr.createdBy === user.id) throw Errors.forbidden('Cannot approve your own CR');
		if (cr.status === CrStatus.COMMITTEE_VOTING) {
			throw Errors.validation('Committee CRs must be resolved via committee resolution');
		}

		// Re-check the delta now: the agreement may have changed since the CR was sent for approval
		// (e.g. another CR was applied), and a CR that is now large must not be approved by one person.
		const agreement = this.agreements.get(cr.agreementId);
		if (!agreement) throw Errors.notFound('Agreement not found');
		const totals = computeTotals(agreement, cr);
		if (Math.abs(totals.delta) > COMMITTEE_DELTA_THRESHOLD) {
			throw Errors.conflict('The data changed since the CR was sent for approval; committee approval is required');
		}

		// Guarded transition (throws unless the CR is PENDING_APPROVAL); it also appends the audit entry.
		this.transition(cr, CrStatus.APPROVED, CrAction.APPROVE, user.id, at);
		cr.totals = totals;
		cr.approvals = [...cr.approvals, { userId: user.id, action: CrAction.APPROVE, at }];
		return this.repo.save(cr);
	}

	castVote(user: ReqUser, id: string, decision: 'APPROVE' | 'REJECT', at: string): ChangeRequest {
		// TODO: only committee members may vote; resolve on majority + head decision.
		throw Errors.validation('castVote not implemented');
	}

	/**
	 * PENDING_APPROVAL -> RETURNED -> DRAFT. A reviewer sends the CR back for edits, so approval
	 * progress starts over. The audit trail still keeps the full history.
	 */
	returnToDraft(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		// Returning is a review decision, so it needs the approve policy.
		if (!canActOn(user, cr, 'a')) throw Errors.forbidden('Cannot return to draft');

		// Both steps are legal and audited. The first throws unless the CR is PENDING_APPROVAL
		// (committee CRs cannot be returned).
		this.transition(cr, CrStatus.RETURNED, CrAction.RETURN, user.id, at);
		this.transition(cr, CrStatus.DRAFT, CrAction.RETURN, user.id, at, 'Returned to draft for edits');

		// Reset approval progress only after the transitions succeed.
		cr.approvals = [];
		cr.committee = undefined;
		return this.repo.save(cr);
	}

	reject(user: ReqUser, id: string, at: string): ChangeRequest {
		// TODO: legal transition to REJECTED (terminal); budget untouched; audit.
		throw Errors.validation('reject not implemented');
	}

	apply(user: ReqUser, id: string, at: string): ChangeRequest {
		// TODO: require APPROVED + cr_x_* policy; check budget.balance covers a positive delta else
		//       INSUFFICIENT_BUDGET; update budget, set APPLIED, audit. Recompute totals from the
		//       agreement.
		throw Errors.validation('apply not implemented');
	}

	/** Read a single CR. */
	get(user: ReqUser, id: string): ChangeRequest {
		return this.getOrThrow(user, id);
	}

	/** List the CRs this user is allowed to see. Honor the user's read scope (u/w/o). */
	list(user: ReqUser): ChangeRequest[] {
		// TODO: org scoping happens in the repo; narrow further by the caller's read scope.
		return this.repo.list(user);
	}

	/** Recompute and persist totals for a CR (used by tests and before routing). Provided. */
	recomputeTotals(user: ReqUser, id: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		const agreement = this.agreements.get(cr.agreementId);
		if (!agreement) throw Errors.notFound('Agreement not found');
		cr.totals = computeTotals(agreement, cr);
		return this.repo.save(cr);
	}
}
