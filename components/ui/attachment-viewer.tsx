'use client';

import { useState } from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import { getDownloadUrls } from '@/lib/actions/storage';
import { AttachmentGalleryOverlay, type GalleryItem } from '@/components/ui/image-lightbox';
import { isImageFile } from '@/lib/attachments';

interface AttachmentViewerProps {
  attachments: { r2_key: string }[];
}

export function AttachmentViewer({ attachments }: AttachmentViewerProps) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);

  if (!attachments || attachments.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  const openGallery = async () => {
    if (items) {
      setIndex(0);
      setOpen(true);
      return;
    }
    setLoading(true);
    const urls = await getDownloadUrls(attachments.map(a => a.r2_key));
    setLoading(false);
    const resolved = attachments
      .filter(a => urls[a.r2_key])
      .map(a => {
        const name = a.r2_key.split('/').pop() || a.r2_key;
        return { src: urls[a.r2_key], name, isImage: isImageFile(name) };
      });
    if (resolved.length === 0) {
      alert('فشل تحميل المرفقات');
      return;
    }
    setItems(resolved);
    setIndex(0);
    setOpen(true);
  };

  return (
    <>
      <button
        onClick={openGallery}
        disabled={loading}
        className="inline-flex items-center gap-1.5 text-[10px] font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 px-2 py-1 rounded-full whitespace-nowrap transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
        عرض المرفقات ({attachments.length})
      </button>

      <AttachmentGalleryOverlay
        items={items || []}
        index={index}
        onIndexChange={setIndex}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
