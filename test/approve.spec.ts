import { CrStatus } from '../src/change-requests/cr.enums';
import { codeOf, makeService } from './helpers';

describe('approve CR', () => {
	it('approves a CR with a single approver', () => {
		const { service, users } = makeService();
		const mona = users.mona;

		const cr = service.get(mona, 'CR-PENDING-SMALL');
		const result = service.approve(mona, cr.id, '2026-11-26T11:00:00Z');
		expect(result.status).toBe(CrStatus.APPROVED);
		expect(result.approvals.length).toEqual(1);
		expect(result.approvals[0].userId).toBe('mona');
	});

	it('refuses an approval from the CR creator (four-eyes)', () => {
		const { service, users } = makeService();
		const mona = users.mona;

		const cr = service.get(mona, 'CR-PENDING-SMALL');
		cr.createdBy = 'mona'; // simulate that mona created the CR
		expect(codeOf(() => service.approve(mona, cr.id, '2026-11-26T11:30:00Z'))).toBe('FORBIDDEN');
		expect(cr.status).toBe(CrStatus.PENDING_APPROVAL);
	});

	it('a committee CR can not be approved by a single approver', () => {
		const { service, users } = makeService();
		const alice = users.alice;

		const cr = service.get(alice, 'CR-DRAFT');
		cr.draftChanges.lineItems = [
			{ sku: 'A', quantity: 13, unitPrice: 500 }, // 6500
			{ sku: 'B', quantity: 30, unitPrice: 100 }, // 3000 -> new total 9500, delta 1500
		];
		service.submit(alice, cr.id, '2026-11-26T12:37:50Z');
		service.sendForApproval(alice, cr.id, '2026-11-26T13:00:00Z');

		expect(codeOf(() => service.approve(users.mona, cr.id, '2026-11-26T14:00:00Z'))).toBe('VALIDATION');
		expect(service.get(users.mona, cr.id).status).toBe(CrStatus.COMMITTEE_VOTING);
	});

	it('refuses a single approver when the delta is now above 1000', () => {
		const { service, users } = makeService();
		const mona = users.mona;

		expect(codeOf(() => service.approve(mona, 'CR-PENDING-LARGE', '2026-11-26T17:00:00Z'))).toBe('CONFLICT');
		expect(service.get(mona, 'CR-PENDING-LARGE').status).toBe(CrStatus.PENDING_APPROVAL);
	});
});
