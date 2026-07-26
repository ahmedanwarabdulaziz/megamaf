import Link from 'next/link';
import { BarChart3, Building2, Activity } from 'lucide-react';

export const metadata = { title: 'التقارير' };

export default function ReportsHubPage() {
  const reports = [
    {
      title: "التقرير المالي للمشروع",
      description: "ملخص مالي شامل وتفصيلي لأي مشروع: الإيرادات، التكاليف، المحتجزات، السيولة، وكل الحركات التفصيلية.",
      href: "/reports/project",
      icon: <Building2 className="w-8 h-8 text-blue-600" />,
      color: "border-blue-200 hover:border-blue-500 bg-blue-50/50"
    },
    {
      title: "سجل حركات النظام (Audit Log)",
      description: "سجل كامل بجميع الحركات التي تمت على النظام (إضافة، تعديل، اعتماد) من قبل المستخدمين.",
      href: "/reports/audit-log",
      icon: <Activity className="w-8 h-8 text-slate-600" />,
      color: "border-slate-200 hover:border-slate-500 bg-slate-50/50"
    }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-primary/10 rounded-full">
          <BarChart3 className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">مركز التقارير</h1>
          <p className="text-muted-foreground mt-1">كشوف الحسابات والمواقف المالية المستخرجة من النظام</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reports.map((r, i) => (
          <Link key={i} href={r.href} className={`block p-6 rounded-lg border transition-all shadow-sm hover:shadow-md ${r.color}`}>
            <div className="mb-4">{r.icon}</div>
            <h3 className="text-lg font-bold mb-2">{r.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{r.description}</p>
          </Link>
        ))}
      </div>

      <p className="text-sm text-muted-foreground text-center">تقارير إضافية قادمة قريباً.</p>
    </div>
  );
}
