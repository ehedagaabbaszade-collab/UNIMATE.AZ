# Beta guide

For testers of UNIMATE.AZ. The app has not been tested on real devices or against live infrastructure before this beta, so expect bugs. Setup by the organiser comes first ([DEPLOYMENT.md](DEPLOYMENT.md), [MOBILE_BUILD.md](MOBILE_BUILD.md)).

## Onboarding
1. Android: install the preview APK link from the organiser. iOS: accept the TestFlight invite. Web: open the beta URL.
2. Sign up with an email, confirm it, choose your language (az, tr, en or ru) and your university in onboarding.
3. Staff testers: the organiser promotes your account to a staff role; the admin console is a separate site.

## What to test per module
- **AI Study**: upload a PDF, DOCX, PPTX or image; check processing finishes; summary, quiz, flashcards, exam simulation, document chat (are citations correct?). If the organiser has not configured an AI provider you will see an "AI not configured" message; that is expected.
- **Planner / GPA / Focus**: create tasks, classes, exams; calculate GPA. Known: on mobile, planner dates are typed text.
- **Notes library**: upload a note, search, rate, save, download; reporting.
- **Campus**: join communities, post, comment, react, ask a question (also anonymously), create an event and RSVP, create a study group with an invite code; block and report.
- **Career**: browse listings (empty until an admin adds some), track an application, build a CV and export/print it, interview prep.
- **Gamification**: XP, streaks, achievements after quizzes and flashcards.
- **Notifications, settings, language**: switch language and check it follows you across devices; request and cancel account deletion; export your data.
- **Admin (staff only)**: users, academic data, moderation, AI config, cost dashboard, audit log.

## Reporting bugs
Send to the organiser's channel (TBD): device and OS, app version, language, steps, expected vs actual, screenshot. Do not include real personal documents or passwords.

## Known limitations
No push notifications; no followers/following lists; no MFA; no payments (plans are display-only); a suspended user can keep using the app until their access token expires; quiz regenerate resets the first-attempt record; Campus content is not translated; texts in az, tr, ru await native review; legal pages are drafts. Complete list: [FINAL_DELIVERY_REPORT.md](FINAL_DELIVERY_REPORT.md).
