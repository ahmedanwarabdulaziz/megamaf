import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getProfile } from '@/lib/supabase/get-profile';
import { getAllExpenses } from '@/lib/queries/expenses';

const statusMap: Record<string, string> = {
  pending: 'قيد المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
};

const fundingTypeMap: Record<string, string> = {
  bank: 'حساب بنكي',
  employee_custody: 'عهدة موظف آخر',
};

export async function GET(request: NextRequest) {
  try {
    const { user, profile } = await getProfile();
    if (!user || !profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isSuperAdmin = !!profile.is_super_admin;
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get('tab') === 'all' ? 'all' : 'mine';

    // Same access rule as the page itself: "mine" is always your own
    // expenses; "all" (every employee) requires super admin.
    if (tab === 'all' && !isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const projectId = searchParams.get('project_id') || undefined;
    const categoryId = searchParams.get('category_id') || undefined;
    const status = searchParams.get('status') || undefined;
    const showAll = searchParams.get('show_all') === 'true';
    const startDate = showAll ? undefined : (searchParams.get('start_date') || undefined);
    const endDate = showAll ? undefined : (searchParams.get('end_date') || undefined);
    const employeeId = tab === 'mine' ? profile.id : (searchParams.get('employee_id') || undefined);

    const expenses = await getAllExpenses({
      employeeId,
      projectId,
      categoryId,
      startDate,
      endDate,
      status,
      limit: 50000,
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('المصروفات', {
      views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }],
    });

    sheet.columns = [
      { header: 'التاريخ', key: 'date', width: 14 },
      { header: 'الموظف', key: 'employee', width: 24 },
      { header: 'المشروع', key: 'project', width: 26 },
      { header: 'التصنيف', key: 'category', width: 24 },
      { header: 'المبلغ', key: 'amount', width: 16 },
      { header: 'الحالة', key: 'status', width: 14 },
      { header: 'تمت التسوية', key: 'settled', width: 16 },
      { header: 'مصدر التمويل', key: 'funding', width: 26 },
      { header: 'ملاحظات', key: 'notes', width: 40 },
      { header: 'اعتمد بواسطة', key: 'approver', width: 22 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'right' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    headerRow.eachCell((cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    });

    for (const e of expenses as any[]) {
      const fundingLabel = e.funding_type === 'bank'
        ? `${fundingTypeMap.bank}: ${e.funding_bank?.banks?.name || ''} - ${e.funding_bank?.account_name || ''}`
        : e.funding_type === 'employee_custody'
          ? `${fundingTypeMap.employee_custody}: ${e.funding_employee?.full_name || ''}`
          : 'عهدته الخاصة';

      const row = sheet.addRow({
        date: e.expense_date,
        employee: e.employee?.full_name || (e.owner?.name ? `مالك: ${e.owner.name}` : '-'),
        project: e.project?.name || 'ميجاماف (الشركة الرئيسية)',
        category: e.category?.name || '-',
        amount: Number(e.amount),
        status: statusMap[e.status] || e.status,
        settled: e.status === 'approved' ? Number(e.settled_amount) : '-',
        funding: fundingLabel,
        notes: e.notes || '-',
        approver: e.approver?.full_name || '-',
      });
      row.getCell('amount').numFmt = '#,##0.00';
      if (typeof row.getCell('settled').value === 'number') {
        row.getCell('settled').numFmt = '#,##0.00';
      }
      row.alignment = { horizontal: 'right' };

      // A negative amount (money returned to custody) stands out in red.
      if (Number(e.amount) < 0) {
        row.getCell('amount').font = { color: { argb: 'FFDC2626' } };
      }
    }

    // Totals row
    const totalRow = sheet.addRow({
      date: '',
      employee: '',
      project: '',
      category: 'الإجمالي',
      amount: expenses.reduce((sum: number, e: any) => sum + Number(e.amount), 0),
      status: '',
      settled: '',
      funding: '',
      notes: '',
      approver: '',
    });
    totalRow.font = { bold: true };
    totalRow.getCell('category').alignment = { horizontal: 'right' };
    totalRow.getCell('amount').numFmt = '#,##0.00';
    totalRow.getCell('amount').alignment = { horizontal: 'right' };
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    });

    sheet.autoFilter = { from: 'A1', to: 'J1' };

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `expenses-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Export failed' }, { status: 500 });
  }
}
