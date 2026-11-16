# Examples

## Team screens

Save the following headings, blocks, ids and notes in `screens.md`.
Frontmatter is omitted; the CLI adds it when embedding screens.

### Team members

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

Invited members count toward the seat limit.

### After removal

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

The removed member's access ends tonight.

## Build the removal flow

Run from the directory containing `screens.md`. Results below are trimmed
JSON: omitted fields include paths, geometry and generated element ids.
Read actual returned frame ids when continuing an existing drawing.

```sh
wiredown flow new flows/members.excalidraw.md team-members --screens screens.md --json
```

```json
{ "frames": [{ "frame": "F1", "screen": "team-members" }] }
```

```sh
wiredown flow decision flows/members.excalidraw.md 'Remove Erik?' --right-of F1 --json
```

```json
{ "decision": { "node": "D1" } }
```

```sh
wiredown flow add-screen flows/members.excalidraw.md team-members-after-remove --screens screens.md --right-of D1 --json
```

```json
{ "frames": [{ "frame": "F2", "screen": "team-members-after-remove" }] }
```

```sh
wiredown flow connect flows/members.excalidraw.md F1 D1 'Remove' --json
```

```json
{ "arrow": { "from": "F1", "to": "D1", "label": "Remove" } }
```

```sh
wiredown flow connect flows/members.excalidraw.md D1 F2 'Yes' --json
```

```json
{ "arrow": { "from": "D1", "to": "F2", "label": "Yes" } }
```

```sh
wiredown flow note flows/members.excalidraw.md D1 'Confirm before removal' --json
```

```json
{ "note": { "node": "D1" } }
```

```sh
wiredown flow highlight flows/members.excalidraw.md F1 '#members' --json
```

```json
{ "highlight": { "frame": "F1", "screen": "team-members", "target": "members" } }
```

```sh
wiredown flow mark flows/members.excalidraw.md F2 '#notice' '1' --json
```

```json
{
  "mark": {
    "frame": "F2",
    "screen": "team-members-after-remove",
    "target": "notice",
    "label": "1"
  }
}
```

```sh
wiredown flow refresh flows/members.excalidraw.md --json
```

```json
{ "changes": [], "unresolved": [] }
```

```sh
wiredown flow lint flows/members.excalidraw.md --json
```

```json
{ "files": [{ "findings": [] }] }
```

Remove the mark again, as you would one that lint reports:

```sh
wiredown flow remove flows/members.excalidraw.md 'F2#notice:1' --json
```

```json
{ "removed": [{ "kind": "mark", "node": "F2", "target": "notice", "label": "1" }] }
```

## Settings form

This can be another screen in the same file.

```wiredown
window: Account settings (w=760)
  tabs: *Profile | Security | Notifications (fill)
    form: Contact details
      field: Name | input: Anna Svensson
      field: Email | input: anna@example.com
      field: Country | dropdown: *Sweden | Norway | Denmark
      field: Biography | textarea: Product designer
    checkbox: [x] Email updates | [ ] SMS updates
    radio: *Daily digest | Weekly digest
    toggle: [on] Public profile | [off] Show email
    grid #sessions
    Device | Location | Last seen
    Desktop | Stockholm | Today
    Phone | Stockholm | Yesterday
    alert: {info} Changes apply to your next session.
    buttons: Cancel | *Save
```

^account-settings

Session history is read-only.
