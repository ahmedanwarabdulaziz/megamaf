import { z } from "zod"

const projectStatus = z.enum(["active", "completed", "on_hold", "cancelled"])

export const addProjectSchema = z.object({
  name: z.string().min(2, "اسم المشروع يجب أن يكون حرفين على الأقل"),
  code: z.string().optional(),
  description: z.string().optional(),
  owner_name: z.string().optional(),
  status: projectStatus.default("active"),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  budget: z.coerce.number().optional(),
  is_company_branch: z.boolean().optional().default(false),
})

export const editProjectSchema = z.object({
  id: z.string().uuid("معرف المشروع غير صالح"),
  name: z.string().min(2, "اسم المشروع يجب أن يكون حرفين على الأقل"),
  code: z.string().optional(),
  description: z.string().optional(),
  owner_name: z.string().optional(),
  status: projectStatus.default("active"),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  budget: z.coerce.number().optional(),
  is_company_branch: z.boolean().optional().default(false),
})

export const addProjectFundSchema = z.object({
  project_id: z.string().uuid("معرف المشروع غير صالح"),
  bank_account_id: z.string().uuid("يجب اختيار حساب بنكي"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  note: z.string().optional(),
  fund_date: z.string().min(1, "تاريخ التمويل مطلوب"),
})

export type ProjectStatus = z.infer<typeof projectStatus>
export type AddProjectInput = z.infer<typeof addProjectSchema>
export type EditProjectInput = z.infer<typeof editProjectSchema>
export type AddProjectFundInput = z.infer<typeof addProjectFundSchema>
