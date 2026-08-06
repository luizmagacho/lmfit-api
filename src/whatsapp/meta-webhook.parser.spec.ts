import { extractInboundMessages } from './meta-webhook.parser';

function makePayload(message: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [message] } }] }],
  };
}

describe('extractInboundMessages', () => {
  it('extracts textBody for a text message (unchanged behavior)', () => {
    const out = extractInboundMessages(
      makePayload({ id: 'wamid.1', from: '5511999998888', type: 'text', text: { body: 'oi' } }),
    );
    expect(out).toEqual([{ wamid: 'wamid.1', fromWaId: '5511999998888', type: 'text', textBody: 'oi', audioMediaId: undefined, audioMimeType: undefined }]);
  });

  it('extracts audioMediaId/audioMimeType for an audio message (Loop 12-A)', () => {
    const out = extractInboundMessages(
      makePayload({
        id: 'wamid.2',
        from: '5511999998888',
        type: 'audio',
        audio: { id: 'media-abc', mime_type: 'audio/ogg; codecs=opus' },
      }),
    );
    expect(out).toEqual([
      {
        wamid: 'wamid.2',
        fromWaId: '5511999998888',
        type: 'audio',
        textBody: undefined,
        audioMediaId: 'media-abc',
        audioMimeType: 'audio/ogg; codecs=opus',
      },
    ]);
  });

  it('returns an empty audio fields for a text message with no audio object', () => {
    const out = extractInboundMessages(
      makePayload({ id: 'wamid.3', from: '5511999998888', type: 'text', text: { body: 'oi' } }),
    );
    expect(out[0].audioMediaId).toBeUndefined();
  });
});
