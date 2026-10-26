import type { AIProvider } from './index.js';

export class AnthropicProvider implements AIProvider {
  private client: import('@anthropic-ai/sdk').default | null = null;

  available(): boolean {
    return !!process.env['ANTHROPIC_API_KEY'];
  }

  private async getClient(): Promise<import('@anthropic-ai/sdk').default> {
    if (this.client) return this.client;
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    this.client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });
    return this.client;
  }

  async describeImage(imageBuffer: Buffer, context: string): Promise<string> {
    const client = await this.getClient();
    const base64 = imageBuffer.toString('base64');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64 },
          },
          {
            type: 'text',
            text: `Write a concise, descriptive alt text for this image. Context: ${context}. Return only the alt text string, no quotes, no explanation.`,
          },
        ],
      }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
    return block.text.trim();
  }

  async suggestAltText(context: string): Promise<string> {
    const client = await this.getClient();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Write concise, descriptive alt text for an image based on the surrounding code and context. Context: ${context}. Return only the alt text string, no quotes, no explanation.`,
      }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
    return block.text.trim();
  }

  async rewriteLinkText(current: string, context: string): Promise<string> {
    const client = await this.getClient();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Rewrite this link text to be descriptive for screen reader users. Current text: "${current}". Context: ${context}. Return only the new link text, no quotes, no explanation.`,
      }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
    return block.text.trim();
  }

  async suggestAccessibleName(element: string, context: string): Promise<string> {
    const client = await this.getClient();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: `Write a short, descriptive accessible name (for an aria-label) for this UI control, so screen reader users understand its purpose. Element: ${element}. Context: ${context}. Return only the accessible name, no quotes, no explanation.`,
      }],
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
    return block.text.trim();
  }
}
