"use client"

import * as React from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { FileText, ChevronDown, ChevronUp, CheckCircle2, Circle, Edit } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { generateProfitSchedule } from "@/lib/finance-utils"

interface CertificateCardProps {
  certificate: any
  transactions: any[]
}

export function CertificateCard({ certificate, transactions }: CertificateCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const schedule = React.useMemo(() => generateProfitSchedule(certificate, transactions), [certificate, transactions])
  
  const totalCollected = schedule.reduce((acc, curr) => curr.isCollected ? acc + (curr.actualAmount || 0) : acc, 0)
  const collectedCount = schedule.filter(s => s.isCollected || s.isHistorical).length
  const totalCount = schedule.length

  return (
    <Card className="overflow-hidden">
      <CardHeader 
        className="bg-card border-b border-border pb-4 cursor-pointer select-none transition-colors hover:bg-muted/30"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary/10 rounded-xl">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                 {certificate.bank_name}
                 <span className="text-xs font-normal bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{certificate.certificate_type || "شهادة"}</span>
              </CardTitle>
              <div className="text-sm text-muted-foreground mt-1 flex gap-2 items-center">
                <span className="font-medium">{Number(certificate.amount).toLocaleString('en-US')} {certificate.currency}</span>
                <span>•</span>
                <span>{certificate.interest_rate}% سنوياً</span>
                <span>•</span>
                <span>{certificate.duration_months} شهر</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-left rtl:text-right">
             <div className="flex flex-col">
               <span className="text-xs text-muted-foreground">تم تحصيل {collectedCount} من {totalCount}</span>
               <span className="text-sm font-bold text-primary dir-ltr">{totalCollected.toLocaleString('en-US')} {certificate.currency}</span>
             </div>
             <div className="flex items-center">
               <Link
                 href={`?modal=edit-certificate&id=${certificate.id}&bank_name=${encodeURIComponent(certificate.bank_name)}&certificate_type=${encodeURIComponent(certificate.certificate_type || "")}&amount=${certificate.amount}&currency=${certificate.currency}&interest_rate=${certificate.interest_rate}&duration_months=${certificate.duration_months}&start_date=${certificate.start_date}&payout_frequency=${certificate.payout_frequency}&notes=${encodeURIComponent(certificate.notes || "")}`}
                 scroll={false}
                 onClick={(e) => e.stopPropagation()}
               >
                 <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                    <Edit className="h-4 w-4" />
                 </Button>
               </Link>
               <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
               </Button>
             </div>
          </div>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="p-0 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="flex flex-col">
            {/* Desktop Header */}
            <div className="hidden sm:grid sm:grid-cols-6 gap-4 px-4 py-3 bg-muted/50 text-muted-foreground text-sm font-medium border-b border-border items-center text-right">
              <div>الدفعة</div>
              <div>تاريخ الاستحقاق</div>
              <div>المبلغ المتوقع</div>
              <div>المبلغ الفعلي</div>
              <div className="text-center">الحالة</div>
              <div className="text-center">إجراء</div>
            </div>

            {/* Rows */}
            <div className="flex flex-col divide-y divide-border">
              {schedule.map((item, idx) => (
                <div key={idx} className="grid grid-cols-3 sm:grid-cols-6 gap-y-4 gap-x-2 px-4 py-4 sm:py-3 hover:bg-muted/20 transition-colors text-sm items-center">
                  
                  {/* Col 1: Index */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground sm:hidden">الدفعة</span>
                    <span className="font-medium sm:font-normal">رقم {item.index}</span>
                  </div>

                  {/* Col 2: Date */}
                  <div className="flex flex-col gap-1 sm:text-right">
                    <span className="text-[10px] text-muted-foreground sm:hidden">التاريخ</span>
                    <span className="text-xs sm:text-sm">{item.expectedDate.toLocaleDateString('en-GB')}</span>
                  </div>

                  {/* Col 3: Expected Amount */}
                  <div className="flex flex-col gap-1 items-end sm:items-start text-left sm:text-right rtl:sm:text-right rtl:text-left">
                    <span className="text-[10px] text-muted-foreground sm:hidden">المبلغ المتوقع</span>
                    <span className="dir-ltr font-medium text-primary sm:text-foreground sm:font-normal text-xs sm:text-sm">
                      {item.expectedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Col 4: Actual Amount */}
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground sm:hidden">المبلغ الفعلي</span>
                    <span className="dir-ltr text-right sm:text-right text-xs sm:text-sm">
                      {item.isCollected ? (item.actualAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
                    </span>
                  </div>

                  {/* Col 5: Status */}
                  <div className="flex flex-col gap-1 items-center sm:items-center">
                    <span className="text-[10px] text-muted-foreground sm:hidden">الحالة</span>
                    {item.isCollected ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-green-500/10 text-green-600">
                        <CheckCircle2 className="h-3 w-3" /> محصل
                      </span>
                    ) : item.isHistorical ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-blue-500/10 text-blue-600">
                        <CheckCircle2 className="h-3 w-3" /> محصل مسبقاً
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium bg-muted text-muted-foreground">
                        <Circle className="h-3 w-3" /> قادم
                      </span>
                    )}
                  </div>

                  {/* Col 6: Action */}
                  <div className="flex flex-col gap-1 items-end sm:items-center justify-end">
                     <span className="text-[10px] text-muted-foreground sm:hidden opacity-0">إجراء</span>
                     {!item.isCollected && !item.isHistorical ? (
                        <Link 
                           href={`?modal=collect-profit&certificate_id=${certificate.id}&expected_amount=${item.expectedAmount}&date=${item.expectedDate.toISOString()}&certificate_type=${encodeURIComponent(certificate.certificate_type || "شهادة")}&bank_name=${encodeURIComponent(certificate.bank_name || "")}`} 
                           scroll={false} 
                           onClick={(e) => e.stopPropagation()}
                        >
                          <Button size="sm" variant="outline" className="h-7 text-xs px-3 sm:px-4">تحصيل</Button>
                        </Link>
                      ) : (
                        <div className="h-7 flex items-center">
                          <span className="text-muted-foreground text-[10px] sm:hidden">
                            {item.isHistorical ? "تاريخي" : "تم التحصيل"}
                          </span>
                        </div>
                      )}
                  </div>

                </div>
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
