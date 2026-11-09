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
