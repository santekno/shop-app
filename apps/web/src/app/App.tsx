import { CategorySection } from "@/features/catalog/components/CategorySection.tsx";

export function App() {
  return (
    <>
      <header className="site-header">
        <h1>GoShop</h1>
        <p className="muted">
          Toko online contoh dari kursus Fullstack Santekno.
        </p>
      </header>
      <main className="site-main">
        <CategorySection />
      </main>
    </>
  );
}
