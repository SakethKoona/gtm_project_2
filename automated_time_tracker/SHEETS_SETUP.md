# Live Google Sheet sync — one-time setup (~3 minutes)

This connects the tracker to a Google Sheet so every finished call auto-appends a
row. It uses a Google Apps Script "web app" — no Google Cloud project, no API
keys, and the tracker stays a single file.

## Steps

1. **Create a Sheet.** Go to https://sheets.new (name it whatever you like).

2. **Open the script editor.** In that Sheet: **Extensions → Apps Script**.

3. **Paste the code.** Delete whatever's in `Code.gs`, then paste the entire
   contents of `google-apps-script.gs` (in this folder). Click the **Save** icon.

4. **Deploy as a web app.** Click **Deploy → New deployment**.
   - Click the gear ⚙ next to "Select type" → **Web app**.
   - **Execute as:** *Me*.
   - **Who has access:** *Anyone*.  ← required so the tracker can post to it.
   - Click **Deploy**. Authorize when prompted (it's your own script; if you see
     "Google hasn't verified this app", click **Advanced → Go to … (unsafe)** —
     that warning is expected for personal scripts).

5. **Copy the Web app URL.** It looks like
   `https://script.google.com/macros/s/AKfy…/exec`.

6. **Connect the tracker.** Open `index.html`, paste the URL into the
   **Live Google Sheet sync** box, click **Test** (should say "Connection works"),
   then **Save**. From now on, ending a call appends a row to your Sheet's
   **Calls** tab automatically.

## Columns written

`id, started, ended, ringing_s, waiting_s, right_s, wrong_s, voicemail_s, noanswer_s, total_s, disposition, note`
(times are whole seconds, so the Sheet can chart/sum them easily.)

## Good to know

- **Retries are safe.** Each call has a stable `id` and the script de-dupes on
  it, so re-syncing never creates duplicate rows.
- **Offline?** Calls stay saved locally and are pushed on the next sync (the
  status line shows how many are pending; "Sync now" forces it).
- **If Test fails from a `file://` page:** some browsers restrict network calls
  from files opened directly. Serve the folder instead — in this directory run
  `python3 -m http.server 8000`, then open `http://localhost:8000/`. Everything
  (including localStorage data) works the same, and sync will connect.
- **Updating the script later:** after editing `Code.gs`, redeploy with
  **Deploy → Manage deployments → Edit ✏ → Version: New version → Deploy** (the
  URL stays the same).
- CSV export still works as a manual backup.
