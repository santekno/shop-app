// A screen that exists in the navigation before its feature does: a
// heading and one sentence, centred. Tabs whose chapter has not come yet
// (Kategori, Keranjang, Akun) use it, so the navigation can be built and
// tried in full now.
import { StyleSheet, Text, View } from "react-native";

interface ScreenPlaceholderProps {
  title: string;
  message: string;
}

export function ScreenPlaceholder({ title, message }: ScreenPlaceholderProps) {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
  message: {
    fontSize: 16,
    textAlign: "center",
  },
});
