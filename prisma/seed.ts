import process from 'node:process';
import { PrismaClient, AdminRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 ErmayWeb (v3.0) Temiz Baseline Tohumlama Başlatılıyor...');

  // Production check: Reject seeding in production unless explicit override is provided
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    console.error('❌ HATA: Üretim (production) ortamında otomatik seed çalıştırmak güvenlik nedeniyle engellenmiştir.');
    console.error('Eğer emin iseniz ALLOW_PROD_SEED=true değişkenini vererek çalıştırınız.');
    process.exit(1);
  }

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@ermaymobilya.com').trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ErmayAdmin2026!Secure';

  if (adminPassword.length < 12) {
    console.error('❌ HATA: SEED_ADMIN_PASSWORD en az 12 karakter uzunluğunda olmalıdır!');
    process.exit(1);
  }

  // 1. Süper Admin Kullanıcısı
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      name: 'Ermay Sistem Yöneticisi',
      role: AdminRole.ADMIN,
      isActive: true,
    },
    create: {
      email: adminEmail,
      passwordHash,
      name: 'Ermay Sistem Yöneticisi',
      role: AdminRole.ADMIN,
      isActive: true,
    },
  });

  console.log(`✅ Süper Admin kullanıcısı hazır: ${adminUser.email}`);

  // 2. Temel CMS Blokları
  const defaultBlocks = [
    {
      key: 'contact',
      content: {
        phone: '0216 365 00 00',
        phoneSecondary: '0532 419 41 51',
        whatsapp: '905324194151',
        email: 'info@ermaymobilya.com',
        address: 'Modoko Mobilyacılar Sitesi 1. Cadde No: 42 Ümraniye / İstanbul',
        workingHours: 'Pazartesi - Cumartesi: 09:00 - 19:30 | Pazar: 11:00 - 18:30',
        instagram: 'https://instagram.com/ermaymobilya',
      },
    },
    {
      key: 'ticker',
      content: {
        text: 'Doğrudan İmalatçıdan Aracısız Fabrika Satışı • İstanbul İçi Kendi Aracımızla Teslimat ve Montaj • Çoklu Alımlarda Fabrika İskontosu',
        isActive: true,
      },
    },
    {
      key: 'trust_texts',
      content: {
        warrantyText: 'Tüm standart seri fabrika imalatı mobilyalarımız 2 yıl üretici ve malzeme garantisi altındadır.',
        deliveryText: 'İstanbul içi teslimat ve kurulum Ermay kendi sevkiyat ve montaj ekibi tarafından sağlanır. Tüm Türkiye’ye sigortalı nakliye mevcuttur.',
        returnText: 'Standart seri ürünlerimizde teslimat tarihinden itibaren 14 gün içinde koşulsuz iade ve değişim hakkı geçerlidir.',
        officialIban: 'TR00 0000 0000 0000 0000 0000 00 (Ermay Mobilya San. Tic. Ltd. Şti.)',
      },
    },
    {
      key: 'delivery_zones',
      content: {
        disabledCityIds: [],
        disabledCityNames: [],
        noticeMessage: '',
      },
    },
    {
      key: 'popup',
      content: {
        isActive: false,
        title: 'Fabrika Showroom & Numune Ziyareti',
        description: 'Standart seri modellerimizi ve malzeme numunelerini showroomumuzda inceleyebilir, toplu alımlar için doğrudan fabrika satış ekibimizle görüşebilirsiniz.',
      },
    },
  ];

  for (const block of defaultBlocks) {
    await prisma.cmsBlock.upsert({
      where: { key: block.key },
      update: { content: block.content },
      create: { key: block.key, content: block.content },
    });
  }

  console.log(`✅ ${defaultBlocks.length} adet temel CMS bloğu tohumlandı.`);

  // 3. Mağazalar (Showroomlar)
  const stores = [
    {
      name: 'Modoko Showroom',
      city: 'İstanbul',
      district: 'Ümraniye',
      address: 'Modoko Mobilyacılar Sitesi 1. Cadde No: 42',
      phone: '0216 365 00 00',
      email: 'modoko@ermaymobilya.com',
      hours: '09:00 - 19:30',
      mapUrl: 'https://maps.google.com/?q=Modoko+Ermay+Mobilya',
      sortOrder: 1,
      isActive: true,
    },
    {
      name: 'Fabrika Satış Mağazası',
      city: 'İstanbul',
      district: 'Sultanbeyli',
      address: 'Akşemsettin Mah. Fatih Bulvarı No: 118',
      phone: '0216 398 00 00',
      email: 'fabrika@ermaymobilya.com',
      hours: '08:30 - 18:30',
      mapUrl: 'https://maps.google.com/?q=Ermay+Mobilya+Fabrika',
      sortOrder: 2,
      isActive: true,
    },
  ];

  for (const store of stores) {
    const existing = await prisma.store.findFirst({ where: { name: store.name } });
    if (!existing) {
      await prisma.store.create({ data: store });
    }
  }

  console.log(`✅ ${stores.length} adet showroom/mağaza tohumlandı.`);

  // 4. Temel Kategoriler
  const categories = [
    { name: 'Makam Takımları', slug: 'makam-takimlari', sortOrder: 1 },
    { name: 'Üniteli Makam Takımları', slug: 'uniteli-makam-takimlari', sortOrder: 2 },
    { name: 'Koltuk Takımları', slug: 'koltuk-takimlari', sortOrder: 3 },
    { name: 'Kanepe Takımları', slug: 'kanepe-takimlari', sortOrder: 4 },
    { name: 'Toplantı Masası Modelleri', slug: 'toplanti-masasi-modelleri', sortOrder: 5 },
    { name: 'Banko Modelleri', slug: 'banko-modelleri', sortOrder: 6 },
    { name: 'Sekreter (Ekonomik) Takımlar', slug: 'sekreter-ekonomik-takimlar', sortOrder: 7 },
    { name: 'Aksesuar ve Diğer', slug: 'aksesuar-ve-diger', sortOrder: 8 },
    { name: 'Gaming', slug: 'gaming', sortOrder: 9 },
    { name: 'Genel', slug: 'genel', sortOrder: 10 },
  ];

  const categoryMap = new Map<string, string>();
  for (const cat of categories) {
    const upserted = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, sortOrder: cat.sortOrder },
      create: { name: cat.name, slug: cat.slug, sortOrder: cat.sortOrder },
    });
    categoryMap.set(cat.slug, upserted.id);
  }

  console.log(`✅ ${categories.length} adet temel kategori tohumlandı.`);

  // 5. Seçkin Ürünler ve Takım Koleksiyonları (Modüler Parçalar, Çift Görsel, Termin Rozetleri)
  const products = [
    {
      slug: 'milano-italyan-deri-makam-takimi',
      name: 'Milano İtalyan Deri Makam Takımı',
      categorySlug: 'makam-takimlari',
      price: 69900,
      originalPrice: 78000,
      stock: 4,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 240,
      depthCm: 100,
      heightCm: 75,
      drawerCount: 3,
      unitCount: 4,
      material: '1. Sınıf 30mm E1 Melamin Gövde, 2mm PVC Kenar Bandı, Deri Sümen Detayı, DKP Çelik Aksam',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Siyah', 'Antrasit', 'Taba', 'Ceviz'],
      badge: 'Fabrika Satış',
      description: 'Ermay üretim tesislerimizde standart seri olarak imal edilen Milano Makam Takımı; 1. sınıf melamin gövdesi, deri sümen detayları ve gizli kablo geçiş kanallarıyla üst düzey yönetici prestijini doğrudan fabrika fiyatıyla sunar.',
      features: [
        '1. Sınıf 30mm E1 melamin gövde ve 2mm darbe emici PVC kenar bandı',
        'Özel sümenli deri masa tablası çalışma yüzeyi',
        'Frenli tandem gizli ray çekmece sistemleri',
        'Entegre akıllı kablo ve buat geçiş kanalı'
      ],
      setPieces: [
        { title: '240cm Yönetici Masası', dimensions: '240x100x75 cm' },
        { title: 'Çekmeceli Yan Etajer', dimensions: '110x55x75 cm' },
        { title: 'Deri Detaylı Orta Sehpa', dimensions: '90x60x45 cm' },
        { title: '4 Kapaklı Dosya Dolabı', dimensions: '220x45x110 cm' }
      ],
      erpItemId: 'ERM-MKM-001',
      erpItemCode: 'MILANO-MKM',
    },
    {
      slug: 'floransa-masif-ahsap-makam-takimi',
      name: 'Floransa Yönetici Makam Takımı',
      categorySlug: 'makam-takimlari',
      price: 54900,
      originalPrice: 62000,
      stock: 3,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 220,
      depthCm: 95,
      heightCm: 75,
      drawerCount: 2,
      unitCount: 4,
      material: '1. Sınıf 30mm E1 Melamin Tabla, Ahşap Dokulu Yüzey, 2mm PVC Bant',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Ceviz', 'Antik Meşe', 'Koyu Meşe'],
      badge: 'Standart Seri',
      description: 'Doğal ceviz dokusunun dingin asaletini yansıtan Floransa Makam Takımı, fabrikamızda seri standart ölçülerde üretilmektedir. Dayanıklı melamin yüzeyi ve geniş etajeriyle uzun yıllar ilk günkü formunu korur.',
      features: [
        '1. Sınıf 30mm E1 melamin yüzey ve 2mm darbe emici PVC kenar koruması',
        'Geniş saklama hacimli yan etajer ve merkezi kilitli çekmece ünitesi',
        'CNC işlemeli ön perde tasarımı',
        '3-5 iş gününde fabrikadan doğrudan sevk veya montaj'
      ],
      setPieces: [
        { title: '220cm Ahşap Makam Masası', dimensions: '220x95x75 cm' },
        { title: 'Ahşap Etajer', dimensions: '100x50x75 cm' },
        { title: 'Kare Orta Sehpa', dimensions: '70x70x45 cm' },
        { title: 'Ahşap Makam Konsolu', dimensions: '200x45x95 cm' }
      ],
      erpItemId: 'ERM-MKM-002',
      erpItemCode: 'FLORANSA-MKM',
    },
    {
      slug: 'roma-uniteli-luks-makam-takimi',
      name: 'Roma Üniteli Yönetici Makam Takımı',
      categorySlug: 'uniteli-makam-takimlari',
      price: 82500,
      originalPrice: 92000,
      stock: 2,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 260,
      depthCm: 105,
      heightCm: 75,
      drawerCount: 4,
      unitCount: 4,
      material: '1. Sınıf 30mm E1 Melamin, Entegre LED Arka Panel, DKP Çelik Profil',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Antrasit & Ceviz', 'Siyah & Meşe'],
      badge: 'Doğrudan Üreticiden',
      description: 'Makam odasını fonksiyonel bir çalışma merkezine dönüştüren Roma Üniteli Makam Takımı; entegre LED ambiyans aydınlatmalı arka duvar paneli, gizli bölmeli dolapları ve geniş çalışma sahnesiyle doğrudan fabrika fiyatıyla sunulur.',
      features: [
        'Duvara entegre gizli LED aydınlatmalı mimari arka ünite',
        'Dokunmatik açılır gizli kasa ve dosya bölmeleri',
        'Çizilmez temperli füme cam sümen yüzeyi',
        'Akıllı priz, kablosuz şarj ve USB giriş portları'
      ],
      setPieces: [
        { title: '260cm Entegre Arka Üniteli Masa', dimensions: '260x105x75 cm' },
        { title: 'Akıllı Priz Entegreli Etajer', dimensions: '120x60x75 cm' },
        { title: 'Gizli Bölmeli Makam Dolabı', dimensions: '240x48x120 cm' },
        { title: 'Deri & Ahşap Detaylı Sehpa', dimensions: '100x65x45 cm' }
      ],
      erpItemId: 'ERM-UNT-001',
      erpItemCode: 'ROMA-UNT',
    },
    {
      slug: 'monaco-akilli-led-makam-takimi',
      name: 'Monaco LED Detaylı Makam Takımı',
      categorySlug: 'uniteli-makam-takimlari',
      price: 74000,
      originalPrice: null,
      stock: 4,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 240,
      depthCm: 100,
      heightCm: 75,
      drawerCount: 3,
      unitCount: 4,
      material: '1. Sınıf E1 Melamin, Elektrostatik Boyalı Alüminyum Çerçeve',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Beyaz & Antrasit', 'Mat Siyah & Bronz'],
      badge: 'Standart Seri',
      description: 'Minimalist çizgilere sahip Monaco Makam Takımı, estetik ve işlevselliği bir arada sunar. Gizli kablolama ve modern LED detayları ofisinize çağdaş bir kimlik kazandırır.',
      features: [
        'Alüminyum çerçeveli LED arka aydınlatma',
        'Sessiz kapanır mekanizmalı kapaklar',
        'Ergonomik çalışma yüksekliği ve geniş hareket alanı',
        'Standart seri fabrika üretimi ile hızlı sevk'
      ],
      setPieces: [
        { title: '240cm Akıllı Masa', dimensions: '240x100x75 cm' },
        { title: 'L Tipi Yan Etajer', dimensions: '110x50x75 cm' },
        { title: 'Arka Vitrin Ünitesi', dimensions: '220x42x115 cm' },
        { title: 'Orta Sehpa', dimensions: '85x55x42 cm' }
      ],
      erpItemId: 'ERM-UNT-002',
      erpItemCode: 'MONACO-UNT',
    },
    {
      slug: 'chester-hakiki-deri-ofis-koltuk-takimi',
      name: 'Chester Hakiki Deri Ofis Koltuk Takımı (3+1+1)',
      categorySlug: 'koltuk-takimlari',
      price: 46000,
      originalPrice: 51500,
      stock: 5,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 225,
      depthCm: 95,
      heightCm: 80,
      drawerCount: 0,
      unitCount: 3,
      material: 'Fırınlanmış İskelet, Silinebilir Dayanıklı Döşeme, 35 DNS HR Sünger',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Taba Deri', 'Siyah Deri', 'Bordo Deri', 'Antrasit Deri'],
      badge: 'Çok Satan',
      description: 'Kapitone dikişleri ve birinci sınıf döşemesiyle üretilen Chester Ofis Takımı, makam odalarının ve prestijli lobilerin vazgeçilmez klasiğidir. Kendi üretim hattımızdan doğrudan sevk edilir.',
      features: [
        'Tek tek elde çekilen dayanıklı kapitone dikişler',
        '35 DNS HR yüksek esnekliğe sahip çökme yapmayan sünger',
        'Sağlam güçlendirilmiş iskelet ve ahşap ayaklar',
        'Kolay temizlenebilir nefes alabilen döşeme'
      ],
      setPieces: [
        { title: "3'lü Chester Makam Kanepe", dimensions: '225x95x80 cm' },
        { title: "Tekli Chester Berjer (Sol)", dimensions: '95x90x80 cm' },
        { title: "Tekli Chester Berjer (Sağ)", dimensions: '95x90x80 cm' }
      ],
      erpItemId: 'ERM-KLT-001',
      erpItemCode: 'CHESTER-KLT',
    },
    {
      slug: 'venedik-modern-ofis-oturma-grubu',
      name: 'Venedik Modern Ofis Oturma Grubu',
      categorySlug: 'koltuk-takimlari',
      price: 38500,
      originalPrice: null,
      stock: 3,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 210,
      depthCm: 88,
      heightCm: 78,
      drawerCount: 0,
      unitCount: 3,
      material: 'Masif Ahşap Kasa, İthal Keten Dokulu Kumaş, Çelik Ayak',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Antrasit', 'Krem', 'Petrol Yeşili'],
      badge: 'Yeni Sezon',
      description: 'Sade hatları ve üstün oturum ergonomisiyle modern ofis mimarisine tam uyum sağlayan Venedik oturma grubu, leke tutmayan dokusuyla uzun ömürlü kullanım sunar.',
      features: [
        'Leke tutmaz ithal keten dokulu döşeme',
        'Mat siyah elektrostatik boyalı çelik ayaklar',
        'Ergonomik sırt ve bel desteği',
        'İkili ve tekli bağımsız modül yerleşimi'
      ],
      setPieces: [
        { title: "3'lü Modern Ofis Kanepe", dimensions: '210x88x78 cm' },
        { title: 'Tekli Ofis Koltuğu (1)', dimensions: '85x85x78 cm' },
        { title: 'Tekli Ofis Koltuğu (2)', dimensions: '85x85x78 cm' }
      ],
      erpItemId: 'ERM-KLT-002',
      erpItemCode: 'VENEDIK-KLT',
    },
    {
      slug: 'lizbon-3lu-makam-bekleme-kanepe',
      name: "Lizbon 3'lü Makam Bekleme Kanepe",
      categorySlug: 'kanepe-takimlari',
      price: 21500,
      originalPrice: 24500,
      stock: 8,
      inStock: true,
      leadTimeDays: 2,
      widthCm: 215,
      depthCm: 90,
      heightCm: 76,
      drawerCount: 0,
      unitCount: 1,
      material: 'Gürgen İskelet, Nubuk Dokulu Kumaş, Krom Ayak',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Gri', 'Taba', 'Antrasit'],
      badge: 'Hızlı Teslimat',
      description: 'Ofis bekleme alanları ve yönetici odaları için tasarlanan Lizbon 3’lü kanepe, geniş oturum derinliği ve modern estetiğiyle misafirlerinizi konforla ağırlar.',
      features: [
        'Silinebilir nubuk dokulu kumaş',
        'Güçlendirilmiş metal profil ve gürgen iskelet',
        'Zarif krom metal ayak tasarımı',
        'Stoktan hemen teslimat avantajı'
      ],
      setPieces: [],
      erpItemId: 'ERM-KNP-001',
      erpItemCode: 'LIZBON-KNP',
    },
    {
      slug: 'paris-nubuk-ofis-kanepesi',
      name: 'Paris Nubuk Ofis Kanepesi',
      categorySlug: 'kanepe-takimlari',
      price: 24800,
      originalPrice: null,
      stock: 4,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 220,
      depthCm: 92,
      heightCm: 78,
      drawerCount: 0,
      unitCount: 1,
      material: 'Masif Ahşap Ayak, Yumuşak Nubuk Kumaş, 32 DNS Sünger',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Vizon', 'Kiremit', 'Haki'],
      badge: 'Fabrika Satış',
      description: 'Zarif kıvrımlı hatları ve yumuşak dokulu nubuk kumaşıyla Paris kanepe, ofisinizde sıcak ve şık bir atmosfer yaratır.',
      features: [
        'Yüksek aşınma dirençli özel nubuk kumaş',
        'Masif meşe doğal ahşap ayaklar',
        'Çift katmanlı konfor süngeri',
        '3-5 iş gününde fabrikadan doğrudan sevk'
      ],
      setPieces: [],
      erpItemId: 'ERM-KNP-002',
      erpItemCode: 'PARIS-KNP',
    },
    {
      slug: 'bursa-masif-mese-toplanti-masasi',
      name: 'Bursa Masif Meşe 12 Kişilik Toplantı Masası',
      categorySlug: 'toplanti-masasi-modelleri',
      price: 42000,
      originalPrice: 47000,
      stock: 2,
      inStock: true,
      leadTimeDays: 4,
      widthCm: 360,
      depthCm: 120,
      heightCm: 75,
      drawerCount: 0,
      unitCount: 1,
      material: 'Masif Doğal Meşe Ağacı, Çelik Taşıyıcı Konstrüksiyon',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Doğal Meşe', 'Koyu Meşe', 'Ceviz'],
      badge: 'Geniş Toplantı',
      description: '360 cm genişliğiyle 12 kişilik toplantılara ev sahipliği yapan Bursa Toplantı Masası; doğal ahşap kenar hatları ve çift priz yuvasıyla kurumsal görüşmelerin kalbidir.',
      features: [
        'Doğal meşe ağacından yekpare görünüm',
        'Kapaklı çift yönlü alüminyum buat/priz kutusu',
        'Yüksek mukavemetli çelik omurga',
        'Çizilmeye karşı ultra dayanıklı mat koruma'
      ],
      setPieces: [],
      erpItemId: 'ERM-TPL-001',
      erpItemCode: 'BURSA-TPL',
    },
    {
      slug: 'cenevre-8-kisilik-toplanti-masasi',
      name: 'Cenevre 8 Kişilik Entegre Prizli Toplantı Masası',
      categorySlug: 'toplanti-masasi-modelleri',
      price: 29500,
      originalPrice: null,
      stock: 5,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 240,
      depthCm: 110,
      heightCm: 75,
      drawerCount: 0,
      unitCount: 1,
      material: '1. Sınıf 30mm E1 Melamin Tabla, Elektrostatik Boyalı Metal Ayak',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Antrasit', 'Beyaz', 'Ceviz'],
      badge: 'Fiyat/Performans',
      description: 'Kompakt yönetim odaları ve ekip toplantıları için ideal 240cm genişlik. Entegre kablo düzenleme kanalı ile masada dağınıklığı önler.',
      features: [
        'Gizli kablo sepeti ve kapaklı kablo çıkışı',
        '8 kişilik ferah bacak hareket alanı',
        'Leke tutmayan antibakteriyel tabla',
        'Kolay demonte ve montaj yapısı'
      ],
      setPieces: [],
      erpItemId: 'ERM-TPL-002',
      erpItemCode: 'CENEVRE-TPL',
    },
    {
      slug: 'istanbul-isikli-karsilama-bankosu',
      name: 'İstanbul Mermer Desenli Işıklı Karşılama Bankosu',
      categorySlug: 'banko-modelleri',
      price: 36500,
      originalPrice: 41000,
      stock: 3,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 220,
      depthCm: 70,
      heightCm: 110,
      drawerCount: 2,
      unitCount: 1,
      material: 'Mermer Görünümlü Akrilik Yüzey, Gizli LED Aydınlatma',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Beyaz Mermer', 'Siyah Mermer'],
      badge: 'Prestij Karşılama',
      description: 'Ofis girişinizde ilk intibayı kusursuz kılan İstanbul Banko; gizli LED taban aydınlatması ve mermer desenli lüks paneliyle kurumsal bir karşılama sağlar.',
      features: [
        'Zemin ve ön panel gizli LED ışık şeritleri',
        'Kilitli para ve evrak çekmecesi',
        'Bilgisayar ve santral için kablo geçiş yuvaları',
        'Müşteri karşılama yüksekliği ve gizli iç çalışma alanı'
      ],
      setPieces: [],
      erpItemId: 'ERM-BNK-001',
      erpItemCode: 'IST-BNK',
    },
    {
      slug: 'ankara-oval-ahsap-resepsiyon-bankosu',
      name: 'Ankara Kavisli Ahşap Dokulu Resepsiyon Bankosu',
      categorySlug: 'banko-modelleri',
      price: 44000,
      originalPrice: null,
      stock: 3,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 260,
      depthCm: 80,
      heightCm: 115,
      drawerCount: 3,
      unitCount: 1,
      material: '1. Sınıf E1 Melamin Kavisli Gövde, Metal Çıta, 2mm PVC Bant',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Doğal Meşe', 'Ceviz & Antrasit'],
      badge: 'Fabrika Satış',
      description: 'Kavisli modern hatlarıyla üretilen Ankara Resepsiyon Bankosu; klinik, danışmanlık ve kurumsal şirket girişleri için fabrikamızda standart seri olarak üretilmektedir.',
      features: [
        'Özel bükümlü kavisli gövde tasarımı',
        'Geniş ikili personel çalışma alanı',
        'Çift kilitli çekmece ve dolap',
        'Standart modüler fabrika üretimi ile hızlı teslimat'
      ],
      setPieces: [],
      erpItemId: 'ERM-BNK-002',
      erpItemCode: 'ANK-BNK',
    },
    {
      slug: 'eko-calisma-personel-takimi',
      name: 'Eko Çalışma & Personel Takımı',
      categorySlug: 'sekreter-ekonomik-takimlar',
      price: 16500,
      originalPrice: 19000,
      stock: 12,
      inStock: true,
      leadTimeDays: 2,
      widthCm: 160,
      depthCm: 80,
      heightCm: 75,
      drawerCount: 3,
      unitCount: 2,
      material: '1. Sınıf Melamin Kaplı Yonga Levha, Metal Ayak',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Beyaz', 'Antrasit', 'Meşe'],
      badge: 'Fiyat/Performans',
      description: 'Ekonomik bütçeyle kaliteli ve dayanıklı personel çalışma alanı kurmak isteyen şirketler için sağlam metal ayaklı masa ve hareketli keson seti.',
      features: [
        'Merkezi kilitli hareketli 3 çekmeceli tekerlekli keson',
        'Elektrostatik boyalı sağlam metal ayaklar',
        'Çizilmeye ve suya dayanıklı melamin yüzey',
        'Stokta hazır, hızlı montaj'
      ],
      setPieces: [
        { title: '160cm Personel Masası', dimensions: '160x80x75 cm' },
        { title: 'Tekerlekli 3 Çekmeceli Keson', dimensions: '40x45x60 cm' }
      ],
      erpItemId: 'ERM-SKR-001',
      erpItemCode: 'EKO-SKR',
    },
    {
      slug: 'titan-profesyonel-gaming-koltugu',
      name: 'Titan Profesyonel Ergonomik Ofis & Gaming Koltuğu',
      categorySlug: 'gaming',
      price: 9800,
      originalPrice: 11500,
      stock: 15,
      inStock: true,
      leadTimeDays: 2,
      widthCm: 68,
      depthCm: 65,
      heightCm: 130,
      drawerCount: 0,
      unitCount: 1,
      material: 'Nefes Alabilir PU Deri, Çelik Kasa, 4D Kolçak',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Siyah', 'Siyah & Kırmızı', 'Antrasit'],
      badge: 'Ergonomik',
      description: 'Uzun çalışma ve oyun seanslarında omurga sağlığını koruyan ergonomik bel ve boyun desteği, 180 derece geriye yatma özelliği ve 4D ayarlanabilir kolçaklar.',
      features: [
        '180 derece geriye yatış ve kilitlenebilir beşik mekanizması',
        '4D ayarlanabilir yumuşak dokulu kolçaklar',
        'Class 4 yüksek güvenlikli amortisör',
        'Manyetik hafızalı sünger boyun yastığı'
      ],
      setPieces: [],
      erpItemId: 'ERM-GAM-001',
      erpItemCode: 'TITAN-GAM',
    },
    {
      slug: 'apex-ergonomik-motorlu-oyuncu-ve-ofis-masasi',
      name: 'Apex Çift Motorlu Yükseklik Ayarlı Gaming & Ofis Masası',
      categorySlug: 'gaming',
      price: 19500,
      originalPrice: 23000,
      stock: 10,
      inStock: true,
      leadTimeDays: 2,
      widthCm: 160,
      depthCm: 80,
      heightCm: 125,
      drawerCount: 0,
      unitCount: 1,
      material: 'Karbon Fiber Desen Tabla, Çift Motorlu Ağır Hizmet Çelik Ayak',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Mat Siyah', 'Beyaz', 'Antrasit'],
      badge: 'Akıllı Masa',
      description: 'Hafızalı dijital kontrol paneli, çift sessiz motor teknolojisi ve RGB kablo yönetim kanalı ile hem üst seviye gaming hem profesyonel ergonomik ofis kullanımı için tasarlanmıştır.',
      features: [
        '4 kademeli yükseklik hafızalı dijital LED kumanda paneli',
        'Çift senkron motor ile 120 kg taşıma kapasitesi',
        'Entegre kulaklık askısı, bardaklık ve priz tepsisi',
        'Çarpışma önleyici akıllı anti-collision güvenlik sensörü'
      ],
      setPieces: [],
      erpItemId: 'ERM-GAM-002',
      erpItemCode: 'APEX-GAM',
    },
    {
      slug: 'nova-l-tipi-sekreter-ve-calisma-istasyonu',
      name: 'Nova L Tipi Akıllı Sekreter & Çalışma İstasyonu',
      categorySlug: 'sekreter-ekonomik-takimlar',
      price: 21900,
      originalPrice: 25000,
      stock: 7,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 180,
      depthCm: 140,
      heightCm: 75,
      drawerCount: 3,
      unitCount: 2,
      material: 'E1 Kalite Melamin Gövde, Elektrostatik Mat Siyah Profil Ayak',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Açık Meşe & Beyaz', 'Antrasit & Ahşap', 'Komple Antrasit'],
      badge: 'Çok Fonksiyonlu',
      description: 'Resepsiyon, asistan ve sekreter alanları için tasarlanmış geniş L tipi çalışma yüzeyi, kilitli evrak çekmeceleri ve entegre masa altı kablo düzenleme tavası.',
      features: [
        'Geniş L köşe yerleşimli ergonomik çalışma kanadı',
        '3 çekmeceli merkezi kilitli teleskopik raylı keson',
        'Yüksekliği ayarlanabilir zemin denge ayakları',
        'Kablo geçiş kapakları ve priz adaptasyon yuvaları'
      ],
      setPieces: [
        { title: '180cm Ana Çalışma Masası', dimensions: '180x80x75 cm' },
        { title: '140cm Yan Etajer ve Keson', dimensions: '140x50x72 cm' }
      ],
      erpItemId: 'ERM-SKR-002',
      erpItemCode: 'NOVA-SKR',
    },
    {
      slug: 'prism-deri-ve-ahsap-ofis-masa-seti',
      name: 'Prism Lüks Hakiki Deri & Ahşap Masaüstü Yönetici Seti (9 Parça)',
      categorySlug: 'aksesuar-ve-diger',
      price: 4850,
      originalPrice: 5600,
      stock: 20,
      inStock: true,
      leadTimeDays: 1,
      widthCm: 70,
      depthCm: 45,
      heightCm: 15,
      drawerCount: 0,
      unitCount: 9,
      material: 'İtalyan Hakiki Deri, Fırınlanmış Ceviz Masif Aksam, Pirinç Detay',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Taba & Ceviz', 'Siyah & Krom', 'Antrasit & Meşe'],
      badge: 'Tamamlayıcı Prestij',
      description: 'Makam odanıza imza dokunuş katan 9 parçalı lüks masaüstü seti: Büyük boy deri kapaklı sümen, ikili evrak rafı, kalemlik, notluk, zarf açacağı, kartvizitlik, küp bloknot ve bardak altlıkları.',
      features: [
        'Kapaklı gizli evrak hazneli sümen tablası (70x45 cm)',
        'El işçiliği dikişli İtalyan deri kaplama',
        'Masif ahşap ve pirinç detaylı tasarım bütünlüğü',
        'Özel kadife koruyucu hediye kutusunda teslimat'
      ],
      setPieces: [],
      erpItemId: 'ERM-AKS-001',
      erpItemCode: 'PRISM-AKS',
    },
    {
      slug: 'artemis-masif-ahsap-ofis-aski-ve-dilsiz-usak',
      name: 'Artemis Masif Meşe Dilsiz Uşak & Ayaklı Ceket Askısı',
      categorySlug: 'aksesuar-ve-diger',
      price: 6200,
      originalPrice: 7400,
      stock: 8,
      inStock: true,
      leadTimeDays: 3,
      widthCm: 48,
      depthCm: 38,
      heightCm: 120,
      drawerCount: 1,
      unitCount: 1,
      material: 'Masif Fırınlanmış Doğal Meşe, Pirinç Askılık, Saat/Mücevher Tepsisi',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Doğal Meşe', 'Ceviz Cila', 'Koyu Abanoz'],
      badge: 'El Yapımı',
      description: 'Yönetici odalarının vazgeçilmez zarafeti. Ceket omuz formunu koruyan ergonomik anatomik kavis, kaymaz pantolon askısı ve gizli mini çekmeceli pirinç aksesuar kasesi.',
      features: [
        'Omuz formunu bozmayan anatomik masif ceket askılığı',
        'Saat, kol düğmesi ve telefon için pirinç kaplamalı gömme tepsi',
        'Kaydırmaz silikon şeritli pantolon rayı',
        'Ağır masif döküm denge tabanı'
      ],
      setPieces: [],
      erpItemId: 'ERM-AKS-002',
      erpItemCode: 'ARTEMIS-AKS',
    },
    {
      slug: 'toplu-ofis-kurulum-teklif-paketi',
      name: 'Toplu Ofis & Şirket Kurulum Teklif Paketi (B2B)',
      categorySlug: 'genel',
      price: 0,
      originalPrice: null,
      stock: 100,
      inStock: true,
      leadTimeDays: 1,
      widthCm: 0,
      depthCm: 0,
      heightCm: 0,
      drawerCount: 0,
      unitCount: 1,
      material: 'Fabrika Seri İmalat, 1. Sınıf E1 Melamin, DKP Çelik Ayak, Toplu İskonto',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Antrasit', 'Ceviz', 'Beyaz', 'Meşe'],
      badge: 'Fabrika Toptan',
      description: '10 ve üzeri çalışma alanı veya tüm kat ofis kurulumları için doğrudan fabrikamızdan özel toplu iskonto ve kademeli sevkiyat planı. İhtiyaç listenizi iletin, fabrika satış temsilcimiz net fiyat teklifinizi aynı gün hazırlasın.',
      features: [
        'Doğrudan fabrikadan aracısız toptan kademeli iskonto',
        'İstanbul içi kendi fabrika nakliye ve montaj ekibiyle anahtar teslim kurulum',
        'Kurumsal e-arşiv / e-fatura ve resmi sözleşmeli teslimat',
        'Standart seri ürünlerde aynı gün stok ve 3-5 gün bant çıkış güvencesi'
      ],
      setPieces: [],
      erpItemId: 'ERM-B2B-001',
      erpItemCode: 'TOPLU-KURULUM',
    },
    {
      slug: 'monaco-ergonomik-yonetici-koltugu',
      name: 'Monaco Hakiki Deri Ergonomik Yönetici Koltuğu',
      categorySlug: 'genel',
      price: 18500,
      originalPrice: 22000,
      stock: 6,
      inStock: true,
      leadTimeDays: 2,
      widthCm: 70,
      depthCm: 70,
      heightCm: 128,
      drawerCount: 0,
      unitCount: 1,
      material: 'İtalyan Hakiki Deri, Polisajlı Alüminyum Döküm Yıldız Ayak, Çok Kademeli Senkron Mekanizma',
      image: '/default-furniture.webp',
      images: ['/default-furniture.webp', '/default-furniture.webp'],
      colors: ['Siyah Deri', 'Taba Deri', 'Antrasit Deri'],
      badge: 'Yönetici Koltuğu',
      description: 'Uzun çalışma saatlerinde kusursuz konfor ve prestij sunan Monaco Yönetici Koltuğu; hava kanallı ergonomik iç süngeri, 5 noktada kilitlenen İtalyan Donati senkron mekanizması ve cilalı alüminyum yıldız ayağıyla ofisinizin kalbinde yer alır.',
      features: [
        '5 farklı açıda kilitlenebilen ağırlık duyarlı senkron mekanizma',
        'Poliüretan dökme sünger ile formunu kaybetmeyen oturum',
        'Parke çizmez sessiz poliüretan tekerlekler',
        '1. Sınıf nefes alabilir İtalyan hakiki dana derisi'
      ],
      setPieces: [],
      erpItemId: 'ERM-GNL-002',
      erpItemCode: 'MONACO-GNL',
    }
  ];

  for (const p of products) {
    const categoryId = categoryMap.get(p.categorySlug);
    if (!categoryId) {
      console.warn(`Kategori bulunamadı: ${p.categorySlug}`);
      continue;
    }

    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        categoryId,
        name: p.name,
        price: p.price,
        originalPrice: p.originalPrice || null,
        stock: p.stock,
        inStock: p.inStock,
        leadTimeDays: p.leadTimeDays,
        image: p.image,
        images: p.images,
        description: p.description,
        material: p.material,
        dimensions: `${p.widthCm}x${p.depthCm}x${p.heightCm} cm`,
        widthCm: p.widthCm,
        depthCm: p.depthCm,
        heightCm: p.heightCm,
        drawerCount: p.drawerCount,
        unitCount: p.unitCount,
        badge: p.badge,
        colors: p.colors,
        setPieces: p.setPieces,
        features: p.features,
        isPublished: true,
        erpItemId: p.erpItemId,
        erpItemCode: p.erpItemCode,
      },
      create: {
        categoryId,
        name: p.name,
        slug: p.slug,
        price: p.price,
        originalPrice: p.originalPrice || null,
        stock: p.stock,
        inStock: p.inStock,
        leadTimeDays: p.leadTimeDays,
        image: p.image,
        images: p.images,
        description: p.description,
        material: p.material,
        dimensions: `${p.widthCm}x${p.depthCm}x${p.heightCm} cm`,
        widthCm: p.widthCm,
        depthCm: p.depthCm,
        heightCm: p.heightCm,
        drawerCount: p.drawerCount,
        unitCount: p.unitCount,
        badge: p.badge,
        colors: p.colors,
        setPieces: p.setPieces,
        features: p.features,
        isPublished: true,
        erpItemId: p.erpItemId,
        erpItemCode: p.erpItemCode,
      },
    });
  }

  // Eski geçersiz özel mimari proje kaydını temizle
  await prisma.product.deleteMany({
    where: { slug: 'modoko-ozel-mimari-tasarim-hizmeti' },
  });

  console.log(`✅ ${products.length} adet standart seri fabrika ofis mobilyası tohumlandı.`);
  console.log('🎉 Tohumlama başarıyla tamamlandı!');
}

main()
  .catch((e) => {
    console.error('Seed sırasında beklenmeyen hata:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
