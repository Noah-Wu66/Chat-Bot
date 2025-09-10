import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  Conversation, 
  Message, 
  ModelId, 
  ConversationSettings,
  MODELS,
  getModelConfig,
} from '@/lib/types';

interface ChatState {
  // 当前对话
  currentConversation: Conversation | null;
  
  // 对话列表
  conversations: Conversation[];
  
  // 当前选择的模型
  currentModel: ModelId;
  
  // 对话设置
  settings: ConversationSettings;
  
  // UI 状态
  isLoading: boolean;
  isStreaming: boolean;
  sidebarOpen: boolean;
  userPanelOpen: boolean;
  loginOpen: boolean;
  
  // 联网搜索开关
  webSearchEnabled: boolean;

  // 错误状态
  error: string | null;

  // 预填输入区的图片（用于“将图变视频”等跨组件操作）
  presetInputImages: string[];

  // Actions
  setCurrentConversation: (conversation: Conversation | null) => void;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  deleteConversation: (id: string) => void;

  setCurrentModel: (model: ModelId) => void;
  setSettings: (settings: Partial<ConversationSettings>) => void;

  setLoading: (loading: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setUserPanelOpen: (open: boolean) => void;
  setLoginOpen: (open: boolean) => void;
  setError: (error: string | null) => void;
  setWebSearchEnabled: (enabled: boolean) => void;

  // 预填图片操作
  setPresetInputImages: (images: string[]) => void;

  // 消息操作
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  truncateMessagesBefore: (messageId: string) => void;

  // 重置状态
  reset: () => void;
}

const defaultSettings: ConversationSettings = {
  temperature: 0.8,
  maxTokens: 4096,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  text: {
    verbosity: 'medium',
  },
  reasoning: {
    effort: 'low',
  },
  web: {
    size: 10,
  },
  stream: true,
  sound: {
    onComplete: true,
  },
  veo3: {
    aspectRatio: '16:9',
    duration: '8s',
    resolution: '720p',
    generateAudio: false,
    enhancePrompt: true,
    autoFix: true,
  },
  seedream: {
    aspectRatio: '1:1',
    size: '2K',
    sequentialImageGeneration: 'auto',
    maxImages: 1,
    responseFormat: 'b64_json',
    watermark: false,
  },
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // 初始状态
      currentConversation: null,
      conversations: [],
      currentModel: 'gpt-5',
      settings: defaultSettings,
      isLoading: false,
      isStreaming: false,
      sidebarOpen: false,
      userPanelOpen: false,
      loginOpen: false,
      webSearchEnabled: false,
      error: null,
      presetInputImages: [],

      // Actions
      setCurrentConversation: (conversation) => {
        set({ currentConversation: conversation });
      },

      setConversations: (conversations) => {
        set({ conversations });
      },

      addConversation: (conversation) => {
        set((state) => ({
          conversations: [conversation, ...state.conversations],
        }));
      },

      updateConversation: (id, updates) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === id ? { ...conv, ...updates } : conv
          ),
          currentConversation:
            state.currentConversation?.id === id
              ? { ...state.currentConversation, ...updates }
              : state.currentConversation,
        }));
      },

      deleteConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.filter((conv) => conv.id !== id),
          currentConversation:
            state.currentConversation?.id === id
              ? null
              : state.currentConversation,
        }));
      },

      setCurrentModel: (model) => {
        set({ currentModel: model });
        
        // 根据模型类型调整默认设置
        const modelConfig = getModelConfig(model);
        const newSettings = { ...get().settings };
        
        // 依据模型能力启用/禁用 temperature
        if (modelConfig.supportsTemperature === false) {
          delete newSettings.temperature;
        } else if (typeof newSettings.temperature !== 'number') {
          newSettings.temperature = 0.8;
        }
        // 确保 Veo3 默认值存在（向后兼容旧持久化）
        if (!newSettings.veo3) {
          newSettings.veo3 = {
            aspectRatio: '16:9',
            duration: '8s',
            resolution: '720p',
            generateAudio: false,
            enhancePrompt: true,
            autoFix: true,
          };
        }
        // 确保 Seedream 默认值存在（向后兼容旧持久化）
        if (!newSettings.seedream) {
          newSettings.seedream = {
            aspectRatio: '1:1',
            size: '2K',
            sequentialImageGeneration: 'auto',
            maxImages: 1,
            responseFormat: 'b64_json',
            watermark: false,
          };
        }
        
        set({ settings: newSettings });
      },

      setSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setStreaming: (streaming) => {
        set({ isStreaming: streaming });
      },

      setSidebarOpen: (open) => {
        set({ sidebarOpen: open });
      },

      

      setUserPanelOpen: (open) => {
        set({ userPanelOpen: open });
      },

      setLoginOpen: (open) => {
        set({ loginOpen: open });
      },

      setError: (error) => {
        set({ error });
      },

      setWebSearchEnabled: (enabled) => {
        set({ webSearchEnabled: enabled });
      },

      setPresetInputImages: (images) => {
        set({ presetInputImages: Array.isArray(images) ? images : [] });
      },

      addMessage: (message) => {
        set((state) => {
          if (!state.currentConversation) return state;
          
          const updatedConversation = {
            ...state.currentConversation,
            messages: [...state.currentConversation.messages, message],
            updatedAt: new Date(),
          };
          
          return {
            currentConversation: updatedConversation,
            conversations: state.conversations.map((conv) =>
              conv.id === updatedConversation.id ? updatedConversation : conv
            ),
          };
        });
      },

      updateMessage: (messageId, updates) => {
        set((state) => {
          if (!state.currentConversation) return state;
          
          const updatedConversation = {
            ...state.currentConversation,
            messages: state.currentConversation.messages.map((msg) =>
              msg.id === messageId ? { ...msg, ...updates } : msg
            ),
            updatedAt: new Date(),
          };
          
          return {
            currentConversation: updatedConversation,
            conversations: state.conversations.map((conv) =>
              conv.id === updatedConversation.id ? updatedConversation : conv
            ),
          };
        });
      },

      truncateMessagesBefore: (messageId) => {
        set((state) => {
          if (!state.currentConversation) return state;
          const idx = state.currentConversation.messages.findIndex((m) => m.id === messageId);
          if (idx === -1) return state;
          const truncated = {
            ...state.currentConversation,
            messages: state.currentConversation.messages.slice(0, idx),
            updatedAt: new Date(),
          };
          return {
            currentConversation: truncated,
            conversations: state.conversations.map((c) => c.id === truncated.id ? truncated : c),
          };
        });
      },

      reset: () => {
        set({
          currentConversation: null,
          conversations: [],
          currentModel: 'gpt-5',
          settings: defaultSettings,
          isLoading: false,
          isStreaming: false,
          sidebarOpen: true,
          userPanelOpen: false,
          loginOpen: false,
          webSearchEnabled: false,
          error: null,
        });
      },
    }),
    {
      name: 'chat-store',
      partialize: (state) => ({
        currentModel: state.currentModel,
        settings: state.settings,
        sidebarOpen: state.sidebarOpen,
        webSearchEnabled: state.webSearchEnabled,
      }),
    }
  )
);
