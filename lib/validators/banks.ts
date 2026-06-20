import { z } from "zod"

export const addBankSchema = z.object({
  name: z.string().min(2, "اسم البنك يجب أن يكون حرفين على الأقل"),
})

export const addBankAccountSchema = z.object({
  bank_id: z.string().uuid("يجب اختيار البنك"),
  account_name: z.string().min(2, "اسم الحساب يجب أن يكون حرفين على الأقل"),
  account_number: z.string().optional(),
  currency: z.string().min(2, "العملة مطلوبة").default("EGP"),
  opening_balance: z.coerce.number().default(0),
})
export const editBankSchema = z.object({
  id: z.string().uuid("معرف البنك غير صالح"),
  name: z.string().min(2, "اسم البنك يجب أن يكون حرفين على الأقل"),
})

export const editBankAccountSchema = z.object({
  id: z.string().uuid("معرف الحساب غير صالح"),
  bank_id: z.string().uuid("يجب اختيار البنك"),
  account_name: z.string().min(2, "اسم الحساب يجب أن يكون حرفين على الأقل"),
  account_number: z.string().optional(),
  currency: z.string().min(2, "العملة مطلوبة"),
  // Note: we usually don't edit opening balance after transactions exist, but for now we allow it.
  opening_balance: z.coerce.number(),
})
