/**
 * The auth pages' code, loaded on demand: the forms, React Hook Form and
 * Zod are downloaded only by a buyer who opens /masuk or /daftar.
 */
export const loadLoginPage = () => import("./components/LoginPage.tsx");
export const loadRegisterPage = () => import("./components/RegisterPage.tsx");
