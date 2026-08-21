import { PrismaClient, Role, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 ErmayWeb Veritabanı Seed İşlemi Başlatılıyor...');

  // 1. Temizleme
  await prisma.coupon.deleteMany();
  await prisma.cmsBlock.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.userCard.deleteMany();
  await prisma.userAddress.deleteMany();
  await prisma.store.deleteMany();
  await prisma.user.deleteMany();

  // 2. Kullanıcılar
  const adminPasswordHash = await bcrypt.hash('AdminPassword123!', 10);
  const customerPasswordHash = await bcrypt.hash('CustomerPassword123!', 10);

  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@ermaymobilya.com',
      password: adminPasswordHash,
      name: 'Ermay Sistem Yöneticisi',
      phone: '+90 532 000 00 00',
      role: Role.ADMIN,
      addresses: {
        create: {
          title: 'Merkez Atölye & Mağaza',
          fullName: 'Ermay Mobilya Sanayi',
          phone: '+90 532 000 00 00',
          city: 'İstanbul',
          district: 'Ümraniye',
          addressLine: 'Modoko Mobilyacılar Sitesi 1. Cadde No: 42',
          zipCode: '34775',
        },
      },
    },
  });

  const customerUser = await prisma.user.create({
    data: {
      email: 'musteri@example.com',
      password: customerPasswordHash,
      name: 'Ahmet Yılmaz',
      phone: '+90 532 123 45 67',
      role: Role.CUSTOMER,
      addresses: {
        create: {
          title: 'Ev Adresim',
          fullName: 'Ahmet Yılmaz',
          phone: '+90 532 123 45 67',
          city: 'İstanbul',
          district: 'Kadıköy',
          addressLine: 'Bagdat Caddesi Palmiye Apt. No: 114 D: 6',
          zipCode: '34728',
        },
      },
    },
  });

  console.log(`✅ Kullanıcılar eklendi: Admin (${adminUser.email}), Müşteri (${customerUser.email})`);

  // 3. Kategoriler
  const livingRoom = await prisma.category.create({
    data: {
      name: 'Oturma Odası',
      slug: 'oturma-odasi',
      description: 'Lüks ve konforlu İtalyan tarzı koltuk takımları, berjerler ve sehpa koleksiyonları.',
      image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&q=80&w=1000',
    },
  });

  const diningRoom = await prisma.category.create({
    data: {
      name: 'Yemek Odası',
      slug: 'yemek-odasi',
      description: '%100 fırınlanmış masif ahşap ve ceviz kaplama yemek masaları ile sandalyeler.',
      image: 'https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?auto=format&fit=crop&q=80&w=1000',
    },
  });

  const bedRoom = await prisma.category.create({
    data: {
      name: 'Yatak Odası',
      slug: 'yatak-odasi',
      description: 'Zamansız şıklık ve huzur veren ergonomik yatak odası takımları.',
      image: 'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&q=80&w=1000',
    },
  });

  console.log('✅ Kategoriler eklendi.');

  // 4. Ürünler ve Varyantlar
  const sofaProductData: Record<string, unknown> = {
    categoryId: livingRoom.id,
    name: 'Milano İtalyan Deri Köşe Koltuk Takımı',
    slug: 'milano-italyan-deri-kose-koltuk',
    description: '%100 İtalyan hakiki deri kaplama, fırınlanmış gürgen iskelet ve kaz tüyü dolgulu lüks salon köşe takımı.',
    material: 'Hakiki İtalyan Deri & Masif Gürgen',
    dimensions: '320cm x 240cm x 85cm',
    price: 48500,
    originalPrice: 56000,
    stock: 15,
    inStock: true,
    salesCount: 38,
    vatRate: 0.20,
    image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&q=80&w=1000',
    features: [
      '%100 İtalyan Hakiki Deri',
      'Fırınlanmış Gürgen Ağacı İskelet',
      '35 DNS HR Yüksek Dansite Sünger',
      'Kaz Tüyü Destekli Kırlentler',
    ],
    variants: {
      create: [
        {
          sku: 'MILANO-COGNAC-01',
          color: 'Taba Deri',
          finish: 'Mat Hakiki Deri',
          stock: 8,
          price: 48500,
          b2bPrice: 42000,
        },
        {
          sku: 'MILANO-BLACK-02',
          color: 'Derin Siyah Deri',
          finish: 'Parlak Deri',
          stock: 7,
          price: 49500,
          b2bPrice: 43000,
        },
      ],
    },
  };

  const sofaProduct = await prisma.product.create({
    data: sofaProductData as Prisma.ProductCreateInput,
  });

  const diningTableData: Record<string, unknown> = {
    categoryId: diningRoom.id,
    name: 'Verona Masif Ahşap Yemek Masası',
    slug: 'verona-masif-ahsap-yemek-masasi',
    description: 'Doğal ceviz kaplama masif ayaklı 8 kişilik açılabilir yemek masası.',
    material: '%100 Doğal Ceviz Kaplama & Masif Ayaklar',
    dimensions: '200cm (Açılınca 240cm) x 100cm',
    price: 32000,
    originalPrice: 38000,
    stock: 10,
    inStock: true,
    salesCount: 24,
    vatRate: 0.20,
    image: 'https://images.unsplash.com/photo-1615066390971-03e4e1c36ddf?auto=format&fit=crop&q=80&w=1000',
    features: [
      '8-10 Kişilik Uzayabilen Mekanizma',
      'Fırınlanmış Ceviz Masif Ayaklar',
      'Çizilmeye Dayanıklı İpek Mat Vernik',
    ],
    variants: {
      create: [
        {
          sku: 'VERONA-WALNUT-01',
          color: 'Doğal Ceviz',
          stock: 10,
          price: 32000,
          b2bPrice: 28000,
        },
      ],
    },
  };

  const diningTable = await prisma.product.create({
    data: diningTableData as Prisma.ProductCreateInput,
  });

  console.log(`✅ Ürünler eklendi: ${sofaProduct.name}, ${diningTable.name}`);

  // 5. CMS Blokları Seeding
  await prisma.cmsBlock.createMany({
    data: [
      {
        key: 'home_hero',
        content: {
          title: 'Zamansız Tasarım & Lüks Konfor',
          subtitle: 'Ermay Mobilya ile yaşam alanlarınıza İtalyan zarafeti ve doğal ahşap dokunuşları katın.',
          buttonText: 'Koleksiyonu Keşfet',
          buttonLink: '/kategori/oturma-odasi',
          backgroundImage: 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&q=80&w=1600',
        },
      },
      {
        key: 'ticker_items',
        content: [
          '🚚 Tüm Türkiye’ye Sigortalı Ücretsiz Teslimat',
          '🛋️ %100 Hakiki Deri & İtalyan Kumaş Garantisi',
          '🔨 5 Yıl İskelet ve Döşeme Garantisi',
          '💳 12 Aya Varan Taksit İmkanı',
        ],
      },
      {
        key: 'campaign_popup',
        content: {
          enabled: true,
          title: 'Yeni Sezon Hoş Geldin İndirimi!',
          description: 'Ermay Mobilya yeni sezon koleksiyonlarında sepette ekstra %10 indirim fırsatını kaçırmayın.',
          discountCode: 'ERMAY10',
          image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&q=80&w=600',
        },
      },
      {
        key: 'corporate_config',
        content: {
          aboutTitle: '40 Yıllık Zarafet ve Ahşap Ustalığı',
          aboutText: 'Ermay Mobilya olarak, 1986 yılından bu yana Modoko merkezli atölyelerimizde masif gürgen ve İtalyan deri ustalığını çağdaş tasarımlarla buluşturuyoruz.',
          storesCount: '8 Mağaza',
          exportCountries: '14 Ülkeye İhracat',
        },
      },
      {
        key: 'contact_info',
        content: {
          phone: '+90 532 000 00 00',
          email: 'info@ermaymobilya.com',
          address: 'Modoko Mobilyacılar Sitesi 1. Cadde No: 42, Ümraniye / İstanbul',
          workingHours: 'Pazartesi - Cumartesi: 09:00 - 19:00',
        },
      },
    ],
  });

  console.log('✅ CMS Blokları eklendi.');

  // 6. Kuponlar Seeding
  await prisma.coupon.createMany({
    data: [
      {
        code: 'ERMAY10',
        discount: 10,
        discountType: 'percentage',
        minAmount: 1000,
        isActive: true,
      },
      {
        code: 'YENIEV15',
        discount: 15,
        discountType: 'percentage',
        minAmount: 15000,
        isActive: true,
      },
    ],
  });

  console.log('✅ İndirim kuponları eklendi.');
  console.log('🎉 Veritabanı Seed İşlemi Başarıyla Tamamlandı!');
}

main()
  .catch((e: unknown) => {
    console.error('Seed Hatası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
