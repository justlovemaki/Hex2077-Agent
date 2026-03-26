import { createRequire } from 'module';
import mammoth from 'mammoth';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

export class DocumentProcessor {
  async parse(fileName: string, buffer: Buffer): Promise<string> {
    const ext = fileName.split('.').pop()?.toLowerCase();
    
    try {
      if (ext === 'pdf') {
        const data = await pdf(buffer);
        return data.text;
      } 
      
      if (ext === 'docx' || ext === 'doc') {
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }

      if (['txt', 'md', 'markdown'].includes(ext || '')) {
        return buffer.toString('utf8');
      }

      throw new Error(`不支持的文件类型: ${ext}`);
    } catch (err: any) {
      throw new Error(`文件解析失败: ${err.message}`);
    }
  }

  /**
   * 将长文本切分为块
   */
  chunk(text: string, chunkSize: number = 2000, overlap: number = 300): string[] {
    const chunks: string[] = [];
    if (!text) return chunks;

    const cleanText = text.replace(/\n\s*\n/g, '\n\n').trim();
    let start = 0;
    
    while (start < cleanText.length) {
      let end = start + chunkSize;
      
      // 尽量在段落边界处切割
      if (end < cleanText.length) {
        const nextNewline = cleanText.lastIndexOf('\n', end);
        if (nextNewline > start + chunkSize * 0.7) {
          end = nextNewline;
        }
      }

      chunks.push(cleanText.slice(start, end).trim());
      start = end - overlap;
      if (start >= cleanText.length) break;
      if (start < 0) start = 0;
    }
    return chunks;
  }
}
