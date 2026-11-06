// @gorhom/bottom-sheet for the tests (jest.setup.ts mocks the module with
// this file). The real sheet is driven by Reanimated worklets and gesture
// handlers on the UI thread, which Jest has none of, and the package's own
// mock renders its content always and ignores present()/dismiss(), which
// is exactly what FilterSheet's behaviour depends on.
//
// This one keeps the contract a screen sees:
//
// - the content (children) is on screen only while the sheet is presented
//   (the real BottomSheetModal mounts it on present() and unmounts it after
//   dismiss());
// - present() and dismiss() are on the ref, and call onChange(0) /
//   onChange(-1) and onDismiss() as the real sheet does once it has settled;
// - the backdrop component the screen gives is drawn, and a backdrop with
//   pressBehavior "close" dismisses the sheet when pressed;
// - snapPoints and enablePanDownToClose are visible as props of the host
//   view "MockBottomSheet", for a test that wants to check them.
import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  useImperativeHandle,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

const SheetContext = createContext<{ dismiss: () => void }>({
  dismiss: () => undefined,
});

export const BottomSheetModalProvider = ({
  children,
}: {
  children: ReactNode;
}) => <>{children}</>;

interface ModalProps {
  children: ReactNode;
  snapPoints?: string[];
  enablePanDownToClose?: boolean;
  backdropComponent?: (props: Record<string, unknown>) => ReactNode;
  handleComponent?: (props: Record<string, unknown>) => ReactNode;
  onChange?: (index: number) => void;
  onDismiss?: () => void;
}

export const BottomSheetModal = forwardRef<
  { present: () => void; dismiss: () => void },
  ModalProps
>(function BottomSheetModal(
  {
    children,
    snapPoints,
    enablePanDownToClose,
    backdropComponent,
    handleComponent,
    onChange,
    onDismiss,
  },
  ref,
) {
  const [presented, setPresented] = useState(false);

  const present = () => {
    setPresented(true);
    onChange?.(0);
  };
  const dismiss = () => {
    if (!presented) return;
    setPresented(false);
    onChange?.(-1);
    onDismiss?.();
  };
  useImperativeHandle(ref, () => ({ present, dismiss }));

  if (!presented) return null;
  return (
    <SheetContext.Provider value={{ dismiss }}>
      {createElement(
        "MockBottomSheet",
        { snapPoints, enablePanDownToClose },
        backdropComponent?.({ animatedIndex: { value: 0 } }),
        handleComponent?.({}),
        children,
      )}
    </SheetContext.Provider>
  );
});

export const BottomSheetBackdrop = ({
  pressBehavior,
  accessibilityLabel,
  accessibilityHint,
}: {
  pressBehavior?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) => {
  const { dismiss } = useContext(SheetContext);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        if (pressBehavior === "close") dismiss();
      }}
    />
  );
};

export const BottomSheetHandle = (props: Record<string, unknown>) => (
  <View {...props} />
);

export const BottomSheetScrollView = ScrollView;
