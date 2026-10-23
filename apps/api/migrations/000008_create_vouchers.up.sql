-- Vouchers (ADR 0006): a percent or fixed discount on the goods, with a
-- minimum spend, an optional cap, a validity window, an optional total
-- usage limit and a per-user limit. Created by make seed until the admin
-- dashboard (Bab 12).

CREATE TABLE vouchers (
    id             uuid        PRIMARY KEY,
    -- What the buyer types; the API upper-cases it before looking it up.
    code           text        NOT NULL,
    kind           text        NOT NULL,
    -- Percent (1-100) for kind percent, whole rupiah for kind fixed.
    value          bigint      NOT NULL,
    min_spend      bigint      NOT NULL DEFAULT 0,
    -- The most a percent voucher takes off, in rupiah; NULL = no cap.
    max_discount   bigint,
    starts_at      timestamptz NOT NULL,
    ends_at        timestamptz NOT NULL,
    -- Total uses across all buyers; NULL = unlimited. used_count is only
    -- ever changed by a guarded UPDATE (UseVoucher, ReleaseVoucher).
    usage_limit    integer,
    used_count     integer     NOT NULL DEFAULT 0,
    per_user_limit integer     NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT vouchers_code_key UNIQUE (code),
    CONSTRAINT vouchers_code_check CHECK (code ~ '^[A-Z0-9]{3,32}$'),
    CONSTRAINT vouchers_kind_check CHECK (kind IN ('percent', 'fixed')),
    CONSTRAINT vouchers_value_check CHECK (value > 0 AND (kind <> 'percent' OR value <= 100)),
    CONSTRAINT vouchers_min_spend_check CHECK (min_spend >= 0),
    CONSTRAINT vouchers_max_discount_check CHECK (max_discount IS NULL OR max_discount > 0),
    CONSTRAINT vouchers_window_check CHECK (ends_at > starts_at),
    CONSTRAINT vouchers_usage_limit_check CHECK (usage_limit IS NULL OR usage_limit > 0),
    -- The counter never passes its limit, even if the guard in UseVoucher
    -- had a bug: the last line of defence, like product_variants' stock.
    CONSTRAINT vouchers_used_count_check
        CHECK (used_count >= 0 AND (usage_limit IS NULL OR used_count <= usage_limit)),
    CONSTRAINT vouchers_per_user_limit_check CHECK (per_user_limit > 0)
);
