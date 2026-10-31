// Shown for any path that matches no route: a mistyped deep link such as
// goshop://produkk/kaos, or an old link to a screen that no longer exists.
// The + prefix marks a special file, not a route of its own; it is the
// counterpart of apps/web/src/app/not-found.tsx.
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function NotFoundScreen() {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Halaman tidak ditemukan
      </Text>
      <Text style={styles.body}>
        Tautan ini tidak mengarah ke halaman mana pun di GoShop.
      </Text>
      <Link href="/" dismissTo style={styles.link}>
        Kembali ke beranda
      </Link>
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
  body: {
    fontSize: 16,
    textAlign: "center",
  },
  link: {
    fontSize: 16,
    color: "#2563eb",
    paddingVertical: 8,
  },
});
