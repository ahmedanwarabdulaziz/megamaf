import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase.from('app_settings').select('*');

  const currenciesSetting = settings?.find(s => s.key === 'currencies');
  const currencies: string[] = currenciesSetting ? currenciesSetting.value : ['EGP'];

  return (
    <div className="space-y-6 p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">الإعدادات</h1>
      
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>العملات المدعومة</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside space-y-2">
              {currencies.map((c, i) => (
                <li key={i} className="text-sm font-medium">{c}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-4">
              إضافة العملات سيتم توفيرها في تحديث لاحق.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
