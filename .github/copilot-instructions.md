# Project: China Slot Game

## BMAD workflow context
- Sprint state lives in `sprint-status.yaml` at the repo root.
- Story files live in `_bmad-output/implementation-artifacts/`.
- BMAD status flow: backlog -> ready-for-dev -> in-progress -> review -> done.
- Story keys that start with `epic-` or end with `-retrospective` are NOT stories — never treat them as stories to implement.
- Retrospectives live as `_bmad-output/implementation-artifacts/epic-N-retro-*.md`.

## How to run BMAD workflows
- Create story: invoke the `bmad-create-story` workflow.
- Implement story: invoke the `bmad-dev-story` workflow.
- Review: invoke the `bmad-code-review` workflow.

## Commit and verification policy
- After each story passes review, run `npm test && npm run build`.
- Commit with message `feat(<story-id>): <short title>`.
- Keep `sprint-status.yaml` and the story file's front-matter Status field in sync.

## When asked to "drive an epic" or similar
- Identify the active epic from sprint-status.yaml (the first one not "done").
- Process stories in the order they appear under `development_status`.
- Stop at the end of the active epic. Do not auto-start the next epic.
- Do not run the retrospective automatically — report feature-complete instead.