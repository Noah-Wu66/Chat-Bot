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
  setError: (error: string | null) => void;
  
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
  reasoning: {
    effort: 'medium',
  },
  text: {
    verbosity: 'medium',
  },
  webSearch: false,
  stream: true,
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // 初始状态
      currentConversation: null,
      conversations: [],
      currentModel: 'gpt-4o',
      settings: defaultSettings,
      isLoading: false,
      isStreaming: false,
      sidebarOpen: true,
      settingsOpen: false,
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

      setError: (error) => {
        set({ error });
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

      reset: () => {
        set({
          currentConversation: null,
          conversations: [],
          currentModel: 'gpt-4o',
          settings: defaultSettings,
          isLoading: false,
          isStreaming: false,
          sidebarOpen: true,
          settingsOpen: false,
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
      }),
    }
  )
);
