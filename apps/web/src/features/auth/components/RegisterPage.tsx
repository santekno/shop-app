import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isApiError,
  registerSchema,
} from "@goshop/shared";
import type { RegisterRequest } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { setApiFieldErrors } from "@/lib/api-form-errors.ts";
import { authErrorMessage } from "../auth-errors.ts";
import { useRegister } from "../hooks/useRegister.ts";
import { registeredState } from "../navigation-state.ts";

/**
 * /daftar: creating a buyer account. The API does not log the new account
 * in, so a successful registration goes to /masuk with the email filled in.
 *
 * The rules are registerSchema from @goshop/shared, the API's own rules
 * written once in Zod (email format, password length counted in
 * characters as Go counts them, a trimmed name) and checked against the
 * contract's RegisterRequest type. In artikel 09 they were React Hook
 * Form's built-in rules, written next to each field, in this one form
 * only. They are a convenience for the buyer: the API checks everything
 * again, and its answer is what counts.
 */
export function RegisterPage() {
  useDocumentTitle("Daftar — GoShop");
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const onSubmit = (account: RegisterRequest) => {
    registerMutation.mutate(account, {
      onSuccess: (user) => {
        void navigate("/masuk", { state: registeredState(user.email) });
      },
      onError: (error) => {
        // 400 VALIDATION_FAILED: under each field the API refused. The
        // schema already checked what it could, so this is mostly what
        // only the server knows: a password on its list of leaked ones.
        if (setApiFieldErrors(error, setError, ["name", "email", "password"])) {
          return;
        }
        // 409 EMAIL_TAKEN is about the email field too.
        if (isApiError(error, "EMAIL_TAKEN")) {
          setError(
            "email",
            {
              type: "server",
              message:
                "Email ini sudah terdaftar. Silakan masuk, atau gunakan email lain.",
            },
            { shouldFocus: true },
          );
          return;
        }
        setError("root.server", { message: authErrorMessage(error) });
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
          {...register("name")}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <TextField
          label="Kata sandi"
          type="password"
          autoComplete="new-password"
          hint={`${PASSWORD_MIN_LENGTH} sampai ${PASSWORD_MAX_LENGTH} karakter. Hindari kata sandi yang umum dipakai.`}
          error={errors.password?.message}
          {...register("password")}
        />
        {errors.root?.server !== undefined && (
          <p role="alert" className="error-text">
            {errors.root.server.message}
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
