'use client';

import { ExternalLink, Info } from 'lucide-react';
import { cn } from '@/utils/helpers';

type SourceItem = {
  title: string;
  link: string;
  domain?: string;
  favicon?: string;
  position?: number;
  summary?: string;
};

export default function SearchSourcesBar({ sources, onOpen }: { sources: SourceItem[]; onOpen: () => void }) {
  const items = Array.isArray(sources) ? sources.slice(0, 8) : [];

  return (
    <div className={cn('flex items-center justify-between rounded-xl border bg-card/60 px-3 py-2 text-xs text-muted-foreground')}>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <Info className="h-3.5 w-3.5" /> 数据来源
        </span>
        <div className="flex items-center gap-1.5">
          {items.map((s, idx) => (
            <span
              key={String(s.link || idx)}
              className="inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-muted ring-1 ring-border"
              title={s.title || s.domain || s.link}
            >
              {s.favicon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.favicon} alt={s.domain || 'icon'} className="h-6 w-6" />
              ) : (
                <span className="text-[10px] font-semibold uppercase">
                  {(s.domain || 'web').slice(0, 2)}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground"
        onClick={onOpen}
      >
        查看来源 <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}


