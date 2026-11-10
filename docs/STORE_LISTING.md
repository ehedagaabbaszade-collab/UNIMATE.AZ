# Store listing (Google Play and App Store)

**All az, tr and ru text below is machine-drafted by the developer assistant and MUST be reviewed by native speakers before submission.** English is the source. Do not claim features that are not live (see FINAL_DELIVERY_REPORT: no payments, no push notifications, AI needs a configured provider). Store character limits (Play: title 30, short 80, long 4000; App Store: name 30, subtitle 30, keywords 100) should be re-checked in the consoles; counts here were not machine-verified.

## Common
- App name: UNIMATE.AZ
- Bundle id / package: `az.unimate.app` (placeholder)
- Primary category: Education. Secondary: Productivity.
- Support URL, privacy policy URL, marketing URL: TBD (need your domain; in-app legal pages are drafts for legal review).
- Contact email: TBD.

## English
- Subtitle: Your study companion
- Short description: Study smarter: notes, planner, AI study tools and campus community for students.
- Long description: UNIMATE.AZ helps university students in Azerbaijan study and stay organised. Upload your documents and get summaries, quizzes and flashcards, and ask questions with citations to your own material. Plan classes, tasks and exams, track your GPA, share and find notes, join campus communities and study groups, and prepare for your career with a CV builder and interview practice. Available in Azerbaijani, Turkish, English and Russian.
- Keywords: study,university,students,notes,flashcards,quiz,planner,GPA,campus,Azerbaijan,CV

## Azərbaycan (needs native review)
- Subtitle: Təhsil yoldaşınız
- Short description: Daha ağıllı oxuyun: qeydlər, planlayıcı, AI təhsil alətləri və kampus icması.
- Long description: UNIMATE.AZ Azərbaycanda universitet tələbələrinə öyrənməkdə və təşkilatlanmaqda kömək edir. Sənədlərinizi yükləyin, xülasə, test və fleşkartlar alın, öz materialınıza istinadlarla suallar verin. Dərsləri, tapşırıqları və imtahanları planlayın, GPA-nı izləyin, qeydləri paylaşın və tapın, kampus icmalarına və dərs qruplarına qoşulun, CV hazırlayıcısı və müsahibə hazırlığı ilə karyeranıza hazırlaşın. Azərbaycan, türk, ingilis və rus dillərində.
- Keywords: təhsil,universitet,tələbə,qeydlər,fleşkart,test,planlayıcı,GPA,kampus,CV

## Türkçe (needs native review)
- Subtitle: Ders arkadaşınız
- Short description: Daha akıllı çalışın: notlar, planlayıcı, yapay zeka çalışma araçları ve kampüs topluluğu.
- Long description: UNIMATE.AZ, Azerbaycan'daki üniversite öğrencilerinin çalışmasına ve düzenli kalmasına yardımcı olur. Belgelerinizi yükleyin; özet, test ve bilgi kartları alın, kendi materyalinize atıfla sorular sorun. Ders, görev ve sınavları planlayın, GPA'nızı takip edin, not paylaşın ve bulun, kampüs topluluklarına ve çalışma gruplarına katılın, CV oluşturucu ve mülakat hazırlığı ile kariyerinize hazırlanın. Azerbaycan Türkçesi, Türkçe, İngilizce ve Rusça dillerinde.
- Keywords: çalışma,üniversite,öğrenci,notlar,bilgi kartı,test,planlayıcı,GPA,kampüs,CV

## Русский (needs native review)
- Subtitle: Ваш помощник в учёбе
- Short description: Учитесь умнее: заметки, планировщик, ИИ-инструменты и студенческое сообщество.
- Long description: UNIMATE.AZ помогает студентам университетов Азербайджана учиться и быть организованными. Загружайте документы и получайте конспекты, тесты и карточки, задавайте вопросы со ссылками на ваши материалы. Планируйте занятия, задачи и экзамены, следите за GPA, делитесь заметками и находите их, вступайте в студенческие сообщества и учебные группы, готовьтесь к карьере с конструктором резюме и подготовкой к собеседованию. На азербайджанском, турецком, английском и русском языках.
- Keywords: учёба,университет,студенты,заметки,карточки,тесты,планировщик,GPA,кампус,резюме

## Age rating notes
Not rated yet; answer the questionnaires yourself. Facts to use: user-generated content (Campus posts, comments, anonymous questions, shared notes) with reporting, blocking and a moderation queue; no in-app purchases or payments; no gambling; no location access; career listings are external links. Likely a teen/17+ style rating because of unmoderated-in-real-time UGC; decide with the consoles' questionnaires. UGC apps usually must show report/block and a moderation contact: reporting and blocking exist in Campus; confirm a published contact.

## Privacy / Data Safety answers (from the documented data practices; confirm with legal review)
| Data | Collected | Purpose | Notes |
| - | - | - | - |
| Email, display name, username, university/faculty, language | Yes | Account, app function | Required for sign-up |
| User content: uploaded documents, notes, chat questions, CV data, Campus posts/comments | Yes | App function | Documents in a private Storage bucket; Campus posts visible per community rules; anonymous questions hide the author from other users |
| Document text and questions sent to a third-party AI provider | Yes, when AI is used | App function | Provider not chosen yet; disclose the chosen provider and its retention in the privacy policy |
| Usage data: AI usage and cost records, XP/streaks, notification records | Yes | App function, abuse/cost limits | Stored in the app's own database |
| Photos | Only user-selected images via the picker | App function | Camera and microphone permissions are not requested (`app.json`) |
| Location, contacts, financial info, health | No | | |
| Third-party analytics / ads / crash SDKs | None found in the workspace `package.json` files | | Re-check before submission |
| Encryption in transit | Yes (HTTPS to Supabase) | | |
| Account deletion | In-app request with 14-day grace period, then purge (see ACCOUNT_DELETION.md) | | Store consoles require a public deletion URL/instructions: TBD |
| Data export | Implemented | | |
| Backups | Retain deleted data until retention ends | | Disclose |
| Export compliance | `ITSAppUsesNonExemptEncryption` is false | | Confirm |

## Screenshots needed (not created)
Capture on real builds, per language you list (az first): 1) Home/dashboard, 2) AI Study: document with summary, 3) quiz, 4) flashcards, 5) document chat with citations, 6) Planner, 7) GPA, 8) Campus feed, 9) Notes library, 10) Career/CV builder, 11) Gamification (XP/streak). Sizes: Play phone screenshots plus 512x512 icon and 1024x500 feature graphic; App Store 6.9-inch and 6.5-inch iPhone sets (iPad not needed: `supportsTablet` is false). Verify current size requirements in the consoles. Icon sources are generated by `npm run brand:build`.
