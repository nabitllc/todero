import { getPipelineStage } from '@/lib/pipeline'

describe('getPipelineStage', () => {
  it('keeps code_review in Testing until both reviewer lanes pass', () => {
    expect(getPipelineStage({ status: 'code_review', tester_status: 'passed', designer_status: 'pending' })).toBe('Testing')
  })

  it('moves code_review to PR Queue when tester and designer both pass', () => {
    expect(getPipelineStage({ status: 'code_review', tester_status: 'passed', designer_status: 'passed' })).toBe('PR Queue')
  })

  it('kicks failed code_review work back to Building', () => {
    expect(getPipelineStage({ status: 'code_review', tester_status: 'failed', designer_status: 'passed' })).toBe('Building')
  })
})
