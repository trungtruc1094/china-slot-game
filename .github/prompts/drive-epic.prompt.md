---
mode: agent
description: Drive the active BMAD epic to completion
---

Drive the active epic (the first epic in sprint-status.yaml whose status
is not "done") to completion.

Process all of its stories in order. For each story whose status is
"backlog" or "ready-for-dev":

1. Run `bmad-create-story` if no story file exists yet.
2. Run `bmad-dev-story` to implement it.
3. Run `bmad-code-review` against the criteria below — require concrete
   evidence, not "looks fine".
4. Run `npm test && npm run build`. If either fails, stop and report.
5. On review pass, set status to "done" in sprint-status.yaml AND
   update the story file's front-matter Status field. Both must match.
6. `git add -A && git commit -m "feat(<story-id>): <short title>"`

Code-review gate (must all be true to mark done):
- All acceptance criteria covered by tests, and tests run in `npm test`.
- Assumptions documented in story dev notes.
- Public API contracts documented in the story file.
- Lint and typecheck clean.

When all stories in the active epic are "done", set the epic to "done"
and STOP. Do NOT auto-start the next epic. Do NOT run the retrospective.

Report after each story: id, new status, commit hash, key decisions,
review requirements verified.