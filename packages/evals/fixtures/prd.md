# PRD: Scheduled report exports

Product: Plotline, a product analytics app for small SaaS teams (fictional,
written for this eval).

Status: draft. Owner: Reporting squad.

## Problem

Plotline customers build reports (funnels, retention, revenue) and then copy
the numbers into spreadsheets for their weekly business review. Support sees
about 40 tickets a month asking for "a CSV every Monday". Today people export
by hand from each report, and they forget. Finance teams in particular want
the numbers delivered to people who don't have a Plotline seat.

## Goal

Let a workspace admin schedule any saved report to be exported as CSV, XLSX
or PDF and emailed to a list of recipients on a daily, weekly or monthly
schedule. Recipients don't need a Plotline account.

Out of scope for this release: exports to cloud storage (S3, Google Drive),
per-recipient filters, and exports of dashboards (only single reports).

## Plan limits

The Team plan includes 5 scheduled exports per workspace and Business
includes 25. When the limit is reached, the "New export" button is disabled
and a short note says how to get more. Paused exports count towards the
limit.

## Screens

### 1. Exports page, nothing scheduled yet

Reached from Settings → Exports in the left navigation. When the workspace
has no scheduled exports, the page shows a short explanation ("Send a report
to your team on a schedule, as CSV, XLSX or PDF"), an illustration
placeholder, and a primary "New export" button. Under it, a grey line says
"Team plan: 5 scheduled exports included".

### 2. Exports page, list

Once there is at least one export, the page shows a header row with the
title "Scheduled exports", a usage text ("3 of 5 scheduled exports used")
and the "New export" button on the right. Below it is a search field
("Find exports") and a table with one row per export:

| Name | Report | Schedule | Format | Recipients | Last run | Status |

Example rows the designer sketched:

- Weekly revenue · Revenue by plan · Mondays 08:00 · XLSX · 4 people ·
  Today 08:00 · Active
- Churn by plan · Monthly churn · 1st of the month · CSV · finance@… ·
  1 Nov · Active
- Activation funnel · Signup → first chart · Daily 06:00 · PDF · 2 people ·
  Today 06:00 · Failed

Status is one of Active, Paused or Failed. Clicking a row opens the export's
detail page. Each row also has a "more" menu (Run now, Pause/Resume, Edit,
Delete).

Rough wireframe from the kickoff:

```text
+--------------------------------------------------------------+
| Scheduled exports        3 of 5 used          [New export]   |
| [ Find exports            ]                                  |
| Name | Report | Schedule | Format | Recipients | Last | Stat |
| ...                                                          |
+--------------------------------------------------------------+
```

### 3. New export

"New export" opens a dialog titled "New scheduled export" with a form:

- Name (text input, required).
- Report: a dropdown of saved reports.
- Format: CSV, XLSX or PDF, one choice, XLSX preselected.
- Schedule: Daily, Weekly or Monthly. Weekly shows a day of the week,
  Monthly a day of the month; all show a time and the workspace time zone
  in grey ("Europe/Stockholm").
- Recipients: email addresses, comma separated. A grey hint says
  "Recipients don't need a Plotline account".
- A checkbox "Include the report's current filters", checked by default.

Footer: Cancel and a primary "Create export". If the name is empty when the
user clicks Create, the Name field is marked invalid.

### 4. Export detail

The detail page shows a breadcrumb (Exports > Weekly revenue), the export's
name as the heading, and buttons "Run now", "Pause" and "Edit" at the top
right. Below that, a details list: Report, Schedule, Format, Recipients,
Owner, Next run. Below the details, a "Run history" table with the last runs:

| Started | Status | Rows | File size | File |

with a "Download" link in the File column for successful runs. Files are
kept for 30 days; older runs show "Expired" in grey instead of the link.

### 5. Export detail, last run failed

When the most recent run failed, the detail page shows a red-flagged alert
at the top: "The last run failed: the PDF would be larger than 50 MB. Try
XLSX or narrow the report's date range." with a "Retry" link. The failed run
appears first in the run history with status Failed and no file. The rest of
the page is unchanged.

## Notifications

When a run fails, the export's owner gets an email; recipients get nothing.
After three consecutive failures the export is paused automatically and the
owner is told so in the email. (No screen for the email in this release.)

## Open questions

- Should recipients be able to unsubscribe themselves? Legal says yes for
  external addresses; design hasn't decided where the link goes.
- Do we show the recipients' names or only their addresses in the table?
