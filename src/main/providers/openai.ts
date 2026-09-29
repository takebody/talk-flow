import type {
  ModelInfo,
  Result,
  SummarizeRequest,
  SummarizeResponse,
  TranscribeRequest,
  TranscribeResponse,
  TranslateRequest,
  TranslateResponse
} from '@shared/types'
import { detectLanguage } from '@shared/lang'
import {
  annotateModel,
  buildMinutesPrompt,
  buildTranslationPrompt,
  fail,
  httpFetch,
  httpJson,
  minutesParseError,
  normalizeHttpError,
  normalizeThrown,
  parseMinutesContent,
  Provider,
  ProviderContext,
  REQUEST_TIMEOUT_MS,
  STT_PROMPT_AUTO,
  STT_PROMPT_EN
} from './base'

interface ChatCompletion {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * OpenAI 호환(Chat Completions + Audio Transcriptions) 엔드포인트 구현.
 * 사내 게이트웨이처럼 같은 규격을 쓰는 엔드포인트를 추가할 때 재사용한다.
 */
export function makeOpenAiCompatible(config: {
  id: string
  /** 전사 엔드포인트 URL과 헤더 */
  sttUrl: (ctx: ProviderContext) => string
  chatUrl: (ctx: ProviderContext) => string
  /** 사용 가능한 모델 목록 엔드포인트 */
  modelsUrl: (ctx: ProviderContext) => string
  headers: (ctx: ProviderContext) => Record<string, string>
  sttModel: (ctx: ProviderContext) => string
  chatModel: (ctx: ProviderContext) => string
  validate?: (ctx: ProviderContext) => string | null
}): Provider {
  const guard = (ctx: ProviderContext) => config.validate?.(ctx) ?? null

  return {
    id: config.id,
    supportsStt: true,

    async transcribe(
      req: TranscribeRequest,
      ctx: ProviderContext
    ): Promise<Result<TranscribeResponse>> {
      const problem = guard(ctx)
      if (problem) return { ok: false, error: fail('NOT_CONFIGURED', problem) }

      const form = new FormData()
      form.append('file', new Blob([req.wav], { type: 'audio/wav' }), 'utterance.wav')
      form.append('model', config.sttModel(ctx))
      form.append('response_format', 'json')
      form.append('prompt', req.languageHint === 'en' ? STT_PROMPT_EN : STT_PROMPT_AUTO)
      if (req.languageHint === 'en' || req.languageHint === 'ko') {
        form.append('language', req.languageHint)
      }

      try {
        const res = await httpFetch(config.sttUrl(ctx), {
          method: 'POST',
          headers: config.headers(ctx),
          body: form,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        })
        const text = await res.text()
        if (!res.ok) {
          return annotateModel(
            {
              ok: false,
              error: normalizeHttpError(res.status, text, res.headers.get('content-type'))
            },
            config.sttModel(ctx)
          )
        }

        const parsed = JSON.parse(text) as { text?: string }
        const transcript = (parsed.text ?? '').trim()
        if (!transcript) return { ok: false, error: fail('EMPTY', '인식된 음성이 없습니다.') }

        const detected = detectLanguage(transcript)
        return {
          ok: true,
          value: {
            text: transcript,
            detectedLanguage: detected.language,
            languageConfidence: detected.confidence,
            usage: { audioSeconds: req.durationMs / 1000 }
          }
        }
      } catch (err) {
        return { ok: false, error: normalizeThrown(err) }
      }
    },

    async translate(
      req: TranslateRequest,
      ctx: ProviderContext
    ): Promise<Result<TranslateResponse>> {
      const problem = guard(ctx)
      if (problem) return { ok: false, error: fail('NOT_CONFIGURED', problem) }

      const { system, user } = buildTranslationPrompt(req)
      const res = await httpJson(config.chatUrl(ctx), {
        method: 'POST',
        headers: { ...config.headers(ctx), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.chatModel(ctx),
          temperature: 0.2,
          max_tokens: 1200,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      })
      if (!res.ok) return annotateModel(res, config.chatModel(ctx))

      const body = res.value.json as ChatCompletion
      const text = body.choices?.[0]?.message?.content?.trim()
      if (!text) return { ok: false, error: fail('EMPTY', '번역 결과가 비어 있습니다.') }

      return {
        ok: true,
        value: {
          text,
          usage: {
            inputTokens: body.usage?.prompt_tokens,
            outputTokens: body.usage?.completion_tokens
          }
        }
      }
    },

    async summarize(
      req: SummarizeRequest,
      ctx: ProviderContext
    ): Promise<Result<SummarizeResponse>> {
      const problem = guard(ctx)
      if (problem) return { ok: false, error: fail('NOT_CONFIGURED', problem) }

      const model = config.chatModel(ctx)
      const { system, user } = buildMinutesPrompt(req)
      const res = await httpJson(config.chatUrl(ctx), {
        method: 'POST',
        headers: { ...config.headers(ctx), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          // 회의록은 번역문 한 문장보다 훨씬 길다.
          max_tokens: 4000,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ]
        })
      })
      if (!res.ok) return annotateModel(res, model)

      const body = res.value.json as ChatCompletion
      const text = body.choices?.[0]?.message?.content?.trim()
      if (!text) return { ok: false, error: fail('EMPTY', '회의록 결과가 비어 있습니다.') }

      const minutes = parseMinutesContent(text)
      if (!minutes) return { ok: false, error: minutesParseError() }

      return {
        ok: true,
        value: {
          minutes,
          model,
          usage: {
            inputTokens: body.usage?.prompt_tokens,
            outputTokens: body.usage?.completion_tokens
          }
        }
      }
    },

    async testConnection(ctx: ProviderContext): Promise<Result<string>> {
      const problem = guard(ctx)
      if (problem) return { ok: false, error: fail('NOT_CONFIGURED', problem) }

      const res = await httpJson(config.chatUrl(ctx), {
        method: 'POST',
        headers: { ...config.headers(ctx), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.chatModel(ctx),
          max_tokens: 5,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }]
        })
      })
      if (!res.ok) return annotateModel(res, config.chatModel(ctx))
      const body = res.value.json as ChatCompletion
      return {
        ok: true,
        value: `번역 모델 ${config.chatModel(ctx)} 응답 확인 (${
          body.choices?.[0]?.message?.content?.trim() || 'ok'
        })`
      }
    },

    async listModels(ctx: ProviderContext): Promise<Result<ModelInfo[]>> {
      const problem = guard(ctx)
      if (problem) return { ok: false, error: fail('NOT_CONFIGURED', problem) }

      const res = await httpJson(config.modelsUrl(ctx), {
        method: 'GET',
        headers: config.headers(ctx)
      })
      if (!res.ok) return res

      const body = res.value.json as { data?: { id?: string }[] }
      const models = (body.data ?? [])
        .map((m) => ({ id: m.id ?? '' }))
        .filter((m) => m.id.length > 0)
        .sort((a, b) => a.id.localeCompare(b.id))
      return { ok: true, value: models }
    }
  }
}

export const openAiProvider = makeOpenAiCompatible({
  id: 'openai',
  sttUrl: () => 'https://api.openai.com/v1/audio/transcriptions',
  chatUrl: () => 'https://api.openai.com/v1/chat/completions',
  modelsUrl: () => 'https://api.openai.com/v1/models',
  headers: (ctx) => ({ Authorization: `Bearer ${ctx.apiKey}` }),
  sttModel: (ctx) => ctx.settings.providerConfig.openai.sttModel,
  chatModel: (ctx) => ctx.settings.providerConfig.openai.chatModel
})
