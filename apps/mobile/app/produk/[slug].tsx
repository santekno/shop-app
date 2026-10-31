// The product detail, at /produk/<slug> (goshop://produk/<slug>). The
// brackets make the segment a parameter, like app/produk/[slug]/page.tsx in
// apps/web. A placeholder: the real screen fetches GET /v1/products/{slug}.
import { Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ProductScreen() {
  // Typed by the route: slug is a string. Like a URL path segment on the
  // web, it is input from outside (anyone can open goshop://produk/…), so
  // the API, not this screen, decides whether it names a product.
  const { slug } = useLocalSearchParams<"/produk/[slug]">();

  return (
    // Pushed above the tabs, so no tab bar protects the bottom edge. The
    // stack's header already sits below the status bar; only the bottom
    // inset is this screen's job, where the "add to cart" bar will go.
    // SafeAreaView comes from a library, so NativeWind does not know its
    // className; flex: 1 is the one style it needs.
    <SafeAreaView edges={["bottom"]} style={{ flex: 1 }}>
      {/* A screen can set its own header options while it renders. */}
      <Stack.Screen options={{ title: slug }} />
      <View className="flex-1 items-center justify-center gap-2 p-6">
        <Text
          accessibilityRole="header"
          className="font-sans text-2xl font-bold text-foreground dark:text-foreground-dark"
        >
          Detail produk
        </Text>
        <Text className="font-mono text-base text-foreground dark:text-foreground-dark">
          {slug}
        </Text>
      </View>
    </SafeAreaView>
  );
}
