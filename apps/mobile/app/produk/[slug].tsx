// The product detail, at /produk/<slug> (goshop://produk/<slug>). The
// brackets make the segment a parameter, like app/produk/[slug]/page.tsx in
// apps/web. A placeholder: the real screen fetches GET /v1/products/{slug}.
import { Stack, useLocalSearchParams, useTheme } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ProductScreen() {
  const { colors } = useTheme();
  // Typed by the route: slug is a string. Like a URL path segment on the
  // web, it is input from outside (anyone can open goshop://produk/…), so
  // the API, not this screen, decides whether it names a product.
  const { slug } = useLocalSearchParams<"/produk/[slug]">();

  return (
    // Pushed above the tabs, so no tab bar protects the bottom edge. The
    // stack's header already sits below the status bar; only the bottom
    // inset is this screen's job, where the "add to cart" bar will go.
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      {/* A screen can set its own header options while it renders. */}
      <Stack.Screen options={{ title: slug }} />
      <View style={styles.container}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          Detail produk
        </Text>
        <Text style={[styles.slug, { color: colors.text }]}>{slug}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
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
  slug: {
    fontSize: 16,
    fontFamily: "monospace",
  },
});
