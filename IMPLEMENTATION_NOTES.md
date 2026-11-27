# Implementation Notes

## 1. What I changed

### Task 1: failing tests
- **Money rounding** (`money.util.ts`): `round2` used `Math.trunc`, so 3 × 6.669 = 20.007 became 20.00. It is now `Math.round(value * 100) / 100`.
- **Transition guard** (`cr-state-machine.ts`): `assertTransition` only checked terminal states, so DRAFT -> APPROVED was allowed. It now also checks `canTransition` and throws `ILLEGAL_TRANSITION`.
- I completed `LEGAL_TRANSITIONS`. `canTransition` has three ordered rules: terminal statuses can't move; any non-terminal status can move to REJECTED or CANCELLED (so I didn't repeat them in every row); everything else must be in the table.

### Task 2: approval flow (`cr-service.ts`)
- `sendForApproval`: SUBMITTED -> PENDING_APPROVAL and recomputes totals. If `|delta|` is above the threshold it moves on to COMMITTEE_VOTING and creates the committee; otherwise one approver is enough.
- `approve`: PENDING_APPROVAL -> APPROVED. The creator can't approve their own CR, committee CRs are refused, and the delta is re-checked because the agreement may have changed since the CR was sent.
- `returnToDraft`: PENDING_APPROVAL -> RETURNED -> DRAFT. Approvals and committee are reset; the audit trail keeps the history.
- `reject`: any non-terminal CR -> REJECTED. The budget is not touched.
- `apply`: APPROVED -> APPLIED. It recomputes totals, checks the budget covers a positive delta (`INSUFFICIENT_BUDGET`), then updates the budget and the agreement.

### Task 3: committee
- `castVote`: members and the head vote once each, not on their own CR, and every vote is audited. When all have voted: COMMITTEE_VOTING -> COMMITTEE_DECISION -> APPROVED or REJECTED. Approved only if more than half of the members approved and the head approved.

### Task 4: permissions
- `canActOn` (`policy.ts`) checks policy and scope (org / workspace / own) in one place.
- The repo's `scoped` helper keeps only CRs in the caller's organization that the caller may read. `findOne` and `list` both use it, so a CR the caller can't see gives `NOT_FOUND`, not `FORBIDDEN`.
- `submit` uses `canActOn(..., 'u')`, so a user with only the own-CRs policy can't submit a colleague's CR.

### Task 5: tests
- 28 new Jest tests in 9 files (33 with the provided ones), plus shared helpers in `test/helpers.ts`. See section 4.
- `npx ts-node scripts/demo.ts` prints a walkthrough of the main flows.

## 2. Domain model

A **Purchase Agreement** (buyer, vendor, line items, a budget) isn't edited directly. Changes go through a **Change Request (CR)** that belongs to one organization and carries the proposed changes, the totals (`baselineTotal`, `newTotal`, `delta`), approvals and an audit trail. A small change (`|delta|` at or below 1000) needs one approver; a large one goes to a committee vote. APPLIED, REJECTED and CANCELLED are terminal and immutable. Applying a CR books its delta against the agreement's **budget** (`allocated`, `booked`, `spent`, `balance`).

```
DRAFT -> SUBMITTED -> PENDING_APPROVAL -> APPROVED -> APPLIED
PENDING_APPROVAL -> COMMITTEE_VOTING -> COMMITTEE_DECISION -> APPROVED | REJECTED   (|delta| > threshold)
PENDING_APPROVAL -> RETURNED -> DRAFT
any non-terminal -> REJECTED | CANCELLED
```

Every move goes through one guarded door: the service's `transition` helper calls `assertTransition`, changes the status and appends an audit entry, so no action can skip a step.

## 3. Invariants I enforce (and how)

| Invariant | How it's enforced | Where |
|---|---|---|
| Only legal transitions happen | One guard checks every move against the table | `cr-state-machine.ts` |
| Terminal states are immutable | `canTransition` returns false from them | `cr-state-machine.ts` |
| Every status change is audited, append-only | A single `transition` helper | `cr-service.ts` |
| Money is rounded to the cent | `round2` in all totals | `money.util.ts`, `cr-totals.ts` |
| The budget is never overspent | Balance is checked first; the budget changes only after the guarded transition | `apply` |
| A CR can't be applied twice | The terminal-state guard stops it before the budget is touched | `apply` |
| Large changes go to a committee | Routing by `|delta|`; approval needs a majority plus the head | `sendForApproval`, `castVote` |
| Creators can't approve or vote on their own CR | Explicit check | `approve`, `castVote` |
| Actions respect policy and scope | `canActOn` | `policy.ts` |
| Organizations are isolated | `scoped` filters by `orgCode`; other orgs get `NOT_FOUND` | `cr-repo.ts`, `getOrThrow` |
| Users only see CRs their read scope allows | `scoped` also applies the read policy, so actions need read access first | `cr-repo.ts` |
| A failed action leaves no partial change | Everything that can fail runs before any mutation | all actions |

## 4. Testing strategy

I tested the rules that are most likely to go wrong or cost money, one rule per test.

- **Fresh data per test:** `makeService()` deep-copies the seed, because the service changes live objects.
- **Error codes, not messages:** tests check `BusinessError.code` through a `codeOf` helper.
- **Boundaries:** the threshold is tested on both sides (1000 vs 1000.01), and so is the budget (a delta equal to the balance is allowed).
- **Failure safety:** refusal tests also check that nothing changed (status, budget, votes).
- **Right reason:** the four-eyes test makes the approver the creator, so it fails because of the rule and not a missing policy.
- **Not tested, on purpose:** concurrency and `version` (the scaffold never uses it), a committee head who isn't a member, and a negative delta releasing budget. I put the time into the money, state and permission rules first.

## 5. Assumptions

- **Routing:** `|delta|` at or below 1000 means one approver; above means committee. A delta of 0 takes the single-approver path.
- **Permissions:** send and submit need the update policy; approve, reject, return and vote need the approve policy; apply needs the apply policy.
- **Visibility first:** every action needs read access, so nobody can approve a CR they can't see. A CR outside the caller's scope looks missing (`NOT_FOUND`); `FORBIDDEN` is only for CRs the user can see but can't act on.
- **Reject** is allowed from any non-terminal status, including APPROVED before apply. **Return** is only from PENDING_APPROVAL. There is no cancel action.
- **Committee:** resolves when every voter has voted; votes can't be changed; the head may or may not be a member; the majority counts members only and the head must also approve.
- **Apply:** a negative delta releases budget, and a delta equal to the balance is allowed.
- **Out of scope:** the `web/` task (the package has no `web/` folder).
- **Known limitation:** an empty draft item list means "no item change", so a CR can't remove all items. I kept the provided behavior and locked it in with a test.

## 6. Where I used AI

I used Claude as a pair-programming partner: to understand the code, to brainstorm design decisions (routing, permissions, budget update, committee rules, test planning) and to review my code. I wrote the first version of each function and made the decisions above. I questioned the suggestions: I asked why before changing anything, kept my own order of steps where I had a reason, and found the rounding bug by reading the failing test. Claude pointed out bugs and ordering problems in my drafts and, for `sendForApproval`, `approve`, `apply` and `castVote`, suggested corrected or commented versions, which I read, ran and can explain.

For the tests, the rules being checked are decisions I made while discussing the code. Claude suggested the list of cases; I chose the order and what to cut. I wrote most of the test code (money, totals, routing, approve, apply, votes, org isolation) and Claude reviewed and corrected it. Claude wrote `test/helpers.ts`, `test/review.spec.ts`, `test/submit.spec.ts`, the last vote test and `scripts/demo.ts`. I verified everything with `npm test`, `npm run lint` and `npm run build`.

## 7. What I'd improve with more time

- **Riskiest part:** `apply`, which changes the budget, the agreement and the CR together. With a real database it needs a transaction.
- Use `version` for optimistic concurrency: `CONFLICT` exists but nothing uses it.
- Store money as integer cents to avoid floating-point issues.
- **Empty item list:** tell "no change" apart from "remove all items" with an explicit flag, and update the test that documents today's behavior.
- Resolve committee votes early when the outcome is certain, and allow vote changes before resolution.
- Add a cancel action, and more tests (head not a member, stale `version`, negative delta).