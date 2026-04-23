import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EasyApplyResult } from '../../../src/main/easy-apply/shared'

const sharedMocks = vi.hoisted(() => ({
  easyApplyBridgeCommand: vi.fn(),
  isStaleExtensionResult: vi.fn((result: unknown) => {
    return !!result && typeof result === 'object' && (result as { blockReason?: unknown }).blockReason === 'extension_stale'
  })
}))

const bridgeMocks = vi.hoisted(() => ({
  sendCommand: vi.fn().mockResolvedValue({ ok: true }),
  getActiveLinkedInTabId: vi.fn(() => null),
  bridgeEvents: {
    once: vi.fn((event: string, cb: () => void) => {
      if (event === 'bridge-ready') cb()
    })
  }
}))

vi.mock('../../../src/main/easy-apply/shared', () => ({
  easyApplyBridgeCommand: (...args: unknown[]) =>
    sharedMocks.easyApplyBridgeCommand(...args) as ReturnType<typeof sharedMocks.easyApplyBridgeCommand>,
  isStaleExtensionResult: (result: unknown) => sharedMocks.isStaleExtensionResult(result)
}))

vi.mock('../../../src/main/bridge', () => ({
  sendCommand: (...args: unknown[]) => bridgeMocks.sendCommand(...args) as ReturnType<typeof bridgeMocks.sendCommand>,
  getActiveLinkedInTabId: () => bridgeMocks.getActiveLinkedInTabId(),
  bridgeEvents: bridgeMocks.bridgeEvents
}))

vi.mock('../../../src/main/apply-trace', () => ({
  applyTrace: vi.fn()
}))

vi.mock('../../../src/main/app-log', () => ({
  appLog: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

const nonApplyLandingDiag = {
  url: 'https://www.linkedin.com/jobs/view/1234567890/',
  modalRootFound: false,
  hasInteropOutlet: false,
  easyApplyModals: 0,
  roleDialogs: 0,
  artdecoModals: 0,
  sduiFormFieldCount: 0
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-14T06:30:00.000Z'))
  sharedMocks.easyApplyBridgeCommand.mockReset()
  bridgeMocks.sendCommand.mockReset()
  bridgeMocks.sendCommand.mockResolvedValue({ ok: true })
  bridgeMocks.getActiveLinkedInTabId.mockReset()
  bridgeMocks.getActiveLinkedInTabId.mockReturnValue(null)
  bridgeMocks.bridgeEvents.once.mockClear()
  bridgeMocks.bridgeEvents.once.mockImplementation((event: string, cb: () => void) => {
    if (event === 'bridge-ready') cb()
  })
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('easy-apply guards', () => {
  it('returns a user-facing unavailable message when SDUI force navigate lands back on jobs/view', async () => {
    sharedMocks.easyApplyBridgeCommand.mockImplementation((action: string) => {
      if (action === 'LOCATE_EASY_APPLY_BUTTON') {
        return Promise.resolve({
          ok: true,
          detail: 'located',
          data: { sduiApplyUrl: 'https://www.linkedin.com/jobs/view/1234567890/?openSDUIApplyFlow=true' }
        })
      }
      if (action === 'CLICK_EASY_APPLY') {
        return Promise.resolve({
          ok: true,
          detail: 'sdui_click_no_modal',
          data: {
            sduiApplyUrl: 'https://www.linkedin.com/jobs/view/1234567890/?openSDUIApplyFlow=true',
            needsSPANavigate: true
          }
        })
      }
      if (action === 'FORCE_NAVIGATE') {
        return Promise.resolve({ ok: true, detail: 'force_navigated' })
      }
      if (action === 'DIAGNOSE_EASY_APPLY') {
        return Promise.resolve({ ok: true, detail: 'diagnose_ok', data: nonApplyLandingDiag })
      }
      return Promise.resolve({ ok: false, detail: `unexpected_action:${action}` })
    })

    const { easyApplyClickApplyButton } = await import('../../../src/main/easy-apply/click-apply')
    const runPromise = easyApplyClickApplyButton()
    await vi.runAllTimersAsync()
    const result = await runPromise

    expect(result.earlyExit?.ok).toBe(false)
    expect(result.earlyExit?.phase).toBe('click_apply')
    expect(result.earlyExit?.detail || '').toMatch(/Could not find Easy Apply|form didn't open/i)
  })

  it('returns stale extension result when warning-check page text action is stale', async () => {
    const stale: EasyApplyResult = {
      ok: false,
      phase: 'navigate',
      detail: 'Extension outdated. Reload LinkinReachly in Chrome’s Extensions page, then retry.',
      blockReason: 'extension_stale',
      blockStage: 'linkedin_warning_check'
    }

    sharedMocks.easyApplyBridgeCommand.mockImplementation((action: string) => {
      if (action === 'NAVIGATE') return Promise.resolve({ ok: true, detail: 'navigated' })
      if (action === 'SCROLL_PAGE') return Promise.resolve({ ok: true, detail: 'scrolled' })
      if (action === 'CHECK_SUCCESS_SCREEN') return Promise.resolve({ ok: false, detail: 'not_success' })
      if (action === 'GET_PAGE_TEXT') return Promise.resolve(stale)
      return Promise.resolve({ ok: false, detail: `unexpected_action:${action}` })
    })

    const { easyApplyNavigate } = await import('../../../src/main/easy-apply/navigate')
    const runPromise = easyApplyNavigate('https://www.linkedin.com/jobs/view/1234567890/')
    await vi.runAllTimersAsync()
    const result = await runPromise

    expect(result).toEqual(stale)
    expect(sharedMocks.easyApplyBridgeCommand).toHaveBeenCalledWith(
      'GET_PAGE_TEXT',
      {},
      'navigate',
      'linkedin_warning_check',
      5_000
    )
  })
})
