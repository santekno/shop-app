import { Text } from "react-native";

/** A section's title on the home screen; screen readers jump between headers. */
export function SectionHeader({ title }: { title: string }) {
  return (
    <Text
      accessibilityRole="header"
      className="px-1.5 pb-2 pt-4 font-sans text-lg font-bold text-foreground dark:text-foreground-dark"
    >
      {title}
    </Text>
  );
}
