# UNIMATE.AZ — hüquqi sənədlər üçün çatışmayan məlumatlar

Tarix: 2026-11-18. Bu, hüquqi məsləhət deyil. Yekun mətnlər Azərbaycan hüquqşünası tərəfindən yoxlanmalıdır.

Mənbə qeydi:
- Qanun maddələri rəsmi mətnlərin qeyri-rəsmi surətlərindən oxunub. e-qanun.az bağlantını kəsdi.
- "Fərdi məlumatlar haqqında" Qanun 2018-ci il redaksiyası ilə yoxlanıb. 2024-cü il dəyişikliyi (1193-VIQD) barədə xəbər var, amma mətni yoxlanmayıb.
- Hər istinadın yanında yoxlanma statusu göstərilib:
  - **Təsdiq:** maddə mətni oxunub.
  - **Təsdiqsiz:** mətn oxunmayıb.

---

## A. Hüquqşünasın qərar verməli olduğu kritik məsələlər (sənədlərin yekunlaşmasını bloklayır)

1. **16–17 yaşlıların fərdi məlumatlarına razılıq.**
   - "Fərdi məlumatlar haqqında" Qanun (№ 998-IIIQ, 11.05.2010), m. 8.3: yetkinlik yaşına çatmayanın məlumatlarının emalına razılığı valideyn və ya qəyyum verir. *Təsdiq.*
   - Mülki Məcəllə, m. 28.2: tam fəaliyyət qabiliyyəti 18 yaşdan başlayır. *Təsdiq.*
   - Deməli 16–17 yaşlı istifadəçinin öz razılığı kifayət etməyə bilər.
   - **Qərar lazımdır:** valideyn razılığı mexanizmi qurulsun, yoxsa minimum yaş 18 olsun?
2. **Razılığın forması.**
   - m. 8.1: emal üçün yazılı razılıq lazımdır. Bu, gücləndirilmiş elektron imzalı elektron sənəd və ya şəxsin özünün təqdim etdiyi yazılı məlumat ola bilər. *Təsdiq.*
   - m. 8.4: razılığın alındığını operator sübut etməlidir. *Təsdiq.*
   - Sadə checkbox-un, istifadəçinin özünün təqdim etdiyi "yazılı məlumat" sayılıb-sayılmaması açıq qalır. Sistem hər razılığı tarix, sənəd versiyası və istifadəçi ilə qeydə alır, amma bunun kifayət etdiyini hüquqşünas təsdiqləməlidir.
   - "Elektron imza və elektron sənəd haqqında" Qanun oxunmayıb. *Təsdiqsiz.*
3. **Razılığın məzmunu.**
   - m. 8.2: razılıqda operator, məqsəd, məlumatların siyahısı, emal əməliyyatları, müddət, geri götürmə və silinmə şərtləri göstərilməlidir. *Təsdiq.*
   - Ona görə Məxfilik Siyasətinin "qəbulu" ilə emala razılıq ayrı tutulub. Ayrıca, itemləşdirilmiş razılıq mətni hazırlanmalıdır.
4. **İnformasiya sisteminin dövlət qeydiyyatı.**
   - m. 15.1–15.2: fərdi məlumatların informasiya sistemi dövlət qeydiyyatına alınmalıdır. Qeydiyyatsız emal qadağandır. *Təsdiq.*
   - m. 15.4: qeydiyyat bir ay ərzində, yazılı ərizə ilə aparılır. *Təsdiq.*
   - **Real istifadəçi qəbulundan əvvəl edilməlidir.**
5. **Məlumatların xaricə ötürülməsi.**
   - Supabase serverləri və AI provayderləri Azərbaycandan kənardadır.
   - m. 14.2: qorunma səviyyəsi aşağı olan ölkəyə ötürmə qadağandır. *Təsdiq.*
   - m. 14.3: subyektin razılığı ilə istisna mümkündür. *Təsdiq.*
   - Ötürmənin hüquqi əsası razılıqdır, yoxsa başqa bir əsas? Hüquqşünas müəyyən etməlidir.
6. **Ödənişli abunə və 16–17 yaş.**
   - Mülki Məcəllə, m. 30.1: 14–18 yaşlıların əqdləri üçün valideynin yazılı razılığı lazımdır. *Təsdiq.*
   - İstisnalar: öz qazancı (m. 30.2.1) və xırda məişət əqdləri (m. 29.2). *Təsdiq.*
   - Abunəliyin "xırda" sayılıb-sayılmaması müəyyən deyil.
   - Hazırda sistem 18 yaşdan kiçiklərə ödənişi bağlı saxlayır (TODO).
7. **Pulsuz xidmət və 16–17 yaş.**
   - Mülki Məcəllə, m. 29.2 / 30.2.4 əsasında əvəzsiz fayda əqdi kimi qəbul edilə bilər. Bu, şərhdir, hüquqşünas təsdiqləməlidir.
8. **Hesab silinəndə razılıq qeydlərinin saxlanması.**
   - m. 8.4-ə görə razılıq sübut olunmalıdır, m. 9.4-ə görə isə məqsəd bitəndə məlumat silinməlidir. *Təsdiq.*
   - Hesab silinəndən sonra razılıq jurnalı nə qədər saxlanmalıdır?
   - Hazırda hesabla birlikdə silinir.

## B. AI provayderləri (ən təcili texniki-hüquqi məsələ)

1. **Kod hazırda Gemini və OpenAI işlətmir.**
   - Bütün AI funksiyaları NVIDIA NIM (`nvidia/nemotron-3.5-lightning-30b-a3b`) üzərindədir. Bu, NVIDIA API **sınaq (Trial)** şərtləridir.
   - Real istifadəçilərə xidmət üçün NVIDIA AI Enterprise lisenziyası tələb olunur.
   - Kodda Gemini inteqrasiyası yoxdur.
2. **Gemini API.**
   - Şərtlərinə görə tərtibatçı 18+ olmalıdır.
   - 18 yaşdan kiçiklərin istifadə edəcəyi ehtimal olunan tətbiqdə istifadəsi qadağandır. *Təsdiq:* ai.google.dev/aistudio Gemini API Terms.
   - Pulsuz səviyyədə məlumat model təlimində istifadə oluna və insanlar tərəfindən oxuna bilər.
   - **16+ istifadəçi bazası ilə uyğun deyil.** Gemini seçilərsə, minimum yaş 18 olmalıdır.
3. **OpenAI API.**
   - Məlumatlar defolt olaraq model təlimində istifadə olunmur.
   - Jurnallar 30 günədək saxlanır.
   - Zero data retention yalnız təsdiq almış müştərilərə verilir. *Təsdiq:* developers.openai.com "Your data".
   - Son istifadəçi yaşı ilə bağlı tələblər yoxlanmayıb. *Təsdiqsiz.*
4. **Qərar lazımdır:**
   - Hansı provayder və hansı tarif (pulsuz/ödənişli) istifadə olunacaq?
   - Embedding (sənəd axtarışı) üçün hansı provayder?
   - Siyahı məlum olandan sonra Məxfilik Siyasətinin 5-ci və 7-ci bölmələri yazıla bilər.

## C. MMC qeydiyyatından sonra doldurulacaq məlumatlar

- MMC-nin tam hüquqi adı
- VÖEN
- Hüquqi və faktiki ünvan
- Rəsmi əlaqə e-poçtu, o cümlədən məxfilik, silinmə və şikayət müraciətləri üçün ayrıca ünvan, və telefon
- Məsul şəxs (direktor və ya məlumat qorunması üzrə məsul)
- İnformasiya sisteminin dövlət qeydiyyatı nömrəsi (A.4)
- Sənədlərin qüvvəyə minmə tarixi

## D. Biznes qərarları (placeholder kimi saxlanılır)

- **Ödəniş provayderi** (Payriff, Epoint və ya digəri). Kodda hazırda yalnız demo stub var.
- Plan adları, qiymətlər, valyuta, abunə müddəti.
- Avtomatik yenilənmə olacaqmı?
- **Ləğv və geri ödəniş qaydası.**
  - "Elektron ticarət haqqında" Qanun (№ 908-IIQ), m. 9.1: 7 iş günü ərzində səbəbsiz imtina hüququ var. *Təsdiq:* qeyri-rəsmi tərcümə.
  - Bu hüququn rəqəmsal xidmətlərə aid olub-olmadığı yoxlanmayıb.
- **Satıcı haqqında sifarişdən əvvəl göstərilməli məlumat.** m. 8.1: ad, ünvan, qiymət, ödəniş şərtləri, imtina hüququ. *Təsdiq.*
- **İcma (Kampus) funksiyası.** Kodda marşrutları mövcuddur (`/campus`). Rəsmi olaraq "aktiv deyil" sayılırmı, yoxsa açılışda aktiv olacaq? İcma Qaydaları buna görə yazılacaq.
- Marketinq məktubları hansı xidmətlə göndəriləcək?

## E. Koddan aşkar olunan faktlar (sənədlərə düzgün yazılmalı)

| Mövzu | Faktiki vəziyyət |
|---|---|
| Giriş | Yalnız e-poçt + parol (Supabase Auth). OAuth və SMS yoxdur. |
| Sessiya | Web-də Supabase cookie-ləri. Mobildə cihazın təhlükəsiz yaddaşı (SecureStore). |
| Cookie / lokal yaddaş | Web cookie-ləri: `um-theme`, `um-locale`. localStorage: `um.sidebar.collapsed`, imtahan qaralamaları, onboarding. Mobil: mövzu, dil, oflayn cədvəl. **Analitika və reklam cookie-si yoxdur.** |
| Fayl yaddaşı | `documents`, `resources`, `submissions` qovluqları özəldir. `avatars` qovluğu **açıqdır**: profil və CV şəkilləri linki bilən hər kəsə görünür. |
| CV məlumatları | Şəxsiyyət nömrəsi, doğum tarixi, vətəndaşlıq, cins, ünvan, şəkil, sosial şəbəkələr. **Həssas məlumatlardır**, Məxfilik Siyasətində ayrıca göstərilməlidir. |
| Sənəd silinəndə | Mətn hissələri və söhbətlər silinir. **Quiz, flashcard və xülasələr silinmir**, yalnız sənədlə əlaqəsi qırılır. Ya kod dəyişməlidir, ya da Saxlanma Siyasəti buna uyğun yazılmalıdır. |
| Hesabın silinməsi | 14 günlük gecikmə ilə, ləğv edilə bilir. Sonra avtomatik təmizlənir. Ehtiyat nüsxələrdə Supabase-in saxlama müddəti bitənə qədər qalır. Bu müddət dəqiqləşməlidir: Supabase planından asılıdır. |
| Doğum tarixi | Yeni sistemdə ayrıca, yalnız sahibinin görə bildiyi cədvəldə saxlanır. Profildə görünmür. |
| Jurnallar | AI istifadə sayğacları, audit jurnalı, xərc qeydləri. IP ünvanı cədvəllərdə saxlanmır, Supabase-in öz jurnallarında qalır. **Saxlama müddəti təyin edilməyib.** |
| Məlumat ixracı | İstifadəçi üçün tam "məlumatlarımı yüklə" funksiyası yoxdur (m. 7 hüquqları). |
| Ödəniş | Hələ yoxdur (demo). |
| Hostinq | Web hələ heç yerdə yerləşdirilməyib. Vercel nəzərdə tutulub. |
| E-poçt göndərmə | Supabase Auth-un standart göndəricisi. Öz SMTP qurulmayıb. |

## F. Yoxlanmamış qanunlar (hüquqşünas yoxlamalıdır)

- "İstehlakçıların hüquqlarının müdafiəsi haqqında" Qanun: geri ödəniş, ədalətsiz şərtlər, məlumat vermə öhdəlikləri.
- "Elektron imza və elektron sənəd haqqında" Qanun.
- Nazirlər Kabinetinin 06.09.2010 tarixli 161 nömrəli Qərarı: fərdi məlumatların mühafizəsi tələbləri. Mövcudluğu təsdiqlənib, məzmunu oxunmayıb.
- Fərdi məlumatlar qanununda "xüsusi kateqoriya" anlayışı və lokallaşdırma tələbi (2024 redaksiyası).
- Mülki Məcəllədə yetkinlik yaşına çatmayanın əqdinin etibarsızlığı maddəsi.
- Süni intellekt və avtomatlaşdırılmış qərarlar: xüsusi qayda tapılmadı. m. 7.3 avtomatik emalla qəbul edilən qərara etiraz hüququnu verir. *Təsdiq.*
