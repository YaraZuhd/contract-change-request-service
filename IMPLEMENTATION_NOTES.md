# Implementation Notes

> Fill this in as part of your submission. Aim for 1–2 pages of honest engineering notes — bullet points
> are fine. This document is read alongside your code and is a meaningful part of the evaluation. Delete
> these instructions before submitting.

## 1. What I changed

### Task 1: fix the failing tests
- **Money rounding** (`src/common/money.util.ts`): `round2` used `Math.trunc`, which cuts off decimals instead of rounding. For example, 3 × 6.669 = 20.007 became 20.00 instead of 20.01. I changed it to `Math.round(value * 100) / 100` so amounts round to the nearest cent.
- **Transition guard** (`src/change-requests/cr-state-machine.ts`): `assertTransition` only checked whether the current state was terminal, so illegal moves like DRAFT → APPROVED were allowed. It now also checks `canTransition(from, to)` against `LEGAL_TRANSITIONS` and throws an `ILLEGAL_TRANSITION` business error.
- I also completed the `LEGAL_TRANSITIONS` table with the missing transitions, so the guard can enforce the full workflow.

## 2. Domain model

- A **Purchase Agreement** is a deal between a buyer organization and a vendor, with line items (SKU, quantity, unit price) and a budget that pays for it. Once an agreement is active, it isn't edited directly. Changes go through a **Change Request (CR)**, which belongs to exactly one organization and carries the proposed changes, the totals (`baselineTotal`, `newTotal`, `delta`), the approvals and an audit trail.

- A CR moves through a **state machine**: DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → APPLIED. A small change (`|delta|` at or below the threshold) needs one approver. A large change goes through a committee vote (COMMITTEE_VOTING → COMMITTEE_DECISION) before it's approved. A CR can be returned for edits, and any non-terminal CR can be rejected or cancelled. APPLIED, REJECTED and CANCELLED are terminal, so they are immutable.

- Transitions are guarded in one place: `assertTransition` checks every move against the `LEGAL_TRANSITIONS` table, and the service's `transition` helper calls it before it changes the status and appends an audit entry. This means no action can skip a step.



## 3. Invariants I enforce (and how)
<!-- Which properties your implementation guarantees, and where in the code each one is enforced. -->

| Invariant | How it's enforced | Where (file / function) |
|---|---|---|
|  |  |  |

## 4. Testing strategy
<!-- What did you test and why? What did you deliberately NOT test, and why was that a reasonable cut
given the time budget? -->

-

## 5. Assumptions
<!-- The rules leave some things open to interpretation. Where you had to make a judgment call, state the
decision you made and the reasoning behind it. -->

-

## 6. Where I used AI
<!-- Allowed and expected. Briefly: what you used it for, and how you verified the output. No transcripts
needed. -->

-

## 7. What I'd improve with more time
<!-- The riskiest part of your solution, known limitations, and what you'd do next. -->

-
