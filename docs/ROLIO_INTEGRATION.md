# Rolio inteqrasiyası: Karyera bölməsi

Status: araşdırma (2026-11-17). Kod yazılmayıb. Rolio ilə razılaşma var; texniki giriş (API açarı, SSO) gözlənilir.

Mənbə: rolio.az namizəd kabinetinin bölmə-bölmə yoxlanması (heç nə dəyişdirilmədən) və saytın açıq `/api/jobs` cavabları.

## 1. Rolio-da nə var (namizəd tərəfi)

### Kabinet (`/app/...`)
| Bölmə | URL | Nə edir |
|---|---|---|
| Panel | `/app/cabinet` | Salamlama, "N vakansiya uyğundur", profil gücü (%), sayğaclar: müraciət, profil baxışı, müsahibə, təklif; uyğun vakansiyalar (5); növbəti müsahibə |
| Profil gücü | `/app/profile/strength` | Hissələr və çəkiləri: əsas məlumat 15, haqqında 10, təcrübə 25, təhsil 15, bacarıqlar (≥4) 15, dillər 5, layihələr 15; tövsiyə |
| Profilim | `/app/cabinet/profile` | Tablar: Şəxsi məlumat · CV & sənədlər · Bildiriş seçimləri · Məxfilik. "AI ilə yaxşılaşdır", "İşəgötürənlərə görün" açarı, cover və profil şəkli |
| Profil redaktəsi | `?edit=true` | Vəzifə, şəhər, telefon, hazırkı şirkət, haqqımda, təcrübə, təhsil, layihə, bacarıqlar, dillər (səviyyə ilə), iş istəkləri (vəzifə, maaş min–max, format, şəhərlər) |
| CV & sənədlər | `?tab=cv` | CV faylı (yüklə, endir, dəyiş, sil); CV yaradıcısı: 4 şablon (Klassik, Müasir, Minimal, Kompakt), PDF endir, "CV sənədim et" |
| Müraciətlər | `/app/cabinet/applications` | Statuslar: Aktiv · Müsahibələr · Təkliflər · İşə götürüldü · Yekunlaşıb · Geri götürülüb |
| Müsahibələr | `/app/cabinet/interviews` | İşəgötürənin təyin etdiyi görüşlər: vaxt, format, qoşulma linki |
| İmtahanlar | `/app/cabinet/assessments` | İşəgötürənin müraciətə bağlı göndərdiyi testlər |
| AI müsahibələr | `/app/cabinet/ai-interviews` | İşəgötürənin göndərdiyi səsli AI müsahibə (kamera və mikrofon, istənilən vaxt) |
| Müsahibə məşqi | `/app/cabinet/practice` | "Leyla" ilə səsli məşq: hər cavaba rəy verir. Starter planından başlayır |
| Dəvətlər | `/app/cabinet/invites` | Profili tapan şirkətlərin müraciət dəvətləri |
| Saxlanılanlar | `/app/saved-jobs` | Ürək qoyulan elanlar |
| AI tövsiyələri | `/app/recommendations` | Uyğunluğa görə sıralanmış siyahı. Kartda bal və "Uyğun gələn: …" |
| Vakansiya bildirişləri | `/app/job-alerts` | Açar söz və şəhər üzrə bildiriş; "Telegram-a qoşul" (hər istifadəçiyə ayrıca bot linki) |
| Karyera analitikası | `/app/insights` | Profil baxışı (30 gün), recruiter marağı (7 gün), uyğun vakansiya sayı, ən çox tələb olunan bacarıq, karyera istiqaməti tövsiyəsi (AI mətn) |
| Roli AI | `/app/assistant` | Profilə əsaslanan karyera çatı. Hazır suallar: CV, müsahibə, maaş aralığı, bacarıqlar |
| Mesajlar | `/app/messages` | İşəgötürənlə yazışma |
| Bildirişlər | `/app/notifications` | Müraciət, müsahibə və mesaj yenilikləri |
| Planım | `/app/plan` | Free · Starter 3 ₼ · Pro 9 ₼ · Business 19 ₼. Fərqlər: AI mesaj limiti, müsahibə hazırlığı, səsli məşq, bazar hesabatı, profilə baxan şirkətlər |
| Tənzimləmələr | `/app/settings/...` | Hesab · Profil görünürlüyü (İctimai / Təsdiqlənmiş işəgötürənlər / Gizli + recruiter axtarışı) · Bildirişlər (status, uyğun vakansiya, marketinq) · İş tərcihləri (vəzifə, səviyyə, maaş, format, sahələr, şəhərlər) · Təhlükəsizlik (şifrə, deaktiv) · Bağlı hesablar (LinkedIn, GitHub) |

### Açıq bölmələr
| Bölmə | URL | Nə edir |
|---|---|---|
| Vakansiyalar | `/jobs` | Şirkət story-ləri, axtarış və şəhər, filtrlər (iş formatı, məşğulluq növü, minimum maaş, uyğunluq balı 60/75/85%+, yerləşdirilmə tarixi), sıralama, kart və siyahı görünüşü |
| Elan detalı | `/jobs/{id}` | Uyğunluq analizi: bal, "Uyğun gələnlər", "Çatmayanlar", bal hissələri (bacarıq, təcrübə, şəhər, maaş). Maaş, son tarix, Müraciət et / Elana keç (xarici elan), "Bu vakansiya üzrə məşq et", qısa məlumat, şirkət kartı (İzlə), oxşar vakansiyalar, şirkətin Life postları |
| Şirkətlər | `/companies`, `/companies/{id}` | 287 şirkət; şirkət səhifəsi: İzlə, vebsayt, Vakansiyalar və Life tabları |
| Remote | `/remote` | Xarici platformalardan uzaqdan iş elanları (bal yoxdur, birbaşa keçid) |
| Life | `/life` | Şirkətlərin Instagram postları lenti; izlədiklərim; "İzləməyə dəyər" |
| Karyera | `/career` | Bələdçi məqalələr (CV, maaş danışıqları, karyera dəyişikliyi) |
| CV yoxla | `/cv-yoxla` | Qeydiyyatsız CV yükləmə: neçə vakansiyaya uyğundur, maaş bazarı |

### Məlum API (yalnız açıq hissəsi; `robots.txt` `/api/`-ni bağlayır, partnyor açarı ilə istifadə ediləcək)
- `GET /api/jobs?sort=&pageSize=&q=` → `{items,total,skip,take}`.
- `GET /api/jobs/{id}`. Sahələr:
  - əsas: `title`, `company{id,name,logoUrl,isVerified}`, `location`, `employmentType`, `workMode`;
  - maaş və tarixlər: `salaryMin/Max`, `currency`, `postedAt`, `deadline`;
  - mətn: `description`, `requirements`, `niceToHave`, `benefits`, `skills`;
  - uyğunluq: `matchScore`, `matchBreakdown`;
  - xarici elan: `isExternal`, `externalApplyUrl`;
  - digər: `marketSalary`, `languages`.
- `GET /api/jobs/facets`, `GET /api/jobs/locations`, `GET /api/companies?onlyHiring=&withLogo=&take=`, `GET /api/companies/{id}/logo`.

## 2. UNIMATE Karyera bölməsində necə olacaq

**Qərar (istifadəçi, 2026-11-17):** Karyera bölməsi Rolio tətbiqinin bire-bir surətidir: eyni bölmələr, eyni ekranlar, eyni axın, eyni düzülüş. Yalnız rənglər UNIMATE palitrasındadır (Midnight Indigo). Bunun üçün istifadəçi adından işləyən **partnyor API** lazımdır; AI səsli müsahibə və Leyla məşqi tətbiqin içində avtomatik girişli Rolio səhifəsi kimi açılır.

İndiki tablar: Fürsətlər · Sənə uyğun · İzləmə · CV · Müsahibə.

Rolio qoşulduqdan sonra:

| UNIMATE tabı | Rolio-dan nə gəlir | Necə |
|---|---|---|
| **Panel** (yeni, birinci tab) | Salamlama, profil gücü, 4 sayğac, 5 uyğun vakansiya, növbəti müsahibə | Native |
| **Vakansiyalar** (Fürsətlər) | `/jobs` siyahısı, filtrlər, bal; bizim tələbə fürsətləri (təcrübə, təqaüd) ayrıca bölmədə qalır | Native |
| **Sənə uyğun** | AI tövsiyələri: bal, uyğun gələn və çatmayan | Native |
| Elan detalı | Uyğunluq analizi, bal hissələri, Müraciət et / Elana keç, Yadda saxla, İzlə, oxşar | Native |
| **Müraciətlərim** (İzləmə) | 6 status; bizim İzləmə lövhəsi xarici elanlar üçün qalır | Native |
| **CV** | Profil redaktəsi (Rolio profili mənbədir), CV faylı, CV yaradıcısı (şablonlar), profil gücü, "AI ilə yaxşılaşdır" | Native forma + PDF Rolio-dan |
| **Müsahibə** | Müsahibələr, imtahanlar, AI müsahibələr, Leyla məşqi; bizim InterviewPanel (AI suallar) qalır | Siyahı native, AI və səsli müsahibə WebView (SSO) |
| Dəvətlər, Mesajlar, Bildirişlər | Siyahılar | Əvvəl WebView (SSO), sonra native |
| Analitika, Roli AI | — | WebView (SSO) |
| Şirkətlər, Life, Remote, Karyera məqalələri | — | WebView və ya link |
| Vakansiya bildirişləri | Açar söz və şəhər bildirişləri | Native forma; bildiriş bizim push ilə (webhook) |
| Telegram | Kanal linki + şəxsi bot linki | Linklər |
| Görünürlük, İşə açığam | Açarlar | Native (CV tabında) |
| Planlar və ödəniş | — | Göstərilmir, Rolio-da qalır (App Store qaydası) |

Prinsiplər:
- Rolio açarı yalnız edge funksiyasında saxlanır (`rolio` funksiyası), heç vaxt `EXPO_PUBLIC_*` və ya `NEXT_PUBLIC_*`-da olmur.
- Hər istifadəçi ilk dəfə razılıq ekranından keçir: "Profilim Rolio ilə paylaşılsın". Razılıq geri götürüləndə Rolio-dakı məlumat silinir.
- Hesab silinəndə (`purge-accounts`) Rolio-ya silmə sorğusu gedir.
- Bütün mətnlər 4 dildədir (az, tr, en, ru). Rolio-dan gələn elan mətni tərcümə olunmur.

## 3. Rolio-dan lazım olanlar (texniki siyahı)

1. **Partnyor girişi.** Sandbox və production API açarı, OpenAPI sənədi, rate limit.
2. **Namizəd hesabı.** UNIMATE istifadəçisi üçün namizəd yaratmaq və ya mövcud hesabı e-poçtla bağlamaq → `candidateId`.
3. **SSO.** Namizəd üçün birdəfəlik, qısa ömürlü giriş linki (WebView üçün); WebView və cookie-lər bloklanmasın.
4. **Profil.** Profili (şəxsi məlumat, təcrübə, təhsil, layihə, bacarıqlar, dillər, iş istəkləri) oxumaq və yazmaq; profil gücü; "AI ilə yaxşılaşdır".
5. **CV.** CV faylını yükləmək, endirmək və silmək; CV parse (PDF/DOCX → profil); CV yaradıcısı (şablon → PDF).
6. **Uyğunluq.** Tövsiyələr (bal, səbəb, səhifələmə, filtrlər); elan üzrə `matchBreakdown`.
7. **Vakansiyalar.** Siyahı, facets, detal, şirkət, saxlanılanlar (əlavə et / sil).
8. **Müraciət.** Müraciət et, siyahı və statuslar, geri götür.
9. **Müsahibələr.** Müsahibələr, imtahanlar, AI müsahibələr, dəvətlər: siyahı (detal SSO ilə).
10. **Bildirişlər.** Vakansiya bildirişləri (CRUD); webhook-lar: status dəyişdi, yeni mesaj, yeni dəvət, yeni uyğun vakansiya.
11. **Görünürlük.** "İşə açığam" və görünürlük səviyyəsi.
12. **Telegram.** Kanal linki; namizədin botu bağlaması üçün xüsusi link (`t.me/<bot>?start=<token>`).
13. **Hesab silmə.** Namizədin bütün məlumatlarını silmək üçün endpoint.
14. **Planlar.** Partnyor istifadəçiləri üçün AI limitləri (Roli AI, Leyla məşqi, bazar hesabatı): pulsuz kvota və ya xüsusi plan.
15. **Brend.** Loqo (SVG/PNG), adın istifadə qaydası, link formatı (`utm_source=unimate`).
16. **Hüquqi.** Şəxsi məlumatların paylaşılması razılaşması (DPA) və istifadəçi razılığının mətni.

Minimum başlanğıc: 1, 2, 3, 6, 7. Bunlarla Panel, Vakansiyalar, Sənə uyğun və elan detalı native olur, qalan hər şey SSO ilə WebView-da açılır.

## 4. Mərhələlər

1. **Mərhələ 1 (açar gələndə):**
   - edge funksiyası `rolio`;
   - razılıq ekranı;
   - Panel, Vakansiyalar, Sənə uyğun, elan detalı;
   - qalan bölmələr WebView + SSO ilə;
   - Telegram linkləri.
2. **Mərhələ 2:** CV və profil native (Rolio profili mənbədir), müraciət, Müraciətlərim, saxlanılanlar, vakansiya bildirişləri + push.
3. **Mərhələ 3:** müsahibə, dəvət, mesaj və bildiriş siyahıları native; hesab silmə sinxronu.
