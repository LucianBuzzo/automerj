const _ = require('lodash')

const run = async (app, context, commit, owner, repo) => {
  // Small utility that prefixes log messages with the commit SHA
  const log = (message) => app.log(`[${owner}/${repo}#${commit}]: ${message}`)

  // 1. Load the branch protection rules, so that we can ensure that merge
  //    requirements have been met

  // TODO: Check to see what branch this PR is being merged into, so we can
  // support protected branches other than master. For now, just assume that
  // the protected branch is "master"
  const prot = await context.github.repos.getBranchProtection({
    owner,
    repo,
    branch: "master",
    headers: {
      // Custom header gives us access to developer preview data that shows
      // the number of required PR review approvals.
      // See https://developer.github.com/v3/repos/branches/#get-branch-protection
      accept: 'application/vnd.github.luke-cage-preview+json'
    }
  });

  // 2. Check that all required status checks are passing
  const requiredContexts = prot.data.required_status_checks.contexts

  const statuses = await context.github.repos.getCombinedStatusForRef({
    owner,
    repo,
    ref: commit,
  });

  const allChecksPass = _.every(requiredContexts, (context) => {
    const check = _.find(statuses.data.statuses, { context })
    return check.state === 'success'
  })

  log(`All checks pass: ${allChecksPass}`)

  // If all checks pass, continue
  if (!allChecksPass) {
    return
  }

  // 3. Check if the PR is in a mergeable state (i.e. not out of date with
  //    master etc
  const pulls = await context.github.repos.listPullRequestsAssociatedWithCommit({
    owner,
    repo,
    commit_sha: commit,
  });

  // TODO: What happens if there are multiple pulls?
  // sanity check
  if (pulls.data[0].state !== 'open') {
    log('PR is not open, cannot continue')
    return
  }

  // Load the full pull resource, so that we can access the "mergeable" field
  const pull = await context.github.pulls.get({
    owner,
    repo,
    pull_number: pulls.data[0].number,
  });

  if (!(pull.data.mergeable && pull.data.mergeable_state === 'clean')) {
    log('PR is not in a mergeable state')
    return
  }

  // 4. If the branch protection requires reviews, verify that the reviews
  // are approvals
  const requiresReviews = prot.data.required_pull_request_reviews
  if (requiresReviews) {
    log('PRs require reviews')

    if (requiresReviews.require_code_owner_reviews) {
      // TODO If the code requires code owner reviews, we will need additional
      // logic to handle checking if the approving reviews are from
      // codeowners
    }
    const numberOfApprovalsRequired = requiresReviews.required_approving_review_count

    const reviews = await context.github.pulls.listReviews({
      owner,
      repo,
      pull_number: pull.data.number,
    })

    const numApproved = _.filter(reviews.data, { state: 'APPROVED' }).length

    // Verify that the number of approvals is met
    if (numApproved < numberOfApprovalsRequired) {
      log(`Not enough approvals to merge PR (${numApproved}/${numberOfAppovalsRequired})`)
      return
    }
  } else {
    app.log('PR does not require reviews')
  }

  // 5. If all checks pass, merge the PR
  log('All checks pass, merging now')
  const mergeResult = await context.github.pulls.merge({
    owner,
    repo,
    pull_number: pull.data.number,
  })
}

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
module.exports = app => {
  app.on('pull_request_review.submitted', async context => {
    // Only continue if the review state is "approved"
    if (context.payload.review.state !== 'approved') {
      return
    }

    const [ owner, repo ] = context.payload.repository.full_name.split('/')
    const commit = context.payload.review.commit_id
    await run (app, context, commit, owner, repo)
  })

  app.on('status', async context => {
    // if status is success
    if (context.payload.state !== 'success') {
      return
    }

    // Check for matching branches where the head commit is the same
    const branches = context.payload.branches.filter(branch => {
      return branch.commit.sha = commit
    })

    if (branches.length === 0) {
      return
    }

    const [ owner, repo ] = context.payload.name.split('/')

    const commit = context.payload.sha


    await run (app, context, commit, owner, repo)
  })
}
