/**
 * Integration test for the OpenAI API runtime tool-use loop (TOD-2020).
 *
 * Tests runOpenAIToolUseLoop end-to-end with injected callApi / executeTool
 * so no real HTTP calls or API key are needed.
 */

import { runOpenAIToolUseLoop, OPENAI_TOOL_SCHEMAS } from '@/lib/runtimes/openai-api'

// ---------------------------------------------------------------------------
// Helpers — build mock OpenAI responses
// ---------------------------------------------------------------------------

function makeToolCallResponse(calls: Array<{ id: string; name: string; args: object }>) {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
      },
    ],
  }
}

function makeStopResponse(content: string) {
  return {
    choices: [
      {
        finish_reason: 'stop',
        message: { role: 'assistant', content, tool_calls: undefined },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runOpenAIToolUseLoop', () => {
  it('returns final text immediately when model stops without tool calls', async () => {
    const callApi = jest.fn().mockResolvedValueOnce(makeStopResponse('Hello world'))

    const result = await runOpenAIToolUseLoop({
      apiKey: 'test-key',
      model: 'gpt-4o',
      prompt: 'Say hello.',
      callApi,
    })

    expect(result.finalText).toBe('Hello world')
    expect(result.iterations).toBe(1)
    expect(callApi).toHaveBeenCalledTimes(1)
  })

  it('executes a tool call and feeds result back before returning final text', async () => {
    const callApi = jest
      .fn()
      .mockResolvedValueOnce(
        makeToolCallResponse([{ id: 'call_1', name: 'read_file', args: { path: '/etc/hostname' } }])
      )
      .mockResolvedValueOnce(makeStopResponse('The file contents are: myhost'))

    const executeTool = jest.fn().mockReturnValue('myhost')

    const result = await runOpenAIToolUseLoop({
      apiKey: 'test-key',
      model: 'gpt-4o',
      prompt: 'Read /etc/hostname.',
      callApi,
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledWith('read_file', { path: '/etc/hostname' })
    expect(callApi).toHaveBeenCalledTimes(2)

    // Second call must include the tool result message
    const secondCallMessages = (callApi.mock.calls[1][0] as { messages: unknown[] }).messages
    expect(secondCallMessages).toContainEqual(
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_1', content: 'myhost' })
    )

    expect(result.finalText).toBe('The file contents are: myhost')
    expect(result.iterations).toBe(2)
  })

  it('handles multiple sequential tool calls across iterations', async () => {
    const callApi = jest
      .fn()
      .mockResolvedValueOnce(
        makeToolCallResponse([{ id: 'tc_1', name: 'run_bash', args: { command: 'echo hi' } }])
      )
      .mockResolvedValueOnce(
        makeToolCallResponse([{ id: 'tc_2', name: 'read_file', args: { path: '/foo.txt' } }])
      )
      .mockResolvedValueOnce(makeStopResponse('Done'))

    const executeTool = jest
      .fn()
      .mockReturnValueOnce('hi')
      .mockReturnValueOnce('file-content')

    const result = await runOpenAIToolUseLoop({
      apiKey: 'test-key',
      model: 'gpt-4o',
      prompt: 'Do something.',
      callApi,
      executeTool,
    })

    expect(executeTool).toHaveBeenCalledTimes(2)
    expect(callApi).toHaveBeenCalledTimes(3)
    expect(result.finalText).toBe('Done')
    expect(result.iterations).toBe(3)
  })

  it('throws when max iterations exceeded', async () => {
    const callApi = jest.fn().mockResolvedValue(
      makeToolCallResponse([{ id: 'tc_x', name: 'run_bash', args: { command: 'true' } }])
    )
    const executeTool = jest.fn().mockReturnValue('ok')

    await expect(
      runOpenAIToolUseLoop({
        apiKey: 'test-key',
        model: 'gpt-4o',
        prompt: 'Loop forever.',
        callApi,
        executeTool,
        maxIterations: 3,
      })
    ).rejects.toThrow('exceeded 3 iterations')
  })

  it('throws on API error response', async () => {
    const callApi = jest.fn().mockResolvedValueOnce({
      error: { message: 'Invalid API key', type: 'invalid_request_error' },
    })

    await expect(
      runOpenAIToolUseLoop({
        apiKey: 'bad-key',
        model: 'gpt-4o',
        prompt: 'Hello.',
        callApi,
      })
    ).rejects.toThrow('OpenAI API error: Invalid API key')
  })
})

// ---------------------------------------------------------------------------
// Tool schema sanity checks
// ---------------------------------------------------------------------------

describe('OPENAI_TOOL_SCHEMAS', () => {
  it('includes read_file and run_bash tools', () => {
    const names = OPENAI_TOOL_SCHEMAS.map((t) => t.function.name)
    expect(names).toContain('read_file')
    expect(names).toContain('run_bash')
  })

  it('each schema has required function-calling shape', () => {
    for (const tool of OPENAI_TOOL_SCHEMAS) {
      expect(tool.type).toBe('function')
      expect(tool.function.name).toBeTruthy()
      expect(tool.function.parameters).toBeDefined()
      expect(tool.function.parameters.required).toBeInstanceOf(Array)
    }
  })
})
