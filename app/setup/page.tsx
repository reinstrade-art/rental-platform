import { redirect } from "next/navigation";
import { needsPlatformSetup } from "@/app/lib/auth";
import { platformSetup } from "@/app/lib/actions";

export default async function SetupPage() {
  if (!(await needsPlatformSetup())) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-xl font-semibold">Set up the Platform</h1>
      <p className="mt-1 text-sm text-gray-600">
        Nobody has signed up yet. This first account becomes the Platform Administrator —
        it provisions landlord organizations, it does not manage properties itself.
      </p>
      <form action={platformSetup} className="mt-6 flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          placeholder="Password (8+ characters)"
          className="rounded border px-3 py-2"
        />
        <button type="submit" className="rounded bg-black px-3 py-2 text-white">
          Create Platform Administrator
        </button>
      </form>
    </main>
  );
}
