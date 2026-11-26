import { CrStatus } from '../src/change-requests/cr.enums';
import { ReqUser } from '../src/common/policy';
import { codeOf, makeService } from './helpers';

describe('submit ownership', () => {
	it('refuses a user with the own-CRs update policy submitting a colleague CR', () => {
		const { service } = makeService();
		// Can read the whole org, but may only update CRs they created.
		const eve: ReqUser = { id: 'eve', orgCode: 'org-alpha', workspaceIds: ['ws-1'], policies: ['cr_r_o', 'cr_u_u'] };

		// CR-DRAFT was created by alice, not eve.
		expect(codeOf(() => service.submit(eve, 'CR-DRAFT', '2026-11-26T10:00:00Z'))).toBe('FORBIDDEN');
		expect(service.get(eve, 'CR-DRAFT').status).toBe(CrStatus.DRAFT);
	});

	it('lets the creator submit their own CR', () => {
		const { service, users } = makeService();

		const result = service.submit(users.alice, 'CR-DRAFT', '2026-11-26T10:00:00Z');

		expect(result.status).toBe(CrStatus.SUBMITTED);
	});
});
