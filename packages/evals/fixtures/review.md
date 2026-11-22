## Exports list

```wiredown
browser: Plotline | app.plotline.io/settings/exports
  columns:
    nav: {home} Home | {grid} Reports | *{file} Exports | {settings} Settings
    box (plain)
      row:
        h2: Scheduled exports
        text: 3 of 5 scheduled exports used #usage
        button: *{plus} New export #new-export
      search: Find exports #search
      grid #exports
      Name | Report | Schedule | Format | Recipients | Last run | Status
      Weekly revenue | Revenue by plan | Mondays 08:00 | XLSX | 4 people | Today 08:00 | {dot} Active
      Churn by plan | Monthly churn | 1st of the month | CSV | finance@acme.io | 1 Nov | {dot} Active
      Activation funnel | Signup to first chart | Daily 06:00 | PDF | 2 people | Today 06:00 | {dot} Failed
```

^exports-list

Clicking a row opens the export's detail page.

## Export detail

```wiredown
browser: Plotline | app.plotline.io/settings/exports/weekly-revenue
  columns:
    nav: {home} Home | {grid} Reports | *{file} Exports | {settings} Settings
    box (plain)
      breadcrumb: Exports > Weekly revenue
      row:
        h1: Weekly revenue #title
        buttons: Run now | Pause | Edit #actions
      details: Report | Revenue by plan #details
      Schedule | Mondays 08:00 (Europe/Stockholm)
      Format | XLSX
      Recipients | 4 people
      Owner | Sara Lind
      Next run | Monday 08:00
      h2: Run history
      grid #history
      Started | Status | Rows | File size | File
      Today 08:00 | {dot} Succeeded | 1 204 | 88 KB | [Download]
      Last Monday 08:00 | {dot} Succeeded | 1 187 | 86 KB | [Download]
      3 weeks ago | {dot} Succeeded | 1 150 | 84 KB | -Expired-
```

^export-detail
