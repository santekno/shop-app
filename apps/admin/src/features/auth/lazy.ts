/**
 * The login page's code, loaded on demand: the form, React Hook Form and
 * Zod are downloaded only by someone who is not logged in yet. A seller
 * who reloads the dashboard with a live session never needs them (until
 * the product form of artikel 03).
 */
export const loadLoginPage = () => import("./components/LoginPage.tsx");
