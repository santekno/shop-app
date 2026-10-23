-- Orders and their lines (docs/erd.md, ADR 0006). An order copies what it
-- sells and where it ships, so later catalog or address edits never change
-- it. Money is whole rupiah; the CHECKs make every row add up and every
-- status carry the fields it needs.

CREATE TABLE orders (
    id                   uuid        PRIMARY KEY,
    -- The order number buyers see, e.g. GS-20261101-7KQ2M9.
    code                 text        NOT NULL,
    user_id              uuid        NOT NULL,
    status               text        NOT NULL,
    cancel_reason        text,
    subtotal             bigint      NOT NULL,
    discount             bigint      NOT NULL DEFAULT 0,
    shipping_fee         bigint      NOT NULL,
    total                bigint      NOT NULL,
    total_weight_grams   integer     NOT NULL,
    voucher_id           uuid,
    voucher_code         text,
    courier              text        NOT NULL,
    courier_service      text        NOT NULL,
    tracking_number      text,
    -- A copy of the address at checkout.
    shipping_recipient   text        NOT NULL,
    shipping_phone       text        NOT NULL,
    shipping_street      text        NOT NULL,
    shipping_city        text        NOT NULL,
    shipping_province    text        NOT NULL,
    shipping_postal_code text        NOT NULL,
    payment_expires_at   timestamptz NOT NULL,
    paid_at              timestamptz,
    shipped_at           timestamptz,
    completed_at         timestamptz,
    cancelled_at         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT orders_code_key UNIQUE (code),
    CONSTRAINT orders_code_check CHECK (code ~ '^GS-[0-9]{8}-[0-9A-Z]{6}$'),
    -- An order keeps its buyer: users are anonymised, never deleted.
    CONSTRAINT orders_user_fkey FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT orders_voucher_fkey FOREIGN KEY (voucher_id)
        REFERENCES vouchers (id) ON DELETE RESTRICT,
    CONSTRAINT orders_status_check
        CHECK (status IN ('pending_payment', 'paid', 'processing', 'shipped', 'completed', 'cancelled')),
    CONSTRAINT orders_cancel_reason_check
        CHECK (cancel_reason IN ('payment_expired', 'buyer_cancelled', 'seller_cancelled')),
    CONSTRAINT orders_courier_check CHECK (courier IN ('jne', 'jnt', 'sicepat')),
    -- The amount charged always adds up, and a discount never makes the
    -- goods cost less than nothing.
    CONSTRAINT orders_amounts_check CHECK (
        subtotal >= 0 AND shipping_fee >= 0 AND discount >= 0 AND discount <= subtotal
        AND total = subtotal - discount + shipping_fee),
    CONSTRAINT orders_weight_check CHECK (total_weight_grams > 0),
    -- A discount always names its voucher.
    CONSTRAINT orders_voucher_check
        CHECK ((voucher_id IS NULL) = (voucher_code IS NULL) AND (voucher_id IS NOT NULL OR discount = 0)),
    -- A cancelled order says when and why; no other status can.
    CONSTRAINT orders_cancel_reason_status_check CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL)),
    CONSTRAINT orders_cancelled_at_check CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
    -- A shipped order has an airway bill and a ship time.
    CONSTRAINT orders_shipped_check
        CHECK (status NOT IN ('shipped', 'completed') OR (tracking_number IS NOT NULL AND shipped_at IS NOT NULL)),
    CONSTRAINT orders_completed_check CHECK (status <> 'completed' OR completed_at IS NOT NULL),
    CONSTRAINT orders_paid_check
        CHECK (status NOT IN ('paid', 'processing', 'shipped', 'completed') OR paid_at IS NOT NULL)
);

CREATE TABLE order_items (
    id           uuid        PRIMARY KEY,
    order_id     uuid        NOT NULL,
    variant_id   uuid        NOT NULL,
    -- Snapshots at checkout.
    product_name text        NOT NULL,
    variant_name text        NOT NULL,
    sku          text        NOT NULL,
    unit_price   bigint      NOT NULL,
    quantity     integer     NOT NULL,
    line_total   bigint      NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT order_items_order_fkey FOREIGN KEY (order_id)
        REFERENCES orders (id) ON DELETE CASCADE,
    -- The sales history of a variant must survive.
    CONSTRAINT order_items_variant_fkey FOREIGN KEY (variant_id)
        REFERENCES product_variants (id) ON DELETE RESTRICT,
    -- One line per variant; it also serves reading an order's items and
    -- the CASCADE, so order_id needs no index of its own.
    CONSTRAINT order_items_order_variant_key UNIQUE (order_id, variant_id),
    CONSTRAINT order_items_unit_price_check CHECK (unit_price > 0),
    CONSTRAINT order_items_quantity_check CHECK (quantity > 0),
    CONSTRAINT order_items_line_total_check CHECK (line_total = unit_price * quantity)
);

-- A buyer's order history (cursor on created_at, id).
CREATE INDEX orders_user_created_idx ON orders (user_id, created_at DESC, id DESC);

-- Counting a buyer's unpaid orders at checkout (at most 5), and finding
-- them when the account is deleted. Partial, so it holds only the unpaid
-- orders, however many a buyer has placed.
CREATE INDEX orders_user_pending_idx ON orders (user_id) WHERE status = 'pending_payment';

-- The admin's order queue per status, newest first.
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC, id DESC);

-- The job that cancels unpaid orders past their deadline.
CREATE INDEX orders_payment_expires_idx ON orders (payment_expires_at)
    WHERE status = 'pending_payment';

-- A buyer's uses of a voucher (the per-user limit), and the RESTRICT on
-- vouchers.
CREATE INDEX orders_voucher_user_idx ON orders (voucher_id, user_id)
    WHERE voucher_id IS NOT NULL;

-- Sales per variant, the RESTRICT on variants, and the stock restore.
CREATE INDEX order_items_variant_id_idx ON order_items (variant_id);
