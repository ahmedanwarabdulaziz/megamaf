'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getBankStatement } from '@/lib/queries/banks';
import { formatMoney } from '@/lib/money';
import { clsx } from 'clsx';

interface StatementItem {
  id: string;
  entry_date: string;
  direction: 'in' | 'out';
  amount: number;
  category: string;
  memo: string | null;
  running_balance: number;
}

export function StatementGrid({ 
  accountId, 
  initialItems, 
  totalCount 
}: { 
  accountId: string; 
  initialItems: StatementItem[]; 
  totalCount: number;
}) {
  const [items, setItems] = useState<StatementItem[]>(initialItems);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItemIndex = virtualItems[virtualItems.length - 1]?.index;

  const loadMore = useCallback(async () => {
    if (isFetching || items.length >= totalCount) return;
    
    setIsFetching(true);
    try {
      const res = await getBankStatement(accountId, 50, items.length);
      setItems(prev => [...prev, ...res.items]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsFetching(false);
    }
  }, [accountId, isFetching, items.length, totalCount]);

  useEffect(() => {
    if (lastItemIndex !== undefined && lastItemIndex >= items.length - 5) {
      loadMore();
    }
  }, [lastItemIndex, items.length, loadMore]);

  // Translate categories
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
  };

  return (
    <div className="flex flex-col h-[600px]">
      <div className="grid grid-cols-5 gap-4 p-4 border-b bg-muted/50 font-semibold text-sm">
        <div>التاريخ</div>
        <div>التصنيف</div>
        <div>البيان</div>
        <div className="text-left">المبلغ</div>
        <div className="text-left">الرصيد</div>
      </div>
      
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div 
          style={{ 
            height: `${rowVirtualizer.getTotalSize()}px`, 
            width: '100%', 
            position: 'relative' 
          }}
        >
          {virtualItems.map((virtualRow) => {
            const item = items[virtualRow.index];
            const isLoaded = item !== undefined;

            return (
              <div
                key={virtualRow.index}
                className={clsx(
                  "absolute top-0 left-0 w-full grid grid-cols-5 gap-4 px-4 py-2 border-b text-sm items-center transition-colors hover:bg-muted/30",
                  !isLoaded && "animate-pulse bg-muted/10"
                )}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {isLoaded ? (
                  <>
                    <div className="text-muted-foreground">{item.entry_date}</div>
                    <div>
                      <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                        {categoryMap[item.category] || item.category}
                      </span>
                    </div>
                    <div className="truncate" title={item.memo || ''}>
                      {item.memo || '-'}
                    </div>
                    <div className={clsx(
                      "text-left font-medium",
                      item.direction === 'in' ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"
                    )}>
                      {item.direction === 'in' ? '+' : '-'}{formatMoney(item.amount)}
                    </div>
                    <div className="text-left font-bold" dir="ltr">
                      {formatMoney(item.running_balance)}
                    </div>
                  </>
                ) : (
                  <div className="col-span-5 text-center text-muted-foreground text-xs">جاري التحميل...</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {error && <div className="p-2 text-sm text-destructive text-center bg-destructive/10">{error}</div>}
    </div>
  );
}
