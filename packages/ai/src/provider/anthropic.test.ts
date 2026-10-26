import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './anthropic.js';

// Mock the SDK so the API-calling methods are exercised without any network.
const h = vi.hoisted(() => ({ create: vi.fn(), ctor: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.create };
    constructor(opts: unknown) {
      h.ctor(opts);
    }
  },
}));

const textResponse = (text: string) => ({ content: [{ type: 'text', text }] });

describe('AnthropicProvider', () => {
  it('available() returns false when ANTHROPIC_API_KEY is absent', () => {
    const original = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];

    const provider = new AnthropicProvider();
    expect(provider.available()).toBe(false);

    if (original !== undefined) process.env['ANTHROPIC_API_KEY'] = original;
  });

  it('available() returns true when ANTHROPIC_API_KEY is set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';

    const provider = new AnthropicProvider();
    expect(provider.available()).toBe(true);

    delete process.env['ANTHROPIC_API_KEY'];
  });

  describe('API methods (SDK mocked)', () => {
    let savedKey: string | undefined;

    beforeEach(() => {
      savedKey = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'test-key';
      h.create.mockReset();
      h.ctor.mockReset();
    });

    afterEach(() => {
      if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey;
      else delete process.env['ANTHROPIC_API_KEY'];
    });

    it('describeImage sends the image as base64 and returns trimmed text', async () => {
      h.create.mockResolvedValue(textResponse('  A red dial  '));
      const provider = new AnthropicProvider();

      const alt = await provider.describeImage(Buffer.from('PNGDATA'), 'a thermostat');

      expect(alt).toBe('A red dial');
      const req = h.create.mock.calls[0][0];
      const imageBlock = req.messages[0].content.find((b: { type: string }) => b.type === 'image');
      expect(imageBlock.source.data).toBe(Buffer.from('PNGDATA').toString('base64'));
    });

    it('suggestAltText returns trimmed text', async () => {
      h.create.mockResolvedValue(textResponse(' Company logo '));
      const provider = new AnthropicProvider();
      expect(await provider.suggestAltText('header')).toBe('Company logo');
    });

    it('rewriteLinkText returns trimmed text', async () => {
      h.create.mockResolvedValue(textResponse(' View pricing details '));
      const provider = new AnthropicProvider();
      expect(await provider.rewriteLinkText('click here', 'pricing page')).toBe('View pricing details');
    });

    it('suggestAccessibleName returns trimmed text', async () => {
      h.create.mockResolvedValue(textResponse(' Close dialog '));
      const provider = new AnthropicProvider();
      expect(await provider.suggestAccessibleName('<button>', 'modal')).toBe('Close dialog');
    });

    it('throws when the response block is not text', async () => {
      h.create.mockResolvedValue({ content: [{ type: 'tool_use' }] });
      const provider = new AnthropicProvider();
      await expect(provider.suggestAltText('x')).rejects.toThrow('Unexpected response type');
    });

    it('reuses a single client across calls', async () => {
      h.create.mockResolvedValue(textResponse('ok'));
      const provider = new AnthropicProvider();

      await provider.suggestAltText('a');
      await provider.suggestAltText('b');

      // getClient() caches, so the SDK is constructed exactly once.
      expect(h.ctor).toHaveBeenCalledTimes(1);
    });
  });
});
