const { run } = require('..')

describe('run', () => {
  test('does not merge when a required status context is missing', async () => {
    const app = { log: jest.fn() }
    const context = {
      github: {
        repos: {
          getBranchProtection: jest.fn().mockResolvedValue({
            data: {
              required_status_checks: {
                contexts: ['ci/test', 'lint']
              },
              required_pull_request_reviews: null
            }
          }),
          getCombinedStatusForRef: jest.fn().mockResolvedValue({
            data: {
              statuses: [
                { context: 'ci/test', state: 'success' }
              ]
            }
          }),
          listPullRequestsAssociatedWithCommit: jest.fn()
        },
        pulls: {
          merge: jest.fn()
        }
      }
    }

    await expect(run(app, context, 'abc123', 'owner', 'repo')).resolves.toBeUndefined()

    expect(context.github.repos.listPullRequestsAssociatedWithCommit).not.toHaveBeenCalled()
    expect(context.github.pulls.merge).not.toHaveBeenCalled()
  })
})
