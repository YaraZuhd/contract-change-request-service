import { CrStatus } from '../src/change-requests/cr.enums';
import { codeOf, makeService } from './helpers';

describe('org isolation', () => {
	it('hides a CR from users of another organization', () => {
		const { service, users } = makeService();
		const bob = users.bob; // org-beta
		const cr = service.get(users.alice, 'CR-PENDING-SMALL'); // org-alpha
		expect(codeOf(() => service.get(bob, cr.id))).toBe('NOT_FOUND');
		expect(codeOf(() => service.approve(bob, cr.id, '2026-11-26T08:00:00Z'))).toBe('NOT_FOUND');
		expect(service.get(users.alice, cr.id).status).toBe(CrStatus.PENDING_APPROVAL);
	});

	it('lists only the CRs of the callers organization', () => {
		const { service, users } = makeService();
		const crs = service.list(users.bob);
		expect(crs.length).toBe(1);
		expect(crs[0].id).toBe('CR-BETA');
		expect(crs[0].orgCode).toBe('org-beta');
	});
});
