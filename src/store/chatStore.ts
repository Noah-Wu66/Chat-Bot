import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  Conversation, 
  Message, 
  ModelId, 
  ConversationSettings,
  MODELS 
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
  settingsOpen: boolean;
  userPanelOpen: boolean;
  loginOpen: boolean;
  
  // 联网搜索开关
  webSearchEnabled: boolean;

  // 错误状态
  error: string | null;

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
  setSettingsOpen: (open: boolean) => void;
  setUserPanelOpen: (open: boolean) => void;
  setLoginOpen: (open: boolean) => void;
  setError: (error: string | null) => void;
  setWebSearchEnabled: (enabled: boolean) => void;

  // 消息操作
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;

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
      settingsOpen: false,
      userPanelOpen: false,
      loginOpen: false,
      webSearchEnabled: true,
      error: null,

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
        const modelConfig = MODELS[model];
        const newSettings = { ...get().settings };
        
        // GPT-5 默认不支持 temperature
        if (modelConfig.supportsTemperature === false) {
          delete newSettings.temperature;
        } else if (!newSettings.temperature) {
          newSettings.temperature = 0.8;
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

      setSettingsOpen: (open) => {
        set({ settingsOpen: open });
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

      addMessage: (message) => {
        set((state) => {
          if (!state.currentConversation) return state;
          
          const updatedConversation = {
            ...state.currentConversation,
            messages: [...state.currentConversation.messages, message],
            updatedAt: new Date(),
          };
          try {
            // eslint-disable-next-line no-console
            console.log('[ChatStore] addMessage', { convId: updatedConversation.id, role: message.role, len: message.content?.length || 0, total: updatedConversation.messages.length });
          } catch {}
          
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
          try {
            // eslint-disable-next-line no-console
            console.log('[ChatStore] updateMessage', { convId: updatedConversation.id, messageId });
          } catch {}
          
          return {
            currentConversation: updatedConversation,
            conversations: state.conversations.map((conv) =>
              conv.id === updatedConversation.id ? updatedConversation : conv
            ),
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
          settingsOpen: false,
          userPanelOpen: false,
          loginOpen: false,
          webSearchEnabled: true,
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
