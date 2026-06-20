import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary/70" />
      <p className="text-sm font-medium text-muted-foreground animate-pulse">
        جاري تحميل البيانات...
      </p>
    </div>
  )
}
