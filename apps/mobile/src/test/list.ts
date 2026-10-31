// The native views behind a list, for the events a finger or the OS sends
// them: RNTL's queries return what a user can read or press, and a scroll
// view or a refresh control is neither. fireEvent then walks up from the
// host view to the handler the component gave (onEndReached on the list,
// onRefresh on its RefreshControl).
import { screen } from "@testing-library/react-native";

const host = (type: string) => {
  const [instance] = screen.container.queryAll((i) => i.type === type);
  if (instance === undefined) throw new Error(`no ${type} on screen`);
  return instance;
};

/** The list's native scroll view (FlashList and FlatList render one). */
export const scrollView = () => host("RCTScrollView");

/** The native pull-to-refresh control of the list on screen. */
export const refreshControl = () => host("RCTRefreshControl");

/** The `refreshing` prop the list's RefreshControl was given. */
export const isRefreshingShown = (): unknown => {
  const element = scrollView().props.refreshControl as
    { props: { refreshing?: unknown } } | undefined;
  return element?.props.refreshing;
};
