import { z } from "zod"

export const addCertificateSchema = z.object({
  bank_name: z.string().min(2, "اسم البنك يجب أن يكون حرفين على الأقل"),
  certificate_type: z.string().min(2, "نوع الشهادة أو الوديعة مطلوب"),
  amount: z.coerce.number().min(1, "المبلغ يجب أن يكون أكبر من صفر"),
  currency: z.string().min(2, "العملة مطلوبة").default("EGP"),
  start_date: z.string().min(1, "تاريخ الربط مطلوب"),
  duration_months: z.coerce.number().min(1, "المدة يجب أن تكون شهر على الأقل"),
  interest_rate: z.coerce.number().min(0, "نسبة الفائدة غير صالحة"),
  payout_frequency: z.enum(['monthly', 'quarterly', 'semi_annually', 'annually', 'at_maturity'], {
    message: "اختر طريقة صرف صالحة"
  }),
  notes: z.string().optional(),
})

export const editCertificateSchema = z.object({
  id: z.string().uuid("معرف الشهادة غير صالح"),
  bank_name: z.string().min(2, "اسم البنك يجب أن يكون حرفين على الأقل"),
  certificate_type: z.string().min(2, "نوع الشهادة أو الوديعة مطلوب"),
  amount: z.coerce.number().min(1, "المبلغ يجب أن يكون أكبر من صفر"),
  currency: z.string().min(2, "العملة مطلوبة").default("EGP"),
  start_date: z.string().min(1, "تاريخ الربط مطلوب"),
  duration_months: z.coerce.number().min(1, "المدة يجب أن تكون شهر على الأقل"),
  interest_rate: z.coerce.number().min(0, "نسبة الفائدة غير صالحة"),
  payout_frequency: z.enum(['monthly', 'quarterly', 'semi_annually', 'annually', 'at_maturity'], {
    message: "اختر طريقة صرف صالحة"
  }),
  notes: z.string().optional(),
})

export const collectProfitSchema = z.object({
  certificate_id: z.string().uuid("معرف الشهادة غير صالح"),
  bank_account_id: z.string().uuid("يجب اختيار الحساب البنكي"),
  amount: z.coerce.number().min(0, "المبلغ غير صالح"),
  transaction_date: z.string().min(1, "تاريخ الصرف مطلوب"),
  description: z.string().optional(),
})
