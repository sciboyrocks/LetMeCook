import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function RootPage() {
  const cookieStore = await cookies();
  const hasSession = cookieStore.has("__lmc_sid");
  redirect(hasSession ? "/dashboard" : "/login");
}
