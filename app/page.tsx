import { redirect } from "next/navigation";
import { getSession, needsPlatformSetup } from "@/app/lib/auth";
import { isPlatformAdmin, isStaff, isTenant, isTradesman } from "@/app/lib/roles";

export default async function Home() {
  const s = await getSession();
  if (s) {
    if (isPlatformAdmin(s.role)) redirect("/platform");
    if (isStaff(s.role)) redirect("/dashboard");
    if (isTenant(s.role)) redirect("/portal");
    if (isTradesman(s.role)) redirect("/trade");
  }
  if (await needsPlatformSetup()) redirect("/setup");
  redirect("/login");
}
