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
DONE: map page built; Web OAuth client "Item Trails map page" created (origin siterepository.github.io);
  completion-judge cycle 1 REWORK, all 16 findings fixed and re-probed (race, 20k-row perf, pin under panel,
  storage honesty, GIS error_callback, scrubber, stale day, status date, a11y, SRI, privacy copy).
NEXT: merge feat/map to main, push, verify live URL; Steven signs in once on the phone to prove the live Google path.
DECISIONS: browser-only, drive.file, token in tab memory, item choice in sessionStorage; see ~/Projects/Find/docs/DECISIONS.md.
OPEN ERRORS: none
<!-- ship:agent:end -->
