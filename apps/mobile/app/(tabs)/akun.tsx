// The Akun tab, at /akun. A placeholder until sign-in arrives in the app
// (tokens in expo-secure-store, never AsyncStorage).
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export default function AccountScreen() {
  return (
    <ScreenPlaceholder
      title="Akun"
      message="Masuk untuk melihat pesanan dan alamat Anda."
    />
  );
}
