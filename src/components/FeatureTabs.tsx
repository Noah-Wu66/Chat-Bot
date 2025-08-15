'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/utils/helpers';

interface Tab {
  id: string;
  label: string;
}

const TABS: Tab[] = [
  { id: 'text-image', label: '文生图' },
  { id: 'image-image', label: '图生图' },
  { id: 'text-video', label: '文生视频' },
  { id: 'image-video', label: '图生视频' },
  { id: 'frame-video', label: '首尾帧视频' },
];

export default function FeatureTabs() {
  const [active, setActive] = useState<string>(TABS[0].id);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const updateIndicator = useCallback(() => {
    const current = tabRefs.current[active];
    const indicator = indicatorRef.current;
    if (current && indicator && current.parentElement) {
      const rect = current.getBoundingClientRect();
      const parentRect = current.parentElement.getBoundingClientRect();
      indicator.style.width = `${rect.width}px`;
      indicator.style.transform = `translateX(${rect.left - parentRect.left}px)`;
    }
  }, [active]);

  useEffect(() => {
    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  return (
    <div className="relative flex w-full overflow-x-auto rounded-lg bg-muted p-1">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => {
            tabRefs.current[tab.id] = el;
          }}
          onClick={() => setActive(tab.id)}
          className={cn(
            'relative z-10 flex-1 whitespace-nowrap px-4 py-2 text-sm transition-colors',
            active === tab.id ? 'text-foreground' : 'text-muted-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
      <div
        ref={indicatorRef}
        className="absolute z-0 h-full rounded-md bg-foreground transition-all"
      />
    </div>
  );
}

