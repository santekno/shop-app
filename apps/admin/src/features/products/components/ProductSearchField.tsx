import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/Input.tsx";
import { Label } from "@/components/ui/Label.tsx";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback.ts";
import { MAX_QUERY_LENGTH, normaliseQuery } from "../product-table-params.ts";

/** How long typing must pause before the table searches. */
export const SEARCH_DEBOUNCE_MS = 300;

interface ProductSearchFieldProps {
  /** The search in the URL, or undefined for none. */
  value: string | undefined;
  /** The text to search for (normalised), or undefined to stop searching. */
  onSearch: (q: string | undefined) => void;
}

/**
 * The search box over the table: name or SKU.
 *
 * Debounced: the table searches 300 ms after the seller stops typing, not
 * on every key, so typing "kaos polos" sends one or two requests instead
 * of ten. Enter searches at once.
 *
 * Two values, on purpose. `draft` is what the box shows, updated on every
 * key; `value` is the search the URL holds, updated after the pause. They
 * differ while the seller types, so the box keeps its own state, and
 * follows the URL only when the URL changes for another reason (Back,
 * "Hapus filter", a shared link): the render compares the URL's value
 * with the one it saw last ("storing information from previous renders",
 * React's documented alternative to an effect), and takes it over only
 * when the box did not send it itself.
 */
export function ProductSearchField({
  value,
  onSearch,
}: ProductSearchFieldProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(value ?? "");
  // The URL's search at the last render, and the last search this box sent.
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);

  if (value !== seen) {
    setSeen(value);
    if (value !== sent) {
      // Changed from outside: show it.
      setDraft(value ?? "");
      setSent(value);
    }
  }

  // The text on screen, for the debounced call to check against (below).
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });

  const send = (text: string) => {
    const q = normaliseQuery(text);
    setSent(q);
    onSearch(q);
  };

  const debounced = useDebouncedCallback((text: string) => {
    // The box was reset from outside while this call waited (Back, "Hapus
    // filter"): the text it would search for is no longer on screen.
    if (text !== draftRef.current) return;
    send(text);
  }, SEARCH_DEBOUNCE_MS);

  return (
    // role="search" makes the form a search landmark; a screen reader can
    // jump to it. Enter submits it: search now, without waiting.
    <form
      role="search"
      className="grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        debounced.cancel();
        send(draft);
      }}
    >
      <Label htmlFor={inputId}>Cari produk</Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={inputId}
          type="search"
          value={draft}
          maxLength={MAX_QUERY_LENGTH}
          placeholder="Nama atau SKU"
          autoComplete="off"
          enterKeyHint="search"
          className="pl-9"
          onChange={(event) => {
            setDraft(event.target.value);
            debounced.run(event.target.value);
          }}
        />
      </div>
    </form>
  );
}
