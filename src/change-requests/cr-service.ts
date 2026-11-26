import { CrRepo } from './cr-repo';
import { ChangeRequest, Budget, PurchaseAgreement, COMMITTEE_DELTA_THRESHOLD } from './cr.types';
import { CrStatus, CrAction } from './cr.enums';
import { assertTransition } from './cr-state-machine';
import { computeTotals } from './cr-totals';
import { Errors } from '../common/errors';
import { ReqUser, canActOn } from '../common/policy';
import { round2 } from '../common/money.util';

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
		// findOne is already scoped by org and read policy, so unreadable CRs look missing.
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

	//** DRAFT -> SUBMITTED. Needs the update policy: org scope, or own CRs only. */
	submit(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!canActOn(user, cr, 'u')) throw Errors.forbidden('Cannot submit');
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

	/**
	 * Record a committee vote. Once every voter (the members, plus the head if not a member) has
	 * voted, the committee resolves: COMMITTEE_VOTING -> COMMITTEE_DECISION -> APPROVED | REJECTED.
	 * Approved only if a strict majority of the MEMBERS approved AND the head approved.
	 */
	castVote(user: ReqUser, id: string, decision: 'APPROVE' | 'REJECT', at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (decision !== 'APPROVE' && decision !== 'REJECT') throw Errors.validation('Invalid vote decision');
		if (!canActOn(user, cr, 'a')) throw Errors.forbidden('Cannot cast vote');
		// Four-eyes rule, same as approve: the creator cannot vote on their own CR.
		if (cr.createdBy === user.id) throw Errors.forbidden('Cannot vote on your own CR');
		// Voting is not a transition, so the guard won't check the status for us.
		if (cr.status !== CrStatus.COMMITTEE_VOTING) throw Errors.validation('CR is not in committee voting status');
		const committee = cr.committee;
		if (!committee) throw Errors.validation('Committee data missing for CR');
		const isVoter = committee.members.includes(user.id) || committee.head === user.id;
		if (!isVoter) throw Errors.forbidden('User is not on the committee');
		if (committee.votes.some((v) => v.userId === user.id)) throw Errors.conflict('User has already voted');

		// Record the vote and its audit entry (a vote is not a status change, so transition() won't audit it).
		committee.votes = [...committee.votes, { userId: user.id, decision, at }];
		cr.audit = [...cr.audit, { action: CrAction.CAST_VOTE, byUserId: user.id, at, note: decision }];

		// Everyone who may vote: the members, plus the head if the head is not a member.
		const voterCount = committee.members.includes(committee.head) ? committee.members.length : committee.members.length + 1;
		if (committee.votes.length < voterCount) return this.repo.save(cr); // still waiting for votes

		// Majority counts MEMBERS only: strictly more than half must approve.
		const majority = Math.floor(committee.members.length / 2) + 1;
		const memberApprovals = committee.votes.filter((v) => v.decision === 'APPROVE' && committee.members.includes(v.userId)).length;
		// The head must also confirm with an APPROVE vote.
		const headApproved = committee.votes.some((v) => v.userId === committee.head && v.decision === 'APPROVE');
		const approved = memberApprovals >= majority && headApproved;

		// Both steps are legal and audited.
		this.transition(cr, CrStatus.COMMITTEE_DECISION, CrAction.RESOLVE_COMMITTEE, user.id, at, 'All votes received');
		this.transition(
			cr,
			approved ? CrStatus.APPROVED : CrStatus.REJECTED,
			CrAction.RESOLVE_COMMITTEE,
			user.id,
			at,
			approved ? 'Committee approved the CR' : 'Committee rejected the CR',
		);
		committee.resolvedAt = at;
		return this.repo.save(cr);
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

	/**
	 * Any non-terminal status -> REJECTED (terminal). A reviewer says no to the change.
	 * The budget is never touched: only `apply` spends budget.
	 */
	reject(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		// Rejecting is a review decision, so it needs the approve policy.
		if (!canActOn(user, cr, 'a')) throw Errors.forbidden('Cannot reject');

		// The guard allows REJECTED from any non-terminal status and throws for terminal ones.
		// `transition` also appends the audit entry.
		this.transition(cr, CrStatus.REJECTED, CrAction.REJECT, user.id, at);
		return this.repo.save(cr);
	}

	/**
	 * APPROVED -> APPLIED. Checks the budget can cover a positive delta, then books the delta against
	 * the budget and writes the change into the agreement.
	 */
	apply(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!canActOn(user, cr, 'x')) throw Errors.forbidden('Cannot apply');

		// Look up and validate everything that can fail before changing anything.
		const agreement = this.agreements.get(cr.agreementId);
		if (!agreement) throw Errors.notFound('Agreement not found');
		const budget = this.budgets.get(agreement.budgetId);
		if (!budget) throw Errors.notFound('Budget not found');
		if (agreement.orgCode !== cr.orgCode || budget.orgCode !== cr.orgCode) {
			throw Errors.forbidden('Agreement and budget must belong to the same organization as the CR');
		}

		// Recompute from the agreement: the totals stored on the CR may be stale.
		const totals = computeTotals(agreement, cr);
		// Only a positive delta consumes budget. A delta equal to the balance is allowed.
		if (totals.delta > 0 && totals.delta > budget.balance) throw Errors.insufficientBudget();

		// Guarded transition (throws unless the CR is APPROVED). It runs BEFORE any budget change so a
		// failed apply can never spend budget.
		this.transition(cr, CrStatus.APPLIED, CrAction.APPLY, user.id, at);

		// Book the delta (a negative delta releases budget). Keeps balance = allocated - booked - spent.
		budget.booked = round2(budget.booked + totals.delta);
		budget.balance = round2(budget.balance - totals.delta);

		// Write the approved change into the agreement.
		const { lineItems, newEndDate } = cr.draftChanges;
		if (lineItems && lineItems.length) agreement.lineItems = lineItems.map((li) => ({ ...li }));
		if (newEndDate) agreement.endDate = newEndDate;
		agreement.total = totals.newTotal;

		cr.totals = totals;
		return this.repo.save(cr);
	}

	/** Read a single CR. */
	get(user: ReqUser, id: string): ChangeRequest {
		return this.getOrThrow(user, id);
	}

	/** List the CRs this user is allowed to see. Honor the user's read scope (u/w/o). */
	list(user: ReqUser): ChangeRequest[] {
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
