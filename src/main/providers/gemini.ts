import type {
  ModelInfo,
  Result,
  SummarizeRequest,
  SummarizeResponse,
  TranscribeRequest,
  TranscribeResponse,
  TranscribeTranslateResponse,
  TranslateRequest,
  TranslateResponse
} from '@shared/types'
import { detectLanguage } from '@shared/lang'
import {
  annotateModel,
  buildMinutesPrompt,
  buildTranslationPrompt,
  fail,
  httpJson,
  minutesParseError,
  parseMinutesContent,
  Provider,
  ProviderContext,
  STT_PROMPT_AUTO,
  STT_PROMPT_EN
} from './base'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  promptFeedback?: { blockReason?: string }
}

function extractText(body: GenerateContentResponse): string {
  const parts = body.candidates?.[0]?.content?.parts ?? []
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim()
}

function url(model: string, key: string): string {
  // 키를 쿼리스트링에 넣지 않기 위해 헤더(x-goog-api-key)를 사용한다.
  void key
  return `${BASE}/${encodeURIComponent(model)}:generateContent`
}

export const geminiProvider: Provider = {
  id: 'gemini',
  supportsStt: true,

  async transcribe(
    req: TranscribeRequest,
    ctx: ProviderContext
  ): Promise<Result<TranscribeResponse>> {
    const model = ctx.settings.providerConfig.gemini.sttModel
    const audioBase64 = Buffer.from(req.wav).toString('base64')
    const instruction = req.languageHint === 'en' ? STT_PROMPT_EN : STT_PROMPT_AUTO

    const res = await httpJson(url(model, ctx.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `${instruction}\nOutput ONLY the transcript text with no labels, quotes, or commentary. If there is no intelligible speech, output exactly: [NO_SPEECH]`
              },
              { inline_data: { mime_type: 'audio/wav', data: audioBase64 } }
            ]
          }
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 }
      })
    })
    if (!res.ok) return annotateModel(res, model)

    const body = res.value.json as GenerateContentResponse
    if (body.promptFeedback?.blockReason) {
      return {
        ok: false,
        error: fail('BAD_REQUEST', `Gemini가 요청을 차단했습니다. (${body.promptFeedback.blockReason})`)
      }
    }

    const transcript = extractText(body)
    if (!transcript || transcript.includes('[NO_SPEECH]')) {
      return { ok: false, error: fail('EMPTY', '인식된 음성이 없습니다.') }
    }

    const detected = detectLanguage(transcript)
    return {
      ok: true,
      value: {
        text: transcript,
        detectedLanguage: detected.language,
        languageConfidence: detected.confidence,
        usage: {
          audioSeconds: req.durationMs / 1000,
          inputTokens: body.usageMetadata?.promptTokenCount,
          outputTokens: body.usageMetadata?.candidatesTokenCount
        }
      }
    }
  },

  /**
   * 전사 + 번역을 한 번의 generateContent 호출로 처리한다.
   *
   * 발화당 API 요청이 2회 → 1회로 줄어든다. Gemini는 오디오 입력과 구조화 출력
   * (responseSchema)을 함께 지원하므로 두 결과를 한 응답에 담을 수 있다.
   */
  async transcribeAndTranslate(
    req: TranscribeRequest,
    ctx: ProviderContext
  ): Promise<Result<TranscribeTranslateResponse>> {
    const model = ctx.settings.providerConfig.gemini.sttModel
    const audioBase64 = Buffer.from(req.wav).toString('base64')

    const instruction = [
      'This is business meeting audio containing Korean and/or English speech.',
      '1. Transcribe the speech verbatim in the language actually spoken, with correct punctuation.',
      '2. If the speech is English, translate it into natural business Korean (격식체).',
      '   If the speech is Korean, translate it into clear business English.',
      '3. Keep proper nouns, product names, acronyms, numbers and units unchanged.',
      '4. Do not guess or fill in words that were not spoken.',
      'If there is no intelligible speech, set transcript to exactly [NO_SPEECH] and translation to an empty string.'
    ].join('\n')

    const res = await httpJson(url(model, ctx.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: instruction },
              { inline_data: { mime_type: 'audio/wav', data: audioBase64 } }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              transcript: { type: 'STRING' },
              translation: { type: 'STRING' }
            },
            required: ['transcript', 'translation']
          }
        }
      })
    })
    if (!res.ok) return annotateModel(res, model)

    const body = res.value.json as GenerateContentResponse
    if (body.promptFeedback?.blockReason) {
      return {
        ok: false,
        error: fail('BAD_REQUEST', `Gemini가 요청을 차단했습니다. (${body.promptFeedback.blockReason})`)
      }
    }

    let parsed: { transcript?: string; translation?: string }
    try {
      parsed = JSON.parse(extractText(body)) as typeof parsed
    } catch {
      return { ok: false, error: fail('UNKNOWN', '통합 응답을 해석할 수 없습니다.') }
    }

    const transcript = (parsed.transcript ?? '').trim()
    if (!transcript || transcript.includes('[NO_SPEECH]')) {
      return { ok: false, error: fail('EMPTY', '인식된 음성이 없습니다.') }
    }

    // 방향 판정의 최종 권한은 문자 체계 기반 판별기에 둔다(FR-04).
    const detected = detectLanguage(transcript)
    const translation = (parsed.translation ?? '').trim()

    return {
      ok: true,
      value: {
        text: transcript,
        detectedLanguage: detected.language,
        languageConfidence: detected.confidence,
        translatedText: translation || undefined,
        requests: 1,
        usage: {
          audioSeconds: req.durationMs / 1000,
          inputTokens: body.usageMetadata?.promptTokenCount,
          outputTokens: body.usageMetadata?.candidatesTokenCount
        }
      }
    }
  },

  async translate(req: TranslateRequest, ctx: ProviderContext): Promise<Result<TranslateResponse>> {
    const model = ctx.settings.providerConfig.gemini.chatModel
    const { system, user } = buildTranslationPrompt(req)

    const res = await httpJson(url(model, ctx.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
      })
    })
    if (!res.ok) return annotateModel(res, model)

    const body = res.value.json as GenerateContentResponse
    const text = extractText(body)
    if (!text) return { ok: false, error: fail('EMPTY', '번역 결과가 비어 있습니다.') }

    return {
      ok: true,
      value: {
        text,
        usage: {
          inputTokens: body.usageMetadata?.promptTokenCount,
          outputTokens: body.usageMetadata?.candidatesTokenCount
        }
      }
    }
  },

  async summarize(
    req: SummarizeRequest,
    ctx: ProviderContext
  ): Promise<Result<SummarizeResponse>> {
    const model = ctx.settings.providerConfig.gemini.chatModel
    const { system, user } = buildMinutesPrompt(req)

    const res = await httpJson(url(model, ctx.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
          // 스키마를 주면 코드 펜스 없이 순수 JSON으로 답한다.
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              summary: { type: 'STRING' },
              keyPoints: { type: 'ARRAY', items: { type: 'STRING' } },
              decisions: { type: 'ARRAY', items: { type: 'STRING' } },
              actionItems: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    task: { type: 'STRING' },
                    owner: { type: 'STRING' },
                    due: { type: 'STRING' }
                  },
                  required: ['task']
                }
              },
              followUps: { type: 'ARRAY', items: { type: 'STRING' } }
            },
            required: ['title', 'summary', 'keyPoints', 'decisions', 'actionItems', 'followUps']
          }
        }
      })
    })
    if (!res.ok) return annotateModel(res, model)

    const body = res.value.json as GenerateContentResponse
    if (body.promptFeedback?.blockReason) {
      return {
        ok: false,
        error: fail(
          'BAD_REQUEST',
          `Gemini가 회의록 생성을 차단했습니다. (${body.promptFeedback.blockReason})`
        )
      }
    }

    const text = extractText(body)
    if (!text) return { ok: false, error: fail('EMPTY', '회의록 결과가 비어 있습니다.') }

    const minutes = parseMinutesContent(text)
    if (!minutes) return { ok: false, error: minutesParseError() }

    return {
      ok: true,
      value: {
        minutes,
        model,
        usage: {
          inputTokens: body.usageMetadata?.promptTokenCount,
          outputTokens: body.usageMetadata?.candidatesTokenCount
        }
      }
    }
  },

  async testConnection(ctx: ProviderContext): Promise<Result<string>> {
    const model = ctx.settings.providerConfig.gemini.chatModel
    const res = await httpJson(url(model, ctx.apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
        generationConfig: { maxOutputTokens: 8 }
      })
    })
    if (!res.ok) return annotateModel(res, model)
    const body = res.value.json as GenerateContentResponse
    return { ok: true, value: `모델 ${model} 응답 확인 (${extractText(body) || 'ok'})` }
  },

  async listModels(ctx: ProviderContext): Promise<Result<ModelInfo[]>> {
    interface ListedModel {
      name?: string
      displayName?: string
      supportedGenerationMethods?: string[]
    }

    // ListModels는 페이지로 나뉘어 온다. 한 페이지만 읽으면 쓰려던 모델이
    // 목록에 없어 사용자가 모델명을 직접 입력하게 되고, 오타로 404가 난다.
    const listed: ListedModel[] = []
    let pageToken = ''
    for (let page = 0; page < 10; page++) {
      const query = `?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      const res = await httpJson(`${BASE}${query}`, {
        method: 'GET',
        headers: { 'x-goog-api-key': ctx.apiKey }
      })
      if (!res.ok) return res

      const body = res.value.json as { models?: ListedModel[]; nextPageToken?: string }
      listed.push(...(body.models ?? []))
      pageToken = body.nextPageToken ?? ''
      if (!pageToken) break
    }

    const models = listed
      // generateContent를 지원하지 않는 모델(임베딩 등)은 이 앱에서 쓸 수 없다.
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => ({
        // ListModels는 "models/gemini-…" 형태로 돌려주므로 접두사를 떼야 요청에 쓸 수 있다.
        id: (m.name ?? '').replace(/^models\//, ''),
        label: m.displayName
      }))
      .filter((m) => m.id.length > 0)

    return { ok: true, value: models }
  }
}
