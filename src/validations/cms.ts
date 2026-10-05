import { z, ZodTypeAny } from 'zod';
import { line, multiline, imageUrl, safeHref, hexColor, intRange, slugString } from './common';

/**
 * CMS block validation.
 *
 * Every key the admin panel writes has a schema. Unknown keys are rejected, so the CMS table cannot be used as a
 * free-form JSON store. Page layouts (page_*) are validated section by section: order, visibility and labels are
 * free, but each section type has a fixed set of fields with length limits, and links are restricted to safe schemes.
 */

const optLine = (max: number) => z.string().trim().max(max, `En fazla ${max} karakter.`).optional().default('');
const optText = (max: number) => z.string().trim().max(max, `En fazla ${max} karakter.`).optional().default('');
const optImage = z.union([imageUrl, z.literal('')]).optional().default('');
const optHref = z.union([safeHref, z.literal('')]).optional().default('');

// ── Simple blocks ────────────────────────────────────────────────────────────

const TickerItems = z.array(line(120, 1, 'Duyuru metni')).max(20, 'En fazla 20 duyuru eklenebilir.');

const TickerStyle = z.object({
  backgroundColor: hexColor,
  textColor: hexColor,
  speedSeconds: intRange(10, 120, 'Kayma süresi'),
}).strict('Bilinmeyen alan.');

const ContactInfo = z.object({
  phone: optLine(25),
  phoneSecondary: optLine(25),
  fax: optLine(25),
  email: z.union([z.string().trim().email('Geçerli bir e-posta giriniz.').max(150), z.literal('')]).optional().default(''),
  address: optText(300),
  whatsapp: z.union([z.string().trim().regex(/^\+?[0-9\s]{10,16}$/, 'WhatsApp numarası yalnız rakam içermelidir.'), z.literal('')]).optional().default(''),
  showroom: optText(300),
  workingHours: optLine(120),
  instagram: optHref,
}).strict('Bilinmeyen alan.');

const SocialLinks = z.object({
  instagram: optHref,
  facebook: optHref,
  youtube: optHref,
  linkedin: optHref,
  x: optHref,
  twitter: optHref,
  tiktok: optHref,
  pinterest: optHref,
  telegram: optHref,
  whatsapp: z.union([z.string().trim().regex(/^\+?[0-9\s]{10,16}$/, 'WhatsApp numarası yalnız rakam içermelidir.'), z.literal('')]).optional().default(''),
}).strict('Bilinmeyen alan.');

const CampaignPopup = z.object({
  enabled: z.boolean(),
  popupType: z.enum(['coupon', 'collection', 'announcement']).optional(),
  title: optLine(120),
  subtitle: optText(400),
  discountCode: z.union([z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, 'Kod yalnız harf, rakam, - ve _ içerebilir.'), z.literal('')]).optional().default(''),
  badgeText: optLine(40),
  image: optImage,
  buttonText: optLine(40),
  buttonLink: optHref,
  description: optText(400),
}).strict('Bilinmeyen alan.');

const HeroSlide = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/),
  title: line(120, 1, 'Slayt başlığı'),
  subtitle: optText(300),
  badge: optLine(60),
  image: optImage,
  buttonText: optLine(40),
  buttonLink: optHref,
});
const HeroSlides = z.array(HeroSlide).max(8, 'En fazla 8 slayt eklenebilir.');

const HomeConfig = z.object({
  heroSlides: HeroSlides.optional().default([]),
  featuredTitle: optLine(120),
  featuredSubtitle: optText(300),
  categoriesTitle: optLine(120),
  categoriesSubtitle: optText(300),
});

const LandingPageConfig = z.object({
  type: z.enum(['home', 'category', 'catalog']),
  targetSlug: z.union([slugString, z.literal('')]).optional(),
  targetTitle: optLine(120),
});

const TrustTexts = z.record(z.string().regex(/^[A-Za-z0-9_]{1,40}$/), z.string().trim().max(600)).refine(
  (v) => Object.keys(v).length <= 20,
  'En fazla 20 metin.'
);

// Legacy corporate block (kept readable until the page_corporate layout replaces it)
const LegacyCorporate = z
  .record(
    z.string().regex(/^[A-Za-z0-9_]{1,40}$/),
    z.union([
      z.string().trim().max(5000),
      z.array(z.union([z.string().trim().max(1000), z.record(z.string().regex(/^[A-Za-z0-9_]{1,40}$/), z.string().trim().max(5000))])).max(40),
    ])
  )
  .refine((v) => Object.keys(v).length <= 60, 'Çok fazla alan.');

// ── Page layouts ─────────────────────────────────────────────────────────────

const SectionId = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Geçersiz bölüm kimliği.');

const Button = z.object({
  label: line(40, 1, 'Buton yazısı'),
  href: safeHref,
  variant: z.enum(['primary', 'secondary']).default('primary'),
});
const Buttons = z.array(Button).max(2, 'Bir bölümde en fazla 2 buton olabilir.').default([]);

const Item = z.object({
  title: line(100, 1, 'Madde başlığı'),
  text: optText(600),
});

const RichBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: line(160, 1, 'Ara başlık') }),
  z.object({ type: z.literal('paragraph'), text: multiline(3000, 1, 'Paragraf') }),
  z.object({ type: z.literal('list'), items: z.array(line(400, 1, 'Liste maddesi')).min(1).max(30) }),
  z.object({ type: z.literal('quote'), text: multiline(600, 1, 'Alıntı') }),
]);

const sectionBase = {
  id: SectionId,
  hidden: z.boolean().optional().default(false),
  /** Small tag shown above the section heading (optional) */
  label: optLine(40),
  /** In-page anchor, e.g. "kvkk" for /kurumsal#kvkk */
  anchor: z.union([z.string().regex(/^[a-z0-9-]{1,40}$/, 'Bağlantı adı yalnız küçük harf, rakam ve tire içerebilir.'), z.literal('')]).optional().default(''),
  background: z.enum(['white', 'canvas', 'paper', 'ink']).optional().default('white'),
  spacing: z.enum(['compact', 'normal', 'roomy']).optional().default('normal'),
};

const section = <T extends string, P extends z.ZodRawShape>(type: T, props: P) =>
  z.object({ ...sectionBase, type: z.literal(type), props: z.object(props) });

export const SECTION_SCHEMAS = {
  // System sections: bound to live data, can be hidden/reordered but not removed
  hero: section('hero', { slides: HeroSlides.default([]) }),
  categories: section('categories', { title: optLine(120), subtitle: optText(300) }),
  curated_sets: section('curated_sets', { title: optLine(120), subtitle: optText(300) }),
  product_grid: section('product_grid', { title: optLine(120), subtitle: optText(300), limit: intRange(4, 24, 'Ürün sayısı').default(12) }),
  contact_details: section('contact_details', { title: optLine(120), text: optText(600), formTitle: optLine(120) }),
  // Free sections: can be added, duplicated and removed
  page_header: section('page_header', {
    badge: optLine(60),
    title: line(160, 1, 'Başlık'),
    highlight: optLine(160),
    text: optText(1000),
    image: optImage,
    buttons: Buttons,
  }),
  image_text: section('image_text', {
    title: optLine(160),
    body: optText(6000),
    image: optImage,
    imagePosition: z.enum(['left', 'right']).default('right'),
    statValue: optLine(20),
    statLabel: optLine(80),
    bullets: z.array(line(200, 1, 'Madde')).max(12).default([]),
    buttons: Buttons,
  }),
  feature_list: section('feature_list', {
    title: optLine(160),
    text: optText(1000),
    items: z.array(Item).max(12).default([]),
    numbered: z.boolean().default(false),
    buttons: Buttons,
  }),
  cards: section('cards', {
    title: optLine(160),
    text: optText(1000),
    items: z.array(Item).max(12).default([]),
  }),
  rich_text: section('rich_text', {
    title: optLine(200),
    blocks: z.array(RichBlock).max(80, 'Bir metin bölümünde en fazla 80 blok olabilir.').default([]),
  }),
  cta: section('cta', {
    title: line(160, 1, 'Başlık'),
    text: optText(600),
    buttons: Buttons,
  }),
} as const;

export type SectionType = keyof typeof SECTION_SCHEMAS;

const Section = z.discriminatedUnion('type', Object.values(SECTION_SCHEMAS) as unknown as [
  (typeof SECTION_SCHEMAS)[SectionType],
  ...(typeof SECTION_SCHEMAS)[SectionType][],
]);

const FREE_TYPES: SectionType[] = ['page_header', 'image_text', 'feature_list', 'cards', 'rich_text', 'cta'];

/** Which sections each page must keep (system sections) and which it may contain. */
export const PAGE_RULES: Record<string, { required: SectionType[]; allowed: SectionType[] }> = {
  page_home: { required: ['hero', 'categories', 'curated_sets', 'product_grid'], allowed: ['hero', 'categories', 'curated_sets', 'product_grid', ...FREE_TYPES] },
  page_corporate: { required: [], allowed: FREE_TYPES },
  page_contact: { required: ['contact_details'], allowed: ['contact_details', ...FREE_TYPES] },
};

const pageDoc = (key: string) =>
  z
    .object({
      version: z.literal(1).default(1),
      sections: z.array(Section).max(30, 'Bir sayfada en fazla 30 bölüm olabilir.'),
    })
    .superRefine((doc, ctx) => {
      const rules = PAGE_RULES[key];
      const ids = new Set<string>();
      doc.sections.forEach((s, i) => {
        if (ids.has(s.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bölüm kimlikleri benzersiz olmalıdır.', path: ['sections', i, 'id'] });
        ids.add(s.id);
        if (!rules.allowed.includes(s.type)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Bu sayfaya "${s.type}" bölümü eklenemez.`, path: ['sections', i, 'type'] });
        }
      });
      for (const req of rules.required) {
        const count = doc.sections.filter((s) => s.type === req).length;
        if (count !== 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${req}" bölümü sayfada bir kez bulunmalıdır (gizlenebilir, silinemez).`, path: ['sections'] });
        }
      }
      const anchors = doc.sections.map((s) => s.anchor).filter(Boolean);
      if (new Set(anchors).size !== anchors.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Bölüm bağlantı adları benzersiz olmalıdır.', path: ['sections'] });
      }
    });

// ── Registry ─────────────────────────────────────────────────────────────────

/** Canonical CMS keys and their content schemas. Aliases map to the same schema. */
export const CMS_SCHEMAS: Record<string, ZodTypeAny> = {
  ticker: TickerItems,
  ticker_items: TickerItems,
  ticker_style: TickerStyle,
  contact: ContactInfo,
  contact_info: ContactInfo,
  social_links: SocialLinks,
  popup: CampaignPopup,
  campaign_popup: CampaignPopup,
  home_hero: HeroSlides,
  home_config: HomeConfig,
  landing_page_config: LandingPageConfig,
  trust_texts: TrustTexts,
  corporate_config: LegacyCorporate,
  page_home: pageDoc('page_home'),
  page_corporate: pageDoc('page_corporate'),
  page_contact: pageDoc('page_contact'),
};

export const CmsKeyParamSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,63}$/, 'Geçersiz CMS anahtarı.')
    .refine((k) => k in CMS_SCHEMAS, 'Bilinmeyen CMS anahtarı.'),
});

export const CmsReadKeyParamSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'Geçersiz CMS anahtarı.'),
});

/** Max serialized size of one CMS block (bytes). Page layouts with long legal texts stay well below this. */
export const CMS_MAX_BYTES = 256 * 1024;
