## Summary

<!-- What does this PR add or fix, and why? One short paragraph. -->

## Chapter / article

- Branch: `bab-N` (from `bab-(N-1)`)
- Articles: `bab-N/artikel-NN`, …
- Fix merged forward? <!-- If this fixes an earlier chapter: the first branch fixed and every branch it was merged into -->

## Verified gate

Every stage ran on the same commit: `<sha>`

- [ ] **0 Build** — `make build lint docker-build` passes (backend / frontend / mobile engineer)
- [ ] **1 Unit tests** — `make test-unit` passes, coverage Go ≥ 80%, TS ≥ 70% (test-engineer)
- [ ] **2 Database audit** — no blocking finding, or "no SQL change" (database-auditor)
- [ ] **3 Integration** — `make test-integration` passes and `make up` health checks return 200 (integration-engineer)
- [ ] **4 Quality review** — no blocking finding (quality-review)

## Before merging

- [ ] `make scan` passes: no secrets, no `.env` file committed
- [ ] Commits are conventional and scoped: `type(bab-N/artikel-NN): …`
- [ ] `docs/bab-N.md` records the verified SHA and the article → files map
- [ ] AI-assisted changes went through the same gate as hand-written code
