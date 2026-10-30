import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Navigate, useSearchParams } from "react-router";
import { loginSchema } from "@goshop/shared";
import type { LoginRequest } from "@goshop/shared";
import { CenteredPage } from "@/app/CenteredPage.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { Card } from "@/components/ui/Card.tsx";
import { FormAlert } from "@/components/ui/FormAlert.tsx";
import { TextField } from "@/components/ui/TextField.tsx";
import { useDocumentTitle } from "@/hooks/useDocumentTitle.ts";
import { setApiFieldErrors } from "@/lib/api-form-errors.ts";
import { authErrorMessage } from "../auth-errors.ts";
import { useLogin } from "../hooks/useLogin.ts";
import { RETURN_TO_PARAM, safeReturnPath } from "../return-to.ts";
import { useSession } from "../session-context.ts";

/**
 * /masuk: the storefront's login form (Bab 9–10), on the dashboard's own
 * page. The same endpoint (POST /v1/auth/web/login), the same schema
 * (loginSchema from @goshop/shared) and the same error handling; only
 * the frame and the words differ.
 *
 * Any account can log in here: the API has one login for every role. What
 * happens next is RequireStaff's decision: a seller or an admin goes back
 * to `?kembali=` (checked by safeReturnPath, never another host), a buyer
 * sees the "no access" page.
 */
export function LoginPage() {
  useDocumentTitle("Masuk — GoShop Admin");
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get(RETURN_TO_PARAM));
  const { status } = useSession();
  const loginMutation = useLogin();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (credentials: LoginRequest) => {
    loginMutation.mutate(credentials, {
      // On success the session changes and the <Navigate> below takes the
      // user on. A field's own problem goes under that field, anything
      // else (wrong credentials, the network) above the button.
      onError: (error) => {
        if (setApiFieldErrors(error, setError, ["email", "password"])) return;
        setError("root.server", { message: authErrorMessage(error) });
      },
    });
  };

  // replace: Back from the dashboard should not reopen the login form.
  if (status === "authenticated") return <Navigate to={returnTo} replace />;

  return (
    <CenteredPage>
      <Card>
        <h1 tabIndex={-1} className="mb-1">
          Masuk
        </h1>
        <p className="mb-4 text-muted-foreground">
          Dasbor GoShop untuk penjual dan admin.
        </p>
        {/* noValidate: the form shows its own messages, linked to each
            field, instead of the browser's bubbles. */}
        <form
          className="grid justify-items-start gap-4"
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
      </Card>
    </CenteredPage>
  );
}
