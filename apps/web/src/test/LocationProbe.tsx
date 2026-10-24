import { useLocation } from "react-router";

/** Shows the router's current location, for asserting navigations. */
export function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}
