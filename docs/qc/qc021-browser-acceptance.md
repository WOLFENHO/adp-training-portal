# QC-021 browser acceptance matrix

Automated checks cover focus visibility after the player auto-hide timer, accessible timeline text, semantic button controls, responsive CSS rules, and keyboard paging on the administrator dashboard. They do not establish actual screen-reader, Firefox, touch, or fullscreen behavior.

In a protected isolated Preview with disposable accounts and playback records:

| Surface | Keyboard / assistive check | Expected result |
| --- | --- | --- |
| Player | Tab into every control, wait beyond auto-hide, then press Space/Enter | Focus remains visible and activation performs one action. No play loop or unconfirmed seek. |
| Timeline | Arrow keys, Home/End, attempt forward movement into unwatched footage | Value and explanation announced; rejected forward movement returns to confirmed range. |
| Fullscreen | Enter with button, exit with button and Escape | Focus returns to the control; controls remain reachable in both states. |
| Network interruption | Pause/resume, timeout, lost response, reload | Status is announced; playback cannot silently earn verified progress. |
| Admin tables | Tab through section and Previous/Next buttons, screen-reader table headers | Current page count is announced, disabled bounds are clear, failed page retains its old contents and offers Retry. |
| Responsive | 320/375/768/1280px widths, 200% zoom | No clipped controls, action buttons, or horizontal page overflow; table wrapper scrolls with visible focus. |

Record browser/version, account role, viewport, steps and correlation ID. Browser testing is pending QC-014 credential isolation. The former bulk dashboard component remains in source only as rollback reference; the admin page renders the paged component.
