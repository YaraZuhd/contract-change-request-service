# Implementation Notes

## 1. What I changed

### Task 1: fix the failing tests
- **Money rounding** (`src/common/money.util.ts`): `round2` used `Math.trunc`, which cuts off decimals instead of rounding. For example, 3 × 6.669 = 20.007 became 20.00 instead of 20.01. I changed it to `Math.round(value * 100) / 100` so amounts round to the nearest cent.
- **Transition guard** (`src/change-requests/cr-state-machine.ts`): `assertTransition` only checked whether the current state was terminal, so illegal moves like DRAFT -> APPROVED were allowed. It now also checks `canTransition(from, to)` and throws an `ILLEGAL_TRANSITION` business error.
- I completed the `LEGAL_TRANSITIONS` table with the missing transitions, so the guard can enforce the full workflow.
- `canTransition` also has one general rule: any non-terminal status can move to REJECTED or CANCELLED, so I didn't repeat those in every table row. Terminal statuses can't move anywhere.

### Task 2: approval flow (`src/change-requests/cr-service.ts`)
- `sendForApproval`: moves SUBMITTED -> PENDING_APPROVAL and recomputes the totals. If `|delta|` is above the threshold it moves straight on to COMMITTEE_VOTING and creates the committee; otherwise it stays pending for a single approver.
- `approve`: a single approver moves PENDING_APPROVAL -> APPROVED. The creator cannot approve their own CR, committee CRs are refused, and the delta is re-checked because the agreement may have changed since the CR was sent.
- `returnToDraft`: PENDING_APPROVAL -> RETURNED -> DRAFT. It resets the approvals and the committee. The audit trail keeps the history.
- `reject`: any non-terminal CR -> REJECTED. The budget is not touched.
- `apply`: APPROVED -> APPLIED. It recomputes the totals from the agreement, checks the budget can cover a positive delta (`INSUFFICIENT_BUDGET` otherwise), then updates the budget (`booked`, `balance`) and writes the change into the agreement.
- I added a `canActOn` helper in `src/common/policy.ts` that checks policy and scope (org / workspace / own) in one place, and I used it in the actions.

### Task 3: committee routing
- `castVote`: only committee members and the head can vote, once each, and not on their own CR. Every vote is audited. When everyone has voted, the CR goes COMMITTEE_VOTING -> COMMITTEE_DECISION -> APPROVED or REJECTED. It is approved only if more than half of the members approved and the head approved.

### Task 4: permissions
### Task 5: tests

## 2. Domain model

- A **Purchase Agreement** is a deal between a buyer organization and a vendor, with line items (SKU, quantity, unit price) and a budget that pays for it. Once an agreement is active, it isn't edited directly. Changes go through a **Change Request (CR)**, which belongs to exactly one organization and carries the proposed changes, the totals (`baselineTotal`, `newTotal`, `delta`), the approvals and an audit trail.

- A CR moves through a **state machine**. A small change (`|delta|` at or below the threshold) needs one approver. A large change goes through a committee vote before it's approved. A CR can be returned for edits, and any non-terminal CR can be rejected or cancelled. APPLIED, REJECTED and CANCELLED are terminal, so they are immutable.

```
DRAFT -> SUBMITTED -> PENDING_APPROVAL -> APPROVED -> APPLIED
PENDING_APPROVAL -> COMMITTEE_VOTING -> COMMITTEE_DECISION -> APPROVED | REJECTED   (|delta| > threshold)
PENDING_APPROVAL -> RETURNED -> DRAFT
any non-terminal -> REJECTED | CANCELLED
```

- Each agreement is paid from a **budget** (`allocated`, `booked`, `spent`, `balance`); applying a CR books the delta against it. Actions are gated by policy strings (`cr_{action}_{scope}`) and by organization.

- Transitions are guarded in one place: `canTransition` holds the rules, `assertTransition` throws when a move isn't allowed, and the service's `transition` helper calls it before it changes the status and appends an audit entry. This means no action can skip a step.

## 3. Invariants I enforce (and how)

| Invariant | How it's enforced | Where (file / function) |
|---|---|---|
| Only legal transitions happen | One guard checks every move against the transition table | `cr-state-machine.ts` (`canTransition`, `assertTransition`) |
| Terminal states are immutable | `canTransition` returns false from APPLIED, REJECTED and CANCELLED | `cr-state-machine.ts` |
| Every status change is audited, append-only | A single `transition` helper changes the status and appends an audit entry | `cr-service.ts` (`transition`) |
| Money is rounded to 2 decimals | `round2` rounds to the nearest cent in all totals | `money.util.ts`, `cr-totals.ts` |
| The budget is never overspent | The balance is checked before any change, and the budget is only updated after the guarded transition | `cr-service.ts` (`apply`) |
| A CR can't be applied twice | The second apply is stopped by the terminal-state guard before the budget is touched | `cr-service.ts` (`apply`) |
| Large changes go to a committee | Routing by `|delta|` against the threshold; approval needs a majority plus the head | `sendForApproval`, `castVote` |
| Creators can't approve or vote on their own CR | Explicit check | `approve`, `castVote` |
| Actions respect policy and scope | `canActOn` checks the policy and the org / workspace / own scope | `policy.ts` |
| A failed action leaves no partial change | Checks run before any mutation | all actions |

## 4. Testing strategy
<!-- What did you test and why? What did you deliberately NOT test, and why was that a reasonable cut
given the time budget? -->

-

## 5. Assumptions

- **Routing:** `|delta|` at or below 1000 means a single approver, above means committee. A delta of 0 (for example a date-only change) takes the single-approver path.
- **Permissions:** sending and submitting need the update policy, approve / reject / return / vote need the approve policy, and apply needs the apply policy. Scopes are org (any CR), workspace, or own CRs.
- **Four-eyes rule:** the creator cannot approve or vote on their own CR.
- **Reject** is allowed from any non-terminal status, including APPROVED before it is applied. There is no cancel action in the service, so cancel is out of scope.
- **Return** is only allowed from PENDING_APPROVAL. A CR already with the committee cannot be returned.
- **Committee:** it resolves when every voter has voted, votes can't be changed, and the head may or may not be a member. The majority counts members only, and the head must also approve.
- **Apply:** a negative delta releases budget (booked goes down, balance goes up), a delta equal to the balance is allowed, and the change is written into the agreement.
- **Out of scope:** cancelling or terminating an agreement, and the `web/` task (the package has no `web/` folder).
- **Known limitation:** an empty draft item list is treated as "no item change" by `computeNewTotal`, so a CR cannot express "remove all items". I left that behavior as provided.

## 6. Where I used AI

I used Claude as a pair-programming partner: to understand the codebase files, to brainstorm design decisions (routing, permissions, the budget update, committee rules), and to review my code. I wrote the first version of each function myself and made the decisions listed above. I questioned the suggestions instead of accepting them: I asked why before changing anything, kept my own order of steps where I had a reason, and found the rounding bug by reading the failing test. Claude pointed out bugs and ordering problems in my drafts and, for `sendForApproval`, `approve`, `apply` and `castVote`, suggested corrected versions or commented versions, which I read, ran and can explain. I verified everything by running `npm test`, `npm run lint` and `npm run build`.

## 7. What I'd improve with more time

- **Riskiest part:** `apply`, because it changes the budget, the agreement and the CR together. In memory this is safe, but with a real database it needs a transaction.
- Use `version` for optimistic concurrency: the `CONFLICT` error exists, but nothing uses it.
- Store money as integer cents, to avoid floating-point issues.
- Resolve committee votes early when the outcome is certain (for example the head rejects), and allow vote changes before resolution.
- Add a cancel action, and let `computeNewTotal` tell "no change" apart from "remove all items".