import { createClient } from "@/lib/supabase/server"
import { CertificateCard } from "./_components/certificate-card"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Plus, FileText, Banknote } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AddCertificateModal } from "@/components/modals/add-certificate-modal"
import { CollectProfitModal } from "@/components/modals/collect-profit-modal"
import { EditCertificateModal } from "@/components/modals/edit-certificate-modal"
import { Suspense } from "react"

export default async function CertificatesPage() {
  const supabase = await createClient()

  // Fetch certificates
  const { data: certificates } = await supabase
    .from("certificates")
    .select("*")
    .order("created_at", { ascending: false })

  // Fetch bank transactions for these certificates
  const { data: transactions } = await supabase
    .from("bank_transactions")
    .select("*")
    .eq("reference_type", "certificate_profit")

  // Fetch bank accounts for the collect profit modal
  const { data: bankAccounts } = await supabase
    .from("bank_accounts")
    .select("*, banks(name)")

  const safeCertificates = certificates || []
  const safeTransactions = transactions || []
  const safeAccounts = bankAccounts || []

  // Global summaries
  const totalLockedAmount = safeCertificates.reduce((acc, cert) => acc + Number(cert.amount), 0)

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">الشهادات والودائع البنكية</h1>
          <p className="text-muted-foreground mt-2">
            متابعة استثماراتك، العوائد المتوقعة، ومواعيد الاستحقاق.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="?modal=add-certificate" scroll={false}>
            <Button variant="default">
              <Plus className="mr-2 h-4 w-4" />
              إضافة شهادة أو وديعة
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي المبالغ المربوطة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary dir-ltr text-right">{totalLockedAmount.toLocaleString('en-US')}</div>
          </CardContent>
        </Card>
      </div>

      {safeCertificates.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <FileText className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">لا توجد شهادات أو ودائع</h3>
          <p className="text-muted-foreground mt-2 max-w-sm">
            قم بإضافة شهادة أو وديعة بنكية لمتابعة أرباحها بشكل دوري وإضافتها لحسابك.
          </p>
          <Link href="?modal=add-certificate" scroll={false} className="mt-6">
            <Button>إضافة شهادة جديدة</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-6">
          {safeCertificates.map(cert => (
            <CertificateCard 
              key={cert.id} 
              certificate={cert} 
              transactions={safeTransactions.filter(t => t.reference_id === cert.id)} 
            />
          ))}
        </div>
      )}

      <AddCertificateModal />
      <Suspense fallback={null}>
        <EditCertificateModal />
        <CollectProfitModal accounts={safeAccounts} />
      </Suspense>
    </div>
  )
}
