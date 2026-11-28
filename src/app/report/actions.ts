"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  REPORT_COOKIE,
  REPORT_PATH,
  REPORT_SESSION_HOURS,
  issueReportToken,
  passwordMatches,
  reportIsConfigured,
} from "@/server/lib/report-auth";
import { checkActionThrottle, recordAction } from "@/server/lib/rate-limit";

/** Five wrong passwords from one place, then fifteen minutes' wait. */
const BUCKET = "report-login";

export async function reportSignIn(formData: FormData): Promise<void> {
  if (!reportIsConfigured()) redirect(REPORT_PATH);

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const gate = await checkActionThrottle({ bucket: BUCKET, subject: ip, max: 5, windowMinutes: 15 });
  if (!gate.allowed) redirect(`${REPORT_PATH}?e=wait`);

  const password = String(formData.get("password") ?? "");
  if (!passwordMatches(password)) {
    await recordAction(BUCKET, ip);
    redirect(`${REPORT_PATH}?e=1`);
  }

  const token = issueReportToken();
  if (!token) redirect(REPORT_PATH);

  const jar = await cookies();
  jar.set(REPORT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: REPORT_PATH,
    maxAge: REPORT_SESSION_HOURS * 3600,
  });
  redirect(REPORT_PATH);
}

export async function reportSignOut(): Promise<void> {
  const jar = await cookies();
  jar.set(REPORT_COOKIE, "", { path: REPORT_PATH, maxAge: 0 });
  redirect(REPORT_PATH);
}
