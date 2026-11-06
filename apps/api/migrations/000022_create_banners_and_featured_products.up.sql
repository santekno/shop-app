-- The mobile home screen (Bab 14): a banner carousel and a "featured
-- products" row. Both are read by the public storefront API.

-- A product the shop wants on the home screen. Flipped by SQL or the seed
-- for now; there is no admin screen for it yet (a gap listed in
-- docs/erd.md). The constant default fills every existing product with
-- false without rewriting the table.
ALTER TABLE products ADD COLUMN is_featured boolean NOT NULL DEFAULT false;

-- GET /v1/products?featured=true with the default sort (newest). Partial
-- on exactly the filter, like the other storefront indexes, so it holds
-- only the handful of featured products. The price sorts read the same
-- few rows and sort them, which is cheaper than a second index.
CREATE INDEX products_active_featured_newest_idx
    ON products (created_at DESC, id DESC) WHERE status = 'active' AND is_featured;

-- The home screen's banner carousel. Banners are managed by seed or SQL
-- for now: no image upload, no admin CRUD (a documented gap). A banner is
-- a coloured card with text; tapping it opens a category in the app.
CREATE TABLE banners (
    id                 uuid        PRIMARY KEY,
    title              text        NOT NULL,
    subtitle           text,
    cta_label          text,
    -- The category the app opens when the banner is tapped. Not a foreign
    -- key: a banner may be written before its category, and an unknown slug
    -- only makes the app show an empty category, which is the app's concern.
    link_category_slug text,
    background_color   text        NOT NULL,
    -- The carousel's order, 0 first.
    position           integer     NOT NULL,
    is_active          boolean     NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT banners_title_check CHECK (title <> '' AND char_length(title) <= 100),
    CONSTRAINT banners_subtitle_check CHECK (subtitle IS NULL OR char_length(subtitle) <= 200),
    CONSTRAINT banners_cta_label_check CHECK (cta_label IS NULL OR (cta_label <> '' AND char_length(cta_label) <= 40)),
    -- The same slug rule as categories, so a link can only name a slug.
    CONSTRAINT banners_link_category_slug_check CHECK (
        link_category_slug IS NULL
        OR (link_category_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(link_category_slug) <= 100)),
    -- #RRGGBB, which the app passes to a style as it is.
    CONSTRAINT banners_background_color_check CHECK (background_color ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT banners_position_check CHECK (position >= 0)
);

-- GET /v1/banners: the active banners in carousel order. Partial, because
-- inactive banners are never listed; id breaks ties between equal
-- positions so the order is stable.
CREATE INDEX banners_active_position_idx ON banners (position, id) WHERE is_active;
