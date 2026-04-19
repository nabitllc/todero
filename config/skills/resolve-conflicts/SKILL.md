# Resolve Conflicts Skill

Used by **Deployer** during pre-flight checks before the PR window.
Invoked when `git rebase main` fails on an approved branch due to merge conflicts.

---

## When to use this

You are Deployer. You are rebasing an approved branch onto current `main`. The rebase
produced conflicts (`CONFLICT (content): Merge conflict in path/to/file.ts`).
Before giving up, use this skill to resolve them intelligently.

---

## Resolution process

### 1. Understand what each side was trying to do

```bash
# See the full conflict in context
git diff

# See what the branch was building (its commit messages)
git log main..HEAD --oneline

# See what changed on main since the branch diverged
git log HEAD..main --oneline
```

Read both sides of each conflict marker:
```
<<<<<<< HEAD          ← what main has (the base)
...
=======
...
>>>>>>> feat/TOD-XXX  ← what this branch added
```

The goal is to **keep both intents** — not just pick one side. Ask: what was
main trying to do here, and what was the branch trying to do? Can both be
expressed in the final output?

### 2. Resolve each conflict

For each conflicted file:
- Read the full file to understand the surrounding context
- Edit the file to merge both intents correctly
- Remove all `<<<<<<<`, `=======`, `>>>>>>>` markers
- Verify the file is syntactically valid

Common patterns:

| Conflict type | Resolution |
|---|---|
| Both added imports | Keep both imports, deduplicate if identical |
| Both modified the same function | Combine the changes; apply both modifications |
| One added, one deleted | Keep the addition unless it conflicts with the deletion's intent |
| Both added to an array/object | Include all entries from both sides |
| Structural changes (rename, move) | Apply the structural change first, then re-apply the functional change |

### 3. Verify resolution compiles

```bash
npm run build
```

If build fails, the conflict resolution introduced a type error or import issue.
Fix it before continuing.

### 4. Complete the rebase

```bash
git add .
git rebase --continue
```

If more conflicts appear, repeat from step 1.

### 5. If resolution is impossible

Some conflicts require human judgment — e.g. two branches that fundamentally
redesigned the same component in incompatible ways.

In this case:
- Run `git rebase --abort` to restore the branch to its pre-rebase state
- Run `git checkout main` to return the repo to a clean state before continuing
- PATCH the issue back to `open`, assign to the issue's `owner`, and write details to `deployer_notes`:
  ```json
  {
    "id": "<issue_id>",
    "status": "open",
    "assignee": "<owner field value>",
    "deployer_notes": "Rebase conflict on feat/TOD-XXX:\n- File: path/to/file.ts\n- Both main and this branch modified [describe what]. Manual resolution required.\n- To fix: git checkout feat/TOD-XXX && git rebase origin/main, resolve conflicts, then resubmit to code_review.",
    "transitioned_by": "deployer"
  }
  ```
- Log which file(s) conflicted and why resolution was not possible
- Continue processing the remaining approved branches

---

## Example: typical conflict resolution

```
CONFLICT (content): Merge conflict in app/api/issues/route.ts

<<<<<<< HEAD
  const SELECT_COLS = ['id','title','status','assignee']
=======
  const SELECT_COLS = ['id','title','status','assignee','sprint','priority']
>>>>>>> feat/TOD-1234
```

**Analysis:** main has the base column list. The branch added `sprint` and `priority`.
Both are valid — the branch was extending the list, not replacing it.

**Resolution:**
```ts
const SELECT_COLS = ['id','title','status','assignee','sprint','priority']
```

Keep the branch's version (it's a superset of main's — no data lost).

---

## After all conflicts resolved

Continue with the normal Deployer pre-flight:
- Run `npm run build` on the fully rebased branch
- If build passes → branch is ready for the PR window
- Log: `✓ TOD-XXX conflicts resolved — branch rebased cleanly onto main`
