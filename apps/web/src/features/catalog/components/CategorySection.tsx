import { errorMessage, errorRequestId } from "@/lib/error-message.ts";
import { useCategoryTree } from "../hooks/useCategoryTree.ts";
import { CategoryTree } from "./CategoryTree.tsx";

/** The home page's category list, with its loading, error and empty states. */
export function CategorySection() {
  const { state, reload } = useCategoryTree();

  return (
    <section className="card" aria-labelledby="categories-heading">
      <h2 id="categories-heading">Kategori</h2>

      {state.status === "loading" && <p role="status">Memuat kategori…</p>}

      {state.status === "error" && (
        <div role="alert" className="error">
          <p>{errorMessage(state.error)}</p>
          {errorRequestId(state.error) !== undefined && (
            <p className="muted">
              Kode permintaan: <code>{errorRequestId(state.error)}</code>
            </p>
          )}
          <button type="button" onClick={reload}>
            Coba lagi
          </button>
        </div>
      )}

      {state.status === "success" &&
        (state.data.length === 0 ? (
          <p>Belum ada kategori.</p>
        ) : (
          <CategoryTree nodes={state.data} />
        ))}
    </section>
  );
}
