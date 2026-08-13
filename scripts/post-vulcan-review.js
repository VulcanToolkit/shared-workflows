import fs from 'fs';

const vulcan_project_url = 'https://github.com/VulcanToolkit';
const num_repetitions = 5;
const super_majority_threshold = 4;


// Template for the consistency check header line.
// Example: "concerning (4 / 5)"
const consistencyHeader = (response, type) => `${response[type].result_string} (${response[type].votes} / ${response[type].total_votes} votes)`;

// Templates for the reason section.
const reasonConclusive = (response, type) => response[type].reason;
const reasonInconclusive = (response, type) => `*Majority:* ${response[type].reason}

   *Dissenting:* ${response[type].dissenting}`;
const reasonSection = (response, type) => response[type].conclusive ? reasonConclusive(response, type) : reasonInconclusive(response, type);

// Template for the summary line at the end of a PR review.
const summaryLine = (response) => {
  if (response.vagueness.concerning && response.vagueness.conclusive) {
    return "Code consistency could not be evaluated because the commit message was too vague. A review of the individual commits will be conducted.";
  }

  if (response.contradicting.concerning || response.incomplete.concerning) {
    return "The pull request should be reviewed carefully for the reasons identified above.";
  }

  return "The pull request passes all code consistency checks. The changes should still be reviewed for desirability.";
}


// Template: pull request review, positive for vagueness
const vagueReport = (response) => `# [Vulcan](${vulcan_project_url}) Pull Request Review

1. **Vagueness:** ${consistencyHeader(response, "vagueness")}

   ${reasonSection(response, "vagueness")}

${summaryLine(response)}`;


// Template: pull request review, negative for vagueness
const nonvagueReport = (response) => `# [Vulcan](${vulcan_project_url}) Pull Request Review

1. **Vagueness:** ${consistencyHeader(response, "vagueness")}

   ${reasonSection(response, "vagueness")}

2. **Contradicting:** ${consistencyHeader(response, "contradicting")}

   ${reasonSection(response, "contradicting")}

3. **Incomplete:** ${consistencyHeader(response, "incomplete")}

   ${reasonSection(response, "incomplete")}

${summaryLine(response)}`;


// Template: pull request review, error parsing model output
const parseErrorReport = (response) => `# [Vulcan](${vulcan_project_url}) Pull Request Review

${response}

Note: an error occurred while parsing the report. A review of the individual commits will be conducted.`;


// Template: commit review, positive for vagueness
const vagueCommitReport = (response, hash, url, message, index) => `
## ${index}. [${message.subject}](${url})
${message.body === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message.body + "</blockquote>"}

1. **Vagueness:** ${consistencyHeader(response, "vagueness")}

   ${reasonSection(response, "vagueness")}`


// Template: commit review, negative for vagueness
const nonvagueCommitReport = (response, hash, url, message, index) => `
## ${index}. [${message.subject}](${url})
${message.body === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message.body + "</blockquote>"}

1. **Vagueness:** ${consistencyHeader(response, "vagueness")}

   ${reasonSection(response, "vagueness")}

2. **Contradicting:** ${consistencyHeader(response, "contradicting")}

   ${reasonSection(response, "contradicting")}

3. **Incomplete:** ${consistencyHeader(response, "incomplete")}

   ${reasonSection(response, "incomplete")}`;


// Template: commit review, error parsing model output
const parseErrorReportCommit = (response, hash, url, message, index) => `
## ${index}. [${message.subject}](${url})
${message.body === "" ? "*Commit message has no further details*\n\n" : "<blockquote>" + message.body + "</blockquote>"}

${response}

Note: an error occurred while parsing the report. The formatting may be incorrect, but the contents may still be helpful.`;


// Parse JSON output from model
function parseModelOutput(response) {
  // Strip extraneous text before and after the JSON output.
  var start = response.indexOf("{");
  var end = response.lastIndexOf("}");
  response = response.slice(start, end+1);
  return JSON.parse(response);
}


// Split commit message into subject line and body
function splitCommitMessage(message) {
  const index = message.indexOf("\n");
  if (index < 0) {
    return { subject: message, body: "" };
  } else {
    const subject = message.substring(0, index).trim();
    const body = message.substring(index+1).trim();
    return { subject, body };
  }
}

function countVotes(outputs, key) {
  // Count the votes for concerning / not concerning.
  const votes = {
    true: 0,
    false: 0,
  };
  for (var response of outputs) {
    const value = response[key]?.concerning;
    votes[value]++;
  }

  // Check which is the majority - break ties in favor of reporting a problem.
  // Even though we run an odd number of tests, there could be a tie if one of
  // them failed to parse.
  const majority_decision = (votes[true] >= votes[false]);
  const result = {
    concerning: majority_decision,
    result_string: majority_decision ? "concerning" : "OK",
    votes: votes[majority_decision],
    total_votes: votes[true] + votes[false],
    conclusive: (votes[majority_decision] >= super_majority_threshold),
    reason: null,
    dissenting: null,
  };
  if (!result.conclusive) {
    // Add a question mark uncertainty symbol for inconclusive results.
    result.result_string = result.result_string + '\u2BD1';
  }

  // Grab the first valid reason string for each outcome.
  for (var response of outputs) {
    if (response[key]?.concerning === majority_decision) {
      result.reason = result.reason || response[key].reason;
    } else {
      result.dissenting = result.dissenting || response[key].reason;
    }
  }

  return result;
}

function mergeOutputs(outputs) {
  const result = {};

  result.vagueness = countVotes(outputs, "vagueness");
  if (result.vagueness.concerning && result.vagueness.conclusive) {
    result.contradicting = {};
    result.incomplete = {};
  } else {
    result.contradicting = countVotes(outputs, "contradicting");
    result.incomplete = countVotes(outputs, "incomplete");
  }

  return result;
}

export async function postPullRequestReview(github, context, core) {
  const issueNumber = context.payload.pull_request
    ? context.payload.pull_request.number
    : context.payload.issue.number;

  if (!issueNumber) {
    core.setFailed("Could not determine the Issue or PR number.");
    return;
  }

  const outputs = [1, 2, 3, 4, 5].map(i => {
    const output = fs.readFileSync(`vulcan-pr-${i}.txt`, 'utf8');
    try {
      return parseModelOutput(output);
    } catch (error) {
      console.warn(error);
    }
  });
  const result = mergeOutputs(outputs);

  var comment;
  const conclusively_vague = (result.vagueness.concerning && result.vagueness.conclusive);
  if (conclusively_vague) {
    comment = vagueReport(result);
  } else {
    comment = nonvagueReport(result);
  }
  core.setOutput("should-review-commits", conclusively_vague);

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    body: comment
  });
}

export async function postAggregateCommitReview(github, context, core) {
  const issueNumber = context.payload.pull_request
    ? context.payload.pull_request.number
    : context.payload.issue.number;

  if (!issueNumber) {
    core.setFailed("Could not determine the Issue or PR number.");
    return;
  }

  const commits = JSON.parse(process.env.COMMITS);

  var table = "| # | Commit | Vagueness | Contradicting | Incomplete |\n";
  table += "| --- | --- | --- | --- | --- |\n";

  var details = "";

  var index = 1;
  for (const [hash, commit] of Object.entries(commits)) {
    const outputs = [1, 2, 3, 4, 5].map(i => {
      const output = fs.readFileSync(`vulcan-commit-${hash}-${i}.txt`, 'utf8');
      try {
        return parseModelOutput(output);
      } catch (error) {
        console.warn(error);
      }
    });
    const result = mergeOutputs(outputs);

    const url = `https://github.com/${context.repo.owner}/${context.repo.repo}/pull/${issueNumber}/changes/${hash}`
    const message = splitCommitMessage(commit.commit.message);

    const conclusively_vague = (result.vagueness.concerning && result.vagueness.conclusive);
    if (conclusively_vague) {
      details += vagueCommitReport(result, hash, url, message, index);
      table += `| ${index} | ${message.subject} [${hash}](${url}) | ${result.vagueness.result_string} | - | - |\n`;
    } else {
      details += nonvagueCommitReport(result, hash, url, message, index);
      table += `| ${index} | ${message.subject} [${hash}](${url}) | ${result.vagueness.result_string} | ${result.contradicting.result_string} | ${result.incomplete.result_string} |\n`;
    }

    index++;
  }

  const comment = `# [Vulcan](${vulcan_project_url}) Commit Review\n\n${table}\n\n${details}`;

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    body: comment
  });
}
