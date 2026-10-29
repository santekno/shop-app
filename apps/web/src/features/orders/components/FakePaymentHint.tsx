/**
 * Shown on the payment page when the server pays with the test gateway
 * (`provider: "fake"`, APP_PAYMENT_PROVIDER=fake; never in production).
 * There is no Midtrans page to open: a developer pays from a terminal,
 * and the page sees the result by polling, exactly as with Midtrans.
 */
export function FakePaymentHint({ code }: { code: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-dashed border-border bg-muted px-4 py-3 text-sm">
      <p className="font-semibold">Mode uji: gateway pembayaran palsu</p>
      <p>
        Server ini memakai <code>APP_PAYMENT_PROVIDER=fake</code>, jadi tidak
        ada halaman Midtrans. Bayar pesanan ini dari terminal:
      </p>
      <pre className="overflow-x-auto rounded bg-background px-2 py-1">
        <code>make fake-pay order={code}</code>
      </pre>
      <p>
        Tambahkan <code>status=expire</code> atau <code>status=deny</code> untuk
        mencoba hasil yang lain. Halaman ini memeriksa statusnya sendiri.
      </p>
    </div>
  );
}
