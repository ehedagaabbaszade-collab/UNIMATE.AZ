# Product

<!-- impeccable:product-schema 1 -->

## Platform

ios

## Users

- **Primary:** university students in Azerbaijan, mostly on their phone between classes, while commuting or while studying. Their job is to turn course material into something they can learn and hand in: summaries, quizzes, flashcards, independent coursework (sərbəst iş) in university format, and their weekly schedule. They also use the app for campus life and to find internships and jobs.
- **Secondary:** university teachers, who prepare exams and quizzes for their students. Today teacher mode is a device-local choice; verified teacher sign-in (official university Outlook account) and delivering exams to students in the app are not built yet.
- **Internal:** UNIMATE staff in the admin console (moderation, AI routing and budgets, plans).

## Product Purpose

UNIMATE.AZ is a study companion for Azerbaijani universities: one app where a student's own course material becomes study aids (AI Study), coursework drafts, a semester plan and budget, plus a campus community and career tools. Success means a student prepares for a class or exam faster and hands in coursework in the format their university expects, in their own language.

## Positioning

Built for the Azerbaijani university system specifically: Azerbaijani-first in every surface and in AI output, university-format coursework (A4, Times New Roman 14pt, 1.5 spacing, title page, contents), a DİM college and program catalog, Work.az career links, and campus spaces per real institution. Generic AI study tools do not carry this local academic format and context.

## Operating Context

- Mobile app (Expo, iOS-first) is the primary product; a Next.js web app and an admin console share the same backend (Supabase).
- Students upload PDF, DOCX and PPTX course files; the AI cites the source pages it used.
- AI runs through a DB-routed provider with hard per-user, per-plan and global spend ceilings; free-plan quotas cap daily AI use.
- Plans: FREE, PLUS, PRO (prices in AZN).

## Capabilities and Constraints

- Languages: Azerbaijani (default), Turkish, English, Russian, all four fully supported in every app, email, notification and AI output. Russian stays. All user-facing strings come from translation keys; Campus content is never auto-translated.
- AI Study: summaries, quizzes, flashcards, document Q&A with page citations; output language follows the user.
- Writing studio: independent coursework and presentations in university format, exported as PDF.
- Teacher mode (device-local): exam builder with multiple-choice and open questions, exported as student paper and answer key PDFs.
- Undecided: verified teacher accounts via Outlook sign-in, in-app exam delivery to students.
- Secrets never reach the client; AI keys live only in server functions.

## Brand Commitments

- Name: UNIMATE.AZ, with the official logo already in the apps.
- Brand palette set by the owner: #4F46E5, #7C3AED, #3B82F6, #06B6DA, #F1F5FF.
- On iOS the app follows Apple Human Interface Guidelines (native tab bar, system controls), with restrained motion.
- Voice: plain, helpful Azerbaijani; no hype.

## Evidence on Hand

- No testimonials, user counts, partner universities, press or benchmarks exist. Do not invent them.
- No fake or placeholder data in the product, and no decorative controls: every button must do its real job.

## Product Principles

1. Azerbaijani first, and correct: a wrong form or clumsy phrasing in AI output or UI is a product bug.
2. The student's own material is the source of truth; AI answers cite it and never fabricate.
3. Fast on a phone between classes: the shortest path from file to study aid.
4. Honest limits: when a quota, budget or missing feature stops something, say so plainly.
5. Simple over clever: premium minimalism, fewer controls, no fake content.

## Accessibility & Inclusion

- Large system text and VoiceOver must keep every required action reachable; respect Reduce Motion.
- Four languages with different lengths and scripts (Latin and Cyrillic) must fit every layout.
