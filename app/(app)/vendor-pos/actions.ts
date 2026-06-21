"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function deleteVendorPO(id: string) {
  const supabase = await createClient()

  // Verify role
  const { data: userProfile } = await supabase.from("profiles").select("role").single()
  if (userProfile?.role !== "admin") {
    throw new Error("Unauthorized")
  }

  const { error } = await supabase.from("vendor_pos").delete().eq("id", id)

  if (error) {
    console.error("Failed to delete vendor PO", error)
    throw new Error("Failed to delete vendor PO")
  }

  revalidatePath("/vendor-pos")
  revalidatePath("/vendors")
}
