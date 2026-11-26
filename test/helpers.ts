import { CrRepo } from '../src/change-requests/cr-repo';
import { CrService } from '../src/change-requests/cr-service';
import { buildSeed } from '../src/seed';

/** A fresh service with its own copy of the seed, so tests never affect each other. */
export function makeService() {
	const seed = buildSeed();
	const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

	const repo = new CrRepo();
	repo.seed(copy(seed.changeRequests));
	const agreements = new Map(copy([...seed.agreements]));
	const budgets = new Map(copy([...seed.budgets]));

	const service = new CrService(repo, agreements, budgets, copy(seed.committeeConfig));
	return { service, repo, agreements, budgets, users: seed.users };
}

/** Run a function that should throw, and return the error's code (undefined if nothing was thrown). */
export function codeOf(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (e) {
		return (e as { code?: string }).code;
	}
	return undefined;
}

/** A fresh service with one CR already routed to the committee (delta 1500). */
export function makeCommitteeCr() {
	const ctx = makeService();
	const { service, users } = ctx;

	const cr = service.get(users.alice, 'CR-DRAFT');
	cr.draftChanges.lineItems = [
		{ sku: 'A', quantity: 13, unitPrice: 500 },
		{ sku: 'B', quantity: 30, unitPrice: 100 },
	];
	service.submit(users.alice, cr.id, '2026-11-26T08:00:00Z');
	service.sendForApproval(users.alice, cr.id, '2026-11-26T09:00:00Z');

	return { ...ctx, crId: cr.id };
}
