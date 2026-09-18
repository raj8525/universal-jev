export async function decideChoice(client, state, question, criteria) {
  // criteria can be { key: desc } or ["opt1", "opt2"]
  let formattedCriteria = {};
  if (Array.isArray(criteria)) {
    for (const opt of criteria) formattedCriteria[opt] = opt;
  } else if (typeof criteria === 'object' && criteria !== null) {
    formattedCriteria = criteria;
  } else {
    throw new Error('Criteria must be an object or array of choices');
  }

  const result = await client.decide(state, {
    q_choice: {
      type: 'choice',
      instructions: question,
      criteria: formattedCriteria,
    },
  });

  const answer = result.answers.q_choice;
  return {
    choice: answer.choice,
    confidence: answer.confidence ?? 1.0,
    probabilities: answer.probabilities || {},
    model: result.model,
    usage: result.usage,
  };
}

export async function decideNoul(client, state, question) {
  const result = await client.decide(state, {
    q_noul: {
      type: 'noul',
      instructions: question,
    },
  });

  const answer = result.answers.q_noul;
  return {
    noul: typeof answer.noul === 'number' ? answer.noul : 0.5,
    isTrue: (answer.noul ?? 0.5) >= 0.5,
    model: result.model,
    usage: result.usage,
  };
}

export async function decideScore(client, state, question, criteria) {
  let formattedCriteria = [];
  if (Array.isArray(criteria)) {
    formattedCriteria = criteria;
  } else if (typeof criteria === 'object' && criteria !== null) {
    formattedCriteria = Object.values(criteria);
  } else {
    throw new Error('Score criteria must be a rubric array of levels');
  }

  const result = await client.decide(state, {
    q_score: {
      type: 'score',
      instructions: question,
      criteria: formattedCriteria,
    },
  });

  const answer = result.answers.q_score;
  return {
    score: answer.score,
    confidence: answer.confidence ?? 1.0,
    probabilities: answer.probabilities || {},
    model: result.model,
    usage: result.usage,
  };
}

export async function guardCommand(client, command, context = '') {
  const state = `Command to evaluate:\n\`\`\`bash\n${command}\n\`\`\`\nContext:\n${context}`;
  const questions = {
    is_dangerous: {
      type: 'noul',
      instructions:
        'Does this shell command pose a severe danger (e.g. destructive data deletion like rm -rf without clear target, wiping disk, exposing credentials, infinite loop)?',
    },
    risk_level: {
      type: 'score',
      instructions: 'Risk level of executing this command (0=safe, 1=moderate/reversible, 2=high risk/irreversible)',
      criteria: [
        'Safe read-only or standard dev operation (ls, git status, cat, npm test)',
        'Moderate file write or reversible modification',
        'Dangerous, irreversible, privilege escalation, or deletion',
      ],
    },
  };

  const result = await client.decide(state, questions);
  const dangerousProb = result.answers.is_dangerous?.noul ?? 0;
  const riskScore = result.answers.risk_level?.score ?? 0;

  return {
    allowed: dangerousProb < 0.6 && riskScore < 2,
    dangerousProbability: dangerousProb,
    riskScore,
    reason:
      dangerousProb >= 0.6
        ? `Jev flagged dangerous command (risk probability ${dangerousProb.toFixed(2)})`
        : 'Safe to proceed',
  };
}
