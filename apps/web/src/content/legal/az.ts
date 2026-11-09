import type { LegalDoc } from "./types";

const CONTACT = "[əlaqə e-poçtu nəşrdən əvvəl əlavə olunacaq]";

export const legalAz: Record<string, LegalDoc> = {
  privacy: {
    title: "Məxfilik Siyasəti",
    sections: [
      { h: "Biz kimik", p: [`UNIMATE ("biz") Azərbaycandakı universitet tələbələri üçün təhsil platforması təqdim edir. Operatorun kimliyi və qeydiyyat ünvanı: [tamamlanacaq]. Məxfilik üzrə əlaqə: ${CONTACT}.`] },
      { h: "Nə topluyuruq", ul: [
        "Hesab məlumatları: e-poçt ünvanı, görünən ad, parol (yalnız autentifikasiya provayderimiz tərəfindən hash şəklində saxlanılır).",
        "Təqdim etdiyiniz profil məlumatları: universitet, ixtisas, təhsil ili, interfeys dili.",
        "Təhsil məzmunu: yüklədiyiniz sənədlər, onlardan çıxarılan mətn, xülasələr, söhbət mesajları, quizlər, kartlar və quiz cəhdləriniz.",
        "Planlayıcı məlumatları: dərs cədvəli, tapşırıqlar, imtahanlar və fokus sessiyaları.",
        "İstifadə məlumatları: plan limitlərini tətbiq etmək üçün AI mesajı və yükləmə sayğacları, həmçinin xidməti işlətmək və qorumaq üçün lazım olan texniki jurnallar.",
        "Cihazınızda: mövzu və dil seçiminiz (kukilər), onboarding məqsədləriniz və oflayn istifadə üçün cədvəlin saxlanılmış nüsxəsi (brauzer yaddaşı).",
      ] },
      { h: "Niyə istifadə edirik", ul: [
        "İstədiyiniz funksiyaları təmin etmək üçün (saxlama, sənədləriniz haqqında cavablar, cədvəl).",
        "Plan limitlərini tətbiq etmək, sui-istifadənin qarşısını almaq və xidməti təhlükəsiz saxlamaq üçün.",
        "Hüquqi öhdəlikləri yerinə yetirmək üçün.",
      ] },
      { h: "AI emalı", p: ["Sual verdikdə və ya xülasə, quiz, kart istədikdə sənədinizin müvafiq hissələri nəticəni yaratmaq üçün AI model provayderinə göndərilir [provayder və emal yeri dəqiqləşdiriləcək]. Sənədlərinizi modelləri öyrətmək üçün istifadə etmirik [provayder şərtlərinə qarşı dəqiqləşdiriləcək]. AI Xəbərdarlığına baxın."] },
      { h: "Paylaşma", p: ["İnfrastruktur provayderlərindən (verilənlər bazası, fayl saxlama, autentifikasiya, hostinq, AI) müqavilə əsasında emal edən tərəf kimi istifadə edirik. Şəxsi məlumatları satmırıq. Gələcək funksiya açıq şəkildə paylaşmağa icazə verməyincə sənədləriniz yalnız hesabınız üçün məxfidir."] },
      { h: "Saxlama müddəti", p: ["Məlumatın Saxlanması səhifəsinə baxın. Qısaca: məzmun siz silənə və ya hesabınız ləğv olunana qədər qalır."] },
      { h: "Hüquqlarınız", p: [`Məlumatlarınıza çıxış, düzəliş, ixrac və ya silinmə tələb edə bilərsiniz. Parametrlərdən oxuya bildiyiniz məlumatların ixracını yükləyə bilərsiniz. Hesabın silinməsi hazırda əl ilə icra olunur: ${CONTACT} ünvanına yazın. Tətbiq olunan hüquq Azərbaycan Respublikasının fərdi məlumatlar haqqında qanunvericiliyidir [hüquqi əsas və istinadlar hüquqşünas tərəfindən tamamlanacaq].`] },
      { h: "Uşaqlar", p: ["Xidmət 16 və daha yuxarı yaşlı istifadəçilər üçündür [yaş həddi dəqiqləşdiriləcək]."] },
      { h: "Dəyişikliklər", p: ["Yenilikləri bu səhifədə dərc edəcəyik, əhəmiyyətli dəyişikliklər barədə isə tətbiqdə xəbər verəcəyik."] },
    ],
  },
  terms: {
    title: "İstifadə Şərtləri",
    sections: [
      { h: "UNIMATE-dən istifadə", p: ["Hesab yaratmaqla bu şərtlərlə razılaşırsınız. Dəqiq məlumat verməli və giriş məlumatlarınızı qorumalısınız. Hesabınız altındakı fəaliyyətə görə siz məsuliyyət daşıyırsınız."] },
      { h: "Sizin məzmununuz", p: ["Yüklədiyiniz məzmunun sahibi olaraq qalırsınız. Xidməti işlətmək üçün onu saxlamağa, emal etməyə və sizə göstərməyə dair məhdud lisenziya verirsiniz. Yalnız istifadə hüququnuz olan materialları yükləyin. Müəllif hüquqlarını pozan, zərərli proqram olan və ya başqalarının məxfiliyini pozan məzmun yükləməyin."] },
      { h: "Məqbul istifadə", ul: [
        "Xidməti sındırmağa, yoxlamağa, həddindən artıq yükləməyə və ya plan limitlərini keçməyə cəhd etməyin.",
        "Xidməti təqib, təhsil müəssisənizin qaydalarını pozan saxtakarlıq və ya qanunsuz fəaliyyət üçün istifadə etməyin.",
        "İcma Qaydalarına əməl edin.",
      ] },
      { h: "Planlar və limitlər", p: ["Pulsuz və ödənişli planların AI mesajı, sənəd və səhifə limitləri var. Limitlər və qiymətlər xəbərdarlıqla dəyişə bilər. [Ödənişli planlar başlayanda ödəniş şərtləri əlavə olunacaq.]"] },
      { h: "AI funksiyaları", p: ["AI nəticəsi yanlış və ya natamam ola bilər. Ona etibar etməzdən əvvəl yoxlamaq sizin məsuliyyətinizdir. AI Xəbərdarlığına baxın."] },
      { h: "Əlçatanlıq və dəyişikliklər", p: ["Xidmət olduğu kimi təqdim olunur. Funksiyaları dəyişə, dayandıra və ya ləğv edə bilərik. Məntiqli əlçatanlığı hədəfləyirik, lakin zəmanət vermirik."] },
      { h: "Məsuliyyət", p: ["Qanunun icazə verdiyi həddə dolayı zərərlərə və akademik nəticələrə görə məsuliyyət daşımırıq. [Məsuliyyət ifadəsi hüquqşünas tərəfindən yekunlaşdırılacaq.]"] },
      { h: "Xitam", p: ["İstənilən vaxt xidmətdən istifadəni dayandıra bilərsiniz. Bu şərtləri pozan hesabları dayandıra bilərik."] },
      { h: "Tətbiq olunan hüquq", p: ["Azərbaycan Respublikasının qanunvericiliyi [yurisdiksiya və mübahisə qaydası hüquqşünas tərəfindən dəqiqləşdiriləcək]."] },
    ],
  },
  "ai-disclaimer": {
    title: "AI Xəbərdarlığı",
    sections: [
      { h: "AI səhv edə bilər", p: ["Xülasələr, cavablar, quizlər və kartlar AI modeli tərəfindən yaradılır. Onlar yanlış, natamam və ya köhnəlmiş ola bilər. Vacib faktları həmişə orijinal materiallarınız və müəllimlərinizlə yoxlayın."] },
      { h: "İstinadlar", p: ["Cavab səhifəyə istinad edirsə, bu istinad sistemimizin tapdığı öz sənədinizdən bir hissəyə işarə edir. İstinad mətnin haradan gəldiyini göstərir; cavabın düzgünlüyünə zəmanət vermir. Tapılmış hissə ilə təsdiqlənməyən cavablar \"mənbəyə əsaslanmır\" kimi qeyd olunur."] },
      { h: "Peşəkar məsləhət deyil", p: ["UNIMATE tibbi, hüquqi, maliyyə və ya akademik dürüstlük məsləhəti vermir. AI nəticəsini peşəkar yönləndirmənin əvəzi kimi istifadə etməyin."] },
      { h: "Akademik dürüstlük", p: ["Təhsil müəssisənizin AI istifadəsi qaydalarına əməl edin. Yaradılmış materialdan tapşırıqlarda necə istifadə etdiyinizə görə siz məsuliyyət daşıyırsınız."] },
      { h: "Sənədləriniz göstəriş deyil, məlumatdır", p: ["Yüklənmiş sənədlərin içindəki mətn məlumat kimi qəbul edilir. Prompt injection-a qarşı tədbirlər görürük, lakin heç bir müdafiə mükəmməl deyil; gözlənilməz hər şeyi bildirin."] },
      { h: "Əlçatanlıq", p: ["AI funksiyaları üçüncü tərəf provayderlərdən asılıdır və əlçatmaz və ya məhdud ola bilər. AI konfiqurasiya olunmayanda və ya əlçatmaz olanda tətbiq uydurma nəticə göstərmək əvəzinə sizə bildirir."] },
    ],
  },
  "community-guidelines": {
    title: "İcma Qaydaları",
    sections: [
      { h: "Hörmətli olun", p: ["Digər tələbələrə hörmətlə yanaşın. Təqib, nifrət nitqi, hədə və ayrı-seçkilik olmasın."] },
      { h: "Məsuliyyətlə paylaşın", ul: [
        "Yalnız paylaşmaq hüququnuz olan materialları paylaşın.",
        "Təhsil müəssisənizin qaydalarını pozaraq əldə edilmiş imtahan sualları və ya cavabları paylaşmayın.",
        "Başqalarının şəxsi məlumatlarını paylaşmayın.",
      ] },
      { h: "Təhlükəsiz və qanuni qalın", p: ["Qanunsuz məzmun, zərərli proqram, fırıldaqçılıq və spam olmasın."] },
      { h: "Bildiriş və tətbiq", p: [`Bu qaydaları pozan məzmun görsəniz, ${CONTACT} ünvanına bildirin. Məzmunu silə və hesabları dayandıra bilərik. [İcma funksiyaları hələ tətbiqdə mövcud deyil; bu səhifə onlar başlayanda tətbiq olunacaq.]`] },
    ],
  },
  "data-retention": {
    title: "Məlumatın Saxlanması",
    sections: [
      { h: "Prinsip", p: ["Şəxsi məlumatları yalnız xidməti göstərmək və ya hüquqi öhdəlikləri yerinə yetirmək üçün lazım olan müddət saxlayırıq. Aşağıdakı müddətlər qaralamadır və dəqiqləşdirilməlidir [hüquqşünas tərəfindən yoxlanılacaq]."] },
      { h: "Müddətlər", ul: [
        "Hesab və profil: hesabınızı silənə qədər.",
        "Yüklənmiş sənədlər və törəmə məlumatlar (mətn, xülasə, söhbət, quiz, kart): sənədi və ya hesabı silənə qədər.",
        "Planlayıcı məlumatları və fokus sessiyaları: onları və ya hesabı silənə qədər.",
        "İstifadə sayğacları və AI istifadə qeydləri: [saxlama müddəti müəyyən ediləcək], plan tətbiqi və xərc nəzarəti üçün.",
        "Təhlükəsizlik və audit jurnalları: [saxlama müddəti müəyyən ediləcək].",
        "Ehtiyat nüsxələr: dövri qrafiklə silinir [müddət hostinq provayderi ilə dəqiqləşdiriləcək].",
      ] },
      { h: "Silinmə", p: [`Sənədi tətbiqdən silmək onu və törəmə məlumatları aradan qaldırır. Hesabın silinməsi hazırda əl ilə icra olunur: ${CONTACT} ünvanına yazın. Sorğuları [müddət müəyyən ediləcək] ərzində tamamlamağı hədəfləyirik.`] },
    ],
  },
};
