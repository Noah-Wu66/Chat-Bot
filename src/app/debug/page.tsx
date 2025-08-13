'use client';

import { useState } from 'react';

export default function DebugPage() {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [envStatus, setEnvStatus] = useState<any>(null);
  const [connectionStatus, setConnectionStatus] = useState<any>(null);

  // 拦截 console.log 来显示日志
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  console.log = (...args) => {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    setLogs(prev => [...prev.slice(-50), `[LOG] ${new Date().toLocaleTimeString()}: ${message}`]);
    originalConsoleLog(...args);
  };

  console.error = (...args) => {
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    setLogs(prev => [...prev.slice(-50), `[ERROR] ${new Date().toLocaleTimeString()}: ${message}`]);
    originalConsoleError(...args);
  };

  const testGPT5 = async () => {
    if (!input.trim()) return;
    
    setLoading(true);
    setResponse('');
    setLogs([]);
    
    try {
      console.log('🧪 [Debug] 开始测试 GPT-5');
      
      const requestBody = {
        input: input.trim(),
        model: 'gpt-5',
        settings: {
          reasoning: { effort: 'high' },
          text: { verbosity: 'medium' },
          maxTokens: 2000,
          stream: false
        },
        useTools: true
      };

      console.log('📋 [Debug] 请求参数:', requestBody);

      const response = await fetch('/api/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('📡 [Debug] 响应状态:', response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ [Debug] 请求失败:', errorData);
        throw new Error(errorData.error || '请求失败');
      }

      const data = await response.json();
      console.log('📥 [Debug] 响应数据:', data);

      setResponse(JSON.stringify(data, null, 2));
      
    } catch (error) {
      console.error('❌ [Debug] 测试失败:', error);
      setResponse(`错误: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const checkEnvironment = async () => {
    try {
      console.log('🔍 [Debug] 检查环境变量');
      const response = await fetch('/api/debug/env');
      const data = await response.json();
      setEnvStatus(data);
      console.log('✅ [Debug] 环境检查完成:', data);
    } catch (error) {
      console.error('❌ [Debug] 环境检查失败:', error);
      setEnvStatus({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  };

  const testConnection = async () => {
    try {
      console.log('🔗 [Debug] 测试 API 连接');
      const response = await fetch('/api/debug/test-connection');
      const data = await response.json();
      setConnectionStatus(data);
      console.log('✅ [Debug] 连接测试完成:', data);
    } catch (error) {
      console.error('❌ [Debug] 连接测试失败:', error);
      setConnectionStatus({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">GPT-5 调试页面</h1>

        {/* 状态检查区域 */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="p-4 bg-white rounded-lg shadow">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-semibold">环境变量检查</h3>
              <button
                onClick={checkEnvironment}
                className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
              >
                检查
              </button>
            </div>
            {envStatus && (
              <div className={`text-sm p-2 rounded ${envStatus.status === 'ok' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                <div>状态: {envStatus.status}</div>
                {envStatus.environment && (
                  <div className="mt-1">
                    <div>API Key: {envStatus.environment.hasApiKey ? '✅' : '❌'}</div>
                    <div>Base URL: {envStatus.environment.baseUrl}</div>
                  </div>
                )}
                {envStatus.error && <div>错误: {envStatus.error}</div>}
              </div>
            )}
          </div>

          <div className="p-4 bg-white rounded-lg shadow">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-lg font-semibold">API 连接测试</h3>
              <button
                onClick={testConnection}
                className="text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
              >
                测试
              </button>
            </div>
            {connectionStatus && (
              <div className={`text-sm p-2 rounded ${connectionStatus.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                <div>状态: {connectionStatus.status}</div>
                {connectionStatus.duration && <div>耗时: {connectionStatus.duration}ms</div>}
                {connectionStatus.response?.content && <div>响应: {connectionStatus.response.content}</div>}
                {connectionStatus.error && <div>错误: {connectionStatus.error.message}</div>}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 输入区域 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                测试输入
              </label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入要测试的内容..."
                className="w-full h-32 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            <button
              onClick={testGPT5}
              disabled={loading || !input.trim()}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '测试中...' : '测试 GPT-5'}
            </button>

            {/* 响应区域 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                响应结果
              </label>
              <pre className="w-full h-64 p-3 bg-gray-100 border border-gray-300 rounded-lg overflow-auto text-sm">
                {response || '等待响应...'}
              </pre>
            </div>
          </div>

          {/* 日志区域 */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="block text-sm font-medium text-gray-700">
                调试日志
              </label>
              <button
                onClick={clearLogs}
                className="text-sm bg-gray-500 text-white px-3 py-1 rounded hover:bg-gray-600"
              >
                清空日志
              </button>
            </div>
            
            <div className="h-96 p-3 bg-black text-green-400 rounded-lg overflow-auto text-xs font-mono">
              {logs.length === 0 ? (
                <div className="text-gray-500">等待日志输出...</div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="mb-1 whitespace-pre-wrap">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 说明 */}
        <div className="mt-8 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-lg font-semibold text-blue-900 mb-2">使用说明</h3>
          <ul className="text-blue-800 space-y-1">
            <li>• 在左侧输入框中输入要测试的内容</li>
            <li>• 点击"测试 GPT-5"按钮发送请求</li>
            <li>• 右侧会显示详细的调试日志，包括请求参数、响应状态等</li>
            <li>• 响应结果会显示在左下方的区域</li>
            <li>• 如果 GPT-5 没有返回内容，请查看日志中的错误信息</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
