import React from 'react';
import { ChatPanel } from './ChatPanel';

export default function TestChatPage() {
  return (
    <div className="flex h-full w-full bg-gray-950">
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-none border-b border-gray-800 bg-gray-900 px-6 py-4">
          <div className="text-lg font-semibold text-gray-100">对话测试页</div>
          <div className="mt-1 text-sm text-gray-400">
            这里不依赖流程节点。选择模型后直接发送文本/图片，确认接口可用性。
          </div>
          <div className="mt-2 text-xs text-gray-500">
            Gemini/Claude 的对话ID会按文档生成：<span className="text-gray-300 font-mono">USER_ID_任意String</span>，其中任意String 前缀使用左侧“本地用户前缀”。
            发送后会把 chatId 记录到左侧列表，并可通过 <span className="text-gray-300 font-mono">/api/v1/llm/list</span> 拉取历史。
          </div>
        </div>

        <div className="flex-1 min-h-0 select-text">
          <ChatPanel
            selectedNode={undefined}
            selectedNodes={[]}
            updateSelectedNodesData={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

