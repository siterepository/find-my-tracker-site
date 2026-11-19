# STATE — find-my-tracker-site

<!-- ship:auto:start — regenerated automatically, do not hand-edit -->
CHECKPOINT: 2026-11-19 08:35Z — pre-compact (auto)
REPO: /Users/evar/Projects/find-my-tracker-site
BRANCH: feat/map
UNCOMMITTED: none — working tree clean
RECENT COMMITS:
  faf6452 feat: private Item Trails map page reading the tracker sheet in the browser
  fc4a078 Find My Tracker homepage and privacy policy
<!-- ship:auto:end -->

<!-- ship:agent:start — the agent writes this; preserved across checkpoints -->
GOAL: Private Item Trails map (/map/) showing each Find My item's logged history from the tracker sheet.
DONE: map page built; Web OAuth client "Item Trails map page" (origin siterepository.github.io);
  completion gate: cycle 1 REWORK (16 fixed), cycle 2 REWORK (1 MAJOR + 3 MINOR fixed), cycle 3 PASS;
  cycle-3 MINORs closed (stale tap overwrite, STATE refresh, probes committed to tests/browser/).
NEXT: Steven signs in once on the live page from his phone to prove the real Google path.
DECISIONS: browser-only, drive.file, token in tab memory, item choice in sessionStorage; see ~/Projects/Find/docs/DECISIONS.md.
OPEN ERRORS: none
<!-- ship:agent:end -->
