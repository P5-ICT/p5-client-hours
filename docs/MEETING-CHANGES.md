# Changes from the team meeting

Each note from the meeting, what was built, and where to find it.

| Note | What was built | Where |
|---|---|---|
| The 45 hours are split between departments (marketing gets 8) | Each department can have its own share of the cycle's hours. Reports show what each department used against its share, and flag a department that went over | **Team and settings > Hours for each department**; the department bars on Overview and Reports |
| Rename "paid hours" so clients do not think they only pay for hours worked | "Paid hours" is gone from every screen, report, export and email. The cap is now **hours allocated**, and the total used is **hours used** | Everywhere |
| Weekly and monthly reports, to pull before invoicing | A report can cover a **cycle, a week (Monday to Sunday) or a month**, and you can step back to earlier ones | **Management > Reports** (the client has the same on their report) |
| Download as Excel | **Download Excel** makes a workbook with five sheets: Summary, By department, By project, By person, Work log. Hours are numbers, so Excel can add them up. CSV and print are still there | Reports page |
| Build the executive report automatically from the captured work | **Summary of the work** is written from the approved entries: headline, hours by department against allocation, progress by project with the main pieces of work named, type of work, who did the work, comparison with the last period, and things worth knowing. It can be copied as text for an email, printed, and it is also the first sheet of the Excel file | Reports page |
| Management can capture hours for other teams | A manager, the CEO or an admin can pick **who worked these hours** when typing time in. The entry is marked "typed in by ..." | **Track time > Forgot to start the timer** |
| How long must a timer run before it can be stopped? (answer unclear in the transcript) | The shortest timer is now a setting. It is **1 minute** until you choose otherwise. The timer screen tells staff how long is left | **Team and settings > Shortest timer** |
| Extending hours is management only | Managers, the CEO and admins can **add hours to a cycle**, with a reason the client can see. Staff and the client cannot. It can be removed again, and every change is in the audit log. The 80% and 100% email alerts use the extended total | **Management > Overview > Hours for this cycle** |
| Management can start the timer and log work for others | Typing in hours for someone else is built (above). Starting a *running timer* for someone else is not | see "Not built" |
| The client only sees approved entries | Already so, and now covered by more tests | |
| Cycle view, "day 8 of 14" | Already there | Overview |
| Attach proof or a file | Proof links work. File upload is not built | see "Not built" |

## Decisions I made that you may want to change

1. **Hours typed in for someone else wait for a different manager.** The person who typed them in cannot approve them, and neither can the person they are for. This keeps the "nobody approves their own hours" rule. The catch: if Mem types in marketing's hours, Gabi or Megan approves them. If you would rather the manager who checked the work approves it as they type it in, that is a small change, but then one manager can both record and approve the same hours.
2. **The shortest timer starts at 1 minute.** Nobody said what the limit should be. Set it on the settings screen; 15 is a common choice, but a 15 minute limit means a 10 minute task has to be typed in by hand instead.
3. **"Hours allocated" is my wording.** Mem asked for "hours used" or "hours worked". "Hours used" is the total taken so far. For the cap itself I needed another word, so I used "hours allocated". One place to change if you prefer another: the screens and `README`.
4. **The executive report is written by rules, not by an AI service.** It stays inside the system, costs nothing per report, and the client's data is not sent anywhere. It can name the main work and the numbers, but it will read plainer than a person or ChatGPT would write it. If you want smoother prose later, that can be added on top, as an optional button.
5. **Admins can add hours to a cycle, as well as managers and the CEO.** Admins still cannot approve hours.

## Not built

- **Starting a running timer for another person.** A timer belongs to one person. Management types in the hours instead, which gives the same record. Say if you really need the live timer for others.
- **File upload as proof.** Needs file storage (Render's disk is wiped on each deploy), so it needs a storage service. Proof links (a OneDrive or Drive link) work now.
- **Excel formatting beyond the basics** (charts, colours). The data and totals are there.

## Questions to take back to the team

- What should the shortest timer be? (point 2)
- Who approves hours that management types in? (point 1)
- Should the client see the Summary of the work, or only the figures and the work log? Right now they see both.
- Should the department shares add up to exactly the cycle's hours? The screen warns if they go over, but does not block it.
