---
name: release-notes-sync
description: Keep anti-slop audit/follow-up notes, README release notes, and Admin Panel update history synchronized when application features, security hardening, or fixes are released.
---

# Audit Notes, README, and Admin Update History

Use this skill when a change ships or modifies user-facing application behavior, security posture, or database migrations, or when an entry in `anti-slop/` or `README.md` is added, edited, or removed.

Do not add a release entry for typo fixes, formatting changes, planning notes, or unrelated documentation edits.

## Files to keep in sync

- `anti-slop/audit-<NNN>-<slug>-YYYY-MM-DD.md` & `anti-slop/audit-<NNN>-followup-<slug>-YYYY-MM-DD.md`: technical audit findings, implemented changes, verification status (`PASS`/`FAIL`/`BLOCKED`), and unverified deployment steps.
- `README.md`: the dated entry under the Changelog heading, plus feature table, directory tree, and migration steps when applicable.
- `src/admin.html`: the static `Riwayat Pembaruan` section inside `#view-admin`.

The admin history is source-controlled HTML. Do not add a database table, Supabase migration, GitHub token, or runtime GitHub write unless the user asks for an editable or automated system.

## Workflow

1. Inspect `anti-slop/` to determine the next sequential 3-digit `audit-NNN` number (e.g. `audit-007`), and inspect the latest release entries in `README.md` and `src/admin.html`. Preserve unrelated or uncommitted changes.
2. Record only changes present in the implementation. Do not include planned work or claim a deployment, migration, or test succeeded unless verified.
3. Write or update the `anti-slop/` audit and follow-up files detailing the changes, verification checks actually executed, and any remaining Supabase/live deployment steps under `Belum diverifikasi` / `Not verified`.
4. Use the same release date and title in the `README.md` Changelog and `src/admin.html` `Riwayat Pembaruan`. Use the release date supplied by the user; otherwise use the current date. In the admin section, keep the visible date and `<time datetime="YYYY-MM-DD">` value aligned.
5. Add the newest release at the top of each history. Keep older entries instead of replacing them.
6. Keep the admin summary short and useful to app administrators. The README may include additional technical details, such as migration filenames, setup steps, or test commands, but it must describe the same released features.
7. When a release changes setup requirements, database schema, deployment steps, feature lists, or roadmap status, update the relevant README sections too. Remove roadmap items that the release completed.
8. Check that the release dates, titles, and shipped feature list agree across `anti-slop/`, `README.md`, and `src/admin.html`. Avoid duplicate entries and unsupported claims.
9. Run `node build.mjs`, `node --test`, and `git diff --check` when available. Report validation failures or unavailable tools explicitly.
10. Do not commit or push unless the user requests it.

## Release entry checklist

- The feature or fix exists in the code being changed.
- `anti-slop/audit-<NNN>-...` uses the next sequential index and accurately separates verified vs. unverified items.
- The README changelog and admin history describe the same release with matching date and title.
- Existing audit files and release history remain intact.
- Required migrations or deployment steps are documented when applicable.
- Tests and build results are stated accurately.
