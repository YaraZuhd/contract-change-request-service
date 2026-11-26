import { CrStatus } from '../src/change-requests/cr.enums';
import { codeOf, makeCommitteeCr } from './helpers';

describe('Vote', () => {
	it('a non-committee member cannot vote', () => {
		const { service, users, crId } = makeCommitteeCr();
		const mona = users.mona;

		expect(codeOf(() => service.castVote(mona, crId, 'APPROVE', '2026-11-26T14:00:00Z'))).toBe('FORBIDDEN');
		expect(service.get(mona, crId).committee?.votes.length).toBe(0);
	});

	it('a double vote from the same committee member is refused', () => {
		const { service, users, crId } = makeCommitteeCr();
		const carl = users.carl;

		service.castVote(carl, crId, 'APPROVE', '2026-11-26T14:00:00Z');
		expect(codeOf(() => service.castVote(carl, crId, 'REJECT', '2026-11-26T15:00:00Z'))).toBe('CONFLICT');
		expect(service.get(carl, crId).committee?.votes.length).toBe(1);
		expect(service.get(carl, crId).committee?.votes[0].decision).toBe('APPROVE');
	});

	it('the committee approves a CR', () => {
		const { service, users, crId, budgets } = makeCommitteeCr();
		const carl = users.carl;
		const dina = users.dina;

		service.castVote(carl, crId, 'APPROVE', '2026-11-26T14:00:00Z');
		const result = service.castVote(dina, crId, 'APPROVE', '2026-11-26T15:00:00Z');

		expect(result.status).toBe(CrStatus.APPROVED);
		expect(service.get(carl, crId).status).toBe(CrStatus.APPROVED);
		expect(result.committee?.resolvedAt).toBe('2026-11-26T15:00:00Z');
		expect(budgets.get('BUD-1')?.booked).toBe(8000); // only apply spends budget
	});

	it('the committee rejects a CR when the head votes REJECT', () => {
		const { service, users, crId, budgets } = makeCommitteeCr();
		const carl = users.carl;
		const dina = users.dina;

		service.castVote(carl, crId, 'APPROVE', '2026-11-26T14:00:00Z');
		const result = service.castVote(dina, crId, 'REJECT', '2026-11-26T15:00:00Z');

		expect(result.status).toBe(CrStatus.REJECTED);
		expect(service.get(carl, crId).status).toBe(CrStatus.REJECTED);
		expect(budgets.get('BUD-1')?.booked).toBe(8000);
	});
});
