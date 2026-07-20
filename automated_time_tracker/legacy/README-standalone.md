# Call Time Tracker

A single-file, keyboard-driven stopwatch for breaking down where your call time
goes. One key switches which timer runs — exactly one bucket accrues at a time,
so you never juggle multiple stopwatches.

## Use it

Open `index.html` in your browser (double-click it, or `open index.html`). Keep
the tab focused while you call. Nothing to install; all data stays in your
browser (localStorage).

## Keys

| Key | Starts timing… |
|-----|----------------|
| `1` | Ringing / dialing |
| `2` | Waiting room / hold (IVR, queue) |
| `3` | Right person (the real conversation) |
| `4` | Wrong person (gatekeeper, misroute) |
| `5` | Voicemail |
| `6` | No answer / dead |
| `Space` or `0` | Idle — pause between calls (uncounted) |
| `Enter` | End call → pick a disposition → saves & resets |

Pressing the key of the already-running bucket pauses it (toggles to idle). You
can also click any state row.

When you press `Enter`, a disposition prompt appears: pick an outcome with its
letter (`b` booked, `c` callback, `n` not interested, `w` wrong number,
`x` no contact, `o` other) or `Enter` to save untagged. Add an optional note.

## What you get

- Live per-bucket timers + current-call total.
- Saved history of every call with its breakdown + disposition.
- Aggregate stats: time with the right person, avg time-to-right-person, time
  lost to wrong-person / waiting / ringing, and a productive % (right ÷ total).
- **Export CSV** for deeper analysis in a spreadsheet.

## Notes

- Timing uses timestamps, so it stays accurate even if the tab is backgrounded.
- In-progress time is auto-saved, so a refresh won't lose the current call.
- "Clear all history" wipes saved calls; there's no undo.
