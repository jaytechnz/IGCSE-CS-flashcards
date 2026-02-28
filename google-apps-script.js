// ═══════════════════════════════════════════════════════════
// CS 0478 FlashCards — Google Apps Script
// Receives session data from the flashcard web app and
// writes it to two sheets: Sessions (summary) and CardDetail
// ═══════════════════════════════════════════════════════════
//
// SETUP INSTRUCTIONS:
// ───────────────────
// 1. Go to Google Sheets and create a new spreadsheet.
//    Name it something like "CS 0478 FlashCard Progress"
//
// 2. You do NOT need to create sheets or headers manually —
//    the script creates them automatically on first use.
//    (But you can pre-create them if you prefer — see below.)
//
// 3. In your Google Sheet, go to Extensions > Apps Script
//
// 4. Delete any code already there and paste ALL of this
//    code into the editor.
//
// 5. Click the floppy disk icon (or Ctrl+S / Cmd+S) to save.
//
// 6. Click "Deploy" > "New deployment"
//    - Click the gear icon next to "Select type" and
//      choose "Web app"
//    - Description: "FlashCard Reporter" (or anything)
//    - Execute as: "Me" (your Google account)
//    - Who has access: "Anyone"
//    - Click "Deploy"
//
// 7. You will be asked to authorise. Click through the
//    prompts. Google may warn "This app isn't verified" —
//    click "Advanced" > "Go to FlashCard Reporter (unsafe)"
//    then "Allow".
//
// 8. Copy the Web App URL that appears. It looks like:
//    https://script.google.com/macros/s/AKfycbx.../exec
//
// 9. Paste that URL into your app.js file on this line:
//    const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbza7-2_GxfWUJ5jfIENPM_7Ssi29JKDxcy-PBlv0_8867_eWqJ4rPR7J1t1GeFj7es3tg/exec';
//
// 10. Done! Student sessions will now appear in your
//     spreadsheet automatically.
//
// ═══════════════════════════════════════════════════════════
// WHAT YOU'LL SEE IN THE SPREADSHEET:
// ───────────────────
// "Sessions" sheet — one row per study session:
//   Timestamp | Student Name | Student ID | Course |
//   Topics Studied | Total Cards | Don't Know | Somewhat |
//   Know Well | % Know Well | Duration (mins)
//
// "CardDetail" sheet — one row per card rating:
//   Timestamp | Student Name | Student ID | Course |
//   Unit | Subtopic | Term | Rating | Box
//
// ═══════════════════════════════════════════════════════════
// TIPS:
// ───────────────────
// - Use Data > Create a filter on each sheet to sort/filter
//   by student name, date, topic, etc.
//
// - To see which terms students struggle with most, filter
//   CardDetail by Rating = "Don't Know" and sort by Term.
//
// - To see a student's progress over time, filter Sessions
//   by their name and sort by Timestamp.
//
// - If you edit this script, you must create a NEW version:
//   Deploy > Manage deployments > edit icon > Version:
//   "New version" > Deploy. The URL stays the same.
//
// - Check the Executions tab in Apps Script if data isn't
//   appearing — it shows errors and logs.
// ═══════════════════════════════════════════════════════════


/**
 * Handles POST requests from the flashcard app.
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'session') {
      writeSessionSummary(data);
    } else if (data.action === 'cardDetail') {
      writeCardDetail(data);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Error in doPost: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


/**
 * Handles GET requests — visit the URL in a browser to test.
 */
function doGet(e) {
  return ContentService
    .createTextOutput(
      'FlashCard Reporter is running. POST data to this URL from the flashcard app.'
    )
    .setMimeType(ContentService.MimeType.TEXT);
}


/**
 * Writes a session summary row to the "Sessions" sheet.
 */
function writeSessionSummary(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Sessions');

  // Auto-create the sheet with headers if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('Sessions');
    var headers = [
      'Timestamp', 'Student Name', 'Student ID', 'Course',
      'Topics Studied', 'Total Cards', "Don't Know", 'Somewhat',
      'Know Well', '% Know Well', 'Duration (mins)'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var total = data.totalCards || 0;
  var pctKnow = total > 0
    ? Math.round(((data.knowWell || 0) / total) * 100)
    : 0;

  var durationMins = data.durationSeconds
    ? (data.durationSeconds / 60).toFixed(1)
    : '0.0';

  sheet.appendRow([
    new Date(),
    data.studentName || '',
    data.studentId || '',
    data.course || '',
    data.topics || '',
    total,
    data.dontKnow || 0,
    data.somewhat || 0,
    data.knowWell || 0,
    pctKnow + '%',
    durationMins
  ]);
}


/**
 * Writes individual card ratings to the "CardDetail" sheet.
 */
function writeCardDetail(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CardDetail');

  // Auto-create the sheet with headers if it doesn't exist
  if (!sheet) {
    sheet = ss.insertSheet('CardDetail');
    var headers = [
      'Timestamp', 'Student Name', 'Student ID', 'Course',
      'Unit', 'Subtopic', 'Term', 'Rating', 'Box'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var timestamp = new Date();
  var rows = [];

  if (data.cards && Array.isArray(data.cards)) {
    for (var i = 0; i < data.cards.length; i++) {
      var card = data.cards[i];
      rows.push([
        timestamp,
        data.studentName || '',
        data.studentId || '',
        data.course || '',
        card.unit || '',
        card.sub || '',
        card.term || '',
        card.rating || '',
        card.box || ''
      ]);
    }

    // Batch write — much faster than row-by-row
    if (rows.length > 0) {
      sheet.getRange(
        sheet.getLastRow() + 1,
        1,
        rows.length,
        9
      ).setValues(rows);
    }
  }
}
