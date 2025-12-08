import type { BytemdPlugin } from '@t-agent/bytemd'
import remarkGemoji from 'remark-gemoji'

export default function gemoji(): BytemdPlugin {
  return {
    remark: (processor) => processor.use(remarkGemoji),
  }
}
