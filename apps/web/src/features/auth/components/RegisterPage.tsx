import { Link } from "react-router";
import { Card } from "@/components/ui/Card.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";

/** /daftar: creating an account. The form arrives in artikel 09. */
export function RegisterPage() {
  useDocumentTitle("Daftar — GoShop");
  return (
    <Card>
      <h1 tabIndex={-1}>Daftar akun</h1>
      <p className="muted">Formulir pendaftaran menyusul.</p>
      <p>
        Sudah punya akun? <Link to="/masuk">Masuk</Link>
      </p>
    </Card>
  );
}
