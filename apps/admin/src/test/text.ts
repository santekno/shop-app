// Intl writes non-breaking spaces ("Rp 89.000" has U+00A0, a range
// "1–7 Okt" may have U+2009 or U+202F). A test compares the words, so it
// turns every kind of space into a plain one first.
export const plain = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s/gu, " ");
