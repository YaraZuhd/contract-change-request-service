import { CrStatus } from '../src/change-requests/cr.enums';
import { codeOf, makeService } from './helpers';

describe('apply CR', () => {
	it('applies an approved CR', () => {
		const { service, agreements, budgets, users } = makeService();
		const mona = users.mona;

		const cr = service.get(mona, 'CR-PENDING-SMALL');
		const approvedCR = service.approve(mona, cr.id, '2026-11-26T11:00:00Z');
		const appliedCR = service.apply(mona, approvedCR.id, '2026-11-26T12:00:00Z');
		const budget = budgets.get('BUD-1');
		const agreement = agreements.get('AGR-1');

		expect(budget?.booked).toBe(8500);
		expect(agreement?.total).toBe(8500);
		expect(budget?.balance).toBe(9500);
		expect(budget?.allocated).toBe(20000);
		expect(appliedCR.status).toBe(CrStatus.APPLIED);
		expect(appliedCR.approvals.length).toEqual(1);
	});

	it('insufficient budget prevents applying a CR', () => {
		const { service, agreements, budgets, users } = makeService();
		const mona = users.mona;
		const agreement = agreements.get('AGR-1');
		if (agreement) agreement.budgetId = 'BUD-LOW';

		service.approve(mona, 'CR-PENDING-SMALL', '2026-11-26T11:00:00Z');
		expect(codeOf(() => service.apply(mona, 'CR-PENDING-SMALL', '2026-11-26T12:00:00Z'))).toBe('INSUFFICIENT_BUDGET');
		const budget = budgets.get('BUD-LOW');
		expect(budget?.booked).toBe(0);
		expect(budget?.balance).toBe(100);
		expect(budget?.allocated).toBe(100);
		expect(service.get(mona, 'CR-PENDING-SMALL').status).toBe(CrStatus.APPROVED);
	});

	it('allows applying when the delta equals the balance', () => {
		const { service, agreements, budgets, users } = makeService();
		const mona = users.mona;
		const agreement = agreements.get('AGR-1');
		if (agreement) agreement.budgetId = 'BUD-LOW';

		const cr = service.get(mona, 'CR-PENDING-SMALL');
		cr.draftChanges.lineItems = [
			{ sku: 'A', quantity: 10, unitPrice: 500 }, // 5000
			{ sku: 'B', quantity: 31, unitPrice: 100 }, // 3100 -> new total 8100, delta +100
		];
		service.approve(mona, 'CR-PENDING-SMALL', '2026-11-26T11:00:00Z');
		service.apply(mona, 'CR-PENDING-SMALL', '2026-11-26T12:00:00Z');
		const budget = budgets.get('BUD-LOW');
		expect(budget?.booked).toBe(100);
		expect(budget?.balance).toBe(0);
		expect(budget?.allocated).toBe(100);
		expect(service.get(mona, 'CR-PENDING-SMALL').status).toBe(CrStatus.APPLIED);
	});

	it('refuses to apply the same CR twice', () => {
		const { service, budgets, users } = makeService();
		const mona = users.mona;

		service.approve(mona, 'CR-PENDING-SMALL', '2026-11-26T11:00:00Z');
		service.apply(mona, 'CR-PENDING-SMALL', '2026-11-26T12:00:00Z');
		expect(codeOf(() => service.apply(mona, 'CR-PENDING-SMALL', '2026-11-26T13:00:00Z'))).toBe('TERMINAL_STATE');
		expect(budgets.get('BUD-1')?.booked).toBe(8500);
	});
});
