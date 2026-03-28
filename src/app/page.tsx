import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getSessionByToken, SESSION_COOKIE_NAME } from "@/lib/auth";

export default async function RootPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? getSessionByToken(token) : null;

  if (session) {
    redirect("/transactions");
  } else {
    redirect("/login");
  }
}
