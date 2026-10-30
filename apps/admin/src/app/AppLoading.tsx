import { LoadingState } from "@/components/ui/StatusMessage.tsx";
import { CenteredPage } from "./CenteredPage.tsx";

/**
 * What the router shows on the very first render while it still loads a
 * lazy route's code: a visit that starts on /masuk, before the login
 * page's chunk has arrived (the root route's HydrateFallback).
 */
export function AppLoading() {
  return (
    <CenteredPage>
      <LoadingState>Memuat dasbor GoShop…</LoadingState>
    </CenteredPage>
  );
}
