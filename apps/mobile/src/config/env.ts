// The one place the app reads its configuration from the environment.
//
// Expo copies every EXPO_PUBLIC_* variable into the JavaScript bundle when
// it is built, the same way Vite does with VITE_* in apps/admin. Anything
// here is therefore readable by whoever installs the app: never put a
// secret in one. Expo only replaces the literal `process.env.EXPO_PUBLIC_…`
// form, so the variable is read by its full name, not through
// process.env[name] or destructuring.
import { Platform } from "react-native";

// The GoShop API from the device's point of view. An emulator or simulator
// runs on this machine, but "localhost" means different things to them:
// the iOS simulator shares the Mac's network, so localhost is the Mac; the
// Android emulator is its own virtual device, where localhost is the
// emulator itself and 10.0.2.2 is the machine running it. A phone on Wi-Fi
// needs the machine's LAN address, set through EXPO_PUBLIC_API_URL.
const LOCAL_API_URL =
  Platform.OS === "android" ? "http://10.0.2.2:8080" : "http://localhost:8080";

// An empty value (EXPO_PUBLIC_API_URL= in an .env file) counts as unset.
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";

/** Base URL of the GoShop API, without a trailing slash. */
export const apiUrl = (
  configuredApiUrl === "" ? LOCAL_API_URL : configuredApiUrl
).replace(/\/+$/, "");
