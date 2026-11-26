import { computeTotals } from '../src/change-requests/cr-totals';
import { PurchaseAgreement } from '../src/change-requests/cr.types';

describe('computeTotals delta', () => {
	const agreement: PurchaseAgreement = {
		id: 'AGR-1',
		orgCode: 'org-alpha',
		vendorOrgCode: 'vendor-x',
		currency: 'USD',
		status: 'ACTIVE',
		budgetId: 'BUD-1',
		endDate: '2026-12-31',
		lineItems: [{ sku: 'A', quantity: 1, unitPrice: 60 }], // baseline 60.00
		total: 60,
	};

	it('computes a positive delta when the quantity goes up', () => {
		const t = computeTotals(agreement, { draftChanges: { lineItems: [{ sku: 'A', quantity: 2, unitPrice: 60 }] } });
		expect(t.baselineTotal).toBe(60);
		expect(t.newTotal).toBe(120);
		expect(t.delta).toBe(60);
	});

	it('computes a positive delta when the price goes up', () => {
		const t = computeTotals(agreement, { draftChanges: { lineItems: [{ sku: 'A', quantity: 1, unitPrice: 70 }] } });
		expect(t.baselineTotal).toBe(60);
		expect(t.newTotal).toBe(70);
		expect(t.delta).toBe(10);
	});

	it('computes a negative delta when the price goes down', () => {
		const t = computeTotals(agreement, { draftChanges: { lineItems: [{ sku: 'A', quantity: 1, unitPrice: 40 }] } });
		expect(t.baselineTotal).toBe(60);
		expect(t.newTotal).toBe(40);
		expect(t.delta).toBe(-20);
	});

	it('treats an empty line-item list as "no item change" (known limitation)', () => {
		// An empty list falls back to the current items, so a CR cannot remove all items.
		const t = computeTotals(agreement, { draftChanges: { lineItems: [] } });
		expect(t.newTotal).toBe(60);
		expect(t.delta).toBe(0);
	});
});
