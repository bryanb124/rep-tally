# Reps&Sets

A one-screen workout tally for my phone: pushups, squats, cardio minutes, whatever I track.

- Static page, no server, no login, no outside scripts. A strict content security policy blocks anything not served from this site.
- Everything is stored only on the phone (browser localStorage). Nothing is sent anywhere. Backups are files I save myself.
- Works offline once opened (service worker), and installs from Safari's or Chrome's "Add to Home Screen".

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure only |
| `app.css` | Styles; sizes that change with layout (compact, short screen, landscape) are variables |
| `app.js` | All behavior, in labeled sections: dates, storage, goals, sets, screens, More page, backup |
| `sw.js` | Offline copy of the app |

## Releasing a change

Bump the version in four places so phones pick up the new files together:
`index.html` (the `app-version` meta tag, the `APP_VERSION` comment, and the `?v=` on `app.css` and `app.js`) and `VERSION` in `sw.js`.

Saved-data keys and formats (`rep-tally-*-v1`) must not change, so existing data and old backups keep working.

## Recovery days

Each activity has a **Rest / injury** button. Select Active, Rest day, or Injury / sore day, then Save. History uses the same editor for past days. Cancel leaves everything unchanged.

Rest spacing applies independently to each activity, using the interval in More. Injury / sore days have no frequency limit. Recovery excuses that activity from the shared daily streak; other daily goals must still be met. A day with only recovery bridges the streak without increasing it. Recovery does not invent reps, and an entirely recovered growth period does not increase that activity's goal. Weekly targets remain unchanged.

Recovering activities hide logging buttons, planned sets, and goal-increase suggestions; switch back to Active to resume. Existing totals remain editable in the day editor. History, JSON backups, and CSV exports include recovery status. Existing whole-day rest data remains supported; per-activity choices use the separate `rep-tally-recovery-v1` key.

## Browser regression checks

With Node.js, Playwright, and Chromium installed, serve the app with `python -m http.server 8000`, then run `node tests/recovery.cjs`. Set `CHROMIUM_PATH` if Chromium is not at `/usr/bin/chromium`.
