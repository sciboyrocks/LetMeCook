import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";

export const metadata = { title: "LetMeCook" };

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  if (!cookieStore.has("__lmc_sid")) {
    redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}
