import type { LegalDoc, LegalSlug } from "./types";

// HUKUKİ İNCELEME İÇİN TASLAK. Çeviri anadili Türkçe olan bir hukukçu tarafından yapılmamıştır ve onaylanmamıştır.
// DRAFT FOR LEGAL REVIEW + native-speaker review: not approved by counsel. Keep in sync with en.ts (same sections and placeholders).
const CONTACT = "[iletişim e-postası yayımlanmadan önce eklenecek]";

export const legalTr: Record<LegalSlug, LegalDoc> = {
  privacy: {
    title: "Gizlilik Politikası",
    sections: [
      { h: "Biz kimiz", p: [`UNIMATE ("biz"), Azerbaycan'daki üniversite öğrencileri için bir çalışma platformu sunar. İşletici kimliği ve tescilli adres: [tamamlanacak]. Gizlilik iletişimi: ${CONTACT}.`] },
      { h: "Ne topluyoruz", ul: [
        "Hesap verileri: e-posta adresi, görünen ad, parola (kimlik doğrulama sağlayıcımız tarafından yalnızca özet değeri olarak saklanır).",
        "Bize vermeyi seçtiğiniz profil verileri: üniversite, bölüm, sınıf, arayüz dili.",
        "Çalışma içeriği: yüklediğiniz belgeler, bunlardan çıkarılan metin, özetler, sohbet iletileri, testler, bilgi kartları ve test denemeleriniz.",
        "Planlayıcı verileri: ders programı kayıtları, görevler, sınavlar ve odak oturumları.",
        "Kullanım verileri: yapay zekâ iletisi ve yükleme sayaçları (plan sınırlarını uygulamak için) ile hizmeti işletmek ve korumak için gereken teknik kayıtlar.",
        "Cihazınızda: tema ve dil seçiminiz (çerezler), başlangıç hedefleriniz ve çevrimdışı kullanım için kaydedilmiş ders programı kopyanız (tarayıcı depolama alanı).",
      ] },
      { h: "Neden kullanıyoruz", ul: [
        "İstediğiniz özellikleri sunmak için (depolama, belgeleriniz hakkında yanıtlar, hatırlatmalar, planlama).",
        "Plan sınırlarını uygulamak, kötüye kullanımı önlemek ve hizmeti güvende tutmak için.",
        "Yasal yükümlülükleri yerine getirmek için.",
      ] },
      { h: "Yapay zekâ ile işleme", p: ["Bir soru sorduğunuzda ya da özet, test veya bilgi kartı istediğinizde, sonucu üretmek için belgenizin ilgili bölümleri bir yapay zekâ modeli sağlayıcısına [sağlayıcı ve işleme yeri doğrulanacak] gönderilir. Belgelerinizi modelleri eğitmek için kullanmayız [sağlayıcı koşullarına göre doğrulanacak]. Bkz. Yapay Zekâ Sorumluluk Reddi."] },
      { h: "Paylaşım", p: ["Altyapı sağlayıcılarını (veritabanı, dosya depolama, kimlik doğrulama, barındırma, yapay zekâ) sözleşme kapsamında veri işleyen olarak kullanırız. Kişisel verileri satmayız. Gelecekte bir özellik paylaşmanıza açıkça izin vermedikçe belgeleriniz yalnızca hesabınıza özeldir."] },
      { h: "Saklama", p: ["Veri Saklama sayfasına bakın. Kısaca: içerik, siz silene veya hesabınız kaldırılana kadar saklanır."] },
      { h: "Haklarınız", p: [`Verilerinize erişim, düzeltme, dışa aktarma veya silme talebinde bulunabilirsiniz. Okuyabildiğiniz verilerin dışa aktarımını Ayarlar'dan indirebilirsiniz. Hesap silme şu anda elle yürütülmektedir: ${CONTACT} adresine yazın. Uygulanacak hukuk, Azerbaycan Cumhuriyeti'nin kişisel verilere ilişkin mevzuatıdır [hukuki dayanak ve atıflar hukuk danışmanı tarafından tamamlanacak].`] },
      { h: "Çocuklar", p: ["Hizmet, 16 yaş ve üzerindeki kullanıcılar için tasarlanmıştır [yaş sınırı doğrulanacak]."] },
      { h: "Değişiklikler", p: ["Güncellemeleri bu sayfada yayımlarız; önemli değişiklikleri ayrıca uygulama içinde duyururuz."] },
    ],
  },
  terms: {
    title: "Kullanım Koşulları",
    sections: [
      { h: "UNIMATE'i kullanma", p: ["Hesap oluşturarak bu koşulları kabul etmiş olursunuz. Doğru bilgi vermeli ve giriş bilgilerinizi güvende tutmalısınız. Hesabınız altındaki etkinliklerden siz sorumlusunuz."] },
      { h: "İçeriğiniz", p: ["Yüklediklerinizin mülkiyeti sizde kalır. Hizmeti işletebilmemiz için bunları saklama, işleme ve size gösterme konusunda bize sınırlı bir lisans verirsiniz. Yalnızca kullanma hakkınız olan materyalleri yükleyin. Telif hakkını ihlal eden, kötü amaçlı yazılım içeren veya başkalarının gizliliğini ihlal eden içerik yüklemeyin."] },
      { h: "Kabul edilebilir kullanım", ul: [
        "Hizmeti bozmaya, taramaya veya aşırı yüklemeye ya da plan sınırlarını aşmaya çalışmayın.",
        "Hizmeti taciz, kurumunuzun kurallarını ihlal eden kopya veya yasa dışı faaliyetler için kullanmayın.",
        "Topluluk Kurallarına uyun.",
      ] },
      { h: "Planlar ve sınırlar", p: ["Ücretsiz ve ücretli planların yapay zekâ iletileri, belgeler ve sayfalar için sınırları vardır. Sınırlar ve fiyatlar önceden bildirilerek değişebilir. [Ödeme koşulları ücretli planlar başladığında eklenecek.]"] },
      { h: "Yapay zekâ özellikleri", p: ["Yapay zekâ çıktısı yanlış veya eksik olabilir. Güvenmeden önce kontrol etmekten siz sorumlusunuz. Bkz. Yapay Zekâ Sorumluluk Reddi."] },
      { h: "Erişilebilirlik ve değişiklikler", p: ["Hizmet olduğu gibi sunulur. Özellikleri değiştirebilir, askıya alabilir veya sonlandırabiliriz. Makul bir erişilebilirlik hedefleriz ancak garanti etmeyiz."] },
      { h: "Sorumluluk", p: ["Yasaların izin verdiği ölçüde, dolaylı zararlardan ve akademik sonuçlardan sorumlu değiliz. [Sorumluluk ifadesi hukuk danışmanı tarafından kesinleştirilecek.]"] },
      { h: "Sona erdirme", p: ["Hizmeti istediğiniz zaman kullanmayı bırakabilirsiniz. Bu koşulları ihlal eden hesapları askıya alabiliriz."] },
      { h: "Uygulanacak hukuk", p: ["Azerbaycan Cumhuriyeti hukuku [yetki ve uyuşmazlık çözüm süreci hukuk danışmanı tarafından doğrulanacak]."] },
    ],
  },
  "ai-disclaimer": {
    title: "Yapay Zekâ Sorumluluk Reddi",
    sections: [
      { h: "Yapay zekâ hata yapabilir", p: ["Özetler, yanıtlar, testler ve bilgi kartları bir yapay zekâ modeli tarafından üretilir. Yanlış, eksik veya güncelliğini yitirmiş olabilirler. Önemli bilgileri her zaman özgün materyallerinizle ve öğretim üyelerinizle karşılaştırın."] },
      { h: "Kaynak gösterimleri", p: ["Bir yanıt bir sayfaya atıf yapıyorsa, bu atıf sistemimizin bulduğu, kendi belgenizdeki bir bölümü gösterir. Atıf, metnin nereden geldiğini gösterir; yanıtın doğru olduğunu garanti etmez. Bulunan bir bölümle desteklenmeyen yanıtlar \"kaynağa dayanmıyor\" olarak etiketlenir."] },
      { h: "Profesyonel tavsiye değildir", p: ["UNIMATE tıbbi, hukuki, mali veya akademik dürüstlük tavsiyesi vermez. Yapay zekâ çıktısını profesyonel danışmanlığın yerine kullanmayın."] },
      { h: "Akademik dürüstlük", p: ["Kurumunuzun yapay zekâ kullanımına ilişkin kurallarına uyun. Üretilen materyali ödevlerinizde nasıl kullandığınızdan siz sorumlusunuz."] },
      { h: "Belgeleriniz veridir, talimat değil", p: ["Yüklenen belgelerin içindeki metin yalnızca veri olarak ele alınır. İstem enjeksiyonuna karşı önlemler alırız, ancak hiçbir savunma kusursuz değildir; beklenmeyen bir durumu bildirin."] },
      { h: "Erişilebilirlik", p: ["Yapay zekâ özellikleri üçüncü taraf sağlayıcılara bağlıdır ve kullanılamayabilir ya da sınırlı olabilir. Yapay zekâ yapılandırılmadığında veya kullanılamadığında uygulama uydurma bir çıktı göstermek yerine size bunu söyler."] },
    ],
  },
  "community-guidelines": {
    title: "Topluluk Kuralları",
    sections: [
      { h: "Saygılı olun", p: ["Diğer öğrencilere saygıyla davranın. Taciz, nefret söylemi, tehdit ve ayrımcılık yasaktır."] },
      { h: "Sorumlulukla paylaşın", ul: [
        "Yalnızca paylaşma hakkınız olan materyalleri paylaşın.",
        "Kurumunuzun kurallarına aykırı yollarla edinilmiş sınav kâğıtlarını veya yanıtlarını paylaşmayın.",
        "Başkalarının kişisel bilgilerini paylaşmayın.",
      ] },
      { h: "Güvenli ve yasal kalın", p: ["Yasa dışı içerik, kötü amaçlı yazılım, dolandırıcılık ve istenmeyen ileti yasaktır."] },
      { h: "Bildirim ve yaptırım", p: [`Bu kurallara aykırı bir içerik görürseniz ${CONTACT} adresine bildirin. İçeriği kaldırabilir ve hesapları askıya alabiliriz. [Topluluk özellikleri henüz uygulamada yok; bu sayfa onlar başladığında geçerli olacaktır.]`] },
    ],
  },
  "data-retention": {
    title: "Veri Saklama",
    sections: [
      { h: "İlke", p: ["Kişisel verileri yalnızca hizmeti sunmak veya yasal yükümlülükleri yerine getirmek için gerektiği sürece saklarız. Aşağıdaki süreler taslaktır ve doğrulanmalıdır [hukuk danışmanı tarafından incelenecek]."] },
      { h: "Süreler", ul: [
        "Hesap ve profil: hesabınızı silene kadar.",
        "Yüklenen belgeler ve türetilen veriler (metin, özetler, sohbet, testler, bilgi kartları): belgeyi veya hesabınızı silene kadar.",
        "Planlayıcı verileri ve odak oturumları: siz silene veya hesabınız silinene kadar.",
        "Kullanım sayaçları ve yapay zekâ kullanım kayıtları: [saklama süresi belirlenecek]; plan uygulaması ve maliyet kontrolü için.",
        "Güvenlik ve denetim kayıtları: [saklama süresi belirlenecek].",
        "Yedekler: dönüşümlü bir takvimle silinir [süre barındırma sağlayıcısıyla doğrulanacak].",
      ] },
      { h: "Silme", p: [`Uygulamadan bir belgeyi silmek, belgeyi ve ondan türetilen verileri kaldırır. Hesap silme şu anda elle yürütülmektedir: ${CONTACT} adresine yazın. Talepleri [süre belirlenecek] içinde tamamlamayı hedefleriz.`] },
    ],
  },
};
