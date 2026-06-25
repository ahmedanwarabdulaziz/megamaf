import Link from 'next/link';
import { BarChart3, Building2, Landmark, Users, Briefcase, FileText, Activity } from 'lucide-react';

export const metadata = { title: 'التقارير' };

export default function ReportsHubPage() {
  const reports = [
    {
      title: "الموقف المالي للمشاريع (P&L)",
      description: "ملخص الإيرادات والتكاليف والسيولة النقدية للشركة الأم وكل مشروع على حدة.",
      href: "/reports/project-position",
      icon: <Building2 className="w-8 h-8 text-blue-600" />,
      color: "border-blue-200 hover:border-blue-500 bg-blue-50/50"
    },
    {
      title: "كشوف حسابات البنوك",
      description: "حركة الخزينة والبنك التفصيلية (الوارد والمنصرف) لكل حساب بنكي.",
      href: "/reports/bank-statement",
      icon: <Landmark className="w-8 h-8 text-emerald-600" />,
      color: "border-emerald-200 hover:border-emerald-500 bg-emerald-50/50"
    },
    {
      title: "كشوف عهد الموظفين",
      description: "متابعة العهد المنصرفة للموظفين وتسوياتها بالمصروفات المعتمدة.",
      href: "/reports/employee-custody",
      icon: <Users className="w-8 h-8 text-indigo-600" />,
      color: "border-indigo-200 hover:border-indigo-500 bg-indigo-50/50"
    },
    {
      title: "كشوف حسابات المقاولين",
      description: "فواتير ومستخلصات الموردين والمقاولين مقابل الدفعات المنصرفة لهم.",
      href: "/reports/vendor-account",
      icon: <Briefcase className="w-8 h-8 text-amber-600" />,
      color: "border-amber-200 hover:border-amber-500 bg-amber-50/50"
    },
    {
      title: "كشوف حسابات الملاك",
      description: "المستخلصات والدفعات المستحقة على الملاك مقابل التحصيلات الفعلية.",
      href: "/reports/owner-account",
      icon: <FileText className="w-8 h-8 text-cyan-600" />,
      color: "border-cyan-200 hover:border-cyan-500 bg-cyan-50/50"
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
    </div>
  );
}
