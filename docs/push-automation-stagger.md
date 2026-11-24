# Push automation: anti-jam measures (2026-11-24)

Companion note to `docs/push-automation.md`. To keep simultaneous PRs from
jamming at the approval/merge step, the auto-approve/auto-merge workflow now:

1. Staggers each run by 0-4 minutes, derived from the PR number, so
   simultaneous submissions spread out.
2. Queues runs per PR (duplicate events for the same PR do not pile up or
   run twice). A single global queue is intentionally not used: GitHub
   keeps only one pending run per concurrency group and cancels older
   pending runs, which could silently drop a PR under a rush.
3. Retries enabling auto-merge with growing backoff (30/60/90s) if a race
   makes the first attempt fail.

Direct pushes to main via the iMac deploy-key route are unchanged.
