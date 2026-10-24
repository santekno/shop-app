import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import type { RegisterRequest } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { authErrorMessage } from "../auth-errors.ts";
import { useRegister } from "../hooks/useRegister.ts";
import { registeredState } from "../navigation-state.ts";

/**
 * /daftar: creating a buyer account. The API does not log the new account
 * in, so a successful registration goes to /masuk with the email filled in.
 *
 * The rules are React Hook Form's own (required, minLength, pattern …),
 * written next to each field. They are a convenience for the buyer: the
 * API checks everything again, and its answer is what counts.
 */
export function RegisterPage() {
  useDocumentTitle("Daftar — GoShop");
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterRequest>({
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSubmit = (account: RegisterRequest) => {
    registerMutation.mutate(account, {
      onSuccess: (user) => {
        void navigate("/masuk", { state: registeredState(user.email) });
      },
    });
  };

  return (
    <Card>
      <h1 tabIndex={-1}>Daftar akun</h1>
      <form
        className="form"
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
        <TextField
          label="Nama"
          autoComplete="name"
          error={errors.name?.message}
          {...register("name", {
            required: "Masukkan nama Anda.",
            maxLength: {
              value: 100,
              message: "Nama paling panjang 100 karakter.",
            },
          })}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email", {
            required: "Masukkan email Anda.",
            pattern: {
              value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
              message:
                "Masukkan alamat email yang benar, misalnya budi@example.com.",
            },
          })}
        />
        <TextField
          label="Kata sandi"
          type="password"
          autoComplete="new-password"
          hint="8 sampai 128 karakter. Hindari kata sandi yang umum dipakai."
          error={errors.password?.message}
          {...register("password", {
            required: "Buat kata sandi.",
            minLength: { value: 8, message: "Kata sandi minimal 8 karakter." },
            maxLength: {
              value: 128,
              message: "Kata sandi paling panjang 128 karakter.",
            },
          })}
        />
        {registerMutation.isError && (
          <p role="alert" className="error-text">
            {authErrorMessage(registerMutation.error)}
          </p>
        )}
        <button type="submit" disabled={registerMutation.isPending}>
          {registerMutation.isPending ? "Memproses…" : "Daftar"}
        </button>
      </form>
      <p>
        Sudah punya akun? <Link to="/masuk">Masuk</Link>
      </p>
    </Card>
  );
}
