# spikes/

Throwaway experiments that produce **evidence and a written decision**, not product code.
Each spike answers one question from `_bmad-output/planning-artifacts/epics.md` and ends in a
decision record under `docs/decisions/`.

Rules:

- A spike lives in its own folder (`spikes/<epic>-<story>-<slug>/`) and is **its own pnpm
  root**: it has a `pnpm-workspace.yaml` and `pnpm-lock.yaml` of its own and is **not** listed
  in the repo's `pnpm-workspace.yaml`. Install it from inside its folder with `pnpm install`.
- Nothing here may affect the repo's `pnpm run ci`. The root `vite.config.ts` ignores
  `spikes/**` for test, lint and format, and no root `tsconfig` includes it.
- A spike may import repo sources by relative path (for example a port's contract suite) but
  the repo never imports a spike.
- Code a story wants to keep is lifted into `packages/*` by that story, with its own tests.

| Spike | Question | Decision |
| ----- | -------- | -------- |
| [`2-1-ucan/`](2-1-ucan/README.md) | Which UCAN library carries `CapabilityAuth` on Expo? | [`docs/decisions/2-1-ucan-library.md`](../docs/decisions/2-1-ucan-library.md) |
