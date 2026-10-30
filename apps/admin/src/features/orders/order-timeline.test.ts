import { describe, expect, it } from "vitest";
import { order } from "@/test/fixtures.ts";
import { timelineSteps } from "./order-timeline.ts";

const at = {
  created_at: "2026-10-30T03:00:00Z",
  paid_at: "2026-10-30T03:10:00Z",
  shipped_at: "2026-10-31T08:00:00Z",
  completed_at: "2026-11-02T10:00:00Z",
  cancelled_at: "2026-10-30T05:00:00Z",
};

describe("timelineSteps", () => {
  it("shows a paid order's whole life cycle, the step it is on current", () => {
    expect(
      timelineSteps(
        order({ status: "paid", ...at, shipped_at: null, completed_at: null }),
      ),
    ).toEqual([
      {
        key: "pending_payment",
        label: "Dipesan",
        at: at.created_at,
        state: "done",
      },
      { key: "paid", label: "Dibayar", at: at.paid_at, state: "current" },
      { key: "processing", label: "Diproses", at: null, state: "upcoming" },
      { key: "shipped", label: "Dikirim", at: null, state: "upcoming" },
      { key: "completed", label: "Selesai", at: null, state: "upcoming" },
    ]);
  });

  it("has no time for packing: processing records none", () => {
    const steps = timelineSteps(
      order({
        status: "processing",
        ...at,
        shipped_at: null,
        completed_at: null,
      }),
    );

    expect(steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(steps[2]).toEqual({
      key: "processing",
      label: "Diproses",
      at: null,
      state: "current",
    });
  });

  it("marks every step done and the last current for a completed order", () => {
    const steps = timelineSteps(order({ status: "completed", ...at }));

    expect(steps.map((step) => [step.key, step.state, step.at])).toEqual([
      ["pending_payment", "done", at.created_at],
      ["paid", "done", at.paid_at],
      ["processing", "done", null],
      ["shipped", "done", at.shipped_at],
      ["completed", "current", at.completed_at],
    ]);
  });

  it("shows no time for an upcoming step even if the order has one", () => {
    const steps = timelineSteps(order({ status: "pending_payment", ...at }));

    expect(steps[0]).toMatchObject({ state: "current", at: at.created_at });
    expect(steps.slice(1).map((step) => step.at)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("shows only what happened to a paid order that was cancelled", () => {
    expect(
      timelineSteps(
        order({
          status: "cancelled",
          cancel_reason: "seller_cancelled",
          ...at,
        }),
      ),
    ).toEqual([
      {
        key: "pending_payment",
        label: "Dipesan",
        at: at.created_at,
        state: "done",
      },
      { key: "paid", label: "Dibayar", at: at.paid_at, state: "done" },
      {
        key: "cancelled",
        label: "Dibatalkan (dibatalkan toko)",
        at: at.cancelled_at,
        state: "current",
      },
    ]);
  });

  it("leaves out Dibayar for an order cancelled before it was paid", () => {
    expect(
      timelineSteps(
        order({
          status: "cancelled",
          cancel_reason: "payment_expired",
          ...at,
          paid_at: null,
        }),
      ),
    ).toEqual([
      {
        key: "pending_payment",
        label: "Dipesan",
        at: at.created_at,
        state: "done",
      },
      {
        key: "cancelled",
        label: "Dibatalkan (waktu pembayaran habis)",
        at: at.cancelled_at,
        state: "current",
      },
    ]);
  });
});
