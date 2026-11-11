Phase 5 proof commands

Run these in a dependency-installed checkout and save each combined stdout/stderr log under the fixed file names below.



npm ci 2>&1 | tee docs/archive/phase5-proof-input/npm-ci.log

npm run verify:project-state 2>&1 | tee docs/archive/phase5-proof-input/verify-project-state.log

npm run verify:phase5 2>&1 | tee docs/archive/phase5-proof-input/verify-phase5.log

npm run build 2>&1 | tee docs/archive/phase5-proof-input/build.log

npm run generate:phase5-refresh-closeout

npm run generate:phase5-operator-handoff


