import { useEffect, useRef } from "react";

/**
 * A form's own error, the one that belongs to no field: wrong credentials,
 * the network, the server. It appears above the submit button.
 *
 * The button is disabled while the request runs, and a browser takes the
 * focus away from a disabled control: it falls to <body>, and Tab would
 * start again at the top of the page. So the message takes the focus when
 * it appears. A screen reader reads it (role="alert" announces it too),
 * Tab goes on to the button to try again, and Shift+Tab goes back to the
 * fields to correct them. tabIndex={-1} makes the paragraph focusable from
 * code without adding it to the Tab order.
 *
 * Why the message and not a field: it is not always about a field (the
 * network, a rate limit), and only the message says what went wrong.
 *
 * The effect runs when the message mounts. React Hook Form clears a
 * `root` error on every submit, so each failed submit mounts it again and
 * moves the focus again.
 */
export function FormAlert({ message }: { message: string | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const shown = message !== undefined;

  useEffect(() => {
    if (shown) ref.current?.focus();
  }, [shown]);

  if (!shown) return null;
  return (
    <p ref={ref} role="alert" tabIndex={-1} className="error-text">
      {message}
    </p>
  );
}
