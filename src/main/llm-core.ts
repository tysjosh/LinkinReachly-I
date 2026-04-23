// ---------------------------------------------------------------------------
// llm-core.ts — Low-level LLM transport: HTTP fetch, retry, error helpers,
// JSON extraction. All higher-level modules delegate here.
// ---------------------------------------------------------------------------

import type { AppSettings } from './settings'
import { getApiKey } from './settings'
import { appLog } from './app-log'
import { getAuthHeaders, isAuthenticated } from './auth-service'
import { getServiceConfig } from './service-config'

// ── Error helpers ────────────────────────────────────────────────────────

const MAX_ERROR_DETAIL = 200

export function classifyLlmError(message: string): string {
  const lower = message.toLowerCase()
  if (/fetch failed|failed to fetch|econnrefused|enotfound|network|socket|timed out|timeout/i.test(lower)) return 'llm_network'
  if (/401|403|unauthorized|invalid.*key|api key/i.test(lower)) return 'llm_auth'
  if (/syntax|json|parse|unexpected token/i.test(lower)) return 'llm_parse'
  if (/404|not.*found|unknown.*model/i.test(lower)) return 'llm_model_not_found'
  return 'llm_error'
}

export function extractErrorDetail(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, MAX_ERROR_DETAIL) : String(error || 'unknown_error')
}

// ── Types ────────────────────────────────────────────────────────────────

export type LlmChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type LlmCallOptions = {
  maxOutputTokens?: number
  timeoutMs?: number
}

// ── JSON extraction ──────────────────────────────────────────────────────

function extractJsonObject(text: string): string {
  const raw = String(text || '').trim()
  const precise = extractFirstCompleteJsonObject(raw)
  if (precise) return precise
  const m = raw.match(/\{[\s\S]*\}/)
  return m ? m[0] : raw
}

/**
 * Parse a single JSON object from model output: try whole string, then first `{`…`}` with
 * string-aware brace depth (avoids greedy-regex swallowing multiple objects or bad spans).
 */
export function extractFirstCompleteJsonObject(text: string): string | null {
  const s = String(text || '').trim()
  const tryParse = (t: string): boolean => {
    try {
      JSON.parse(t)
      return true
    } catch (e) {
      appLog.debug('[llm] JSON parse attempt failed', e instanceof Error ? e.message : String(e))
      return false
    }
  }
  if (s.startsWith('{') && tryParse(s)) return s

  const start = s.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]!
    if (escape) {
      escape = false
      continue
    }
    if (c === '\\' && inString) {
      escape = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const slice = s.slice(start, i + 1)
        if (tryParse(slice)) return slice
      }
    }
  }
  return null
}

/** First JSON object in model text (for structured protocols); prefers balanced-object parse. */
export function extractLlmJsonContent(text: string): string {
  return extractFirstCompleteJsonObject(text) ?? extractJsonObject(text)
}

// ── Retry & transport ────────────────────────────────────────────────────

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const MAX_LLM_RETRIES = 3
const BASE_RETRY_DELAY_MS = 1000

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('timeout') || msg.includes('econnreset')) return true
    if (msg.includes('fetch failed') || msg.includes('socket hang up')) return true
  }
  return false
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries = MAX_LLM_RETRIES
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === maxRetries) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt === maxRetries || !isRetryableError(e)) throw lastError
    }
    const jitter = 0.7 + Math.random() * 0.6
    const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt) * jitter
    await new Promise((r) => setTimeout(r, delay))
    appLog.warn(`[llm] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`)
  }
  throw lastError ?? new Error('LLM fetch failed after retries')
}

/**
 * Returns true when the app should route LLM calls through our backend proxy
 * instead of calling the LLM provider directly with a user-supplied key.
 */
function shouldUseProxy(): boolean {
  const config = getServiceConfig()
  return !!(config.llmProxy.url && isAuthenticated())
}

/**
 * Call our LLM proxy endpoint. The proxy holds the real API key server-side;
 * we authenticate with the Firebase ID token.
 */
async function fetchViaProxy(
  messages: Array<{ role: string; content: string }>,
  model: string,
  options?: LlmCallOptions
): Promise<string> {
  const config = getServiceConfig()
  const maxTokens = Math.min(Math.max(options?.maxOutputTokens ?? 512, 1), 32_000)
  const timeoutMs = options?.timeoutMs ?? 30_000

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.7,
    stream: false,
  }
  if (maxTokens !== 512) body.max_tokens = maxTokens

  const inputEstimate = Math.round(JSON.stringify(messages).length / 4)
  appLog.info('[llm] proxy request', { model, inputTokenEstimate: inputEstimate })
  const t0 = Date.now()

  const res = await fetchWithRetry(config.llmProxy.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(body),
  }, timeoutMs)

  const latencyMs = Date.now() - t0
  if (!res.ok) {
    appLog.info('[llm] proxy response', { status: res.status, latencyMs })
    throw new Error(await res.text())
  }

  let data: { choices?: Array<{ message?: { content?: string } }> }
  let rawBody: string
  try {
    rawBody = typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json())
  } catch {
    throw new Error(`LLM proxy returned unreadable response (status ${res.status})`)
  }
  try {
    data = JSON.parse(rawBody) as typeof data
  } catch {
    throw new Error(`LLM proxy returned non-JSON response (status ${res.status}): ${rawBody.slice(0, 200)}`)
  }
  const content = data.choices?.[0]?.message?.content
  const outputEstimate = content != null ? Math.round(String(content).length / 4) : 0
  appLog.info('[llm] proxy response', { status: res.status, outputTokenEstimate: outputEstimate, latencyMs })
  if (content == null) throw new Error('LLM response missing content field')
  return String(content)
}

/**
 * Shared low-level chat completion: HTTP request, retry, logging, response extraction.
 * Both callLlm and callLlmMessages delegate here.
 * Routes through our proxy when configured; falls back to direct LLM call otherwise.
 */
async function fetchChatCompletion(
  settings: AppSettings,
  messages: Array<{ role: string; content: string }>,
  key: string,
  options?: LlmCallOptions
): Promise<string> {
  if (shouldUseProxy()) {
    return fetchViaProxy(messages, settings.llmModel, options)
  }

  const maxTokens = Math.min(Math.max(options?.maxOutputTokens ?? 512, 1), 32_000)
  const timeoutMs = options?.timeoutMs ?? 30_000
  const base = settings.llmBaseUrl.replace(/\/$/, '')
  const url = `${base}/chat/completions`
  const body: Record<string, unknown> = {
    model: settings.llmModel,
    messages,
    temperature: 0.7,
    stream: false
  }
  if (maxTokens !== 512) {
    body.max_tokens = maxTokens
  }
  const inputEstimate = Math.round(JSON.stringify(messages).length / 4)
  appLog.info('[llm] request', { model: settings.llmModel, inputTokenEstimate: inputEstimate })
  const t0 = Date.now()
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body)
  }, timeoutMs)
  const latencyMs = Date.now() - t0
  if (!res.ok) {
    appLog.info('[llm] response', { status: res.status, latencyMs })
    throw new Error(await res.text())
  }
  let data2: { choices?: Array<{ message?: { content?: string } }> }
  let rawBody2: string
  try {
    rawBody2 = typeof res.text === 'function' ? await res.text() : JSON.stringify(await res.json())
  } catch {
    throw new Error(`LLM returned unreadable response (status ${res.status})`)
  }
  try {
    data2 = JSON.parse(rawBody2) as typeof data2
  } catch {
    throw new Error(`LLM returned non-JSON response (status ${res.status}): ${rawBody2.slice(0, 200)}`)
  }
  const content = data2.choices?.[0]?.message?.content
  const outputEstimate = content != null ? Math.round(String(content).length / 4) : 0
  appLog.info('[llm] response', { status: res.status, outputTokenEstimate: outputEstimate, latencyMs })
  if (content == null) throw new Error('LLM response missing content field')
  return String(content)
}

// ── Public call functions ────────────────────────────────────────────────

export async function callLlm(
  settings: AppSettings,
  system: string,
  user: string,
  key: string,
  options?: LlmCallOptions & { plainText?: boolean }
): Promise<string> {
  const raw = await fetchChatCompletion(
    settings,
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    key,
    options
  )
  if (options?.plainText) {
    return raw.trim().slice(0, 24_000)
  }
  return extractJsonObject(raw)
}

/**
 * Multi-turn chat completions (no response normalization). Use for agent loops; callers parse JSON themselves.
 */
export async function callLlmMessages(
  settings: AppSettings,
  messages: LlmChatMessage[],
  key: string,
  options?: LlmCallOptions
): Promise<string> {
  const raw = await fetchChatCompletion(settings, messages, key, options)
  return raw.trim()
}

export async function callLlmDirect(
  system: string,
  userPrompt: string,
  options?: LlmCallOptions & { plainText?: boolean }
): Promise<string> {
  const settings = (await import('./settings')).loadSettings()
  const key = (await import('./settings')).getApiKey()
  if (!key && !shouldUseProxy()) throw new Error('No API key configured for AI service.')
  return callLlm(settings, system, userPrompt, key ?? '', options)
}

export async function testApiKey(
  settings: AppSettings,
  apiKeyOverride?: string | null
): Promise<{ ok: boolean; detail: string }> {
  const key = apiKeyOverride?.trim() || getApiKey()
  const proxyAvailable = shouldUseProxy()
  if (!key && !proxyAvailable) return { ok: false, detail: 'No API key provided.' }
  if (!settings.llmEnabled) return { ok: false, detail: 'AI messages are turned off. Enable them first.' }
  try {
    const reply = await callLlm(settings, 'Reply with exactly: OK', 'Test connection.', key ?? '')
    return { ok: true, detail: proxyAvailable && !key ? 'Connected via LinkinReachly AI.' : `Connected. Model responded: "${reply.slice(0, 40)}"` }
  } catch (e) {
    const msg = extractErrorDetail(e)
    const kind = classifyLlmError(msg)
    const userMessages: Record<string, string> = {
      llm_auth: 'Invalid API key. Check the key and try again.',
      llm_model_not_found: 'Model not found. Check the model name in AI service details.',
      llm_network: 'Cannot reach the AI service. Check the server URL.'
    }
    // Report LLM config errors server-side
    try {
      const { trackError } = require('./telemetry') as typeof import('./telemetry')
      trackError('llm_error', msg, {
        severity: 'warning',
        context: { errorKind: kind, model: settings.llmModel, baseUrl: settings.llmBaseUrl },
      })
    } catch { /* telemetry may not be loaded */ }
    return { ok: false, detail: userMessages[kind] ?? msg }
  }
}
