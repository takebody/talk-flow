import Anthropic from '@anthropic-ai/sdk'
import type {
  ModelInfo,
  Result,
  TranscribeResponse,
  TranslateRequest,
  TranslateResponse
} from '@shared/types'
import {
  annotateModel,
  buildTranslationPrompt,
  fail,
  httpFetch,
  normalizeHttpError,
  normalizeThrown,
  Provider,
  ProviderContext,
  REQUEST_TIMEOUT_MS
} from './base'

/**
 * Anthropic Claude 어댑터 — 번역 전용.
 *
 * Claude API(`POST /v1/messages`)는 텍스트·이미지·PDF 입력만 받고 오디오 입력을
 * 지원하지 않는다. 따라서 이 제공자는 STT를 제공할 수 없고, 음성 인식은
 * 설정의 `sttProvider`(OpenAI 또는 Gemini)가 담당한다.
 */

/**
 * 공식 SDK를 쓰되 HTTP는 Electron의 `net.fetch`로 보낸다.
 * 사내 TLS 검사 프록시 환경에서 Node 기본 fetch가 인증서 검증에 실패하기 때문이다.
 */
function makeClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    // SDK 내부 재시도는 끄고 providers/index.ts의 공통 백오프만 쓴다.
    maxRetries: 0,
    fetch: httpFetch
  })
}

function mapError(err: unknown) {
  // 구체적인 클래스부터 순서대로 확인한다.
  if (err instanceof Anthropic.AuthenticationError) {
    return fail('AUTH', 'Claude API 인증에 실패했습니다.', 'API Key를 확인하세요.', err.status)
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return fail(
      'AUTH',
      'Claude API 접근이 거부되었습니다.',
      'API Key의 워크스페이스 권한을 확인하세요.',
      err.status
    )
  }
  if (err instanceof Anthropic.RateLimitError) {
    // Anthropic은 retry-after 헤더로 대기 시간을 알려준다.
    const header = err.headers?.get?.('retry-after')
    const seconds = header ? Number.parseFloat(header) : NaN
    return {
      code: 'QUOTA' as const,
      status: err.status,
      quotaScope: 'minute' as const,
      retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : undefined,
      message: 'Claude API 요청 한도를 초과했습니다.',
      hint: '설정에서 "분당 최대 요청 수"를 낮추거나 요금제를 확인하세요.'
    }
  }
  if (err instanceof Anthropic.NotFoundError) {
    return fail(
      'NOT_FOUND',
      '모델을 찾을 수 없습니다.',
      '설정에서 Claude 모델명을 확인하세요.',
      err.status
    )
  }
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
    // 사내 차단 페이지처럼 API가 아닌 응답이 온 경우도 여기서 정규화된다.
    return normalizeHttpError(err.status, err.message, null)
  }
  return normalizeThrown(err)
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
}

export const anthropicProvider: Provider = {
  id: 'anthropic',
  supportsStt: false,

  async transcribe(): Promise<Result<TranscribeResponse>> {
    return {
      ok: false,
      error: fail(
        'NOT_CONFIGURED',
        'Claude는 음성 인식을 지원하지 않습니다.',
        '설정 > AI 제공자에서 음성 인식 제공자를 OpenAI 또는 Gemini로 지정하세요.'
      )
    }
  },

  async translate(req: TranslateRequest, ctx: ProviderContext): Promise<Result<TranslateResponse>> {
    const model = ctx.settings.providerConfig.anthropic.chatModel
    const { system, user } = buildTranslationPrompt(req)

    try {
      const message = await makeClient(ctx.apiKey).messages.create({
        model,
        max_tokens: 4096,
        system,
        // 문장 단위 번역이라 깊은 추론이 필요 없다. 낮은 effort로 지연과 비용을 줄인다.
        // (thinking을 끄는 대신 effort를 낮추는 것이 권장 방식이다.)
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: user }]
      })

      if (message.stop_reason === 'refusal') {
        return {
          ok: false,
          error: fail(
            'BAD_REQUEST',
            'Claude가 이 문장의 번역을 거부했습니다.',
            `사유: ${message.stop_details?.category ?? '알 수 없음'}`
          )
        }
      }

      const text = textOf(message)
      if (!text) return { ok: false, error: fail('EMPTY', '번역 결과가 비어 있습니다.') }

      return {
        ok: true,
        value: {
          text,
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens
          }
        }
      }
    } catch (err) {
      return annotateModel<TranslateResponse>({ ok: false, error: mapError(err) }, model)
    }
  },

  async testConnection(ctx: ProviderContext): Promise<Result<string>> {
    const model = ctx.settings.providerConfig.anthropic.chatModel
    try {
      const message = await makeClient(ctx.apiKey).messages.create({
        model,
        max_tokens: 16,
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }]
      })
      return { ok: true, value: `모델 ${model} 응답 확인 (${textOf(message) || 'ok'})` }
    } catch (err) {
      return annotateModel<string>({ ok: false, error: mapError(err) }, model)
    }
  },

  async listModels(ctx: ProviderContext): Promise<Result<ModelInfo[]>> {
    try {
      const models: ModelInfo[] = []
      // SDK가 페이지네이션을 처리한다.
      for await (const model of makeClient(ctx.apiKey).models.list({ limit: 100 })) {
        models.push({ id: model.id, label: model.display_name })
      }
      return { ok: true, value: models }
    } catch (err) {
      return { ok: false, error: mapError(err) }
    }
  }
}
