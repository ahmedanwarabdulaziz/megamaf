import { z } from "zod"

const employeeStatus = z.enum(["active", "inactive"])

export const addEmployeeSchema = z.object({
  name: z.string().min(2, "اسم الموظف يجب أن يكون حرفين على الأقل"),
  job_title: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("البريد الإلكتروني غير صالح").optional().or(z.literal("")),
  salary: z.coerce.number().optional(),
  hire_date: z.string().optional(),
  status: employeeStatus.default("active"),
  is_super_admin: z.coerce.boolean().default(false),
  can_have_custody: z.coerce.boolean().default(false),
  can_approve_custodies: z.coerce.boolean().default(false),
})

export const editEmployeeSchema = z.object({
  id: z.string().uuid("معرف الموظف غير صالح"),
  name: z.string().min(2, "اسم الموظف يجب أن يكون حرفين على الأقل"),
  job_title: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("البريد الإلكتروني غير صالح").optional().or(z.literal("")),
  salary: z.coerce.number().optional(),
  hire_date: z.string().optional(),
  status: employeeStatus.default("active"),
  is_super_admin: z.coerce.boolean().default(false),
  can_have_custody: z.coerce.boolean().default(false),
  can_approve_custodies: z.coerce.boolean().default(false),
})

export type EmployeeStatus = z.infer<typeof employeeStatus>
export type AddEmployeeInput = z.infer<typeof addEmployeeSchema>
export type EditEmployeeInput = z.infer<typeof editEmployeeSchema>
