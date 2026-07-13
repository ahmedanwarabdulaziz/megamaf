import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getProfile } from '@/lib/supabase/get-profile';
import { getAllBanksLedger } from '@/lib/queries/banks';

const categoryMap: Record<string, string> = {
  'opening_balance': 'رصيد افتتاحي',
  'bank_in': 'إيداع بنكي',
  'bank_out': 'سحب بنكي',
  'custody_disbursement': 'صرف عهدة',
  'vendor_payment': 'دفعة مقاول/مورد',
  'owner_payment': 'دفعة مالك',
  'deposit_collection': 'تحصيل وديعة',
  'interest': 'فوائد',
  'deduction': 'خصومات/مصروفات',
  'transfer_in': 'تحويل وارد',
  'transfer_out': 'تحويل صادر',
  'salary_payment': 'دفعة راتب',
  'loan_disbursement': 'صرف سلفة',
};

const counterpartyTypeMap: Record<string, string> = {
  vendor: 'مقاول/مورد',
  owner: 'مالك',
  employee: 'موظف',
  bank: 'حساب بنكي',
  internal: 'داخلي',
};

export async function GET(request: NextRequest) {
  try {
    const { user, profile } = await getProfile();
    if (!user || !profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isSuperAdmin = !!profile.is_super_admin;
    const granted = (profile.employee_page_access as any[])?.map((p: any) => p.page_slug) ?? [];
    if (!isSuperAdmin && !granted.includes('banks')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id') || undefined;
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;
    const showAll = searchParams.get('show_all') === 'true';

    const { items } = await getAllBanksLedger({
      startDate,
      endDate,
      showAll,
      bankAccountId: accountId,
      limit: 100000,
      offset: 0,
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('المعاملات البنكية', {
      views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }],
    });

    sheet.columns = [
      { header: 'التاريخ', key: 'date', width: 14 },
      { header: 'الحساب البنكي', key: 'account', width: 30 },
      { header: 'التصنيف', key: 'category', width: 22 },
      { header: 'لمن / من', key: 'counterparty', width: 26 },
      { header: 'البيان', key: 'memo', width: 45 },
      { header: 'الاتجاه', key: 'direction', width: 12 },
      { header: 'المبلغ', key: 'amount', width: 16 },
      { header: 'بواسطة', key: 'created_by', width: 20 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'right' };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    headerRow.eachCell((cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    });

    for (const entry of items as any[]) {
      const row = sheet.addRow({
        date: entry.entry_date,
        account: `${entry.bank_accounts?.banks?.name || ''} - ${entry.bank_accounts?.account_name || ''}`,
        category: categoryMap[entry.category] || entry.category,
        counterparty: entry.counterparty_name
          ? `${counterpartyTypeMap[entry.counterparty_type] || entry.counterparty_type}: ${entry.counterparty_name}`
          : '-',
        memo: entry.memo || '-',
        direction: entry.direction === 'in' ? 'إيداع' : 'سحب',
        amount: Number(entry.amount) * (entry.direction === 'out' ? -1 : 1),
        created_by: entry.created_by_name || '-',
      });
      row.getCell('amount').numFmt = '#,##0.00';
      row.alignment = { horizontal: 'right' };
    }

    sheet.autoFilter = { from: 'A1', to: 'H1' };

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `bank-transactions-${new Date().toISOString().slice(0, 10)}.xlsx`;

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
