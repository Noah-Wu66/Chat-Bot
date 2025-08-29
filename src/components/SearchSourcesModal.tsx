'use client';

import { X, ExternalLink } from 'lucide-react';
import { cn } from '@/utils/helpers';

type SourceItem = {
  title: string;
  link: string;
  domain?: string;
  favicon?: string;
  position?: number;
  summary?: string;
};

export default function SearchSourcesModal({ sources, onClose }: { sources: SourceItem[]; onClose: () => void }) {
  const items = Array.isArray(sources) ? sources : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-medium">本次回答使用的来源</div>
          <button type="button" className="rounded p-1 hover:bg-accent" onClick={onClose} aria-label="close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="text-sm text-muted-foreground">没有可展示的来源。</div>
          ) : (
            <ul className="space-y-3">
              {items.map((s, idx) => (
                <li key={String(s.link || idx)} className="rounded-lg border p-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded bg-muted ring-1 ring-border">
                      {s.favicon ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.favicon} alt={s.domain || 'icon'} className="h-6 w-6" />
                      ) : (
                        <span className="text-[10px] font-semibold uppercase">
                          {(s.domain || 'web').slice(0, 2)}
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {typeof s.position === 'number' ? `#${s.position} ` : ''}
                        {s.title || '未命名页面'}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{s.link}</div>
                      {s.summary && (
                        <div className="mt-2 text-xs leading-5 text-muted-foreground">{s.summary}</div>
                      )}
                    </div>
                    <a
                      className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground"
                      href={s.link}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      打开 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-3 text-right">
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}


