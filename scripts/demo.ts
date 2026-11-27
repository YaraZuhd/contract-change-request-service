import { makeService, makeCommitteeCr } from '../test/helpers';

const at = '2026-11-27T10:00:00Z';
const step = (label: string, status: string) => console.log(`  ${label.padEnd(36)} -> ${status}`);

console.log('\n1) Small change (delta +500): one approver, then apply');
{
	const { service, users, budgets } = makeService();
	const { alice, mona } = users;
	const b = budgets.get('BUD-1');
	console.log(`  budget before: booked ${b?.booked}, balance ${b?.balance}`);
	step('alice submits', service.submit(alice, 'CR-DRAFT', at).status);
	const sent = service.sendForApproval(alice, 'CR-DRAFT', at);
	step(`alice sends (delta ${sent.totals.delta})`, sent.status);
	step('mona approves', service.approve(mona, 'CR-DRAFT', at).status);
	step('mona applies', service.apply(mona, 'CR-DRAFT', at).status);
	console.log(`  budget after:  booked ${b?.booked}, balance ${b?.balance}`);
}

console.log('\n2) Large change (delta +1500): committee vote');
{
	const { service, users, crId } = makeCommitteeCr();
	step('after send (routed to committee)', service.get(users.alice, crId).status);
	step('carl votes APPROVE', service.castVote(users.carl, crId, 'APPROVE', at).status);
	step('dina (head) votes APPROVE', service.castVote(users.dina, crId, 'APPROVE', at).status);
}

console.log('\n3) Rejection');
{
	const { service, users } = makeService();
	step('mona rejects CR-PENDING-SMALL', service.reject(users.mona, 'CR-PENDING-SMALL', at).status);
	try {
		service.reject(users.mona, 'CR-PENDING-SMALL', at);
	} catch (e) {
		console.log(`  rejecting again is refused: ${(e as { code?: string }).code}`);
	}
}

console.log('\n4) Return for edits');
{
	const { service, users } = makeService();
	const cr = service.returnToDraft(users.mona, 'CR-PENDING-SMALL', at);
	step('mona returns CR-PENDING-SMALL', cr.status);
	console.log(`  approvals reset: ${cr.approvals.length}, audit entries kept: ${cr.audit.length}`);
}
console.log('');