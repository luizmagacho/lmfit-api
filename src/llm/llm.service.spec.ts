import axios from 'axios';
import { LlmService } from './llm.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('LlmService.transcribeAudio (Loop 12-A)', () => {
  const config: any = { get: jest.fn() };
  const service = new LlmService(config);

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) => {
      if (key === 'LLM_API_KEY') return 'test-key';
      if (key === 'LLM_PROVIDER') return 'groq';
      return undefined;
    });
  });

  it('posts multipart form data to the Groq transcription endpoint with the audio, model and pt language', async () => {
    mockedAxios.post.mockResolvedValue({ data: { text: 'Vendi uma camisa preta tamanho M por 100 reais.' } });

    const text = await service.transcribeAudio(Buffer.from('fake-audio-bytes'), 'audio/ogg');

    expect(text).toBe('Vendi uma camisa preta tamanho M por 100 reais.');
    const [url, body, opts] = mockedAxios.post.mock.calls.at(-1)!;
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(body).toBeInstanceOf(FormData);
    expect((opts as any).headers.Authorization).toBe('Bearer test-key');
  });

  it('gives the uploaded file a real extension — Groq classifies by filename, not Content-Type (regression)', async () => {
    mockedAxios.post.mockResolvedValue({ data: { text: 'ok' } });

    await service.transcribeAudio(Buffer.from('x'), 'audio/ogg; codecs=opus');

    const [, body] = mockedAxios.post.mock.calls.at(-1)!;
    const file = (body as FormData).get('file') as File;
    expect(file.name).toBe('audio.ogg');
  });

  it('uses LLM_TRANSCRIPTION_MODEL when configured, whisper-large-v3-turbo by default', async () => {
    mockedAxios.post.mockResolvedValue({ data: { text: 'ok' } });
    config.get.mockImplementation((key: string) => {
      if (key === 'LLM_API_KEY') return 'test-key';
      if (key === 'LLM_TRANSCRIPTION_MODEL') return 'whisper-large-v3';
      return undefined;
    });

    await service.transcribeAudio(Buffer.from('x'), 'audio/ogg');

    const [, body] = mockedAxios.post.mock.calls.at(-1)!;
    expect((body as FormData).get('model')).toBe('whisper-large-v3');
  });

  it('throws when LLM_API_KEY is not configured', async () => {
    config.get.mockReturnValue(undefined);

    await expect(service.transcribeAudio(Buffer.from('x'), 'audio/ogg')).rejects.toThrow('LLM_API_KEY not configured');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('throws when the provider returns no text', async () => {
    mockedAxios.post.mockResolvedValue({ data: {} });

    await expect(service.transcribeAudio(Buffer.from('x'), 'audio/ogg')).rejects.toThrow('Empty transcription response');
  });
});
