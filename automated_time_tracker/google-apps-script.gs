/**
 * Call Time Tracker → Google Sheets bridge.
 *
 * Paste this into the Apps Script editor of the Google Sheet you want to fill
 * (Extensions → Apps Script), then Deploy → New deployment → Web app:
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Copy the resulting Web app URL into the tracker's "Live Google Sheet sync" box.
 *
 * Each finished call POSTs here and gets appended as a row (de-duped by id, so
 * retries never create duplicates). See SHEETS_SETUP.md for the full walkthrough.
 */

var SHEET_NAME = "Calls";
var HEADERS = [
  "id", "started", "ended",
  "ringing_s", "waiting_s", "right_s", "wrong_s", "voicemail_s", "noanswer_s",
  "total_s", "disposition", "note",
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // serialize appends so concurrent calls don't clash
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.type === "ping") {
      getSheet(); // make sure the sheet + header exist on first test
      return json({ ok: true, pong: true });
    }

    if (body.type === "call" && body.call) {
      var c = body.call;
      var sheet = getSheet();

      // De-dupe on the id in column A.
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (var i = 0; i < ids.length; i++) {
          if (ids[i][0] === c.id) return json({ ok: true, id: c.id, duplicate: true });
        }
      }

      sheet.appendRow([
        c.id, c.started, c.ended,
        c.ringing_s, c.waiting_s, c.right_s, c.wrong_s, c.voicemail_s, c.noanswer_s,
        c.total_s, c.disposition, c.note,
      ]);
      return json({ ok: true, id: c.id });
    }

    return json({ ok: false, error: "unknown payload" });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
