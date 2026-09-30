import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("guild_members")
    .select("guild_id")
    .eq("user_id", user.id)
    .maybeSingle();

  redirect(membership ? "/dashboard" : "/guild");
}
