import { z } from "zod"

const vendorType = z.enum(["supplier", "contractor", "both"])

export const addVendorSchema = z.object({
  name: z.string().min(2, "اسم المورد يجب أن يكون حرفين على الأقل"),
  type: vendorType.default("both"),
  phone: z.string().optional(),
  email: z.string().email("البريد الإلكتروني غير صالح").optional().or(z.literal("")),
  address: z.string().optional(),
  tax_number: z.string().optional(),
  notes: z.string().optional(),
})

export const editVendorSchema = z.object({
  id: z.string().uuid("معرف المورد غير صالح"),
  name: z.string().min(2, "اسم المورد يجب أن يكون حرفين على الأقل"),
  type: vendorType.default("both"),
  phone: z.string().optional(),
  email: z.string().email("البريد الإلكتروني غير صالح").optional().or(z.literal("")),
  address: z.string().optional(),
  tax_number: z.string().optional(),
  notes: z.string().optional(),
})

export type VendorType = z.infer<typeof vendorType>
export type AddVendorInput = z.infer<typeof addVendorSchema>
export type EditVendorInput = z.infer<typeof editVendorSchema>
