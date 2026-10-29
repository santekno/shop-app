import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { Redirect } from "@/components/navigation/Redirect.tsx";
import { useSearchParams } from "next/navigation";
import { loginSchema } from "@goshop/shared";
import type { LoginRequest } from "@goshop/shared";
import { Card } from "@/components/ui/Card.tsx";
import { FormAlert } from "@/components/ui/FormAlert.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { setApiFieldErrors } from "@/lib/api-form-errors.ts";
import { authErrorMessage } from "../auth-errors.ts";
import { useLogin } from "../hooks/useLogin.ts";
import { useNavigationState } from "@/lib/navigation-state.ts";
import { registeredEmailFrom } from "../navigation-state.ts";
import { RETURN_TO_PARAM, safeReturnPath } from "../return-to.ts";
import { useSession } from "../session-context.ts";
import { Button } from "@/components/ui/Button.tsx";

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
 * the contract's LoginRequest type. onSubmit receives the schema's output
 * (the email already trimmed), which is what is sent.
 *
 * After the login (artikel 13) the buyer goes back to the page that sent
 * them here: `?kembali=/akun`, set by RequireAuth. The value is checked by
 * safeReturnPath first (a path on this site only, never another host: an
 * open redirect), and anything else means the catalog. The redirect is a
 * <Redirect> rendered once the session is there, so it also covers a buyer
 * who opens /masuk while already logged in.
 */
export function LoginPage() {
  const searchParams = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get(RETURN_TO_PARAM));
  const { status } = useSession();
  const registeredEmail = registeredEmailFrom(useNavigationState("/masuk"));
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
      // On success the session changes and the <Redirect> below takes
      // the buyer on. The API's answer, shown where it belongs: a field's own problem
      // under that field, anything else (INVALID_CREDENTIALS, the
      // network) above the button, as the form's `root` error.
      onError: (error) => {
        if (setApiFieldErrors(error, setError, ["email", "password"])) return;
        setError("root.server", { message: authErrorMessage(error) });
      },
    });
  };

  // replace: Back from the page reached should not reopen the login form.
  if (status === "authenticated") return <Redirect to={returnTo} />;

  return (
    <Card>
      <h1 tabIndex={-1} className="mb-4">
        Masuk
      </h1>
      {registeredEmail !== undefined && (
        <p role="status">Akun Anda sudah dibuat. Silakan masuk.</p>
      )}
      {/* noValidate: the browser's own bubbles would show first, in the
          browser's language and style; the form shows its own messages,
          linked to each field. */}
      <form
        className="mb-4 grid justify-items-start gap-4"
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
        <FormAlert error={errors.root?.server} />
        <Button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? "Memproses…" : "Masuk"}
        </Button>
      </form>
      <p>
        Belum punya akun? <Link href="/daftar">Daftar</Link>
      </p>
    </Card>
  );
}
