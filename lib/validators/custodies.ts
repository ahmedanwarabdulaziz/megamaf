import { z } from "zod"

function getTodayStr() {
  return new Date().toISOString().split("T")[0]
}
function getMinDateStr() {
  const d = new Date()
  d.setDate(d.getDate() - 15)
  return d.toISOString().split("T")[0]
}

const dateValidation = z.string().refine((val) => {
  const today = getTodayStr()
  const minDate = getMinDateStr()
  return val >= minDate && val <= today
}, `التاريخ يجب أن يكون بين اليوم و 15 يوم سابقاً كحد أقصى`)

export const addCustodySchema = z.object({
  employee_id: z.string().uuid("يجب اختيار موظف"),
  project_id: z.string().uuid("يجب اختيار مشروع"),
  date: dateValidation,
  item: z.string().min(2, "البند يجب أن يكون حرفين على الأقل"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  notes: z.string().optional(),
})

export const editCustodySchema = z.object({
  id: z.string().uuid("معرف العهدة غير صالح"),
  employee_id: z.string().uuid("يجب اختيار موظف"),
  project_id: z.string().uuid("يجب اختيار مشروع"),
  date: dateValidation,
  item: z.string().min(2, "البند يجب أن يكون حرفين على الأقل"),
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  notes: z.string().optional(),
})

export function getTodayAndMinDate() {
  return { today: getTodayStr(), minDate: getMinDateStr() }
}

export type AddCustodyInput = z.infer<typeof addCustodySchema>
export type EditCustodyInput = z.infer<typeof editCustodySchema>
