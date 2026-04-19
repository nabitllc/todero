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
    const client = createClient() as any
    const result = client()
    expect(result.result).toBe(true)
  })
})
