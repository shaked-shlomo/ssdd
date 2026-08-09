# Plan NN — <title>: design spec

**Date:** <YYYY-MM-DD> · **Plan:** NN · **Status:** spec (pre-plan)

## Goal
<The outcome this design achieves, in one or two sentences.>

## Scope (decided in brainstorm, <date>)

**In:**
- <Feature/behavior, with the choice recorded where one was made:
  "X — chosen over Y to avoid Z / to get W for free.">

**Out (deferred):**
- <Adjacent capability> → <when/why it returns (fast follow-up, needs data, monetization lever, …)>

## Architecture
<The shape of the solution: components, data flow (a small ASCII diagram earns
its place), where authority lives, what is fire-and-forget vs. blocking.>

## Components
<One short block per unit: what it does, its interface, what it depends on.
Someone should understand each unit without reading its internals.>

## Error handling & edge cases
<Failure paths and their owners; degraded modes; idempotency; races.>

## Testing & verification strategy
<What proves each part: unit/integration/E2E, proofs/harnesses, manual checks.>

## Open questions
<Anything unresolved — these flow into the plan's clarify pass.>
