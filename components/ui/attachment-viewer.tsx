'use client';

import { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { getDownloadUrl } from '@/lib/actions/storage';

interface AttachmentViewerProps {
  attachments: { r2_key: string }[];
}

export function AttachmentViewer({ attachments }: AttachmentViewerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  if (!attachments || attachments.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  const openAttachment = async (r2_key: string) => {
    if (urls[r2_key]) {
      window.open(urls[r2_key], '_blank');
      return;
    }
    setLoading(prev => ({ ...prev, [r2_key]: true }));
    const { url, error } = await getDownloadUrl(r2_key);
    setLoading(prev => ({ ...prev, [r2_key]: false }));
    if (error || !url) {
      alert('فشل تحميل الملف');
      return;
    }
    setUrls(prev => ({ ...prev, [r2_key]: url }));
    window.open(url, '_blank');
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="text-[10px] font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 px-2 py-1 rounded-full whitespace-nowrap transition-colors"
      >
        عرض المرفقات ({attachments.length})
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 text-right" dir="rtl">
          <div className="bg-card w-full max-w-sm p-6 rounded-xl border shadow-lg relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-blue-500" />
                المرفقات
              </h3>
              <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <ul className="space-y-2">
              {attachments.map((att, i) => {
                const fileName = att.r2_key.split('/').pop() || `Attachment ${i+1}`;
                return (
                  <li key={i}>
                    <button
                      onClick={() => openAttachment(att.r2_key)}
                      disabled={loading[att.r2_key]}
                      className="w-full flex items-center gap-3 p-3 text-sm rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      <Paperclip className="w-4 h-4 text-muted-foreground" />
                      <span className="flex-1 text-right truncate" dir="ltr">{fileName}</span>
                      {loading[att.r2_key] && <span className="text-xs text-muted-foreground">جاري التحميل...</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
