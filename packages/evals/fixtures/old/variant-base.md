## Exports list

```wiredown
browser: Plotline | app.plotline.io/settings/exports
  columns:
    nav: {home} Home | {grid} Reports | *{file} Exports | {settings} Settings
    box (plain)
      row:
        h2: Scheduled exports
        text: 3 of 5 scheduled exports used (id=usage)
        button: *{plus} New export (id=new-export)
      search: Find exports (id=search)
      grid (id=exports)
      Name | Report | Schedule | Format | Recipients | Last run | Status
      Weekly revenue | Revenue by plan | Mondays 08:00 | XLSX | 4 people | Today 08:00 | {dot} Active
      Churn by plan | Monthly churn | 1st of the month | CSV | finance@acme.io | 1 Nov | {dot} Active
      Activation funnel | Signup to first chart | Daily 06:00 | PDF | 2 people | Today 06:00 | {dot} Failed
```

^exports-list

Clicking a row opens the export's detail page.
