import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// 合并 Tailwind CSS 类名
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 格式化时间（兼容字符串/Date）
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) {
    return '刚刚';
  } else if (minutes < 60) {
    return `${minutes}分钟前`;
  } else if (hours < 24) {
    return `${hours}小时前`;
  } else if (days < 7) {
    return `${days}天前`;
  } else {
    return d.toLocaleDateString('zh-CN');
  }
}

// 格式化相对时间（兼容字符串/Date）
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const messageDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (messageDate.getTime() === today.getTime()) {
    return '今天';
  } else if (messageDate.getTime() === yesterday.getTime()) {
    return '昨天';
  } else {
    return d.toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
    });
  }
}

// 生成随机 ID
export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// 截断文本
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

// 从消息内容生成标题
export function generateTitleFromMessage(content: string): string {
  // 移除 Markdown 格式
  const cleanContent = content
    .replace(/[#*`_~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();

  if (!cleanContent) return '新对话';

  // 取前 10 个“字符”（兼容 emoji/中文等多字节）
  const chars = Array.from(cleanContent);
  const limit = 10;
  const head = chars.slice(0, limit).join('');
  return chars.length > limit ? head + '...' : head;
}

// 验证图片 URL
export function isValidImageUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch {
    return false;
  }
}

// 将文件转换为 base64
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = error => reject(error);
  });
}

// 压缩图片
export function compressImage(file: File, maxWidth = 1024, quality = 0.8): Promise<File> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      // 计算新尺寸
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // 绘制压缩后的图片
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob(
        (blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        },
        file.type,
        quality
      );
    };
    
    img.src = URL.createObjectURL(file);
  });
}

// 更智能的图片压缩：控制尺寸与体积，优先保证请求体不过大
export async function compressImageSmart(
  file: File,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    maxBytes?: number;
    initialQuality?: number;
    mimeType?: 'image/jpeg' | 'image/webp';
  }
): Promise<File> {
  const maxWidth = typeof options?.maxWidth === 'number' ? options!.maxWidth! : 1280;
  const maxHeight = typeof options?.maxHeight === 'number' ? options!.maxHeight! : 1280;
  const maxBytes = typeof options?.maxBytes === 'number' ? options!.maxBytes! : 1024 * 1024; // 1MB 默认
  let quality = typeof options?.initialQuality === 'number' ? options!.initialQuality! : 0.75;
  const mimeType: 'image/jpeg' | 'image/webp' = options?.mimeType || 'image/jpeg';

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = (e) => reject(e);
    i.src = URL.createObjectURL(file);
  });

  const drawAndExport = (w: number, h: number, q: number): Promise<Blob> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      // 背景填充，避免 PNG 透明转 JPEG 出现黑底
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob || new Blob()), mimeType, Math.min(Math.max(q, 0.3), 0.95));
    });
  };

  const scaleToFit = (w: number, h: number) => {
    const wr = maxWidth / w;
    const hr = maxHeight / h;
    const r = Math.min(1, wr, hr);
    return { w: Math.round(w * r), h: Math.round(h * r) };
  };

  let { w, h } = (() => {
    const s = scaleToFit(img.naturalWidth || img.width, img.naturalHeight || img.height);
    return { w: s.w, h: s.h };
  })();

  // 迭代压缩，优先降低质量，再按需缩小分辨率
  let attempt = 0;
  let blob = await drawAndExport(w, h, quality);
  while (blob.size > maxBytes && attempt < 8) {
    attempt += 1;
    if (quality > 0.5) {
      quality = Math.max(0.5, quality - 0.12);
    } else {
      w = Math.max(480, Math.floor(w * 0.85));
      h = Math.max(480, Math.floor(h * 0.85));
    }
    blob = await drawAndExport(w, h, quality);
  }

  // 若仍超过，做最后一次强力压缩
  if (blob.size > maxBytes) {
    const forceQ = Math.max(0.4, quality - 0.15);
    const fw = Math.max(400, Math.floor(w * 0.85));
    const fh = Math.max(400, Math.floor(h * 0.85));
    blob = await drawAndExport(fw, fh, forceQ);
  }

  const nameBase = file.name.replace(/\.[^.]+$/, '') || 'image';
  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
  const out = new File([blob], `${nameBase}.${ext}`, { type: mimeType, lastModified: Date.now() });
  try { URL.revokeObjectURL(img.src); } catch {}
  return out;
}

// 检查是否为移动设备
export function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768;
}

// 复制文本到剪贴板
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      // 降级方案
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const result = document.execCommand('copy');
      textArea.remove();
      return result;
    }
  } catch (error) {
    // 复制失败静默处理以避免噪声
    return false;
  }
}

// 下载文本为文件
export function downloadAsFile(content: string, filename: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// 模型完成提示音：柔和的双音提示
export async function playCompletionChime(): Promise<void> {
  try {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
    }

    const now = ctx.currentTime;

    const playTone = (frequency: number, start: number, duration: number, type: OscillatorType = 'sine') => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.08, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    };

    // 两个快速上扬的音符，营造灵动感
    playTone(880, 0, 0.12, 'sine');
    playTone(1320, 0.12, 0.14, 'triangle');

    // 结束后自动关闭以释放资源
    setTimeout(() => { try { ctx.close(); } catch {} }, 500);
  } catch {}
}

// 防抖函数
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// 节流函数
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

