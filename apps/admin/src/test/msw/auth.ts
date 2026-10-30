// The web session's three endpoints (POST /v1/auth/web/login, /refresh,
// /logout), which the dashboard calls with `X-GoShop-Client: admin`.
import { http, HttpResponse } from "msw";
import type {
  ErrorBody,
  LoginRequest,
  WebSession,
  WebSessionDetail,
} from "@goshop/shared";
import { inOrder } from "./answers.ts";
import type { Answer } from "./answers.ts";
import { apiUrl } from "./http.ts";

/** 200 with a web session, as login and refresh answer. */
export const sessionResponse = (session: WebSession) =>
  HttpResponse.json<WebSessionDetail>({ data: session });

/** POST /v1/auth/web/login, answered with `answers` in order. */
export const webLoginHandler = (...answers: Answer[]) =>
  http.post<never, LoginRequest, WebSessionDetail | ErrorBody>(
    apiUrl("/v1/auth/web/login"),
    inOrder("web/login", answers),
  );

/** POST /v1/auth/web/refresh, answered with `answers` in order. */
export const webRefreshHandler = (...answers: Answer[]) =>
  http.post<never, never, WebSessionDetail | ErrorBody>(
    apiUrl("/v1/auth/web/refresh"),
    inOrder("web/refresh", answers),
  );

/** POST /v1/auth/web/logout, answered with `answers` in order. */
export const webLogoutHandler = (...answers: Answer[]) =>
  http.post<never, never, ErrorBody>(
    apiUrl("/v1/auth/web/logout"),
    inOrder("web/logout", answers),
  );
