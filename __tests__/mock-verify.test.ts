let _testValue = false

const mockFn = jest.fn(() => {
  return { result: _testValue }
})

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockFn),
}))

import { createClient } from '@supabase/supabase-js'

describe('mock verify', () => {
  it('should work', () => {
    _testValue = true
    // createClient's real signature needs (url, key); the module is mocked, so
    // the values are irrelevant - but omitting them fails `tsc --noEmit`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = createClient('http://localhost', 'anon-key') as any
    const result = client()
    expect(result.result).toBe(true)
  })
})
