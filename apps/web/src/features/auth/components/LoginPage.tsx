import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { loginSchema } from "@goshop/shared";
import type { LoginRequest } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { FormAlert } from "@/components/ui/FormAlert.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { setApiFieldErrors } from "@/lib/api-form-errors.ts";
import { authErrorMessage } from "../auth-errors.ts";
import { useLogin } from "../hooks/useLogin.ts";
import { registeredEmailFrom } from "../navigation-state.ts";

/**
 * /masuk: logging in with email and password.
 *
 * React Hook Form keeps the inputs uncontrolled: register("email") hands
 * the input a ref and change handlers, and the form reads the values from
 * the DOM when it is submitted. Typing re-renders nothing, unlike a
 * useState per field. handleSubmit checks the values first; onSubmit runs
 * only with valid values, and otherwise the first invalid field gets the
 * focus.
 *
 * The rules come from loginSchema in @goshop/shared, through zodResolver:
 * the schema the mobile app will use too (from Bab 13), checked against
 * the contract's LoginRequest type. onSubmit receives the schema's output (the email
 * already trimmed), which is what is sent.
 */
export function LoginPage() {
  useDocumentTitle("Masuk — GoShop");
  const location = useLocation();
  const navigate = useNavigate();
  const registeredEmail = registeredEmailFrom(location.state);
  const loginMutation = useLogin();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: registeredEmail ?? "", password: "" },
  });

  const onSubmit = (credentials: LoginRequest) => {
    loginMutation.mutate(credentials, {
      // replace: Back from the catalog should not reopen the login form.
      onSuccess: () => {
        void navigate("/", { replace: true });
      },
      // The API's answer, shown where it belongs: a field's own problem
      // under that field, anything else (INVALID_CREDENTIALS, the
      // network) above the button, as the form's `root` error.
      onError: (error) => {
        if (setApiFieldErrors(error, setError, ["email", "password"])) return;
        setError("root.server", { message: authErrorMessage(error) });
      },
    });
  };

  return (
    <Card>
      <h1 tabIndex={-1}>Masuk</h1>
      {registeredEmail !== undefined && (
        <p role="status">Akun Anda sudah dibuat. Silakan masuk.</p>
      )}
      {/* noValidate: the browser's own bubbles would show first, in the
          browser's language and style; the form shows its own messages,
          linked to each field. */}
      <form
        className="form"
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      >
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
          autoComplete="current-password"
          error={errors.password?.message}
          {...register("password")}
        />
        {/* Takes the focus when it appears: the disabled button lost it. */}
        <FormAlert message={errors.root?.server?.message} />
        <button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? "Memproses…" : "Masuk"}
        </button>
      </form>
      <p>
        Belum punya akun? <Link to="/daftar">Daftar</Link>
      </p>
    </Card>
  );
}
