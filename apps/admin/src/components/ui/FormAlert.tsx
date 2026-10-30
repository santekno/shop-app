import { useEffect, useRef } from "react";
import type { GlobalError } from "react-hook-form";

/**
 * A form's own error, the one that belongs to no field: wrong credentials,
 * the network, the server. It appears above the submit button.
 *
 * The button is disabled while the request runs, and a browser takes the
 * focus away from a disabled control: it falls to <body>, and Tab would
 * start again at the top of the page. So the message takes the focus when
 * it is set. A screen reader reads it (role="alert" announces it too),
 * Tab goes on to the button to try again, and Shift+Tab goes back to the
 * fields to correct them. tabIndex={-1} makes the paragraph focusable from
 * code without adding it to the Tab order.
 *
 * Why the message and not a field: it is not always about a field (the
 * network, a rate limit), and only the message says what went wrong.
 *
 * It takes the error object, not its text: React Hook Form's setError
 * creates a new object each time, so a second failure with the same text
 * moves the focus again, while typing in a field (which re-renders the
 * form with the same object) leaves the focus where the user put it.
 */
export function FormAlert({ error }: { error: GlobalError | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error !== undefined) ref.current?.focus();
  }, [error]);

  if (error?.message === undefined) return null;
  return (
    <p ref={ref} role="alert" tabIndex={-1} className="text-destructive">
      {error.message}
    </p>
  );
}
