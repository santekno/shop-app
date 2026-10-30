/** One notification on screen. */
export interface OrderToast {
  /** The event's ID: unique, and the React key. */
  id: string;
  message: string;
}

export interface ToastState {
  /** Oldest first; at most MAX_TOASTS. */
  toasts: readonly OrderToast[];
  /**
   * What the screen-reader live region says: the newest toast's text. A
   * value of its own, not "the last toast", so dismissing a toast never
   * makes the region announce an older one again.
   */
  announcement: string;
}

export type ToastAction =
  { type: "add"; toast: OrderToast } | { type: "dismiss"; id: string };

/** More toasts at once would cover the page; the oldest goes first. */
export const MAX_TOASTS = 3;

export const initialToastState: ToastState = { toasts: [], announcement: "" };

export const toastReducer = (
  state: ToastState,
  action: ToastAction,
): ToastState => {
  switch (action.type) {
    case "add":
      if (state.toasts.some((toast) => toast.id === action.toast.id)) {
        return state;
      }
      return {
        toasts: [...state.toasts, action.toast].slice(-MAX_TOASTS),
        announcement: action.toast.message,
      };
    case "dismiss":
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.id !== action.id),
      };
  }
};
