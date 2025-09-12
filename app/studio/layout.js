import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";

export default async function StudioLayout({ children }) {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session?.user || session.user.isAdmin !== true) {
    redirect("/login");
  }
  return <>{children}</>;
}
