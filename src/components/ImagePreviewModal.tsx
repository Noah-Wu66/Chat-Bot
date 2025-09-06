'use client';

import React from 'react';
import { X, Download, ExternalLink } from 'lucide-react';

export default function ImagePreviewModal({
  src,
  onClose,
  filename = 'image.png',
}: {
  src: string;
  onClose: () => void;
  filename?: string;
}) {
  // 阻止背景滚动
  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4">
      <div className="relative max-h-[95vh] sm:max-h-[92vh] w-auto max-w-[95vw] sm:max-w-[92vw] overflow-hidden rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-3 sm:px-4 py-2">
          <div className="text-sm font-medium">图片预览</div>
          <div className="flex items-center gap-1 sm:gap-2">
            <a
              href={src}
              download={filename}
              className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground touch-manipulation"
            >
              <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">下载</span>
            </a>
            <a
              href={src}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground touch-manipulation"
            >
              <span className="hidden sm:inline">新窗口</span> <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              className="rounded p-1 hover:bg-accent touch-manipulation"
              onClick={onClose}
              aria-label="close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="max-h-[85vh] sm:max-h-[86vh] w-full overflow-auto p-1 sm:p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="预览" className="mx-auto h-auto max-h-[80vh] w-auto max-w-[90vw] sm:max-w-[88vw] object-contain" />
        </div>
      </div>
    </div>
  );
}


