import { round2 } from '../src/common/money.util';

describe('round2', () => {
	it('rounds down when the third decimal is below 5', () => {
		expect(round2(1.234)).toBe(1.23);
	});

	it('rounds up when the third decimal is 5 or above', () => {
		expect(round2(1.237)).toBe(1.24);
	});
});
