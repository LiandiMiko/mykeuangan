---
name: release-notes-sync
description: Keep the README release notes and Admin Panel update history synchronized when application features or fixes are released.
---

# README and Admin Update History

Use this skill when a change ships or modifies user-facing application behavior, or when a release entry in `README.md` is added, edited, or removed.

Do not add a release entry for typo fixes, formatting changes, planning notes, or unrelated documentation edits.

## Files to keep in sync

- `README.md`: the dated entry under the Changelog heading.
- `src/admin.html`: the static `Riwayat Pembaruan` section inside `#view-admin`.

The admin history is source-controlled HTML. Do not add a database table, Supabase migration, GitHub token, or runtime GitHub write unless the user asks for an editable or automated system.

## Workflow

1. Inspect the worktree and the latest release entries in both files. Preserve unrelated or uncommitted changes.
2. Record only changes present in the implementation. Do not include planned work or claim a deployment, migration, or test succeeded unless verified.
3. Use the same release date and title in the README and admin history. Use the release date supplied by the user; otherwise use the current date. In the admin section, keep the visible date and `<time datetime="YYYY-MM-DD">` value aligned.
4. Add the newest release at the top of each history. Keep older entries instead of replacing them.
5. Keep the admin summary short and useful to app administrators. The README may include additional technical details, such as migration filenames, setup steps, or test commands, but it must describe the same released features.
6. When a release changes setup requirements, database schema, deployment steps, feature lists, or roadmap status, update the relevant README sections too. Remove roadmap items that the release completed.
7. Check that the release dates, titles, and shipped feature list agree across both files. Avoid duplicate entries and unsupported claims.
8. Run `node build.mjs`, `node --test`, and `git diff --check` when available. Report validation failures or unavailable tools explicitly.
9. Do not commit or push unless the user requests it.

## Release entry checklist

- The feature or fix exists in the code being changed.
- The README changelog and admin history describe the same release.
- Existing release history remains intact.
- Required migrations or deployment steps are documented when applicable.
- Tests and build results are stated accurately.
