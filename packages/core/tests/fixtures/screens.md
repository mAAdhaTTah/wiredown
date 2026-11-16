# Team members

```wiredown
window: Team settings
  row:
    h2: Members
    text: 3 of 5 seats used #seats
    button: *Invite member #invite
  alert: {info} Invitations expire after 7 days. #notice
  grid #members
  [ ] | Name | Email | Role | Status
  [ ] | Anna Svensson | anna@example.com | Admin | Active
  [ ] | Erik Lund | erik@example.com | Member | Active
  [ ] | Maja Berg | maja@example.com | Member | Invited
```

^team-members

## After removal

```wiredown
extends: team-members
replace: seats
  text: 2 of 5 seats used
replace: notice
  alert: {check} Erik Lund was removed from the team. [Undo]
rows: members
  [ ] | Maja Berg | = | = | Active
  remove Erik Lund
after: members
  text: -Removed members keep access until the end of the day-
```

^team-members-after-remove
