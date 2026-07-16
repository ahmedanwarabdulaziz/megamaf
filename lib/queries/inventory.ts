import { createClient } from '@/lib/supabase/server';

/** Compose "parent / sub" display label from category names */
export function categoryLabel(categoryName?: string | null, parentName?: string | null) {
  if (!categoryName) return null;
  return parentName ? `${parentName} / ${categoryName}` : categoryName;
}

export async function getItemCategories() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('item_categories')
    .select('id, name, parent_id')
    .order('name');
  if (error) throw error;
  return data || [];
}

/** Items with flattened category info — use everywhere an item picker needs the catalogue */
export async function getInventoryItemsWithCategory() {
  const supabase = await createClient();
  const [{ data: items, error: iError }, { data: categories, error: cError }] = await Promise.all([
    supabase.from('inventory_items').select('id, name, unit, code, category_id').order('name'),
    supabase.from('item_categories').select('id, name, parent_id'),
  ]);
  if (iError) throw iError;
  if (cError) throw cError;

  const catMap = new Map((categories || []).map(c => [c.id, c]));
  return (items || []).map(i => {
    const cat = i.category_id ? catMap.get(i.category_id) : null;
    const parent = cat?.parent_id ? catMap.get(cat.parent_id) : null;
    return {
      ...i,
      category_name: cat?.name ?? null,
      parent_category_id: cat?.parent_id ?? null,
      parent_category_name: parent?.name ?? null,
      category_label: categoryLabel(cat?.name, parent?.name),
    };
  });
}

export async function getInventoryStock(filters?: { warehouseId?: string; search?: string; categoryId?: string }) {
  const supabase = await createClient();
  let query = supabase.from('v_stock_on_hand').select('*').order('warehouse_name').order('item_name');

  if (filters?.warehouseId) {
    query = query.eq('warehouse_id', filters.warehouseId);
  }

  // Matches the sub-category directly, or all subs when a main category is chosen
  if (filters?.categoryId) {
    query = query.or(`category_id.eq.${filters.categoryId},parent_category_id.eq.${filters.categoryId}`);
  }

  // Push text search to DB — avoids fetching all rows then filtering in JS memory
  if (filters?.search) {
    query = query.or(`item_name.ilike.%${filters.search}%,item_code.ilike.%${filters.search}%`);
  }

  const { data: stock, error } = await query;
  if (error) throw error;

  return stock || [];
}


export async function getWarehousesWithValuation() {
  const supabase = await createClient();

  const [
    { data: warehouses, error: wError },
    { data: stockOnHand, error: sError },
    { data: movements, error: mError }
  ] = await Promise.all([
    supabase.from('warehouses').select('*, projects(name)').order('name'),
    supabase.from('v_stock_on_hand').select('*'),
    supabase.from('stock_movements').select('item_id, qty, unit_price').gt('qty', 0)
  ]);

  if (wError) throw wError;
  
  // Calculate average cost per item
  const itemAvgCost: Record<string, number> = {};
  if (movements) {
    const itemStats: Record<string, { totalQty: number, totalVal: number }> = {};
    for (const mov of movements) {
      if (!itemStats[mov.item_id]) itemStats[mov.item_id] = { totalQty: 0, totalVal: 0 };
      itemStats[mov.item_id].totalQty += Number(mov.qty || 0);
      itemStats[mov.item_id].totalVal += Number(mov.qty || 0) * Number(mov.unit_price || 0);
    }
    for (const itemId in itemStats) {
      const stats = itemStats[itemId];
      itemAvgCost[itemId] = stats.totalQty > 0 ? stats.totalVal / stats.totalQty : 0;
    }
  }

  // Calculate total value per warehouse + breakdown per main category
  const warehouseValues: Record<string, number> = {};
  const warehouseCategoryValues: Record<string, Record<string, number>> = {};
  if (stockOnHand) {
    for (const stock of stockOnHand) {
      const avgCost = itemAvgCost[stock.item_id] || 0;
      const val = Number(stock.qty_on_hand || 0) * avgCost;
      warehouseValues[stock.warehouse_id] = (warehouseValues[stock.warehouse_id] || 0) + val;

      const catName = stock.parent_category_name || stock.category_name || 'غير مصنف';
      if (!warehouseCategoryValues[stock.warehouse_id]) warehouseCategoryValues[stock.warehouse_id] = {};
      warehouseCategoryValues[stock.warehouse_id][catName] =
        (warehouseCategoryValues[stock.warehouse_id][catName] || 0) + val;
    }
  }

  return warehouses?.map(w => ({
    ...w,
    total_value: warehouseValues[w.id] || 0,
    category_breakdown: Object.entries(warehouseCategoryValues[w.id] || {})
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  })) || [];
}

export async function getWarehouseTransactions(warehouseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*, inventory_items(name, code, unit, item_categories(name)), employees(full_name)')
    .eq('warehouse_id', warehouseId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const movements = data || [];

  // Resolve reference_id → claim info for 'issue' movements
  const claimIds = [...new Set(
    movements
      .filter(m => m.movement_type === 'issue' && m.reference_id)
      .map(m => m.reference_id as string)
  )];

  if (claimIds.length > 0) {
    const { data: claims } = await supabase
      .from('claims')
      .select('id, claim_number, party_id, claim_type')
      .in('id', claimIds);

    // Build vendor name map
    const vendorIds = [...new Set((claims || []).filter(c => c.claim_type === 'vendor').map(c => c.party_id))];
    const { data: vendors } = vendorIds.length > 0
      ? await supabase.from('vendors').select('id, name').in('id', vendorIds)
      : { data: [] };
    const vendorMap = new Map((vendors || []).map(v => [v.id, v.name]));

    const claimMap = new Map((claims || []).map(c => ({
      ...c,
      party_name: vendorMap.get(c.party_id) ?? null
    })).map(c => [c.id, c]));

    return movements.map(m =>
      m.movement_type === 'issue' && m.reference_id && claimMap.has(m.reference_id)
        ? { ...m, claim: claimMap.get(m.reference_id) }
        : m
    );
  }

  return movements;
}

export async function getItemTransactions(itemId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*, warehouses(name, projects(name)), employees(full_name)')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  const movements = data || [];

  // Resolve reference_id → claim info for 'issue' movements
  const claimIds = [...new Set(
    movements
      .filter(m => m.movement_type === 'issue' && m.reference_id)
      .map(m => m.reference_id as string)
  )];

  if (claimIds.length > 0) {
    const { data: claims } = await supabase
      .from('claims')
      .select('id, claim_number, party_id, claim_type')
      .in('id', claimIds);

    const vendorIds = [...new Set((claims || []).filter(c => c.claim_type === 'vendor').map(c => c.party_id))];
    const { data: vendors } = vendorIds.length > 0
      ? await supabase.from('vendors').select('id, name').in('id', vendorIds)
      : { data: [] };
    const vendorMap = new Map((vendors || []).map(v => [v.id, v.name]));

    const claimMap = new Map((claims || []).map(c => ({
      ...c,
      party_name: vendorMap.get(c.party_id) ?? null
    })).map(c => [c.id, c]));

    return movements.map(m =>
      m.movement_type === 'issue' && m.reference_id && claimMap.has(m.reference_id)
        ? { ...m, claim: claimMap.get(m.reference_id) }
        : m
    );
  }

  return movements;
}

export async function getWarehouse(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('warehouses').select('*, projects(name)').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function getItem(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*, item_categories(id, name, parent_id)')
    .eq('id', id)
    .single();
  if (error) throw error;

  // Resolve the parent (main) category name for a full "main / sub" label
  let parentName: string | null = null;
  if (data?.item_categories?.parent_id) {
    const { data: parent } = await supabase
      .from('item_categories')
      .select('name')
      .eq('id', data.item_categories.parent_id)
      .single();
    parentName = parent?.name ?? null;
  }

  return {
    ...data,
    category_label: categoryLabel(data?.item_categories?.name, parentName),
  };
}
