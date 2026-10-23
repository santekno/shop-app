import { useEffect } from "react";

/**
 * Sets the browser tab's title while the calling component is on screen,
 * and puts the previous title back when it leaves.
 *
 * This is what useEffect is for: keeping something outside React (here
 * document.title; elsewhere a network request or a subscription) in step
 * with what React renders. The effect runs after the render, again when
 * `title` changes, and its cleanup runs before the next run and on unmount.
 *
 * What does not belong in an effect, and how this app does it instead:
 * - Values computed from props or state: compute them while rendering
 *   ("Mulai" in ProductCard, the subtotal in ProductDetail).
 *   Copying them into state in an effect costs an extra render and can
 *   show a stale value for a frame; the react-hooks lint rule
 *   set-state-in-effect reports it.
 * - Reacting to a click: do it in the event handler (opening a product).
 * - Initialising state from loaded data: render the component that needs
 *   it only once the data is there, and pass it as a prop (ProductDetail).
 */
export const useDocumentTitle = (title: string): void => {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
};
