# Working on Factory Graph

`README.md` covers running, testing and layout. `DESIGN.md` is the visual brief and
`NOTES.md` the running log of decisions. Read the relevant parts before changing UI.

## Shipping every change

The owner previews everything on staging. When a piece of work is finished:

1. **Add a "What's new" entry** in `src/ui/changelog.ts` for anything a user would
   notice: a new entry at the top with a new id, a date, a title and a few plain
   sentences saying what it does and where to find it (copy rules in DESIGN.md: sentence
   case, no exclamation marks). Never change the id of an entry that has shipped. The
   app shows unseen entries once, as a popup, on the next visit.
2. **Run the checks**: `npm run lint`, `npm test`, `npm run build`, `npm run smoke`.
   (The 10 ms solver timing test can fail under parallel load on slow machines; it
   should pass when run alone.)
3. **Push the work branch, then deploy to staging** by bringing the branch into
   `staging` and pushing it — a fast-forward when the branch was started from staging,
   otherwise a merge that keeps staging's own commits. Never force-push `staging`.
4. **Confirm the deploy**: the push to `staging` runs the checks, then triggers the
   Pages deploy on `main`, which builds both sites. Check both runs finish green.

Staging is https://basta.github.io/factory-graph/staging/. `main` is the live site and
is only updated by merging `staging` when the owner says so.
