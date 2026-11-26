import { makeService } from './helpers';
import { CrStatus } from '../src/change-requests/cr.enums';

describe('sendForApproval routing', () => {
	it('keeps a delta of exactly 1000 with a single approver', () => {
		const { service, users } = makeService();
		const alice = users.alice;

		const cr = service.get(alice, 'CR-DRAFT');
		cr.draftChanges.lineItems = [
			{ sku: 'A', quantity: 12, unitPrice: 500 }, // 6000
			{ sku: 'B', quantity: 30, unitPrice: 100 }, // 3000 -> new total 9000, delta 1000
		];

		service.submit(alice, cr.id, '2026-11-26T08:37:50Z');
		const result = service.sendForApproval(alice, cr.id, '2026-11-26T10:00:00Z');

		expect(result.totals.delta).toBe(1000);
		expect(result.status).toBe(CrStatus.PENDING_APPROVAL);
	});

	it('routes a delta above 1000 to the committee', () => {
		const { service, users } = makeService();
		const alice = users.alice;

		const cr = service.get(alice, 'CR-DRAFT');
		cr.draftChanges.lineItems = [
			{ sku: 'A', quantity: 13, unitPrice: 500 }, // 6500
			{ sku: 'B', quantity: 30, unitPrice: 100 }, // 3000 -> new total 9500, delta 1500
		];
		service.submit(alice, cr.id, '2026-11-26T08:37:50Z');
		const result = service.sendForApproval(alice, cr.id, '2026-11-26T10:00:00Z');

		expect(result.totals.delta).toBe(1500);
		expect(result.committee?.members).toEqual(['carl', 'dina']);
		expect(result.status).toBe(CrStatus.COMMITTEE_VOTING);
	});

	it('routes a delta of 1000.01 to the committee', () => {
		const { service, users } = makeService();
		const alice = users.alice;

		const cr = service.get(alice, 'CR-DRAFT');
		cr.draftChanges.lineItems = [
			{ sku: 'A', quantity: 12, unitPrice: 500 }, // 6000
			{ sku: 'B', quantity: 30, unitPrice: 100 }, // 3000
			{ sku: 'C', quantity: 1, unitPrice: 0.01 }, // 0.01 -> new total 9000.01, delta 1000.01
		];
		service.submit(alice, cr.id, '2026-11-26T08:37:50Z');
		const result = service.sendForApproval(alice, cr.id, '2026-11-26T10:00:00Z');

		expect(result.totals.delta).toBe(1000.01);
		expect(result.status).toBe(CrStatus.COMMITTEE_VOTING);
	});

	it('keeps a delta of 0 with a single approver', () => {
		const { service, users } = makeService();
		const alice = users.alice;

		const cr = service.get(alice, 'CR-DRAFT');
		cr.draftChanges.lineItems = [
			{ sku: 'A', quantity: 10, unitPrice: 500 }, // 5000
			{ sku: 'B', quantity: 30, unitPrice: 100 }, // 3000 -> new total 8000, delta 0
		];
		service.submit(alice, cr.id, '2026-11-26T08:37:50Z');
		const result = service.sendForApproval(alice, cr.id, '2026-11-26T10:00:00Z');

		expect(result.totals.delta).toBe(0);
		expect(result.status).toBe(CrStatus.PENDING_APPROVAL);
	});
});
