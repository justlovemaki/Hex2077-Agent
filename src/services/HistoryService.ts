import { AIMessage, HistoryService } from '../core/base.js';

export class MemoryHistoryService implements HistoryService {
  private historyMap: Map<string, AIMessage[]> = new Map();
  private maxHistoryRounds: number = Number(process.env.CHAT_MAX_HISTORY_ROUNDS) || 30; // 保留轮数，优先使用环境变量 CHAT_MAX_HISTORY_ROUNDS

  constructor(maxHistoryRounds?: number) {
    if (maxHistoryRounds) {
      this.maxHistoryRounds = maxHistoryRounds;
    }
  }

  /**
   * 获取会话的历史消息
   * @param sessionId 会话标识 (如 channelId:userId)
   */
  getHistory(sessionId: string): AIMessage[] {
    return this.historyMap.get(sessionId) || [];
  }

  /**
   * 向会话历史添加新消息，并保持消息条数在限制范围内
   * @param sessionId 会话标识
   * @param message 新消息
   */
  pushMessage(sessionId: string, message: AIMessage) {
    const history = this.getHistory(sessionId);
    // 限制单条消息长度，防止注入或内存溢出
    if (message.content && message.content.length > 5000) {
      message.content = message.content.slice(0, 5000) + '... (内容已截断)';
    }
    history.push(message);
    
    // 如果超过限制，移除最早的消息 (每轮对话由 user 和 assistant 两部分组成，所以限制是 rounds * 2)
    const limit = this.maxHistoryRounds * 2;
    if (history.length > limit) {
      this.historyMap.set(sessionId, history.slice(-limit));
    } else {
      this.historyMap.set(sessionId, history);
    }
  }

  /**
   * 清除特定会话的历史消息
   * @param sessionId 会话标识
   */
  clearHistory(sessionId: string) {
    this.historyMap.delete(sessionId);
  }
}
