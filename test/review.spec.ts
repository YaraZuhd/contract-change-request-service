import { CrAction, CrStatus } from '../src/change-requests/cr.enums';
import { codeOf, makeService } from './helpers';

describe('review decisions', () => {
	it('returning a CR to draft resets the approvals and keeps the audit trail', () => {
		const { service, users } = makeService();
		const mona = users.mona;

		const result = service.returnToDraft(mona, 'CR-PENDING-SMALL', '2026-11-26T10:00:00Z');

		expect(result.status).toBe(CrStatus.DRAFT);
		expect(result.approvals).toEqual([]);
		expect(result.committee).toBeUndefined();
		// RETURN is logged twice: PENDING_APPROVAL -> RETURNED -> DRAFT
		expect(result.audit.map((a) => a.action)).toEqual([CrAction.RETURN, CrAction.RETURN]);
	});

	it('rejects a live CR, and a rejected CR cannot be rejected again', () => {
		const { service, users, budgets } = makeService();
		const mona = users.mona;

		const result = service.reject(mona, 'CR-PENDING-SMALL', '2026-11-26T10:00:00Z');
		expect(result.status).toBe(CrStatus.REJECTED);

		expect(codeOf(() => service.reject(mona, 'CR-PENDING-SMALL', '2026-11-26T11:00:00Z'))).toBe('TERMINAL_STATE');
		expect(budgets.get('BUD-1')?.booked).toBe(8000); // rejecting never touches the budget
	});
});
