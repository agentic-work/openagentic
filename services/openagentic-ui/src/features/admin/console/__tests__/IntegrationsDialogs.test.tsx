/**
 * IntegrationModal — write-path unit tests (OSS issue #119, G2).
 *
 * Proves the create form POSTs to /api/admin/integrations with the secret in
 * the request body, that client validation blocks a malformed Slack token, and
 * that an edit with no new secret entered PUTs WITHOUT a `config` key (so the
 * write-only stored credential is preserved).
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mock the centralized API helper the modal calls.
const apiRequest = vi.fn()
vi.mock('@/utils/api', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}))

import { IntegrationModal } from '../pages/IntegrationsDialogs'

function okResponse(status = 201, body: unknown = { integration: { id: 'new-id' } }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

beforeEach(() => {
  apiRequest.mockReset()
})

describe('IntegrationModal — Slack create', () => {
  it('POSTs to /api/admin/integrations with the bot token in the body', async () => {
    apiRequest.mockResolvedValue(okResponse(201))
    const onClose = vi.fn()

    const { container, getByText } = render(
      <IntegrationModal platform="slack" editing={null} onClose={onClose} />,
    )

    const name = container.querySelector(
      'input[placeholder="e.g. Slack — Acme workspace"]',
    ) as HTMLInputElement
    const botToken = container.querySelector('input[placeholder="xoxb-…"]') as HTMLInputElement
    expect(name).toBeTruthy()
    expect(botToken).toBeTruthy()

    fireEvent.change(name, { target: { value: 'Slack — Acme' } })
    fireEvent.change(botToken, { target: { value: 'xoxb-1234-abcd-token' } })

    fireEvent.click(getByText('create slack integration'))

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))

    const [path, opts] = apiRequest.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/admin/integrations')
    expect(opts.method).toBe('POST')

    const sent = JSON.parse(String(opts.body)) as {
      name: string
      platform: string
      config: { botToken?: string }
    }
    expect(sent.platform).toBe('slack')
    expect(sent.name).toBe('Slack — Acme')
    // The secret is carried in the request body.
    expect(sent.config.botToken).toBe('xoxb-1234-abcd-token')

    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('blocks a malformed bot token before any request', async () => {
    const { container, getByText } = render(
      <IntegrationModal platform="slack" editing={null} onClose={vi.fn()} />,
    )
    const name = container.querySelector(
      'input[placeholder="e.g. Slack — Acme workspace"]',
    ) as HTMLInputElement
    const botToken = container.querySelector('input[placeholder="xoxb-…"]') as HTMLInputElement

    fireEvent.change(name, { target: { value: 'bad' } })
    fireEvent.change(botToken, { target: { value: 'not-a-slack-token' } })
    fireEvent.click(getByText('create slack integration'))

    await waitFor(() => expect(container.textContent).toContain('xoxb-'))
    expect(apiRequest).not.toHaveBeenCalled()
  })
})

describe('IntegrationModal — edit keeps write-only secrets', () => {
  it('PUTs without a config key when no new secret is entered', async () => {
    apiRequest.mockResolvedValue(okResponse(200, { integration: { id: 'abc' } }))

    const { getByText } = render(
      <IntegrationModal
        platform="slack"
        editing={{ id: 'abc', name: 'Slack — Acme', platform: 'slack', allowed_channels: ['#ops'] }}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(getByText('save changes'))

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))
    const [path, opts] = apiRequest.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/admin/integrations/abc')
    expect(opts.method).toBe('PUT')

    const sent = JSON.parse(String(opts.body)) as Record<string, unknown>
    // Secret is write-only: no config sent → stored credential preserved.
    expect('config' in sent).toBe(false)
    expect(sent.name).toBe('Slack — Acme')
  })
})

describe('IntegrationModal — Teams validation', () => {
  it('blocks a non-UUID app id before any request', async () => {
    const { container, getByText } = render(
      <IntegrationModal platform="teams" editing={null} onClose={vi.fn()} />,
    )
    const name = container.querySelector(
      'input[placeholder="e.g. Teams — Contoso tenant"]',
    ) as HTMLInputElement
    const appId = container.querySelector(
      'input[placeholder="00000000-0000-0000-0000-000000000000"]',
    ) as HTMLInputElement
    const appPassword = container.querySelector('input[placeholder="client secret"]') as HTMLInputElement

    fireEvent.change(name, { target: { value: 'Teams — Contoso' } })
    fireEvent.change(appId, { target: { value: 'not-a-uuid' } })
    fireEvent.change(appPassword, { target: { value: 'secret' } })
    fireEvent.click(getByText('create teams integration'))

    await waitFor(() => expect(container.textContent).toContain('UUID'))
    expect(apiRequest).not.toHaveBeenCalled()
  })
})
