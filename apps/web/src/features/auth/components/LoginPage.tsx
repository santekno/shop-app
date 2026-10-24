import { Link } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/** /masuk: logging in. The form arrives in artikel 09. */
export function LoginPage() {
  useDocumentTitle("Masuk — GoShop");
  return (
    <Card>
      <h1 tabIndex={-1}>Masuk</h1>
      <p className="muted">Formulir masuk menyusul.</p>
      <p>
        Belum punya akun? <Link to="/daftar">Daftar</Link>
      </p>
    </Card>
  );
}
