"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { deleteTransaction } from "../actions"

export function DeleteTransactionButton({ id }: { id: string }) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm("هل أنت متأكد من حذف هذه المعاملة؟ لا يمكن التراجع عن هذا الإجراء. إذا كانت هذه المعاملة تخص أرباح شهادة، سيتم إرجاع حالة الأرباح إلى غير محصلة.")) return
    
    setIsDeleting(true)
    const res = await deleteTransaction(id)
    if (res?.error) {
      alert(res.error)
      setIsDeleting(false)
    }
  }

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={handleDelete} 
      disabled={isDeleting}
      className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50"
      title="إلغاء المعاملة / التحصيل"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  )
}
