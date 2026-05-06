export const SUPPORTED_POLICIES = ["FIFO", "LRU", "LFU", "MRU", "RL"];

export async function getVictimIndex(policyName, state, resolveRlAction) {
  const validIndices = state.cacheLines
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value !== 0)
    .map((item) => item.index);

  if (validIndices.length === 0) {
    return 0;
  }

  if (policyName === "FIFO" || policyName === "LRU") {
    return validIndices[0];
  }

  if (policyName === "MRU") {
    return validIndices[validIndices.length - 1];
  }

  if (policyName === "LFU") {
    let bestIndex = validIndices[0];
    let bestCount = state.accessCounts[bestIndex];
    for (const index of validIndices) {
      if (state.accessCounts[index] < bestCount) {
        bestCount = state.accessCounts[index];
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  if (policyName === "RL") {
    return resolveRlAction(state);
  }

  return validIndices[0];
}
