// The product detail, at /produk/<slug> (goshop://produk/<slug>). The
// brackets make the segment a parameter, like app/produk/[slug]/page.tsx in
// apps/web. A placeholder: the real screen fetches GET /v1/products/{slug}.
import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function ProductScreen() {
  // Typed by the route: slug is a string. Like a URL path segment on the
  // web, it is input from outside (anyone can open goshop://produk/…), so
  // the API, not this screen, decides whether it names a product.
  const { slug } = useLocalSearchParams<"/produk/[slug]">();

  return (
    <View style={styles.container}>
      {/* A screen can set its own header options while it renders. */}
      <Stack.Screen options={{ title: slug }} />
      <Text accessibilityRole="header" style={styles.title}>
        Detail produk
      </Text>
      <Text style={styles.slug}>{slug}</Text>
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
  slug: {
    fontSize: 16,
    fontFamily: "monospace",
  },
});
